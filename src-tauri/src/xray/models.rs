//! IAs locais: modelos baixados para rodar no próprio computador (Ollama,
//! LM Studio, Hugging Face). Ocupam muitos GB e ficam soltos na máquina — não
//! dentro de um projeto. Aqui achamos cada um, o tamanho e, quando dá, qual
//! projeto pediu o download (lendo os comandos nos históricos do Claude Code).

use super::util::{dir_size, home};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModel {
    /// "Ollama" | "LM Studio" | "Hugging Face"
    pub tool: &'static str,
    pub name: String,
    pub size: u64,
    /// Pasta onde está (para mostrar no Finder).
    pub path: String,
    /// Comando para apagar, quando a ferramenta tem um.
    pub remove_cmd: Option<String>,
    /// Projeto (pasta) onde a IA pediu o download, se achamos.
    pub project: Option<String>,
    pub when: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelReport {
    pub models: Vec<LocalModel>,
    /// Ferramentas com pasta de modelos nesta máquina.
    pub tools: Vec<&'static str>,
}

fn sub_dirs(p: &Path) -> Vec<PathBuf> {
    fs::read_dir(p).map(|rd| rd.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.is_dir()).collect()).unwrap_or_default()
}

/// Ollama: manifests/<registro>/<dono>/<modelo>/<tag> (JSON com o tamanho de cada camada).
fn ollama(root: &Path) -> Vec<LocalModel> {
    let manifests = root.join("manifests");
    let mut out = Vec::new();
    for registry in sub_dirs(&manifests) {
        for owner in sub_dirs(&registry) {
            for model in sub_dirs(&owner) {
                let Ok(tags) = fs::read_dir(&model) else { continue };
                for tag in tags.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.is_file()) {
                    let Some(v) = fs::read_to_string(&tag).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()) else { continue };
                    let size: u64 = v.get("layers").and_then(Value::as_array).map(|l| l.iter().filter_map(|x| x.get("size")?.as_u64()).sum()).unwrap_or(0);
                    let model_name = model.file_name().unwrap_or_default().to_string_lossy();
                    let owner_name = owner.file_name().unwrap_or_default().to_string_lossy();
                    let tag_name = tag.file_name().unwrap_or_default().to_string_lossy();
                    let base = if owner_name == "library" { model_name.to_string() } else { format!("{owner_name}/{model_name}") };
                    let name = format!("{base}:{tag_name}");
                    out.push(LocalModel { tool: "Ollama", remove_cmd: Some(format!("ollama rm {name}")), name, size, path: root.display().to_string(), project: None, when: None });
                }
            }
        }
    }
    out
}

/// LM Studio: models/<dono>/<modelo>/
fn lmstudio(root: &Path) -> Vec<LocalModel> {
    sub_dirs(root)
        .into_iter()
        .flat_map(|owner| sub_dirs(&owner).into_iter().map(move |m| (owner.clone(), m)))
        .map(|(owner, m)| LocalModel {
            tool: "LM Studio",
            name: format!("{}/{}", owner.file_name().unwrap_or_default().to_string_lossy(), m.file_name().unwrap_or_default().to_string_lossy()),
            size: dir_size(&m),
            path: m.display().to_string(),
            remove_cmd: None,
            project: None,
            when: None,
        })
        .collect()
}

/// Hugging Face: hub/models--dono--nome/
fn huggingface(root: &Path) -> Vec<LocalModel> {
    sub_dirs(root)
        .into_iter()
        .filter_map(|p| {
            let f = p.file_name()?.to_string_lossy().to_string();
            let rest = f.strip_prefix("models--").or_else(|| f.strip_prefix("datasets--"))?;
            let name = rest.replacen("--", "/", 1);
            Some(LocalModel { tool: "Hugging Face", remove_cmd: Some(format!("hf cache delete {name}")), size: dir_size(&p), path: p.display().to_string(), name, project: None, when: None })
        })
        .collect()
}

/// (ferramenta, nome) → (projeto, quando), a partir dos comandos nos históricos.
fn who_asked(config_dirs: &[PathBuf]) -> HashMap<(&'static str, String), (String, String)> {
    let mut found: HashMap<(&'static str, String), (String, String)> = HashMap::new();
    for file in config_dirs.iter().flat_map(|d| super::installs::transcript_files(d)) {
        let Ok(fh) = fs::File::open(&file) else { continue };
        for line in BufReader::new(fh).lines().map_while(Result::ok) {
            if !(line.contains("ollama ") || line.contains(" download ") || line.contains("lms get")) || !line.contains("\"tool_use\"") {
                continue;
            }
            let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
            let cwd = v.get("cwd").and_then(Value::as_str).unwrap_or("").to_string();
            let ts = v.get("timestamp").and_then(Value::as_str).unwrap_or("").to_string();
            let Some(items) = v.pointer("/message/content").and_then(Value::as_array) else { continue };
            for cmd in items.iter().filter_map(|i| i.pointer("/input/command")?.as_str()) {
                if let Some((tool, model)) = crate::trail::model_of(cmd) {
                    let tool = match tool { "ollama" => "Ollama", "lmstudio" => "LM Studio", _ => "Hugging Face" };
                    let e = found.entry((tool, model)).or_insert_with(|| (cwd.clone(), ts.clone()));
                    if ts > e.1 {
                        *e = (cwd.clone(), ts.clone());
                    }
                }
            }
        }
    }
    found
}

/// Casa "llama3" (pedido) com "llama3:latest" (no disco), "org/x" com "org/x" etc.
fn same(tool: &str, asked: &str, have: &str) -> bool {
    let norm = |s: &str| {
        let s = s.to_lowercase();
        if tool == "Ollama" && !s.contains(':') { format!("{s}:latest") } else { s }
    };
    norm(asked) == norm(have) || have.to_lowercase().ends_with(&format!("/{}", asked.to_lowercase()))
}

pub fn report(config_dirs: &[PathBuf]) -> ModelReport {
    let h = home();
    let ollama_root = std::env::var("OLLAMA_MODELS").map(PathBuf::from).unwrap_or_else(|_| h.join(".ollama/models"));
    let lm_roots = [h.join(".lmstudio/models"), h.join(".cache/lm-studio/models")];
    let hf_root = std::env::var("HF_HOME").map(|p| PathBuf::from(p).join("hub")).unwrap_or_else(|_| h.join(".cache/huggingface/hub"));

    let mut tools = Vec::new();
    let mut models = Vec::new();
    if ollama_root.is_dir() {
        tools.push("Ollama");
        models.extend(ollama(&ollama_root));
    }
    if lm_roots.iter().any(|r| r.is_dir()) {
        tools.push("LM Studio");
        for r in lm_roots.iter().filter(|r| r.is_dir()) {
            models.extend(lmstudio(r));
        }
    }
    if hf_root.is_dir() {
        tools.push("Hugging Face");
        models.extend(huggingface(&hf_root));
    }

    if !models.is_empty() {
        let asked = who_asked(config_dirs);
        for m in &mut models {
            if let Some((_, (proj, ts))) = asked.iter().find(|((t, n), _)| *t == m.tool && same(t, n, &m.name)) {
                m.project = Some(proj.clone()).filter(|p| !p.is_empty());
                m.when = Some(ts.clone()).filter(|t| !t.is_empty());
            }
        }
    }
    models.sort_by(|a, b| b.size.cmp(&a.size));
    ModelReport { models, tools }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_model_folders() {
        let d = tempfile::tempdir().unwrap();
        let tag = d.path().join("ollama/manifests/registry.ollama.ai/library/llama3");
        fs::create_dir_all(&tag).unwrap();
        fs::write(tag.join("latest"), r#"{"layers":[{"size":100},{"size":23}]}"#).unwrap();
        let o = ollama(&d.path().join("ollama"));
        assert_eq!(o.len(), 1);
        assert_eq!(o[0].name, "llama3:latest");
        assert_eq!(o[0].size, 123);
        assert_eq!(o[0].remove_cmd.as_deref(), Some("ollama rm llama3:latest"));

        let hf = d.path().join("hub/models--meta-llama--Llama-3-8B");
        fs::create_dir_all(&hf).unwrap();
        fs::write(hf.join("w.bin"), [0u8; 10]).unwrap();
        let h = huggingface(&d.path().join("hub"));
        assert_eq!(h[0].name, "meta-llama/Llama-3-8B");
        assert_eq!(h[0].size, 10);

        assert!(same("Ollama", "llama3", "llama3:latest"));
        assert!(same("Hugging Face", "meta-llama/Llama-3-8B", "meta-llama/Llama-3-8B"));
        assert!(!same("Ollama", "mistral", "llama3:latest"));
    }
}
