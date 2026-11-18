//! Inventário: junta o que as IAs instalaram ou usam (skills, plugins, MCP, processos) e
//! diz o que está rodando agora e como tirar cada coisa.
//!
//! Tirar nunca apaga de vez: skills, comandos e agentes vão para a Lixeira; plugins e
//! servidores MCP são desligados ou removidos pelo próprio Claude Code (`claude plugin …`,
//! `claude mcp remove …`), que sabe onde cada um está guardado.

use crate::skills::{Item, Kind};
use crate::xray::procs::AgentGroup;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Move para a Lixeira. No macOS pelo próprio sistema (NSFileManager): o jeito padrão do
/// `trash` pede ao Finder, o que abre um pedido de permissão ("controlar o Finder") e
/// trava a ação até a pessoa responder. Perde só o "Devolver" do Finder.
pub fn to_trash(paths: &[PathBuf]) -> Result<(), trash::Error> {
    #[allow(unused_mut)]
    let mut ctx = trash::TrashContext::default();
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        ctx.set_delete_method(DeleteMethod::NsFileManager);
    }
    ctx.delete_all(paths)
}

/// Uma cópia do servidor MCP rodando agora (cada sessão do Claude abre a sua).
#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpRun {
    pub pid: u32,
    pub cpu: f32,
    pub mem: u64,
    /// pasta onde o agente que abriu este servidor está trabalhando
    pub cwd: Option<String>,
    pub agent: String,
}

/// Programas genéricos que não dizem qual servidor é (o nome está nos argumentos).
const LAUNCHERS: &[&str] = &["npx", "node", "uvx", "uv", "python", "python3", "bunx", "bun", "deno", "docker", "sh", "bash", "cmd", "pnpm", "pnpx", "yarn", "java", "go"];

/// O pedaço da linha de comando que identifica um servidor MCP stdio.
pub fn needle(command: &str, args: &[String]) -> Option<String> {
    let base = Path::new(command).file_name()?.to_string_lossy().to_lowercase();
    let base = base.trim_end_matches(".exe").trim_end_matches(".cmd").to_string();
    if !LAUNCHERS.contains(&base.as_str()) {
        return (base.len() >= 3).then_some(base);
    }
    // npx -y @scope/servidor, uvx mcp-server-x, docker run … imagem: o 1º argumento que não é opção
    let skip = ["run", "exec", "x", "dlx", "-m", "--from"];
    args.iter()
        .map(|a| a.trim())
        .find(|a| !a.is_empty() && !a.starts_with('-') && !skip.contains(a) && *a != "•••" && a.len() >= 3)
        .map(|a| a.to_lowercase())
}

/// O que procurar entre os processos para saber se um servidor MCP está rodando.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    pub id: String,
    pub needle: String,
    /// servidor de um projeto: só conta o agente que trabalha naquela pasta
    pub project: Option<String>,
}

/// Probes dos servidores MCP stdio da lista (os remotos não rodam nesta máquina).
pub fn probes(items: &[Item]) -> Vec<Probe> {
    items
        .iter()
        .filter(|i| i.kind == Kind::Mcp)
        .filter_map(|it| {
            let m = it.mcp.as_ref()?;
            let n = needle(m.command.as_deref()?, &m.args)?;
            Some(Probe { id: it.id.clone(), needle: n, project: it.project.clone() })
        })
        .collect()
}

/// Servidores MCP (stdio) que aparecem entre os processos filhos dos agentes.
pub fn mcp_running(probes: &[Probe], groups: &[AgentGroup]) -> HashMap<String, Vec<McpRun>> {
    let mut out: HashMap<String, Vec<McpRun>> = HashMap::new();
    let mut taken: HashSet<u32> = HashSet::new();
    for it in probes {
        let n = it.needle.to_lowercase();
        if n.len() < 3 {
            continue;
        }
        for g in groups {
            // o servidor de um projeto só conta para o agente que trabalha naquele projeto
            if let (Some(p), Some(cwd)) = (&it.project, &g.cwd) {
                if !Path::new(cwd).starts_with(p) {
                    continue;
                }
            }
            for c in &g.children {
                let line = c.cmd.to_lowercase();
                if !taken.contains(&c.pid) && line.contains(&n) {
                    taken.insert(c.pid);
                    out.entry(it.id.clone()).or_default().push(McpRun { pid: c.pid, cpu: c.cpu, mem: c.mem, cwd: g.cwd.clone(), agent: g.agent.clone() });
                }
            }
        }
    }
    out
}

// ---------------------------------------------------------------- tirar

/// Skill, comando ou agente → Lixeira. Só o que veio na última leitura e só de pastas
/// `skills/`, `commands/` ou `agents/` (nunca de dentro de plugins ou sincronizadas).
pub fn trash_item(path: &str, allowed: &HashSet<String>) -> Result<PathBuf, String> {
    if !allowed.contains(path) {
        return Err("Esse item não está mais na lista. Atualize o inventário e tente de novo.".into());
    }
    let file = Path::new(path);
    if file.components().any(|c| matches!(c.as_os_str().to_str(), Some("plugins" | "synced" | ".trash"))) {
        return Err("Esse item vem de um plugin ou do claude.ai: não dá para tirar sozinho.".into());
    }
    // skill: a pasta inteira (SKILL.md + o que vier junto); comando/agente: o arquivo
    let target = if file.file_name().is_some_and(|n| n == "SKILL.md") { file.parent().ok_or("caminho estranho")?.to_path_buf() } else { file.to_path_buf() };
    let ok_parent = target.ancestors().skip(1).any(|a| a.file_name().is_some_and(|n| n == "skills" || n == "commands" || n == "agents"));
    if !ok_parent || !target.exists() {
        return Err("Esse caminho não parece uma skill, comando ou agente.".into());
    }
    to_trash(std::slice::from_ref(&target)).map_err(|e| format!("não deu para mover para a Lixeira: {e}"))?;
    Ok(target)
}

/// Roda o próprio Claude Code (`claude plugin …` / `claude mcp …`) com a conta certa.
fn claude(config_dir: Option<&Path>, cwd: Option<&Path>, args: &[&str]) -> Result<String, String> {
    let bin = crate::xray::util::which("claude").ok_or("Não achei o comando `claude`.")?;
    let mut cmd = Command::new(bin);
    cmd.args(args).env_remove("CLAUDECODE").stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(d) = config_dir {
        cmd.env("CLAUDE_CONFIG_DIR", d);
    }
    if let Some(c) = cwd {
        cmd.current_dir(c);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let started = Instant::now();
    loop {
        if child.try_wait().map_err(|e| e.to_string())?.is_some() {
            break;
        }
        if started.elapsed() > Duration::from_secs(60) {
            let _ = child.kill();
            return Err("o Claude Code demorou demais para responder".into());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)).trim().to_string();
    if out.status.success() {
        Ok(text)
    } else {
        Err(if text.is_empty() { "o Claude Code recusou o pedido".into() } else { text.chars().take(400).collect() })
    }
}

fn safe_name(s: &str) -> Result<(), String> {
    let ok = !s.is_empty() && s.len() <= 200 && !s.starts_with('-') && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_.@:/".contains(c));
    if ok { Ok(()) } else { Err("nome inválido".into()) }
}

fn scope_ok(scope: &str) -> Result<(), String> {
    if ["user", "project", "local"].contains(&scope) { Ok(()) } else { Err("escopo inválido".into()) }
}

/// Liga, desliga ou remove um plugin. `project`: pasta do projeto (escopos project/local).
pub fn plugin_action(config_dir: Option<&Path>, plugin_id: &str, scope: &str, project: Option<&Path>, action: &str) -> Result<String, String> {
    safe_name(plugin_id)?;
    scope_ok(scope)?;
    if scope != "user" && project.is_none_or(|p| !p.is_dir()) {
        return Err("A pasta do projeto desse plugin não existe mais.".into());
    }
    match action {
        "enable" | "disable" | "uninstall" => claude(config_dir, project, &["plugin", action, plugin_id, "--scope", scope]),
        _ => Err("ação inválida".into()),
    }
}

/// Remove um servidor MCP da configuração (o comando do servidor continua instalado).
pub fn mcp_remove(config_dir: Option<&Path>, name: &str, scope: &str, project: Option<&Path>) -> Result<String, String> {
    safe_name(name)?;
    scope_ok(scope)?;
    if scope != "user" && project.is_none_or(|p| !p.is_dir()) {
        return Err("A pasta do projeto desse servidor não existe mais.".into());
    }
    claude(config_dir, project, &["mcp", "remove", name, "--scope", scope])
}

// ---------------------------------------------------------------- testes

#[cfg(test)]
mod tests {
    use super::*;
    use crate::skills::{Layer, McpInfo};
    use crate::xray::procs::Proc;

    fn mcp(id: &str, cmd: &str, args: &[&str], project: Option<&str>) -> Item {
        Item {
            id: id.into(),
            kind: Kind::Mcp,
            name: id.into(),
            description: String::new(),
            layer: Layer::Conta,
            accounts: vec![],
            project: project.map(String::from),
            plugin: None,
            origin: None,
            group: None,
            path: None,
            enabled: true,
            mcp: Some(McpInfo {
                transport: "stdio".into(),
                command: Some(cmd.into()),
                args: args.iter().map(|a| a.to_string()).collect(),
                url: None,
                env_names: vec![],
                header_names: vec![],
                found: Some(true),
                defined_in: String::new(),
                scope: "user".into(),
            }),
            always_tokens: 0,
            invoke_tokens: 0,
            manage: "cli",
        }
    }

    fn proc_(pid: u32, cmd: &str) -> Proc {
        Proc { pid, name: String::new(), cmd: cmd.into(), cpu: 1.5, mem: 1000, ports: vec![], depth: 1 }
    }

    #[test]
    fn needles_find_the_server_not_the_launcher() {
        assert_eq!(needle("npx", &["-y".into(), "@playwright/mcp".into()]).as_deref(), Some("@playwright/mcp"));
        assert_eq!(needle("/opt/homebrew/bin/uvx", &["mcp-server-git".into()]).as_deref(), Some("mcp-server-git"));
        assert_eq!(needle("/Users/a/bin/figma-mcp", &[]).as_deref(), Some("figma-mcp"));
        assert_eq!(needle("docker", &["run".into(), "-i".into(), "ghcr.io/x/srv".into()]).as_deref(), Some("ghcr.io/x/srv"));
        assert_eq!(needle("npx", &["-y".into(), "•••".into()]), None);
    }

    #[test]
    fn matches_running_servers_by_project() {
        let items = probes(&[mcp("pw", "npx", &["-y", "@playwright/mcp"], None), mcp("db", "uvx", &["mcp-server-sqlite"], Some("/p/app")), mcp("x", "npx", &["•••"], None)]);
        assert_eq!(items.len(), 2);
        let groups = vec![
            AgentGroup { pid: 1, agent: "Claude Code".into(), cwd: Some("/p/app".into()), cpu: 0.0, mem: 0, run_secs: 0, ports: vec![], host: "Terminal", children: vec![proc_(10, "node npx -y @playwright/mcp"), proc_(11, "uv tool run mcp-server-sqlite")] },
            AgentGroup { pid: 2, agent: "Claude Code".into(), cwd: Some("/p/outro".into()), cpu: 0.0, mem: 0, run_secs: 0, ports: vec![], host: "Terminal", children: vec![proc_(20, "node @playwright/mcp"), proc_(21, "mcp-server-sqlite")] },
        ];
        let r = mcp_running(&items, &groups);
        assert_eq!(r["pw"].iter().map(|x| x.pid).collect::<Vec<_>>(), [10, 20]);
        // o servidor do projeto /p/app não conta o processo aberto pelo agente de outra pasta
        assert_eq!(r["db"].iter().map(|x| x.pid).collect::<Vec<_>>(), [11]);
        assert_eq!(r["db"][0].cwd.as_deref(), Some("/p/app"));
    }

    #[test]
    fn trash_only_known_skill_files() {
        let tmp = tempfile::tempdir().unwrap();
        let skill = tmp.path().join("conta/skills/minha");
        std::fs::create_dir_all(&skill).unwrap();
        std::fs::write(skill.join("SKILL.md"), "---\nname: minha\n---").unwrap();
        let plug = tmp.path().join("conta/plugins/cache/x/skills/s");
        std::fs::create_dir_all(&plug).unwrap();
        std::fs::write(plug.join("SKILL.md"), "x").unwrap();
        let other = tmp.path().join("conta/notas.md");
        std::fs::write(&other, "x").unwrap();
        let s = |p: &Path| p.to_string_lossy().to_string();
        let allowed: HashSet<String> = [s(&skill.join("SKILL.md")), s(&plug.join("SKILL.md")), s(&other)].into();

        assert!(trash_item(&s(&tmp.path().join("nao/listado.md")), &allowed).is_err());
        assert!(trash_item(&s(&plug.join("SKILL.md")), &allowed).unwrap_err().contains("plugin"));
        assert!(trash_item(&s(&other), &allowed).is_err());
        assert!(safe_name("--help").is_err() && safe_name("a b").is_err() && safe_name("figma@claude-plugins-official").is_ok());
        assert!(scope_ok("system").is_err());
    }
}
