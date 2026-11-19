// Ditado do Veocode: ouve o microfone e transcreve no próprio Mac.
// No macOS 26+ usa o motor novo da Apple (SpeechAnalyzer), que roda local e NÃO depende
// da Siri nem do Ditado do sistema. Em Macs mais antigos cai no SFSpeechRecognizer.
// Fala com o app por linhas JSON:
//   saída  {"t":"ready"} | {"t":"level","v":0.42} | {"t":"text","v":"..."} | {"t":"note","v":"..."}
//          {"t":"done","v":"..."} | {"t":"error","v":"..."}
//   entrada "stop" (termina e manda o texto final) ou o fim do stdin (cancela)
// Teste sem microfone: veocode-voice pt-BR --file fala.aiff
import AVFoundation
import Foundation
import Speech

setvbuf(stdout, nil, _IOLBF, 0)

func send(_ kind: String, _ value: Any? = nil) {
    var o: [String: Any] = ["t": kind]
    if let value { o["v"] = value }
    if let d = try? JSONSerialization.data(withJSONObject: o), let s = String(data: d, encoding: .utf8) {
        print(s)
    }
}

func fail(_ msg: String) -> Never {
    send("error", msg)
    exit(1)
}

let args = CommandLine.arguments
let wanted = Locale(identifier: args.count > 1 && !args[1].hasPrefix("--") ? args[1] : "pt-BR")
let testFile: String? = args.firstIndex(of: "--file").flatMap { $0 + 1 < args.count ? args[$0 + 1] : nil }

let micDenied = "Sem permissão do microfone: libere o Veocode em Ajustes do Sistema → Privacidade e Segurança → Microfone"
let engine = AVAudioEngine()
var lastLevel = Date.distantPast
var finished = false

/// volume da voz (para a animação), umas 20 vezes por segundo
func reportLevel(_ buf: AVAudioPCMBuffer) {
    let now = Date()
    guard now.timeIntervalSince(lastLevel) > 0.05, let ch = buf.floatChannelData?[0] else { return }
    lastLevel = now
    let n = Int(buf.frameLength)
    var sum: Float = 0
    for i in 0..<n { sum += ch[i] * ch[i] }
    let rms = n > 0 ? sqrt(sum / Float(n)) : 0
    let db = 20 * log10(max(rms, 0.000_01))
    send("level", Double(max(0, min(1, (db + 55) / 45))))
}

/// junta o trecho já fechado com o que ainda está sendo ouvido
func join(_ a: String, _ b: String) -> String {
    let b = b.trimmingCharacters(in: .whitespaces)
    if a.isEmpty { return b }
    if b.isEmpty { return a }
    return a.hasSuffix(" ") ? a + b : a + " " + b
}

func onStop(_ body: @escaping () -> Void) {
    // "stop" encerra com o texto; stdin fechado (o app saiu ou cancelou) encerra na hora
    Thread.detachNewThread {
        while let line = readLine() {
            if line.trimmingCharacters(in: .whitespaces) == "stop" { DispatchQueue.main.async(execute: body) }
        }
        exit(0)
    }
}

func requestMic(_ then: @escaping () -> Void) {
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized: then()
    case .denied, .restricted: fail(micDenied)
    default:
        AVCaptureDevice.requestAccess(for: .audio) { ok in
            guard ok else { fail(micDenied) }
            DispatchQueue.main.async(execute: then)
        }
    }
}

/// fora do MainActor: o áudio chega numa thread própria
@available(macOS 26, *)
nonisolated func tapMic(_ input: AVAudioInputNode, _ inFmt: AVAudioFormat, _ fmt: AVAudioFormat, _ converter: AVAudioConverter?, _ builder: AsyncStream<AnalyzerInput>.Continuation) {
    input.installTap(onBus: 0, bufferSize: 1024, format: inFmt) { @Sendable buf, _ in
        reportLevel(buf)
        guard let converter else { builder.yield(AnalyzerInput(buffer: buf)); return }
        let cap = AVAudioFrameCount(Double(buf.frameLength) * fmt.sampleRate / inFmt.sampleRate + 64)
        guard let out = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: cap) else { return }
        var fed = false
        var err: NSError?
        converter.convert(to: out, error: &err) { _, status in
            if fed { status.pointee = .noDataNow; return nil }
            fed = true
            status.pointee = .haveData
            return buf
        }
        if err == nil, out.frameLength > 0 { builder.yield(AnalyzerInput(buffer: out)) }
    }
}

// MARK: - Motor novo (macOS 26+): local, sem Siri

@available(macOS 26, *)
@MainActor
final class Modern {
    let transcriber: SpeechTranscriber
    let analyzer: SpeechAnalyzer
    var done = ""      // trechos já fechados
    var live = ""      // trecho que ainda pode mudar
    var reader: Task<Void, Never>?

    init(locale: Locale) {
        transcriber = SpeechTranscriber(locale: locale, transcriptionOptions: [], reportingOptions: [.volatileResults], attributeOptions: [])
        analyzer = SpeechAnalyzer(modules: [transcriber])
    }

    var text: String { join(done, live) }

    /// baixa o modelo do idioma na primeira vez (fica guardado pelo sistema)
    func ensureModel() async throws {
        if let req = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
            send("note", "Baixando o modelo de voz da Apple (só na primeira vez)…")
            try await req.downloadAndInstall()
        }
    }

    func readResults() {
        reader = Task { @MainActor in
            do {
                for try await r in transcriber.results {
                    let t = String(r.text.characters)
                    if r.isFinal { done = join(done, t); live = "" } else { live = t }
                    send("text", text)
                }
            } catch {
                if done.isEmpty && live.isEmpty && !finished { fail("O ditado parou: \(error.localizedDescription)") }
            }
        }
    }

    func finish() async {
        if finished { return }
        // espera o resultado final, mas no máximo uns segundos
        let wait = Task { @MainActor in
            try? await analyzer.finalizeAndFinishThroughEndOfInput()
            await reader?.value
        }
        let timeout = Task { try? await Task.sleep(nanoseconds: 3_000_000_000) }
        await withTaskGroup(of: Void.self) { g in
            g.addTask { await wait.value }
            g.addTask { await timeout.value }
            await g.next()
            g.cancelAll()
        }
        finished = true
        send("done", text)
        exit(0)
    }

    func runMic() async throws {
        try await ensureModel()
        let input = engine.inputNode
        let inFmt = input.outputFormat(forBus: 0)
        guard inFmt.channelCount > 0 else { fail("Nenhum microfone encontrado") }
        guard let fmt = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber], considering: inFmt) else {
            fail("O motor de voz não aceitou o formato do microfone")
        }
        let converter = inFmt == fmt ? nil : AVAudioConverter(from: inFmt, to: fmt)
        let (stream, builder) = AsyncStream<AnalyzerInput>.makeStream()
        try await analyzer.start(inputSequence: stream)
        readResults()

        tapMic(input, inFmt, fmt, converter, builder)
        engine.prepare()
        do { try engine.start() } catch { fail("Não deu para abrir o microfone: \(error.localizedDescription)") }
        send("ready")

        onStop {
            engine.stop()
            engine.inputNode.removeTap(onBus: 0)
            builder.finish()
            Task { @MainActor in await self.finish() }
        }
    }

    func runFile(_ path: String) async throws {
        try await ensureModel()
        let file = try AVAudioFile(forReading: URL(fileURLWithPath: path))
        readResults()
        send("ready")
        _ = try await analyzer.analyzeSequence(from: file)
        await finish()
    }
}

@available(macOS 26, *)
@MainActor
func modern() async -> Bool {
    guard SpeechTranscriber.isAvailable,
          let locale = await SpeechTranscriber.supportedLocale(equivalentTo: wanted) else { return false }
    let m = Modern(locale: locale)
    do {
        if let testFile { try await m.runFile(testFile) } else { try await m.runMic() }
    } catch {
        fail("O ditado não conseguiu começar: \(error.localizedDescription)")
    }
    return true
}

// MARK: - Motor antigo (antes do macOS 26): depende da Siri/Ditado ligados

func legacy() {
    guard let recognizer = SFSpeechRecognizer(locale: wanted) else { fail("O reconhecimento de fala não tem o idioma \(wanted.identifier) neste Mac") }
    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    if #available(macOS 13, *) { request.addsPunctuation = true }
    if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
    var best = ""

    func finish() {
        if finished { return }
        finished = true
        send("done", best)
        exit(0)
    }

    func start() {
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.channelCount > 0 else { fail("Nenhum microfone encontrado") }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buf, _ in
            request.append(buf)
            reportLevel(buf)
        }
        _ = recognizer.recognitionTask(with: request) { result, error in
            if let result {
                best = result.bestTranscription.formattedString
                send("text", best)
                if result.isFinal { finish() }
            }
            if let error, !finished {
                let ns = error as NSError
                // fim sem fala nenhuma: não é erro de verdade
                if ns.domain == "kAFAssistantErrorDomain" && (ns.code == 1110 || ns.code == 216) { finish() }
                if !best.isEmpty { finish() }
                let msg = error.localizedDescription
                if msg.localizedCaseInsensitiveContains("siri") || msg.localizedCaseInsensitiveContains("dictation") {
                    fail("Neste macOS o ditado usa o motor da Siri: ligue Ajustes do Sistema → Teclado → Ditado")
                }
                fail(msg)
            }
        }
        engine.prepare()
        do { try engine.start() } catch { fail("Não deu para abrir o microfone: \(error.localizedDescription)") }
        send("ready")
        onStop {
            engine.stop()
            engine.inputNode.removeTap(onBus: 0)
            request.endAudio()
            // se o resultado final demorar, manda o que tem
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { finish() }
        }
    }

    SFSpeechRecognizer.requestAuthorization { status in
        guard status == .authorized else {
            fail(status == .denied || status == .restricted
                ? "Sem permissão de reconhecimento de fala: libere o Veocode em Ajustes do Sistema → Privacidade e Segurança → Reconhecimento de Fala"
                : "O reconhecimento de fala não está disponível")
        }
        requestMic(start)
    }
}

// MARK: - Início

func begin() {
    if #available(macOS 26, *) {
        Task { @MainActor in
            if await modern() { return }
            legacy()
        }
    } else {
        legacy()
    }
}

if testFile != nil { begin() } else { requestMic(begin) }

dispatchMain()
