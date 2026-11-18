//! Contas de IA. Cada projeto escolhe uma.
//!
//! - **Claude**: cada conta é uma pasta de configuração do Claude Code (`CLAUDE_CONFIG_DIR`).
//!   O login é feito pelo próprio Claude Code; o Veocode só lê o que ele grava.
//! - **DeepSeek / compatível com OpenAI**: chave de API guardada no chaveiro do sistema
//!   (Keychain no macOS, Gerenciador de Credenciais no Windows). Nunca vai para arquivo.
//! - **Ollama**: servidor local, sem chave.
//!
//! O cadastro fica em `accounts.json`. Remover uma conta nunca apaga a pasta dela.

pub mod claude;
pub mod remote;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Claude,
    Deepseek,
    Openai,
    Ollama,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub label: String,
    pub provider: Provider,
    pub color: String,
    #[serde(default)]
    pub model: Option<String>,
    /// Claude: pasta usada como CLAUDE_CONFIG_DIR. `None` = a padrão do Claude Code.
    #[serde(default)]
    pub config_dir: Option<String>,
    #[serde(default)]
    pub base_url: Option<String>,
    /// Final da chave ("…a1b2") só para reconhecer na tela. A chave fica no chaveiro.
    #[serde(default)]
    pub key_hint: Option<String>,
    #[serde(default)]
    pub created_at: u64,
}

/// O que a interface recebe: a conta mais a pasta já resolvida (para o Claude).
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AccountInfo {
    #[serde(flatten)]
    pub account: Account,
    pub dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewAccount {
    pub provider: Provider,
    pub label: String,
    pub color: String,
    pub model: Option<String>,
    pub base_url: Option<String>,
    /// Claude: pasta existente para reaproveitar. Sem ela, o Veocode cria uma nova.
    pub config_dir: Option<String>,
}

pub const DEEPSEEK_URL: &str = "https://api.deepseek.com";
pub const OLLAMA_URL: &str = "http://127.0.0.1:11434";

pub struct AccountStore {
    file: PathBuf,
    pub accounts: Vec<Account>,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

impl AccountStore {
    /// Carrega o cadastro. Na primeira vez, descobre o que já existe na máquina
    /// (o Claude Code instalado e o Ollama) em vez de começar vazio.
    pub fn load(config_dir: &Path) -> Self {
        let file = config_dir.join("accounts.json");
        let accounts = match fs::read_to_string(&file) {
            Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
            Err(_) => discover(),
        };
        Self { file, accounts }
    }

    pub fn save(&self) -> Result<(), String> {
        if let Some(dir) = self.file.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(&self.accounts).map_err(|e| e.to_string())?;
        let tmp = self.file.with_extension("json.tmp");
        fs::write(&tmp, json).map_err(|e| e.to_string())?;
        fs::rename(&tmp, &self.file).map_err(|e| e.to_string())
    }

    pub fn get(&self, id: &str) -> Option<&Account> {
        self.accounts.iter().find(|a| a.id == id)
    }

    /// Conta usada por projetos novos: a primeira do Claude, senão a primeira que houver.
    pub fn default_id(&self) -> String {
        self.accounts
            .iter()
            .find(|a| a.provider == Provider::Claude)
            .or(self.accounts.first())
            .map(|a| a.id.clone())
            .unwrap_or_default()
    }

    /// `claude_root`: onde criar pastas de contas novas do Claude.
    pub fn add(&mut self, n: NewAccount, claude_root: &Path) -> Result<Account, String> {
        let label = n.label.trim();
        if label.is_empty() {
            return Err("dê um nome para a conta".into());
        }
        let mut id = format!("a{:x}", now_ms());
        while self.get(&id).is_some() {
            id.push('x');
        }
        let mut acc = Account {
            id: id.clone(),
            label: label.into(),
            provider: n.provider,
            color: n.color,
            model: n.model.filter(|m| !m.trim().is_empty()),
            config_dir: None,
            base_url: None,
            key_hint: None,
            created_at: now_ms(),
        };
        match n.provider {
            Provider::Claude => {
                let dir = match n.config_dir.filter(|d| !d.trim().is_empty()) {
                    Some(d) => {
                        let p = PathBuf::from(d);
                        if !p.is_dir() {
                            return Err("essa pasta não existe".into());
                        }
                        p.canonicalize().map_err(|e| e.to_string())?
                    }
                    None => {
                        let p = claude_root.join(&id);
                        fs::create_dir_all(&p).map_err(|e| format!("não consegui criar a pasta da conta: {e}"))?;
                        p.canonicalize().map_err(|e| e.to_string())?
                    }
                };
                let dir_s = dir.to_string_lossy().to_string();
                let canon = |p: PathBuf| p.canonicalize().unwrap_or(p);
                if self.accounts.iter().any(|a| a.provider == Provider::Claude && canon(claude::config_dir(a)) == dir) {
                    return Err("já existe uma conta usando essa pasta".into());
                }
                acc.config_dir = Some(dir_s);
            }
            Provider::Deepseek => acc.base_url = Some(DEEPSEEK_URL.into()),
            Provider::Ollama => acc.base_url = Some(n.base_url.filter(|u| !u.trim().is_empty()).unwrap_or_else(|| OLLAMA_URL.into())),
            Provider::Openai => {
                let url = n.base_url.unwrap_or_default().trim().trim_end_matches('/').to_string();
                remote::check_base_url(&url)?;
                acc.base_url = Some(url);
            }
        }
        if let Some(u) = &acc.base_url {
            if n.provider == Provider::Ollama {
                remote::check_base_url(u)?;
            }
        }
        self.accounts.push(acc.clone());
        Ok(acc)
    }

    pub fn update(&mut self, id: &str, label: Option<String>, color: Option<String>, model: Option<String>) -> Result<Account, String> {
        let a = self.accounts.iter_mut().find(|a| a.id == id).ok_or("conta não encontrada")?;
        if let Some(l) = label.map(|l| l.trim().to_string()).filter(|l| !l.is_empty()) {
            a.label = l;
        }
        if let Some(c) = color {
            a.color = c;
        }
        if let Some(m) = model {
            a.model = Some(m).filter(|m| !m.trim().is_empty());
        }
        Ok(a.clone())
    }

    pub fn set_key_hint(&mut self, id: &str, hint: Option<String>) -> Result<Account, String> {
        let a = self.accounts.iter_mut().find(|a| a.id == id).ok_or("conta não encontrada")?;
        a.key_hint = hint;
        Ok(a.clone())
    }

    pub fn remove(&mut self, id: &str) -> Option<Account> {
        let i = self.accounts.iter().position(|a| a.id == id)?;
        Some(self.accounts.remove(i))
    }
}

pub fn info(a: &Account) -> AccountInfo {
    let dir = (a.provider == Provider::Claude).then(|| claude::config_dir(a).to_string_lossy().to_string());
    AccountInfo { account: a.clone(), dir }
}

/// Primeira abertura: cadastra o que já está instalado.
fn discover() -> Vec<Account> {
    let mut v = Vec::new();
    let default_claude = claude::default_config_dir();
    if default_claude.is_dir() || claude::default_json_path().is_file() {
        v.push(Account {
            id: "claude-principal".into(),
            label: "Claude · principal".into(),
            provider: Provider::Claude,
            color: "#e8915b".into(),
            model: None,
            config_dir: None,
            base_url: None,
            key_hint: None,
            created_at: now_ms(),
        });
    }
    let home = crate::xray::util::home();
    if crate::xray::util::which("ollama").is_some() || home.join(".ollama").is_dir() {
        v.push(Account {
            id: "ollama".into(),
            label: "Local · Ollama".into(),
            provider: Provider::Ollama,
            color: "#34d399".into(),
            model: None,
            config_dir: None,
            base_url: Some(OLLAMA_URL.into()),
            key_hint: None,
            created_at: now_ms(),
        });
    }
    v
}

// ---------------------------------------------------------------- status

#[derive(Debug, Serialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum State {
    /// Pronta para usar.
    Pronta,
    /// Claude sem login nesta pasta.
    SemLogin,
    /// API sem chave salva.
    SemChave,
    /// Servidor não respondeu (Ollama fechado, sem internet…).
    Offline,
    /// Respondeu com erro (chave recusada, etc.).
    Erro,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AccountStatus {
    pub id: String,
    pub state: State,
    /// "Pro", "Max", "Pré-pago", "Local"…
    pub plan: Option<String>,
    /// Quem está logado (e-mail) ou de onde vem (endereço do servidor).
    pub who: Option<String>,
    pub detail: Option<String>,
    pub models: Vec<String>,
    pub balance: Option<String>,
    /// Trabalhando agora (Claude: histórico mexido há pouco; Ollama: modelo carregado).
    pub active: bool,
    pub usage: Option<claude::Usage>,
}

impl AccountStatus {
    pub fn new(id: &str, state: State) -> Self {
        Self { id: id.into(), state, plan: None, who: None, detail: None, models: vec![], balance: None, active: false, usage: None }
    }
}

pub fn status(a: &Account, cache: &mut claude::UsageCache) -> AccountStatus {
    match a.provider {
        Provider::Claude => claude::status(a, cache),
        Provider::Ollama => remote::ollama_status(a),
        Provider::Deepseek | Provider::Openai => remote::api_status(a),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store(dir: &Path) -> AccountStore {
        AccountStore { file: dir.join("accounts.json"), accounts: vec![] }
    }

    #[test]
    fn add_claude_creates_own_folder_and_rejects_duplicates() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = store(tmp.path());
        let n = || NewAccount { provider: Provider::Claude, label: "Trabalho".into(), color: "#fff".into(), model: None, base_url: None, config_dir: None };
        let a = s.add(n(), &tmp.path().join("claude")).unwrap();
        let dir = PathBuf::from(a.config_dir.clone().unwrap());
        assert!(dir.is_dir() && dir.starts_with(tmp.path().canonicalize().unwrap()));
        // reaproveitar a mesma pasta duas vezes não pode
        let again = NewAccount { config_dir: Some(dir.to_string_lossy().into()), ..n() };
        assert!(s.add(again, &tmp.path().join("claude")).is_err());
        s.save().unwrap();
        assert_eq!(AccountStore::load(tmp.path()).accounts.len(), 1);
    }

    #[test]
    fn openai_compatible_needs_https_unless_local() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = store(tmp.path());
        let n = |u: &str| NewAccount { provider: Provider::Openai, label: "x".into(), color: "#fff".into(), model: None, base_url: Some(u.into()), config_dir: None };
        assert!(s.add(n("http://example.com/v1"), tmp.path()).is_err());
        assert!(s.add(n("https://api.example.com/v1/"), tmp.path()).is_ok());
        assert!(s.add(n("http://localhost:8080/v1"), tmp.path()).is_ok());
        assert_eq!(s.accounts[0].base_url.as_deref(), Some("https://api.example.com/v1"));
    }

    #[test]
    fn default_prefers_claude() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = store(tmp.path());
        s.add(NewAccount { provider: Provider::Ollama, label: "o".into(), color: "#fff".into(), model: None, base_url: None, config_dir: None }, tmp.path()).unwrap();
        let c = s.add(NewAccount { provider: Provider::Claude, label: "c".into(), color: "#fff".into(), model: None, base_url: None, config_dir: None }, tmp.path()).unwrap();
        assert_eq!(s.default_id(), c.id);
    }
}
