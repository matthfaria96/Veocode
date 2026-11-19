//! Conversas anteriores de um projeto, para retomar pelo chat do Veocode.
//!
//! - Claude: cada sessão é um `<id>.jsonl` em `<pasta da conta>/projects/<projeto codificado>/`.
//!   Só LEMOS: o título vem do próprio histórico (o nome dado com /rename, o título que o
//!   Claude gera ou o primeiro pedido) e o fim do arquivo vira a conversa na tela.
//! - Contas por API: o Veocode guarda cada conversa (no formato da API, com as chamadas de
//!   ferramenta) em `<dados do app>/chats/<projeto>/<id>.json`, com um resumo pequeno ao lado
//!   (`<id>.meta.json`) para a lista não precisar abrir as conversas inteiras.

use crate::agent::{self, AgentEvent};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// Quantas conversas a lista mostra e quantos passos aparecem ao retomar.
pub const MAX_LISTED: usize = 40;
pub const MAX_STEPS: usize = 60;
const PEEK: u64 = 256 * 1024;

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Convo {
    pub id: String,
    /// "claude" ou "api"
    pub kind: String,
    pub account: String,
    pub title: String,
    pub last_prompt: Option<String>,
    /// de onde veio a sessão do Claude: Terminal, VS Code, app do Claude, Veocode…
    pub origin: Option<String>,
    /// ms desde 1970
    pub updated: i64,
    pub bytes: u64,
    /// tokens que a conversa carrega hoje (o que o Claude relê a cada mensagem)
    pub context: Option<u64>,
}

/// Ids vêm da tela: só letras, números, '-' e '_' (nada de caminho).
pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 80 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn modified_ms(p: &Path) -> i64 {
    fs::metadata(p).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn one_line(s: &str, n: usize) -> String {
    let t = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if t.chars().count() > n { format!("{}…", t.chars().take(n).collect::<String>()) } else { t }
}

// ---------------------------------------------------------------- Claude

/// Pasta das sessões de um projeto numa conta do Claude.
pub fn claude_dir(config_dir: &Path, root: &Path) -> PathBuf {
    config_dir.join("projects").join(agent::encode(root))
}

/// Pedaço do arquivo como linhas JSON (descarta a linha cortada na borda).
fn peek(file: &Path, from_end: bool) -> Vec<Value> {
    let Ok(mut f) = File::open(file) else { return vec![] };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let start = if from_end { len.saturating_sub(PEEK) } else { 0 };
    if f.seek(SeekFrom::Start(start)).is_err() {
        return vec![];
    }
    let mut buf = Vec::new();
    let _ = f.take(PEEK).read_to_end(&mut buf);
    let text = String::from_utf8_lossy(&buf);
    let mut lines: Vec<&str> = text.lines().collect();
    if start > 0 && !lines.is_empty() {
        lines.remove(0);
    }
    if !from_end && (len > PEEK) {
        lines.pop();
    }
    lines.iter().filter_map(|l| serde_json::from_str(l).ok()).collect()
}

fn text_of_user(v: &Value) -> Option<String> {
    if v.get("type")?.as_str()? != "user" || v.get("isMeta").and_then(Value::as_bool) == Some(true) || v.get("isSidechain").and_then(Value::as_bool) == Some(true) {
        return None;
    }
    let c = v.pointer("/message/content")?;
    let t = match c {
        Value::String(s) => s.clone(),
        Value::Array(a) => a.iter().find(|b| b.get("type").and_then(Value::as_str) == Some("text"))?.get("text")?.as_str()?.to_string(),
        _ => return None,
    };
    (!agent::noise(&t)).then_some(t)
}

fn origin_label(entry: &str) -> String {
    match entry {
        "cli" => "Terminal".into(),
        "sdk-cli" => "sem terminal".into(),
        "claude-vscode" => "VS Code".into(),
        "claude-desktop" => "app do Claude".into(),
        e if e.starts_with("sdk") => "SDK".into(),
        e => e.to_string(),
    }
}

/// Título e último pedido de uma sessão. `None`: sessão sem nenhum pedido (só registros internos).
pub fn claude_info(file: &Path) -> Option<(String, Option<String>, Option<String>)> {
    let tail = peek(file, true);
    let (mut custom, mut ai, mut summary, mut last) = (None, None, None, None);
    for v in &tail {
        let s = |k: &str| v.get(k).and_then(Value::as_str).filter(|t| !t.trim().is_empty()).map(String::from);
        match v.get("type").and_then(Value::as_str) {
            Some("custom-title") => custom = s("customTitle").or(custom),
            Some("ai-title") => ai = s("aiTitle").or(ai),
            Some("summary") => summary = s("summary").or(summary),
            Some("last-prompt") => last = s("lastPrompt").filter(|t| !agent::noise(t)).or(last),
            Some("user") => last = text_of_user(v).or(last),
            _ => {}
        }
    }
    let head = peek(file, false);
    let first = head.iter().find_map(text_of_user);
    let origin = head.iter().chain(tail.iter()).find_map(|v| v.get("entrypoint").and_then(Value::as_str)).map(origin_label);
    let title = custom.or(ai).or(summary).or_else(|| first.clone()).or_else(|| last.clone())?;
    // último pedido só ajuda se não repetir o título
    let last = last.filter(|l| one_line(l, 120) != one_line(&title, 120));
    Some((one_line(&title, 90), last.map(|l| one_line(&l, 120)), origin))
}

/// Sessões do Claude deste projeto em todas as contas (mais recentes primeiro).
/// Tamanho do contexto na última resposta do Claude (entrada + cache + saída), lido do fim
/// do histórico. É quanto a próxima mensagem desta conversa manda de novo.
/// Última entrada da conversa principal (uuid), para recomeçar dali depois de editar um pedido.
pub fn last_uuid(p: &Path) -> Option<String> {
    peek(p, true)
        .iter()
        .rev()
        .filter(|v| v.get("isSidechain").and_then(Value::as_bool) != Some(true))
        .filter(|v| matches!(v.get("type").and_then(Value::as_str), Some("user" | "assistant" | "system" | "attachment")))
        .find_map(|v| v.get("uuid").and_then(Value::as_str).map(String::from))
}

pub fn last_context(p: &Path) -> Option<u64> {
    let mut f = File::open(p).ok()?;
    let len = f.metadata().ok()?.len();
    let start = len.saturating_sub(512 * 1024);
    f.seek(SeekFrom::Start(start)).ok()?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).ok()?;
    let text = String::from_utf8_lossy(&buf);
    text.lines().rev().find_map(|l| {
        if !l.contains("\"usage\"") {
            return None;
        }
        let v: Value = serde_json::from_str(l).ok()?;
        if v.get("type").and_then(Value::as_str) != Some("assistant") || v.get("isSidechain").and_then(Value::as_bool) == Some(true) {
            return None;
        }
        usage_total(v.pointer("/message/usage")?)
    })
}

/// Soma do que foi para o modelo numa chamada (o contexto daquele momento).
pub fn usage_total(u: &Value) -> Option<u64> {
    let n = |k: &str| u.get(k).and_then(Value::as_u64).unwrap_or(0);
    let t = n("input_tokens") + n("cache_creation_input_tokens") + n("cache_read_input_tokens") + n("output_tokens");
    (t > 0).then_some(t)
}

pub fn claude_sessions(root: &Path, accounts: &[(String, PathBuf)]) -> Vec<Convo> {
    let mut files = vec![];
    for (acc, cfg) in accounts {
        let Ok(rd) = fs::read_dir(claude_dir(cfg, root)) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            let Some(id) = p.file_stem().and_then(|s| s.to_str()).map(String::from) else { continue };
            if p.extension().is_some_and(|x| x == "jsonl") && valid_id(&id) {
                files.push((modified_ms(&p), acc.clone(), id, p));
            }
        }
    }
    files.sort_by(|a, b| b.0.cmp(&a.0));
    let mut out = vec![];
    for (updated, account, id, p) in files {
        if out.len() >= MAX_LISTED {
            break;
        }
        let Some((title, last_prompt, origin)) = claude_info(&p) else { continue };
        let bytes = fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
        let context = last_context(&p);
        out.push(Convo { id, kind: "claude".into(), account, title, last_prompt, origin, updated, bytes, context });
    }
    out
}

// ---------------------------------------------------------------- APIs

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ApiMeta {
    pub id: String,
    pub account: String,
    pub title: String,
    #[serde(default)]
    pub last_prompt: Option<String>,
    pub updated: i64,
}

pub fn api_dir(data: &Path, project: &str) -> PathBuf {
    data.join("chats").join(project)
}

/// Texto do pedido sem o arquivo anexado (que vai junto para o modelo).
pub fn strip_attach(content: &str) -> String {
    match content.find("\n\nArquivo `") {
        Some(i) => {
            let rest = &content[i + "\n\nArquivo `".len()..];
            let path = rest.split('`').next().unwrap_or("");
            format!("{}\n📎 {path}", &content[..i])
        }
        None => content.to_string(),
    }
}

/// Grava a conversa e o resumo (escreve num temporário e troca, para não deixar arquivo pela metade).
pub fn save_api(dir: &Path, id: &str, account: &str, msgs: &[Value]) -> Result<(), String> {
    if !valid_id(id) {
        return Err("id inválido".into());
    }
    let prompts: Vec<String> = msgs
        .iter()
        .filter(|m| m.get("role").and_then(Value::as_str) == Some("user"))
        .filter_map(|m| m.get("content").and_then(Value::as_str))
        .map(|c| one_line(strip_attach(c).lines().next().unwrap_or(""), 120))
        .collect();
    let Some(first) = prompts.first() else { return Ok(()) };
    let meta = ApiMeta {
        id: id.into(),
        account: account.into(),
        title: one_line(first, 90),
        last_prompt: prompts.last().filter(|_| prompts.len() > 1).cloned(),
        updated: chrono::Utc::now().timestamp_millis(),
    };
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let write = |name: String, v: &Value| -> Result<(), String> {
        let tmp = dir.join(format!("{name}.tmp"));
        fs::write(&tmp, serde_json::to_vec(v).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        fs::rename(&tmp, dir.join(name)).map_err(|e| e.to_string())
    };
    write(format!("{id}.json"), &json!({"id": id, "account": account, "messages": msgs}))?;
    write(format!("{id}.meta.json"), &serde_json::to_value(&meta).map_err(|e| e.to_string())?)
}

pub fn load_api(dir: &Path, id: &str) -> Result<(String, Vec<Value>), String> {
    if !valid_id(id) {
        return Err("id inválido".into());
    }
    let v: Value = serde_json::from_slice(&fs::read(dir.join(format!("{id}.json"))).map_err(|_| "conversa não encontrada".to_string())?)
        .map_err(|_| "conversa ilegível".to_string())?;
    let account = v.get("account").and_then(Value::as_str).unwrap_or("").to_string();
    let msgs = v.get("messages").and_then(Value::as_array).cloned().unwrap_or_default();
    Ok((account, msgs))
}

pub fn api_list(dir: &Path) -> Vec<Convo> {
    let Ok(rd) = fs::read_dir(dir) else { return vec![] };
    let mut out: Vec<Convo> = rd
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().ends_with(".meta.json"))
        .filter_map(|e| {
            let m: ApiMeta = serde_json::from_slice(&fs::read(e.path()).ok()?).ok()?;
            let bytes = fs::metadata(dir.join(format!("{}.json", m.id))).map(|x| x.len()).ok()?;
            valid_id(&m.id).then(|| Convo { id: m.id, kind: "api".into(), account: m.account, title: m.title, last_prompt: m.last_prompt, origin: None, updated: m.updated, bytes, context: None })
        })
        .collect();
    out.sort_by(|a, b| b.updated.cmp(&a.updated));
    out.truncate(MAX_LISTED);
    out
}

/// A conversa guardada vira os mesmos eventos da tela: pedidos, respostas e passos.
pub fn api_events(account: &str, msgs: &[Value], ts: i64) -> Vec<AgentEvent> {
    let base = AgentEvent { session: "api".into(), account: account.into(), status: "ok".into(), history: true, ts, ..Default::default() };
    let mut out = vec![];
    for (n, m) in msgs.iter().enumerate() {
        let content = m.get("content").and_then(Value::as_str).unwrap_or("");
        match m.get("role").and_then(Value::as_str) {
            Some("user") => out.push(AgentEvent { id: format!("api-h{n}"), kind: "user".into(), title: strip_attach(content), anchor: Some(format!("api:{n}")), ..base.clone() }),
            Some("assistant") => {
                if !content.trim().is_empty() {
                    out.push(AgentEvent { id: format!("api-h{n}"), kind: "say".into(), title: content.into(), ..base.clone() });
                }
                for (i, tc) in m.get("tool_calls").and_then(Value::as_array).into_iter().flatten().enumerate() {
                    let name = tc.pointer("/function/name").and_then(Value::as_str).unwrap_or("").to_string();
                    let args = match tc.pointer("/function/arguments") {
                        Some(Value::String(s)) => serde_json::from_str(s).unwrap_or(Value::Null),
                        Some(v) => v.clone(),
                        None => Value::Null,
                    };
                    let look = crate::tools::look(&crate::tools::Call { id: String::new(), name, args });
                    out.push(AgentEvent { id: format!("api-h{n}-{i}"), kind: look.kind.into(), title: look.title, detail: look.detail, path: look.path, ..base.clone() });
                }
            }
            _ => {}
        }
    }
    // só o fim, como na sessão do Claude
    let skip = out.len().saturating_sub(MAX_STEPS);
    out.drain(..skip);
    out
}

// ---------------------------------------------------------------- testes

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("veocode-convos-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn ids_never_become_paths() {
        assert!(valid_id("a48cbf7a-43a9-4ad9-bf16-bd989aee5467"));
        assert!(valid_id("api-1794970369383"));
        for bad in ["", "../x", "a/b", "a.json", "a b"] {
            assert!(!valid_id(bad), "{bad}");
        }
    }

    #[test]
    fn titles_from_claude_sessions() {
        let d = tmp("claude");
        let root = Path::new("/projetos/app");
        let dir = claude_dir(&d, root);
        fs::create_dir_all(&dir).unwrap();
        let user = |t: &str| json!({"type":"user","entrypoint":"cli","message":{"role":"user","content":t}}).to_string();
        // 1: sem título, vale o primeiro pedido (o aviso interno não conta)
        let s1 = [json!({"type":"file-history-snapshot"}).to_string(), user("<command-name>/clear</command-name>"), user("arrume o login"), user("agora os testes")].join("\n");
        fs::write(dir.join("aaaa-1.jsonl"), s1 + "\n").unwrap();
        // 2: título dado pela pessoa vence o gerado
        let s2 = [user("oi"), json!({"type":"ai-title","aiTitle":"Gerado"}).to_string(), json!({"type":"custom-title","customTitle":"Meu nome"}).to_string()].join("\n");
        fs::write(dir.join("bbbb-2.jsonl"), s2 + "\n").unwrap();
        // 3: só registros internos → fora da lista; e um arquivo com nome estranho também
        fs::write(dir.join("cccc-3.jsonl"), json!({"type":"file-history-snapshot"}).to_string() + "\n").unwrap();
        fs::write(dir.join("x y.jsonl"), user("não") + "\n").unwrap();

        let list = claude_sessions(root, &[("conta".into(), d.clone())]);
        assert_eq!(list.len(), 2);
        let one = list.iter().find(|c| c.id == "aaaa-1").unwrap();
        assert_eq!(one.title, "arrume o login");
        assert_eq!(one.last_prompt.as_deref(), Some("agora os testes"));
        assert_eq!(one.origin.as_deref(), Some("Terminal"));
        assert_eq!(one.account, "conta");
        assert_eq!(list.iter().find(|c| c.id == "bbbb-2").unwrap().title, "Meu nome");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn api_conversations_round_trip() {
        let d = tmp("api");
        let msgs = vec![
            json!({"role":"user","content":"crie ola.txt\n\nArquivo `src/a.rs` (aberto no Veocode):\n```\nfn a() {}\n```"}),
            json!({"role":"assistant","content":"","tool_calls":[{"id":"c1","type":"function","function":{"name":"write_file","arguments":"{\"path\":\"ola.txt\",\"content\":\"oi\"}"}}]}),
            json!({"role":"tool","tool_call_id":"c1","content":"Criado ola.txt"}),
            json!({"role":"assistant","content":"Pronto."}),
            json!({"role":"user","content":"e agora?"}),
        ];
        save_api(&d, "api-1", "deepseek", &msgs).unwrap();
        assert!(save_api(&d, "../fora", "x", &msgs).is_err());
        // conversa sem pedido não é gravada
        save_api(&d, "api-2", "deepseek", &[]).unwrap();

        let list = api_list(&d);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].title, "crie ola.txt");
        assert_eq!(list[0].last_prompt.as_deref(), Some("e agora?"));

        let (acc, back) = load_api(&d, "api-1").unwrap();
        assert_eq!(acc, "deepseek");
        assert_eq!(back, msgs);

        let evs = api_events(&acc, &back, 5);
        let kinds: Vec<&str> = evs.iter().map(|e| e.kind.as_str()).collect();
        assert_eq!(kinds, ["user", "edit", "say", "user"]);
        assert_eq!(evs[0].title, "crie ola.txt\n📎 src/a.rs");
        assert_eq!(evs[1].title, "Escrevendo ola.txt");
        assert_eq!(evs[1].path.as_deref(), Some("ola.txt"));
        assert!(evs.iter().all(|e| e.history && e.ts == 5));
        let _ = fs::remove_dir_all(&d);
    }
}

/// Uma pasta onde o Claude Code já trabalhou (para sugerir como projeto com um clique).
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    pub path: String,
    pub name: String,
    /// última conversa (segundos desde 1970)
    pub last: u64,
    pub sessions: usize,
}

/// Lê as pastas de histórico do Claude Code e devolve as pastas de trabalho que ainda existem,
/// da mais recente para a mais antiga. Só lê o começo de uma conversa por pasta (onde fica o `cwd`).
pub fn recent_folders(config_dirs: &[PathBuf], limit: usize) -> Vec<Found> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let mut by_path: std::collections::HashMap<String, Found> = std::collections::HashMap::new();
    for cfg in config_dirs {
        let Ok(rd) = fs::read_dir(cfg.join("projects")) else { continue };
        for d in rd.flatten() {
            let Ok(files) = fs::read_dir(d.path()) else { continue };
            let mut sessions: Vec<(u64, PathBuf)> = files
                .flatten()
                .filter(|f| f.path().extension().is_some_and(|e| e == "jsonl"))
                .map(|f| (f.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0), f.path()))
                .collect();
            if sessions.is_empty() {
                continue;
            }
            sessions.sort_by(|a, b| b.0.cmp(&a.0));
            let cwd = sessions.iter().take(3).find_map(|(_, f)| peek(f, false).iter().find_map(|v| v.get("cwd").and_then(|c| c.as_str()).map(String::from)));
            let Some(cwd) = cwd else { continue };
            let p = PathBuf::from(&cwd);
            // pastas temporárias, do sistema ou de dados de apps (inclusive o Chat livre do Veocode) não são projetos
            let noise = ["/tmp", "/private/", "/var/", "/Library/", "/AppData/", "/.claude"].iter().any(|n| cwd.contains(n) || cwd.starts_with(n.trim_end_matches('/')));
            if noise || !p.is_dir() || home.as_deref() == Some(p.as_path()) || p.parent().is_none() {
                continue;
            }
            let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| cwd.clone());
            let e = by_path.entry(cwd.clone()).or_insert(Found { path: cwd, name, last: 0, sessions: 0 });
            e.last = e.last.max(sessions[0].0);
            e.sessions += sessions.len();
        }
    }
    let mut v: Vec<Found> = by_path.into_values().collect();
    // subpasta de outra pasta da lista conta como a de cima
    let all: Vec<String> = v.iter().map(|f| f.path.clone()).collect();
    v.retain(|f| !all.iter().any(|o| o != &f.path && f.path.starts_with(&format!("{o}/"))));
    v.sort_by(|a, b| b.last.cmp(&a.last));
    v.truncate(limit);
    v
}

#[cfg(test)]
mod found_tests {
    /// Diagnóstico manual (só leitura): `cargo test real_recent_folders -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn real_recent_folders() {
        for f in super::recent_folders(&crate::xray::caches::claude_config_dirs(), 16) {
            println!("{} · {} sessões · {}", f.name, f.sessions, f.last);
        }
    }
}
