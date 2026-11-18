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


// ---------------------------------------------------------------- mudanças feitas pela pessoa

/// Nome de arquivo ou pasta válido em qualquer sistema (sem barras, sem `..`, sem caracteres
/// que o Windows recusa).
pub fn check_name(name: &str) -> Result<&str, String> {
    let n = name.trim();
    if n.is_empty() {
        return Err("escreva um nome".into());
    }
    const BAD: &str = "/\\:*?\"<>|";
    if n == "." || n == ".." || n.chars().any(|c| BAD.contains(c) || c.is_control()) {
        return Err("o nome não pode ter / \\ : * ? \" < > |".into());
    }
    if n.len() > 255 {
        return Err("nome comprido demais".into());
    }
    Ok(n)
}

/// Caminho que ainda não existe: a pasta-mãe tem de estar dentro da raiz.
fn resolve_new(root: &Path, parent: &str, name: &str) -> Result<PathBuf, String> {
    let name = check_name(name)?;
    let root = root.canonicalize().map_err(|e| format!("raiz do projeto inacessível: {e}"))?;
    let dir = if parent.is_empty() { root.clone() } else { resolve_in_root(&root, parent)? };
    if !dir.is_dir() {
        return Err("a pasta de destino não existe mais".into());
    }
    let target = dir.join(name);
    if target.symlink_metadata().is_ok() {
        return Err(format!("já existe \"{name}\" nesta pasta"));
    }
    Ok(target)
}

/// Grava o texto num arquivo que já existe (o editor salvando). Escreve numa cópia ao lado e
/// troca no fim, para um erro no meio não deixar o arquivo pela metade.
pub fn write_file(root: &Path, rel: &str, text: &str) -> Result<u64, String> {
    let path = resolve_in_root(root, rel)?;
    if path.is_dir() {
        return Err("é uma pasta".into());
    }
    let perms = fs::metadata(&path).map_err(|e| e.to_string())?.permissions();
    if perms.readonly() {
        return Err("o arquivo está protegido contra escrita".into());
    }
    let tmp = path.with_file_name(format!(".{}.veocode-salvando", path.file_name().map(|n| n.to_string_lossy()).unwrap_or_default()));
    fs::write(&tmp, text.as_bytes()).map_err(|e| format!("não gravou: {e}"))?;
    let _ = fs::set_permissions(&tmp, perms);
    if let Err(e) = fs::rename(&tmp, &path) {
        let _ = fs::remove_file(&tmp);
        return Err(format!("não gravou: {e}"));
    }
    Ok(text.len() as u64)
}

/// Cria um arquivo vazio (ou uma pasta) dentro de `parent`. Devolve o caminho relativo novo.
pub fn create(root: &Path, parent: &str, name: &str, dir: bool) -> Result<String, String> {
    let target = resolve_new(root, parent, name)?;
    if dir {
        fs::create_dir(&target).map_err(|e| e.to_string())?;
    } else {
        fs::OpenOptions::new().write(true).create_new(true).open(&target).map_err(|e| e.to_string())?;
    }
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    Ok(to_rel(&root, &target))
}

/// Troca o nome de um arquivo ou pasta (na mesma pasta). Devolve o caminho relativo novo.
pub fn rename(root: &Path, rel: &str, new_name: &str) -> Result<String, String> {
    if rel.is_empty() {
        return Err("não dá para renomear a pasta do projeto por aqui".into());
    }
    let from = resolve_in_root(root, rel)?;
    let parent = rel.rsplit_once('/').map(|(p, _)| p).unwrap_or("");
    let to = resolve_new(root, parent, new_name)?;
    fs::rename(&from, &to).map_err(|e| e.to_string())?;
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    Ok(to_rel(&root, &to))
}

/// Caminho real de um item do projeto para mandar para a Lixeira (nunca a própria raiz).
pub fn trash_target(root: &Path, rel: &str) -> Result<PathBuf, String> {
    if rel.is_empty() {
        return Err("a pasta do projeto não vai para a Lixeira por aqui".into());
    }
    // não segue o link: apaga o link, não o que ele aponta
    let root_real = root.canonicalize().map_err(|e| e.to_string())?;
    let rel_path = Path::new(rel);
    if rel_path.is_absolute() || rel_path.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err("caminho fora do projeto".into());
    }
    let parent = rel.rsplit_once('/').map(|(p, _)| p).unwrap_or("");
    let dir = if parent.is_empty() { root_real.clone() } else { resolve_in_root(&root_real, parent)? };
    let target = dir.join(rel_path.file_name().ok_or("caminho inválido")?);
    target.symlink_metadata().map_err(|_| "não existe mais".to_string())?;
    Ok(target)
}

/// Todos os arquivos do projeto (para a busca), sem o que o .gitignore esconde. Até `max`.
pub fn all_files(root: &Path, max: usize) -> Result<Vec<String>, String> {
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    let walk = ignore::WalkBuilder::new(&root).hidden(false).git_ignore(true).git_exclude(true).parents(false).follow_links(false).filter_entry(|e| e.file_name() != ".git").build();
    for e in walk.flatten() {
        if e.file_type().is_some_and(|t| t.is_file()) {
            out.push(to_rel(&root, e.path()));
            if out.len() >= max {
                break;
            }
        }
    }
    out.sort_by_key(|p| p.to_lowercase());
    Ok(out)
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

    #[test]
    fn person_edits_stay_inside_the_project() {
        let d = project();
        let root = d.path();
        fs::write(root.join("a.txt"), "velho").unwrap();
        assert_eq!(write_file(root, "a.txt", "novo").unwrap(), 4);
        assert_eq!(fs::read_to_string(root.join("a.txt")).unwrap(), "novo");
        assert!(write_file(root, "../fora.txt", "x").is_err());

        assert_eq!(create(root, "", "pasta", true).unwrap(), "pasta");
        assert_eq!(create(root, "pasta", "b.md", false).unwrap(), "pasta/b.md");
        assert!(create(root, "pasta", "b.md", false).unwrap_err().contains("já existe"));
        assert!(create(root, "", "x/y", false).is_err());
        assert!(create(root, "", "..", true).is_err());
        assert!(create(root, "..", "fora", true).is_err());

        assert_eq!(rename(root, "pasta/b.md", "c.md").unwrap(), "pasta/c.md");
        assert!(root.join("pasta/c.md").exists());
        assert!(rename(root, "pasta/c.md", "../c.md").is_err());
        assert!(rename(root, "", "nova").is_err());

        assert_eq!(trash_target(root, "pasta/c.md").unwrap(), root.canonicalize().unwrap().join("pasta/c.md"));
        assert!(trash_target(root, "").is_err());
        assert!(trash_target(root, "../x").is_err());
        assert!(trash_target(root, "nada.txt").is_err());
    }

    #[test]
    fn search_lists_files_without_ignored_ones() {
        let d = project();
        let root = d.path();
        fs::write(root.join(".gitignore"), "segredo/\n").unwrap();
        fs::create_dir_all(root.join("segredo")).unwrap();
        fs::write(root.join("segredo/x.txt"), "").unwrap();
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("src/b.ts"), "").unwrap();
        let all = all_files(root, 100).unwrap();
        assert!(all.contains(&"src/b.ts".to_string()));
        assert!(!all.iter().any(|p| p.starts_with("segredo")));
    }
}
