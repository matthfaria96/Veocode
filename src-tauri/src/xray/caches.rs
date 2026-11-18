//! Caches e pastas grandes que IAs e ferramentas de desenvolvimento deixam na máquina.
//!
//! A interface só pede por `id`; os caminhos ficam fixos aqui. Assim ninguém consegue
//! pedir para "limpar" uma pasta qualquer. Limpar = mover para a Lixeira (dá para desfazer).

use super::util::{dir_size, home};
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CacheSpec {
    pub id: String,
    pub label: String,
    /// "ia" | "pacotes" | "build"
    pub kind: &'static str,
    /// Quem usa: "Claude Code", "npm", "projeto x"…
    pub tool: String,
    #[serde(skip)]
    pub paths: Vec<PathBuf>,
    pub display_paths: Vec<String>,
    /// Aviso mostrado antes de limpar (quando apagar tem consequência além de "baixa de novo").
    pub warning: Option<String>,
}

fn pretty(p: &Path) -> String {
    let h = home();
    match p.strip_prefix(&h) {
        Ok(rel) => format!("~/{}", rel.to_string_lossy()),
        Err(_) => p.to_string_lossy().into_owned(),
    }
}

fn spec(id: &str, label: &str, kind: &'static str, tool: &str, paths: Vec<PathBuf>, warning: Option<&str>) -> Option<CacheSpec> {
    let paths: Vec<PathBuf> = paths.into_iter().filter(|p| p.exists()).collect();
    if paths.is_empty() {
        return None;
    }
    Some(CacheSpec {
        id: id.into(),
        label: label.into(),
        kind,
        tool: tool.into(),
        display_paths: paths.iter().map(|p| pretty(p)).collect(),
        paths,
        warning: warning.map(String::from),
    })
}

/// Pastas de configuração do Claude Code (a padrão e a de CLAUDE_CONFIG_DIR, se houver).
pub fn claude_config_dirs() -> Vec<PathBuf> {
    let mut v = vec![home().join(".claude")];
    if let Some(custom) = std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from) {
        if !v.contains(&custom) {
            v.push(custom);
        }
    }
    v.into_iter().filter(|p| p.is_dir()).collect()
}

#[cfg(target_os = "macos")]
fn os_caches() -> PathBuf {
    home().join("Library/Caches")
}
#[cfg(target_os = "windows")]
fn os_caches() -> PathBuf {
    dirs::cache_dir().unwrap_or_else(|| home().join("AppData/Local"))
}
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn os_caches() -> PathBuf {
    home().join(".cache")
}

/// Tudo que dá para medir nesta máquina. `projects` = (nome, raiz) dos projetos cadastrados.
pub fn known(projects: &[(String, PathBuf)]) -> Vec<CacheSpec> {
    let h = home();
    let c = os_caches();
    let mut out: Vec<Option<CacheSpec>> = Vec::new();

    for (i, dir) in claude_config_dirs().iter().enumerate() {
        let suffix = if i == 0 { String::new() } else { format!(" ({})", pretty(dir)) };
        out.push(spec(
            &format!("claude-history-{i}"),
            &format!("Históricos de sessões do Claude Code{suffix}"),
            "ia",
            "Claude Code",
            vec![dir.join("projects")],
            Some("Apaga as conversas salvas: não dá mais para retomar sessões antigas (/resume). Feche o Claude Code antes."),
        ));
        out.push(spec(
            &format!("claude-file-history-{i}"),
            &format!("Cópias de arquivos editados pelo Claude{suffix}"),
            "ia",
            "Claude Code",
            vec![dir.join("file-history")],
            Some("São os pontos de restauração das edições. Sem elas, não dá para desfazer edições antigas pelo Claude."),
        ));
        out.push(spec(
            &format!("claude-cache-{i}"),
            &format!("Cache do Claude Code{suffix}"),
            "ia",
            "Claude Code",
            vec![dir.join("cache"), dir.join("shell-snapshots"), dir.join("downloads")],
            None,
        ));
    }

    out.push(spec("ollama", "Modelos locais (Ollama)", "ia", "Ollama", vec![h.join(".ollama/models")], Some("São os modelos baixados. Para usar de novo, o Ollama baixa tudo outra vez (vários GB).")));
    out.push(spec("huggingface", "Modelos e datasets (Hugging Face)", "ia", "Hugging Face", vec![h.join(".cache/huggingface")], Some("Modelos baixados precisam ser baixados de novo.")));

    out.push(spec("npm", "Cache do npm", "pacotes", "npm", vec![h.join(".npm/_cacache"), c.join("npm-cache/_cacache")], None));
    out.push(spec("pnpm", "Store do pnpm", "pacotes", "pnpm", vec![h.join("Library/pnpm/store"), h.join(".local/share/pnpm/store"), c.join("pnpm/store")], Some("Projetos com node_modules do pnpm apontam para cá; rode pnpm install de novo neles.")));
    out.push(spec("bun", "Cache do Bun", "pacotes", "bun", vec![h.join(".bun/install/cache")], None));
    out.push(spec("yarn", "Cache do Yarn", "pacotes", "yarn", vec![c.join("Yarn"), c.join("yarn")], None));
    out.push(spec("pip", "Cache do pip", "pacotes", "pip", vec![c.join("pip"), c.join("pip/Cache")], None));
    out.push(spec("uv", "Cache do uv", "pacotes", "uv", vec![h.join(".cache/uv"), c.join("uv")], None));
    out.push(spec("cargo", "Registro e git do Cargo", "pacotes", "cargo", vec![h.join(".cargo/registry"), h.join(".cargo/git")], None));
    out.push(spec("brew", "Downloads do Homebrew", "pacotes", "brew", vec![c.join("Homebrew")], None));
    out.push(spec("xcode", "DerivedData do Xcode", "build", "Xcode", vec![h.join("Library/Developer/Xcode/DerivedData")], None));

    for (name, root) in projects {
        let dirs = ["target", "src-tauri/target", "node_modules", ".next"].map(|d| root.join(d)).to_vec();
        out.push(spec(&format!("build-{name}"), &format!("Builds e dependências · {name}"), "build", name, dirs, Some("Ficam de novo prontos no próximo build / npm install.")));
    }

    out.into_iter().flatten().collect()
}

pub fn measure(spec: &CacheSpec) -> u64 {
    spec.paths.iter().map(|p| dir_size(p)).sum()
}

/// Recusa caminhos que nunca deveriam ir para a Lixeira inteiros.
pub fn is_safe_to_trash(p: &Path, project_roots: &[PathBuf]) -> bool {
    let h = home();
    let forbidden = [h.clone(), h.join(".claude"), h.join("Library"), h.join(".cargo"), h.join(".npm"), PathBuf::from("/")];
    let inside_project = project_roots.iter().any(|r| p.starts_with(r) && p != r);
    let inside_home = p.starts_with(&h) && p != h;
    !forbidden.iter().any(|f| f == p) && !project_roots.iter().any(|r| r == p) && (inside_home || inside_project)
}

pub fn move_to_trash(spec: &CacheSpec, project_roots: &[PathBuf]) -> Result<(), String> {
    for p in &spec.paths {
        if !is_safe_to_trash(p, project_roots) {
            return Err(format!("recusado: {}", p.display()));
        }
    }
    crate::inventory::to_trash(&spec.paths).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn never_offers_dangerous_roots() {
        let proj = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(proj.path().join("node_modules/x")).unwrap();
        let roots = vec![proj.path().to_path_buf()];
        let list = known(&[("p".into(), proj.path().to_path_buf())]);
        let build = list.iter().find(|s| s.id == "build-p").expect("acha node_modules do projeto");
        assert_eq!(build.paths, vec![proj.path().join("node_modules")]);
        for s in &list {
            for p in &s.paths {
                assert!(is_safe_to_trash(p, &roots), "{} não deveria estar na lista", p.display());
            }
        }
        let h = home();
        for bad in [h.clone(), h.join(".claude"), h.join("Library"), PathBuf::from("/"), proj.path().to_path_buf()] {
            assert!(!is_safe_to_trash(&bad, &roots), "{} deveria ser recusado", bad.display());
        }
    }

    #[test]
    fn missing_paths_are_skipped() {
        assert!(spec("x", "x", "ia", "x", vec![PathBuf::from("/caminho/que/nao/existe")], None).is_none());
    }
}
