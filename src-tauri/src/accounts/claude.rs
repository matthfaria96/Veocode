//! Contas do Claude Code. Cada conta = uma pasta de configuração (`CLAUDE_CONFIG_DIR`).
//!
//! Tudo aqui é leitura do que o próprio Claude Code grava:
//! - `.claude.json` → quem está logado e o plano (o token em si fica no chaveiro e NÃO é lido);
//! - `projects/*/*.jsonl` → cada resposta traz quantos tokens usou, o modelo e a hora.

use super::{Account, AccountStatus, State};
use chrono::{DateTime, Local, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

const DAYS: usize = 7;

pub fn default_config_dir() -> PathBuf {
    match std::env::var_os("CLAUDE_CONFIG_DIR") {
        Some(d) if !d.is_empty() => PathBuf::from(d),
        _ => crate::xray::util::home().join(".claude"),
    }
}

/// Com CLAUDE_CONFIG_DIR o arquivo fica dentro da pasta; sem ele, em `~/.claude.json`.
pub fn default_json_path() -> PathBuf {
    match std::env::var_os("CLAUDE_CONFIG_DIR") {
        Some(d) if !d.is_empty() => PathBuf::from(d).join(".claude.json"),
        _ => crate::xray::util::home().join(".claude.json"),
    }
}

pub fn config_dir(a: &Account) -> PathBuf {
    a.config_dir.as_ref().map(PathBuf::from).unwrap_or_else(default_config_dir)
}

pub fn json_path(a: &Account) -> PathBuf {
    match &a.config_dir {
        Some(d) => Path::new(d).join(".claude.json"),
        None => default_json_path(),
    }
}

/// Plano e e-mail de quem fez login. `None` = ninguém logado nesta pasta.
fn identity(a: &Account) -> Option<(String, Option<String>)> {
    let text = fs::read_to_string(json_path(a)).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    if let Some(o) = v.get("oauthAccount").filter(|o| o.is_object()) {
        let s = |k: &str| o.get(k).and_then(|x| x.as_str()).map(str::to_string);
        let plan = match s("organizationType").as_deref() {
            Some("claude_pro") => "Pro".to_string(),
            Some("claude_max") => "Max".into(),
            Some("claude_team") => "Team".into(),
            Some("claude_enterprise") => "Enterprise".into(),
            _ if s("billingType").as_deref() == Some("stripe_subscription") => "Assinatura".into(),
            _ => "Console (API)".into(),
        };
        return Some((plan, s("emailAddress").or_else(|| s("displayName"))));
    }
    // login por chave de API do Console: só sabemos que existe
    v.get("primaryApiKey").filter(|k| k.is_string()).map(|_| (crate::i18n::tr("Chave de API", "API key").to_string(), None))
}

// ---------------------------------------------------------------- uso

#[derive(Debug, Serialize, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    /// Tokens hoje (entrada nova + saída; leitura de cache fica de fora).
    pub today: u64,
    pub today_out: u64,
    /// Últimas 5 h — a janela que o Claude usa para os limites do plano.
    pub last5h: u64,
    /// Últimos 7 dias, do mais antigo para hoje.
    pub days: Vec<u64>,
    pub sessions_today: usize,
    pub messages_today: usize,
    /// Segundos desde a última resposta.
    pub last_active_secs: Option<u64>,
    /// Modelos mais usados nos 7 dias, com tokens.
    pub models: Vec<(String, u64)>,
}

#[derive(Clone)]
struct Msg {
    ts: i64,
    session: String,
    model: String,
    tin: u64,
    tout: u64,
}

/// Lê cada histórico uma vez; só relê o que mudou (mesmo tamanho e data = mesmo conteúdo).
#[derive(Default)]
pub struct UsageCache {
    files: HashMap<PathBuf, (SystemTime, u64, Vec<Msg>)>,
}

#[derive(Deserialize)]
struct Line {
    #[serde(rename = "type")]
    kind: Option<String>,
    timestamp: Option<String>,
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
    message: Option<LineMsg>,
}

#[derive(Deserialize)]
struct LineMsg {
    id: Option<String>,
    model: Option<String>,
    usage: Option<LineUsage>,
}

#[derive(Deserialize, Default)]
struct LineUsage {
    #[serde(default)]
    input_tokens: u64,
    #[serde(default)]
    cache_creation_input_tokens: u64,
    #[serde(default)]
    output_tokens: u64,
}

fn parse_file(path: &Path) -> Vec<Msg> {
    let Ok(f) = fs::File::open(path) else { return vec![] };
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for line in BufReader::new(f).lines().map_while(Result::ok) {
        // filtro barato antes do JSON: só respostas com contagem de tokens
        if !line.contains("\"usage\"") || !line.contains("\"assistant\"") {
            continue;
        }
        let Ok(l) = serde_json::from_str::<Line>(&line) else { continue };
        if l.kind.as_deref() != Some("assistant") {
            continue;
        }
        let (Some(m), Some(ts)) = (l.message, l.timestamp) else { continue };
        let Some(u) = m.usage else { continue };
        // a mesma resposta pode aparecer em várias linhas (uma por bloco): conta uma vez
        if let Some(id) = &m.id {
            if !seen.insert(id.clone()) {
                continue;
            }
        }
        let Ok(t) = DateTime::parse_from_rfc3339(&ts) else { continue };
        let model = m.model.unwrap_or_default();
        if model == "<synthetic>" {
            continue;
        }
        out.push(Msg {
            ts: t.timestamp(),
            session: l.session_id.unwrap_or_default(),
            model,
            tin: u.input_tokens + u.cache_creation_input_tokens,
            tout: u.output_tokens,
        });
    }
    out
}

fn jsonl_files(dir: &Path, depth: usize, out: &mut Vec<(PathBuf, fs::Metadata)>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let Ok(md) = e.metadata() else { continue };
        let p = e.path();
        if md.is_dir() {
            if depth > 0 {
                jsonl_files(&p, depth - 1, out);
            }
        } else if p.extension().is_some_and(|x| x == "jsonl") {
            out.push((p, md));
        }
    }
}

pub fn usage(dir: &Path, cache: &mut UsageCache) -> Usage {
    let now = SystemTime::now();
    let window = Duration::from_secs((DAYS as u64 + 1) * 86_400);
    let mut files = Vec::new();
    // projects/<projeto>/<sessão>.jsonl e projects/<projeto>/<sessão>/subagents/*.jsonl
    jsonl_files(&dir.join("projects"), 3, &mut files);

    let mut alive = HashSet::new();
    let mut todo: Vec<(PathBuf, SystemTime, u64)> = Vec::new();
    let mut newest: Option<SystemTime> = None;
    for (path, md) in files {
        let Ok(mtime) = md.modified() else { continue };
        if now.duration_since(mtime).unwrap_or_default() > window {
            continue; // nada desta semana aqui
        }
        newest = newest.max(Some(mtime));
        let fresh = matches!(cache.files.get(&path), Some((t, len, _)) if *t == mtime && *len == md.len());
        if !fresh {
            todo.push((path.clone(), mtime, md.len()));
        }
        alive.insert(path);
    }
    cache.files.retain(|p, _| alive.contains(p));
    // relê em paralelo só o que mudou
    let next = std::sync::atomic::AtomicUsize::new(0);
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(8);
    let parsed: Vec<(PathBuf, SystemTime, u64, Vec<Msg>)> = std::thread::scope(|sc| {
        let handles: Vec<_> = (0..threads)
            .map(|_| {
                sc.spawn(|| {
                    let mut out = Vec::new();
                    loop {
                        let i = next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                        let Some((p, t, len)) = todo.get(i) else { break };
                        out.push((p.clone(), *t, *len, parse_file(p)));
                    }
                    out
                })
            })
            .collect();
        handles.into_iter().flat_map(|h| h.join().unwrap_or_default()).collect()
    });
    for (p, t, len, msgs) in parsed {
        cache.files.insert(p, (t, len, msgs));
    }

    let now_ts = Utc::now().timestamp();
    let today = Local::now().date_naive();
    let mut u = Usage { days: vec![0; DAYS], ..Default::default() };
    let mut sessions = HashSet::new();
    let mut models: HashMap<String, u64> = HashMap::new();
    let mut last: Option<i64> = None;
    for (_, _, msgs) in cache.files.values() {
        for m in msgs {
            let Some(day) = DateTime::from_timestamp(m.ts, 0).map(|d| d.with_timezone(&Local).date_naive()) else { continue };
            let ago = (today - day).num_days();
            if !(0..DAYS as i64).contains(&ago) {
                continue;
            }
            let total = m.tin + m.tout;
            u.days[DAYS - 1 - ago as usize] += total;
            *models.entry(m.model.clone()).or_default() += total;
            if ago == 0 {
                u.today += total;
                u.today_out += m.tout;
                u.messages_today += 1;
                sessions.insert(m.session.as_str());
            }
            if now_ts - m.ts <= 5 * 3600 {
                u.last5h += total;
            }
            last = last.max(Some(m.ts));
        }
    }
    u.sessions_today = sessions.len();
    u.last_active_secs = last.map(|t| (now_ts - t).max(0) as u64);
    let mut models: Vec<_> = models.into_iter().filter(|(_, t)| *t > 0).collect();
    models.sort_by(|a, b| b.1.cmp(&a.1));
    models.truncate(4);
    u.models = models;
    // o arquivo mais novo dá a pista de "trabalhando agora" mesmo antes da resposta terminar
    if let Some(n) = newest {
        if now.duration_since(n).unwrap_or_default() < Duration::from_secs(90) {
            u.last_active_secs = Some(u.last_active_secs.unwrap_or(0).min(now.duration_since(n).unwrap_or_default().as_secs()));
        }
    }
    u
}

pub fn status(a: &Account, cache: &mut UsageCache) -> AccountStatus {
    let dir = config_dir(a);
    let mut s = AccountStatus::new(&a.id, State::SemLogin);
    match identity(a) {
        Some((plan, who)) => {
            s.state = State::Pronta;
            s.plan = Some(plan);
            s.who = who;
        }
        None => s.detail = Some(crate::i18n::tr("Ninguém entrou nesta conta ainda. Use “Entrar” para fazer login no Claude Code.", "Nobody has signed in to this account yet. Use “Sign in” to log in to Claude Code.").into()),
    }
    if dir.is_dir() {
        let u = usage(&dir, cache);
        s.active = u.last_active_secs.is_some_and(|t| t < 90);
        s.models = u.models.iter().map(|(m, _)| m.clone()).collect();
        s.usage = Some(u);
    }
    s
}

// ---------------------------------------------------------------- login

/// Abre um terminal já apontado para a pasta da conta, rodando `claude`.
/// O login acontece lá, com o próprio Claude Code — o Veocode não vê senha nem token.
pub fn open_login(a: &Account) -> Result<(), String> {
    open_terminal(a, None)
}

// ---------------------------------------------------------------- login pelo navegador

/// Logins em andamento: o processo e a entrada dele (para colar o código, se o navegador não voltar sozinho).
static LOGINS: std::sync::Mutex<Option<HashMap<String, (u32, std::process::ChildStdin)>>> = std::sync::Mutex::new(None);

/// Login pelo navegador com o próprio Claude Code (`claude auth login`): abre a página da Anthropic,
/// a pessoa entra e o Claude Code guarda o login no chaveiro. O Veocode não vê senha nem token.
/// `on_url` recebe o endereço da página (para abrir de novo se a aba sumir). Volta quando termina.
pub fn browser_login(a: &Account, on_url: impl Fn(String)) -> Result<(), String> {
    use std::io::Read;
    use std::process::{Command, Stdio};
    let claude = crate::xray::util::which("claude").ok_or(
        crate::i18n::tr("Não achei o comando `claude`. Instale o Claude Code (https://claude.com/claude-code) e tente de novo.", "Couldn't find the `claude` command. Install Claude Code (https://claude.com/claude-code) and try again."),
    )?;
    cancel_login(&a.id);
    let dir = config_dir(a);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut cmd = Command::new(&claude);
    cmd.args(["auth", "login", "--claudeai"]);
    if a.config_dir.is_some() {
        cmd.env("CLAUDE_CONFIG_DIR", &dir);
    } else {
        cmd.env_remove("CLAUDE_CONFIG_DIR");
    }
    cmd.env_remove("CLAUDECODE");
    let mut path: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    for extra in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] {
        if !path.contains(&PathBuf::from(extra)) {
            path.push(extra.into());
        }
    }
    if let Some(d) = claude.parent() {
        path.insert(0, d.to_path_buf());
    }
    if let Ok(j) = std::env::join_paths(path) {
        cmd.env("PATH", j);
    }
    cmd.current_dir(crate::xray::util::home()).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| crate::trf!("não deu para abrir o Claude Code: {e}", "couldn't open Claude Code: {e}"))?;
    if let (Some(stdin), Ok(mut map)) = (child.stdin.take(), LOGINS.lock()) {
        map.get_or_insert_with(HashMap::new).insert(a.id.clone(), (child.id(), stdin));
    }
    // a saída traz o endereço da página ("visit: https://…"); o resto fica para a mensagem de erro
    let mut out = String::new();
    if let Some(stdout) = child.stdout.take() {
        let mut r = BufReader::new(stdout);
        let mut line = String::new();
        while r.read_line(&mut line).unwrap_or(0) > 0 {
            if let Some(i) = line.find("https://") {
                on_url(line[i..].trim().to_string());
            } else {
                out.push_str(&line);
            }
            line.clear();
        }
    }
    let mut err = String::new();
    if let Some(mut e) = child.stderr.take() {
        let _ = e.read_to_string(&mut err);
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    let canceled = LOGINS.lock().ok().and_then(|mut m| m.as_mut().and_then(|m| m.remove(&a.id))).is_none();
    if status.success() {
        return Ok(());
    }
    if canceled {
        return Err("Login cancelado.".into());
    }
    let why = format!("{err}\n{out}").lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with("Paste code")).last().unwrap_or("").to_string();
    Err(if why.is_empty() { crate::i18n::tr("O login não terminou. Tente de novo.", "Sign-in didn't finish. Try again.").into() } else { crate::trf!("O login não terminou: {why}", "Sign-in didn't finish: {why}") })
}

/// Cola o código que a página mostra (quando o navegador não volta sozinho para o Claude Code).
pub fn login_code(id: &str, code: &str) -> Result<(), String> {
    use std::io::Write;
    let mut map = LOGINS.lock().map_err(|e| e.to_string())?;
    let (_, stdin) = map.as_mut().and_then(|m| m.get_mut(id)).ok_or(crate::i18n::tr("Nenhum login em andamento para esta conta.", "No sign-in in progress for this account."))?;
    writeln!(stdin, "{}", code.trim()).and_then(|_| stdin.flush()).map_err(|e| e.to_string())
}

/// Desiste do login em andamento.
pub fn cancel_login(id: &str) {
    let gone = LOGINS.lock().ok().and_then(|mut m| m.as_mut().and_then(|m| m.remove(id)));
    if let Some((pid, stdin)) = gone {
        drop(stdin);
        let _ = std::process::Command::new("kill").arg(pid.to_string()).status();
    }
}

/// Abre um terminal com o Claude Code usando a pasta desta conta. Com `cwd`, já dentro do
/// projeto (o Claude lê o .claude/settings.local.json de lá, onde está o nível de acesso).
pub fn open_terminal(a: &Account, cwd: Option<&Path>) -> Result<(), String> {
    let claude = crate::xray::util::which("claude").ok_or(
        crate::i18n::tr("Não achei o comando `claude`. Instale o Claude Code (https://claude.com/claude-code) e tente de novo.", "Couldn't find the `claude` command. Install Claude Code (https://claude.com/claude-code) and try again."),
    )?;
    let dir = config_dir(a);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let claude = claude.to_string_lossy().to_string();
    let dir_s = dir.to_string_lossy().to_string();
    let home = crate::xray::util::home();
    let cwd = cwd.map(Path::to_path_buf).unwrap_or(home);
    let cwd_s = cwd.to_string_lossy().to_string();

    #[cfg(target_os = "macos")]
    {
        let q = |s: &str| format!("'{}'", s.replace('\'', r"'\''"));
        let mut script = String::from("#!/bin/zsh\nclear\n");
        if a.config_dir.is_some() {
            script += &format!("export CLAUDE_CONFIG_DIR={}\n", q(&dir_s));
        }
        script += &format!("echo {}\n", q(&crate::trf!("Veocode · conta: {}", "Veocode · account: {}", a.label)));
        script += &format!("echo {}\n", q(&crate::trf!("Pasta: {cwd_s}", "Folder: {cwd_s}")));
        script += crate::i18n::tr("echo 'Se o Claude pedir login, digite /login.'\necho\n", "echo 'If Claude asks you to sign in, type /login.'\necho\n");
        script += &format!("cd {} || exit 1\nexec {}\n", q(&cwd_s), q(&claude));
        let file = std::env::temp_dir().join(format!("veocode-claude-{}.command", a.id));
        fs::write(&file, script).map_err(|e| e.to_string())?;
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&file, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
        std::process::Command::new("open").arg(&file).spawn().map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        let mut c = std::process::Command::new("cmd");
        c.args(["/c", "start", "Veocode - Claude", "cmd", "/k"]).arg(&claude);
        if a.config_dir.is_some() {
            c.env("CLAUDE_CONFIG_DIR", &dir_s);
        }
        c.current_dir(&cwd_s);
        c.spawn().map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err(crate::trf!("Abra um terminal na pasta {cwd_s} e rode: CLAUDE_CONFIG_DIR=\"{dir_s}\" {claude}", "Open a terminal in the folder {cwd_s} and run: CLAUDE_CONFIG_DIR=\"{dir_s}\" {claude}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn counts_each_answer_once_and_buckets_by_day() {
        let tmp = tempfile::tempdir().unwrap();
        let proj = tmp.path().join("projects/p");
        fs::create_dir_all(&proj).unwrap();
        let now = Utc::now();
        let ts = now.to_rfc3339();
        let old = (now - chrono::Duration::days(3)).to_rfc3339();
        let mut f = fs::File::create(proj.join("s.jsonl")).unwrap();
        let line = |id: &str, ts: &str, o: u64| {
            format!(r#"{{"type":"assistant","timestamp":"{ts}","sessionId":"s1","message":{{"id":"{id}","model":"claude-opus-5-5","usage":{{"input_tokens":10,"cache_creation_input_tokens":5,"cache_read_input_tokens":9999,"output_tokens":{o}}}}}}}"#)
        };
        writeln!(f, "{}", line("m1", &ts, 100)).unwrap();
        writeln!(f, "{}", line("m1", &ts, 100)).unwrap(); // repetida
        writeln!(f, "{}", line("m2", &old, 1)).unwrap();
        writeln!(f, r#"{{"type":"user","message":{{"content":"oi"}}}}"#).unwrap();
        drop(f);

        let mut cache = UsageCache::default();
        let u = usage(tmp.path(), &mut cache);
        assert_eq!(u.today, 115, "entrada 10 + criação de cache 5 + saída 100; leitura de cache fora");
        assert_eq!(u.messages_today, 1);
        assert_eq!(u.sessions_today, 1);
        assert_eq!(u.days.len(), 7);
        assert_eq!(u.days[6], 115);
        assert_eq!(u.days.iter().sum::<u64>(), 115 + 16);
        assert_eq!(u.models[0].0, "claude-opus-5-5");
        // segunda leitura vem do cache e dá o mesmo resultado
        assert_eq!(usage(tmp.path(), &mut cache), u);
    }

    #[test]
    fn identity_reads_plan_without_touching_tokens() {
        let tmp = tempfile::tempdir().unwrap();
        let a = Account {
            id: "x".into(),
            label: "x".into(),
            provider: super::super::Provider::Claude,
            color: "#fff".into(),
            model: None,
            config_dir: Some(tmp.path().to_string_lossy().into()),
            base_url: None,
            key_hint: None,
            created_at: 0,
        };
        assert!(identity(&a).is_none());
        fs::write(tmp.path().join(".claude.json"), r#"{"oauthAccount":{"organizationType":"claude_max","emailAddress":"a@b.c"}}"#).unwrap();
        assert_eq!(identity(&a), Some(("Max".into(), Some("a@b.c".into()))));
    }
}

/// Diagnóstico manual (só leitura): `cargo test real_claude_usage -- --ignored --nocapture`
#[cfg(test)]
#[test]
#[ignore]
fn real_claude_usage() {
    let a = Account { id: "x".into(), label: "x".into(), provider: super::Provider::Claude, color: String::new(), model: None, config_dir: None, base_url: None, key_hint: None, created_at: 0 };
    let mut cache = UsageCache::default();
    let t = std::time::Instant::now();
    let s = status(&a, &mut cache);
    println!("1ª leitura {:?}", t.elapsed());
    let t = std::time::Instant::now();
    let s2 = status(&a, &mut cache);
    println!("2ª leitura (cache) {:?}", t.elapsed());
    println!("estado {:?} plano {:?} ativo {}", s.state, s.plan, s2.active);
    if let Some(u) = s2.usage {
        println!("hoje {} (saída {}) · 5h {} · sessões {} · msgs {} · última há {:?}s", u.today, u.today_out, u.last5h, u.sessions_today, u.messages_today, u.last_active_secs);
        println!("7 dias {:?}", u.days);
        println!("modelos {:?}", u.models);
    }
}
