//! Observa as pastas dos projetos e avisa a interface quando algo muda no disco
//! (seja você, seja uma IA rodando por fora). Os eventos são agrupados a cada 300 ms.

use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub type Watcher = Debouncer<RecommendedWatcher>;

/// Pastas barulhentas que não interessam na árvore (builds, dependências, git).
const SKIP: &[&str] = &[".git", "node_modules", "target", "dist", "build", ".next", ".svelte-kit", "__pycache__", ".venv", ".DS_Store"];

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub path: String,
    pub exists: bool,
    pub is_dir: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FsChange {
    project_id: String,
    changes: Vec<Change>,
}

/// Converte caminhos absolutos do evento em relativos, descartando o que não interessa.
pub fn relevant_changes(root: &Path, paths: impl IntoIterator<Item = PathBuf>) -> Vec<Change> {
    let mut out: Vec<Change> = paths
        .into_iter()
        .filter_map(|abs| {
            let rel = abs.strip_prefix(root).ok()?;
            let parts: Vec<String> = rel.components().map(|c| c.as_os_str().to_string_lossy().to_string()).collect();
            if parts.is_empty() || parts.iter().any(|p| SKIP.contains(&p.as_str())) {
                return None;
            }
            Some(Change { path: parts.join("/"), exists: abs.exists(), is_dir: abs.is_dir() })
        })
        .collect();
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out.dedup_by(|a, b| a.path == b.path);
    out
}

pub fn start(app: AppHandle, project_id: String, root: &Path) -> Result<Watcher, String> {
    // FSEvents (macOS) entrega caminhos já resolvidos; usamos a raiz canônica para comparar.
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let root_cb = root.clone();
    let mut debouncer = new_debouncer(Duration::from_millis(300), move |res: DebounceEventResult| {
        let Ok(events) = res else { return };
        let changes = relevant_changes(&root_cb, events.into_iter().map(|e| e.path));
        if !changes.is_empty() {
            let _ = app.emit("fs-change", FsChange { project_id: project_id.clone(), changes });
        }
    })
    .map_err(|e| e.to_string())?;
    debouncer.watcher().watch(&root, RecursiveMode::Recursive).map_err(|e| e.to_string())?;
    Ok(debouncer)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_noise_and_makes_paths_relative() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(root.join("src/a.rs"), "").unwrap();
        let got = relevant_changes(
            &root,
            vec![
                root.join("src/a.rs"),
                root.join("src/a.rs"),
                root.join("node_modules/x/index.js"),
                root.join(".git/index"),
                root.join("src/apagado.rs"),
                root.clone(),
            ],
        );
        assert_eq!(
            got,
            vec![
                Change { path: "src/a.rs".into(), exists: true, is_dir: false },
                Change { path: "src/apagado.rs".into(), exists: false, is_dir: false },
            ]
        );
    }
}
