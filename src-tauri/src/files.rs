//! Leitura de pastas e arquivos de um projeto.
//!
//! Regra de ouro: todo caminho vindo da interface é RELATIVO à raiz do projeto
//! e é resolvido aqui. Qualquer coisa que saia da raiz (`..`, link simbólico
//! apontando para fora, caminho absoluto) é recusada.

use ignore::gitignore::{Gitignore, GitignoreBuilder};
use serde::Serialize;
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

/// Arquivos maiores que isso não são abertos no editor.
pub const MAX_FILE_BYTES: u64 = 1024 * 1024;
/// Limite de itens listados por pasta (pastas gigantes não travam a interface).
pub const MAX_DIR_ENTRIES: usize = 2000;

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    /// Caminho relativo à raiz do projeto, sempre com `/`.
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    /// Coberto pelo .gitignore (mostrado apagado na árvore).
    pub ignored: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirListing {
    pub entries: Vec<FileEntry>,
    /// Quantos itens ficaram de fora por causa de MAX_DIR_ENTRIES.
    pub truncated: usize,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FileContent {
    Text { text: String, size: u64 },
    Binary { size: u64 },
    TooLarge { size: u64 },
}

/// Resolve `rel` dentro de `root`, garantindo que o resultado continua dentro da raiz.
pub fn resolve_in_root(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    if rel_path.is_absolute() {
        return Err("caminho absoluto não é permitido".into());
    }
    if rel_path.components().any(|c| matches!(c, Component::ParentDir | Component::Prefix(_) | Component::RootDir)) {
        return Err("caminho fora do projeto".into());
    }
    let root = root.canonicalize().map_err(|e| format!("raiz do projeto inacessível: {e}"))?;
    let joined = root.join(rel_path);
    // canonicalize resolve links simbólicos: se o link aponta para fora, a checagem pega.
    let real = joined.canonicalize().map_err(|e| format!("não encontrado: {e}"))?;
    if !real.starts_with(&root) {
        return Err("caminho fora do projeto".into());
    }
    Ok(real)
}

fn to_rel(root: &Path, p: &Path) -> String {
    p.strip_prefix(root)
        .unwrap_or(p)
        .components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

/// Matcher do .gitignore da raiz + .git/info/exclude.
pub fn gitignore_for(root: &Path) -> Gitignore {
    let mut b = GitignoreBuilder::new(root);
    b.add(root.join(".gitignore"));
    b.add(root.join(".git/info/exclude"));
    b.build().unwrap_or_else(|_| Gitignore::empty())
}

/// Lista UMA pasta (carregamento preguiçoso: a árvore abre pasta por pasta).
pub fn list_dir(root: &Path, rel: &str) -> Result<DirListing, String> {
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let dir = if rel.is_empty() { root.clone() } else { resolve_in_root(&root, rel)? };
    if !dir.is_dir() {
        return Err("não é uma pasta".into());
    }
    let gi = gitignore_for(&root);

    let mut entries: Vec<FileEntry> = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if name == ".git" || name == ".DS_Store" {
                return None;
            }
            let path = e.path();
            // Segue links para saber se é pasta; abrir/expandir ainda passa por resolve_in_root.
            let meta = fs::metadata(&path).or_else(|_| e.metadata()).ok()?;
            let is_dir = meta.is_dir();
            let ignored = gi.matched_path_or_any_parents(&path, is_dir).is_ignore();
            Some(FileEntry { name, path: to_rel(&root, &path), is_dir, size: if is_dir { 0 } else { meta.len() }, ignored })
        })
        .collect();

    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    let truncated = entries.len().saturating_sub(MAX_DIR_ENTRIES);
    entries.truncate(MAX_DIR_ENTRIES);
    Ok(DirListing { entries, truncated })
}

/// Lê um arquivo de texto do projeto (somente leitura).
pub fn read_file(root: &Path, rel: &str) -> Result<FileContent, String> {
    let path = resolve_in_root(root, rel)?;
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.is_dir() {
        return Err("é uma pasta".into());
    }
    let size = meta.len();
    if size > MAX_FILE_BYTES {
        return Ok(FileContent::TooLarge { size });
    }
    let mut buf = Vec::with_capacity(size as usize);
    fs::File::open(&path).and_then(|mut f| f.read_to_end(&mut buf)).map_err(|e| e.to_string())?;
    // Heurística simples (a mesma do git): byte nulo no começo = binário.
    if buf.iter().take(8000).any(|&b| b == 0) {
        return Ok(FileContent::Binary { size });
    }
    Ok(FileContent::Text { text: String::from_utf8_lossy(&buf).into_owned(), size })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn project() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        fs::create_dir_all(r.join("src/views")).unwrap();
        fs::create_dir_all(r.join("node_modules/pkg")).unwrap();
        fs::create_dir_all(r.join(".git")).unwrap();
        fs::write(r.join("src/main.rs"), "fn main() {}\n").unwrap();
        fs::write(r.join("README.md"), "# oi\n").unwrap();
        fs::write(r.join(".gitignore"), "node_modules/\n*.log\n").unwrap();
        fs::write(r.join("debug.log"), "x").unwrap();
        fs::write(r.join("image.bin"), [0u8, 1, 2, 3]).unwrap();
        dir
    }

    #[test]
    fn lists_dirs_first_hides_git_and_flags_ignored() {
        let p = project();
        let l = list_dir(p.path(), "").unwrap();
        let names: Vec<_> = l.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["node_modules", "src", ".gitignore", "debug.log", "image.bin", "README.md"]);
        let ignored: Vec<_> = l.entries.iter().filter(|e| e.ignored).map(|e| e.name.as_str()).collect();
        assert_eq!(ignored, vec!["node_modules", "debug.log"]);
    }

    #[test]
    fn lists_subdir_with_relative_paths() {
        let p = project();
        let l = list_dir(p.path(), "src").unwrap();
        assert_eq!(l.entries.iter().map(|e| e.path.as_str()).collect::<Vec<_>>(), vec!["src/views", "src/main.rs"]);
    }

    #[test]
    fn reads_text_and_detects_binary() {
        let p = project();
        assert_eq!(read_file(p.path(), "src/main.rs").unwrap(), FileContent::Text { text: "fn main() {}\n".into(), size: 13 });
        assert_eq!(read_file(p.path(), "image.bin").unwrap(), FileContent::Binary { size: 4 });
    }

    #[test]
    fn refuses_large_files() {
        let p = project();
        fs::write(p.path().join("big.txt"), vec![b'a'; (MAX_FILE_BYTES + 1) as usize]).unwrap();
        assert!(matches!(read_file(p.path(), "big.txt").unwrap(), FileContent::TooLarge { .. }));
    }

    #[test]
    fn refuses_paths_outside_the_project() {
        let p = project();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("secret.txt"), "senha").unwrap();
        assert!(read_file(p.path(), "../secret.txt").is_err());
        assert!(read_file(p.path(), outside.path().join("secret.txt").to_str().unwrap()).is_err());
        assert!(list_dir(p.path(), "src/../..").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_symlink_escaping_the_project() {
        let p = project();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("secret.txt"), "senha").unwrap();
        std::os::unix::fs::symlink(outside.path(), p.path().join("atalho")).unwrap();
        assert!(read_file(p.path(), "atalho/secret.txt").is_err());
        assert!(list_dir(p.path(), "atalho").is_err());
    }
}
