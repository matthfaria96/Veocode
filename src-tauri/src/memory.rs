//! Memória do projeto: resumos curtos das conversas concluídas, guardados pelo Veocode
//! (fora da pasta do projeto). Vão para o Claude no começo de cada conversa nova
//! (`--append-system-prompt`), assim ele não precisa reler conversas antigas inteiras.

use std::fs;
use std::path::{Path, PathBuf};

/// Tamanho máximo guardado (~2 mil tokens): passou disso, saem os resumos mais antigos.
pub const MAX_CHARS: usize = 8_000;

fn file(data: &Path, project: &str) -> PathBuf {
    data.join("memoria").join(format!("{project}.md"))
}

fn valid(project: &str) -> Result<(), String> {
    let ok = !project.is_empty() && project.len() <= 80 && project.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    ok.then_some(()).ok_or_else(|| "projeto inválido".to_string())
}

pub fn get(data: &Path, project: &str) -> Result<String, String> {
    valid(project)?;
    Ok(fs::read_to_string(file(data, project)).unwrap_or_default())
}

pub fn set(data: &Path, project: &str, text: &str) -> Result<String, String> {
    valid(project)?;
    let text = trim(text.trim());
    let f = file(data, project);
    if text.is_empty() {
        let _ = fs::remove_file(&f);
        return Ok(text);
    }
    fs::create_dir_all(f.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::write(&f, &text).map_err(|e| e.to_string())?;
    Ok(text)
}

/// Junta um resumo novo no fim (os mais antigos saem se passar do limite).
pub fn add(data: &Path, project: &str, entry: &str) -> Result<String, String> {
    let cur = get(data, project)?;
    let joined = if cur.trim().is_empty() { entry.trim().to_string() } else { format!("{}\n\n{}", cur.trim_end(), entry.trim()) };
    set(data, project, &joined)
}

/// Corta pelo começo, em blocos "## ", até caber.
fn trim(text: &str) -> String {
    let mut t = text.to_string();
    while t.chars().count() > MAX_CHARS {
        let start = t.char_indices().nth(1).map(|(i, _)| i).unwrap_or(t.len());
        match t[start..].find("\n## ") {
            Some(i) => t = t[start + i + 1..].to_string(),
            None => {
                let skip = t.chars().count() - MAX_CHARS;
                t = t.chars().skip(skip).collect();
                break;
            }
        }
    }
    t
}

/// Texto que vai para o Claude nas conversas novas (nada se a memória estiver vazia).
pub fn prompt(data: &Path, project: &str) -> Option<String> {
    let m = get(data, project).ok()?;
    (!m.trim().is_empty()).then(|| {
        format!(
            "Memória deste projeto, mantida pelo Veocode (resumos de conversas anteriores, do mais antigo ao mais novo). Use como contexto; confira no código antes de afirmar algo que pode ter mudado:\n\n{}",
            m.trim()
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_trims_and_builds_prompt() {
        let d = tempfile::tempdir().unwrap();
        assert!(prompt(d.path(), "p1").is_none());
        add(d.path(), "p1", "## 1\nprimeira").unwrap();
        add(d.path(), "p1", "## 2\nsegunda").unwrap();
        assert!(get(d.path(), "p1").unwrap().contains("primeira"));
        assert!(prompt(d.path(), "p1").unwrap().contains("segunda"));
        let big = format!("## 3\n{}", "x".repeat(MAX_CHARS));
        let t = add(d.path(), "p1", &big).unwrap();
        assert!(!t.contains("primeira"));
        assert!(t.chars().count() <= MAX_CHARS);
        assert!(get(d.path(), "../x").is_err());
        set(d.path(), "p1", " ").unwrap();
        assert!(prompt(d.path(), "p1").is_none());
    }
}
