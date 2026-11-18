//! Processos de IA: acha os agentes (Claude Code, Codex, Ollama…) e tudo que eles
//! iniciaram (servidores de dev, builds, MCPs), com CPU, memória e portas abertas.

use super::util::run;
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, Signal, System, UpdateKind};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Proc {
    pub pid: u32,
    pub name: String,
    pub cmd: String,
    pub cpu: f32,
    pub mem: u64,
    pub ports: Vec<u16>,
    /// 1 = filho direto do agente, 2 = neto…
    pub depth: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentGroup {
    pub pid: u32,
    pub agent: String,
    pub cwd: Option<String>,
    pub cpu: f32,
    pub mem: u64,
    pub run_secs: u64,
    pub ports: Vec<u16>,
    pub children: Vec<Proc>,
    /// Onde ele está aberto: "VS Code", "Cursor", "app do Claude", "Veocode", "Terminal" ou "outro".
    pub host: &'static str,
}

/// Onde um agente foi aberto: pelo caminho do executável e pelos programas acima dele.
fn host_of(procs: &HashMap<Pid, sysinfo::Process>, p: &sysinfo::Process) -> &'static str {
    let exe = p.exe().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let cmd = cmd_line(p).to_lowercase();
    if exe.contains(".vscode/extensions") || cmd.contains(".vscode/extensions") {
        return "VS Code";
    }
    if exe.contains(".cursor/extensions") || cmd.contains(".cursor/extensions") {
        return "Cursor";
    }
    if exe.contains("application support/claude/") {
        return "app do Claude";
    }
    let mut a = p.parent();
    for _ in 0..12 {
        let Some(pid) = a else { break };
        let Some(q) = procs.get(&pid) else { break };
        let n = q.name().to_string_lossy().to_lowercase();
        if n.contains("veocode") {
            return "Veocode";
        }
        if n.starts_with("code") || n.contains("visual studio code") {
            return "VS Code";
        }
        if n.starts_with("cursor") {
            return "Cursor";
        }
        if n == "claude" && q.exe().is_some_and(|e| e.to_string_lossy().contains("Claude.app")) {
            return "app do Claude";
        }
        if matches!(n.as_str(), "terminal" | "iterm2" | "warp" | "stable" | "ghostty" | "wezterm-gui" | "kitty" | "alacritty" | "hyper" | "tabby" | "windowsterminal.exe" | "conhost.exe") {
            return "Terminal";
        }
        a = q.parent();
    }
    "outro"
}

/// Qual agente é este processo (pelo nome do executável e pela linha de comando).
pub fn agent_kind(name: &str, cmd: &str) -> Option<&'static str> {
    let n = name.to_lowercase();
    let c = cmd.to_lowercase();
    // o app de desktop "Claude" (maiúsculo) é a janela; quem trabalha é o CLI "claude"
    let runtime = matches!(n.as_str(), "node" | "bun" | "deno");
    if name == "claude" || runtime && c.contains("@anthropic-ai/claude-code/cli") {
        return Some("Claude Code");
    }
    if n == "codex" || runtime && c.contains("@openai/codex") {
        return Some("Codex");
    }
    if n == "gemini" || runtime && c.contains("@google/gemini-cli") {
        return Some("Gemini CLI");
    }
    if n == "aider" || c.contains("/aider ") {
        return Some("Aider");
    }
    if n.contains("deepseek") {
        return Some("DeepSeek");
    }
    if n == "ollama" && c.contains("serve") {
        return Some("Ollama (servidor)");
    }
    if n == "cursor-agent" {
        return Some("Cursor Agent");
    }
    None
}

/// None se o sistema não deixar ler processos (raro; ex.: sandbox).
pub fn new_system() -> Option<System> {
    System::new().ok()
}

fn refresh(sys: &mut System) {
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_cpu().with_memory().with_cmd(UpdateKind::OnlyIfNotSet).with_cwd(UpdateKind::OnlyIfNotSet),
    );
    // (o número de processos atualizados não interessa)
}

/// pid → portas TCP em escuta.
pub fn listening_ports() -> HashMap<u32, Vec<u16>> {
    let mut map: HashMap<u32, Vec<u16>> = HashMap::new();
    if cfg!(windows) {
        if let Some(out) = run("netstat", &["-ano", "-p", "TCP"], Duration::from_secs(5)) {
            for l in out.lines().filter(|l| l.contains("LISTENING")) {
                let cols: Vec<&str> = l.split_whitespace().collect();
                if let (Some(addr), Some(pid)) = (cols.get(1), cols.last()) {
                    if let (Some(port), Ok(pid)) = (addr.rsplit(':').next().and_then(|p| p.parse().ok()), pid.parse()) {
                        map.entry(pid).or_default().push(port);
                    }
                }
            }
        }
    } else if let Some(out) = run("lsof", &["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pn"], Duration::from_secs(5)) {
        map = parse_lsof(&out);
    }
    for v in map.values_mut() {
        v.sort_unstable();
        v.dedup();
    }
    map
}

pub fn parse_lsof(out: &str) -> HashMap<u32, Vec<u16>> {
    let mut map: HashMap<u32, Vec<u16>> = HashMap::new();
    let mut pid = 0;
    for l in out.lines() {
        if let Some(p) = l.strip_prefix('p') {
            pid = p.parse().unwrap_or(0);
        } else if let Some(n) = l.strip_prefix('n') {
            if let Some(port) = n.rsplit(':').next().and_then(|p| p.parse().ok()) {
                map.entry(pid).or_default().push(port);
            }
        }
    }
    map
}

fn cmd_line(p: &sysinfo::Process) -> String {
    let s = p.cmd().iter().map(|a| a.to_string_lossy()).collect::<Vec<_>>().join(" ");
    let s = if s.is_empty() { p.name().to_string_lossy().into_owned() } else { s };
    // encurta caminhos longos do executável: /opt/homebrew/bin/node → node
    let mut parts = s.splitn(2, ' ');
    let exe = parts.next().unwrap_or("");
    let short = PathBuf::from(exe).file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_else(|| exe.into());
    let rest = parts.next().map(|r| format!(" {r}")).unwrap_or_default();
    format!("{short}{rest}").chars().take(220).collect()
}

pub fn snapshot(sys: &mut System) -> Vec<AgentGroup> {
    refresh(sys);
    let ports = listening_ports();
    let procs = sys.processes();

    let mut children: HashMap<Pid, Vec<Pid>> = HashMap::new();
    for (pid, p) in procs {
        if let Some(parent) = p.parent() {
            children.entry(parent).or_default().push(*pid);
        }
    }
    let kind_of = |pid: &Pid| procs.get(pid).and_then(|p| agent_kind(&p.name().to_string_lossy(), &cmd_line(p)));

    let mut groups = Vec::new();
    for (pid, p) in procs {
        let Some(agent) = kind_of(pid) else { continue };
        // se algum ancestral já é um agente, este processo entra no grupo dele
        let mut ancestor = p.parent();
        let mut nested = false;
        for _ in 0..12 {
            let Some(a) = ancestor else { break };
            if kind_of(&a).is_some() {
                nested = true;
                break;
            }
            ancestor = procs.get(&a).and_then(|x| x.parent());
        }
        if nested {
            continue;
        }
        let mut list = Vec::new();
        let mut stack: Vec<(Pid, usize)> = children.get(pid).map(|c| c.iter().map(|c| (*c, 1)).collect()).unwrap_or_default();
        while let Some((cpid, depth)) = stack.pop() {
            if let Some(cp) = procs.get(&cpid) {
                list.push(Proc {
                    pid: cpid.as_u32(),
                    name: cp.name().to_string_lossy().into_owned(),
                    cmd: cmd_line(cp),
                    cpu: cp.cpu_usage(),
                    mem: cp.memory(),
                    ports: ports.get(&cpid.as_u32()).cloned().unwrap_or_default(),
                    depth,
                });
                if depth < 6 {
                    stack.extend(children.get(&cpid).into_iter().flatten().map(|c| (*c, depth + 1)));
                }
            }
        }
        // mantém a pré-ordem do DFS: cada pai aparece logo antes dos filhos (o recuo mostra a árvore)
        groups.push(AgentGroup {
            pid: pid.as_u32(),
            agent: agent.into(),
            cwd: p.cwd().map(|c| c.to_string_lossy().into_owned()),
            cpu: p.cpu_usage(),
            mem: p.memory(),
            run_secs: p.run_time(),
            ports: ports.get(&pid.as_u32()).cloned().unwrap_or_default(),
            children: list,
            host: host_of(procs, p),
        });
    }
    groups.sort_by(|a, b| b.children.len().cmp(&a.children.len()).then(a.pid.cmp(&b.pid)));
    groups
}

/// Encerra um processo, mas só se ele foi iniciado por um agente (nunca o agente nem
/// um processo qualquer do sistema).
pub fn kill(sys: &mut System, pid: u32) -> Result<(), String> {
    let groups = snapshot(sys);
    if !groups.iter().any(|g| g.children.iter().any(|c| c.pid == pid)) {
        return Err("esse processo não foi iniciado por um agente de IA".into());
    }
    let p = sys.process(Pid::from_u32(pid)).ok_or("processo já terminou")?;
    match p.kill_with(Signal::Term) {
        Some(true) => Ok(()),
        _ if p.kill() => Ok(()),
        _ => Err("o sistema não deixou encerrar".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_agents() {
        assert_eq!(agent_kind("claude", "claude --resume"), Some("Claude Code"));
        assert_eq!(agent_kind("node", "node /usr/lib/node_modules/@anthropic-ai/claude-code/cli.js"), Some("Claude Code"));
        assert_eq!(agent_kind("bash", "bash -c cat @anthropic-ai/claude-code/cli.js"), None);
        assert_eq!(agent_kind("Claude", "/Applications/Claude.app/Contents/MacOS/Claude"), None);
        assert_eq!(agent_kind("ollama", "ollama serve"), Some("Ollama (servidor)"));
        assert_eq!(agent_kind("node", "node vite"), None);
        assert_eq!(agent_kind("ugrep", "ugrep --exclude-dir=/x/claude-code/cli"), None);
    }

    #[test]
    fn parses_lsof() {
        let m = parse_lsof("p123\nn*:1420\nn127.0.0.1:1421\np9\nn[::1]:5432\n");
        assert_eq!(m[&123], vec![1420, 1421]);
        assert_eq!(m[&9], vec![5432]);
    }

    #[test]
    fn refuses_to_kill_unrelated_processes() {
        // pid 1 (launchd/init) nunca é filho de um agente
        let mut sys = new_system().unwrap();
        assert!(kill(&mut sys, 1).is_err());
    }
}
