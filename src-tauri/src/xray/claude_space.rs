//! Espaço que o Claude ocupa nesta máquina: o app do Claude (ambiente do Cowork, Claude Code
//! embutido, caches), o Claude Code do terminal (conversas, pontos de restauração, versões,
//! caches) e o próprio Veocode. Cada parte diz quanto ocupa e, quando dá, oferece um conserto.
//!
//! A interface só pede consertos por `id`; os caminhos são recalculados aqui na hora. Consertar
//! = mover para a Lixeira (dá para recuperar enquanto ela não for esvaziada).

use super::util::{dir_size, home};
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// Conversas e pontos de restauração mais velhos que isso podem ir para a Lixeira.
pub const OLD_DAYS: u64 = 30;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Fix {
    pub id: String,
    pub label: String,
    /// quanto libera (depois de esvaziar a Lixeira)
    pub frees: u64,
    /// quantos itens vão para a Lixeira
    pub items: u64,
    pub warning: Option<String>,
    /// o app do Claude precisa estar fechado
    pub needs_app_closed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detail {
    pub label: String,
    pub bytes: u64,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Part {
    pub id: String,
    pub label: String,
    pub hint: String,
    pub bytes: u64,
    /// cor da fatia na barra
    pub tone: &'static str,
    pub paths: Vec<String>,
    pub details: Vec<Detail>,
    pub fix: Option<Fix>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id: &'static str,
    pub label: String,
    pub hint: String,
    pub bytes: u64,
    pub parts: Vec<Part>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub total: u64,
    pub groups: Vec<Group>,
    pub app_running: bool,
    pub checked_at: u64,
}

fn pretty(p: &Path) -> String {
    let h = home();
    match p.strip_prefix(&h) {
        Ok(rel) => format!("~/{}", rel.to_string_lossy()),
        Err(_) => p.to_string_lossy().into_owned(),
    }
}

fn size_of(paths: &[PathBuf]) -> u64 {
    paths.iter().filter(|p| p.exists()).map(|p| if p.is_dir() { dir_size(p) } else { fs::metadata(p).map(|m| m.len()).unwrap_or(0) }).sum()
}

fn existing(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    paths.into_iter().filter(|p| p.exists()).collect()
}

/// Pasta de dados do app do Claude (desktop).
pub fn app_dir() -> PathBuf {
    #[cfg(target_os = "macos")]
    return home().join("Library/Application Support/Claude");
    #[cfg(target_os = "windows")]
    return dirs::config_dir().unwrap_or_else(|| home().join("AppData/Roaming")).join("Claude");
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    return home().join(".config/Claude");
}

/// O app do Claude está aberto? (o processo principal se chama "Claude"; o CLI é "claude")
pub fn app_running() -> bool {
    #[cfg(target_os = "macos")]
    {
        super::util::run("pgrep", &["-x", "Claude"], Duration::from_secs(3)).is_some_and(|o| !o.trim().is_empty())
    }
    #[cfg(target_os = "windows")]
    {
        super::util::run("tasklist", &["/FI", "IMAGENAME eq Claude.exe", "/NH"], Duration::from_secs(5)).is_some_and(|o| o.contains("Claude.exe"))
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        super::util::run("pgrep", &["-x", "claude-desktop"], Duration::from_secs(3)).is_some_and(|o| !o.trim().is_empty())
    }
}

const APP_CACHES: &[&str] = &["Cache", "Code Cache", "GPUCache", "GraphiteDawnCache", "DawnWebGPUCache", "DawnGraphiteCache", "Shared Dictionary", "ShaderCache", "Crashpad"];
const APP_SESSIONS: &[&str] = &["local-agent-mode-sessions", "claude-code-sessions", "scratch-workspaces", "git-shadow"];

fn app_cache_paths() -> Vec<PathBuf> {
    let a = app_dir();
    let mut v: Vec<PathBuf> = APP_CACHES.iter().map(|d| a.join(d)).collect();
    #[cfg(target_os = "macos")]
    {
        let h = home();
        v.push(h.join("Library/Logs/Claude"));
        v.push(h.join("Library/Caches/com.anthropic.claudefordesktop"));
        v.push(h.join("Library/Caches/com.anthropic.claudefordesktop.ShipIt"));
    }
    #[cfg(not(target_os = "macos"))]
    v.push(a.join("logs"));
    existing(v)
}

/// Versões dentro de uma pasta (uma subpasta ou arquivo por versão): todas menos a mais nova.
fn old_versions(dir: &Path) -> Vec<PathBuf> {
    let Ok(rd) = fs::read_dir(dir) else { return vec![] };
    let mut v: Vec<(SystemTime, PathBuf)> = rd
        .flatten()
        .filter(|e| !e.file_name().to_string_lossy().starts_with('.'))
        .map(|e| (e.metadata().and_then(|m| m.modified()).unwrap_or(SystemTime::UNIX_EPOCH), e.path()))
        .collect();
    if v.len() <= 1 {
        return vec![];
    }
    v.sort_by(|a, b| b.0.cmp(&a.0));
    v.into_iter().skip(1).map(|(_, p)| p).collect()
}

fn app_old_versions() -> Vec<PathBuf> {
    let a = app_dir();
    [a.join("claude-code"), a.join("claude-code-vm")].iter().flat_map(|d| old_versions(d)).collect()
}

fn cli_versions_dir() -> PathBuf {
    home().join(".local/share/claude/versions")
}

fn is_old(p: &Path, cutoff: SystemTime) -> bool {
    fs::metadata(p).and_then(|m| m.modified()).is_ok_and(|t| t < cutoff)
}

fn cutoff() -> SystemTime {
    SystemTime::now() - Duration::from_secs(OLD_DAYS * 86_400)
}

/// Conversas (arquivos .jsonl e a pasta de mesmo nome) mais velhas que `OLD_DAYS`.
fn old_sessions(config: &Path) -> Vec<PathBuf> {
    let c = cutoff();
    let Ok(projects) = fs::read_dir(config.join("projects")) else { return vec![] };
    let mut out = vec![];
    for proj in projects.flatten().filter(|e| e.path().is_dir()) {
        let Ok(files) = fs::read_dir(proj.path()) else { continue };
        for f in files.flatten() {
            let p = f.path();
            if p.extension().is_some_and(|x| x == "jsonl") && is_old(&p, c) {
                let side = p.with_extension("");
                out.push(p);
                if side.is_dir() {
                    out.push(side);
                }
            }
        }
    }
    out
}

/// Pontos de restauração (uma pasta por sessão) mais velhos que `OLD_DAYS`.
fn old_file_history(config: &Path) -> Vec<PathBuf> {
    let c = cutoff();
    let Ok(rd) = fs::read_dir(config.join("file-history")) else { return vec![] };
    rd.flatten().map(|e| e.path()).filter(|p| is_old(p, c)).collect()
}

fn code_cache_paths(config: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = ["cache", "shell-snapshots", "downloads", "debug", "statsig", "paste-cache"].iter().map(|d| config.join(d)).collect();
    #[cfg(target_os = "macos")]
    v.push(home().join("Library/Caches/claude-cli-nodejs"));
    #[cfg(not(target_os = "macos"))]
    v.push(home().join(".cache/claude-cli-nodejs"));
    existing(v)
}

/// Pastas de cada projeto do histórico, das maiores para as menores (nome legível).
fn history_details(config: &Path) -> Vec<Detail> {
    let Ok(rd) = fs::read_dir(config.join("projects")) else { return vec![] };
    let mut v: Vec<Detail> = rd
        .flatten()
        .filter(|e| e.path().is_dir())
        .map(|e| {
            let p = e.path();
            let n = fs::read_dir(&p).map(|r| r.flatten().filter(|f| f.path().extension().is_some_and(|x| x == "jsonl")).count()).unwrap_or(0);
            let raw = e.file_name().to_string_lossy().to_string();
            let name = raw.rsplit('-').find(|s| !s.is_empty()).unwrap_or(&raw).to_string();
            Detail { label: name, bytes: dir_size(&p), note: Some(format!("{n} {}", if n == 1 { crate::i18n::tr("conversa", "conversation") } else { crate::i18n::tr("conversas", "conversations") })) }
        })
        .collect();
    v.sort_by(|a, b| b.bytes.cmp(&a.bytes));
    v.truncate(8);
    v
}

fn fix(id: String, label: &str, paths: &[PathBuf], warning: Option<&str>, needs_app_closed: bool) -> Option<Fix> {
    if paths.is_empty() {
        return None;
    }
    let frees = size_of(paths);
    (frees > 0).then(|| Fix { id, label: label.into(), frees, items: paths.len() as u64, warning: warning.map(String::from), needs_app_closed })
}

/// Pastas de configuração do Claude Code: a padrão e as de cada conta do Veocode.
pub fn config_dirs(accounts: &[PathBuf]) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    super::caches::claude_config_dirs().into_iter().chain(accounts.iter().cloned()).filter(|p| p.is_dir() && seen.insert(p.clone())).collect()
}

pub fn report(accounts: &[PathBuf], veocode_dirs: &[PathBuf]) -> Report {
    let mut groups = vec![];

    // ---------------------------------------------------------------- app do Claude
    let a = app_dir();
    if a.is_dir() {
        let mut parts = vec![];
        let runtime = existing(vec![a.join("vm_bundles")]);
        let rb = size_of(&runtime);
        if rb > 0 {
            parts.push(Part {
                id: "app-runtime".into(),
                label: crate::i18n::tr("Ambiente do Cowork", "Cowork environment").into(),
                hint: crate::i18n::tr("A máquina virtual onde o Cowork roda as tarefas. É o que mais pesa.", "The virtual machine where Cowork runs tasks. It's the heaviest part.").into(),
                bytes: rb,
                tone: "runtime",
                paths: runtime.iter().map(|p| pretty(p)).collect(),
                details: vec![],
                fix: fix("app-runtime".into(), "Remover o ambiente", &runtime, Some(crate::i18n::tr("O app do Claude baixa de novo (vários GB) na próxima vez que você usar o Cowork.", "The Claude app downloads it again (several GB) the next time you use Cowork.")), true),
            });
        }
        let code_dirs = existing(vec![a.join("claude-code"), a.join("claude-code-vm")]);
        let cb = size_of(&code_dirs);
        if cb > 0 {
            let old = app_old_versions();
            let versions = code_dirs.iter().flat_map(|d| fs::read_dir(d).into_iter().flatten().flatten()).filter(|e| !e.file_name().to_string_lossy().starts_with('.')).count();
            parts.push(Part {
                id: "app-code".into(),
                label: crate::i18n::tr("Claude Code dentro do app", "Claude Code inside the app").into(),
                hint: crate::trf!("{versions} {} do Claude Code que o app usa.", "{versions} {} of Claude Code that the app uses.", if versions == 1 { crate::i18n::tr("versão", "version") } else { crate::i18n::tr("versões", "versions") }),
                bytes: cb,
                tone: "runtime",
                paths: code_dirs.iter().map(|p| pretty(p)).collect(),
                details: vec![],
                fix: fix("app-old-versions".into(), crate::i18n::tr("Tirar versões antigas", "Remove old versions"), &old, None, true),
            });
        }
        let caches = app_cache_paths();
        let kb = size_of(&caches);
        if kb > 0 {
            parts.push(Part {
                id: "app-cache".into(),
                label: crate::i18n::tr("Caches e logs do app", "App caches and logs").into(),
                hint: crate::i18n::tr("Cache da web, desenhos da tela e registros. O app refaz sozinho.", "Web cache, screen drawings and logs. The app rebuilds them on its own.").into(),
                bytes: kb,
                tone: "cache",
                paths: caches.iter().map(|p| pretty(p)).collect(),
                details: vec![],
                fix: fix("app-cache".into(), crate::i18n::tr("Limpar caches e logs", "Clear caches and logs"), &caches, None, true),
            });
        }
        let sessions = existing(APP_SESSIONS.iter().map(|d| a.join(d)).collect());
        let sb = size_of(&sessions);
        if sb > 0 {
            let n = existing(vec![a.join("claude-code-sessions"), a.join("local-agent-mode-sessions")]).iter().flat_map(|d| fs::read_dir(d).into_iter().flatten().flatten()).count();
            parts.push(Part {
                id: "app-sessions".into(),
                label: crate::i18n::tr("Sessões e tarefas do app", "App sessions and tasks").into(),
                hint: crate::trf!("{n} {} do Code e do Cowork. Apague pelo próprio app do Claude.", "{n} Code and Cowork {}. Delete them from the Claude app itself.", if n == 1 { crate::i18n::tr("sessão", "session") } else { crate::i18n::tr("sessões", "sessions") }),
                bytes: sb,
                tone: "sessions",
                paths: sessions.iter().map(|p| pretty(p)).collect(),
                details: vec![],
                fix: None,
            });
        }
        let all = dir_size(&a);
        // o que sobra dentro da pasta do app (os caches e logs de fora dela não contam aqui)
        let in_app: u64 = parts.iter().filter(|p| p.id != "app-cache").map(|p| p.bytes).sum::<u64>() + size_of(&existing(APP_CACHES.iter().map(|d| a.join(d)).collect()));
        let rest = all.saturating_sub(in_app);
        if rest > 0 {
            parts.push(Part {
                id: "app-data".into(),
                label: crate::i18n::tr("Login e ajustes do app", "App login and settings").into(),
                hint: crate::i18n::tr("Dados que o app precisa para funcionar. Não mexa.", "Data the app needs to work. Don't touch it.").into(),
                bytes: rest,
                tone: "other",
                paths: vec![pretty(&a)],
                details: vec![],
                fix: None,
            });
        }
        let bytes = parts.iter().map(|p| p.bytes).sum();
        groups.push(Group { id: "app", label: crate::i18n::tr("App do Claude", "Claude app").into(), hint: crate::i18n::tr("O aplicativo do Claude (chat, Cowork e Code).", "The Claude app (chat, Cowork and Code).").into(), bytes, parts });
    }

    // ---------------------------------------------------------------- Claude Code
    let configs = config_dirs(accounts);
    let mut parts = vec![];
    for (i, dir) in configs.iter().enumerate() {
        let suffix = if i == 0 { String::new() } else { format!(" · {}", pretty(dir)) };
        let hist = existing(vec![dir.join("projects")]);
        let hb = size_of(&hist);
        if hb > 0 {
            let old = old_sessions(dir);
            let n_old = old.iter().filter(|p| p.extension().is_some_and(|x| x == "jsonl")).count();
            let mut f = fix(format!("code-history:{i}"), &crate::trf!("Apagar as de mais de {OLD_DAYS} dias", "Delete those older than {OLD_DAYS} days"), &old, Some(crate::i18n::tr("Essas conversas não dão mais para retomar (/resume). As recentes ficam.", "Those conversations can no longer be resumed (/resume). Recent ones stay.")), false);
            if let Some(f) = f.as_mut() {
                f.items = n_old as u64;
            }
            parts.push(Part {
                id: format!("code-history:{i}"),
                label: format!("Conversas guardadas{suffix}"),
                hint: crate::i18n::tr("Todo o histórico das sessões, por projeto. Cresce a cada conversa.", "The full session history, per project. Grows with every conversation.").into(),
                bytes: hb,
                tone: "sessions",
                paths: hist.iter().map(|p| pretty(p)).collect(),
                details: history_details(dir),
                fix: f,
            });
        }
        let fh = existing(vec![dir.join("file-history")]);
        let fb = size_of(&fh);
        if fb > 0 {
            parts.push(Part {
                id: format!("code-file-history:{i}"),
                label: crate::trf!("Pontos de restauração{suffix}", "Restore points{suffix}"),
                hint: crate::i18n::tr("Cópias dos arquivos antes de cada edição, para desfazer.", "Copies of files before each edit, so they can be undone.").into(),
                bytes: fb,
                tone: "sessions",
                paths: fh.iter().map(|p| pretty(p)).collect(),
                details: vec![],
                fix: fix(format!("code-file-history:{i}"), &crate::trf!("Apagar os de mais de {OLD_DAYS} dias", "Delete those older than {OLD_DAYS} days"), &old_file_history(dir), Some(crate::i18n::tr("Edições antigas deixam de poder ser desfeitas pelo Claude.", "Old edits can no longer be undone by Claude.")), false),
            });
        }
        let cache = code_cache_paths(dir);
        let kb = size_of(&cache);
        if kb > 0 {
            parts.push(Part {
                id: format!("code-cache:{i}"),
                label: crate::trf!("Caches e logs{suffix}", "Caches and logs{suffix}"),
                hint: "Refeitos sozinhos quando precisa.".into(),
                bytes: kb,
                tone: "cache",
                paths: cache.iter().map(|p| pretty(p)).collect(),
                details: vec![],
                fix: fix(format!("code-cache:{i}"), "Limpar", &cache, None, false),
            });
        }
        let extras = existing(vec![dir.join("skills"), dir.join("plugins")]);
        let eb = size_of(&extras);
        if eb > 0 {
            parts.push(Part {
                id: format!("code-extras:{i}"),
                label: crate::trf!("Receitas e plugins{suffix}", "Skills and plugins{suffix}"),
                hint: crate::i18n::tr("Gerencie em Computador → Extras do Claude.", "Manage them in Computer → Claude extras.").into(),
                bytes: eb,
                tone: "other",
                paths: extras.iter().map(|p| pretty(p)).collect(),
                details: vec![],
                fix: None,
            });
        }
    }
    let versions = existing(vec![cli_versions_dir()]);
    let vb = size_of(&versions);
    if vb > 0 {
        let n = fs::read_dir(cli_versions_dir()).map(|r| r.flatten().count()).unwrap_or(0);
        parts.push(Part {
            id: "code-versions".into(),
            label: crate::i18n::tr("Versões do Claude Code", "Claude Code versions").into(),
            hint: crate::trf!("{n} {} no computador.", "{n} {} on the computer.", if n == 1 { crate::i18n::tr("versão instalada", "version installed") } else { crate::i18n::tr("versões instaladas", "versions installed") }),
            bytes: vb,
            tone: "runtime",
            paths: versions.iter().map(|p| pretty(p)).collect(),
            details: vec![],
            fix: fix("code-old-versions".into(), crate::i18n::tr("Tirar versões antigas", "Remove old versions"), &old_versions(&cli_versions_dir()), Some(crate::i18n::tr("Fica só a versão mais nova.", "Only the newest version stays.")), false),
        });
    }
    if !parts.is_empty() {
        let bytes = parts.iter().map(|p| p.bytes).sum();
        groups.push(Group { id: "code", label: "Claude Code".into(), hint: crate::i18n::tr("O Claude do terminal, que o Veocode usa nos chats.", "The terminal Claude, which Veocode uses in its chats.").into(), bytes, parts });
    }

    // ---------------------------------------------------------------- o próprio Veocode
    let vd = existing(veocode_dirs.to_vec());
    let vb = size_of(&vd);
    groups.push(Group {
        id: "veocode",
        label: "Veocode".into(),
        hint: crate::i18n::tr("Só os ajustes e listas do Veocode. As conversas dos chats ficam no Claude Code, acima.", "Only Veocode's settings and lists. Chat conversations live in Claude Code, above.").into(),
        bytes: vb,
        parts: vec![Part {
            id: "veocode".into(),
            label: crate::i18n::tr("Ajustes, cofre e listas", "Settings, vault and lists").into(),
            hint: crate::i18n::tr("Projetos, contas, rastro e ajustes. Os segredos ficam no Chaveiro.", "Projects, accounts, trail and settings. Secrets stay in the Keychain.").into(),
            bytes: vb,
            tone: "other",
            paths: vd.iter().map(|p| pretty(p)).collect(),
            details: vec![],
            fix: None,
        }],
    });

    let total = groups.iter().map(|g| g.bytes).sum();
    let checked_at = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    Report { total, groups, app_running: app_running(), checked_at }
}

/// Caminhos de um conserto, recalculados agora (a interface só manda o id).
fn fix_paths(id: &str, accounts: &[PathBuf]) -> Result<(Vec<PathBuf>, bool), String> {
    let configs = config_dirs(accounts);
    let conf = |i: &str| -> Result<PathBuf, String> { i.parse::<usize>().ok().and_then(|i| configs.get(i).cloned()).ok_or_else(|| crate::i18n::tr("pasta do Claude Code não encontrada", "Claude Code folder not found").to_string()) };
    let (kind, idx) = id.split_once(':').unwrap_or((id, ""));
    Ok(match kind {
        "app-runtime" => (existing(vec![app_dir().join("vm_bundles")]), true),
        "app-old-versions" => (app_old_versions(), true),
        "app-cache" => (app_cache_paths(), true),
        "code-history" => (old_sessions(&conf(idx)?), false),
        "code-file-history" => (old_file_history(&conf(idx)?), false),
        "code-cache" => (code_cache_paths(&conf(idx)?), false),
        "code-old-versions" => (old_versions(&cli_versions_dir()), false),
        _ => return Err("conserto desconhecido".into()),
    })
}

/// Só caminhos dentro das pastas do Claude, nunca as raízes inteiras.
fn allowed(p: &Path, accounts: &[PathBuf]) -> bool {
    let h = home();
    let mut roots = vec![app_dir(), cli_versions_dir()];
    roots.extend(config_dirs(accounts));
    #[cfg(target_os = "macos")]
    roots.extend([h.join("Library/Logs/Claude"), h.join("Library/Caches/com.anthropic.claudefordesktop"), h.join("Library/Caches/com.anthropic.claudefordesktop.ShipIt"), h.join("Library/Caches/claude-cli-nodejs")]);
    #[cfg(not(target_os = "macos"))]
    roots.push(h.join(".cache/claude-cli-nodejs"));
    let forbidden = [h.clone(), h.join(".claude"), h.join("Library"), app_dir(), PathBuf::from("/")];
    !forbidden.iter().any(|f| f == p) && roots.iter().any(|r| p == r || p.starts_with(r)) && !p.components().any(|c| c.as_os_str() == "..")
}

/// Aplica um conserto: manda para a Lixeira. Devolve quanto foi.
pub fn apply(id: &str, accounts: &[PathBuf]) -> Result<u64, String> {
    let (paths, needs_closed) = fix_paths(id, accounts)?;
    if paths.is_empty() {
        return Ok(0);
    }
    if needs_closed && app_running() {
        return Err(crate::i18n::tr("Feche o app do Claude primeiro (⌘Q nele) e tente de novo.", "Quit the Claude app first (⌘Q in it) and try again.").into());
    }
    if let Some(bad) = paths.iter().find(|p| !allowed(p, accounts)) {
        return Err(format!("recusado: {}", bad.display()));
    }
    let bytes = size_of(&paths);
    crate::inventory::to_trash(&paths).map_err(|e| e.to_string())?;
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_newest_version() {
        let d = tempfile::tempdir().unwrap();
        for (i, v) in ["2.1.1", "2.1.2", "2.1.3"].iter().enumerate() {
            let p = d.path().join(v);
            fs::write(&p, "x").unwrap();
            let t = SystemTime::now() - Duration::from_secs(1000 - i as u64 * 100);
            fs::File::options().write(true).open(&p).unwrap().set_modified(t).unwrap();
        }
        let old = old_versions(d.path());
        assert_eq!(old.len(), 2);
        assert!(!old.contains(&d.path().join("2.1.3")));
    }

    #[test]
    fn old_sessions_only() {
        let d = tempfile::tempdir().unwrap();
        let proj = d.path().join("projects/-Users-x-app");
        fs::create_dir_all(proj.join("old")).unwrap();
        fs::write(proj.join("old.jsonl"), "{}").unwrap();
        fs::write(proj.join("new.jsonl"), "{}").unwrap();
        let past = SystemTime::now() - Duration::from_secs((OLD_DAYS + 5) * 86_400);
        fs::File::options().write(true).open(proj.join("old.jsonl")).unwrap().set_modified(past).unwrap();
        let old = old_sessions(d.path());
        assert_eq!(old, vec![proj.join("old.jsonl"), proj.join("old")]);
    }

    #[test]
    fn refuses_roots_and_outsiders() {
        let h = home();
        assert!(!allowed(&h, &[]));
        assert!(!allowed(&h.join(".claude"), &[]));
        assert!(!allowed(&app_dir(), &[]));
        assert!(!allowed(&h.join("Documents"), &[]));
        assert!(allowed(&app_dir().join("Cache"), &[]));
        assert!(allowed(&h.join(".claude/projects/x/y.jsonl"), &[]));
    }

    #[test]
    fn unknown_fix_is_refused() {
        assert!(fix_paths("rm-everything", &[]).is_err());
        assert!(fix_paths("code-history:99", &[]).is_err());
    }
}
