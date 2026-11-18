//! Chat dentro do Veocode.
//!
//! Claude: roda o próprio Claude Code sem terminal (`claude -p` com entrada e saída em
//! stream-json), na pasta do projeto e com a conta do projeto. O nível de acesso vai junto
//! (`--permission-mode` + `--settings` com as regras), e o que o nível manda PERGUNTAR chega
//! aqui como pedido de permissão (`can_use_tool`) para a pessoa aprovar na tela. Os passos
//! (ler, editar, comandos) a tela já recebe pelo histórico (agent.rs); daqui saem o texto
//! sendo escrito, os pedidos de permissão e o fim de cada resposta.
//!
//! DeepSeek, APIs compatíveis com OpenAI e Ollama: o laço de apiagent.rs, com as ferramentas
//! do Veocode (ler, buscar, editar, comandos) obedecendo o mesmo nível de acesso. Os passos
//! saem daqui como eventos no mesmo formato dos do Claude.

use crate::access::Rule;
use crate::accounts::{Account, Provider};
use crate::agent::AgentEvent;
use crate::apiagent;
use crate::convos;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase", tag = "kind")]
pub enum ChatEvent {
    /// sessão do Claude começou (id para continuar depois)
    Session { session_id: String },
    /// pedaço de texto sendo escrito
    Delta { text: String },
    /// bloco de texto completo (`key` casa com o que o histórico do Claude traz depois)
    Say { key: String, text: String },
    /// o Claude quer fazer algo que o nível manda perguntar
    Permission { request_id: String, tool: String, title: String, detail: Option<String>, path: Option<String> },
    /// a pessoa (ou a parada) já respondeu esse pedido
    PermissionGone { request_id: String },
    /// fim da resposta
    Done { ok: bool, detail: Option<String> },
    /// passo de ferramenta das contas por API (mesmo formato dos passos do Claude)
    Step { event: AgentEvent },
    Error { message: String },
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Envelope {
    project_id: String,
    #[serde(flatten)]
    event: ChatEvent,
}

fn emit(app: &AppHandle, project: &str, event: ChatEvent) {
    if cfg!(debug_assertions) && !matches!(event, ChatEvent::Delta { .. }) {
        eprintln!("[chat] {project} {}", serde_json::to_string(&event).unwrap_or_default().chars().take(200).collect::<String>());
    }
    let _ = app.emit("chat-event", Envelope { project_id: project.into(), event });
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Msg {
    pub role: String,
    pub content: String,
}

struct ClaudeProc {
    child: Child,
    stdin: ChildStdin,
    account: String,
    /// nível com que o processo foi aberto (mudou → reabre continuando a sessão)
    level_key: String,
    /// identifica o processo: o leitor de um processo antigo não mexe no novo
    proc_id: u64,
}

#[derive(Default)]
struct ProjectChat {
    claude: Option<ClaudeProc>,
    /// (conta, sessão) para continuar depois de fechar o processo
    session: Option<(String, String)>,
    /// pedidos de permissão esperando resposta: id → input original
    pending: HashMap<String, Value>,
    busy: Arc<AtomicBool>,
    /// pedidos de permissão das APIs: id → canal da resposta
    api_pending: HashMap<String, mpsc::Sender<bool>>,
    /// conversa com APIs no formato delas (a do Claude fica no histórico dele)
    history: Vec<Value>,
    history_account: String,
    /// id da conversa com API guardada em disco (nasce no 1º pedido)
    api_conv: Option<String>,
    cancel: Arc<AtomicBool>,
    /// Chat livre: passos tirados da própria saída do Claude (não há histórico acompanhado)
    /// — raiz para os caminhos e as ferramentas em andamento
    stream_steps: Option<PathBuf>,
    step_tools: HashMap<String, String>,
}

#[derive(Default)]
pub struct Chats {
    map: Mutex<HashMap<String, ProjectChat>>,
    /// pasta de dados do app (as conversas com APIs ficam em `chats/<projeto>/`)
    data: PathBuf,
}

pub struct SendArgs {
    pub project_id: String,
    pub root: PathBuf,
    pub project_name: String,
    pub account: Account,
    pub text: String,
    /// arquivo anexado: (caminho relativo, conteúdo)
    pub attach: Option<(String, String)>,
    pub level: u8,
    pub overrides: BTreeMap<String, Rule>,
    pub settings: Value,
    /// `--permission-mode` do Claude
    pub mode: &'static str,
    /// pasta extra que o Claude pode ler (`--add-dir`)
    pub add_dir: Option<PathBuf>,
    /// instruções extras (Claude: `--append-system-prompt`; APIs: no lugar das do projeto)
    pub prompt: Option<String>,
    /// ferramentas para as contas por API
    pub tools: bool,
    /// passos saem da saída do Claude (Chat livre)
    pub stream_steps: bool,
}

impl Chats {
    pub fn new(data: PathBuf) -> Self {
        Self { map: Mutex::default(), data }
    }

    pub fn api_dir(&self, project: &str) -> PathBuf {
        convos::api_dir(&self.data, project)
    }

    /// Conversa atual do projeto: ("claude", sessão) ou ("api", id).
    pub fn current(&self, project: &str) -> Option<(String, String)> {
        let m = self.map.lock().ok()?;
        let c = m.get(project)?;
        c.api_conv.clone().map(|id| ("api".to_string(), id)).or_else(|| c.session.as_ref().map(|(_, s)| ("claude".to_string(), s.clone())))
    }

    /// Troca a conversa do projeto (o próximo pedido continua dela). `api`: a conversa guardada.
    pub fn open(&self, project: &str, account: &str, kind: &str, id: &str, api: Option<Vec<Value>>) -> Result<(), String> {
        let mut map = self.map.lock().map_err(|e| e.to_string())?;
        let chat = map.entry(project.to_string()).or_default();
        if chat.busy.load(Ordering::SeqCst) {
            return Err("O agente ainda está respondendo. Espere ou pare antes de trocar de conversa.".into());
        }
        if let Some(mut p) = chat.claude.take() {
            let _ = p.child.kill();
        }
        chat.pending.clear();
        chat.api_pending.clear();
        chat.session = None;
        chat.api_conv = None;
        chat.history.clear();
        chat.history_account = account.to_string();
        if kind == "claude" {
            chat.session = Some((account.to_string(), id.to_string()));
        } else {
            chat.history = api.unwrap_or_default();
            chat.api_conv = Some(id.to_string());
        }
        Ok(())
    }

    pub fn is_busy(&self, project: &str) -> bool {
        self.map.lock().ok().and_then(|m| m.get(project).map(|c| c.busy.load(Ordering::SeqCst))).unwrap_or(false)
    }

    pub fn send(self: &Arc<Self>, app: AppHandle, a: SendArgs) -> Result<(), String> {
        if a.text.trim().is_empty() {
            return Err("mensagem vazia".into());
        }
        match a.account.provider {
            Provider::Claude => self.send_claude(app, a),
            _ => self.send_api(app, a),
        }
    }

    // ------------------------------------------------------------ Claude

    fn send_claude(self: &Arc<Self>, app: AppHandle, a: SendArgs) -> Result<(), String> {
        let mut map = self.map.lock().map_err(|e| e.to_string())?;
        let chat = map.entry(a.project_id.clone()).or_default();
        if chat.busy.load(Ordering::SeqCst) {
            return Err("O Claude ainda está respondendo. Espere ou pare a resposta.".into());
        }
        let level_key = format!("{}:{}:{}:{:?}:{:?}", a.level, a.mode, a.settings, a.add_dir, a.prompt);
        chat.stream_steps = a.stream_steps.then(|| a.root.clone());
        // processo de outra conta ou de outro nível: fecha e abre de novo (a sessão continua
        // se for a mesma conta)
        let stale = chat.claude.as_ref().is_some_and(|p| p.account != a.account.id || p.level_key != level_key);
        let dead = chat.claude.as_mut().is_some_and(|p| p.child.try_wait().ok().flatten().is_some());
        if stale || dead {
            if let Some(mut p) = chat.claude.take() {
                let _ = p.child.kill();
            }
        }
        if chat.session.as_ref().is_some_and(|(acc, _)| acc != &a.account.id) {
            chat.session = None;
        }
        if chat.claude.is_none() {
            let resume = chat.session.as_ref().map(|(_, s)| s.clone());
            let proc_id = NEXT_GEN.fetch_add(1, Ordering::SeqCst);
            let proc = spawn_claude(&a, resume.as_deref(), level_key, proc_id)?;
            chat.claude = Some(proc);
            let stdout = chat.claude.as_mut().unwrap().child.stdout.take().ok_or("sem saída do Claude")?;
            let stderr = chat.claude.as_mut().unwrap().child.stderr.take();
            let me = Arc::clone(self);
            let project = a.project_id.clone();
            let account = a.account.id.clone();
            let busy = chat.busy.clone();
            std::thread::spawn(move || me.read_claude(app, project, account, proc_id, stdout, stderr, busy));
            let p = chat.claude.as_mut().unwrap();
            write_line(&mut p.stdin, &json!({"type":"control_request","request_id":"veocode-init","request":{"subtype":"initialize","hooks":null}}))?;
        }

        let mut text = a.text.clone();
        if let Some((path, content)) = &a.attach {
            text = format!("{text}\n\n(Arquivo aberto no Veocode: {path})");
            let _ = content; // o Claude lê o arquivo sozinho; só avisamos qual é
        }
        let p = chat.claude.as_mut().unwrap();
        chat.busy.store(true, Ordering::SeqCst);
        let r = write_line(&mut p.stdin, &json!({"type":"user","message":{"role":"user","content":text},"parent_tool_use_id":null,"session_id":""}));
        if r.is_err() {
            chat.busy.store(false, Ordering::SeqCst);
        }
        r
    }

    #[allow(clippy::too_many_arguments)]
    fn read_claude(self: Arc<Self>, app: AppHandle, project: String, account: String, proc_id: u64, stdout: impl Read, stderr: Option<impl Read + Send + 'static>, busy: Arc<AtomicBool>) {
        // stderr guardado para explicar se o processo morrer
        let err_tail = Arc::new(Mutex::new(String::new()));
        if let Some(mut se) = stderr {
            let tail = err_tail.clone();
            std::thread::spawn(move || {
                let mut s = String::new();
                let _ = se.read_to_string(&mut s);
                if let Ok(mut t) = tail.lock() {
                    *t = s.chars().rev().take(600).collect::<String>().chars().rev().collect();
                }
            });
        }
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
            for ev in self.handle_claude_line(&project, &account, &v) {
                if matches!(ev, ChatEvent::Done { .. }) {
                    busy.store(false, Ordering::SeqCst);
                }
                emit(&app, &project, ev);
            }
        }
        // processo terminou; se já foi trocado por outro (nível mudou, nova conversa), nada a fazer
        {
            let Ok(mut m) = self.map.lock() else { return };
            let Some(c) = m.get_mut(&project).filter(|c| c.claude.as_ref().map(|p| p.proc_id) == Some(proc_id)) else { return };
            c.claude = None;
            for id in c.pending.drain().map(|(k, _)| k) {
                emit(&app, &project, ChatEvent::PermissionGone { request_id: id });
            }
        }
        if busy.swap(false, Ordering::SeqCst) {
            std::thread::sleep(Duration::from_millis(150));
            let tail = err_tail.lock().map(|t| t.trim().to_string()).unwrap_or_default();
            emit(&app, &project, ChatEvent::Error { message: if tail.is_empty() { "O Claude fechou antes de terminar.".into() } else { explain(&tail) } });
        }
    }

    fn handle_claude_line(&self, project: &str, account: &str, v: &Value) -> Vec<ChatEvent> {
        let ty = v.get("type").and_then(Value::as_str).unwrap_or("");
        let sub = v.get("subtype").and_then(Value::as_str).unwrap_or("");
        match (ty, sub) {
            ("system", "init") => {
                let sid = v.get("session_id").and_then(Value::as_str).unwrap_or("").to_string();
                if let Ok(mut m) = self.map.lock() {
                    if let Some(c) = m.get_mut(project) {
                        c.session = Some((account.into(), sid.clone()));
                    }
                }
                vec![ChatEvent::Session { session_id: sid }]
            }
            ("stream_event", _) => {
                let e = v.get("event").unwrap_or(&Value::Null);
                if v.get("parent_tool_use_id").is_some_and(|p| !p.is_null()) {
                    return vec![]; // texto de subagente
                }
                if e.pointer("/delta/type").and_then(Value::as_str) == Some("text_delta") {
                    let t = e.pointer("/delta/text").and_then(Value::as_str).unwrap_or("");
                    return vec![ChatEvent::Delta { text: t.into() }];
                }
                vec![]
            }
            ("user", _) => self.steps_of(project, account, v),
            ("assistant", _) => {
                if v.get("parent_tool_use_id").is_some_and(|p| !p.is_null()) {
                    return vec![];
                }
                let uuid = v.get("uuid").and_then(Value::as_str).unwrap_or("");
                let blocks = v.pointer("/message/content").and_then(Value::as_array).cloned().unwrap_or_default();
                let mut out = self.steps_of(project, account, v);
                out.extend(blocks
                    .iter()
                    .enumerate()
                    .filter_map(|(i, b)| {
                        let t = b.get("text").and_then(Value::as_str).filter(|_| b.get("type").and_then(Value::as_str) == Some("text"))?;
                        Some(ChatEvent::Say { key: format!("{uuid}:{i}"), text: t.into() })
                    }));
                out
            }
            ("control_request", _) => {
                let r = v.get("request").cloned().unwrap_or(Value::Null);
                if r.get("subtype").and_then(Value::as_str) != Some("can_use_tool") {
                    return vec![];
                }
                let id = v.get("request_id").and_then(Value::as_str).unwrap_or("").to_string();
                let tool = r.get("tool_name").and_then(Value::as_str).unwrap_or("?").to_string();
                let input = r.get("input").cloned().unwrap_or(Value::Null);
                if let Ok(mut m) = self.map.lock() {
                    if let Some(c) = m.get_mut(project) {
                        c.pending.insert(id.clone(), input.clone());
                    }
                }
                let (title, detail, path) = describe(&tool, &input, r.get("description").and_then(Value::as_str));
                vec![ChatEvent::Permission { request_id: id, tool, title, detail, path }]
            }
            ("result", _) => {
                let ok = v.get("is_error").and_then(Value::as_bool) != Some(true) && sub == "success";
                let denied = v.get("permission_denials").and_then(Value::as_array).map(|a| a.len()).unwrap_or(0);
                let secs = v.get("duration_ms").and_then(Value::as_u64).map(|ms| ms as f64 / 1000.0);
                let mut parts = vec![];
                if let Some(s) = secs {
                    parts.push(format!("{:.0} s", s.max(1.0)));
                }
                if denied > 0 {
                    parts.push(format!("{denied} ação(ões) bloqueada(s) pelo nível"));
                }
                if !ok {
                    match v.get("result").and_then(Value::as_str).filter(|r| !r.trim().is_empty()) {
                        Some(r) => parts.push(cut(r, 160)),
                        None => parts.push("interrompido".into()),
                    }
                }
                vec![ChatEvent::Done { ok, detail: Some(parts.join(" · ")).filter(|s| !s.is_empty()) }]
            }
            _ => vec![],
        }
    }

    /// Passos de ferramenta tirados da saída (só no Chat livre).
    fn steps_of(&self, project: &str, account: &str, v: &Value) -> Vec<ChatEvent> {
        let Ok(mut m) = self.map.lock() else { return vec![] };
        let Some(c) = m.get_mut(project) else { return vec![] };
        let Some(root) = c.stream_steps.clone() else { return vec![] };
        crate::agent::stream_steps(v, account, &root, &mut c.step_tools).into_iter().map(|event| ChatEvent::Step { event }).collect()
    }

    /// Resposta da pessoa a um pedido de permissão.
    pub fn answer(&self, project: &str, request_id: &str, allow: bool) -> Result<(), String> {
        let mut map = self.map.lock().map_err(|e| e.to_string())?;
        let c = map.get_mut(project).ok_or("conversa não encontrada")?;
        if let Some(tx) = c.api_pending.remove(request_id) {
            return tx.send(allow).map_err(|_| "a resposta já tinha sido parada".to_string());
        }
        let input = c.pending.remove(request_id).ok_or("esse pedido já foi respondido")?;
        let p = c.claude.as_mut().ok_or("o Claude não está mais rodando")?;
        let response = if allow {
            json!({"behavior":"allow","updatedInput":input})
        } else {
            json!({"behavior":"deny","message":"A pessoa recusou no Veocode."})
        };
        write_line(&mut p.stdin, &json!({"type":"control_response","response":{"subtype":"success","request_id":request_id,"response":response}}))
    }

    /// Para a resposta atual (Claude: interrompe; APIs: corta o stream).
    pub fn stop(&self, app: &AppHandle, project: &str) -> Result<(), String> {
        let mut map = self.map.lock().map_err(|e| e.to_string())?;
        let Some(c) = map.get_mut(project) else { return Ok(()) };
        c.cancel.store(true, Ordering::SeqCst);
        // canais das APIs: soltar o remetente acorda quem espera
        let ids: Vec<String> = c.pending.drain().map(|(k, _)| k).chain(c.api_pending.drain().map(|(k, _)| k)).collect();
        for id in ids {
            emit(app, project, ChatEvent::PermissionGone { request_id: id });
        }
        if let Some(p) = c.claude.as_mut() {
            let _ = write_line(&mut p.stdin, &json!({"type":"control_request","request_id":format!("veocode-stop-{}", now_ms()),"request":{"subtype":"interrupt"}}));
        }
        Ok(())
    }

    /// Nova conversa: fecha o processo e esquece a sessão e o histórico.
    pub fn reset(&self, project: &str) {
        if let Ok(mut map) = self.map.lock() {
            if let Some(mut c) = map.remove(project) {
                c.cancel.store(true, Ordering::SeqCst);
                if let Some(mut p) = c.claude.take() {
                    let _ = p.child.kill();
                }
            }
        }
    }

    /// Fecha todos os processos (app saindo).
    pub fn shutdown(&self) {
        if let Ok(mut map) = self.map.lock() {
            for (_, c) in map.iter_mut() {
                if let Some(mut p) = c.claude.take() {
                    let _ = p.child.kill();
                }
            }
        }
    }

    /// Conversa com API para a tela: só pedidos e respostas com texto.
    pub fn history(&self, project: &str) -> Vec<Msg> {
        let msgs = self.map.lock().ok().and_then(|m| m.get(project).map(|c| c.history.clone())).unwrap_or_default();
        msgs.iter()
            .filter_map(|v| {
                let role = v.get("role").and_then(Value::as_str)?;
                let content = v.get("content").and_then(Value::as_str).filter(|t| !t.trim().is_empty())?;
                matches!(role, "user" | "assistant").then(|| Msg { role: role.into(), content: content.into() })
            })
            .collect()
    }

    // ------------------------------------------------------------ APIs

    fn send_api(self: &Arc<Self>, app: AppHandle, a: SendArgs) -> Result<(), String> {
        let ag = apiagent::agent();
        let wire = apiagent::wire_for(&a.account, &ag)?;
        let (busy, cancel, mut msgs, conv) = {
            let mut map = self.map.lock().map_err(|e| e.to_string())?;
            let chat = map.entry(a.project_id.clone()).or_default();
            if chat.busy.load(Ordering::SeqCst) {
                return Err("Ainda respondendo. Espere ou pare a resposta.".into());
            }
            if chat.history_account != a.account.id {
                chat.history.clear();
                chat.history_account = a.account.id.clone();
            }
            // conversa sem histórico (nova, ou a conta mudou) ganha um id novo para ser guardada
            if chat.history.is_empty() || chat.api_conv.is_none() {
                chat.api_conv = Some(format!("api-{}", now_ms()));
            }
            let conv = chat.api_conv.clone().unwrap_or_default();
            let mut content = a.text.clone();
            if let Some((path, body)) = &a.attach {
                content = format!("{content}\n\nArquivo `{path}` (aberto no Veocode):\n```\n{body}\n```");
            }
            chat.history.push(json!({"role":"user","content":content}));
            chat.cancel = Arc::new(AtomicBool::new(false));
            chat.busy.store(true, Ordering::SeqCst);
            (chat.busy.clone(), chat.cancel.clone(), chat.history.clone(), conv)
        };
        let me = Arc::clone(self);
        std::thread::spawn(move || {
            let project = a.project_id.clone();
            let turn = apiagent::Turn {
                wire: &wire,
                root: a.root.clone(),
                project_name: a.project_name.clone(),
                account_id: a.account.id.clone(),
                level: a.level,
                overrides: a.overrides.clone(),
                cancel: &cancel,
                intro: a.prompt.clone(),
                tools: a.tools,
            };
            let mut hooks = AppHooks { app: &app, project: &project, chats: &me, cancel: &cancel };
            let r = apiagent::run_turn(&ag, &turn, &mut msgs, &mut hooks);
            // guarda a conversa (com chamadas e resultados) para o próximo pedido
            apiagent::trim_history(&mut msgs, 80);
            // e em disco, para aparecer em "Conversas" (só se ainda é a conversa aberta)
            let still = me.map.lock().ok().is_some_and(|m| m.get(&project).and_then(|c| c.api_conv.as_deref()) == Some(conv.as_str()));
            if still {
                if let Err(e) = convos::save_api(&me.api_dir(&project), &conv, &a.account.id, &msgs) {
                    eprintln!("[chat] não guardou a conversa: {e}");
                }
            }
            if let Ok(mut m) = me.map.lock() {
                if let Some(c) = m.get_mut(&project).filter(|c| c.api_conv.as_deref() == Some(conv.as_str())) {
                    c.history = msgs;
                    c.api_pending.clear();
                }
            }
            match r {
                Ok(end) => {
                    let mut parts = vec![];
                    if end.steps > 0 {
                        parts.push(format!("{} {}", end.steps, if end.steps == 1 { "passo" } else { "passos" }));
                    }
                    if end.no_tools {
                        parts.push("este modelo não aceita ferramentas: só conversa".into());
                    }
                    if end.hit_limit {
                        parts.push("parou no limite de rodadas".into());
                    }
                    if end.stopped {
                        parts.push("interrompido".into());
                    }
                    emit(&app, &project, ChatEvent::Done { ok: !end.stopped, detail: Some(parts.join(" · ")).filter(|s| !s.is_empty()) });
                }
                Err(e) => emit(&app, &project, ChatEvent::Error { message: e }),
            }
            busy.store(false, Ordering::SeqCst);
        });
        Ok(())
    }

}

fn now_ms() -> u128 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

fn cut(s: &str, n: usize) -> String {
    let t = s.trim().replace('\n', " ");
    if t.chars().count() > n { format!("{}…", t.chars().take(n).collect::<String>()) } else { t }
}

fn write_line(stdin: &mut ChildStdin, v: &Value) -> Result<(), String> {
    let mut s = v.to_string();
    s.push('\n');
    stdin.write_all(s.as_bytes()).and_then(|_| stdin.flush()).map_err(|e| format!("não deu para falar com o Claude: {e}"))
}

/// Mensagens de erro comuns do Claude Code em português.
fn explain(stderr: &str) -> String {
    let l = stderr.to_lowercase();
    if l.contains("not logged in") || l.contains("/login") || l.contains("authentication") {
        "Esta conta do Claude não está logada. Em Contas, use “Entrar” para fazer o login.".into()
    } else {
        format!("O Claude parou com erro: {}", cut(stderr, 300))
    }
}

static NEXT_GEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

fn spawn_claude(a: &SendArgs, resume: Option<&str>, level_key: String, proc_id: u64) -> Result<ClaudeProc, String> {
    let claude = crate::xray::util::which("claude").ok_or("Não achei o comando `claude`. Instale o Claude Code e tente de novo.")?;
    let mut cmd = Command::new(&claude);
    cmd.args(["--output-format", "stream-json", "--verbose", "--input-format", "stream-json", "--include-partial-messages"])
        .args(["--permission-prompt-tool", "stdio", "--permission-mode", a.mode])
        .arg("--settings")
        .arg(a.settings.to_string());
    if let Some(d) = &a.add_dir {
        cmd.arg("--add-dir").arg(d);
    }
    if let Some(p) = a.prompt.as_deref().filter(|p| !p.is_empty()) {
        cmd.arg("--append-system-prompt").arg(p);
    }
    if let Some(m) = a.account.model.as_deref().filter(|m| !m.is_empty()) {
        cmd.args(["--model", m]);
    }
    if let Some(s) = resume {
        cmd.arg(format!("--resume={s}"));
    }
    if a.account.config_dir.is_some() {
        cmd.env("CLAUDE_CONFIG_DIR", crate::accounts::claude::config_dir(&a.account));
    }
    // o Veocode pode ter sido aberto de dentro de uma sessão do Claude: não herdar isso
    cmd.env_remove("CLAUDECODE").env("CLAUDE_CODE_ENTRYPOINT", "sdk-veocode");
    // apps abertos pelo Finder têm PATH mínimo: o Claude precisa achar git, node etc.
    let mut path: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    let extras: &[&str] = if cfg!(windows) { &[] } else { &["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] };
    for extra in extras {
        let p = PathBuf::from(extra);
        if !path.contains(&p) {
            path.push(p);
        }
    }
    if let Some(dir) = claude.parent() {
        path.insert(0, dir.to_path_buf());
    }
    if let Ok(joined) = std::env::join_paths(path) {
        cmd.env("PATH", joined);
    }
    cmd.current_dir(&a.root).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // sem janela de console
    }
    let mut child = cmd.spawn().map_err(|e| format!("não deu para abrir o Claude: {e}"))?;
    let stdin = child.stdin.take().ok_or("sem entrada do Claude")?;
    Ok(ClaudeProc { child, stdin, account: a.account.id.clone(), level_key, proc_id })
}

/// Texto curto para o cartão de permissão.
fn describe(tool: &str, input: &Value, description: Option<&str>) -> (String, Option<String>, Option<String>) {
    let s = |k: &str| input.get(k).and_then(Value::as_str).map(String::from);
    let file = s("file_path").or_else(|| s("notebook_path"));
    match tool {
        "Edit" | "MultiEdit" | "NotebookEdit" => (format!("Editar {}", file.clone().unwrap_or_default()), None, file),
        "Write" => (format!("Escrever {}", file.clone().unwrap_or_default()), s("content").map(|c| format!("{} linhas", c.lines().count())), file),
        "Bash" | "PowerShell" => (s("description").map(|d| cut(&d, 90)).unwrap_or_else(|| "Rodar um comando".into()), s("command").map(|c| cut(&c, 400)), None),
        "WebFetch" => ("Abrir uma página".into(), s("url"), None),
        "WebSearch" => ("Pesquisar na internet".into(), s("query"), None),
        t if t.starts_with("mcp__") => {
            let rest = t.trim_start_matches("mcp__").replacen("__", " · ", 1);
            (format!("Usar MCP {rest}"), Some(cut(&input.to_string(), 300)), None)
        }
        t => (description.map(|d| cut(d, 90)).unwrap_or_else(|| format!("Usar {t}")), Some(cut(&input.to_string(), 300)), file),
    }
}

/// Liga o laço das APIs à tela: texto, passos e pedidos de permissão viram eventos.
struct AppHooks<'a> {
    app: &'a AppHandle,
    project: &'a str,
    chats: &'a Chats,
    cancel: &'a AtomicBool,
}

impl apiagent::Hooks for AppHooks<'_> {
    fn delta(&mut self, text: &str) {
        emit(self.app, self.project, ChatEvent::Delta { text: text.into() });
    }
    fn say(&mut self, text: String) {
        emit(self.app, self.project, ChatEvent::Say { key: format!("api-{}", now_ms()), text });
    }
    fn step(&mut self, event: AgentEvent) {
        emit(self.app, self.project, ChatEvent::Step { event });
    }
    fn ask(&mut self, c: &crate::tools::Call, look: &crate::tools::Look) -> Option<bool> {
        let (tx, rx) = mpsc::channel();
        let request_id = format!("api-ask-{}", now_ms());
        {
            let mut m = self.chats.map.lock().ok()?;
            m.get_mut(self.project)?.api_pending.insert(request_id.clone(), tx);
        }
        let detail = match c.name.as_str() {
            "write_file" => c.args.get("content").and_then(Value::as_str).map(|t| cut(t, 400)),
            "edit_file" => Some(format!(
                "− {}\n+ {}",
                cut(c.args.get("old_text").and_then(Value::as_str).unwrap_or(""), 180),
                cut(c.args.get("new_text").and_then(Value::as_str).unwrap_or(""), 180)
            )),
            "run_command" => look.detail.clone(),
            _ => Some(cut(&c.args.to_string(), 300)),
        };
        emit(self.app, self.project, ChatEvent::Permission { request_id: request_id.clone(), tool: c.name.clone(), title: look.title.clone(), detail, path: look.path.clone() });
        loop {
            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(b) => return Some(b),
                Err(mpsc::RecvTimeoutError::Disconnected) => return None,
                Err(mpsc::RecvTimeoutError::Timeout) if self.cancel.load(Ordering::SeqCst) => return None,
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
        }
    }
}

pub fn project_root_ok(root: &Path) -> Result<(), String> {
    if root.is_dir() { Ok(()) } else { Err("a pasta do projeto não existe mais".into()) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_claude_stream() {
        let c = Chats::default();
        c.map.lock().unwrap().insert("p".into(), ProjectChat::default());
        let init = json!({"type":"system","subtype":"init","session_id":"s-1"});
        assert!(matches!(&c.handle_claude_line("p", "acc", &init)[0], ChatEvent::Session { session_id } if session_id == "s-1"));
        assert_eq!(c.map.lock().unwrap()["p"].session, Some(("acc".into(), "s-1".into())));

        let delta = json!({"type":"stream_event","parent_tool_use_id":null,"event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Ol"}}});
        assert!(matches!(&c.handle_claude_line("p", "acc", &delta)[0], ChatEvent::Delta { text } if text == "Ol"));
        let sub = json!({"type":"stream_event","parent_tool_use_id":"t9","event":{"delta":{"type":"text_delta","text":"x"}}});
        assert!(c.handle_claude_line("p", "acc", &sub).is_empty());

        let perm = json!({"type":"control_request","request_id":"r1","request":{"subtype":"can_use_tool","tool_name":"Bash","input":{"command":"npm test","description":"Rodar testes"}}});
        match &c.handle_claude_line("p", "acc", &perm)[0] {
            ChatEvent::Permission { request_id, title, detail, .. } => {
                assert_eq!((request_id.as_str(), title.as_str(), detail.as_deref()), ("r1", "Rodar testes", Some("npm test")));
            }
            other => panic!("{other:?}"),
        }
        assert!(c.map.lock().unwrap()["p"].pending.contains_key("r1"));

        let say = json!({"type":"assistant","uuid":"u7","parent_tool_use_id":null,"message":{"content":[{"type":"tool_use"},{"type":"text","text":"Pronto."}]}});
        assert!(matches!(&c.handle_claude_line("p", "acc", &say)[0], ChatEvent::Say { key, text } if key == "u7:1" && text == "Pronto."));

        let res = json!({"type":"result","subtype":"success","is_error":false,"duration_ms":4200,"permission_denials":[{"tool_name":"Bash"}]});
        match &c.handle_claude_line("p", "acc", &res)[0] {
            ChatEvent::Done { ok, detail } => {
                assert!(ok);
                assert_eq!(detail.as_deref(), Some("4 s · 1 ação(ões) bloqueada(s) pelo nível"));
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn event_fields_are_camel_case() {
        let e = Envelope { project_id: "p".into(), event: ChatEvent::Permission { request_id: "r".into(), tool: "Write".into(), title: "t".into(), detail: None, path: None } };
        let v = serde_json::to_value(&e).unwrap();
        assert_eq!(v["kind"], "permission");
        assert_eq!(v["requestId"], "r");
        assert_eq!(v["projectId"], "p");
        let g = serde_json::to_value(ChatEvent::PermissionGone { request_id: "r".into() }).unwrap();
        assert_eq!(g, json!({"kind":"permissionGone","requestId":"r"}));
    }

    #[test]
    fn describes_permissions() {
        assert_eq!(describe("Edit", &json!({"file_path":"/p/a.rs"}), None).0, "Editar /p/a.rs");
        assert_eq!(describe("mcp__figma__get_file", &json!({}), None).0, "Usar MCP figma · get_file");
        assert!(explain("Error: Not logged in · Please run /login").contains("não está logada"));
    }

    #[test]
    fn free_chat_steps_come_from_the_stream() {
        let c = Chats::default();
        c.map.lock().unwrap().insert("livre".into(), ProjectChat { stream_steps: Some(PathBuf::from("/tmp/veocode-livre")), ..Default::default() });
        c.map.lock().unwrap().insert("p".into(), ProjectChat::default());
        let tool = json!({"type":"assistant","uuid":"u1","parent_tool_use_id":null,"message":{"content":[
            {"type":"text","text":"Vou ler."},
            {"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"/Users/ana/Documents/a.txt"}}]}});
        let ev = c.handle_claude_line("livre", "acc", &tool);
        assert_eq!(ev.len(), 2);
        match &ev[0] {
            ChatEvent::Step { event } => assert!(event.kind == "read" && event.status == "running" && event.ts > 0, "{event:?}"),
            other => panic!("{other:?}"),
        }
        assert!(matches!(&ev[1], ChatEvent::Say { text, .. } if text == "Vou ler."));

        let res = json!({"type":"user","parent_tool_use_id":null,"message":{"content":[{"type":"tool_result","tool_use_id":"t1"}]},"tool_use_result":{"file":{"numLines":3}}});
        match &c.handle_claude_line("livre", "acc", &res)[..] {
            [ChatEvent::Step { event }] => assert_eq!((event.kind.as_str(), event.id.as_str(), event.detail.as_deref()), ("result", "t1", Some("3 linhas"))),
            other => panic!("{other:?}"),
        }
        // projeto comum: os passos vêm do histórico, não daqui
        assert_eq!(c.handle_claude_line("p", "acc", &tool).len(), 1);
        assert!(c.handle_claude_line("p", "acc", &res).is_empty());
    }
}
