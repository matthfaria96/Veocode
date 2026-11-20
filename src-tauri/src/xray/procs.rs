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
        ProcessRefreshKind::nothing().with_cpu().with_memory().with_cmd(UpdateKind::OnlyIfNotSet).with_cwd(UpdateKind::OnlyIfNotSet).with_exe(UpdateKind::OnlyIfNotSet),
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
        return Err(crate::i18n::tr("esse processo não foi iniciado por um agente de IA", "that process wasn't started by an AI agent").into());
    }
    let p = sys.process(Pid::from_u32(pid)).ok_or(crate::i18n::tr("processo já terminou", "the process already ended"))?;
    match p.kill_with(Signal::Term) {
        Some(true) => Ok(()),
        _ if p.kill() => Ok(()),
        _ => Err(crate::i18n::tr("o sistema não deixou encerrar", "the system didn't allow ending it").into()),
    }
}
// ---------------------------------------------------------------- portas abertas

/// Um servidor que ficou rodando depois que quem o abriu (agente, terminal) fechou.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Leftover {
    /// O processo de cima da árvore que sobrou (encerrá-lo leva junto os de baixo).
    pub pid: u32,
    pub cmd: String,
    pub cwd: String,
    /// Nome do projeto do Veocode, se a pasta for de um.
    pub project: Option<String>,
    pub ports: Vec<u16>,
    pub cpu: f32,
    pub mem: u64,
    pub run_secs: u64,
    /// Todos os processos da árvore (o de cima primeiro).
    pub pids: Vec<u32>,
}

/// Qualquer outro programa com porta aberta (só para consulta).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortOwner {
    pub pid: u32,
    pub name: String,
    pub cmd: String,
    pub ports: Vec<u16>,
    /// Agente que abriu, se for de um agente que ainda está aberto.
    pub agent: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortReport {
    pub leftovers: Vec<Leftover>,
    pub others: Vec<PortOwner>,
}

/// O mínimo de cada processo para decidir se ele "sobrou" (separado do sysinfo para dar para testar).
#[derive(Debug, Clone)]
pub struct Node {
    pub parent: Option<u32>,
    pub name: String,
    pub exe: String,
    pub cwd: Option<PathBuf>,
}

/// Programas que ficam pendurados no sistema de propósito e não são "restos".
fn is_service(n: &Node) -> bool {
    let exe = n.exe.to_lowercase();
    let name = n.name.to_lowercase();
    // apps de verdade (Discord, Terminal…); o Python do macOS também mora num "Python.app", mas dentro de um .framework
    (exe.contains(".app/contents/macos/") && !exe.contains(".framework/")) || exe.starts_with("/system/") || exe.starts_with("/usr/libexec/") || exe.starts_with("/usr/sbin/")
        || exe.contains("\\windows\\")
        || matches!(name.as_str(), "launchd" | "login" | "sshd" | "tmux" | "tmux: server" | "screen" | "systemd" | "init" | "explorer.exe" | "services.exe" | "svchost.exe")
}

/// O processo de cima da árvore: aquele cujo pai é o sistema (pid ≤ 1) ou já não existe.
fn root_of(nodes: &HashMap<u32, Node>, pid: u32) -> u32 {
    let mut cur = pid;
    for _ in 0..32 {
        match nodes.get(&cur).and_then(|n| n.parent) {
            Some(p) if p > 1 && nodes.contains_key(&p) => cur = p,
            _ => break,
        }
    }
    cur
}

/// Pasta "de trabalho" plausível: dentro da sua pasta pessoal, mas não a própria nem Library/AppData.
fn work_dir(cwd: &std::path::Path, home: &std::path::Path) -> bool {
    let Ok(rest) = cwd.strip_prefix(home) else { return false };
    let first = rest.components().next().map(|c| c.as_os_str().to_string_lossy().to_lowercase());
    match first.as_deref() {
        None => false,
        Some(f) => !matches!(f, "library" | "appdata") && !f.starts_with('.'),
    }
}

/// Raízes das árvores que sobraram e têm porta aberta. `me` é o próprio Veocode (nunca entra).
pub fn leftover_roots(nodes: &HashMap<u32, Node>, ports: &HashMap<u32, Vec<u16>>, agents: &std::collections::HashSet<u32>, me: u32, home: &std::path::Path) -> Vec<u32> {
    let my_root = root_of(nodes, me);
    let mut roots: Vec<u32> = ports
        .keys()
        .filter(|pid| nodes.contains_key(pid))
        .map(|pid| root_of(nodes, *pid))
        .filter(|r| *r != my_root && !agents.contains(r))
        .filter(|r| {
            let n = &nodes[r];
            !is_service(n) && n.cwd.as_deref().is_some_and(|c| work_dir(c, home))
        })
        .collect();
    roots.sort_unstable();
    roots.dedup();
    roots
}

fn nodes_of(procs: &HashMap<Pid, sysinfo::Process>) -> HashMap<u32, Node> {
    procs
        .iter()
        .map(|(pid, p)| {
            (pid.as_u32(), Node {
                parent: p.parent().map(|x| x.as_u32()),
                name: p.name().to_string_lossy().into_owned(),
                exe: p.exe().map(|e| e.to_string_lossy().into_owned()).unwrap_or_default(),
                cwd: p.cwd().map(PathBuf::from),
            })
        })
        .collect()
}

/// Árvore abaixo de `root` (inclui ele), pais antes dos filhos.
fn tree(nodes: &HashMap<u32, Node>, root: u32) -> Vec<u32> {
    let mut kids: HashMap<u32, Vec<u32>> = HashMap::new();
    for (pid, n) in nodes {
        if let Some(p) = n.parent {
            kids.entry(p).or_default().push(*pid);
        }
    }
    let mut out = vec![];
    let mut stack = vec![root];
    while let Some(p) = stack.pop() {
        if out.len() > 200 {
            break;
        }
        out.push(p);
        stack.extend(kids.get(&p).into_iter().flatten());
    }
    out
}

/// Todas as portas abertas: o que sobrou de sessões fechadas e o resto, só para consulta.
pub fn ports(sys: &mut System, projects: &[(String, PathBuf)], home: &std::path::Path) -> PortReport {
    let groups = snapshot(sys);
    let ports = listening_ports();
    let procs = sys.processes();
    let nodes = nodes_of(procs);
    let agent_pids: std::collections::HashSet<u32> = groups.iter().map(|g| g.pid).collect();
    let mut in_agent: HashMap<u32, String> = HashMap::new();
    for g in &groups {
        in_agent.insert(g.pid, g.agent.clone());
        for c in &g.children {
            in_agent.insert(c.pid, g.agent.clone());
        }
    }
    let me = std::process::id();
    let roots = leftover_roots(&nodes, &ports, &agent_pids, me, home);

    let mut taken = std::collections::HashSet::new();
    let mut leftovers = Vec::new();
    for r in roots {
        let pids = tree(&nodes, r);
        let (mut cpu, mut mem) = (0.0, 0);
        let mut ps = vec![];
        for pid in &pids {
            if let Some(p) = procs.get(&Pid::from_u32(*pid)) {
                cpu += p.cpu_usage();
                mem += p.memory();
            }
            ps.extend(ports.get(pid).into_iter().flatten().copied());
            taken.insert(*pid);
        }
        ps.sort_unstable();
        ps.dedup();
        let Some(p) = procs.get(&Pid::from_u32(r)) else { continue };
        let cwd = p.cwd().map(PathBuf::from).unwrap_or_default();
        let project = projects.iter().filter(|(_, root)| cwd.starts_with(root)).max_by_key(|(_, root)| root.as_os_str().len()).map(|(n, _)| n.clone());
        // o comando mais útil é o de quem abriu a porta (ex.: "vite"), não o "npm run dev" de cima
        let opener = pids.iter().find(|x| ports.contains_key(x)).and_then(|x| procs.get(&Pid::from_u32(*x))).unwrap_or(p);
        leftovers.push(Leftover { pid: r, cmd: cmd_line(opener), cwd: cwd.to_string_lossy().into_owned(), project, ports: ps, cpu, mem, run_secs: p.run_time(), pids });
    }
    leftovers.sort_by(|a, b| b.run_secs.cmp(&a.run_secs));

    let mut others: Vec<PortOwner> = ports
        .iter()
        .filter(|(pid, _)| !taken.contains(pid))
        .filter_map(|(pid, ps)| {
            let p = procs.get(&Pid::from_u32(*pid))?;
            Some(PortOwner { pid: *pid, name: p.name().to_string_lossy().into_owned(), cmd: cmd_line(p), ports: ps.clone(), agent: in_agent.get(pid).cloned() })
        })
        .collect();
    others.sort_by(|a, b| b.agent.is_some().cmp(&a.agent.is_some()).then(a.ports.first().cmp(&b.ports.first())));
    PortReport { leftovers, others }
}

/// Encerra uma árvore que sobrou (de baixo para cima). Recusa qualquer coisa que não esteja na lista de restos.
pub fn kill_leftover(sys: &mut System, pid: u32, projects: &[(String, PathBuf)], home: &std::path::Path) -> Result<(), String> {
    let report = ports(sys, projects, home);
    let l = report.leftovers.iter().find(|l| l.pid == pid).ok_or(crate::i18n::tr("esse servidor não está na lista do que sobrou", "that server isn't in the leftovers list"))?;
    let mut failed = 0;
    for p in l.pids.iter().rev() {
        if let Some(proc_) = sys.process(Pid::from_u32(*p)) {
            if !matches!(proc_.kill_with(Signal::Term), Some(true)) && !proc_.kill() {
                failed += 1;
            }
        }
    }
    if failed == l.pids.len() { Err(crate::i18n::tr("o sistema não deixou encerrar", "the system didn't allow ending it").into()) } else { Ok(()) }
}

// ---------------------------------------------------------------- o que roda num projeto

/// O que está rodando dentro da pasta de um projeto (servidor de dev, build, testes…), já
/// agrupado: `npm run dev` e o `vite` que ele abriu viram uma linha só.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjProc {
    /// O de cima do grupo (encerrar leva junto os de baixo).
    pub pid: u32,
    pub cmd: String,
    pub ports: Vec<u16>,
    pub cpu: f32,
    pub mem: u64,
    pub run_secs: u64,
    /// Agente de IA que iniciou (Claude Code, Codex…), se foi um.
    pub agent: Option<String>,
    pub pids: Vec<u32>,
}

/// Shells abertos na pasta (o terminal da pessoa) não contam como "rodando".
fn is_shell(name: &str) -> bool {
    let n = name.trim_start_matches('-').to_lowercase();
    matches!(n.as_str(), "zsh" | "bash" | "sh" | "fish" | "dash" | "tcsh" | "csh" | "login" | "nu" | "pwsh" | "powershell.exe" | "cmd.exe" | "conhost.exe")
}

/// Comando mais legível: sem a pasta do projeto na frente dos caminhos e, nos atalhos do npm
/// (`node …/node_modules/.bin/vite --port 5173`), só o nome da ferramenta (`vite --port 5173`).
fn short_cmd(cmd: &str, root: &std::path::Path) -> String {
    let base = format!("{}/", root.to_string_lossy().trim_end_matches('/'));
    let c = cmd.replace(&base, "");
    let mut parts = c.splitn(3, ' ');
    if let (Some("node"), Some(script)) = (parts.next(), parts.next()) {
        if script.contains("node_modules/.bin/") || (script.contains("node_modules/") && script.contains("/bin/")) {
            let name = script.rsplit('/').next().unwrap_or(script).trim_end_matches(".js");
            return match parts.next() {
                Some(rest) => format!("{name} {rest}"),
                None => name.to_string(),
            };
        }
    }
    c
}

pub fn project_procs(sys: &mut System, root: &std::path::Path) -> Vec<ProjProc> {
    refresh(sys);
    let ports = listening_ports();
    let procs = sys.processes();
    let me = std::process::id();
    // a pasta como foi escrita e a real (sem links: /tmp → /private/tmp)
    let real = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let inside = |cwd: &std::path::Path| cwd.starts_with(root) || cwd.starts_with(&real);
    let kind_of = |p: &sysinfo::Process| agent_kind(&p.name().to_string_lossy(), &cmd_line(p));

    // quem só embrulha um agente (o lançador do app do Claude, por exemplo) também não conta
    let wraps_agent: std::collections::HashSet<u32> = procs.values().filter(|p| kind_of(p).is_some()).filter_map(|p| p.parent()).map(|x| x.as_u32()).collect();

    let mut listed: HashMap<u32, &sysinfo::Process> = HashMap::new();
    for (pid, p) in procs {
        let id = pid.as_u32();
        if id == me || p.thread_kind().is_some() || wraps_agent.contains(&id) {
            continue;
        }
        let Some(cwd) = p.cwd() else { continue };
        if !inside(cwd) || is_shell(&p.name().to_string_lossy()) || kind_of(p).is_some() {
            continue;
        }
        listed.insert(id, p);
    }
    // cada um vai para o grupo do ancestral listado mais alto
    let top_of = |id: u32| {
        let mut top = id;
        for _ in 0..16 {
            match listed.get(&top).and_then(|p| p.parent()).map(|x| x.as_u32()) {
                Some(par) if listed.contains_key(&par) => top = par,
                _ => break,
            }
        }
        top
    };
    let mut groups: HashMap<u32, Vec<u32>> = HashMap::new();
    for id in listed.keys() {
        groups.entry(top_of(*id)).or_default().push(*id);
    }
    let mut out: Vec<ProjProc> = groups
        .into_iter()
        .filter_map(|(top, mut pids)| {
            let p = *listed.get(&top)?;
            pids.sort_unstable();
            let mut ps: Vec<u16> = pids.iter().flat_map(|x| ports.get(x).into_iter().flatten().copied()).collect();
            ps.sort_unstable();
            ps.dedup();
            // o comando mais útil é o de quem abriu a porta (ex.: "vite"), não o "npm run dev" de cima
            let opener = pids.iter().find(|x| ports.contains_key(x)).and_then(|x| listed.get(x).copied()).unwrap_or(p);
            let mut agent = None;
            let mut a = p.parent();
            for _ in 0..12 {
                let Some(x) = a else { break };
                let Some(pp) = procs.get(&x) else { break };
                if let Some(k) = kind_of(pp) {
                    agent = Some(k.to_string());
                    break;
                }
                a = pp.parent();
            }
            Some(ProjProc {
                pid: top,
                cmd: short_cmd(&cmd_line(opener), root),
                cpu: pids.iter().filter_map(|x| listed.get(x)).map(|x| x.cpu_usage()).sum(),
                mem: pids.iter().filter_map(|x| listed.get(x)).map(|x| x.memory()).sum(),
                run_secs: p.run_time(),
                ports: ps,
                agent,
                pids,
            })
        })
        .collect();
    // servidores primeiro, depois os mais novos
    out.sort_by(|a, b| a.ports.is_empty().cmp(&b.ports.is_empty()).then(a.run_secs.cmp(&b.run_secs)));
    out
}

/// Portas em escuta de cada árvore de processos (raiz = o shell de um serviço da aba Ambiente).
pub fn tree_ports(sys: &mut System, roots: &[(String, u32)]) -> HashMap<String, Vec<u16>> {
    refresh(sys);
    let ports = listening_ports();
    let procs = sys.processes();
    let mut out: HashMap<String, Vec<u16>> = HashMap::new();
    for (pid, list) in &ports {
        let mut cur = Some(Pid::from_u32(*pid));
        for _ in 0..24 {
            let Some(c) = cur else { break };
            if let Some((id, _)) = roots.iter().find(|(_, r)| *r == c.as_u32()) {
                out.entry(id.clone()).or_default().extend(list.iter().copied());
                break;
            }
            cur = procs.get(&c).and_then(|p| p.parent());
        }
    }
    for v in out.values_mut() {
        v.sort_unstable();
        v.dedup();
    }
    out
}

/// Encerra um grupo da lista do projeto (e só desta lista: nada de fora da pasta).
pub fn kill_in_project(sys: &mut System, root: &std::path::Path, pid: u32) -> Result<(), String> {
    let list = project_procs(sys, root);
    let g = list.iter().find(|p| p.pid == pid).ok_or(crate::i18n::tr("esse processo não está rodando nesta pasta", "that process isn't running in this folder"))?;
    let mut failed = 0;
    for p in g.pids.iter().rev() {
        if let Some(proc_) = sys.process(Pid::from_u32(*p)) {
            if !matches!(proc_.kill_with(Signal::Term), Some(true)) && !proc_.kill() {
                failed += 1;
            }
        }
    }
    if failed == g.pids.len() { Err(crate::i18n::tr("o sistema não deixou encerrar", "the system didn't allow ending it").into()) } else { Ok(()) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_commands() {
        let root = std::path::Path::new("/Users/eu/dev/site");
        assert_eq!(short_cmd("node /Users/eu/dev/site/node_modules/.bin/vite --port 5173", root), "vite --port 5173");
        assert_eq!(short_cmd("node /Users/eu/dev/site/node_modules/next/dist/bin/next dev", root), "next dev");
        assert_eq!(short_cmd("cargo run --bin /Users/eu/dev/site/x", root), "cargo run --bin x");
    }

    fn node(parent: u32, name: &str, exe: &str, cwd: &str) -> Node {
        Node { parent: Some(parent), name: name.into(), exe: exe.into(), cwd: Some(cwd.into()) }
    }

    #[test]
    fn finds_leftover_dev_servers() {
        let home = std::path::Path::new("/Users/eu");
        let mut n = HashMap::new();
        // sobrou: npm → vite, pai do npm já é o sistema
        n.insert(10, node(1, "npm", "/opt/homebrew/bin/node", "/Users/eu/dev/site"));
        n.insert(11, node(10, "node", "/opt/homebrew/bin/node", "/Users/eu/dev/site"));
        // aberto no Terminal: não sobrou
        n.insert(20, node(1, "Terminal", "/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal", "/"));
        n.insert(21, node(20, "zsh", "/bin/zsh", "/Users/eu/dev/api"));
        n.insert(22, node(21, "node", "/opt/homebrew/bin/node", "/Users/eu/dev/api"));
        // app comum com porta
        n.insert(30, node(1, "Discord", "/Applications/Discord.app/Contents/MacOS/Discord", "/"));
        // python do macOS: mora num Python.app dentro de um .framework, mas é um servidor solto
        n.insert(70, node(1, "Python", "/Library/Frameworks/Python3.framework/Versions/3.9/Resources/Python.app/Contents/MacOS/Python", "/Users/eu/dev/docs"));
        // serviço do Homebrew (pasta fora do home)
        n.insert(40, node(1, "postgres", "/opt/homebrew/bin/postgres", "/opt/homebrew/var/postgresql"));
        // o próprio Veocode em modo dev, também solto
        n.insert(50, node(1, "npm", "/opt/homebrew/bin/node", "/Users/eu/dev/veocode"));
        n.insert(51, node(50, "node", "/opt/homebrew/bin/node", "/Users/eu/dev/veocode"));
        n.insert(52, node(50, "veocode", "/Users/eu/dev/veocode/target/debug/veocode", "/Users/eu/dev/veocode"));
        // agente aberto
        n.insert(60, node(1, "claude", "/Users/eu/.local/bin/claude", "/Users/eu/dev/x"));
        n.insert(61, node(60, "node", "/opt/homebrew/bin/node", "/Users/eu/dev/x"));
        let ports: HashMap<u32, Vec<u16>> = [(11, vec![5173]), (22, vec![3000]), (30, vec![6463]), (40, vec![5432]), (51, vec![1420]), (61, vec![8080]), (70, vec![8765])].into();
        let agents = [60].into();
        assert_eq!(leftover_roots(&n, &ports, &agents, 52, home), vec![10, 70]);
        assert_eq!(tree(&n, 10), vec![10, 11]);
    }

    #[test]
    fn work_dirs() {
        let h = std::path::Path::new("/Users/eu");
        assert!(work_dir("/Users/eu/dev/a".as_ref(), h));
        assert!(!work_dir("/Users/eu".as_ref(), h));
        assert!(!work_dir("/Users/eu/Library/x".as_ref(), h));
        assert!(!work_dir("/Users/eu/.cache/x".as_ref(), h));
        assert!(!work_dir("/opt/x".as_ref(), h));
    }

    #[test]
    fn refuses_to_kill_non_leftovers() {
        let mut sys = new_system().unwrap();
        assert!(kill_leftover(&mut sys, 1, &[], &crate::xray::util::home()).is_err());
    }

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
