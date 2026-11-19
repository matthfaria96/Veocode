//! Terminal de verdade por projeto: um shell (zsh/bash no macOS e Linux, PowerShell no
//! Windows) num pseudo-terminal, aberto na pasta do projeto.
//!
//! Cada projeto tem os terminais dele, e cada um nasce:
//! - na pasta do projeto;
//! - com o histórico de comandos só daquele projeto (dados do app/terms/<projeto>/history).
//!   No zsh do macOS o `/etc/zshrc` força o HISTFILE, então o Veocode abre o zsh com um
//!   ZDOTDIR próprio que carrega a configuração normal da pessoa e só no fim troca o histórico;
//! - com a conta do projeto para o Claude Code (`CLAUDE_CONFIG_DIR`), então `claude` digitado
//!   ali usa a mesma conta que o chat do projeto.
//!
//! É um terminal normal da pessoa: nada impede um `cd` para outra pasta. A separação está no
//! ponto de partida, no histórico e na conta.
//!
//! A saída vai para a tela pelo evento "term-output" e também fica guardada (últimos 256 KB)
//! para a tela redesenhar o terminal quando volta para o projeto.

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

const KEEP: usize = 256 * 1024;
pub const MAX_PER_PROJECT: usize = 6;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TermInfo {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub shell: String,
    pub cwd: String,
    pub alive: bool,
}

struct Term {
    info: TermInfo,
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
    out: Arc<Mutex<VecDeque<u8>>>,
    alive: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct Terms {
    map: Mutex<HashMap<String, Term>>,
    data: PathBuf,
}

pub struct OpenArgs {
    pub project_id: String,
    pub project_name: String,
    pub root: PathBuf,
    /// pasta do Claude Code da conta do projeto (None = a padrão, ~/.claude)
    pub claude_dir: Option<PathBuf>,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Output<'a> {
    id: &'a str,
    data: &'a str,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Exit<'a> {
    id: &'a str,
    code: Option<u32>,
}

static NEXT: AtomicU64 = AtomicU64::new(1);

/// Shell da pessoa e os argumentos para abrir como sessão de login.
fn shell() -> (String, Vec<String>) {
    if cfg!(windows) {
        let ps = if crate::xray::util::which("pwsh").is_some() { "pwsh.exe" } else { "powershell.exe" };
        return (ps.into(), vec!["-NoLogo".into()]);
    }
    let sh = std::env::var("SHELL").ok().filter(|s| Path::new(s).is_file()).unwrap_or_else(|| if cfg!(target_os = "macos") { "/bin/zsh".into() } else { "/bin/bash".into() });
    (sh, vec!["-l".into()])
}

fn short_name(shell: &str) -> String {
    let n = Path::new(shell).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "shell".into());
    if n == "powershell" { "PowerShell".into() } else { n }
}

/// ZDOTDIR do Veocode: carrega a configuração normal do zsh da pessoa e, no fim do .zshrc,
/// troca o histórico para o do projeto (o zsh só lê o histórico depois do .zshrc).
pub const ZSHENV: &str = r#"# Veocode: carrega a configuração normal do zsh e usa o histórico do projeto
VEOCODE_ZDOTDIR="$ZDOTDIR"
ZDOTDIR="${VEOCODE_REAL_ZDOTDIR:-$HOME}"
[ -f "$ZDOTDIR/.zshenv" ] && source "$ZDOTDIR/.zshenv"
VEOCODE_REAL_ZDOTDIR="$ZDOTDIR"
ZDOTDIR="$VEOCODE_ZDOTDIR"
"#;
pub const ZPROFILE: &str = r#"ZDOTDIR="$VEOCODE_REAL_ZDOTDIR"
[ -f "$ZDOTDIR/.zprofile" ] && source "$ZDOTDIR/.zprofile"
ZDOTDIR="$VEOCODE_ZDOTDIR"
"#;
pub const ZSHRC: &str = r#"ZDOTDIR="$VEOCODE_REAL_ZDOTDIR"
[ -f "$ZDOTDIR/.zshrc" ] && source "$ZDOTDIR/.zshrc"
[ -n "$VEOCODE_HISTFILE" ] && HISTFILE="$VEOCODE_HISTFILE"
unset VEOCODE_ZDOTDIR
"#;

fn write_zdotdir(dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    for (name, body) in [(".zshenv", ZSHENV), (".zprofile", ZPROFILE), (".zshrc", ZSHRC)] {
        let f = dir.join(name);
        if std::fs::read_to_string(&f).ok().as_deref() != Some(body) {
            std::fs::write(f, body)?;
        }
    }
    Ok(())
}

/// Junta pedaços de bytes em texto sem quebrar caracteres de vários bytes no meio.
pub fn take_utf8(carry: &mut Vec<u8>) -> String {
    match std::str::from_utf8(carry) {
        Ok(s) => {
            let s = s.to_string();
            carry.clear();
            s
        }
        Err(e) => {
            let ok = e.valid_up_to();
            // sequência inválida de verdade (não só cortada no fim): troca e segue
            if e.error_len().is_some() {
                let s = String::from_utf8_lossy(carry).to_string();
                carry.clear();
                return s;
            }
            let s = String::from_utf8_lossy(&carry[..ok]).to_string();
            carry.drain(..ok);
            s
        }
    }
}

impl Terms {
    pub fn new(data: PathBuf) -> Self {
        Self { map: Mutex::default(), data }
    }

    pub fn list(&self, project: &str) -> Vec<TermInfo> {
        let Ok(m) = self.map.lock() else { return vec![] };
        let mut v: Vec<TermInfo> = m
            .values()
            .filter(|t| t.info.project_id == project)
            .map(|t| TermInfo { alive: t.alive.load(Ordering::SeqCst), ..t.info.clone() })
            .collect();
        v.sort_by_key(|t| t.id[1..].parse::<u64>().unwrap_or(0));
        v
    }

    /// O shell com a pasta, o histórico e a conta do projeto.
    fn command(&self, sh: &str, args: &[String], base: &str, a: &OpenArgs) -> CommandBuilder {
        let mut cmd = CommandBuilder::new(sh);
        cmd.args(args);
        cmd.cwd(&a.root);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("TERM_PROGRAM", "Veocode");
        cmd.env("VEOCODE_PROJECT", &a.project_name);
        for (k, v) in crate::vault::env_for(&a.project_id) {
            cmd.env(k, v);
        }
        for k in ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "TERM_SESSION_ID"] {
            cmd.env_remove(k);
        }
        // `claude` digitado aqui usa a conta do projeto
        match &a.claude_dir {
            Some(d) => cmd.env("CLAUDE_CONFIG_DIR", d),
            None => cmd.env_remove("CLAUDE_CONFIG_DIR"),
        }
        // histórico só deste projeto
        let hist_dir = self.data.join("terms").join(&a.project_id);
        if std::fs::create_dir_all(&hist_dir).is_ok() {
            let hist = hist_dir.join("history");
            cmd.env("HISTFILE", &hist);
            cmd.env("VEOCODE_HISTFILE", &hist);
            if base == "zsh" {
                let zd = self.data.join("terms").join("zsh");
                if write_zdotdir(&zd).is_ok() {
                    if let Ok(real) = std::env::var("ZDOTDIR") {
                        cmd.env("VEOCODE_REAL_ZDOTDIR", real);
                    }
                    cmd.env("ZDOTDIR", &zd);
                }
            }
        }

        cmd
    }

    pub fn open(&self, app: AppHandle, a: OpenArgs) -> Result<TermInfo, String> {
        let taken: Vec<String> = self.list(&a.project_id).into_iter().map(|t| t.name).collect();
        if taken.len() >= MAX_PER_PROJECT {
            return Err(format!("Cada projeto abre até {MAX_PER_PROJECT} terminais. Feche um antes."));
        }
        let (sh, args) = shell();
        let base = short_name(&sh);
        let name = (1..).map(|n| format!("{base} {n}")).find(|n| !taken.contains(n)).unwrap_or_else(|| base.clone());

        let pty = native_pty_system()
            .openpty(PtySize { rows: a.rows.max(4), cols: a.cols.max(20), pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("não deu para abrir o terminal: {e}"))?;
        let cmd = self.command(&sh, &args, &base, &a);
        let child = pty.slave.spawn_command(cmd).map_err(|e| format!("não deu para abrir {sh}: {e}"))?;
        drop(pty.slave);
        let mut reader = pty.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pty.master.take_writer().map_err(|e| e.to_string())?;

        let id = format!("t{}", NEXT.fetch_add(1, Ordering::SeqCst));
        let info = TermInfo { id: id.clone(), project_id: a.project_id.clone(), name, shell: sh.clone(), cwd: a.root.to_string_lossy().into(), alive: true };
        let out = Arc::new(Mutex::new(VecDeque::with_capacity(KEEP)));
        let alive = Arc::new(AtomicBool::new(true));

        {
            let (id, out, alive) = (id.clone(), out.clone(), alive.clone());
            std::thread::spawn(move || {
                let mut buf = [0u8; 16 * 1024];
                let mut carry = Vec::new();
                loop {
                    let n = match reader.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => n,
                    };
                    if let Ok(mut o) = out.lock() {
                        o.extend(&buf[..n]);
                        let extra = o.len().saturating_sub(KEEP);
                        o.drain(..extra);
                    }
                    carry.extend_from_slice(&buf[..n]);
                    let text = take_utf8(&mut carry);
                    if !text.is_empty() {
                        let _ = app.emit("term-output", Output { id: &id, data: &text });
                    }
                }
                alive.store(false, Ordering::SeqCst);
                let _ = app.emit("term-exit", Exit { id: &id, code: None });
            });
        }

        self.map.lock().map_err(|e| e.to_string())?.insert(id, Term { info: info.clone(), writer, master: pty.master, child, out, alive });
        Ok(info)
    }

    pub fn write(&self, id: &str, data: &str) -> Result<(), String> {
        let mut m = self.map.lock().map_err(|e| e.to_string())?;
        let t = m.get_mut(id).ok_or("terminal fechado")?;
        t.writer.write_all(data.as_bytes()).and_then(|_| t.writer.flush()).map_err(|e| e.to_string())
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let m = self.map.lock().map_err(|e| e.to_string())?;
        let t = m.get(id).ok_or("terminal fechado")?;
        t.master.resize(PtySize { rows: rows.max(4), cols: cols.max(20), pixel_width: 0, pixel_height: 0 }).map_err(|e| e.to_string())
    }

    /// O que o terminal mostrou por último, para redesenhar a tela (começa numa linha inteira).
    pub fn buffer(&self, id: &str) -> Result<String, String> {
        let m = self.map.lock().map_err(|e| e.to_string())?;
        let t = m.get(id).ok_or("terminal fechado")?;
        let o = t.out.lock().map_err(|e| e.to_string())?;
        let bytes: Vec<u8> = o.iter().copied().collect();
        let start = if bytes.len() >= KEEP { bytes.iter().position(|b| *b == b'\n').map(|p| p + 1).unwrap_or(0) } else { 0 };
        Ok(String::from_utf8_lossy(&bytes[start..]).to_string())
    }

    pub fn close(&self, id: &str) {
        let t = self.map.lock().ok().and_then(|mut m| m.remove(id));
        if let Some(mut t) = t {
            let _ = t.child.kill();
            // soltar o mestre fecha o pseudo-terminal (o shell recebe SIGHUP)
            drop(t.master);
        }
    }

    pub fn close_project(&self, project: &str) {
        for t in self.list(project) {
            self.close(&t.id);
        }
    }

    pub fn shutdown(&self) {
        let ids: Vec<String> = self.map.lock().map(|m| m.keys().cloned().collect()).unwrap_or_default();
        for id in ids {
            self.close(&id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_multibyte_characters_whole() {
        let s = "ação ✓".as_bytes();
        let mut carry = s[..2].to_vec(); // "a" + metade do "ç"
        assert_eq!(take_utf8(&mut carry), "a");
        assert_eq!(carry.len(), 1);
        carry.extend_from_slice(&s[2..]);
        assert_eq!(take_utf8(&mut carry), "ção ✓");
        assert!(carry.is_empty());
        let mut bad = vec![b'o', 0xff, b'k'];
        assert_eq!(take_utf8(&mut bad), "o\u{fffd}k");
    }

    #[cfg(unix)]
    #[test]
    fn zsh_wrapper_keeps_the_persons_config_and_swaps_history() {
        // roda um zsh de verdade com um HOME falso: a config "da pessoa" carrega e o histórico
        // termina o do projeto, mesmo com o /etc/zshrc mudando o HISTFILE
        if !Path::new("/bin/zsh").is_file() {
            return;
        }
        let base = std::env::temp_dir().join(format!("veocode-term-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let (home, zd) = (base.join("home"), base.join("zd"));
        std::fs::create_dir_all(&home).unwrap();
        std::fs::write(home.join(".zshrc"), "export MEU_ZSHRC=sim\n").unwrap();
        write_zdotdir(&zd).unwrap();
        let out = std::process::Command::new("/bin/zsh")
            .args(["-l", "-i", "-c", "echo \"$MEU_ZSHRC|$HISTFILE|$ZDOTDIR\""])
            .env("HOME", &home)
            .env("ZDOTDIR", &zd)
            .env("VEOCODE_HISTFILE", base.join("hist"))
            .env_remove("VEOCODE_REAL_ZDOTDIR")
            .output()
            .unwrap();
        let text = String::from_utf8_lossy(&out.stdout);
        let line = text.lines().last().unwrap_or("");
        assert_eq!(line, format!("sim|{}|{}", base.join("hist").display(), home.display()), "{text}");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[cfg(unix)]
    #[test]
    fn project_shell_starts_in_the_folder_with_its_history_and_account() {
        // shell de login de verdade num pseudo-terminal, como o app abre
        let base = std::env::temp_dir().join(format!("veocode-pty-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let root = base.join("meu projeto");
        std::fs::create_dir_all(&root).unwrap();
        let terms = Terms::new(base.join("dados"));
        let a = OpenArgs { project_id: "p42".into(), project_name: "meu projeto".into(), root: root.clone(), claude_dir: Some(base.join("conta-b")), cols: 120, rows: 20 };
        let (sh, args) = shell();
        let cmd = terms.command(&sh, &args, &short_name(&sh), &a);
        let pty = native_pty_system().openpty(PtySize { rows: 20, cols: 200, pixel_width: 0, pixel_height: 0 }).unwrap();
        let mut child = pty.slave.spawn_command(cmd).unwrap();
        drop(pty.slave);
        let mut reader = pty.master.try_clone_reader().unwrap();
        let mut w = pty.master.take_writer().unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut all = Vec::new();
            let mut buf = [0u8; 4096];
            while let Ok(n) = reader.read(&mut buf) {
                if n == 0 {
                    break;
                }
                all.extend_from_slice(&buf[..n]);
                if String::from_utf8_lossy(&all).contains("FIM-42") {
                    break;
                }
            }
            let _ = tx.send(String::from_utf8_lossy(&all).to_string());
        });
        w.write_all(b"echo \"R=$PWD|$HISTFILE|$CLAUDE_CONFIG_DIR|$VEOCODE_PROJECT|$TERM\"; echo FIM-$((40+2))\r").unwrap();
        w.flush().unwrap();
        let out = rx.recv_timeout(std::time::Duration::from_secs(30)).expect("o shell não respondeu em 30 s");
        let _ = child.kill();
        let line = out.lines().rev().find(|l| l.starts_with("R=")).unwrap_or_else(|| panic!("sem resposta: {out}")).trim().to_string();
        let real_root = root.canonicalize().unwrap();
        let hist = base.join("dados/terms/p42/history");
        let expect = format!("R={}|{}|{}|meu projeto|xterm-256color", real_root.display(), hist.display(), base.join("conta-b").display());
        // macOS: /var → /private/var no PWD
        assert!(line == expect || line == expect.replace(&real_root.display().to_string(), &root.display().to_string()), "{line}\n!=\n{expect}");
        let _ = std::fs::remove_dir_all(&base);
    }
}
