// Limites do plano do Claude (janela de 5 horas e semana), como no app do Claude e no Aitracker.
// Lê o login que o próprio Claude Code guardou (arquivo ou Chaves do macOS, só leitura) e pergunta
// à Anthropic o quanto já foi usado. É uma consulta de leitura: não gasta tokens.
// Não renova o login: isso trocaria a chave do Claude Code e poderia deslogar ele.
use crate::accounts::{claude, Account};
use serde::Serialize;
use std::collections::HashMap;
use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Window {
    /// 0 a 100
    pub pct: f64,
    /// ISO 8601, quando zera
    pub resets_at: Option<String>,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Limits {
    pub five_hour: Option<Window>,
    pub week: Option<Window>,
    /// limites semanais por modelo (ex.: "Opus", "Fable")
    pub models: Vec<(String, Window)>,
    /// segundos desde 1970 da leitura
    pub at: u64,
    /// sem dados: por quê (sem login, chave vencida, sem internet…)
    pub error: Option<String>,
    /// tem dados, mas são da última leitura boa (a de agora falhou): por quê
    pub note: Option<String>,
    /// de onde veio: "anthropic" (consulta) ou "claude" (o próprio Claude Code, a cada resposta)
    pub source: String,
}

// guarda a última leitura por conta: várias telas pedem ao mesmo tempo, a Anthropic vê uma só
static CACHE: Mutex<Option<HashMap<String, (Instant, Limits)>>> = Mutex::new(None);
const FRESH: Duration = Duration::from_secs(60);
// última leitura com números (de qualquer fonte) e até quando não perguntar de novo à Anthropic
static GOOD: Mutex<Option<HashMap<String, Limits>>> = Mutex::new(None);
static PAUSE: Mutex<Option<HashMap<String, Instant>>> = Mutex::new(None);
// espera padrão depois de uma recusa, quando a Anthropic não diz quanto (Retry-After)
const BACKOFF: Duration = Duration::from_secs(5 * 60);
const MAX_BACKOFF: Duration = Duration::from_secs(30 * 60);

fn good(id: &str) -> Option<Limits> {
    GOOD.lock().ok().and_then(|g| g.as_ref().and_then(|m| m.get(id).cloned()))
}
fn keep_good(id: &str, l: &Limits) {
    if let Ok(mut g) = GOOD.lock() {
        g.get_or_insert_with(HashMap::new).insert(id.to_string(), l.clone());
    }
}
fn paused(id: &str) -> bool {
    PAUSE.lock().ok().and_then(|p| p.as_ref().and_then(|m| m.get(id).copied())).is_some_and(|t| Instant::now() < t)
}
fn pause(id: &str, wait: Option<Duration>) {
    if let Ok(mut p) = PAUSE.lock() {
        p.get_or_insert_with(HashMap::new).insert(id.to_string(), Instant::now() + wait.unwrap_or(BACKOFF).min(MAX_BACKOFF));
    }
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

pub fn for_account(a: &Account, force: bool) -> Limits {
    if !force {
        if let Some((t, l)) = CACHE.lock().ok().and_then(|c| c.as_ref().and_then(|m| m.get(&a.id).cloned())) {
            if t.elapsed() < FRESH {
                return l;
            }
        }
    }
    // em pausa (a Anthropic recusou há pouco): não pergunta de novo, a não ser que a pessoa peça.
    // Importante: estar em pausa não renova a pausa, senão ela nunca acaba.
    let waiting = !force && paused(&a.id);
    let fetched = if waiting {
        Err(Fail::Refused(None))
    } else {
        token(a).map_err(Fail::Other).and_then(|tok| fetch(&tok))
    };
    let l = match fetched {
        Ok(l) => {
            keep_good(&a.id, &l);
            if let Ok(mut p) = PAUSE.lock() {
                p.get_or_insert_with(HashMap::new).remove(&a.id);
            }
            l
        }
        Err(f) => {
            if let (Fail::Refused(wait), false) = (&f, waiting) {
                pause(&a.id, *wait);
            }
            let why = f.text();
            // falhou agora, mas já teve número: mostra o último, avisando
            match good(&a.id) {
                Some(mut g) => {
                    g.note = Some(why);
                    g
                }
                None => Limits { at: now(), error: Some(why), ..Default::default() },
            }
        }
    };
    if let Ok(mut c) = CACHE.lock() {
        c.get_or_insert_with(HashMap::new).insert(a.id.clone(), (Instant::now(), l.clone()));
    }
    l
}

/// Nome da entrada nas Chaves, igual ao do Claude Code: sem pasta própria é "Claude Code-credentials";
/// com CLAUDE_CONFIG_DIR ganha "-" + 8 letras do sha256 da pasta.
fn service(a: &Account) -> String {
    match &a.config_dir {
        None => "Claude Code-credentials".into(),
        Some(d) => format!("Claude Code-credentials-{}", sha8(d).unwrap_or_default()),
    }
}

fn sha8(s: &str) -> Option<String> {
    let mut c = Command::new("/usr/bin/shasum").args(["-a", "256"]).stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().ok()?;
    c.stdin.take()?.write_all(s.as_bytes()).ok()?;
    let out = c.wait_with_output().ok()?;
    Some(String::from_utf8_lossy(&out.stdout).chars().take(8).collect())
}

enum Fail {
    /// a Anthropic recusou a consulta (403/429): espera um tempo antes de tentar de novo
    /// (o que ela mandou em Retry-After, se mandou)
    Refused(Option<Duration>),
    Other(String),
}
impl Fail {
    fn text(&self) -> String {
        match self {
            Fail::Refused(_) => "A Anthropic não está liberando a consulta de uso agora. O número se atualiza sozinho a cada resposta do Claude por aqui.".into(),
            Fail::Other(s) => s.clone(),
        }
    }
}

fn token(a: &Account) -> Result<String, String> {
    let pick = |raw: &str| -> Option<(String, i64)> {
        let v: serde_json::Value = serde_json::from_str(raw).ok()?;
        let o = v.get("claudeAiOauth")?;
        Some((o.get("accessToken")?.as_str()?.to_string(), o.get("expiresAt").and_then(|x| x.as_i64()).unwrap_or(i64::MAX)))
    };
    // 1) arquivo que o Claude Code usa fora do macOS (às vezes existe aqui também)
    let file = claude::config_dir(a).join(".credentials.json");
    let mut found = std::fs::read_to_string(&file).ok().and_then(|s| pick(&s));
    // 2) Chaves do macOS (pelo comando `security`, que o próprio Claude Code usa)
    if found.is_none() {
        found = keychain(&service(a)).and_then(|s| pick(&s));
    }
    let (tok, exp) = found.ok_or("Sem login do Claude Code nesta conta")?;
    if exp != i64::MAX && exp < (now() as i64) * 1000 {
        return Err("O login venceu: use o Claude uma vez e o uso aparece de novo".into());
    }
    Ok(tok)
}

fn keychain(svc: &str) -> Option<String> {
    let user = std::env::var("USER").unwrap_or_default();
    let mut child = Command::new("/usr/bin/security")
        .args(["find-generic-password", "-s", svc, "-a", &user, "-w"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    // nunca fica preso: se o macOS segurar (aviso de permissão), desiste em 20 s
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(st)) if st.success() => break,
            Ok(Some(_)) => return None,
            Ok(None) if start.elapsed() > Duration::from_secs(20) => {
                let _ = child.kill();
                return None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(_) => return None,
        }
    }
    let out = child.wait_with_output().ok()?;
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!s.is_empty()).then_some(s)
}

fn fetch(tok: &str) -> Result<Limits, Fail> {
    let ag = ureq::AgentBuilder::new().timeout(Duration::from_secs(12)).build();
    let res = ag
        .get("https://api.anthropic.com/api/oauth/usage")
        .set("Authorization", &format!("Bearer {tok}"))
        .set("anthropic-beta", "oauth-2025-04-20")
        .set("User-Agent", "claude-code/2.1.5")
        .set("Accept", "application/json")
        .call();
    let v: serde_json::Value = match res {
        Ok(r) => r.into_json().map_err(|e| Fail::Other(e.to_string()))?,
        Err(ureq::Error::Status(401, _)) => return Err(Fail::Other("O login venceu: use o Claude uma vez e o uso aparece de novo".into())),
        Err(ureq::Error::Status(403 | 429, r)) => {
            let wait = r.header("retry-after").and_then(|s| s.trim().parse::<u64>().ok()).map(Duration::from_secs);
            return Err(Fail::Refused(wait));
        }
        Err(ureq::Error::Status(c, _)) => return Err(Fail::Other(format!("A Anthropic respondeu {c}"))),
        Err(_) => return Err(Fail::Other("Sem internet para ler o uso".into())),
    };
    Ok(parse(&v))
}

fn window(v: &serde_json::Value) -> Option<Window> {
    let pct = v.get("utilization").or_else(|| v.get("percent")).and_then(|x| x.as_f64().or_else(|| x.as_str().and_then(|s| s.parse().ok())))?;
    Some(Window { pct: pct.clamp(0.0, 100.0), resets_at: v.get("resets_at").and_then(|x| x.as_str()).map(String::from) })
}

pub fn parse(v: &serde_json::Value) -> Limits {
    let mut models: Vec<(String, Window)> = Vec::new();
    // formato novo: "limits": [{"kind":"weekly_scoped","percent":73,"scope":{"model":{"display_name":"Fable"}}}]
    if let Some(list) = v.get("limits").and_then(|x| x.as_array()) {
        for l in list {
            if l.get("kind").and_then(|k| k.as_str()) != Some("weekly_scoped") {
                continue;
            }
            let name = l.pointer("/scope/model/display_name").and_then(|x| x.as_str()).unwrap_or("").to_string();
            if let (false, Some(w)) = (name.is_empty(), window(l)) {
                models.push((name, w));
            }
        }
    }
    // formato antigo: seven_day_opus, seven_day_sonnet…
    for (key, name) in [("seven_day_opus", "Opus"), ("seven_day_sonnet", "Sonnet"), ("seven_day_fable", "Fable")] {
        if models.iter().any(|(n, _)| n.eq_ignore_ascii_case(name)) {
            continue;
        }
        if let Some(w) = v.get(key).and_then(window).filter(|w| w.pct > 0.0) {
            models.push((name.into(), w));
        }
    }
    Limits { five_hour: v.get("five_hour").and_then(window), week: v.get("seven_day").and_then(window), models, at: now(), source: "anthropic".into(), ..Default::default() }
}

/// O Claude Code manda o uso do plano a cada resposta (`rate_limit_event`): é a fonte mais confiável
/// e não custa nada. Junta com o que já se sabia da conta e guarda como última leitura boa.
pub fn from_event(account: &str, v: &serde_json::Value) -> Option<Limits> {
    let info = v.get("rate_limit_info")?;
    // utilização chega como fração (0,42) — às vezes já em porcentagem
    let pct = |x: f64| if x <= 1.0 { x * 100.0 } else { x }.clamp(0.0, 100.0);
    let iso = |secs: i64| chrono::DateTime::from_timestamp(secs, 0).map(|d| d.to_rfc3339());
    let win = |w: &serde_json::Value| -> Option<Window> {
        Some(Window { pct: pct(w.get("utilization")?.as_f64()?), resets_at: w.get("resetsAt").and_then(|r| r.as_i64()).and_then(iso) })
    };
    let mut l = good(account).unwrap_or_default();
    let mut got = false;
    if let Some(ws) = info.get("unifiedWindows") {
        if let Some(w) = ws.get("five_hour").and_then(win) {
            l.five_hour = Some(w);
            got = true;
        }
        if let Some(w) = ws.get("seven_day").and_then(win) {
            l.week = Some(w);
            got = true;
        }
    }
    if !got {
        // formato curto: só o limite que mais pesa agora
        let u = info.get("utilization").and_then(|x| x.as_f64());
        let w = u.map(|u| Window { pct: pct(u), resets_at: info.get("resetsAt").and_then(|r| r.as_i64()).and_then(iso) });
        let rejected = info.get("status").and_then(|s| s.as_str()) == Some("rejected");
        let w = w.or_else(|| rejected.then(|| Window { pct: 100.0, resets_at: info.get("resetsAt").and_then(|r| r.as_i64()).and_then(iso) }));
        match (info.get("rateLimitType").and_then(|t| t.as_str()), w) {
            (Some("five_hour"), Some(w)) => l.five_hour = Some(w),
            (Some("seven_day"), Some(w)) => l.week = Some(w),
            _ => return None,
        }
    }
    l.at = now();
    l.error = None;
    l.note = None;
    l.source = "claude".into();
    keep_good(account, &l);
    if let Ok(mut c) = CACHE.lock() {
        c.get_or_insert_with(HashMap::new).insert(account.to_string(), (Instant::now(), l.clone()));
    }
    Some(l)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_both_formats() {
        let v = serde_json::json!({
            "five_hour": {"utilization": 12.5, "resets_at": "2026-11-19T08:00:00Z"},
            "seven_day": {"utilization": 100, "resets_at": "2026-11-21T01:00:00Z"},
            "seven_day_opus": {"utilization": 40},
            "limits": [{"kind": "weekly_scoped", "percent": 73, "scope": {"model": {"display_name": "Fable"}}}]
        });
        let l = parse(&v);
        assert_eq!(l.five_hour.unwrap().pct, 12.5);
        assert_eq!(l.week.unwrap().pct, 100.0);
        assert_eq!(l.models.len(), 2);
        assert_eq!(l.models[0].0, "Fable");
    }

    #[test]
    fn pause_ends_on_its_own() {
        // antes, cada leitura durante a pausa renovava a pausa e o uso nunca mais aparecia
        let a = Account { id: "teste-pausa".into(), label: "t".into(), provider: crate::accounts::Provider::Claude, color: String::new(), model: None, config_dir: Some("/nao/existe".into()), base_url: None, key_hint: None, created_at: 0 };
        pause(&a.id, Some(Duration::from_millis(300)));
        for _ in 0..3 {
            let l = for_account(&a, false);
            assert!(l.error.unwrap().contains("Anthropic"));
            if let Ok(mut c) = CACHE.lock() {
                c.as_mut().unwrap().remove(&a.id);
            }
        }
        std::thread::sleep(Duration::from_millis(400));
        assert!(!paused(&a.id));
        // passou a pausa: tenta de verdade (aqui, sem login nessa pasta)
        assert!(for_account(&a, false).error.unwrap().contains("Sem login"));
    }

    #[test]
    fn reads_claude_rate_limit_event() {
        let v = serde_json::json!({"type": "rate_limit_event", "rate_limit_info": {"status": "allowed",
            "unifiedWindows": {"five_hour": {"utilization": 0.42, "resetsAt": 1795100000}, "seven_day": {"utilization": 0.15, "resetsAt": 1795500000}}}});
        let l = from_event("teste-evento", &v).unwrap();
        assert_eq!(l.five_hour.unwrap().pct.round(), 42.0);
        assert_eq!(l.week.as_ref().unwrap().pct.round(), 15.0);
        assert!(l.week.unwrap().resets_at.unwrap().starts_with("2026-11-"));
        // formato curto, só com o limite que bateu
        let v = serde_json::json!({"type": "rate_limit_event", "rate_limit_info": {"status": "rejected", "rateLimitType": "seven_day", "resetsAt": 1795500000}});
        let l = from_event("teste-evento", &v).unwrap();
        assert_eq!(l.week.unwrap().pct, 100.0);
        assert_eq!(l.five_hour.unwrap().pct.round(), 42.0);
    }
}
