//! Agente das contas por API (DeepSeek, OpenAI-compatível, Ollama) com as ferramentas do
//! Veocode (tools.rs). Cada rodada: o modelo responde com texto e/ou chamadas de ferramenta;
//! cada chamada passa pelo nível de acesso (roda, pergunta à pessoa ou é bloqueada) e o
//! resultado volta para o modelo, até ele terminar sem pedir mais nada.
//!
//! Modelos que não aceitam ferramentas (alguns do Ollama) caem para só conversa.

use crate::access::{effective, Rule};
use crate::accounts::{remote, Account, Provider};
use crate::agent::AgentEvent;
use crate::tools::{self, Call};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

/// Rodadas por pedido (cada rodada pode ter várias ferramentas).
const MAX_ROUNDS: usize = 40;

pub enum Wire {
    OpenAi { base: String, key: String, model: String },
    Ollama { base: String, model: String },
}

pub fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(6)).timeout_read(Duration::from_secs(180)).build()
}

/// Endereço, chave e modelo da conta.
pub fn wire_for(a: &Account, ag: &ureq::Agent) -> Result<Wire, String> {
    let base = a.base_url.clone().unwrap_or_default().trim_end_matches('/').to_string();
    if a.provider == Provider::Ollama {
        let base = if base.is_empty() { crate::accounts::OLLAMA_URL.to_string() } else { base };
        let model = match a.model.clone().filter(|m| !m.is_empty()) {
            Some(m) => m,
            None => first_ollama_model(ag, &base).ok_or("O Ollama não tem nenhum modelo baixado. Rode `ollama pull` com um modelo e tente de novo.")?,
        };
        return Ok(Wire::Ollama { base, model });
    }
    remote::check_base_url(&base)?;
    let key = remote::get_key(&a.id).ok_or("Esta conta está sem chave de API. Cole a chave em Contas.")?;
    let model = a.model.clone().filter(|m| !m.is_empty()).unwrap_or_else(|| if a.provider == Provider::Deepseek { "deepseek-chat".into() } else { "gpt-4o-mini".into() });
    Ok(Wire::OpenAi { base, key, model })
}

fn first_ollama_model(ag: &ureq::Agent, base: &str) -> Option<String> {
    let v: Value = ag.get(&format!("{base}/api/tags")).call().ok()?.into_json().ok()?;
    v.get("models")?.as_array()?.first()?.get("name")?.as_str().map(String::from)
}

// ---------------------------------------------------------------- uma rodada

struct Round {
    text: String,
    calls: Vec<Call>,
}

enum Fail {
    /// o modelo não aceita ferramentas
    NoTools,
    Msg(String),
}

fn fail(e: ureq::Error, with_tools: bool) -> Fail {
    match e {
        ureq::Error::Status(401 | 403, _) => Fail::Msg("A chave foi recusada. Confira a chave em Contas.".into()),
        ureq::Error::Status(402, _) => Fail::Msg("Sem saldo na conta da API.".into()),
        ureq::Error::Status(429, _) => Fail::Msg("Limite de requisições atingido. Tente de novo em instantes.".into()),
        ureq::Error::Status(c, r) => {
            let body = r.into_string().unwrap_or_default();
            if with_tools && (c == 400 || c == 422) && body.to_lowercase().contains("tool") {
                Fail::NoTools
            } else if c == 404 {
                Fail::Msg(format!("Modelo ou endereço não encontrado ({}).", cut(&body, 120)))
            } else {
                Fail::Msg(format!("A API respondeu com erro {c}: {}", cut(&body, 160)))
            }
        }
        ureq::Error::Transport(t) => Fail::Msg(format!("Sem conexão: {t}")),
    }
}

fn round(ag: &ureq::Agent, w: &Wire, msgs: &[Value], tools: bool, cancel: &AtomicBool, on_delta: &mut dyn FnMut(&str)) -> Result<Round, Fail> {
    match w {
        Wire::OpenAi { base, key, model } => {
            let mut body = json!({"model": model, "messages": msgs, "stream": true});
            if tools {
                body["tools"] = tools::specs();
            }
            let r = ag.post(&format!("{base}/chat/completions")).set("Authorization", &format!("Bearer {key}")).send_json(body).map_err(|e| fail(e, tools))?;
            Ok(read_openai(BufReader::new(r.into_reader()), cancel, on_delta))
        }
        Wire::Ollama { base, model } => {
            let mut body = json!({"model": model, "messages": msgs, "stream": true});
            if tools {
                body["tools"] = tools::specs();
            }
            let r = ag.post(&format!("{base}/api/chat")).send_json(body).map_err(|e| fail(e, tools))?;
            Ok(read_ollama(BufReader::new(r.into_reader()), cancel, on_delta))
        }
    }
}

/// Stream `data: {...}` da OpenAI. As chamadas chegam aos pedaços, por índice.
fn read_openai(r: impl BufRead, cancel: &AtomicBool, on_delta: &mut dyn FnMut(&str)) -> Round {
    let mut text = String::new();
    let mut parts: BTreeMap<u64, (String, String, String)> = BTreeMap::new(); // índice → (id, nome, argumentos)
    for line in r.lines() {
        if cancel.load(Ordering::SeqCst) {
            break;
        }
        let Ok(line) = line else { break };
        let Some(data) = line.strip_prefix("data:").map(str::trim) else { continue };
        if data == "[DONE]" {
            break;
        }
        let Ok(v) = serde_json::from_str::<Value>(data) else { continue };
        let d = v.pointer("/choices/0/delta").cloned().unwrap_or(Value::Null);
        if let Some(t) = d.get("content").and_then(Value::as_str).filter(|t| !t.is_empty()) {
            text.push_str(t);
            on_delta(t);
        }
        for tc in d.get("tool_calls").and_then(Value::as_array).into_iter().flatten() {
            let i = tc.get("index").and_then(Value::as_u64).unwrap_or(0);
            let p = parts.entry(i).or_default();
            if let Some(id) = tc.get("id").and_then(Value::as_str) {
                p.0 = id.into();
            }
            if let Some(n) = tc.pointer("/function/name").and_then(Value::as_str) {
                p.1.push_str(n);
            }
            if let Some(a) = tc.pointer("/function/arguments").and_then(Value::as_str) {
                p.2.push_str(a);
            }
        }
    }
    let calls = parts
        .into_iter()
        .map(|(i, (id, name, args))| Call {
            id: if id.is_empty() { format!("call_{i}") } else { id },
            name,
            args: if args.trim().is_empty() { json!({}) } else { serde_json::from_str(&args).unwrap_or(Value::Null) },
        })
        .collect();
    Round { text, calls }
}

/// Stream NDJSON do Ollama. As chamadas vêm inteiras em `message.tool_calls`.
fn read_ollama(r: impl BufRead, cancel: &AtomicBool, on_delta: &mut dyn FnMut(&str)) -> Round {
    let mut text = String::new();
    let mut calls = vec![];
    for line in r.lines() {
        if cancel.load(Ordering::SeqCst) {
            break;
        }
        let Ok(line) = line else { break };
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        if let Some(t) = v.pointer("/message/content").and_then(Value::as_str).filter(|t| !t.is_empty()) {
            text.push_str(t);
            on_delta(t);
        }
        for tc in v.pointer("/message/tool_calls").and_then(Value::as_array).into_iter().flatten() {
            let args = tc.pointer("/function/arguments").cloned().unwrap_or(json!({}));
            // alguns modelos mandam os argumentos como texto JSON
            let args = match args {
                Value::String(s) => serde_json::from_str(&s).unwrap_or(Value::Null),
                a => a,
            };
            calls.push(Call {
                id: tc.get("id").and_then(Value::as_str).map(String::from).unwrap_or_else(|| format!("call_{}", calls.len())),
                name: tc.pointer("/function/name").and_then(Value::as_str).unwrap_or("").into(),
                args,
            });
        }
        if v.get("done").and_then(Value::as_bool) == Some(true) {
            break;
        }
    }
    Round { text, calls }
}

/// Mensagens do assistente (com as chamadas) e dos resultados, no formato de cada API.
fn assistant_msg(w: &Wire, text: &str, calls: &[Call]) -> Value {
    if calls.is_empty() {
        return json!({"role":"assistant","content":text});
    }
    match w {
        Wire::OpenAi { .. } => json!({"role":"assistant","content":text,"tool_calls": calls.iter().map(|c| json!({"id":c.id,"type":"function","function":{"name":c.name,"arguments":c.args.to_string()}})).collect::<Vec<_>>()}),
        Wire::Ollama { .. } => json!({"role":"assistant","content":text,"tool_calls": calls.iter().map(|c| json!({"function":{"name":c.name,"arguments":c.args}})).collect::<Vec<_>>()}),
    }
}

fn tool_msg(w: &Wire, c: &Call, text: &str) -> Value {
    match w {
        Wire::OpenAi { .. } => json!({"role":"tool","tool_call_id":c.id,"content":text}),
        Wire::Ollama { .. } => json!({"role":"tool","tool_name":c.name,"content":text}),
    }
}

// ---------------------------------------------------------------- o pedido inteiro

pub struct Turn<'a> {
    pub wire: &'a Wire,
    pub root: PathBuf,
    pub project_name: String,
    pub account_id: String,
    pub level: u8,
    pub overrides: BTreeMap<String, Rule>,
    pub cancel: &'a AtomicBool,
    /// instruções próprias no lugar das do projeto (Chat livre)
    pub intro: Option<String>,
    /// oferecer as ferramentas ao modelo
    pub tools: bool,
}

pub trait Hooks {
    fn delta(&mut self, text: &str);
    fn say(&mut self, text: String);
    fn step(&mut self, e: AgentEvent);
    /// Pergunta à pessoa. `None` = a resposta foi parada.
    fn ask(&mut self, c: &Call, look: &tools::Look) -> Option<bool>;
}

#[derive(Debug, Default, PartialEq)]
pub struct End {
    pub steps: usize,
    pub stopped: bool,
    pub no_tools: bool,
    pub hit_limit: bool,
}

const LEVEL_NAMES: [&str; 4] = ["Leitura", "Sugerir", "Editar", "Total"];

/// Instruções do sistema: o projeto, as ferramentas e o que o nível deixa.
pub fn system_prompt(t: &Turn, tools: bool) -> String {
    if let Some(intro) = &t.intro {
        let mut s = intro.clone();
        if t.tools && !tools {
            s.push_str("\nEste modelo não aceita ferramentas: você não consegue ver os arquivos, só conversar.");
        }
        return s;
    }
    let mut s = format!(
        "Você trabalha dentro do Veocode no projeto \"{}\". Responda em português do Brasil, direto e claro.\n",
        t.project_name
    );
    if !tools {
        s.push_str("Você não tem acesso aos arquivos: só vê o que a pessoa colar ou anexar.");
        return s;
    }
    s.push_str(
        "Você tem ferramentas para listar, ler, buscar, escrever e editar arquivos do projeto e rodar comandos na pasta dele. \
         Use caminhos relativos à raiz do projeto; nada fora da pasta. Leia antes de editar e prefira edit_file a reescrever o arquivo inteiro. \
         Ao terminar, diga em poucas linhas o que fez.\n",
    );
    s.push_str(&format!("Nível de acesso do projeto: {}. Regras:\n", LEVEL_NAMES[t.level.min(3) as usize]));
    let text = |r: Rule| match r {
        Rule::Permitido => "permitido",
        Rule::Pergunta => "precisa da aprovação da pessoa (o Veocode pergunta sozinho, só chame a ferramenta)",
        Rule::Bloqueado => "bloqueado: não tente, nem por outro caminho",
    };
    for (cap, r) in effective(t.level, &t.overrides) {
        if matches!(cap.id, "mcp" | "outside") {
            continue;
        }
        s.push_str(&format!("- {}: {}\n", cap.label, text(r)));
    }
    s
}

/// Roda um pedido até o fim. `msgs` é a conversa (sem a mensagem de sistema), já com o
/// pedido novo no fim; as respostas e os resultados das ferramentas entram nela.
pub fn run_turn(ag: &ureq::Agent, t: &Turn, msgs: &mut Vec<Value>, h: &mut dyn Hooks) -> Result<End, String> {
    let mut end = End::default();
    let mut tools_on = t.tools;
    let stamp = now_ms();
    for n in 0..MAX_ROUNDS {
        if t.cancel.load(Ordering::SeqCst) {
            end.stopped = true;
            return Ok(end);
        }
        let mut full = vec![json!({"role":"system","content": system_prompt(t, tools_on)})];
        full.extend(msgs.iter().cloned());
        let r = match round(ag, t.wire, &full, tools_on, t.cancel, &mut |d| h.delta(d)) {
            Ok(r) => r,
            Err(Fail::NoTools) => {
                // modelo sem ferramentas: tenta de novo só conversando
                tools_on = false;
                end.no_tools = true;
                full[0] = json!({"role":"system","content": system_prompt(t, false)});
                round(ag, t.wire, &full, false, t.cancel, &mut |d| h.delta(d)).map_err(|f| match f {
                    Fail::Msg(m) => m,
                    Fail::NoTools => "o modelo recusou o pedido".into(),
                })?
            }
            Err(Fail::Msg(m)) => return Err(m),
        };
        if !r.text.trim().is_empty() {
            h.say(r.text.clone());
        }
        msgs.push(assistant_msg(t.wire, &r.text, &r.calls));
        if t.cancel.load(Ordering::SeqCst) {
            // chamadas que não rodaram ainda precisam de resposta para a conversa continuar válida
            for c in &r.calls {
                msgs.push(tool_msg(t.wire, c, "Parado pela pessoa antes de rodar."));
            }
            end.stopped = true;
            return Ok(end);
        }
        if r.calls.is_empty() {
            return Ok(end);
        }
        for (i, c) in r.calls.iter().enumerate() {
            let id = format!("api-{stamp}-{n}-{i}");
            let result = if t.cancel.load(Ordering::SeqCst) {
                "Parado pela pessoa antes de rodar.".to_string()
            } else {
                end.steps += 1;
                run_call(t, c, &id, h)
            };
            msgs.push(tool_msg(t.wire, c, &result));
        }
    }
    end.hit_limit = true;
    Ok(end)
}

/// Uma chamada: passo na tela, decisão do nível, (pergunta), execução, resultado.
fn run_call(t: &Turn, c: &Call, id: &str, h: &mut dyn Hooks) -> String {
    let look = tools::look(c);
    let ev = |kind: &str, status: &str| AgentEvent {
        id: id.into(),
        session: "api".into(),
        account: t.account_id.clone(),
        kind: kind.into(),
        title: look.title.clone(),
        detail: look.detail.clone(),
        path: look.path.clone().filter(|p| !p.is_empty()),
        status: status.into(),
        ts: now_ms() as i64,
        ..Default::default()
    };
    h.step(ev(look.kind, "running"));
    let finish = |h: &mut dyn Hooks, ok: bool, detail: Option<String>, created: bool, output: Vec<String>| {
        let mut e = ev("result", if ok { "ok" } else { "error" });
        e.title = if created { "create".into() } else { String::new() };
        e.detail = detail;
        e.output = output;
        h.step(e);
    };
    if c.args.is_null() {
        finish(h, false, Some("argumentos inválidos".into()), false, vec![]);
        return "Erro: os argumentos não são um JSON válido. Chame de novo com um objeto JSON.".into();
    }
    let (rule, why) = tools::decide(c, t.level, &t.overrides);
    match rule {
        Rule::Bloqueado => {
            finish(h, false, Some(format!("bloqueado pelo nível ({why})")), false, vec![]);
            return format!("Bloqueado pelo nível de acesso do projeto ({why}). Não tente de novo por outro caminho: explique à pessoa o que precisaria liberar.");
        }
        Rule::Pergunta => match h.ask(c, &look) {
            Some(true) => {}
            Some(false) => {
                finish(h, false, Some("recusado".into()), false, vec![]);
                return "A pessoa recusou esta ação. Não tente de novo; pergunte o que ela prefere.".into();
            }
            None => {
                finish(h, false, Some("parado".into()), false, vec![]);
                return "Parado pela pessoa.".into();
            }
        },
        Rule::Permitido => {}
    }
    let o = tools::run(&t.root, c, t.cancel);
    finish(h, o.ok, o.detail.clone(), o.created, o.output.clone());
    o.text
}

/// Corta a conversa guardada sem separar uma chamada do seu resultado: começa sempre num
/// pedido da pessoa.
pub fn trim_history(msgs: &mut Vec<Value>, max: usize) {
    if msgs.len() <= max {
        return;
    }
    let from = msgs.len() - max;
    let start = (from..msgs.len()).find(|&i| msgs[i].get("role").and_then(Value::as_str) == Some("user")).unwrap_or(msgs.len());
    msgs.drain(..start);
}

fn now_ms() -> u128 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

fn cut(s: &str, n: usize) -> String {
    let t = s.trim().replace('\n', " ");
    if t.chars().count() > n { format!("{}…", t.chars().take(n).collect::<String>()) } else { t }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::sync::{Arc, Mutex};

    /// Servidor de mentira: responde os pedidos em ordem com `bodies` e guarda o que recebeu.
    fn fake_server(bodies: Vec<(u16, String)>, ctype: &'static str) -> (String, Arc<Mutex<Vec<Value>>>) {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = format!("http://{}", l.local_addr().unwrap());
        let seen = Arc::new(Mutex::new(vec![]));
        let seen2 = seen.clone();
        std::thread::spawn(move || {
            for (code, body) in bodies {
                let (mut s, _) = l.accept().unwrap();
                let mut req = Vec::new();
                let mut buf = [0u8; 8192];
                loop {
                    let n = s.read(&mut buf).unwrap_or(0);
                    req.extend_from_slice(&buf[..n]);
                    let text = String::from_utf8_lossy(&req).to_string();
                    if let Some(end) = text.find("\r\n\r\n") {
                        let len = text.lines().find_map(|h| h.to_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0))).unwrap_or(0);
                        if req.len() >= end + 4 + len {
                            if let Ok(v) = serde_json::from_slice(&req[end + 4..]) {
                                seen2.lock().unwrap().push(v);
                            }
                            break;
                        }
                    }
                    if n == 0 {
                        break;
                    }
                }
                let _ = write!(s, "HTTP/1.1 {code} X\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                let _ = s.shutdown(std::net::Shutdown::Write);
            }
        });
        (addr, seen)
    }

    #[derive(Default)]
    struct Rec {
        says: Vec<String>,
        steps: Vec<AgentEvent>,
        asks: Vec<String>,
        answer: Option<bool>,
    }
    impl Hooks for Rec {
        fn delta(&mut self, _: &str) {}
        fn say(&mut self, t: String) {
            self.says.push(t);
        }
        fn step(&mut self, e: AgentEvent) {
            self.steps.push(e);
        }
        fn ask(&mut self, _: &Call, look: &tools::Look) -> Option<bool> {
            self.asks.push(look.title.clone());
            self.answer
        }
    }

    fn sse(chunks: &[Value]) -> String {
        chunks.iter().map(|c| format!("data: {c}\n\n")).collect::<String>() + "data: [DONE]\n\n"
    }

    fn turn<'a>(w: &'a Wire, root: &std::path::Path, level: u8, cancel: &'a AtomicBool) -> Turn<'a> {
        Turn { wire: w, root: root.into(), project_name: "p".into(), account_id: "acc".into(), level, overrides: BTreeMap::new(), cancel, intro: None, tools: true }
    }

    #[test]
    fn openai_agent_writes_after_permission() {
        let d = tempfile::tempdir().unwrap();
        // 1ª rodada: chamada de write_file em dois pedaços; 2ª: texto final
        let r1 = sse(&[
            json!({"choices":[{"delta":{"content":"Vou criar."}}]}),
            json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","type":"function","function":{"name":"write_file","arguments":"{\"path\":\"ola.txt\","}}]}}]}),
            json!({"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"content\":\"oi\\n\"}"}}]}}]}),
        ]);
        let r2 = sse(&[json!({"choices":[{"delta":{"content":"Pronto."}}]})]);
        let (base, seen) = fake_server(vec![(200, r1), (200, r2)], "text/event-stream");
        let w = Wire::OpenAi { base, key: "k".into(), model: "m".into() };
        let no = AtomicBool::new(false);
        let mut msgs = vec![json!({"role":"user","content":"crie ola.txt"})];
        let mut rec = Rec { answer: Some(true), ..Default::default() };
        let end = run_turn(&agent(), &turn(&w, d.path(), 1, &no), &mut msgs, &mut rec).unwrap();
        assert_eq!(end, End { steps: 1, ..Default::default() });
        assert_eq!(std::fs::read_to_string(d.path().join("ola.txt")).unwrap(), "oi\n");
        assert_eq!(rec.says, ["Vou criar.", "Pronto."]);
        assert_eq!(rec.asks, ["Escrevendo ola.txt"]);
        let kinds: Vec<_> = rec.steps.iter().map(|e| (e.kind.as_str(), e.status.as_str(), e.title.as_str())).collect();
        assert_eq!(kinds, [("edit", "running", "Escrevendo ola.txt"), ("result", "ok", "create")]);
        // a 2ª chamada levou a chamada e o resultado no formato da OpenAI
        let sent = seen.lock().unwrap();
        assert!(sent[0]["tools"].as_array().unwrap().len() >= 6);
        let m = sent[1]["messages"].as_array().unwrap();
        assert_eq!(m[2]["tool_calls"][0]["function"]["name"], "write_file");
        assert_eq!(m[3]["role"], "tool");
        assert_eq!(m[3]["tool_call_id"], "call_a");
        assert_eq!(msgs.len(), 4);
    }

    #[test]
    fn blocked_and_refused_go_back_to_the_model() {
        let d = tempfile::tempdir().unwrap();
        let call = |name: &str, args: Value| {
            json!({"message":{"role":"assistant","content":"","tool_calls":[{"function":{"name":name,"arguments":args}}]},"done":false}).to_string() + "\n" + &json!({"done":true}).to_string() + "\n"
        };
        let fin = json!({"message":{"content":"Não deu."},"done":true}).to_string() + "\n";
        // Leitura: write_file bloqueado sem perguntar; depois run_command recusado no nível Sugerir
        let (base, seen) = fake_server(vec![(200, call("write_file", json!({"path":"a.txt","content":"x"}))), (200, fin.clone())], "application/x-ndjson");
        let w = Wire::Ollama { base, model: "m".into() };
        let no = AtomicBool::new(false);
        let mut msgs = vec![json!({"role":"user","content":"x"})];
        let mut rec = Rec::default();
        run_turn(&agent(), &turn(&w, d.path(), 0, &no), &mut msgs, &mut rec).unwrap();
        assert!(rec.asks.is_empty() && !d.path().join("a.txt").exists());
        assert_eq!(rec.steps[1].detail.as_deref(), Some("bloqueado pelo nível (editar)"));
        let sent = seen.lock().unwrap();
        let tool = &sent[1]["messages"].as_array().unwrap()[3];
        assert_eq!((tool["role"].as_str(), tool["tool_name"].as_str()), (Some("tool"), Some("write_file")));
        assert!(tool["content"].as_str().unwrap().starts_with("Bloqueado"));
        drop(sent);

        let (base, _) = fake_server(vec![(200, call("run_command", json!({"command":"npm test"}))), (200, fin)], "application/x-ndjson");
        let w = Wire::Ollama { base, model: "m".into() };
        let mut rec = Rec { answer: Some(false), ..Default::default() };
        let mut msgs = vec![json!({"role":"user","content":"x"})];
        run_turn(&agent(), &turn(&w, d.path(), 1, &no), &mut msgs, &mut rec).unwrap();
        assert_eq!(rec.asks, ["npm test"]);
        assert_eq!(rec.steps[1].detail.as_deref(), Some("recusado"));
    }

    #[test]
    fn model_without_tools_falls_back_to_chat() {
        let d = tempfile::tempdir().unwrap();
        let ok = json!({"message":{"content":"Oi!"},"done":true}).to_string() + "\n";
        let (base, seen) = fake_server(vec![(400, r#"{"error":"m does not support tools"}"#.into()), (200, ok)], "application/x-ndjson");
        let w = Wire::Ollama { base, model: "m".into() };
        let no = AtomicBool::new(false);
        let mut msgs = vec![json!({"role":"user","content":"oi"})];
        let mut rec = Rec::default();
        let end = run_turn(&agent(), &turn(&w, d.path(), 2, &no), &mut msgs, &mut rec).unwrap();
        assert!(end.no_tools);
        assert_eq!(rec.says, ["Oi!"]);
        assert!(seen.lock().unwrap()[1].get("tools").is_none());
    }

    #[test]
    fn trims_at_user_messages() {
        let m = |r: &str| json!({"role": r});
        let mut v = vec![m("user"), m("assistant"), m("tool"), m("assistant"), m("user"), m("assistant")];
        trim_history(&mut v, 4);
        assert_eq!(v.len(), 2);
        assert_eq!(v[0]["role"], "user");
    }

    #[test]
    fn prompt_lists_the_rules() {
        let w = Wire::Ollama { base: String::new(), model: String::new() };
        let no = AtomicBool::new(false);
        let d = std::env::temp_dir();
        let s = system_prompt(&turn(&w, &d, 1, &no), true);
        assert!(s.contains("Nível de acesso do projeto: Sugerir"));
        assert!(s.contains("- Editar arquivos: precisa da aprovação"));
        assert!(s.contains("- Publicar com git push: bloqueado"));
    }
}
