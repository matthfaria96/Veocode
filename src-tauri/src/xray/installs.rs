//! "O que a IA instalou": lê os comandos que o Claude Code rodou (guardados nos
//! históricos .jsonl de cada sessão), acha os de instalação e confere se o pacote
//! continua instalado na máquina. Só leitura: para remover, mostramos o comando.

use super::util::run;
use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::Duration;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Manager {
    Brew,
    Npm,
    Pip,
    Cargo,
    Docker,
    Gem,
    Go,
}

impl Manager {
    fn remove_cmd(&self, pkg: &str) -> String {
        match self {
            Manager::Brew => format!("brew uninstall {pkg}"),
            Manager::Npm => format!("npm uninstall -g {pkg}"),
            Manager::Pip => format!("pip3 uninstall {pkg}"),
            Manager::Cargo => format!("cargo uninstall {pkg}"),
            Manager::Docker => format!("docker rmi {pkg}"),
            Manager::Gem => format!("gem uninstall {pkg}"),
            Manager::Go => format!("rm \"$(go env GOPATH)/bin/{}\"", pkg.rsplit('/').next().unwrap_or(pkg).split('@').next().unwrap_or(pkg)),
        }
    }
}

// ---------------------------------------------------------------------------
// 1. Entender um comando de shell
// ---------------------------------------------------------------------------

/// Flags que consomem o próximo token (ex.: `--version 1.2`, `-r requirements.txt`).
const FLAGS_WITH_VALUE: &[&str] = &[
    "-r", "-e", "-c", "-i", "-t", "--requirement", "--editable", "--constraint", "--index-url", "--extra-index-url", "--target", "--prefix", "--root",
    "--version", "--features", "--git", "--path", "--branch", "--tag", "--rev", "--registry", "--index", "--profile", "--bin", "-j", "--python",
];

fn clean_token(t: &str) -> String {
    t.trim_matches(|c| c == '"' || c == '\'').to_string()
}

fn packages_after(tokens: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    let mut skip = false;
    for t in tokens {
        if skip {
            skip = false;
            continue;
        }
        if FLAGS_WITH_VALUE.contains(&t.as_str()) {
            skip = true;
            continue;
        }
        if t.starts_with('-') || t == "." || t.contains('$') || t.contains('`') || t.contains('/') && t.starts_with('.') {
            continue;
        }
        if t.chars().all(|c| c.is_ascii_alphanumeric() || "@/._:-[]=<>~^+".contains(c)) && !t.is_empty() {
            out.push(t.clone());
        }
    }
    out
}

/// Nome "puro" do pacote, sem versão/extras: `requests[socks]>=2` → `requests`.
pub fn base_name(m: &Manager, raw: &str) -> String {
    match m {
        Manager::Npm => {
            // @escopo/pacote@1.2.3 → @escopo/pacote
            let s = raw.strip_prefix('@').map(|r| format!("@{}", r.split('@').next().unwrap_or(r))).unwrap_or_else(|| raw.split('@').next().unwrap_or(raw).to_string());
            s
        }
        Manager::Pip => raw.split(['=', '<', '>', '~', '[', '!', ';']).next().unwrap_or(raw).to_lowercase().replace('_', "-"),
        Manager::Brew => raw.rsplit('/').next().unwrap_or(raw).split('@').next().unwrap_or(raw).to_string(),
        Manager::Cargo | Manager::Gem => raw.split('@').next().unwrap_or(raw).to_string(),
        Manager::Docker | Manager::Go => raw.to_string(),
    }
}

/// Acha instalações dentro de um comando (que pode ter `&&`, `;`, `|`, várias linhas…).
pub fn parse_install_command(command: &str) -> Vec<(Manager, Vec<String>)> {
    let normalized = command.replace("&&", "\n").replace("||", "\n").replace([';', '|'], "\n");
    let mut out = Vec::new();
    for seg in normalized.lines() {
        let mut tokens: Vec<String> = seg.split_whitespace().map(clean_token).collect();
        // ignora `sudo` e variáveis no começo (FOO=bar comando)
        while tokens.first().is_some_and(|t| t == "sudo" || (t.contains('=') && !t.starts_with('-'))) {
            tokens.remove(0);
        }
        let t: Vec<&str> = tokens.iter().map(String::as_str).collect();
        let global = t.iter().any(|x| *x == "-g" || *x == "--global");
        let found: Option<(Manager, usize)> = match t.as_slice() {
            ["brew", "install" | "reinstall", ..] => Some((Manager::Brew, 2)),
            ["npm" | "pnpm", "install" | "i" | "add", ..] if global => Some((Manager::Npm, 2)),
            ["bun", "add" | "install" | "i", ..] if global => Some((Manager::Npm, 2)),
            ["yarn", "global", "add", ..] => Some((Manager::Npm, 3)),
            ["pip" | "pip3", "install", ..] => Some((Manager::Pip, 2)),
            ["uv", "pip", "install", ..] | ["uv", "tool", "install", ..] => Some((Manager::Pip, 3)),
            ["pipx", "install", ..] => Some((Manager::Pip, 2)),
            [py, "-m", "pip", "install", ..] if py.starts_with("python") => Some((Manager::Pip, 4)),
            ["cargo", "install", ..] => Some((Manager::Cargo, 2)),
            ["docker" | "podman", "pull", ..] => Some((Manager::Docker, 2)),
            ["gem", "install", ..] => Some((Manager::Gem, 2)),
            ["go", "install", ..] => Some((Manager::Go, 2)),
            _ => None,
        };
        if let Some((m, start)) = found {
            let pkgs = packages_after(&tokens[start..]);
            if !pkgs.is_empty() {
                out.push((m, pkgs));
            }
        }
    }
    out
}

// ---------------------------------------------------------------------------
// 2. Ler os históricos do Claude Code
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct Attempt {
    tool_use_id: String,
    manager: Manager,
    package: String,
    command: String,
    cwd: String,
    timestamp: String,
}

fn scan_file(path: &Path) -> (Vec<Attempt>, HashSet<String>) {
    let mut attempts = Vec::new();
    let mut failed = HashSet::new();
    let Ok(f) = File::open(path) else { return (attempts, failed) };
    for line in BufReader::new(f).lines().map_while(Result::ok) {
        // filtro barato antes de interpretar o JSON (os arquivos somam GBs)
        let has_tool_use = line.contains("\"tool_use\"") && (line.contains("install") || line.contains("pull"));
        let has_error = line.contains("\"is_error\":true");
        if !has_tool_use && !has_error {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        let Some(content) = v.pointer("/message/content").and_then(Value::as_array) else { continue };
        for c in content {
            match c.get("type").and_then(Value::as_str) {
                Some("tool_use") if c.get("name").and_then(Value::as_str) == Some("Bash") => {
                    let Some(cmd) = c.pointer("/input/command").and_then(Value::as_str) else { continue };
                    for (m, pkgs) in parse_install_command(cmd) {
                        for p in pkgs {
                            attempts.push(Attempt {
                                tool_use_id: c.get("id").and_then(Value::as_str).unwrap_or_default().into(),
                                package: base_name(&m, &p),
                                manager: m.clone(),
                                command: cmd.chars().take(300).collect(),
                                cwd: v.get("cwd").and_then(Value::as_str).unwrap_or_default().into(),
                                timestamp: v.get("timestamp").and_then(Value::as_str).unwrap_or_default().into(),
                            });
                        }
                    }
                }
                Some("tool_result") if c.get("is_error").and_then(Value::as_bool) == Some(true) => {
                    if let Some(id) = c.get("tool_use_id").and_then(Value::as_str) {
                        failed.insert(id.to_string());
                    }
                }
                _ => {}
            }
        }
    }
    (attempts, failed)
}

fn transcript_files(config_dir: &Path) -> Vec<PathBuf> {
    let Ok(projects) = std::fs::read_dir(config_dir.join("projects")) else { return vec![] };
    projects
        .filter_map(|e| e.ok())
        .filter_map(|e| std::fs::read_dir(e.path()).ok())
        .flat_map(|rd| rd.filter_map(|e| e.ok()).map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "jsonl"))
        .collect()
}

// ---------------------------------------------------------------------------
// 3. O que está instalado agora
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemPackage {
    pub manager: Manager,
    pub name: String,
    pub version: String,
    pub by_ai: bool,
}

type Index = HashMap<Manager, HashMap<String, String>>;

fn parse_brew(out: &str) -> Vec<(String, String)> {
    out.lines().filter_map(|l| {
        let mut it = l.split_whitespace();
        Some((it.next()?.to_string(), it.last().unwrap_or("").to_string()))
    }).collect()
}

fn parse_cargo_list(out: &str) -> Vec<(String, String)> {
    out.lines()
        .filter(|l| !l.starts_with(char::is_whitespace))
        .filter_map(|l| {
            let mut it = l.trim_end_matches(':').split_whitespace();
            Some((it.next()?.to_string(), it.next().unwrap_or("").trim_start_matches('v').to_string()))
        })
        .collect()
}

fn installed_now() -> Index {
    let t = Duration::from_secs(25);
    let (brew, brew_cask, npm, pip, cargo, docker) = std::thread::scope(|s| {
        let brew = s.spawn(|| run("brew", &["list", "--formula", "--versions"], t));
        let cask = s.spawn(|| run("brew", &["list", "--cask", "--versions"], t));
        let npm = s.spawn(|| run("npm", &["ls", "-g", "--depth=0", "--json"], t));
        let pip = s.spawn(|| run("python3", &["-m", "pip", "list", "--format=json", "--disable-pip-version-check"], t));
        let cargo = s.spawn(|| run("cargo", &["install", "--list"], t));
        let docker = s.spawn(|| run("docker", &["images", "--format", "{{.Repository}}:{{.Tag}}"], Duration::from_secs(8)));
        (brew.join().ok().flatten(), cask.join().ok().flatten(), npm.join().ok().flatten(), pip.join().ok().flatten(), cargo.join().ok().flatten(), docker.join().ok().flatten())
    });

    let mut idx: Index = HashMap::new();
    let mut put = |m: Manager, list: Vec<(String, String)>| idx.entry(m).or_default().extend(list);
    put(Manager::Brew, brew.map(|o| parse_brew(&o)).unwrap_or_default());
    put(Manager::Brew, brew_cask.map(|o| parse_brew(&o)).unwrap_or_default());
    if let Some(v) = npm.and_then(|o| serde_json::from_str::<Value>(&o).ok()) {
        let deps = v.get("dependencies").and_then(Value::as_object).map(|d| {
            d.iter().map(|(k, v)| (k.clone(), v.get("version").and_then(Value::as_str).unwrap_or("").to_string())).collect()
        });
        put(Manager::Npm, deps.unwrap_or_default());
    }
    if let Some(Value::Array(a)) = pip.and_then(|o| serde_json::from_str::<Value>(&o).ok()) {
        put(
            Manager::Pip,
            a.iter()
                .filter_map(|p| Some((p.get("name")?.as_str()?.to_lowercase().replace('_', "-"), p.get("version")?.as_str()?.to_string())))
                .collect(),
        );
    }
    put(Manager::Cargo, cargo.map(|o| parse_cargo_list(&o)).unwrap_or_default());
    put(Manager::Docker, docker.map(|o| o.lines().map(|l| (l.trim().to_string(), String::new())).collect()).unwrap_or_default());
    idx
}

// ---------------------------------------------------------------------------
// 4. Juntar tudo
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiInstall {
    pub manager: Manager,
    pub package: String,
    pub command: String,
    pub project: String,
    pub when: String,
    pub source: String,
    /// "instalado" | "ausente" | "falhou"
    pub status: &'static str,
    pub version: Option<String>,
    pub attempts: usize,
    pub remove_cmd: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallReport {
    pub ai_installs: Vec<AiInstall>,
    pub system: Vec<SystemPackage>,
    pub transcripts_read: usize,
    /// Gerenciadores que responderam (os outros não estão instalados ou falharam).
    pub managers_found: Vec<Manager>,
}

fn is_installed(idx: &Index, m: &Manager, pkg: &str) -> Option<String> {
    let map = idx.get(m)?;
    if let Some(v) = map.get(pkg) {
        return Some(v.clone());
    }
    if *m == Manager::Docker {
        let with_tag = if pkg.contains(':') { pkg.to_string() } else { format!("{pkg}:latest") };
        return map.contains_key(&with_tag).then(String::new);
    }
    None
}

pub fn report(config_dirs: &[PathBuf]) -> InstallReport {
    let files: Vec<PathBuf> = config_dirs.iter().flat_map(|d| transcript_files(d)).collect();
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(8);

    // lê históricos e consulta gerenciadores ao mesmo tempo
    let ((attempts, failed), idx) = std::thread::scope(|s| {
        let idx = s.spawn(installed_now);
        let chunk = files.len().div_ceil(threads).max(1);
        let handles: Vec<_> = files.chunks(chunk).map(|c| s.spawn(move || c.iter().map(|f| scan_file(f)).collect::<Vec<_>>())).collect();
        let mut attempts = Vec::new();
        let mut failed = HashSet::new();
        for h in handles {
            for (a, f) in h.join().unwrap_or_default() {
                attempts.extend(a);
                failed.extend(f);
            }
        }
        ((attempts, failed), idx.join().unwrap_or_default())
    });

    // agrupa por gerenciador+pacote, guardando a tentativa mais recente
    let mut grouped: HashMap<(Manager, String), (Attempt, usize, bool)> = HashMap::new();
    for a in attempts {
        let ok = !failed.contains(&a.tool_use_id);
        let key = (a.manager.clone(), a.package.clone());
        let e = grouped.entry(key).or_insert_with(|| (a.clone(), 0, false));
        e.1 += 1;
        e.2 |= ok;
        if a.timestamp > e.0.timestamp {
            e.0 = a;
        }
    }

    let mut ai_installs: Vec<AiInstall> = grouped
        .into_values()
        .map(|(a, n, any_ok)| {
            let version = is_installed(&idx, &a.manager, &a.package);
            AiInstall {
                status: if version.is_some() { "instalado" } else if !any_ok { "falhou" } else { "ausente" },
                version: version.filter(|v| !v.is_empty()),
                remove_cmd: a.manager.remove_cmd(&a.package),
                manager: a.manager,
                package: a.package,
                command: a.command,
                project: a.cwd,
                when: a.timestamp,
                source: "Claude Code".into(),
                attempts: n,
            }
        })
        .collect();
    ai_installs.sort_by(|a, b| b.when.cmp(&a.when));

    let ai_keys: HashSet<(Manager, String)> = ai_installs.iter().map(|i| (i.manager.clone(), i.package.clone())).collect();
    let mut system: Vec<SystemPackage> = idx
        .iter()
        .flat_map(|(m, map)| map.iter().map(move |(n, v)| (m.clone(), n.clone(), v.clone())))
        .map(|(m, n, v)| SystemPackage { by_ai: ai_keys.contains(&(m.clone(), n.clone())), manager: m, name: n, version: v })
        .collect();
    system.sort_by(|a, b| (format!("{:?}", a.manager), &a.name).cmp(&(format!("{:?}", b.manager), &b.name)));

    let mut managers_found: Vec<Manager> = idx.keys().filter(|m| !idx[*m].is_empty()).cloned().collect();
    managers_found.sort_by_key(|m| format!("{m:?}"));
    InstallReport { ai_installs, system, transcripts_read: files.len(), managers_found }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(cmd: &str) -> Vec<(Manager, Vec<String>)> {
        parse_install_command(cmd)
    }

    #[test]
    fn understands_common_install_commands() {
        assert_eq!(names("brew install ripgrep fd"), vec![(Manager::Brew, vec!["ripgrep".into(), "fd".into()])]);
        assert_eq!(names("cd x && npm i -g pnpm@10 typescript"), vec![(Manager::Npm, vec!["pnpm@10".into(), "typescript".into()])]);
        assert_eq!(names("npm install react"), vec![], "instalação local do projeto não conta como global");
        assert_eq!(names("python3 -m pip install -r requirements.txt pandas==2.0"), vec![(Manager::Pip, vec!["pandas==2.0".into()])]);
        assert_eq!(names("sudo pip3 install --upgrade 'requests[socks]'"), vec![(Manager::Pip, vec!["requests[socks]".into()])]);
        assert_eq!(names("cargo install tauri-cli --version 2.1 --locked"), vec![(Manager::Cargo, vec!["tauri-cli".into()])]);
        assert_eq!(names("docker pull postgres:17; echo ok"), vec![(Manager::Docker, vec!["postgres:17".into()])]);
        assert_eq!(names("FOO=1 brew install --cask utm"), vec![(Manager::Brew, vec!["utm".into()])]);
        assert_eq!(names("pip install -e ."), vec![]);
        assert_eq!(names("echo brew install x"), vec![]);
    }

    #[test]
    fn normalizes_package_names() {
        assert_eq!(base_name(&Manager::Npm, "@tauri-apps/cli@2.1"), "@tauri-apps/cli");
        assert_eq!(base_name(&Manager::Npm, "pnpm@10"), "pnpm");
        assert_eq!(base_name(&Manager::Pip, "Requests[socks]>=2"), "requests");
        assert_eq!(base_name(&Manager::Pip, "typing_extensions"), "typing-extensions");
        assert_eq!(base_name(&Manager::Brew, "homebrew/cask/utm"), "utm");
    }

    #[test]
    fn reads_transcripts_and_flags_failures() {
        let dir = tempfile::tempdir().unwrap();
        let proj = dir.path().join("projects/-x");
        std::fs::create_dir_all(&proj).unwrap();
        let lines = [
            r#"{"type":"assistant","cwd":"/p/a","timestamp":"2026-11-01T10:00:00Z","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"brew install veocode-pacote-ok"}}]}}"#,
            r#"{"type":"assistant","cwd":"/p/b","timestamp":"2026-11-02T10:00:00Z","message":{"content":[{"type":"tool_use","id":"t2","name":"Bash","input":{"command":"pip3 install veocode-pacote-falho"}}]}}"#,
            r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t2","is_error":true,"content":"Exit code 1"}]}}"#,
        ];
        std::fs::write(proj.join("s.jsonl"), lines.join("\n")).unwrap();
        let (attempts, failed) = scan_file(&proj.join("s.jsonl"));
        assert_eq!(attempts.len(), 2);
        assert_eq!(attempts[0].cwd, "/p/a");
        assert!(failed.contains("t2") && !failed.contains("t1"));
    }

    #[test]
    fn parses_manager_outputs() {
        assert_eq!(parse_brew("ripgrep 15.1.0\nnode 22.1 24.0\n"), vec![("ripgrep".into(), "15.1.0".into()), ("node".into(), "24.0".into())]);
        assert_eq!(
            parse_cargo_list("tauri-cli v2.9.4:\n    cargo-tauri\nripgrep v14.1.0 (/x):\n    rg\n"),
            vec![("tauri-cli".into(), "2.9.4".into()), ("ripgrep".into(), "14.1.0".into())]
        );
    }
}
