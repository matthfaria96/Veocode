//! Rastro de um projeto: o que a IA deixou por causa dele.
//!
//! Lê os históricos do Claude Code daquele projeto (só leitura) e junta:
//! - pastas e arquivos que ela criou ou mexeu FORA da pasta do projeto (ex.: um "studio" do jogo
//!   criado ao lado). Ficam guardados em `trail/<projeto>.json` na pasta de dados do app, para o
//!   vínculo não sumir quando os históricos forem apagados;
//! - sites que ela abriu e buscas que fez, e conexões (MCP) que usou;
//! - modelos de IA locais que ela baixou (ollama pull…);
//! - sobras dentro da pasta: registros de depuração, cópias de segurança, temporários e arquivos
//!   que ela criou e ainda estão fora do git.
//!
//! Nada aqui muda arquivos; mover sobras para a Lixeira é outro comando, sempre confirmado.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::agent::encode;

const MAX_FILE: u64 = 300 * 1024 * 1024;
const MAX_LEFTOVERS: usize = 300;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Outside {
    pub path: String,
    pub exists: bool,
    pub is_dir: bool,
    pub bytes: u64,
    pub files: usize,
    /// Como apareceu, em palavras: "a IA escreveu 12 arquivos aqui", "vinculada por você"…
    pub how: String,
    /// Quando a IA mexeu por último (ms), 0 se não se sabe.
    pub last: i64,
    /// Ligada por você (e não achada nos históricos).
    pub manual: bool,
    /// Pasta temporária do sistema (some sozinha).
    pub temporary: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    /// "pagina" | "busca" | "conexao"
    pub kind: &'static str,
    /// Endereço do site, texto buscado ou nome da conexão.
    pub label: String,
    /// Exemplos (até 5 endereços da mesma página/site, ou ferramentas da conexão).
    pub examples: Vec<String>,
    pub count: usize,
    pub last: i64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Leftover {
    /// Caminho dentro do projeto.
    pub path: String,
    /// "depuracao" | "copia" | "temporario" | "ia"
    pub kind: &'static str,
    pub why: String,
    pub bytes: u64,
    pub is_dir: bool,
    pub modified: i64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalModel {
    pub name: String,
    /// "ollama" | "huggingface" | "lmstudio"
    pub tool: &'static str,
    pub command: String,
    pub last: i64,
}

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Trail {
    pub outside: Vec<Outside>,
    pub sources: Vec<Source>,
    pub leftovers: Vec<Leftover>,
    pub leftovers_bytes: u64,
    pub models: Vec<LocalModel>,
    /// Históricos lidos (0: a IA nunca trabalhou aqui pelo Claude Code).
    pub sessions: usize,
}

// ---------------------------------------------------------------- guardado

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct Link {
    pub path: String,
    pub how: String,
    #[serde(default)]
    pub last: i64,
    #[serde(default)]
    pub manual: bool,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct Saved {
    #[serde(default)]
    pub links: Vec<Link>,
    /// Caminhos que a pessoa mandou esquecer (não voltam mesmo achados de novo).
    #[serde(default)]
    pub hidden: Vec<String>,
}

pub fn store_file(data: &Path, project: &str) -> PathBuf {
    data.join("trail").join(format!("{project}.json"))
}

pub fn load(file: &Path) -> Saved {
    fs::read_to_string(file).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

pub fn save(file: &Path, s: &Saved) -> Result<(), String> {
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = file.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(s).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(&tmp, file).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------- caminhos

fn ms(t: SystemTime) -> i64 {
    t.duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Junta `..` e `.` sem tocar no disco.
fn clean(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

fn expand(raw: &str, home: &Path, root: &Path) -> Option<PathBuf> {
    let raw = raw.trim_matches(|c| c == '"' || c == '\'' || c == ',' || c == ';' || c == ')' || c == '(');
    if raw.is_empty() || raw.contains("://") || raw.contains('*') || raw.contains('$') {
        return None;
    }
    let p = if let Some(rest) = raw.strip_prefix("~/") {
        home.join(rest)
    } else if raw.starts_with('/') {
        PathBuf::from(raw)
    } else if raw.starts_with("../") {
        root.join(raw)
    } else {
        return None;
    };
    Some(clean(&p))
}

/// Lugares que nunca contam como "pasta criada pelo projeto": o sistema, ferramentas e a
/// configuração do próprio Claude e do Veocode.
fn ignored(p: &Path, home: &Path) -> bool {
    const SYS: &[&str] = &["/usr", "/bin", "/sbin", "/etc", "/dev", "/System", "/Library", "/opt", "/proc", "/sys", "/var/folders", "/private/var/folders", "/nix", "/Applications"];
    if !p.starts_with(home) && SYS.iter().any(|s| p.starts_with(s)) {
        return true;
    }
    const HOME: &[&str] = &[".claude", ".claude.json", ".config/claude", ".npm", ".cargo", ".rustup", ".cache", ".bun", ".nvm", ".pyenv", ".local/share", ".ssh", ".gitconfig", ".zshrc", ".bashrc", ".zprofile", ".Trash", "Library"];
    if let Ok(rel) = p.strip_prefix(home) {
        if rel.as_os_str().is_empty() {
            return true;
        }
        if HOME.iter().any(|h| rel.starts_with(h)) {
            return true;
        }
    }
    if is_temp(p) {
        return true; // pastas temporárias do sistema somem sozinhas (e é onde o Claude rascunha)
    }
    p.components().any(|c| c.as_os_str().to_string_lossy().starts_with(".claude"))
}

/// Âncora rasa demais para ser "uma pasta do projeto": a raiz, a pasta pessoal ou as pastas
/// padrão dela (Documentos, Downloads, Mesa…).
fn too_broad(a: &Path, home: &Path) -> bool {
    if a.components().count() < 3 || a == home {
        return true;
    }
    a.parent() == Some(home) && a.is_dir() && matches!(a.file_name().and_then(|n| n.to_str()), Some("Documents" | "Downloads" | "Desktop" | "Pictures" | "Movies" | "Music" | "Public" | "Applications"))
}

fn is_temp(p: &Path) -> bool {
    p.starts_with("/tmp") || p.starts_with("/private/tmp") || p.starts_with("/var/tmp")
}

/// A pasta que representa um caminho de fora: a filha da pasta-mãe do projeto
/// (ex.: `~/Documents/Jogo-Studio`), a segunda pasta dentro da pasta pessoal
/// (ex.: `~/Desktop/studio`), ou a segunda pasta a partir da raiz.
fn anchor(p: &Path, root: &Path, home: &Path) -> PathBuf {
    let take = |base: &Path, n: usize| -> PathBuf {
        let rel = p.strip_prefix(base).unwrap_or(p);
        let mut out = base.to_path_buf();
        for c in rel.components().take(n) {
            out.push(c.as_os_str());
        }
        out
    };
    if let Some(parent) = root.parent() {
        if p.starts_with(parent) && parent != home && parent.parent().is_some() {
            return take(parent, 1);
        }
    }
    if p.starts_with(home) {
        let depth = p.strip_prefix(home).map(|r| r.components().count()).unwrap_or(0);
        return take(home, if depth <= 2 { depth } else { 2 });
    }
    let b = Path::new("/");
    take(b, 2)
}

/// Para onde um comando escreve: só os destinos (em `cp a b`, só `b`; em `mkdir x y`, os dois;
/// depois de `>`, `-o`, `-d`, `-C`…). Origens e comandos de só olhar não contam.
fn targets(cmd: &str) -> Vec<String> {
    let mut out = vec![];
    for seg in cmd.split(['\n', ';', '|']).flat_map(|s| s.split("&&")) {
        let words: Vec<&str> = seg.split_whitespace().collect();
        // redirecionamentos valem para qualquer comando
        for (i, w) in words.iter().enumerate() {
            if *w == ">" || *w == ">>" {
                if let Some(t) = words.get(i + 1) {
                    out.push(t.to_string());
                }
            } else if let Some(t) = w.strip_prefix(">>").or_else(|| w.strip_prefix('>')) {
                if !t.is_empty() && !t.starts_with('&') {
                    out.push(t.to_string());
                }
            }
        }
        let mut it = words.iter().copied().skip_while(|w| *w == "sudo" || w.contains('='));
        let Some(verb) = it.next() else { continue };
        let args: Vec<&str> = it.take_while(|w| !w.starts_with('>')).collect();
        let plain: Vec<&str> = args.iter().copied().filter(|a| !a.starts_with('-')).collect();
        let after = |flags: &[&str]| args.iter().position(|a| flags.contains(a)).and_then(|i| args.get(i + 1)).map(|s| s.to_string());
        match verb {
            "mkdir" | "touch" | "tee" => out.extend(plain.iter().map(|s| s.to_string())),
            "cp" | "mv" | "rsync" | "ln" | "install" | "ditto" => out.extend(plain.last().map(|s| s.to_string())),
            "git" if args.first() == Some(&"clone") => out.extend(plain.get(2).or(plain.last()).map(|s| s.to_string())),
            "curl" | "wget" => out.extend(after(&["-o", "-O", "--output", "--output-document"])),
            "unzip" => out.extend(after(&["-d"])),
            "tar" => out.extend(after(&["-C", "--directory"])),
            "cargo" | "npm" | "npx" | "pnpm" | "yarn" | "bun" | "dotnet" | "flutter" | "godot" => {
                if args.iter().any(|a| matches!(*a, "new" | "init" | "create" | "--path")) {
                    out.extend(plain.last().map(|s| s.to_string()));
                }
            }
            _ => {}
        }
    }
    out
}

// ---------------------------------------------------------------- históricos

/// Históricos do projeto e das subpastas dele (o Claude aberto em `projeto/ferramentas`
/// grava em outra pasta). Pastas com o mesmo começo de nome (ex.: `Jogo-Studio`) só
/// entram se o histórico disser que trabalhou dentro do projeto.
fn session_files(dirs: &[PathBuf], root: &Path) -> Vec<PathBuf> {
    let enc = encode(root);
    let mut out = vec![];
    for d in dirs {
        let Ok(rd) = fs::read_dir(d.join("projects")) else { continue };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name == enc {
                walk_jsonl(&e.path(), 3, &mut out);
            } else if name.starts_with(&format!("{enc}-")) {
                let mut found = vec![];
                walk_jsonl(&e.path(), 3, &mut found);
                if found.first().and_then(|f| cwd_of(f)).is_some_and(|c| Path::new(&c).starts_with(root)) {
                    out.extend(found);
                }
            }
        }
    }
    out
}

/// Pasta em que a sessão trabalhou (campo `cwd` das primeiras linhas).
fn cwd_of(file: &Path) -> Option<String> {
    let fh = fs::File::open(file).ok()?;
    BufReader::new(fh).lines().map_while(Result::ok).take(30).find_map(|l| serde_json::from_str::<Value>(&l).ok()?.get("cwd")?.as_str().map(str::to_string))
}

fn walk_jsonl(dir: &Path, depth: u8, out: &mut Vec<PathBuf>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            if depth > 0 {
                walk_jsonl(&p, depth - 1, out);
            }
        } else if p.extension().is_some_and(|x| x == "jsonl") {
            out.push(p);
        }
    }
}

fn ts_of(v: &Value, fallback: i64) -> i64 {
    v.get("timestamp").and_then(Value::as_str).and_then(parse_iso).unwrap_or(fallback)
}

/// "2026-11-04T21:46:26.005Z" → ms (só UTC, que é o que o Claude Code grava).
fn parse_iso(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 19 {
        return None;
    }
    let n = |a: usize, l: usize| s.get(a..a + l)?.parse::<i64>().ok();
    let (y, mo, d, h, mi, se) = (n(0, 4)?, n(5, 2)?, n(8, 2)?, n(11, 2)?, n(14, 2)?, n(17, 2)?);
    // dias desde 1970 (algoritmo de Howard Hinnant)
    let y2 = if mo <= 2 { y - 1 } else { y };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let mp = (mo + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    Some(((days * 86400 + h * 3600 + mi * 60 + se) * 1000).max(0))
}

#[derive(Default)]
struct Found {
    /// âncora → (arquivos escritos, criada por comando, último ms, exemplo de comando)
    outside: HashMap<PathBuf, (HashSet<PathBuf>, bool, i64, Option<String>)>,
    /// arquivos escritos dentro do projeto (caminho relativo)
    inside: HashSet<String>,
    sources: HashMap<(&'static str, String), (HashSet<String>, usize, i64)>,
    models: HashMap<(&'static str, String), (String, i64)>,
}

pub(crate) fn model_of(cmd: &str) -> Option<(&'static str, String)> {
    let words: Vec<&str> = cmd.split_whitespace().collect();
    for (i, w) in words.iter().enumerate() {
        let next = || words.get(i + 2).map(|s| s.trim_matches(|c| c == '"' || c == '\'').to_string());
        match (*w, words.get(i + 1).copied()) {
            ("ollama", Some("pull" | "run")) => return next().filter(|m| !m.starts_with('-')).map(|m| ("ollama", m)),
            ("huggingface-cli" | "hf", Some("download")) => return next().filter(|m| !m.starts_with('-')).map(|m| ("huggingface", m)),
            ("lms", Some("get")) => return next().filter(|m| !m.starts_with('-')).map(|m| ("lmstudio", m)),
            _ => {}
        }
    }
    None
}

fn host_of(url: &str) -> String {
    let rest = url.split_once("://").map(|(_, r)| r).unwrap_or(url);
    rest.split(['/', '?', '#']).next().unwrap_or(rest).trim_start_matches("www.").to_string()
}

fn read_session(file: &Path, root: &Path, home: &Path, f: &mut Found) {
    let Ok(meta) = fs::metadata(file) else { return };
    if meta.len() > MAX_FILE {
        return;
    }
    let fallback = meta.modified().map(ms).unwrap_or(0);
    let Ok(fh) = fs::File::open(file) else { return };
    for line in BufReader::new(fh).lines().map_while(Result::ok) {
        if !line.contains("\"tool_use\"") {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        let when = ts_of(&v, fallback);
        let Some(items) = v.pointer("/message/content").and_then(Value::as_array) else { continue };
        for it in items {
            if it.get("type").and_then(Value::as_str) != Some("tool_use") {
                continue;
            }
            let name = it.get("name").and_then(Value::as_str).unwrap_or("");
            let input = it.get("input").cloned().unwrap_or(Value::Null);
            let s = |k: &str| input.get(k).and_then(Value::as_str).unwrap_or("").to_string();
            match name {
                "Write" | "Edit" | "MultiEdit" | "NotebookEdit" => {
                    let raw = if name == "NotebookEdit" { s("notebook_path") } else { s("file_path") };
                    let Some(p) = expand(&raw, home, root) else { continue };
                    if let Ok(rel) = p.strip_prefix(root) {
                        f.inside.insert(rel.to_string_lossy().replace('\\', "/"));
                    } else if !ignored(&p, home) && !too_broad(&anchor(&p, root, home), home) {
                        let e = f.outside.entry(anchor(&p, root, home)).or_default();
                        e.0.insert(p);
                        e.2 = e.2.max(when);
                    }
                }
                "Bash" => {
                    let cmd = s("command");
                    if let Some((tool, m)) = model_of(&cmd) {
                        let e = f.models.entry((tool, m)).or_insert((cmd.chars().take(160).collect(), 0));
                        e.1 = e.1.max(when);
                    }
                    for tok in targets(&cmd) {
                        let Some(p) = expand(&tok, home, root) else { continue };
                        if p.starts_with(root) || ignored(&p, home) || !p.exists() {
                            continue;
                        }
                        let a = anchor(&p, root, home);
                        if too_broad(&a, home) {
                            continue;
                        }
                        let e = f.outside.entry(a).or_default();
                        e.1 = true;
                        e.2 = e.2.max(when);
                        e.3.get_or_insert_with(|| cmd.chars().take(160).collect());
                    }
                }
                "WebFetch" => {
                    let url = s("url");
                    if url.is_empty() {
                        continue;
                    }
                    let e = f.sources.entry(("pagina", host_of(&url))).or_default();
                    e.0.insert(url);
                    e.1 += 1;
                    e.2 = e.2.max(when);
                }
                "WebSearch" => {
                    let q = s("query");
                    if q.is_empty() {
                        continue;
                    }
                    let e = f.sources.entry(("busca", q.chars().take(140).collect())).or_default();
                    e.1 += 1;
                    e.2 = e.2.max(when);
                }
                n if n.starts_with("mcp__") => {
                    let mut parts = n.splitn(3, "__").skip(1);
                    let server = parts.next().unwrap_or("").to_string();
                    // ferramentas do próprio app do Claude (lista de tarefas, telas…) não são fontes de fora
                    if server.starts_with("ccd_") || matches!(server.as_str(), "visualize" | "mcp-registry" | "scheduled-tasks") {
                        continue;
                    }
                    let tool = parts.next().unwrap_or("").to_string();
                    let e = f.sources.entry(("conexao", server)).or_default();
                    e.0.insert(tool);
                    e.1 += 1;
                    e.2 = e.2.max(when);
                }
                _ => {}
            }
        }
    }
}

/// Tamanho e número de arquivos (para em 20 mil arquivos ou 2 s).
fn measure(p: &Path) -> (u64, usize) {
    let start = std::time::Instant::now();
    let mut bytes = 0;
    let mut n = 0;
    let mut stack = vec![p.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(rd) = fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            let Ok(m) = e.metadata() else { continue };
            if m.is_dir() {
                stack.push(e.path());
            } else {
                bytes += m.len();
                n += 1;
            }
            if n > 20_000 || start.elapsed() > Duration::from_secs(2) {
                return (bytes, n);
            }
        }
    }
    (bytes, n)
}

// ---------------------------------------------------------------- sobras dentro da pasta

/// Pastas pesadas e esperadas que não vale abrir (são do projeto, não sobras).
const SKIP: &[&str] = &[".git", "node_modules", "target", "dist", "build", ".next", ".venv", "venv", "env", ".gradle", "Pods", "DerivedData", ".godot", "Library", ".idea", ".vscode", "Intermediate", "Binaries", "DerivedDataCache", ".expo", ".turbo", ".svelte-kit", "vendor"];

fn classify(name: &str, is_dir: bool) -> Option<(&'static str, &'static str)> {
    let n = name.to_lowercase();
    if is_dir {
        return match n.as_str() {
            "__pycache__" | ".pytest_cache" | ".mypy_cache" | ".ruff_cache" | "tmp" | "temp" | ".tmp" => Some(("temporario", "pasta temporária: é refeita sozinha quando precisa")),
            "backup" | "backups" | "bkp" | "old" | "_old" | "bak" => Some(("copia", "pasta de cópias antigas")),
            "logs" | "debug" => Some(("depuracao", "pasta de registros de depuração")),
            _ if n.starts_with("backup") || n.ends_with("_backup") || n.ends_with("-backup") || n.ends_with(".bak") => Some(("copia", "pasta de cópias antigas")),
            _ => None,
        };
    }
    let ext = n.rsplit_once('.').map(|(_, e)| e).unwrap_or("");
    if matches!(ext, "log" | "trace") || n.starts_with("npm-debug") || n.starts_with("yarn-error") || n.starts_with("debug") && matches!(ext, "txt" | "log" | "json") || (n.starts_with("crash") && matches!(ext, "dmp" | "crash" | "log" | "ips")) || matches!(ext, "dmp" | "ips") || n == "core" {
        return Some(("depuracao", "registro de depuração"));
    }
    if matches!(ext, "bak" | "backup" | "old" | "orig" | "rej") || n.ends_with('~') || n.contains(" copy") || n.contains(" cópia") || n.contains(" (1)") || n.contains("_backup") || n.contains(".backup") {
        return Some(("copia", "cópia de segurança ou versão antiga"));
    }
    if matches!(ext, "tmp" | "temp" | "swp" | "swo" | "pyc") || n.starts_with(".~lock") {
        return Some(("temporario", "arquivo temporário"));
    }
    None
}

fn untracked(root: &Path) -> Option<HashSet<String>> {
    let out = std::process::Command::new("git")
        .args(["status", "--porcelain", "--untracked-files=all", "-z"])
        .current_dir(root)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    Some(text.split('\0').filter_map(|e| e.strip_prefix("?? ")).map(|p| p.trim_end_matches('/').to_string()).collect())
}

fn leftovers(root: &Path, ai_written: &HashSet<String>) -> Vec<Leftover> {
    let mut out = vec![];
    let start = std::time::Instant::now();
    let mut stack = vec![(root.to_path_buf(), 0u8)];
    while let Some((d, depth)) = stack.pop() {
        let Ok(rd) = fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            let Ok(m) = fs::symlink_metadata(e.path()) else { continue };
            let name = e.file_name().to_string_lossy().to_string();
            let p = e.path();
            let rel = p.strip_prefix(root).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_default();
            let is_dir = m.is_dir();
            if let Some((kind, why)) = classify(&name, is_dir) {
                let bytes = if is_dir { measure(&p).0 } else { m.len() };
                out.push(Leftover { path: rel, kind, why: why.into(), bytes, is_dir, modified: m.modified().map(ms).unwrap_or(0) });
                continue;
            }
            if is_dir && depth < 8 && !SKIP.contains(&name.as_str()) && !m.file_type().is_symlink() {
                stack.push((p, depth + 1));
            }
            if out.len() >= MAX_LEFTOVERS || start.elapsed() > Duration::from_secs(3) {
                break;
            }
        }
    }
    // o que a IA escreveu e ainda está fora do git (e não é sobra já listada)
    if let Some(un) = untracked(root) {
        let listed: HashSet<String> = out.iter().map(|l| l.path.clone()).collect();
        for rel in ai_written {
            if out.len() >= MAX_LEFTOVERS {
                break;
            }
            if !un.contains(rel) || listed.contains(rel) {
                continue;
            }
            let p = root.join(rel);
            let Ok(m) = fs::metadata(&p) else { continue };
            out.push(Leftover { path: rel.clone(), kind: "ia", why: "a IA criou e ainda não está no git".into(), bytes: m.len(), is_dir: false, modified: m.modified().map(ms).unwrap_or(0) });
        }
    }
    out.sort_by(|a, b| b.bytes.cmp(&a.bytes));
    out
}

// ---------------------------------------------------------------- relatório

pub fn report(root: &Path, claude_dirs: &[PathBuf], home: &Path, saved: &mut Saved) -> Trail {
    let files = session_files(claude_dirs, root);
    let mut f = Found::default();
    for file in &files {
        read_session(file, root, home, &mut f);
    }

    // junta o que achou com o que estava guardado (o vínculo não some com o histórico)
    let hidden: HashSet<&str> = saved.hidden.iter().map(String::as_str).collect();
    let mut links: BTreeMap<String, Link> = saved.links.iter().map(|l| (l.path.clone(), l.clone())).collect();
    for (anchor, (written, by_cmd, last, cmd)) in &f.outside {
        let key = anchor.to_string_lossy().to_string();
        if hidden.contains(key.as_str()) {
            continue;
        }
        let how = match (written.len(), by_cmd) {
            (0, _) => match cmd {
                Some(c) => format!("a IA criou ou copiou para cá com um comando: {c}"),
                None => "a IA criou ou copiou para cá com um comando".into(),
            },
            (1, false) => "a IA escreveu 1 arquivo aqui".into(),
            (n, false) => format!("a IA escreveu {n} arquivos aqui"),
            (n, true) => format!("a IA criou esta pasta e escreveu {n} arquivo{} nela", if n == 1 { "" } else { "s" }),
        };
        let e = links.entry(key.clone()).or_insert(Link { path: key, how: how.clone(), last: *last, manual: false });
        if !e.manual {
            e.how = how;
        }
        e.last = e.last.max(*last);
    }
    saved.links = links.into_values().collect();

    let outside = saved
        .links
        .iter()
        .map(|l| {
            let p = PathBuf::from(&l.path);
            let meta = fs::metadata(&p).ok();
            let is_dir = meta.as_ref().is_some_and(|m| m.is_dir());
            let (bytes, files) = match &meta {
                Some(m) if m.is_dir() => measure(&p),
                Some(m) => (m.len(), 1),
                None => (0, 0),
            };
            Outside { path: l.path.clone(), exists: meta.is_some(), is_dir, bytes, files, how: l.how.clone(), last: l.last, manual: l.manual, temporary: is_temp(&p) }
        })
        .collect::<Vec<_>>();

    let mut sources: Vec<Source> = f
        .sources
        .into_iter()
        .map(|((kind, label), (ex, count, last))| {
            let mut examples: Vec<String> = ex.into_iter().collect();
            examples.sort();
            examples.truncate(5);
            Source { kind, label, examples, count, last }
        })
        .collect();
    sources.sort_by(|a, b| b.last.cmp(&a.last));

    let mut models: Vec<LocalModel> = f.models.into_iter().map(|((tool, name), (command, last))| LocalModel { name, tool, command, last }).collect();
    models.sort_by(|a, b| b.last.cmp(&a.last));

    let leftovers = leftovers(root, &f.inside);
    let leftovers_bytes = leftovers.iter().map(|l| l.bytes).sum();
    let mut outside = outside;
    outside.sort_by(|a, b| b.exists.cmp(&a.exists).then(b.last.cmp(&a.last)));
    Trail { outside, sources, leftovers, leftovers_bytes, models, sessions: files.len() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("veocode-trail-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn iso_dates() {
        assert_eq!(parse_iso("1970-01-01T00:00:00.000Z"), Some(0));
        assert_eq!(parse_iso("2026-11-04T21:46:26.005Z"), Some(1_793_828_786_000));
    }

    #[test]
    fn finds_what_the_ai_left_outside_and_inside() {
        let base = tmp("rastro");
        let home = base.join("home");
        let root = home.join("Documents/Jogo");
        let studio = home.join("Documents/Jogo-Studio");
        fs::create_dir_all(root.join("src")).unwrap();
        fs::create_dir_all(&studio).unwrap();
        fs::write(studio.join("editor.gd"), "x").unwrap();
        fs::write(root.join("debug.log"), "erro").unwrap();
        fs::write(root.join("src/main.rs.bak"), "velho").unwrap();
        fs::create_dir_all(root.join("__pycache__")).unwrap();
        let cfg = base.join("cfg");
        let sess = cfg.join("projects").join(encode(&root));
        fs::create_dir_all(&sess).unwrap();
        let line = |name: &str, input: Value| json!({"timestamp":"2026-11-04T21:46:26.005Z","message":{"content":[{"type":"tool_use","name":name,"input":input}]}}).to_string();
        let lines = [
            line("Write", json!({"file_path": studio.join("editor.gd").to_string_lossy()})),
            line("Bash", json!({"command": format!("mkdir -p {}", studio.display())})),
            line("Bash", json!({"command": "ls /Users"})),
            line("Bash", json!({"command": "ollama pull llama3.2"})),
            line("WebFetch", json!({"url": "https://docs.godotengine.org/en/stable/x.html"})),
            line("WebSearch", json!({"query": "godot editor plugin"})),
            line("mcp__figma__get_file", json!({})),
            line("Write", json!({"file_path": home.join(".claude/plans/p.md").to_string_lossy()})),
        ];
        fs::write(sess.join("s1.jsonl"), lines.join("\n")).unwrap();

        let mut saved = Saved::default();
        let t = report(&root, &[cfg.clone()], &home, &mut saved);
        assert_eq!(t.sessions, 1);
        assert_eq!(t.outside.len(), 1, "{:?}", t.outside);
        assert_eq!(t.outside[0].path, studio.to_string_lossy());
        assert!(t.outside[0].exists && t.outside[0].how.contains("criou esta pasta"));
        assert!(t.models.iter().any(|m| m.name == "llama3.2" && m.tool == "ollama"));
        assert!(t.sources.iter().any(|s| s.kind == "pagina" && s.label == "docs.godotengine.org"));
        assert!(t.sources.iter().any(|s| s.kind == "busca"));
        assert!(t.sources.iter().any(|s| s.kind == "conexao" && s.label == "figma"));
        let kinds: HashSet<_> = t.leftovers.iter().map(|l| l.kind).collect();
        assert!(kinds.contains("depuracao") && kinds.contains("copia") && kinds.contains("temporario"), "{:?}", t.leftovers);

        // o vínculo continua depois que o histórico some
        fs::remove_dir_all(&sess).unwrap();
        let t2 = report(&root, &[cfg], &home, &mut saved);
        assert_eq!(t2.outside.len(), 1);
        let _ = fs::remove_dir_all(&base);
    }
}

#[cfg(test)]
mod real {
    /// `VEOCODE_TRAIL=/caminho/do/projeto cargo test --release real_trail -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn real_trail() {
        let Ok(root) = std::env::var("VEOCODE_TRAIL") else { return };
        let home = crate::xray::util::home();
        let t0 = std::time::Instant::now();
        let mut saved = super::Saved::default();
        let t = super::report(std::path::Path::new(&root), &[home.join(".claude")], &home, &mut saved);
        println!("em {:?}: {} sessões", t0.elapsed(), t.sessions);
        for o in &t.outside { println!("FORA {} existe={} {} B {} arq — {}", o.path, o.exists, o.bytes, o.files, o.how); }
        for s in t.sources.iter().take(15) { println!("FONTE {} {} x{} {:?}", s.kind, s.label, s.count, s.examples.first()); }
        for m in &t.models { println!("MODELO {} {}", m.tool, m.name); }
        println!("SOBRAS {} ({} B)", t.leftovers.len(), t.leftovers_bytes);
        for l in t.leftovers.iter().take(15) { println!("  {} {} {} B", l.kind, l.path, l.bytes); }
    }
}

#[cfg(test)]
mod targets_tests {
    use super::targets;
    #[test]
    fn only_destinations() {
        assert_eq!(targets("cp \"/a/manga.pdf\" samples/x.pdf"), vec!["samples/x.pdf"]);
        assert_eq!(targets("mkdir -p ../Jogo-Studio/addons && ls /Users"), vec!["../Jogo-Studio/addons"]);
        assert_eq!(targets("echo oi > ~/notas/a.txt"), vec!["~/notas/a.txt"]);
        assert_eq!(targets("git clone https://x/y.git ../y"), vec!["../y"]);
        assert!(targets("cat /etc/hosts | grep a").is_empty());
    }
}
