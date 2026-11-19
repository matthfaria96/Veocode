//! Skills, comandos, agentes e servidores MCP que cada conta do Claude enxerga — e de onde vêm.
//!
//! Camadas (como o Claude Code soma):
//! - **conta**: `<pasta da conta>/skills|commands|agents` e `mcpServers` do `.claude.json`;
//! - **plugin**: plugins instalados na conta (`plugins/installed_plugins.json`);
//! - **projeto**: `<projeto>/.claude/skills|commands|agents`, `<projeto>/.mcp.json`
//!   e os MCP "locais" que a conta guardou para aquela pasta.
//!
//! Só leitura. De MCP sai o comando e o NOME das variáveis de ambiente — nunca os valores,
//! que costumam ser chaves. Argumentos que parecem segredo saem como "•••".

use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Skill,
    Command,
    Agent,
    Mcp,
}

#[derive(Debug, Serialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Layer {
    Conta,
    Plugin,
    Projeto,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpInfo {
    /// stdio | http | sse
    pub transport: String,
    pub command: Option<String>,
    pub args: Vec<String>,
    /// Sem query string (pode ter token).
    pub url: Option<String>,
    pub env_names: Vec<String>,
    pub header_names: Vec<String>,
    /// stdio: o programa existe nesta máquina? (http: não testado)
    pub found: Option<bool>,
    /// Arquivo onde está declarado.
    pub defined_in: String,
    /// Onde o Claude Code guarda: user (conta), local (conta + pasta), project (.mcp.json) ou plugin.
    pub scope: String,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub kind: Kind,
    pub name: String,
    pub description: String,
    pub layer: Layer,
    /// Contas (ids do Veocode) que enxergam este item.
    pub accounts: Vec<String>,
    /// Pasta do projeto (camada projeto).
    pub project: Option<String>,
    /// Nome do plugin (camada plugin).
    pub plugin: Option<String>,
    /// De onde veio, em palavras: "sincronizada do claude.ai", "plugin figma"…
    pub origin: Option<String>,
    /// Programa que instalou junto com outras (lista própria na pasta skills/, como
    /// `.chatcut-desktop-skills.json`): o nome dele, para a tela agrupar.
    pub group: Option<String>,
    /// Arquivo para abrir/mostrar (SKILL.md, .md do comando, .mcp.json…).
    pub path: Option<String>,
    pub enabled: bool,
    pub mcp: Option<McpInfo>,
    /// Peso no contexto: o nome e a descrição entram em TODA conversa (~4 letras por token)…
    pub always_tokens: u32,
    /// …e o arquivo inteiro entra quando a skill/comando/agente é usado.
    pub invoke_tokens: u32,
    /// Como tirar: "trash" (arquivo/pasta vai para a Lixeira), "plugin" (vem de um plugin),
    /// "synced" (sincronizada do claude.ai), "cli" (MCP: `claude mcp remove`).
    pub manage: &'static str,
}

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub items: Vec<Item>,
    pub plugins: Vec<PluginInfo>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: Option<String>,
    pub enabled: bool,
    pub account: String,
    pub project: Option<String>,
    pub path: String,
    pub skills: usize,
    pub mcp: usize,
    /// id do Claude Code ("nome@marketplace") e escopo da instalação (user, project, local)
    pub plugin_id: String,
    pub scope: String,
    pub bytes: u64,
    /// soma do peso fixo no contexto das skills/agentes/comandos do plugin
    pub always_tokens: u32,
}

/// Uma conta do Claude: id no Veocode, pasta de configuração e o `.claude.json` dela.
pub struct ClaudeHome {
    pub account: String,
    pub dir: PathBuf,
    pub json: PathBuf,
}

// ---------------------------------------------------------------- frontmatter

/// Lê o cabeçalho `---` de um .md: `chave: valor`, aspas e blocos `|` / `>`.
pub fn frontmatter(text: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let text = text.trim_start_matches('\u{feff}');
    let Some(rest) = text.strip_prefix("---") else { return out };
    let rest = rest.trim_start_matches(['\r']).strip_prefix('\n').unwrap_or(rest);
    let mut lines = rest.lines().peekable();
    while let Some(line) = lines.next() {
        if line.trim_end() == "---" {
            break;
        }
        if line.starts_with([' ', '\t']) || line.trim().is_empty() || line.trim_start().starts_with('#') {
            continue;
        }
        let Some((k, v)) = line.split_once(':') else { continue };
        let key = k.trim().to_string();
        let v = v.trim();
        let mut value = if v.starts_with('|') || v.starts_with('>') {
            let fold = v.starts_with('>');
            let mut parts = Vec::new();
            while let Some(next) = lines.peek() {
                if next.trim_end() == "---" || !(next.starts_with([' ', '\t']) || next.trim().is_empty()) {
                    break;
                }
                parts.push(next.trim().to_string());
                lines.next();
            }
            parts.join(if fold { " " } else { "\n" }).trim().to_string()
        } else {
            let mut s = v.to_string();
            // escalar simples que continua nas linhas indentadas seguintes
            while let Some(next) = lines.peek() {
                if !next.starts_with([' ', '\t']) || next.trim().is_empty() {
                    break;
                }
                s.push(' ');
                s.push_str(next.trim());
                lines.next();
            }
            s
        };
        if value.len() >= 2 && ((value.starts_with('"') && value.ends_with('"')) || (value.starts_with('\'') && value.ends_with('\''))) {
            value = value[1..value.len() - 1].replace("\\\"", "\"").replace("''", "'");
        }
        out.insert(key, value);
    }
    out
}

fn body_after_frontmatter(text: &str) -> &str {
    if let Some(rest) = text.strip_prefix("---") {
        if let Some(i) = rest.find("\n---") {
            return rest[i + 4..].trim_start_matches(['-', '\r', '\n']);
        }
    }
    text
}

/// Descrição: a do cabeçalho; sem ela, a primeira frase do texto.
fn describe(text: &str, fm: &HashMap<String, String>) -> String {
    let d = fm.get("description").cloned().unwrap_or_else(|| {
        body_after_frontmatter(text)
            .lines()
            .map(str::trim)
            .find(|l| !l.is_empty() && !l.starts_with('#') && !l.starts_with("```") && !l.starts_with('<'))
            .unwrap_or("")
            .to_string()
    });
    let d = d.split_whitespace().collect::<Vec<_>>().join(" ");
    if d.chars().count() > 280 { format!("{}…", d.chars().take(278).collect::<String>()) } else { d }
}

/// Tokens aproximados de um texto (como o próprio Claude Code estima: ~4 letras por token).
pub fn tokens(chars: usize) -> u32 {
    chars.div_ceil(4) as u32
}

fn read_head(path: &Path) -> String {
    use std::io::Read;
    let mut buf = Vec::new();
    if let Ok(f) = fs::File::open(path) {
        let _ = f.take(16 * 1024).read_to_end(&mut buf);
    }
    String::from_utf8_lossy(&buf).to_string()
}

// ---------------------------------------------------------------- skills / comandos / agentes

const SKIP: &[&str] = &["node_modules", ".git", "target", "dist", "build", "__pycache__", ".venv"];
const MAX_PER_DIR: usize = 600;

/// Pastas com SKILL.md dentro de `dir` (desce até `depth` níveis).
fn find_skills(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if out.len() >= MAX_PER_DIR {
        return;
    }
    let Ok(rd) = fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = rd.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        let p = e.path();
        let name = e.file_name().to_string_lossy().to_string();
        // pastas ocultas (ex.: .trash com skills apagadas) o Claude Code também ignora
        if SKIP.contains(&name.as_str()) || name.starts_with('.') || !p.is_dir() {
            continue;
        }
        let md = p.join("SKILL.md");
        if md.is_file() {
            out.push(md);
        } else if depth > 0 {
            find_skills(&p, depth - 1, out);
        }
    }
}

fn md_files(dir: &Path) -> Vec<PathBuf> {
    let Ok(rd) = fs::read_dir(dir) else { return vec![] };
    let mut v: Vec<PathBuf> = rd.flatten().map(|e| e.path()).filter(|p| p.is_file() && p.extension().is_some_and(|x| x == "md")).take(MAX_PER_DIR).collect();
    v.sort();
    v
}

struct Ctx<'a> {
    layer: Layer,
    accounts: &'a [String],
    project: Option<&'a str>,
    plugin: Option<&'a str>,
    enabled: bool,
}

impl Ctx<'_> {
    fn item(&self, kind: Kind, name: String, description: String, origin: Option<String>, path: &Path) -> Item {
        Item {
            id: format!("{kind:?}:{}", path.to_string_lossy()),
            kind,
            name,
            description,
            layer: self.layer,
            accounts: self.accounts.to_vec(),
            project: self.project.map(str::to_string),
            plugin: self.plugin.map(str::to_string),
            origin,
            group: None,
            path: Some(path.to_string_lossy().to_string()),
            enabled: self.enabled,
            mcp: None,
            always_tokens: 0,
            invoke_tokens: 0,
            manage: if self.plugin.is_some() { "plugin" } else { "trash" },
        }
    }
}

/// Peso no contexto: nome + descrição completa sempre; o arquivo inteiro ao usar.
fn weigh(it: &mut Item, text: &str, fm: &HashMap<String, String>, file: &Path) {
    let desc = fm.get("description").map(|d| d.chars().count()).unwrap_or_else(|| it.description.chars().count());
    it.always_tokens = tokens(it.name.chars().count() + desc) + 4;
    let len = fs::metadata(file).map(|m| m.len() as usize).unwrap_or(text.len());
    it.invoke_tokens = tokens(len);
}

/// Listas que programas deixam na pasta skills/ dizendo quais pastas são deles
/// (ex.: `.chatcut-desktop-skills.json` com `{"entries": {"chatcut-music": "…"}}`).
/// Devolve pasta → nome do programa ("chatcut-desktop").
fn installer_lists(dir: &Path) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let Ok(rd) = fs::read_dir(dir) else { return out };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if !name.starts_with('.') || !name.ends_with(".json") || name.len() > 80 {
            continue;
        }
        let Ok(meta) = e.metadata() else { continue };
        if !meta.is_file() || meta.len() > 512 * 1024 {
            continue;
        }
        let Ok(v) = fs::read_to_string(e.path()).map(|t| serde_json::from_str::<serde_json::Value>(&t)) else { continue };
        let Ok(v) = v else { continue };
        let owner = name.trim_start_matches('.').trim_end_matches(".json").trim_end_matches("-skills").to_string();
        let keys: Vec<String> = match v.get("entries").or_else(|| v.get("skills")) {
            Some(serde_json::Value::Object(m)) => m.keys().cloned().collect(),
            Some(serde_json::Value::Array(a)) => a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect(),
            _ => continue,
        };
        for k in keys {
            out.insert(k, owner.clone());
        }
    }
    out
}

/// skills/, commands/ e agents/ de uma pasta `.claude` (de conta, projeto ou plugin).
fn scan_claude_dir(base: &Path, skills_dirs: &[PathBuf], ctx: &Ctx, out: &mut Vec<Item>) {
    let mut seen_synced = HashSet::new();
    for sd in skills_dirs {
        let owners = installer_lists(sd);
        let mut found = Vec::new();
        find_skills(sd, 3, &mut found);
        for md in found {
            let text = read_head(&md);
            let fm = frontmatter(&text);
            let folder = md.parent().and_then(|p| p.file_name()).map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            let synced = md.components().any(|c| c.as_os_str() == "synced");
            if synced && !seen_synced.insert(folder.clone()) {
                continue; // a mesma skill sincronizada aparece em mais de um "balde"
            }
            let origin = if synced { Some(crate::i18n::tr("sincronizada do claude.ai", "synced from claude.ai").to_string()) } else { fm.get("name").filter(|n| **n != folder).map(|n| crate::trf!("chamada de “{n}”", "called “{n}”")) };
            let mut it = ctx.item(Kind::Skill, folder, describe(&text, &fm), origin, &md);
            weigh(&mut it, &text, &fm, &md);
            it.group = owners.get(&it.name).cloned();
            if synced && ctx.plugin.is_none() {
                it.manage = "synced";
            }
            out.push(it);
        }
    }
    for (sub, kind) in [("commands", Kind::Command), ("agents", Kind::Agent)] {
        for f in md_files(&base.join(sub)) {
            let text = read_head(&f);
            let fm = frontmatter(&text);
            let stem = f.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            let name = if kind == Kind::Command { format!("/{stem}") } else { fm.get("name").cloned().unwrap_or(stem) };
            let mut it = ctx.item(kind, name, describe(&text, &fm), None, &f);
            weigh(&mut it, &text, &fm, &f);
            out.push(it);
        }
    }
}

// ---------------------------------------------------------------- MCP

fn looks_secret(flag: &str) -> bool {
    let f = flag.to_ascii_lowercase();
    ["key", "token", "secret", "password", "passwd", "auth", "bearer", "credential"].iter().any(|w| f.contains(w))
}

/// Tira valores que parecem segredo dos argumentos.
pub fn redact_args(args: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    let mut hide_next = false;
    for a in args.iter().take(40) {
        if hide_next {
            out.push("•••".into());
            hide_next = false;
            continue;
        }
        if a.starts_with('-') {
            if let Some((flag, _)) = a.split_once('=') {
                if looks_secret(flag) {
                    out.push(format!("{flag}=•••"));
                    continue;
                }
            } else if looks_secret(a) {
                hide_next = true;
            }
            out.push(a.clone());
            continue;
        }
        // token solto (sk-…, ghp_…, longos sem espaço e com mistura de letras e números)
        let suspicious = a.starts_with("sk-") || a.starts_with("ghp_") || a.starts_with("xox") || (a.len() >= 32 && !a.contains('/') && !a.contains('.') && a.chars().any(|c| c.is_ascii_digit()) && a.chars().any(|c| c.is_ascii_alphabetic()));
        out.push(if suspicious { "•••".into() } else { a.clone() });
    }
    out
}

fn strip_query(url: &str) -> String {
    url.split(['?', '#']).next().unwrap_or(url).to_string()
}

fn command_found(cmd: &str) -> bool {
    let p = Path::new(cmd);
    if p.is_absolute() {
        return p.exists();
    }
    crate::xray::util::which(cmd).is_some()
}

fn mcp_item(name: &str, v: &Value, defined_in: &Path, ctx: &Ctx, enabled: bool, scope: &str) -> Item {
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).map(str::to_string);
    let keys = |k: &str| -> Vec<String> {
        let mut ks: Vec<String> = v.get(k).and_then(|x| x.as_object()).map(|o| o.keys().cloned().collect()).unwrap_or_default();
        ks.sort();
        ks
    };
    let url = s("url");
    let transport = s("type").unwrap_or_else(|| if url.is_some() { "http".into() } else { "stdio".into() });
    let command = s("command");
    let args: Vec<String> = v.get("args").and_then(|x| x.as_array()).map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect()).unwrap_or_default();
    let found = command.as_deref().map(command_found);
    let description = match (&command, &url) {
        (Some(c), _) => format!("Roda {}", Path::new(c).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| c.clone())),
        (None, Some(u)) => crate::trf!("Servidor remoto em {}", "Remote server at {}", strip_query(u).split("://").nth(1).unwrap_or("").split('/').next().unwrap_or("")),
        _ => crate::i18n::tr("Sem comando nem endereço", "No command or address").into(),
    };
    Item {
        id: format!("mcp:{}:{}", defined_in.to_string_lossy(), name),
        kind: Kind::Mcp,
        name: name.into(),
        description,
        layer: ctx.layer,
        accounts: ctx.accounts.to_vec(),
        project: ctx.project.map(str::to_string),
        plugin: ctx.plugin.map(str::to_string),
        origin: None,
        group: None,
        path: Some(defined_in.to_string_lossy().to_string()),
        enabled: enabled && ctx.enabled,
        mcp: Some(McpInfo {
            transport,
            command,
            args: redact_args(&args),
            url: url.as_deref().map(strip_query),
            env_names: keys("env"),
            header_names: keys("headers"),
            found,
            defined_in: defined_in.to_string_lossy().to_string(),
            scope: scope.into(),
        }),
        always_tokens: 0,
        invoke_tokens: 0,
        manage: if scope == "plugin" { "plugin" } else { "cli" },
    }
}

fn mcp_servers(v: &Value) -> Vec<(String, Value)> {
    let obj = v.get("mcpServers").and_then(|x| x.as_object());
    let mut list: Vec<(String, Value)> = obj.map(|o| o.iter().map(|(k, v)| (k.clone(), v.clone())).collect()).unwrap_or_default();
    list.sort_by(|a, b| a.0.cmp(&b.0));
    list
}

fn read_json(p: &Path) -> Option<Value> {
    serde_json::from_str(&fs::read_to_string(p).ok()?).ok()
}

// ---------------------------------------------------------------- relatório

/// `homes`: contas do Claude. `projects`: pastas dos projetos do Veocode.
pub fn report(homes: &[ClaudeHome], projects: &[PathBuf]) -> Report {
    let mut r = Report::default();
    let all_accounts: Vec<String> = homes.iter().map(|h| h.account.clone()).collect();

    for h in homes {
        let acc = std::slice::from_ref(&h.account);
        let conta = Ctx { layer: Layer::Conta, accounts: acc, project: None, plugin: None, enabled: true };
        scan_claude_dir(&h.dir, &[h.dir.join("skills")], &conta, &mut r.items);

        let cfg = read_json(&h.json);
        if let Some(cfg) = &cfg {
            for (name, v) in mcp_servers(cfg) {
                r.items.push(mcp_item(&name, &v, &h.json, &conta, true, "user"));
            }
            // MCP "locais": guardados pela conta para uma pasta específica
            if let Some(ps) = cfg.get("projects").and_then(|x| x.as_object()) {
                for (path, pv) in ps {
                    let local = Ctx { layer: Layer::Projeto, accounts: acc, project: Some(path), plugin: None, enabled: true };
                    for (name, v) in mcp_servers(pv) {
                        let mut it = mcp_item(&name, &v, &h.json, &local, true, "local");
                        it.origin = Some(crate::i18n::tr("local (só desta conta)", "local (this account only)").into());
                        it.id = format!("mcp:{}:{}:{}", h.json.to_string_lossy(), path, name);
                        r.items.push(it);
                    }
                }
            }
        }

        // plugins
        let settings = read_json(&h.dir.join("settings.json"));
        let enabled_map = settings.as_ref().and_then(|s| s.get("enabledPlugins")).and_then(|x| x.as_object()).cloned().unwrap_or_default();
        let installed = read_json(&h.dir.join("plugins/installed_plugins.json"));
        let plugins = installed.as_ref().and_then(|v| v.get("plugins")).and_then(|x| x.as_object()).cloned().unwrap_or_default();
        for (pid, entry) in plugins {
            let e = if let Some(a) = entry.as_array() { a.first().cloned().unwrap_or(Value::Null) } else { entry.clone() };
            let Some(install) = e.get("installPath").and_then(|x| x.as_str()).map(PathBuf::from) else { continue };
            if !install.is_dir() {
                continue;
            }
            let project_path = e.get("projectPath").and_then(|x| x.as_str()).map(str::to_string);
            // plugin de projeto: ativo pelo settings do próprio projeto
            let enabled = match &project_path {
                Some(pp) => [".claude/settings.json", ".claude/settings.local.json"]
                    .iter()
                    .filter_map(|f| read_json(&Path::new(pp).join(f)))
                    .any(|s| s.get("enabledPlugins").and_then(|m| m.get(&pid)).and_then(|x| x.as_bool()) == Some(true)),
                None => enabled_map.get(&pid).and_then(|x| x.as_bool()).unwrap_or(false),
            };
            let manifest = read_json(&install.join(".claude-plugin/plugin.json")).unwrap_or(Value::Null);
            let name = manifest.get("name").and_then(|x| x.as_str()).map(str::to_string).unwrap_or_else(|| pid.split('@').next().unwrap_or(&pid).to_string());
            let skill_dirs: Vec<PathBuf> = match manifest.get("skills") {
                Some(Value::String(s)) => vec![install.join(s)],
                Some(Value::Array(a)) => a.iter().filter_map(|x| x.as_str()).map(|s| install.join(s)).collect(),
                _ => vec![install.join("skills")],
            };
            let ctx = Ctx { layer: Layer::Plugin, accounts: acc, project: project_path.as_deref(), plugin: Some(&name), enabled };
            let before = r.items.len();
            scan_claude_dir(&install, &skill_dirs, &ctx, &mut r.items);
            let skills = r.items.len() - before;
            let mcp_file = install.join(".mcp.json");
            let mut mcp = 0;
            if let Some(m) = read_json(&mcp_file) {
                for (n, v) in mcp_servers(&m) {
                    r.items.push(mcp_item(&n, &v, &mcp_file, &ctx, true, "plugin"));
                    mcp += 1;
                }
            }
            let always_tokens = r.items[before..].iter().map(|i| i.always_tokens).sum();
            let scope = e.get("scope").and_then(|x| x.as_str()).unwrap_or(if project_path.is_some() { "project" } else { "user" }).to_string();
            r.plugins.push(PluginInfo {
                plugin_id: pid.clone(),
                scope,
                bytes: crate::xray::util::dir_size(&install),
                always_tokens,
                id: format!("{}:{pid}", h.account),
                name,
                description: manifest.get("description").and_then(|x| x.as_str()).unwrap_or("").to_string(),
                version: e.get("version").and_then(|x| x.as_str()).map(str::to_string),
                enabled,
                account: h.account.clone(),
                project: project_path,
                path: install.to_string_lossy().to_string(),
                skills,
                mcp,
            });
        }
    }

    // projetos do Veocode: .claude/ e .mcp.json (valem para qualquer conta que trabalhe ali)
    for root in projects {
        let root_s = root.to_string_lossy().to_string();
        let ctx = Ctx { layer: Layer::Projeto, accounts: &all_accounts, project: Some(&root_s), plugin: None, enabled: true };
        let dot = root.join(".claude");
        scan_claude_dir(&dot, &[dot.join("skills")], &ctx, &mut r.items);
        let mcp_file = root.join(".mcp.json");
        if let Some(m) = read_json(&mcp_file) {
            for (name, v) in mcp_servers(&m) {
                // o Claude Code pede aprovação para servidores do .mcp.json: vê o que cada conta decidiu
                let mut approved = false;
                let mut rejected = false;
                for h in homes {
                    let p = read_json(&h.json).and_then(|c| c.get("projects").and_then(|ps| ps.get(&root_s)).cloned());
                    let has = |k: &str| p.as_ref().and_then(|x| x.get(k)).and_then(|x| x.as_array()).is_some_and(|a| a.iter().any(|x| x.as_str() == Some(&name)));
                    approved |= has("enabledMcpjsonServers");
                    rejected |= has("disabledMcpjsonServers");
                }
                let mut it = mcp_item(&name, &v, &mcp_file, &ctx, !rejected, "project");
                it.origin = Some(if approved { crate::i18n::tr("aprovado no projeto", "approved in the project").into() } else if rejected { crate::i18n::tr("recusado no projeto", "declined in the project").into() } else { crate::i18n::tr("aguardando aprovação", "waiting for approval").into() });
                r.items.push(it);
            }
        }
    }
    r
}

/// Lê o arquivo de um item para mostrar na tela. Só aceita caminhos que o relatório devolveu.
pub fn read_item(path: &str, allowed: &HashSet<String>) -> Result<String, String> {
    if !allowed.contains(path) {
        return Err(crate::i18n::tr("arquivo fora da lista de skills", "file outside the skills list").into());
    }
    let p = Path::new(path);
    let len = fs::metadata(p).map_err(|e| e.to_string())?.len();
    if len > 256 * 1024 {
        return Err(crate::i18n::tr("arquivo grande demais para mostrar aqui", "file too large to show here").into());
    }
    let text = fs::read_to_string(p).map_err(|e| e.to_string())?;
    // .claude.json e .mcp.json podem ter chaves: nesses mostra só o que é do MCP, sem valores de env/headers
    if p.extension().is_some_and(|x| x == "json") {
        return Ok(crate::i18n::tr("(arquivo de configuração — os valores podem conter chaves e não são mostrados)", "(configuration file — the values may contain keys and aren't shown)").into());
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_frontmatter_variants() {
        let fm = frontmatter("---\nname: app-promo\ndescription: |\n  Linha um\n  linha dois\nuser-invocable: true\n---\n# corpo");
        assert_eq!(fm["name"], "app-promo");
        assert_eq!(fm["description"], "Linha um\nlinha dois");
        let fm = frontmatter("---\ndescription: \"Com: dois pontos\"\nother: >\n  dobra\n  aqui\n---\n");
        assert_eq!(fm["description"], "Com: dois pontos");
        assert_eq!(fm["other"], "dobra aqui");
        let fm = frontmatter("---\ndescription: começa aqui\n  e continua\nname: x\n---");
        assert_eq!(fm["description"], "começa aqui e continua");
        assert!(frontmatter("# sem cabeçalho").is_empty());
    }

    #[test]
    fn description_falls_back_to_body() {
        let t = "---\nname: x\n---\n\n# Título\n\nFaz uma coisa útil.\n";
        assert_eq!(describe(t, &frontmatter(t)), "Faz uma coisa útil.");
    }

    #[test]
    fn redacts_secrets_in_args() {
        let a: Vec<String> = ["--api-key", "abc123", "--token=xyz", "-y", "@scope/server", "sk-live-123", "--port", "8080", "ghp_aaaaaaaaaaaaaaaaaaaa"].iter().map(|s| s.to_string()).collect();
        assert_eq!(redact_args(&a), vec!["--api-key", "•••", "--token=•••", "-y", "@scope/server", "•••", "--port", "8080", "•••"]);
        assert_eq!(strip_query("https://x.com/mcp?token=abc"), "https://x.com/mcp");
    }

    #[test]
    fn scans_account_plugin_and_project_without_leaking_env() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path().join("home");
        fs::create_dir_all(home.join("skills/minha-skill")).unwrap();
        fs::write(home.join("skills/minha-skill/SKILL.md"), "---\nname: minha-skill\ndescription: Faz X.\n---\n").unwrap();
        fs::create_dir_all(home.join("skills/synced/b1/docs")).unwrap();
        fs::write(home.join("skills/synced/b1/docs/SKILL.md"), "---\ndescription: d\n---").unwrap();
        fs::create_dir_all(home.join("skills/synced/b2/docs")).unwrap();
        fs::write(home.join("skills/synced/b2/docs/SKILL.md"), "---\ndescription: d\n---").unwrap();
        fs::create_dir_all(home.join("skills/.trash/x/velha")).unwrap();
        fs::write(home.join("skills/.trash/x/velha/SKILL.md"), "---\ndescription: apagada\n---").unwrap();
        fs::create_dir_all(home.join("commands")).unwrap();
        fs::write(home.join("commands/deploy.md"), "Publica o site.").unwrap();
        // plugin com skills em pasta declarada
        let plug = tmp.path().join("plug");
        fs::create_dir_all(plug.join(".claude-plugin")).unwrap();
        fs::write(plug.join(".claude-plugin/plugin.json"), r#"{"name":"meu-plugin","skills":"./extra/"}"#).unwrap();
        fs::create_dir_all(plug.join("extra/s1")).unwrap();
        fs::write(plug.join("extra/s1/SKILL.md"), "---\ndescription: s1\n---").unwrap();
        fs::write(plug.join(".mcp.json"), r#"{"mcpServers":{"p":{"command":"definitely-not-a-real-binary-xyz"}}}"#).unwrap();
        fs::create_dir_all(home.join("plugins")).unwrap();
        fs::write(home.join("plugins/installed_plugins.json"), format!(r#"{{"plugins":{{"meu-plugin@m":[{{"installPath":"{}","version":"1.0"}}]}}}}"#, plug.display())).unwrap();
        fs::write(home.join("settings.json"), r#"{"enabledPlugins":{"meu-plugin@m":true}}"#).unwrap();
        let json = tmp.path().join(".claude.json");
        fs::write(&json, r#"{"mcpServers":{"gh":{"type":"stdio","command":"/bin/sh","args":["--token","SEGREDO"],"env":{"GITHUB_TOKEN":"SEGREDO"}}},"projects":{"/x":{"mcpServers":{"loc":{"type":"http","url":"https://h.com/mcp?k=SEGREDO","headers":{"Authorization":"SEGREDO"}}}}}}"#).unwrap();
        // projeto
        let proj = tmp.path().join("proj");
        fs::create_dir_all(proj.join(".claude/agents")).unwrap();
        fs::write(proj.join(".claude/agents/revisor.md"), "---\nname: revisor\ndescription: Revisa.\n---").unwrap();
        fs::write(proj.join(".mcp.json"), r#"{"mcpServers":{"db":{"command":"psql"}}}"#).unwrap();

        let r = report(&[ClaudeHome { account: "a1".into(), dir: home.clone(), json: json.clone() }], &[proj.clone()]);
        let names: Vec<_> = r.items.iter().map(|i| (i.layer, i.kind, i.name.as_str())).collect();
        assert!(names.contains(&(Layer::Conta, Kind::Skill, "minha-skill")));
        assert_eq!(r.items.iter().filter(|i| i.name == "docs").count(), 1, "sincronizada aparece uma vez");
        assert!(names.contains(&(Layer::Conta, Kind::Command, "/deploy")));
        assert!(!r.items.iter().any(|i| i.name == "velha"), "lixeira de skills fica de fora");
        assert!(names.contains(&(Layer::Plugin, Kind::Skill, "s1")));
        assert!(names.contains(&(Layer::Projeto, Kind::Agent, "revisor")));
        assert!(names.contains(&(Layer::Projeto, Kind::Mcp, "db")));
        assert_eq!(r.plugins.len(), 1);
        assert!(r.plugins[0].enabled && r.plugins[0].skills == 1 && r.plugins[0].mcp == 1);
        let p = r.items.iter().find(|i| i.name == "p").unwrap();
        assert_eq!(p.mcp.as_ref().unwrap().found, Some(false));
        let gh = r.items.iter().find(|i| i.name == "gh").unwrap().mcp.clone().unwrap();
        assert_eq!(gh.env_names, vec!["GITHUB_TOKEN"]);
        assert_eq!(gh.found, Some(true));
        // nenhum segredo sai no relatório
        assert!(!serde_json::to_string(&r).unwrap().contains("SEGREDO"));
        let loc = r.items.iter().find(|i| i.name == "loc").unwrap();
        assert_eq!(loc.project.as_deref(), Some("/x"));
        assert_eq!(loc.mcp.as_ref().unwrap().header_names, vec!["Authorization"]);
    }
}

/// Diagnóstico manual (só leitura): `cargo test real_skills_report -- --ignored --nocapture`
#[cfg(test)]
#[test]
#[ignore]
fn real_skills_report() {
    let home = crate::xray::util::home();
    let t = std::time::Instant::now();
    let r = report(&[ClaudeHome { account: "principal".into(), dir: home.join(".claude"), json: home.join(".claude.json") }], &[PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")]);
    println!("em {:?}: {} itens", t.elapsed(), r.items.len());
    if let Ok(out) = std::env::var("VEOCODE_DUMP") {
        fs::write(out, serde_json::to_string(&r).unwrap()).unwrap();
    }
    let mut count: HashMap<String, usize> = HashMap::new();
    for i in &r.items {
        *count.entry(format!("{:?}/{:?}", i.layer, i.kind)).or_default() += 1;
    }
    let mut c: Vec<_> = count.into_iter().collect();
    c.sort();
    println!("{c:?}");
    for p in &r.plugins {
        println!("PLUGIN {} v{:?} ativo={} skills={} mcp={} projeto={:?}", p.name, p.version, p.enabled, p.skills, p.mcp, p.project);
    }
    for i in r.items.iter().filter(|i| i.kind == Kind::Mcp) {
        let m = i.mcp.as_ref().unwrap();
        println!("MCP {:?} {} found={:?} env={:?} origem={:?} projeto={:?}", i.layer, i.name, m.found, m.env_names, i.origin, i.project);
    }
    for i in r.items.iter().filter(|i| i.kind == Kind::Skill).take(4) {
        println!("SKILL {} ({:?}) {:?}", i.name, i.origin, i.path);
    }
}
