//! Cofre: chaves de API, logins de sites e outros segredos que os projetos precisam.
//!
//! O segredo vai para o chaveiro do sistema; aqui (vault.json) fica só a descrição: nome,
//! tipo, variável de ambiente e em quais projetos vale. A interface nunca recebe o segredo
//! de volta, só o final dele ("…a1b2"), a não ser que a pessoa peça para copiar.
//! Quando o Veocode abre o Claude ou um terminal num projeto, as entradas que valem ali
//! entram como variáveis de ambiente, e o Claude recebe só os NOMES, para não pedir de novo.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

const SERVICE: &str = "com.veocode.app";
static FILE: OnceLock<PathBuf> = OnceLock::new();
static LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub name: String,
    /// "chave" (de API), "login" (usuário + senha de um site) ou "outro"
    pub kind: String,
    /// variável de ambiente (ex.: OPENAI_API_KEY). Num login vira prefixo: X_USER e X_PASSWORD.
    #[serde(default)]
    pub env: Option<String>,
    /// login: usuário (não é segredo)
    #[serde(default)]
    pub user: Option<String>,
    /// login: endereço do site
    #[serde(default)]
    pub site: Option<String>,
    /// vazio = vale em todos os projetos (e no Chat livre)
    #[serde(default)]
    pub projects: Vec<String>,
    #[serde(default)]
    pub hint: String,
    #[serde(default)]
    pub added_at: u64,
}

pub fn init(config_dir: &std::path::Path) {
    let _ = FILE.set(config_dir.join("vault.json"));
}

fn entry(id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, &format!("vault:{id}")).map_err(|e| e.to_string())
}

pub fn list() -> Vec<Item> {
    let Some(f) = FILE.get() else { return vec![] };
    std::fs::read_to_string(f).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn write(items: &[Item]) -> Result<(), String> {
    let f = FILE.get().ok_or(crate::i18n::tr("cofre não iniciado", "vault not started"))?;
    let tmp = f.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(items).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, f).map_err(|e| e.to_string())
}

fn hint(secret: &str) -> String {
    let tail: String = secret.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
    if secret.chars().count() <= 6 { "••••".into() } else { format!("…{tail}") }
}

/// Nome de variável aceitável: letras maiúsculas, números e _ (começando por letra).
fn clean_env(v: Option<String>) -> Result<Option<String>, String> {
    let Some(v) = v.map(|s| s.trim().to_uppercase()).filter(|s| !s.is_empty()) else { return Ok(None) };
    let ok = v.len() <= 64 && v.chars().next().is_some_and(|c| c.is_ascii_alphabetic()) && v.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    if !ok {
        return Err(crate::i18n::tr("o nome da variável usa só letras, números e _ (ex.: OPENAI_API_KEY)", "the variable name uses only letters, numbers and _ (e.g. OPENAI_API_KEY)").into());
    }
    if matches!(v.as_str(), "PATH" | "HOME" | "SHELL" | "USER" | "TERM" | "CLAUDE_CONFIG_DIR") {
        return Err(crate::trf!("{v} é usada pelo sistema; escolha outro nome", "{v} is used by the system; choose another name"));
    }
    Ok(Some(v))
}

/// Cria ou atualiza. `secret` None mantém o segredo guardado (só muda a descrição).
pub fn save(mut item: Item, secret: Option<String>) -> Result<Item, String> {
    let _g = LOCK.lock().map_err(|_| "cofre ocupado")?;
    item.name = item.name.trim().to_string();
    if item.name.is_empty() {
        return Err(crate::i18n::tr("dê um nome (ex.: OpenAI pessoal)", "give it a name (e.g. Personal OpenAI)").into());
    }
    if !matches!(item.kind.as_str(), "chave" | "login" | "outro") {
        return Err("tipo desconhecido".into());
    }
    item.env = clean_env(item.env)?;
    let mut items = list();
    let existing = items.iter().position(|x| x.id == item.id && !item.id.is_empty());
    if let Some(env) = &item.env {
        if items.iter().any(|x| x.id != item.id && x.env.as_deref() == Some(env) && overlaps(&x.projects, &item.projects)) {
            return Err(crate::trf!("já existe outra entrada usando {env} nos mesmos projetos", "another entry already uses {env} in the same projects"));
        }
    }
    if item.id.is_empty() {
        let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
        item.id = format!("v{t}");
        item.added_at = (t / 1000) as u64;
    }
    match secret.map(|s| s.trim().to_string()) {
        Some(s) if !s.is_empty() => {
            if s.len() > 4000 || s.chars().any(|c| c.is_control()) {
                return Err(crate::i18n::tr("isso não parece uma chave ou senha", "that doesn't look like a key or password").into());
            }
            entry(&item.id)?.set_password(&s).map_err(|e| crate::trf!("não consegui salvar no chaveiro: {e}", "couldn't save to the keychain: {e}"))?;
            item.hint = hint(&s);
        }
        _ if existing.is_none() => return Err(crate::i18n::tr("cole a chave ou a senha", "paste the key or password").into()),
        _ => item.hint = items[existing.unwrap()].hint.clone(),
    }
    match existing {
        Some(i) => {
            item.added_at = items[i].added_at;
            items[i] = item.clone();
        }
        None => items.push(item.clone()),
    }
    write(&items)?;
    Ok(item)
}

fn overlaps(a: &[String], b: &[String]) -> bool {
    a.is_empty() || b.is_empty() || a.iter().any(|x| b.contains(x))
}

pub fn delete(id: &str) -> Result<(), String> {
    let _g = LOCK.lock().map_err(|_| "cofre ocupado")?;
    let mut items = list();
    items.retain(|x| x.id != id);
    write(&items)?;
    if let Ok(e) = entry(id) {
        let _ = e.delete_credential();
    }
    Ok(())
}

/// Só quando a pessoa clica em copiar.
pub fn reveal(id: &str) -> Result<String, String> {
    entry(id)?.get_password().map_err(|_| crate::i18n::tr("não achei no chaveiro", "couldn't find it in the keychain").to_string())
}

/// Variáveis que entram no Claude/terminal deste projeto. Segredos que não estão mais no chaveiro ficam de fora.
pub fn env_for(project_id: &str) -> Vec<(String, String)> {
    let mut out = vec![];
    for it in list() {
        let Some(env) = &it.env else { continue };
        if !it.projects.is_empty() && !it.projects.iter().any(|p| p == project_id) {
            continue;
        }
        let Ok(secret) = reveal(&it.id) else { continue };
        if it.kind == "login" {
            if let Some(u) = &it.user {
                out.push((format!("{env}_USER"), u.clone()));
            }
            out.push((format!("{env}_PASSWORD"), secret));
        } else {
            out.push((env.clone(), secret));
        }
    }
    out
}

/// Aviso para o Claude: só os nomes, nunca os valores.
pub fn prompt_for(project_id: &str) -> Option<String> {
    let lines: Vec<String> = list()
        .into_iter()
        .filter(|it| it.env.is_some() && (it.projects.is_empty() || it.projects.iter().any(|p| p == project_id)))
        .map(|it| {
            let env = it.env.unwrap();
            if it.kind == "login" {
                crate::trf!("- {env}_USER e {env}_PASSWORD: login de {}{}", "- {env}_USER and {env}_PASSWORD: login for {}{}", it.name, it.site.map(|s| format!(" ({s})")).unwrap_or_default())
            } else {
                format!("- {env}: {}", it.name)
            }
        })
        .collect();
    (!lines.is_empty()).then(|| {
        crate::trf!(
            "O usuário já guardou estas credenciais no cofre do Veocode e elas estão disponíveis como variáveis de ambiente neste processo:\n{}\nUse essas variáveis (por exemplo lendo do ambiente ou num .env que você mesmo monte com elas) em vez de pedir chaves ou senhas ao usuário. Nunca imprima, registre ou grave os valores em arquivos versionados.", "The user has already saved these credentials in the Veocode vault and they're available as environment variables in this process:\n{}\nUse these variables (for example reading them from the environment or in a .env you build from them) instead of asking the user for keys or passwords. Never print, log or write the values to versioned files.",
            lines.join("\n")
        )
    })
}
