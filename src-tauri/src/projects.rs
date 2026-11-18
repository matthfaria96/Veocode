//! Cadastro de projetos: quais pastas o Veocode conhece, qual conta de IA cada uma usa
//! e o nível de acesso. Fica salvo em `projects.json` na pasta de configuração do app.
//! Remover um projeto daqui NUNCA apaga a pasta — só tira da lista.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub account_id: String,
    /// 0 = leitura, 1 = sugerir, 2 = editar, 3 = total
    pub access: u8,
    pub added_at: u64,
    /// ajustes por cima do nível (ex.: "push" → permitido)
    #[serde(default)]
    pub overrides: std::collections::BTreeMap<String, crate::access::Rule>,
    /// o que o Veocode gravou no settings.local.json do projeto (None = nunca aplicou)
    #[serde(default)]
    pub applied: Option<crate::access::Applied>,
}

/// Informações que mudam com o tempo e são lidas do disco a cada listagem.
#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    #[serde(flatten)]
    pub project: Project,
    pub stack: String,
    pub branch: Option<String>,
    pub exists: bool,
}

pub struct ProjectStore {
    file: PathBuf,
    pub projects: Vec<Project>,
}

impl ProjectStore {
    pub fn load(config_dir: &Path) -> Self {
        let file = config_dir.join("projects.json");
        let projects = fs::read_to_string(&file).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        Self { file, projects }
    }

    pub fn save(&self) -> Result<(), String> {
        if let Some(dir) = self.file.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(&self.projects).map_err(|e| e.to_string())?;
        // grava num temporário e renomeia: nunca deixa o arquivo pela metade
        let tmp = self.file.with_extension("json.tmp");
        fs::write(&tmp, json).map_err(|e| e.to_string())?;
        fs::rename(&tmp, &self.file).map_err(|e| e.to_string())
    }

    pub fn get(&self, id: &str) -> Option<&Project> {
        self.projects.iter().find(|p| p.id == id)
    }

    pub fn get_mut(&mut self, id: &str) -> Option<&mut Project> {
        self.projects.iter_mut().find(|p| p.id == id)
    }

    /// Adiciona uma pasta. Se ela já estiver na lista, devolve a existente.
    pub fn add(&mut self, path: &Path, default_account: &str) -> Result<Project, String> {
        let canon = path.canonicalize().map_err(|e| format!("pasta inacessível: {e}"))?;
        if !canon.is_dir() {
            return Err("não é uma pasta".into());
        }
        let path_str = canon.to_string_lossy().to_string();
        if let Some(p) = self.projects.iter().find(|p| p.path == path_str) {
            return Ok(p.clone());
        }
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
        let project = Project {
            id: format!("p{now:x}"),
            name: canon.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| path_str.clone()),
            path: path_str,
            account_id: default_account.into(),
            access: 0, // começa sempre no mais seguro
            added_at: now,
            overrides: Default::default(),
            applied: None,
        };
        self.projects.push(project.clone());
        Ok(project)
    }

    pub fn remove(&mut self, id: &str) -> bool {
        let before = self.projects.len();
        self.projects.retain(|p| p.id != id);
        before != self.projects.len()
    }

    /// Atualiza só o que a interface pode mudar: conta e nível de acesso.
    pub fn update(&mut self, id: &str, account_id: Option<String>, access: Option<u8>) -> Result<Project, String> {
        let p = self.projects.iter_mut().find(|p| p.id == id).ok_or("projeto não encontrado")?;
        if let Some(a) = account_id {
            p.account_id = a;
        }
        if let Some(l) = access {
            p.access = l.min(3);
            p.overrides.clear(); // trocar de nível recomeça os ajustes
        }
        Ok(p.clone())
    }
}

pub fn info(p: &Project) -> ProjectInfo {
    let root = Path::new(&p.path);
    ProjectInfo { project: p.clone(), stack: detect_stack(root), branch: detect_branch(root), exists: root.is_dir() }
}

/// Adivinha a stack pelos arquivos da raiz.
pub fn detect_stack(root: &Path) -> String {
    let has = |f: &str| root.join(f).exists();
    let mut parts: Vec<&str> = Vec::new();
    if has("Cargo.toml") || has("src-tauri/Cargo.toml") {
        parts.push("Rust");
    }
    if has("src-tauri") {
        parts.push("Tauri");
    }
    if has("package.json") {
        parts.push(if has("tsconfig.json") { "TypeScript" } else { "Node" });
    }
    if has("pyproject.toml") || has("requirements.txt") {
        parts.push("Python");
    }
    if has("go.mod") {
        parts.push("Go");
    }
    if has("Package.swift") || has("Podfile") {
        parts.push("Swift");
    }
    if has("pubspec.yaml") {
        parts.push("Flutter");
    }
    if has("Dockerfile") || has("docker-compose.yml") || has("compose.yaml") {
        parts.push("Docker");
    }
    if parts.is_empty() { "pasta".into() } else { parts.join(" · ") }
}

/// Lê o branch atual direto de .git/HEAD (sem precisar do git instalado).
pub fn detect_branch(root: &Path) -> Option<String> {
    let head = fs::read_to_string(root.join(".git/HEAD")).ok()?;
    let head = head.trim();
    Some(match head.strip_prefix("ref: refs/heads/") {
        Some(b) => b.to_string(),
        None => head.chars().take(7).collect(), // HEAD destacado: mostra o hash curto
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_save_reload_update_remove() {
        let cfg = tempfile::tempdir().unwrap();
        let proj = tempfile::tempdir().unwrap();
        fs::write(proj.path().join("Cargo.toml"), "").unwrap();
        fs::write(proj.path().join("package.json"), "{}").unwrap();
        fs::create_dir_all(proj.path().join(".git")).unwrap();
        fs::write(proj.path().join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();

        let mut store = ProjectStore::load(cfg.path());
        let p = store.add(proj.path(), "claude-pessoal").unwrap();
        assert_eq!(p.access, 0);
        // adicionar de novo não duplica
        assert_eq!(store.add(proj.path(), "x").unwrap().id, p.id);
        store.update(&p.id, Some("deepseek".into()), Some(9)).unwrap();
        store.save().unwrap();

        let store = ProjectStore::load(cfg.path());
        assert_eq!(store.projects.len(), 1);
        assert_eq!(store.projects[0].account_id, "deepseek");
        assert_eq!(store.projects[0].access, 3);

        let i = info(&store.projects[0]);
        assert_eq!(i.stack, "Rust · Node");
        assert_eq!(i.branch.as_deref(), Some("main"));

        let mut store = store;
        assert!(store.remove(&p.id));
        assert!(proj.path().exists(), "remover da lista não pode apagar a pasta");
    }
}
