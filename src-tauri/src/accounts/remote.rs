//! Contas por API (DeepSeek e compatíveis com OpenAI) e o Ollama local.
//!
//! A chave vai para o chaveiro do sistema e só sai de lá para ir ao endereço da própria
//! conta. A interface nunca recebe a chave de volta — só o final dela ("…a1b2").

use super::{Account, AccountStatus, Provider, State};
use serde::Deserialize;
use std::time::Duration;

const SERVICE: &str = "com.veocode.app";

fn entry(id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, &format!("api-key:{id}")).map_err(|e| e.to_string())
}

pub fn hint(key: &str) -> String {
    let tail: String = key.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
    format!("…{tail}")
}

pub fn validate_key(key: &str) -> Result<&str, String> {
    let k = key.trim();
    if k.is_empty() {
        return Err("cole a chave".into());
    }
    if k.len() > 400 || k.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("isso não parece uma chave de API".into());
    }
    Ok(k)
}

/// Guarda no chaveiro e devolve o final da chave para mostrar.
pub fn set_key(id: &str, key: &str) -> Result<String, String> {
    let k = validate_key(key)?;
    entry(id)?.set_password(k).map_err(|e| format!("não consegui salvar no chaveiro: {e}"))?;
    Ok(hint(k))
}

pub fn delete_key(id: &str) {
    if let Ok(e) = entry(id) {
        let _ = e.delete_credential();
    }
}

pub(crate) fn get_key(id: &str) -> Option<String> {
    entry(id).ok()?.get_password().ok()
}

/// Só HTTPS — ou HTTP para a própria máquina (servidores locais).
pub fn check_base_url(url: &str) -> Result<(), String> {
    let rest = if let Some(r) = url.strip_prefix("https://") {
        r
    } else if let Some(r) = url.strip_prefix("http://") {
        let host = r.split(['/', '?']).next().unwrap_or("");
        let host = host.rsplit_once(':').map(|(h, _)| h).unwrap_or(host);
        if !matches!(host, "localhost" | "127.0.0.1" | "[::1]") {
            return Err("use https:// (http só para servidores na sua máquina)".into());
        }
        r
    } else {
        return Err("o endereço precisa começar com https://".into());
    };
    if rest.is_empty() || rest.starts_with('/') || rest.contains(char::is_whitespace) || rest.contains('@') {
        return Err("endereço inválido".into());
    }
    Ok(())
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(4)).timeout(Duration::from_secs(8)).build()
}

fn host_of(url: &str) -> String {
    url.split("://").nth(1).unwrap_or(url).split('/').next().unwrap_or("").to_string()
}

#[derive(Deserialize)]
struct ModelList {
    #[serde(default)]
    data: Vec<ModelId>,
}
#[derive(Deserialize)]
struct ModelId {
    id: String,
}

#[derive(Deserialize)]
struct Balance {
    #[serde(default)]
    is_available: bool,
    #[serde(default)]
    balance_infos: Vec<BalanceInfo>,
}
#[derive(Deserialize)]
struct BalanceInfo {
    currency: String,
    total_balance: String,
}

fn money(currency: &str, amount: &str) -> String {
    let sym = match currency {
        "USD" => "US$",
        "CNY" => "¥",
        other => other,
    };
    let n: f64 = amount.parse().unwrap_or(0.0);
    format!("{sym} {}", format!("{n:.2}").replace('.', ","))
}

pub fn api_status(a: &Account) -> AccountStatus {
    let mut s = AccountStatus::new(&a.id, State::SemChave);
    let base = a.base_url.clone().unwrap_or_default();
    s.who = Some(host_of(&base));
    s.plan = Some(if a.provider == Provider::Deepseek { "Pré-pago".into() } else { "API".into() });
    if check_base_url(&base).is_err() {
        s.state = State::Erro;
        s.detail = Some("Endereço da API inválido.".into());
        return s;
    }
    let Some(key) = get_key(&a.id) else {
        s.detail = Some("Cole a chave de API para usar esta conta.".into());
        return s;
    };
    let auth = format!("Bearer {key}");
    let ag = agent();
    match ag.get(&format!("{base}/models")).set("Authorization", &auth).call() {
        Ok(r) => {
            s.state = State::Pronta;
            if let Ok(list) = r.into_json::<ModelList>() {
                s.models = list.data.into_iter().map(|m| m.id).take(30).collect();
            }
        }
        Err(ureq::Error::Status(code, _)) => {
            s.state = State::Erro;
            s.detail = Some(match code {
                401 | 403 => "A chave foi recusada. Confira se copiou inteira ou gere outra.".into(),
                429 => "Limite de requisições atingido. Tente de novo em instantes.".into(),
                c => format!("A API respondeu com erro {c}."),
            });
            return s;
        }
        Err(e) => {
            s.state = State::Offline;
            s.detail = Some(format!("Sem resposta de {}: {}", host_of(&base), short_err(&e)));
            return s;
        }
    }
    if a.provider == Provider::Deepseek {
        if let Ok(b) = ag.get(&format!("{base}/user/balance")).set("Authorization", &auth).call().and_then(|r| Ok(r.into_json::<Balance>()?)) {
            s.balance = b.balance_infos.first().map(|i| money(&i.currency, &i.total_balance));
            if !b.is_available {
                s.state = State::Erro;
                s.detail = Some("Sem saldo: recarregue na plataforma da DeepSeek.".into());
            }
        }
    }
    s
}

fn short_err(e: &ureq::Error) -> String {
    let t = e.to_string();
    t.chars().take(120).collect()
}

// ---------------------------------------------------------------- Ollama

#[derive(Deserialize)]
struct Tags {
    #[serde(default)]
    models: Vec<OllamaModel>,
}
#[derive(Deserialize)]
struct OllamaModel {
    name: String,
    #[serde(default)]
    size: u64,
}
#[derive(Deserialize)]
struct Version {
    version: String,
}

pub fn ollama_status(a: &Account) -> AccountStatus {
    let base = a.base_url.clone().unwrap_or_else(|| super::OLLAMA_URL.into());
    let mut s = AccountStatus::new(&a.id, State::Offline);
    s.plan = Some("Local".into());
    s.who = Some(host_of(&base));
    if check_base_url(&base).is_err() {
        s.state = State::Erro;
        s.detail = Some("Endereço inválido.".into());
        return s;
    }
    let ag = ureq::AgentBuilder::new().timeout_connect(Duration::from_millis(800)).timeout(Duration::from_secs(3)).build();
    let version = match ag.get(&format!("{base}/api/version")).call() {
        Ok(r) => r.into_json::<Version>().map(|v| v.version).unwrap_or_default(),
        Err(_) => {
            let installed = crate::xray::util::which("ollama").is_some();
            s.detail = Some(if installed { "O Ollama está instalado mas não está aberto.".into() } else { "O Ollama não está instalado nesta máquina.".into() });
            return s;
        }
    };
    s.state = State::Pronta;
    let tags = ag.get(&format!("{base}/api/tags")).call().ok().and_then(|r| r.into_json::<Tags>().ok()).map(|t| t.models).unwrap_or_default();
    let total: u64 = tags.iter().map(|m| m.size).sum();
    s.models = tags.iter().map(|m| m.name.clone()).collect();
    let running = ag.get(&format!("{base}/api/ps")).call().ok().and_then(|r| r.into_json::<Tags>().ok()).map(|t| t.models).unwrap_or_default();
    s.active = !running.is_empty();
    s.detail = Some(format!(
        "Ollama {version} · {} {} · {:.1} GB{}",
        tags.len(),
        if tags.len() == 1 { "modelo" } else { "modelos" },
        total as f64 / 1e9,
        if running.is_empty() { String::new() } else { format!(" · carregado: {}", running.iter().map(|m| m.name.as_str()).collect::<Vec<_>>().join(", ")) }
    ));
    if tags.is_empty() {
        s.detail = Some(format!("Ollama {version} aberto, mas sem modelos. Rode: ollama pull qwen3-coder"));
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls() {
        assert!(check_base_url("https://api.deepseek.com").is_ok());
        assert!(check_base_url("http://127.0.0.1:11434").is_ok());
        assert!(check_base_url("http://localhost:1234/v1").is_ok());
        assert!(check_base_url("http://evil.com").is_err());
        assert!(check_base_url("http://localhost.evil.com").is_err());
        assert!(check_base_url("https://user@evil.com").is_err());
        assert!(check_base_url("ftp://x").is_err());
        assert!(check_base_url("https://").is_err());
    }

    #[test]
    fn keys() {
        assert_eq!(hint("sk-abcdef1234"), "…1234");
        assert!(validate_key("  sk-123  ").is_ok());
        assert!(validate_key("sk 123").is_err());
        assert!(validate_key("").is_err());
        assert_eq!(money("USD", "7.4"), "US$ 7,40");
    }
}
