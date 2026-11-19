//! Ditado: roda o ajudante `veocode-voice` (reconhecimento de fala da Apple) e repassa o que
//! ele ouve para a tela pelo evento `voice` (texto parcial, volume da voz, fim ou erro).
//! Um ditado por vez; fechar o stdin do ajudante cancela.

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

static CURRENT: Mutex<Option<(Child, ChildStdin, u64)>> = Mutex::new(None);
static SEQ: Mutex<u64> = Mutex::new(0);

fn helper() -> Result<std::path::PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let p = exe.parent().ok_or("app sem pasta")?.join("veocode-voice");
    let ok = std::fs::metadata(&p).map(|m| m.len() > 0).unwrap_or(false);
    ok.then_some(p).ok_or_else(|| "O ditado não veio nesta versão do app".into())
}

/// Começa a ouvir. Devolve o número deste ditado (vem junto em cada evento).
pub fn start(app: AppHandle, locale: &str) -> Result<u64, String> {
    cancel();
    let locale: String = locale.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').take(16).collect();
    let mut child = Command::new(helper()?)
        .arg(if locale.is_empty() { "pt-BR" } else { &locale })
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Não deu para abrir o ditado: {e}"))?;
    let stdin = child.stdin.take().ok_or("sem stdin")?;
    let stdout = child.stdout.take().ok_or("sem stdout")?;
    let id = {
        let mut s = SEQ.lock().unwrap();
        *s += 1;
        *s
    };
    *CURRENT.lock().unwrap() = Some((child, stdin, id));
    std::thread::spawn(move || {
        let mut ended = false;
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let Ok(mut v) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
            ended |= matches!(v["t"].as_str(), Some("done") | Some("error"));
            v["id"] = id.into();
            let _ = app.emit("voice", v);
        }
        if !ended {
            let _ = app.emit("voice", serde_json::json!({ "t": "end", "id": id }));
        }
        let mut cur = CURRENT.lock().unwrap();
        if cur.as_ref().is_some_and(|c| c.2 == id) {
            if let Some((mut c, _, _)) = cur.take() {
                let _ = c.wait();
            }
        }
    });
    Ok(id)
}

/// Para de ouvir e pede o texto final (chega como evento `done`).
pub fn stop() {
    if let Some((_, stdin, _)) = CURRENT.lock().unwrap().as_mut() {
        let _ = stdin.write_all(b"stop\n");
        let _ = stdin.flush();
    }
}

/// Cancela sem esperar o texto.
pub fn cancel() {
    if let Some((mut c, stdin, _)) = CURRENT.lock().unwrap().take() {
        drop(stdin);
        let _ = c.kill();
        let _ = c.wait();
    }
}
