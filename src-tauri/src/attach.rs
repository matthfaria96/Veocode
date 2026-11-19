//! Anexos do chat: imagens coladas, arquivos escolhidos no Finder ou arrastados.
//!
//! - Imagem colada vira um arquivo em `<dados>/anexos/` (some sozinho depois de 7 dias).
//! - Para o Claude: imagens e PDFs vão como blocos de verdade (ele vê a imagem / lê o PDF);
//!   textos pequenos vão dentro da mensagem; o resto vai pelo caminho, para ele abrir.
//! - Para as contas por API: textos dentro da mensagem; o resto só pelo nome.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::Serialize;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// Maior anexo aceito.
pub const MAX_FILE: u64 = 30 * 1024 * 1024;
/// Imagem maior que isso vai pelo caminho (o limite da API é 5 MB já em base64).
const MAX_IMAGE: u64 = 3_700_000;
const MAX_PDF: u64 = 25 * 1024 * 1024;
/// Texto maior que isso vai pelo caminho, não dentro da mensagem.
const MAX_TEXT: u64 = 200_000;
const MAX_THUMB: u64 = 6 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Staged {
    pub path: String,
    pub name: String,
    /// "image" | "pdf" | "text" | "other"
    pub kind: &'static str,
    pub bytes: u64,
    /// miniatura (data URL) para imagens
    pub thumb: Option<String>,
}

fn ext(p: &Path) -> String {
    p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
}

fn image_mime(p: &Path) -> Option<&'static str> {
    match ext(p).as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

const TEXT_EXT: &[&str] = &[
    "txt", "md", "markdown", "json", "jsonl", "csv", "tsv", "yaml", "yml", "toml", "xml", "html", "htm", "css", "scss", "js", "jsx", "ts", "tsx", "mjs", "cjs", "py", "rs", "go", "java", "kt",
    "swift", "c", "h", "cpp", "hpp", "cs", "rb", "php", "sh", "zsh", "bash", "sql", "lua", "gd", "ini", "cfg", "conf", "env", "log", "svg", "vue", "svelte", "dart", "r", "ex", "exs",
];

pub fn kind_of(p: &Path) -> &'static str {
    let e = ext(p);
    if image_mime(p).is_some() {
        "image"
    } else if e == "pdf" {
        "pdf"
    } else if TEXT_EXT.contains(&e.as_str()) || (e.is_empty() && looks_text(p)) {
        "text"
    } else {
        "other"
    }
}

fn looks_text(p: &Path) -> bool {
    let Ok(bytes) = fs::read(p).map(|b| b.into_iter().take(4096).collect::<Vec<u8>>()) else { return false };
    !bytes.contains(&0) && std::str::from_utf8(&bytes).is_ok()
}

/// Tipo de imagem que a tela sabe mostrar (inclui os que não vão para o Claude como bloco).
pub fn preview_mime(p: &Path) -> Option<&'static str> {
    image_mime(p).or(match ext(p).as_str() {
        "svg" => Some("image/svg+xml"),
        "bmp" => Some("image/bmp"),
        "ico" => Some("image/x-icon"),
        "avif" => Some("image/avif"),
        _ => None,
    })
}

/// Maior imagem que a prévia carrega (passa disso, abre no programa padrão).
pub const MAX_PREVIEW: u64 = 25 * 1024 * 1024;

/// Imagem como data URL, para mostrar na tela.
pub fn preview(p: &Path) -> Result<String, String> {
    let mime = preview_mime(p).ok_or("não é uma imagem que dá para mostrar")?;
    let m = fs::metadata(p).map_err(|_| "não achei a imagem".to_string())?;
    if m.len() > MAX_PREVIEW {
        return Err("imagem grande demais para a prévia (mais de 25 MB)".into());
    }
    let b = fs::read(p).map_err(|e| e.to_string())?;
    Ok(format!("data:{mime};base64,{}", B64.encode(b)))
}

/// Confere um anexo escolhido (caminho absoluto de um arquivo que existe).
pub fn info(path: &str) -> Result<Staged, String> {
    let p = PathBuf::from(path);
    if !p.is_absolute() {
        return Err(format!("caminho inválido: {path}"));
    }
    let m = fs::metadata(&p).map_err(|_| format!("não achei {path}"))?;
    if !m.is_file() {
        return Err(format!("{} é uma pasta: escolha arquivos", p.display()));
    }
    if m.len() > MAX_FILE {
        return Err(format!("{} passa de 30 MB", p.file_name().map(|n| n.to_string_lossy()).unwrap_or_default()));
    }
    let kind = kind_of(&p);
    let thumb = (kind == "image" && m.len() <= MAX_THUMB)
        .then(|| fs::read(&p).ok().map(|b| format!("data:{};base64,{}", image_mime(&p).unwrap_or("image/png"), B64.encode(b))))
        .flatten();
    Ok(Staged { path: p.to_string_lossy().into(), name: p.file_name().map(|n| n.to_string_lossy().into()).unwrap_or_default(), kind, bytes: m.len(), thumb })
}

/// Guarda uma imagem/arquivo colado e devolve como anexo.
pub fn stage(dir: &Path, name: &str, data_b64: &str) -> Result<Staged, String> {
    let bytes = B64.decode(data_b64.split(',').next_back().unwrap_or("")).map_err(|_| "o arquivo colado veio estragado".to_string())?;
    if bytes.len() as u64 > MAX_FILE {
        return Err("o arquivo colado passa de 30 MB".into());
    }
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    cleanup(dir);
    // nome seguro: só letras, números, ponto, hífen e sublinhado
    let clean: String = name.chars().map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') { c } else { '-' }).collect();
    let mut clean = clean.trim_matches(|c| c == '.' || c == '-').chars().take(60).collect::<String>();
    while clean.contains("--") || clean.contains("-.") {
        clean = clean.replace("--", "-").replace("-.", ".");
    }
    let clean = if clean.is_empty() { "anexo.png".to_string() } else { clean };
    let stamp = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let path = dir.join(format!("{stamp}-{clean}"));
    fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    info(&path.to_string_lossy())
}

/// Tira anexos colados com mais de 7 dias.
fn cleanup(dir: &Path) {
    let cutoff = SystemTime::now() - Duration::from_secs(7 * 86_400);
    if let Ok(rd) = fs::read_dir(dir) {
        for e in rd.flatten() {
            if e.metadata().and_then(|m| m.modified()).is_ok_and(|t| t < cutoff) {
                let _ = fs::remove_file(e.path());
            }
        }
    }
}

/// Confere a lista que veio da interface.
pub fn checked(files: Option<Vec<String>>) -> Result<Vec<PathBuf>, String> {
    let list = files.unwrap_or_default();
    if list.len() > 20 {
        return Err("no máximo 20 anexos por mensagem".into());
    }
    list.iter().map(|f| info(f).map(|s| PathBuf::from(s.path))).collect()
}

fn read_text(p: &Path) -> Option<String> {
    let m = fs::metadata(p).ok()?;
    (m.len() <= MAX_TEXT).then(|| fs::read_to_string(p).ok()).flatten()
}

fn name(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().into()).unwrap_or_default()
}

/// Conteúdo da mensagem para o Claude Code (stream-json): texto + blocos de imagem e PDF.
pub fn claude_content(text: &str, files: &[PathBuf]) -> Value {
    if files.is_empty() {
        return Value::String(text.to_string());
    }
    let mut notes = vec![];
    let mut blocks = vec![];
    for p in files {
        let size = fs::metadata(p).map(|m| m.len()).unwrap_or(0);
        match kind_of(p) {
            "image" if size <= MAX_IMAGE => match fs::read(p) {
                Ok(b) => {
                    blocks.push(json!({"type":"image","source":{"type":"base64","media_type":image_mime(p).unwrap_or("image/png"),"data":B64.encode(b)}}));
                    notes.push(format!("- imagem anexada: {}", name(p)));
                }
                Err(_) => notes.push(format!("- imagem (não deu para ler): {}", p.display())),
            },
            "pdf" if size <= MAX_PDF => match fs::read(p) {
                Ok(b) => {
                    blocks.push(json!({"type":"document","source":{"type":"base64","media_type":"application/pdf","data":B64.encode(b)},"title":name(p)}));
                    notes.push(format!("- PDF anexado: {}", name(p)));
                }
                Err(_) => notes.push(format!("- PDF (não deu para ler): {}", p.display())),
            },
            "text" => match read_text(p) {
                Some(body) => notes.push(format!("- arquivo anexado `{}`:\n```\n{}\n```", p.display(), body)),
                None => notes.push(format!("- arquivo anexado (grande, abra pelo caminho): {}", p.display())),
            },
            _ => notes.push(format!("- arquivo anexado (abra pelo caminho): {}", p.display())),
        }
    }
    let full = format!("{text}\n\nAnexos:\n{}", notes.join("\n"));
    let mut content = vec![json!({"type":"text","text":full})];
    content.extend(blocks);
    Value::Array(content)
}

/// Texto da mensagem para as contas por API (sem visão): textos dentro, o resto pelo nome.
pub fn api_text(text: &str, files: &[PathBuf]) -> String {
    if files.is_empty() {
        return text.to_string();
    }
    let notes: Vec<String> = files
        .iter()
        .map(|p| match (kind_of(p), read_text(p)) {
            ("text", Some(body)) => format!("Arquivo `{}`:\n```\n{}\n```", name(p), body),
            ("image", _) => format!("(imagem anexada: {}. Este modelo não vê imagens; descreva o que importa nela.)", name(p)),
            _ => format!("(arquivo anexado: {} — este modelo não abre este tipo de arquivo)", p.display()),
        })
        .collect();
    format!("{text}\n\n{}", notes.join("\n\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stages_and_builds_blocks() {
        let d = tempfile::tempdir().unwrap();
        // PNG de 1x1
        let png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
        let s = stage(d.path(), "colada da tela!.png", &format!("data:image/png;base64,{png}")).unwrap();
        assert_eq!(s.kind, "image");
        assert!(s.name.ends_with("colada-da-tela.png"));
        assert!(s.thumb.unwrap().starts_with("data:image/png;base64,"));
        let txt = d.path().join("notas.md");
        fs::write(&txt, "# oi").unwrap();
        let c = claude_content("olha isso", &[PathBuf::from(&s.path), txt.clone()]);
        let arr = c.as_array().unwrap();
        assert_eq!(arr.len(), 2);
        assert!(arr[0]["text"].as_str().unwrap().contains("# oi"));
        assert_eq!(arr[1]["type"], "image");
        assert!(api_text("oi", &[txt]).contains("# oi"));
    }

    #[test]
    fn refuses_bad_paths() {
        assert!(info("relativo.png").is_err());
        assert!(info("/caminho/que/nao/existe.png").is_err());
        let d = tempfile::tempdir().unwrap();
        assert!(info(&d.path().to_string_lossy()).is_err());
        assert!(checked(Some(vec!["x".into(); 21])).is_err());
    }

    #[test]
    fn previews_images_only() {
        let d = tempfile::tempdir().unwrap();
        let svg = d.path().join("logo.svg");
        fs::write(&svg, "<svg xmlns='http://www.w3.org/2000/svg'/>").unwrap();
        assert!(preview(&svg).unwrap().starts_with("data:image/svg+xml;base64,"));
        let txt = d.path().join("a.txt");
        fs::write(&txt, "oi").unwrap();
        assert!(preview(&txt).is_err());
    }

    #[test]
    fn plain_text_stays_a_string() {
        assert_eq!(claude_content("oi", &[]), Value::String("oi".into()));
    }
}
