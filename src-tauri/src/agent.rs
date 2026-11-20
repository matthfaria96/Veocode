//! Eventos reais dos agentes. O Claude Code grava cada sessão num histórico `.jsonl` em
//! `<pasta da conta>/projects/<pasta do projeto codificada>/` enquanto trabalha (e os
//! subagentes em `<sessão>/subagents/agent-*.jsonl`). Aqui só LEMOS esses arquivos, do ponto
//! onde paramos da última vez, e traduzimos cada passo (ler, editar, rodar comando…) num
//! evento para a tela. Nada é escrito, nada muda na configuração do Claude.

use chrono::DateTime;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime};

/// Histórico inicial: só as sessões mexidas nas últimas 24 h, e só o fim delas.
const HISTORY_AGE: Duration = Duration::from_secs(24 * 3600);
const HISTORY_BYTES: u64 = 512 * 1024;
const HISTORY_EVENTS: usize = 60;
/// Num estouro (sessão enorme colada de uma vez), lê no máximo isso por arquivo por vez.
const MAX_CHUNK: u64 = 4 * 1024 * 1024;
const RESCAN_EVERY: Duration = Duration::from_secs(3);

#[derive(Debug, Serialize, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentEvent {
    /// id do tool_use (o resultado chega depois com o mesmo id) ou do bloco da mensagem
    pub id: String,
    pub session: String,
    pub account: String,
    /// subagente (agent-…), se não for a sessão principal
    pub sub: Option<String>,
    pub sub_label: Option<String>,
    /// user, say, read, search, edit, create, run, web, tool, swarm, plan, done, result
    pub kind: String,
    pub title: String,
    pub detail: Option<String>,
    /// caminho relativo ao projeto, quando o passo mexe num arquivo de dentro dele
    pub path: Option<String>,
    /// running, ok, error
    pub status: String,
    /// resultado de comando: últimas linhas da saída
    pub output: Vec<String>,
    pub ts: i64,
    pub history: bool,
    /// pedido da pessoa: de onde a conversa recomeça se ele for editado ("" = do começo)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anchor: Option<String>,
}

struct Tail {
    offset: u64,
    session: String,
    account: String,
    sub: Option<String>,
    sub_label: Option<String>,
}

pub struct Watch {
    root: PathBuf,
    /// (id da conta, pasta `projects/<codificada>`) de cada conta do Claude
    dirs: Vec<(String, PathBuf)>,
    tails: HashMap<PathBuf, Tail>,
    last_scan: Instant,
    /// a primeira leitura já aconteceu (antes dela, o que existe vira histórico)
    started: bool,
    /// tool_use id → nome da ferramenta (para entender o resultado)
    tools: HashMap<String, String>,
}

/// O Claude Code troca tudo que não é letra ou número por '-'.
pub fn encode(path: &Path) -> String {
    path.to_string_lossy().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect()
}

fn mtime(p: &Path) -> Option<SystemTime> {
    fs::metadata(p).ok()?.modified().ok()
}

/// Todos os históricos (principais e de subagentes) que pertencem a `root`.
fn session_files(dirs: &[(String, PathBuf)]) -> Vec<(String, PathBuf, Option<String>)> {
    let mut out = vec![];
    for (acc, dir) in dirs {
        let Ok(rd) = fs::read_dir(dir) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().is_some_and(|x| x == "jsonl") {
                out.push((acc.clone(), p, None));
            } else if p.is_dir() {
                let subs = p.join("subagents");
                if let Ok(rd) = fs::read_dir(&subs) {
                    for s in rd.flatten() {
                        let sp = s.path();
                        if sp.extension().is_some_and(|x| x == "jsonl") {
                            let id = sp.file_stem().map(|x| x.to_string_lossy().to_string());
                            out.push((acc.clone(), sp, id));
                        }
                    }
                }
            }
        }
    }
    out
}

fn sub_label(file: &Path) -> Option<String> {
    let meta = file.with_extension("meta.json");
    let v: Value = serde_json::from_str(&fs::read_to_string(meta).ok()?).ok()?;
    v.get("description").and_then(Value::as_str).map(String::from)
}

fn session_of(file: &Path, sub: &Option<String>) -> String {
    // principal: <sessão>.jsonl; subagente: <sessão>/subagents/agent-x.jsonl
    let p = if sub.is_some() { file.parent().and_then(Path::parent) } else { Some(file) };
    p.and_then(|p| p.file_stem()).map(|s| s.to_string_lossy().chars().take(8).collect()).unwrap_or_default()
}

/// Lê de `offset` até a última quebra de linha completa (linha pela metade fica para depois).
fn read_from(file: &Path, offset: u64, max: u64) -> Option<(String, u64)> {
    let mut f = File::open(file).ok()?;
    let len = f.metadata().ok()?.len();
    if len <= offset {
        return Some((String::new(), len.min(offset)));
    }
    let start = if len - offset > max { len - max } else { offset };
    f.seek(SeekFrom::Start(start)).ok()?;
    let mut buf = Vec::with_capacity((len - start) as usize);
    f.take(len - start).read_to_end(&mut buf).ok()?;
    let end = buf.iter().rposition(|&b| b == b'\n').map(|i| i + 1).unwrap_or(0);
    let mut text = String::from_utf8_lossy(&buf[..end]).to_string();
    if start != offset {
        // pulou para o meio de uma linha: descarta até a primeira quebra
        text = text.split_once('\n').map(|(_, r)| r.to_string()).unwrap_or_default();
    }
    Some((text, start + end as u64))
}

impl Watch {
    pub fn new(root: PathBuf, accounts: Vec<(String, PathBuf)>) -> Self {
        let enc = encode(&root);
        let dirs = accounts.into_iter().map(|(id, cfg)| (id, cfg.join("projects").join(&enc))).collect();
        Self { root, dirs, tails: HashMap::new(), last_scan: Instant::now() - RESCAN_EVERY * 2, started: false, tools: HashMap::new() }
    }

    /// Primeira chamada: devolve o fim das sessões recentes (marcado `history`) e passa a
    /// acompanhar. Depois: só o que é novo.
    pub fn poll(&mut self) -> Vec<AgentEvent> {
        let first = !self.started;
        self.started = true;
        if self.tools.len() > 5000 {
            self.tools.clear(); // ferramentas que nunca tiveram resultado (sessão interrompida)
        }
        let mut out = vec![];
        if first || self.last_scan.elapsed() >= RESCAN_EVERY {
            self.last_scan = Instant::now();
            let now = SystemTime::now();
            for (acc, file, sub) in session_files(&self.dirs) {
                if self.tails.contains_key(&file) {
                    continue;
                }
                let len = fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
                let recent = mtime(&file).and_then(|m| now.duration_since(m).ok()).is_some_and(|d| d < HISTORY_AGE);
                // no começo: arquivos recentes mostram o fim como histórico; os velhos ficam quietos.
                // depois: arquivo que apareceu agora é sessão nova → lê desde o começo.
                let offset = if first { if recent { len.saturating_sub(HISTORY_BYTES) } else { len } } else { 0 };
                let tail = Tail { offset, session: session_of(&file, &sub), account: acc, sub_label: sub.as_ref().and_then(|_| sub_label(&file)), sub };
                self.tails.insert(file, tail);
            }
        }

        let files: Vec<PathBuf> = self.tails.keys().cloned().collect();
        for file in files {
            let offset = self.tails[&file].offset;
            let len = fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
            if len <= offset {
                continue;
            }
            // histórico: começa pelos últimos 512 KB e vai aumentando (linhas com capturas de
            // tela são enormes) até achar passos suficientes, chegar ao início ou a 32 MB
            let mut start = offset;
            let mut found = None;
            loop {
                let max = if first { len - start } else { MAX_CHUNK };
                let Some((text, end)) = read_from(&file, start, max) else { break };
                let evs = self.parse_text(&file, &text, first && start > 0, first);
                let window = len - start;
                let steps = evs.iter().filter(|e| e.kind != "result" && e.kind != "think").count();
                let done = !first || start == 0 || steps >= HISTORY_EVENTS || window >= 32 * 1024 * 1024;
                found = Some((evs, end));
                if done {
                    break;
                }
                start = len.saturating_sub(window * 4);
            }
            let Some((evs, end)) = found else { continue };
            if let Some(t) = self.tails.get_mut(&file) {
                t.offset = end;
            }
            out.extend(evs);
        }
        out.sort_by_key(|e| e.ts);
        if first {
            // histórico: só o fim (contando passos que viram linha na tela), sem "pensando",
            // e nada fica "rodando" para sempre
            out.retain(|e| e.kind != "think");
            let mut visible = 0;
            let mut cut_at = 0;
            for (i, e) in out.iter().enumerate().rev() {
                if e.kind != "result" {
                    visible += 1;
                }
                if visible > HISTORY_EVENTS {
                    cut_at = i + 1;
                    break;
                }
            }
            out.drain(..cut_at);
            for e in &mut out {
                if e.status == "running" {
                    e.status = "ok".into();
                }
            }
        }
        out
    }
}

impl Watch {
    /// `skip_first`: o texto começa no meio do arquivo, a 1ª linha pode estar cortada.
    fn parse_text(&mut self, file: &Path, text: &str, skip_first: bool, history: bool) -> Vec<AgentEvent> {
        let Some(t) = self.tails.get(file) else { return vec![] };
        let ctx = Ctx { session: &t.session, account: &t.account, sub: &t.sub, sub_label: &t.sub_label, root: &self.root, history };
        let mut out = vec![];
        for (i, line) in text.lines().enumerate() {
            if skip_first && i == 0 {
                continue;
            }
            if let Ok(v) = serde_json::from_str::<Value>(line) {
                out.extend(parse_line(&v, &ctx, &mut self.tools));
            }
        }
        out
    }
}

/// Entradas do ramo atual da conversa: do fim para trás pelo `parentUuid`. Um pedido editado
/// no Veocode deixa o ramo antigo no arquivo; ele não aparece de novo ao reabrir.
fn active_branch(lines: &[Value]) -> Option<std::collections::HashSet<String>> {
    let main = |v: &&Value| v.get("isSidechain").and_then(Value::as_bool) != Some(true);
    let parent: HashMap<&str, Option<&str>> = lines
        .iter()
        .filter(main)
        .filter_map(|v| {
            let u = v.get("uuid").and_then(Value::as_str)?;
            let p = v.get("parentUuid").and_then(Value::as_str).or_else(|| v.get("logicalParentUuid").and_then(Value::as_str));
            Some((u, p))
        })
        .collect();
    // sem ramo (nenhuma entrada com dois filhos): mostra tudo como sempre
    let mut kids: HashMap<&str, usize> = HashMap::new();
    for p in parent.values().flatten() {
        *kids.entry(p).or_default() += 1;
    }
    if !kids.values().any(|n| *n > 1) {
        return None;
    }
    let mut keep = std::collections::HashSet::new();
    // começa da última mensagem de verdade (entradas de sistema podem ficar penduradas de lado)
    let msg = |v: &&Value| matches!(v.get("type").and_then(Value::as_str), Some("user" | "assistant"));
    let mut cur = lines.iter().rev().filter(main).filter(msg).find_map(|v| v.get("uuid").and_then(Value::as_str));
    while let Some(u) = cur {
        if !keep.insert(u.to_string()) {
            break;
        }
        cur = parent.get(u).copied().flatten();
    }
    // subagentes e entradas de sistema que não são mensagens ficam como estavam
    for v in lines.iter().filter(|v| !main(v) || !msg(v)) {
        if let Some(u) = v.get("uuid").and_then(Value::as_str) {
            keep.insert(u.to_string());
        }
    }
    Some(keep)
}

/// Uma sessão inteira (só a principal) para mostrar ao retomar a conversa: lê do fim para
/// trás até juntar `max_steps` passos visíveis, chegar ao início ou a 32 MB.
pub fn read_session(root: &Path, account: &str, file: &Path, max_steps: usize) -> Vec<AgentEvent> {
    let len = fs::metadata(file).map(|m| m.len()).unwrap_or(0);
    let session = session_of(file, &None);
    let ctx = Ctx { session: &session, account, sub: &None, sub_label: &None, root, history: true };
    let mut window = HISTORY_BYTES.min(len);
    let mut out = vec![];
    loop {
        let start = len - window;
        let Some((text, _)) = read_from(file, start, window) else { break };
        let mut tools = HashMap::new();
        let lines: Vec<Value> = text.lines().skip(usize::from(start > 0)).filter_map(|l| serde_json::from_str::<Value>(l).ok()).collect();
        let keep = active_branch(&lines);
        out = lines
            .iter()
            .filter(|v| match (&keep, v.get("uuid").and_then(Value::as_str)) {
                (Some(k), Some(u)) => k.contains(u),
                _ => true,
            })
            .flat_map(|v| parse_line(v, &ctx, &mut tools))
            .filter(|e| e.kind != "think")
            .collect();
        let steps = out.iter().filter(|e| e.kind != "result").count();
        if start == 0 || steps >= max_steps || window >= 32 * 1024 * 1024 {
            break;
        }
        window = (window * 4).min(len);
    }
    let mut visible = 0;
    let mut cut_at = 0;
    for (i, e) in out.iter().enumerate().rev() {
        if e.kind != "result" {
            visible += 1;
        }
        if visible > max_steps {
            cut_at = i + 1;
            break;
        }
    }
    out.drain(..cut_at);
    for e in &mut out {
        if e.status == "running" {
            e.status = "ok".into();
        }
    }
    out
}

/// Passos de uma linha da saída do `claude -p` (Chat livre, que não tem histórico acompanhado):
/// só ferramentas e seus resultados; o texto o chat já mostra sozinho.
pub fn stream_steps(v: &Value, account: &str, root: &Path, tools: &mut HashMap<String, String>) -> Vec<AgentEvent> {
    if v.get("parent_tool_use_id").is_some_and(|p| !p.is_null()) {
        return vec![]; // subagente
    }
    let mut v = v.clone();
    // a saída do -p traz o resultado da ferramenta em snake_case
    if let (None, Some(r)) = (v.get("toolUseResult"), v.get("tool_use_result").cloned()) {
        v["toolUseResult"] = r;
    }
    let ctx = Ctx { session: "", account, sub: &None, sub_label: &None, root, history: false };
    let now = chrono::Utc::now().timestamp_millis();
    parse_line(&v, &ctx, tools)
        .into_iter()
        .filter(|e| !matches!(e.kind.as_str(), "user" | "say" | "think" | "done"))
        .map(|mut e| {
            if e.ts == 0 {
                e.ts = now;
            }
            e
        })
        .collect()
}

pub(crate) fn noise(text: &str) -> bool {
    is_noise(text)
}

struct Ctx<'a> {
    session: &'a str,
    account: &'a str,
    sub: &'a Option<String>,
    sub_label: &'a Option<String>,
    root: &'a Path,
    history: bool,
}

fn s<'a>(v: &'a Value, k: &str) -> Option<&'a str> {
    v.get(k).and_then(Value::as_str)
}

fn cut(text: &str, n: usize) -> String {
    let t = text.trim().replace(['\n', '\r', '\t'], " ");
    if t.chars().count() > n {
        format!("{}…", t.chars().take(n).collect::<String>())
    } else {
        t
    }
}

/// Caminho relativo ao projeto (aceita /tmp ↔ /private/tmp e sessões abertas numa subpasta).
fn relative(root: &Path, file: &str, cwd: Option<&str>) -> Option<String> {
    let f = Path::new(file);
    let f = if f.is_absolute() { f.to_path_buf() } else { Path::new(cwd?).join(f) };
    if let Ok(r) = f.strip_prefix(root) {
        return Some(r.to_string_lossy().replace('\\', "/")).filter(|s| !s.is_empty());
    }
    // a pasta do arquivo pode existir com outro nome (link simbólico)
    let parent = f.parent()?.canonicalize().ok()?;
    let r = parent.join(f.file_name()?);
    r.strip_prefix(root).ok().map(|r| r.to_string_lossy().replace('\\', "/"))
}

fn pretty(file: &str) -> String {
    let home = crate::xray::util::home();
    match Path::new(file).strip_prefix(&home) {
        Ok(r) => format!("~/{}", r.display()),
        Err(_) => file.into(),
    }
}

fn lines_detail(n: Option<u64>) -> Option<String> {
    n.map(|n| if n == 1 { "1 linha".into() } else { format!("{n} linhas") })
}

/// "+12 −3" a partir do structuredPatch do Edit/Write.
fn patch_detail(r: &Value) -> Option<String> {
    let hunks = r.get("structuredPatch")?.as_array()?;
    let (mut add, mut del) = (0, 0);
    for h in hunks {
        for l in h.get("lines").and_then(Value::as_array).into_iter().flatten() {
            match l.as_str().and_then(|x| x.chars().next()) {
                Some('+') => add += 1,
                Some('-') => del += 1,
                _ => {}
            }
        }
    }
    Some(format!("+{add} −{del}"))
}

/// "39.9k → 9.8k" (tamanho da conversa antes e depois de compactar).
pub fn compact_detail(before: Option<u64>, after: Option<u64>) -> Option<String> {
    let k = |n: u64| if n >= 1000 { format!("{}k", crate::i18n::dec(&format!("{:.1}", n as f64 / 1000.0))) } else { n.to_string() };
    match (before, after) {
        (Some(b), Some(a)) => Some(format!("{} → {}", k(b), k(a))),
        (Some(b), None) => Some(k(b)),
        _ => None,
    }
}

fn is_noise(text: &str) -> bool {
    let t = text.trim_start();
    t.is_empty()
        || t.starts_with("<command-")
        || t.starts_with("<local-command")
        || t.starts_with("<system-reminder")
        || t.starts_with("<task-notification")
        || t.starts_with("Caveat:")
        || t.starts_with("[Request interrupted")
}

fn parse_line(v: &Value, c: &Ctx, tools: &mut HashMap<String, String>) -> Vec<AgentEvent> {
    let ty = s(v, "type").unwrap_or("");
    // conversa compactada: vira uma linha "antes → depois" (o resumo que o Claude escreve fica de fora)
    if ty == "system" && s(v, "subtype") == Some("compact_boundary") && c.sub.is_none() {
        let ts = s(v, "timestamp").and_then(|t| DateTime::parse_from_rfc3339(t).ok()).map(|t| t.timestamp_millis()).unwrap_or(0);
        let m = v.get("compactMetadata");
        let n = |k: &str| m.and_then(|m| m.get(k)).and_then(Value::as_u64);
        return vec![AgentEvent {
            id: s(v, "uuid").unwrap_or("").into(),
            session: c.session.into(),
            account: c.account.into(),
            kind: "compact".into(),
            title: s(m.unwrap_or(&Value::Null), "trigger").unwrap_or("manual").into(),
            detail: compact_detail(n("preTokens"), n("postTokens")),
            status: "ok".into(),
            ts,
            history: c.history,
            ..Default::default()
        }];
    }
    if ty != "user" && ty != "assistant" {
        return vec![];
    }
    if v.get("isMeta").and_then(Value::as_bool) == Some(true) || v.get("isCompactSummary").and_then(Value::as_bool) == Some(true) {
        return vec![];
    }
    let ts = s(v, "timestamp").and_then(|t| DateTime::parse_from_rfc3339(t).ok()).map(|t| t.timestamp_millis()).unwrap_or(0);
    let cwd = s(v, "cwd");
    let uuid = s(v, "uuid").unwrap_or("");
    let base = AgentEvent {
        session: c.session.into(),
        account: c.account.into(),
        sub: c.sub.clone(),
        sub_label: c.sub_label.clone(),
        status: "ok".into(),
        ts,
        history: c.history,
        ..Default::default()
    };
    let msg = v.get("message").cloned().unwrap_or(Value::Null);
    let content = msg.get("content");
    let mut out = vec![];

    // ------------------------------------------------ pedido da pessoa e resultados
    if ty == "user" {
        let anchor = Some(s(v, "parentUuid").unwrap_or("").to_string());
        if let Some(text) = content.and_then(Value::as_str) {
            if !is_noise(text) && c.sub.is_none() {
                out.push(AgentEvent { id: uuid.into(), kind: "user".into(), title: cut(text, 400), anchor, ..base.clone() });
            }
            return out;
        }
        for (i, b) in content.and_then(Value::as_array).into_iter().flatten().enumerate() {
            match s(b, "type") {
                Some("text") if c.sub.is_none() => {
                    let t = s(b, "text").unwrap_or("");
                    if !is_noise(t) {
                        out.push(AgentEvent { id: format!("{uuid}:{i}"), kind: "user".into(), title: cut(t, 400), anchor: anchor.clone(), ..base.clone() });
                    }
                }
                Some("tool_result") => {
                    let id = s(b, "tool_use_id").unwrap_or("").to_string();
                    let name = tools.remove(&id).unwrap_or_default();
                    let r = v.get("toolUseResult").cloned().unwrap_or(Value::Null);
                    let error = b.get("is_error").and_then(Value::as_bool) == Some(true);
                    let mut e = AgentEvent { id, kind: "result".into(), status: if error { "error".into() } else { "ok".into() }, ..base.clone() };
                    match name.as_str() {
                        "Read" => e.detail = lines_detail(r.pointer("/file/numLines").and_then(Value::as_u64)),
                        "Edit" | "MultiEdit" | "NotebookEdit" => e.detail = patch_detail(&r),
                        "Write" => {
                            e.detail = if s(&r, "type") == Some("create") {
                                e.title = "create".into(); // o front troca o tipo para "criado"
                                lines_detail(s(&r, "content").map(|c| c.lines().count() as u64))
                            } else {
                                patch_detail(&r)
                            }
                        }
                        "Grep" | "Glob" => {
                            let n = r.get("numFiles").and_then(Value::as_u64).or_else(|| r.get("filenames").and_then(Value::as_array).map(|a| a.len() as u64));
                            e.detail = n.map(|n| if n == 1 { crate::i18n::tr("1 arquivo", "1 file").into() } else { crate::trf!("{n} arquivos", "{n} files") });
                        }
                        "Bash" => {
                            let mut all = String::new();
                            for k in ["stdout", "stderr"] {
                                if let Some(x) = s(&r, k).filter(|x| !x.trim().is_empty()) {
                                    all.push_str(x);
                                    all.push('\n');
                                }
                            }
                            let lines: Vec<String> = all.lines().filter(|l| !l.trim().is_empty()).map(|l| cut(l, 200)).collect();
                            e.output = lines[lines.len().saturating_sub(12)..].to_vec();
                            e.detail = Some(if r.get("interrupted").and_then(Value::as_bool) == Some(true) {
                                "interrompido".into()
                            } else if error {
                                "falhou".into()
                            } else if lines.is_empty() {
                                "ok".into()
                            } else {
                                crate::trf!("{} linha(s) de saída", "{} line(s) of output", lines.len())
                            });
                        }
                        _ => {
                            if error {
                                e.detail = Some("falhou".into());
                            }
                        }
                    }
                    out.push(e);
                }
                _ => {}
            }
        }
        return out;
    }

    // ------------------------------------------------ o agente
    let blocks = content.and_then(Value::as_array).cloned().unwrap_or_default();
    for (i, b) in blocks.iter().enumerate() {
        let bid = format!("{uuid}:{i}");
        match s(b, "type") {
            Some("text") => {
                let t = s(b, "text").unwrap_or("");
                if !t.trim().is_empty() {
                    out.push(AgentEvent { id: bid, kind: "say".into(), title: cut(t, 600), ..base.clone() });
                }
            }
            Some("thinking") => out.push(AgentEvent { id: bid, kind: "think".into(), title: "Pensando".into(), ..base.clone() }),
            Some("tool_use") => {
                let name = s(b, "name").unwrap_or("").to_string();
                let id = s(b, "id").unwrap_or(&bid).to_string();
                let input = b.get("input").cloned().unwrap_or(Value::Null);
                tools.insert(id.clone(), name.clone());
                let file = s(&input, "file_path").or_else(|| s(&input, "notebook_path"));
                let rel = file.and_then(|f| relative(c.root, f, cwd));
                let shown = |f: &str| rel.clone().unwrap_or_else(|| pretty(f));
                let mut e = AgentEvent { id, status: "running".into(), path: rel.clone(), ..base.clone() };
                match name.as_str() {
                    "Read" => (e.kind, e.title) = ("read".into(), crate::trf!("Lendo {}", "Reading {}", shown(file.unwrap_or("?")))),
                    "Edit" | "MultiEdit" | "NotebookEdit" => (e.kind, e.title) = ("edit".into(), format!("Editando {}", shown(file.unwrap_or("?")))),
                    "Write" => (e.kind, e.title) = ("edit".into(), format!("Escrevendo {}", shown(file.unwrap_or("?")))),
                    "Grep" => {
                        e.kind = "search".into();
                        e.title = format!("Buscando “{}”", cut(s(&input, "pattern").unwrap_or(""), 60));
                        let p = s(&input, "path");
                        e.path = p.and_then(|p| relative(c.root, p, cwd));
                        e.detail = p.map(|p| e.path.clone().unwrap_or_else(|| pretty(p))).or_else(|| s(&input, "glob").map(String::from));
                    }
                    "Glob" => {
                        e.kind = "search".into();
                        e.title = format!("Procurando {}", cut(s(&input, "pattern").unwrap_or(""), 60));
                        e.path = s(&input, "path").and_then(|p| relative(c.root, p, cwd));
                    }
                    "Bash" | "PowerShell" => {
                        let cmd = s(&input, "command").unwrap_or("");
                        e.kind = "run".into();
                        e.title = s(&input, "description").map(|d| cut(d, 90)).unwrap_or_else(|| cut(cmd, 90));
                        e.detail = Some(cut(cmd, 300));
                    }
                    "WebFetch" => {
                        let url = s(&input, "url").unwrap_or("");
                        let host = url.split("://").nth(1).and_then(|r| r.split('/').next()).unwrap_or(url);
                        (e.kind, e.title) = ("web".into(), format!("Abrindo {host}"));
                    }
                    "WebSearch" => (e.kind, e.title) = ("web".into(), format!("Pesquisando “{}”", cut(s(&input, "query").unwrap_or(""), 60))),
                    "Agent" | "Task" => {
                        e.kind = "swarm".into();
                        e.title = format!("Subagente: {}", cut(s(&input, "description").unwrap_or("tarefa"), 70));
                        e.detail = s(&input, "subagent_type").map(String::from);
                    }
                    "TodoWrite" | "mcp__ccd_turn__update_plan" => (e.kind, e.title) = ("plan".into(), crate::i18n::tr("Atualizou a lista de tarefas", "Updated the task list").into()),
                    "Skill" => (e.kind, e.title) = ("tool".into(), format!("Skill {}", s(&input, "skill").unwrap_or("?"))),
                    n if n.starts_with("mcp__") => {
                        let mut parts = n.trim_start_matches("mcp__").splitn(2, "__");
                        let server = parts.next().unwrap_or("");
                        let tool = parts.next().unwrap_or("");
                        (e.kind, e.title) = ("tool".into(), format!("MCP {server} · {tool}"));
                    }
                    n => (e.kind, e.title) = ("tool".into(), n.to_string()),
                }
                out.push(e);
            }
            _ => {}
        }
    }
    // a mesma resposta pode vir em várias linhas (o "pensando" numa, o texto noutra), todas com
    // end_turn: só uma vira "Terminou", e nunca a linha que só tem o pensamento (vem antes do texto)
    let only_thinking = !blocks.is_empty() && blocks.iter().all(|b| s(b, "type") == Some("thinking"));
    if s(&msg, "stop_reason") == Some("end_turn") && c.sub.is_none() && !only_thinking {
        let mid = s(&msg, "id").unwrap_or(uuid).to_string();
        if tools.insert(format!("done:{mid}"), String::new()).is_none() {
            out.push(AgentEvent { id: format!("{mid}:done"), kind: "done".into(), title: "Terminou".into(), ..base });
        }
    }
    out
}

// ---------------------------------------------------------------- testes

#[cfg(test)]
mod tests {

    #[test]
    fn active_branch_skips_edited_turns() {
        let l = |u: &str, p: Option<&str>| serde_json::json!({"type":"user","uuid":u,"parentUuid":p});
        // a → b → c (velho)  e  a → b → d → e (editado)
        let lines = vec![l("a", None), l("b", Some("a")), l("c", Some("b")), l("d", Some("b")), l("e", Some("d"))];
        let keep = super::active_branch(&lines).unwrap();
        assert!(keep.contains("a") && keep.contains("b") && keep.contains("d") && keep.contains("e"));
        assert!(!keep.contains("c"));
    }

    use super::*;
    use std::io::Write;

    fn line(v: serde_json::Value) -> String {
        format!("{v}\n")
    }

    #[test]
    fn encodes_like_claude() {
        assert_eq!(encode(Path::new("/Users/ana/Documents/VSCode/Veocode")), "-Users-ana-Documents-VSCode-Veocode");
        assert_eq!(encode(Path::new("/tmp/a_b.c")), "-tmp-a-b-c");
    }

    #[test]
    fn reads_a_whole_session_to_resume() {
        let base = std::env::temp_dir().join(format!("veocode-agent-read-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        let root = base.canonicalize().unwrap();
        let r = root.to_string_lossy().to_string();
        let f = root.join("abcdef12-1111.jsonl");
        let mut text = String::new();
        for i in 0..30 {
            text += &line(serde_json::json!({"type":"user","uuid":format!("u{i}"),"timestamp":"2026-11-17T10:00:00Z","cwd":r,"message":{"role":"user","content":format!("pedido {i}")}}));
            text += &line(serde_json::json!({"type":"assistant","uuid":format!("a{i}"),"timestamp":"2026-11-17T10:00:01Z","cwd":r,"message":{"content":[
                {"type":"thinking","thinking":"..."},
                {"type":"tool_use","id":format!("t{i}"),"name":"Read","input":{"file_path":format!("{r}/a.rs")}}]}}));
        }
        fs::write(&f, &text).unwrap();
        let e = read_session(&root, "conta", &f, 10);
        // só os 10 últimos passos visíveis, sem "pensando", nada fica rodando
        assert_eq!(e.len(), 10);
        assert_eq!(e[0].title, "pedido 25");
        assert_eq!(e.last().unwrap().kind, "read");
        assert!(e.iter().all(|x| x.history && x.status == "ok" && x.kind != "think" && x.session == "abcdef12"));

        // resposta com pensamento: duas linhas da mesma mensagem com end_turn → um "Terminou" só
        for (u, block) in [("z1", serde_json::json!({"type":"thinking","thinking":"..."})), ("z2", serde_json::json!({"type":"text","text":"pronto"}))] {
            text += &line(serde_json::json!({"type":"assistant","uuid":u,"timestamp":"2026-11-17T10:00:02Z","cwd":r,"message":{"id":"msg-z","stop_reason":"end_turn","content":[block]}}));
        }
        fs::write(&f, &text).unwrap();
        let e = read_session(&root, "conta", &f, 3);
        let kinds: Vec<&str> = e.iter().map(|x| x.kind.as_str()).collect();
        assert_eq!(kinds, ["read", "say", "done"]);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn follows_a_session_live() {
        let base = std::env::temp_dir().join(format!("veocode-agent-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let root = base.join("proj");
        fs::create_dir_all(root.join("src")).unwrap();
        let root = root.canonicalize().unwrap();
        let cfg = base.join("cfg");
        let dir = cfg.join("projects").join(encode(&root));
        fs::create_dir_all(&dir).unwrap();
        let f = dir.join("abcdef12-0000.jsonl");
        let r = root.to_string_lossy().to_string();

        // sessão antiga já existente: vira histórico
        fs::write(&f, line(serde_json::json!({"type":"user","uuid":"u1","timestamp":"2026-11-17T10:00:00Z","cwd":r,"message":{"role":"user","content":"arruma o bug"}}))).unwrap();
        let mut w = Watch::new(root.clone(), vec![("conta".into(), cfg.clone())]);
        let h = w.poll();
        assert_eq!(h.len(), 1);
        assert!(h[0].history && h[0].kind == "user" && h[0].title == "arruma o bug");
        assert!(w.poll().is_empty());

        // o agente lê, edita e roda um comando; linha pela metade fica para depois
        let mut fh = fs::OpenOptions::new().append(true).open(&f).unwrap();
        let read = line(serde_json::json!({"type":"assistant","uuid":"a1","timestamp":"2026-11-17T10:00:01Z","cwd":r,"message":{"id":"m1","content":[
            {"type":"text","text":"Vou olhar."},
            {"type":"tool_use","id":"t1","name":"Read","input":{"file_path":format!("{r}/src/main.rs")}},
            {"type":"tool_use","id":"t2","name":"Bash","input":{"command":"cargo test","description":"Rodando os testes"}}]}}));
        fh.write_all(read.as_bytes()).unwrap();
        let half = line(serde_json::json!({"type":"user","uuid":"u2","timestamp":"2026-11-17T10:00:02Z","cwd":r,
            "toolUseResult":{"file":{"numLines":42}},
            "message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"..."}]}}));
        fh.write_all(&half.as_bytes()[..20]).unwrap();
        fh.flush().unwrap();

        let e = w.poll();
        let kinds: Vec<&str> = e.iter().map(|x| x.kind.as_str()).collect();
        assert_eq!(kinds, ["say", "read", "run"]);
        assert_eq!(e[1].path.as_deref(), Some("src/main.rs"));
        assert_eq!(e[1].status, "running");
        assert!(!e[1].history);
        assert_eq!(e[2].title, "Rodando os testes");

        fh.write_all(&half.as_bytes()[20..]).unwrap();
        fh.write_all(line(serde_json::json!({"type":"user","uuid":"u3","timestamp":"2026-11-17T10:00:03Z","cwd":r,
            "toolUseResult":{"stdout":"running 3 tests\ntest result: ok","stderr":""},
            "message":{"content":[{"type":"tool_result","tool_use_id":"t2","content":"..."}]}})).as_bytes()).unwrap();
        fh.write_all(line(serde_json::json!({"type":"assistant","uuid":"a2","timestamp":"2026-11-17T10:00:04Z","cwd":r,
            "message":{"id":"m2","stop_reason":"end_turn","content":[{"type":"text","text":"Pronto."}]}})).as_bytes()).unwrap();
        fh.flush().unwrap();
        let e = w.poll();
        assert_eq!(e[0].kind, "result");
        assert_eq!((e[0].id.as_str(), e[0].detail.as_deref()), ("t1", Some("42 linhas")));
        assert_eq!(e[1].output, vec!["running 3 tests", "test result: ok"]);
        assert_eq!(e.last().unwrap().kind, "done");

        // subagente que nasce depois: lido desde o começo, com o rótulo do meta.json
        let subs = dir.join("abcdef12-0000").join("subagents");
        fs::create_dir_all(&subs).unwrap();
        fs::write(subs.join("agent-x1.meta.json"), r#"{"description":"Procurar usos"}"#).unwrap();
        fs::write(subs.join("agent-x1.jsonl"), line(serde_json::json!({"type":"assistant","uuid":"s1","timestamp":"2026-11-17T10:00:05Z","cwd":r,
            "message":{"content":[{"type":"tool_use","id":"t9","name":"Grep","input":{"pattern":"todo","path":format!("{r}/src")}}]}}))).unwrap();
        w.last_scan = Instant::now() - RESCAN_EVERY * 2;
        let e = w.poll();
        assert_eq!(e.len(), 1);
        assert_eq!(e[0].sub.as_deref(), Some("agent-x1"));
        assert_eq!(e[0].sub_label.as_deref(), Some("Procurar usos"));
        assert_eq!(e[0].session, "abcdef12");
        assert_eq!(e[0].path.as_deref(), Some("src"));
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn ignores_noise_and_outside_paths() {
        let ctx_root = Path::new("/p/proj");
        let c = Ctx { session: "s", account: "a", sub: &None, sub_label: &None, root: ctx_root, history: false };
        let mut tools = HashMap::new();
        let v = serde_json::json!({"type":"user","uuid":"u","message":{"content":"<command-name>/clear</command-name>"}});
        assert!(parse_line(&v, &c, &mut tools).is_empty());
        let v = serde_json::json!({"type":"assistant","uuid":"a","message":{"content":[{"type":"tool_use","id":"t","name":"Read","input":{"file_path":"/etc/hosts"}}]}});
        let e = parse_line(&v, &c, &mut tools);
        assert_eq!(e[0].path, None);
        assert_eq!(e[0].title, "Lendo /etc/hosts");
    }
}

#[cfg(test)]
mod real {
    use super::*;

    /// cargo test real_agent_events -- --ignored --nocapture (lê os históricos de verdade)
    #[test]
    #[ignore]
    fn real_agent_events() {
        let root = std::env::current_dir().unwrap().parent().unwrap().canonicalize().unwrap();
        let cfg = crate::xray::util::home().join(".claude");
        let mut w = Watch::new(root, vec![("principal".into(), cfg)]);
        let t = Instant::now();
        let h = w.poll();
        println!("histórico: {} eventos em {:?}", h.len(), t.elapsed());
        for e in h.iter().rev().take(12).rev() {
            println!("  {:7} {:8} {:60} {:?} {:?}", e.kind, e.status, e.title.chars().take(60).collect::<String>(), e.path, e.detail.as_deref().map(|d| d.chars().take(30).collect::<String>()));
        }
        let t = Instant::now();
        let n = w.poll();
        println!("2ª leitura: {} eventos em {:?}", n.len(), t.elapsed());
    }
}
