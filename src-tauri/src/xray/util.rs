//! Utilidades do Raio-X: achar programas, rodar comandos com tempo limite e medir pastas.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

pub fn home() -> PathBuf {
    dirs::home_dir().unwrap_or_default()
}

/// Apps abertos pelo Finder/Explorer recebem um PATH mínimo, sem Homebrew, Cargo etc.
/// Então procuramos também nos lugares de sempre.
pub fn which(name: &str) -> Option<PathBuf> {
    let h = home();
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    dirs.extend(
        [
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            "/Applications/Docker.app/Contents/Resources/bin",
            "/Applications/UTM.app/Contents/MacOS",
        ]
        .map(PathBuf::from),
    );
    dirs.extend([".cargo/bin", ".local/bin", ".bun/bin", ".orbstack/bin"].map(|d| h.join(d)));
    let exts: &[&str] = if cfg!(windows) { &[".exe", ".cmd", ".bat"] } else { &[""] };
    dirs.iter().flat_map(|d| exts.iter().map(move |e| d.join(format!("{name}{e}")))).find(|p| p.is_file())
}

/// Roda um programa e devolve o stdout, ou None se não existir, falhar ou demorar demais.
pub fn run(program: &str, args: &[&str], timeout: Duration) -> Option<String> {
    let bin = which(program)?;
    let mut cmd = Command::new(&bin);
    cmd.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    // o próprio programa (npm, brew…) pode precisar achar outros no PATH
    if let Some(dir) = bin.parent() {
        let mut paths = vec![dir.to_path_buf()];
        paths.extend(std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect::<Vec<_>>()).unwrap_or_default());
        if let Ok(joined) = std::env::join_paths(paths) {
            cmd.env("PATH", joined);
        }
    }
    let child = cmd.spawn().ok()?;
    let pid = child.id();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });
    match rx.recv_timeout(timeout) {
        Ok(Ok(out)) if out.status.success() => Some(String::from_utf8_lossy(&out.stdout).into_owned()),
        Ok(_) => None,
        Err(_) => {
            kill_pid(pid);
            None
        }
    }
}

fn kill_pid(pid: u32) {
    let pid = sysinfo::Pid::from_u32(pid);
    let Ok(mut sys) = sysinfo::System::new() else { return };
    sys.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[pid]), true);
    if let Some(p) = sys.process(pid) {
        p.kill();
    }
}

/// Tamanho total de uma pasta (não segue links simbólicos). Usa várias threads nas subpastas.
pub fn dir_size(path: &Path) -> u64 {
    let Ok(meta) = std::fs::symlink_metadata(path) else { return 0 };
    if !meta.is_dir() {
        return meta.len();
    }
    let Ok(entries) = std::fs::read_dir(path) else { return 0 };
    let children: Vec<PathBuf> = entries.filter_map(|e| e.ok().map(|e| e.path())).collect();
    if children.len() > 8 {
        let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(8);
        let chunk = children.len().div_ceil(threads);
        std::thread::scope(|s| {
            children.chunks(chunk).map(|c| s.spawn(move || c.iter().map(|p| walk(p)).sum::<u64>())).collect::<Vec<_>>().into_iter().map(|h| h.join().unwrap_or(0)).sum()
        })
    } else {
        children.iter().map(|p| walk(p)).sum()
    }
}

fn walk(path: &Path) -> u64 {
    let Ok(meta) = std::fs::symlink_metadata(path) else { return 0 };
    if meta.is_dir() {
        std::fs::read_dir(path).map(|rd| rd.filter_map(|e| e.ok()).map(|e| walk(&e.path())).sum()).unwrap_or(0)
    } else {
        meta.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn measures_nested_dirs_without_following_symlinks() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("a/b")).unwrap();
        std::fs::write(d.path().join("a/b/x"), vec![0u8; 1000]).unwrap();
        for i in 0..12 {
            std::fs::write(d.path().join(format!("f{i}")), vec![0u8; 10]).unwrap();
        }
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("big"), vec![0u8; 50_000]).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(outside.path(), d.path().join("link")).unwrap();
        assert_eq!(dir_size(d.path()), 1000 + 120 + if cfg!(unix) { std::fs::symlink_metadata(d.path().join("link")).unwrap().len() } else { 0 });
    }

    #[test]
    fn run_returns_none_for_missing_program() {
        assert!(run("programa-que-nao-existe-veocode", &[], Duration::from_secs(1)).is_none());
    }
}
