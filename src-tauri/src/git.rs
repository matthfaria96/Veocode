//! Git e GitHub de cada projeto, só leitura: branch, o que falta enviar ou baixar, arquivos
//! mudados, commits, branches, stash e, com o GitHub CLI (`gh`) logado, PRs, CI e o repositório.
//! A única ação é "buscar" (`git fetch`), que atualiza o que se sabe do remoto sem mexer nos
//! arquivos nem nos branches da pessoa. Commit, push e pull ficam com ela (ou com a IA, pelo
//! nível de acesso).

use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

// ---------------------------------------------------------------- tipos

#[derive(Serialize, Default, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub path: String,
    /// caminho antigo, quando foi renomeado
    pub from: Option<String>,
    /// letra no índice (pronto para commit): M, A, D, R, C, T ou "."
    pub index: String,
    /// letra na pasta (ainda não preparado): M, D, T ou "."
    pub work: String,
    pub untracked: bool,
    pub conflict: bool,
}

#[derive(Serialize, Default, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub hash: String,
    pub short: String,
    pub author: String,
    pub time: i64,
    pub subject: String,
    /// branches e tags que apontam para ele
    pub refs: Vec<String>,
    /// já está no remoto (no upstream, ou em algum remoto quando não há upstream)
    pub pushed: bool,
    /// hashes dos pais (para desenhar as linhas dos branches)
    pub parents: Vec<String>,
}

/// Um arquivo mudado num commit.
#[derive(Serialize, Default, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CommitFile {
    pub path: String,
    pub from: Option<String>,
    /// A, M, D, R…
    pub status: String,
    pub added: Option<u32>,
    pub removed: Option<u32>,
}

#[derive(Serialize, Default, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    pub name: String,
    pub current: bool,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    /// o branch do remoto foi apagado
    pub gone: bool,
    pub time: i64,
    pub subject: String,
}

#[derive(Serialize, Default, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Remote {
    pub name: String,
    /// endereço sem usuário/senha/token
    pub url: String,
    /// "dono/repo", quando é do GitHub
    pub github: Option<String>,
    /// página do repositório no navegador (GitHub, GitLab, Bitbucket)
    pub web: Option<String>,
}

#[derive(Serialize, Default, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Stash {
    pub message: String,
    pub time: i64,
}

#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// a pasta está num repositório git
    pub repo: bool,
    /// raiz do repositório, quando o projeto é uma subpasta dele
    pub top: Option<String>,
    /// a subpasta do projeto dentro do repositório ("" na raiz; termina com /)
    pub prefix: String,
    pub branch: Option<String>,
    pub detached: bool,
    /// hash curto do commit atual
    pub head: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub changes: Vec<Change>,
    /// mudanças além das 400 mostradas
    pub more_changes: usize,
    pub commits: Vec<Commit>,
    /// commits do upstream que ainda não estão aqui (para baixar)
    pub incoming: Vec<Commit>,
    /// todos os branches (locais e do remoto), do mais novo ao mais antigo, para o desenho
    pub graph: Vec<Commit>,
    pub branches: Vec<Branch>,
    pub stashes: Vec<Stash>,
    pub remotes: Vec<Remote>,
    /// última vez que buscou o remoto (segundos desde 1970)
    pub fetched_at: Option<i64>,
    /// merge, rebase, cherry-pick… no meio do caminho
    pub operation: Option<String>,
    /// repositório sem nenhum commit ainda
    pub empty: bool,
}

#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub repo: bool,
    pub branch: Option<String>,
    pub upstream: bool,
    pub ahead: u32,
    pub behind: u32,
    pub changed: u32,
    pub conflicts: u32,
}

// ---------------------------------------------------------------- rodar o git

fn git_bin() -> Result<PathBuf, String> {
    crate::xray::util::which("git").ok_or_else(|| "O git não está instalado neste computador.".into())
}

fn command(bin: &Path, root: &Path, args: &[&str]) -> Command {
    let mut c = Command::new(bin);
    c.arg("-C").arg(root).args(args);
    // sem travar o índice (o status não briga com o git da pessoa), sem pedir senha, em inglês
    // para as mensagens que o código lê
    c.env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_ASKPASS", "")
        .env("SSH_ASKPASS", "")
        .env("LC_ALL", "C")
        .env("GH_PROMPT_DISABLED", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // sem janela de console
    }
    c
}

/// Roda e devolve (sucesso, stdout, stderr), parando no tempo limite.
fn run_cmd(mut c: Command, limit: Duration) -> Result<(bool, String, String), String> {
    let child = c.spawn().map_err(|e| e.to_string())?;
    let (tx, rx) = std::sync::mpsc::channel();
    let id = child.id();
    std::thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });
    match rx.recv_timeout(limit) {
        Ok(Ok(o)) => Ok((o.status.success(), String::from_utf8_lossy(&o.stdout).into_owned(), String::from_utf8_lossy(&o.stderr).into_owned())),
        Ok(Err(e)) => Err(e.to_string()),
        Err(_) => {
            kill(id);
            Err("demorou demais".into())
        }
    }
}

fn kill(pid: u32) {
    #[cfg(unix)]
    let _ = Command::new("kill").arg("-9").arg(pid.to_string()).status();
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill").args(["/F", "/PID", &pid.to_string()]).creation_flags(0x0800_0000).status();
    }
}

struct Git {
    bin: PathBuf,
    root: PathBuf,
}

impl Git {
    fn out(&self, args: &[&str]) -> Option<String> {
        match run_cmd(command(&self.bin, &self.root, args), Duration::from_secs(15)) {
            Ok((true, o, _)) => Some(o),
            _ => None,
        }
    }
}

// ---------------------------------------------------------------- leitura

/// Tudo o que a aba Git mostra.
pub fn status(root: &Path) -> Result<Status, String> {
    let g = Git { bin: git_bin()?, root: root.to_path_buf() };
    let Some(top) = g.out(&["rev-parse", "--show-toplevel"]) else {
        return Ok(Status::default());
    };
    let top = PathBuf::from(top.trim());
    let mut s = Status { repo: true, ..Default::default() };
    if !same_dir(&top, root) {
        s.top = Some(top.to_string_lossy().into_owned());
        s.prefix = g.out(&["rev-parse", "--show-prefix"]).unwrap_or_default().trim().to_string();
    }

    let raw = g.out(&["status", "--porcelain=v2", "--branch", "-z"]).unwrap_or_default();
    let p = parse_status(&raw);
    s.branch = p.branch;
    s.detached = p.detached;
    s.head = p.oid.filter(|o| o != "(initial)").map(|o| o.chars().take(7).collect());
    s.empty = s.head.is_none();
    s.upstream = p.upstream;
    s.ahead = p.ahead;
    s.behind = p.behind;
    s.more_changes = p.changes.len().saturating_sub(400);
    s.changes = p.changes.into_iter().take(400).collect();

    s.remotes = parse_remotes(&g.out(&["remote", "-v"]).unwrap_or_default());

    if !s.empty {
        // o que ainda não está no remoto
        let unpushed: HashSet<String> = if s.upstream.is_some() {
            lines(g.out(&["rev-list", "--max-count=200", "@{u}..HEAD"]))
        } else if !s.remotes.is_empty() {
            lines(g.out(&["rev-list", "--max-count=200", "HEAD", "--not", "--remotes"]))
        } else {
            HashSet::new()
        };
        let has_remote = s.upstream.is_some() || !s.remotes.is_empty();
        s.commits = parse_log(&g.out(&["log", "-n", "40", LOG_FORMAT, "HEAD"]).unwrap_or_default());
        for c in &mut s.commits {
            c.pushed = has_remote && !unpushed.contains(&c.hash);
        }
        // desenho: todos os branches; "só aqui" = em nenhum remoto
        let local_only: HashSet<String> = if s.remotes.is_empty() { HashSet::new() } else { lines(g.out(&["rev-list", "--max-count=400", "--branches", "HEAD", "--not", "--remotes"])) };
        s.graph = parse_log(&g.out(&["log", "-n", "80", "--topo-order", LOG_FORMAT, "HEAD", "--branches", "--remotes", "--tags"]).unwrap_or_default());
        for c in &mut s.graph {
            c.pushed = !s.remotes.is_empty() && !local_only.contains(&c.hash);
        }
        if s.upstream.is_some() && s.behind > 0 {
            s.incoming = parse_log(&g.out(&["log", "-n", "20", LOG_FORMAT, "HEAD..@{u}"]).unwrap_or_default());
            for c in &mut s.incoming {
                c.pushed = true;
            }
        }
    }

    s.branches = parse_branches(
        &g.out(&["for-each-ref", "refs/heads", "--sort=-committerdate", "--count=30", "--format=%(HEAD)%1f%(refname:short)%1f%(upstream:short)%1f%(upstream:track,nobracket)%1f%(committerdate:unix)%1f%(contents:subject)%1e"])
            .unwrap_or_default(),
    );
    s.stashes = g
        .out(&["stash", "list", "--format=%gs%x1f%ct"])
        .unwrap_or_default()
        .lines()
        .filter_map(|l| {
            let (m, t) = l.split_once('\u{1f}')?;
            Some(Stash { message: m.to_string(), time: t.trim().parse().unwrap_or(0) })
        })
        .collect();

    if let Some(gd) = g.out(&["rev-parse", "--absolute-git-dir"]) {
        let gd = PathBuf::from(gd.trim());
        s.fetched_at = std::fs::metadata(gd.join("FETCH_HEAD")).and_then(|m| m.modified()).ok().map(secs);
        s.operation = operation(&gd);
    }
    Ok(s)
}

/// Versão leve para o Mapa e a barra lateral: um `git status` só.
pub fn summary(root: &Path) -> Summary {
    let Ok(bin) = git_bin() else { return Summary::default() };
    let g = Git { bin, root: root.to_path_buf() };
    let Some(raw) = g.out(&["status", "--porcelain=v2", "--branch", "-z"]) else {
        return Summary::default();
    };
    let p = parse_status(&raw);
    Summary {
        repo: true,
        branch: p.branch,
        upstream: p.upstream.is_some(),
        ahead: p.ahead,
        behind: p.behind,
        changed: p.changes.len() as u32,
        conflicts: p.changes.iter().filter(|c| c.conflict).count() as u32,
    }
}

/// `git fetch --all --prune`: só atualiza o que se sabe dos remotos.
pub fn fetch(root: &Path) -> Result<(), String> {
    let bin = git_bin()?;
    let c = command(&bin, root, &["fetch", "--all", "--prune", "--quiet"]);
    match run_cmd(c, Duration::from_secs(90)) {
        Ok((true, _, _)) => Ok(()),
        Ok((false, _, err)) => Err(fetch_error(&err)),
        Err(e) => Err(format!("Não deu para buscar: {e}.")),
    }
}

fn fetch_error(err: &str) -> String {
    let e = err.to_lowercase();
    if e.contains("authentication") || e.contains("could not read username") || e.contains("permission denied") || e.contains("terminal prompts disabled") {
        "O remoto pediu login. Entre pelo Terminal (por exemplo `gh auth login` ou com a sua chave SSH) e busque de novo.".into()
    } else if e.contains("could not resolve host") || e.contains("network") || e.contains("timed out") {
        "Sem conexão com o remoto agora.".into()
    } else if e.contains("does not appear to be a git repository") || e.contains("not found") {
        "O remoto não foi encontrado (o endereço mudou ou o repositório foi apagado?).".into()
    } else {
        let first = err.lines().find(|l| !l.trim().is_empty()).unwrap_or("erro desconhecido");
        format!("O git não conseguiu buscar: {}", first.trim().trim_start_matches("fatal: "))
    }
}

const LOG_FORMAT: &str = "--format=%H%x1f%h%x1f%an%x1f%at%x1f%s%x1f%D%x1f%P%x1e";

/// Arquivos que um commit mudou, com linhas adicionadas/removidas.
pub fn commit_files(root: &Path, hash: &str) -> Result<Vec<CommitFile>, String> {
    if !hash.chars().all(|c| c.is_ascii_hexdigit()) || hash.is_empty() {
        return Err("commit inválido".into());
    }
    let g = Git { bin: git_bin()?, root: root.to_path_buf() };
    let names = g.out(&["show", "--format=", "--name-status", "-M", "-z", "--first-parent", hash]).ok_or("o git não achou esse commit")?;
    let nums = g.out(&["show", "--format=", "--numstat", "-M", "--first-parent", hash]).unwrap_or_default();
    Ok(parse_commit_files(&names, &nums))
}

fn parse_commit_files(names: &str, nums: &str) -> Vec<CommitFile> {
    let mut out = Vec::new();
    let mut it = names.split('\0').filter(|s| !s.is_empty());
    while let Some(st) = it.next() {
        let st = st.trim_start_matches('\n');
        let letter: String = st.chars().take(1).collect();
        if letter == "R" || letter == "C" {
            let from = it.next().map(str::to_string);
            let path = it.next().unwrap_or_default().to_string();
            out.push(CommitFile { path, from, status: letter, ..Default::default() });
        } else if let Some(p) = it.next() {
            out.push(CommitFile { path: p.to_string(), status: letter, ..Default::default() });
        }
    }
    for l in nums.lines() {
        let f: Vec<&str> = l.splitn(3, '\t').collect();
        if f.len() < 3 {
            continue;
        }
        // renomeado aparece como "a => b" ou "dir/{a => b}"
        let p = f[2];
        let target = if let (Some(i), Some(j)) = (p.find('{'), p.find('}')) {
            let inner = &p[i + 1..j];
            let to = inner.split(" => ").nth(1).unwrap_or(inner);
            format!("{}{}{}", &p[..i], to, &p[j + 1..]).replace("//", "/")
        } else {
            p.split(" => ").last().unwrap_or(p).to_string()
        };
        if let Some(cf) = out.iter_mut().find(|c| c.path == target) {
            cf.added = f[0].parse().ok();
            cf.removed = f[1].parse().ok();
        }
    }
    out
}

/// O diff de um arquivo num commit (cortado em 200 KB).
pub fn commit_diff(root: &Path, hash: &str, path: &str) -> Result<String, String> {
    if !hash.chars().all(|c| c.is_ascii_hexdigit()) || hash.is_empty() {
        return Err("commit inválido".into());
    }
    let g = Git { bin: git_bin()?, root: root.to_path_buf() };
    let mut d = g.out(&["show", "--format=", "-M", "--first-parent", "--no-color", hash, "--", path]).ok_or("o git não mostrou esse arquivo")?;
    if d.len() > 200_000 {
        let mut cut = 200_000;
        while !d.is_char_boundary(cut) {
            cut -= 1;
        }
        d.truncate(cut);
        d.push_str("\n… (diff muito grande, cortado aqui)");
    }
    Ok(d)
}

fn lines(o: Option<String>) -> HashSet<String> {
    o.unwrap_or_default().lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect()
}

fn same_dir(a: &Path, b: &Path) -> bool {
    let c = |p: &Path| p.canonicalize().unwrap_or_else(|_| p.to_path_buf());
    c(a) == c(b)
}

fn secs(t: SystemTime) -> i64 {
    t.duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn operation(gd: &Path) -> Option<String> {
    let has = |n: &str| gd.join(n).exists();
    Some(
        if has("rebase-merge") || has("rebase-apply") {
            "rebase"
        } else if has("MERGE_HEAD") {
            "merge"
        } else if has("CHERRY_PICK_HEAD") {
            "cherry-pick"
        } else if has("REVERT_HEAD") {
            "revert"
        } else if has("BISECT_LOG") {
            "bisect"
        } else {
            return None;
        }
        .into(),
    )
}

// ---------------------------------------------------------------- formatos do git

#[derive(Default, Debug)]
struct Parsed {
    oid: Option<String>,
    branch: Option<String>,
    detached: bool,
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
    changes: Vec<Change>,
}

/// `git status --porcelain=v2 --branch -z`
fn parse_status(raw: &str) -> Parsed {
    let mut p = Parsed::default();
    let mut parts = raw.split('\0');
    while let Some(e) = parts.next() {
        if e.is_empty() {
            continue;
        }
        if let Some(h) = e.strip_prefix("# ") {
            let (k, v) = h.split_once(' ').unwrap_or((h, ""));
            match k {
                "branch.oid" => p.oid = Some(v.to_string()),
                "branch.head" => {
                    if v == "(detached)" {
                        p.detached = true;
                    } else {
                        p.branch = Some(v.to_string());
                    }
                }
                "branch.upstream" => p.upstream = Some(v.to_string()),
                "branch.ab" => {
                    for n in v.split(' ') {
                        if let Some(a) = n.strip_prefix('+') {
                            p.ahead = a.parse().unwrap_or(0);
                        } else if let Some(b) = n.strip_prefix('-') {
                            p.behind = b.parse().unwrap_or(0);
                        }
                    }
                }
                _ => {}
            }
            continue;
        }
        let kind = e.as_bytes()[0];
        match kind {
            b'?' => p.changes.push(Change { path: e[2..].to_string(), index: "?".into(), work: "?".into(), untracked: true, ..Default::default() }),
            b'1' | b'2' | b'u' => {
                // campos antes do caminho: 1 → 8, 2 → 9, u → 10
                let n = match kind {
                    b'1' => 8,
                    b'2' => 9,
                    _ => 10,
                };
                let f: Vec<&str> = e.splitn(n + 1, ' ').collect();
                if f.len() < n + 1 {
                    continue;
                }
                let xy = f[1].as_bytes();
                let from = if kind == b'2' { parts.next().map(str::to_string) } else { None };
                p.changes.push(Change {
                    path: f[n].to_string(),
                    from,
                    index: (xy[0] as char).to_string(),
                    work: (xy[1] as char).to_string(),
                    untracked: false,
                    conflict: kind == b'u',
                });
            }
            _ => {}
        }
    }
    p
}

fn parse_log(raw: &str) -> Vec<Commit> {
    raw.split('\u{1e}')
        .filter_map(|r| {
            let f: Vec<&str> = r.trim_start_matches('\n').split('\u{1f}').collect();
            if f.len() < 6 || f[0].is_empty() {
                return None;
            }
            Some(Commit {
                hash: f[0].to_string(),
                short: f[1].to_string(),
                author: f[2].to_string(),
                time: f[3].parse().unwrap_or(0),
                subject: f[4].to_string(),
                refs: f[5].split(", ").map(|r| r.trim().trim_start_matches("HEAD -> ").to_string()).filter(|r| !r.is_empty() && r != "HEAD").collect(),
                pushed: false,
                parents: f.get(6).map(|p| p.split_whitespace().map(str::to_string).collect()).unwrap_or_default(),
            })
        })
        .collect()
}

fn parse_branches(raw: &str) -> Vec<Branch> {
    raw.split('\u{1e}')
        .filter_map(|r| {
            let f: Vec<&str> = r.trim_start_matches('\n').split('\u{1f}').collect();
            if f.len() < 6 || f[1].is_empty() {
                return None;
            }
            let track = f[3];
            let num = |key: &str| {
                track.split(", ").find_map(|t| t.strip_prefix(key)).and_then(|n| n.trim().parse().ok()).unwrap_or(0)
            };
            Some(Branch {
                current: f[0] == "*",
                name: f[1].to_string(),
                upstream: Some(f[2].to_string()).filter(|u| !u.is_empty()),
                ahead: num("ahead "),
                behind: num("behind "),
                gone: track == "gone",
                time: f[4].parse().unwrap_or(0),
                subject: f[5].trim().to_string(),
            })
        })
        .collect()
}

fn parse_remotes(raw: &str) -> Vec<Remote> {
    let mut out: Vec<Remote> = Vec::new();
    for l in raw.lines() {
        let mut it = l.split_whitespace();
        let (Some(name), Some(url)) = (it.next(), it.next()) else { continue };
        if out.iter().any(|r| r.name == name) {
            continue;
        }
        let url = strip_credentials(url);
        let (github, web) = web_of(&url);
        out.push(Remote { name: name.to_string(), url, github, web });
    }
    out
}

/// `https://usuario:token@github.com/a/b` → `https://github.com/a/b` (nunca mostra tokens).
fn strip_credentials(url: &str) -> String {
    if let Some((scheme, rest)) = url.split_once("://")
        && let Some((auth, host)) = rest.split_once('@')
        && !auth.contains('/')
    {
        // ssh://git@host mantém o usuário (não é segredo); http(s) perde tudo
        return if scheme.starts_with("http") { format!("{scheme}://{host}") } else { format!("{scheme}://{}@{host}", auth.split(':').next().unwrap_or("")) };
    }
    url.to_string()
}

/// Dono/repo do GitHub e o endereço da página, a partir do endereço do remoto.
fn web_of(url: &str) -> (Option<String>, Option<String>) {
    let u = url.trim_end_matches('/').trim_end_matches(".git");
    // git@host:dono/repo  |  ssh://git@host/dono/repo  |  https://host/dono/repo
    let (host, path) = if let Some(rest) = u.split_once("://").map(|x| x.1) {
        let rest = rest.split_once('@').map(|x| x.1).unwrap_or(rest);
        match rest.split_once('/') {
            Some((h, p)) => (h.split(':').next().unwrap_or(h), p),
            None => return (None, None),
        }
    } else if let Some((left, p)) = u.split_once(':') {
        (left.split_once('@').map(|x| x.1).unwrap_or(left), p)
    } else {
        return (None, None);
    };
    let path = path.trim_start_matches('/');
    if path.split('/').filter(|s| !s.is_empty()).count() < 2 {
        return (None, None);
    }
    let known = ["github.com", "gitlab.com", "bitbucket.org", "codeberg.org"];
    let web = known.contains(&host).then(|| format!("https://{host}/{path}"));
    let gh = (host == "github.com").then(|| path.split('/').take(2).collect::<Vec<_>>().join("/"));
    (gh, web)
}

// ---------------------------------------------------------------- GitHub (gh)

#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitHub {
    /// "ok", "noRemote" (não é do GitHub), "noGh" (sem o GitHub CLI), "noLogin", "error"
    pub state: String,
    pub repo: Option<String>,
    pub message: Option<String>,
    /// dados do `gh` como vieram (repo, PRs, execuções do CI)
    pub info: Option<serde_json::Value>,
    pub prs: Vec<serde_json::Value>,
    pub runs: Vec<serde_json::Value>,
}

fn gh_cmd(bin: &Path, cwd: &Path, args: &[&str]) -> Command {
    let mut c = Command::new(bin);
    c.args(args)
        .current_dir(cwd)
        .env("GH_PROMPT_DISABLED", "1")
        .env("GH_NO_UPDATE_NOTIFIER", "1")
        .env("NO_COLOR", "1")
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // o gh chama o git: precisa achá-lo mesmo com o PATH mínimo dos apps
    if let Ok(git) = git_bin()
        && let Some(d) = git.parent()
    {
        let mut paths = vec![d.to_path_buf()];
        if let Some(p) = std::env::var_os("PATH") {
            paths.extend(std::env::split_paths(&p));
        }
        if let Ok(joined) = std::env::join_paths(paths) {
            c.env("PATH", joined);
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);
    }
    c
}

fn gh_json(bin: &Path, cwd: &Path, args: &[&str]) -> Result<serde_json::Value, String> {
    match run_cmd(gh_cmd(bin, cwd, args), Duration::from_secs(25))? {
        (true, o, _) => serde_json::from_str(&o).map_err(|e| e.to_string()),
        (false, _, err) => Err(err.lines().find(|l| !l.trim().is_empty()).unwrap_or("o gh falhou").trim().to_string()),
    }
}

/// O repositório no GitHub, os PRs abertos e as últimas execuções do CI.
pub fn github(root: &Path, branch: Option<&str>) -> Result<GitHub, String> {
    let bin = git_bin()?;
    let g = Git { bin, root: root.to_path_buf() };
    let remotes = parse_remotes(&g.out(&["remote", "-v"]).unwrap_or_default());
    // o remoto do upstream primeiro, depois origin, depois qualquer um do GitHub
    let up_remote = g.out(&["rev-parse", "--abbrev-ref", "@{u}"]).and_then(|u| u.trim().split_once('/').map(|x| x.0.to_string()));
    let pick = up_remote
        .and_then(|n| remotes.iter().find(|r| r.name == n && r.github.is_some()))
        .or_else(|| remotes.iter().find(|r| r.name == "origin" && r.github.is_some()))
        .or_else(|| remotes.iter().find(|r| r.github.is_some()));
    let Some(repo) = pick.and_then(|r| r.github.clone()) else {
        return Ok(GitHub { state: "noRemote".into(), ..Default::default() });
    };
    let Some(gh) = crate::xray::util::which("gh") else {
        return Ok(GitHub { state: "noGh".into(), repo: Some(repo), ..Default::default() });
    };
    let cwd = root.to_path_buf();
    let r = repo.clone();
    let b = branch.map(str::to_string);
    let (gh1, gh2, gh3) = (gh.clone(), gh.clone(), gh.clone());
    let (c1, c2, c3) = (cwd.clone(), cwd.clone(), cwd);
    let (r1, r2, r3) = (r.clone(), r.clone(), r);
    // três consultas ao mesmo tempo
    let info = std::thread::spawn(move || {
        gh_json(&gh1, &c1, &["repo", "view", &r1, "--json", "nameWithOwner,url,description,visibility,isFork,isArchived,stargazerCount,forkCount,defaultBranchRef,pushedAt,latestRelease,issues,pullRequests,viewerPermission"])
    });
    let prs = std::thread::spawn(move || {
        gh_json(&gh2, &c2, &["pr", "list", "-R", &r2, "--state", "open", "--limit", "20", "--json", "number,title,author,headRefName,baseRefName,isDraft,url,updatedAt,reviewDecision,statusCheckRollup"])
    });
    let runs = std::thread::spawn(move || {
        let mut a = vec!["run", "list", "-R", &r3, "--limit", "8", "--json", "databaseId,name,displayTitle,status,conclusion,headBranch,headSha,event,createdAt,url"];
        let bb;
        if let Some(x) = &b {
            bb = x.clone();
            a.extend(["--branch", bb.as_str()]);
        }
        gh_json(&gh3, &c3, &a)
    });
    let info = info.join().map_err(|_| "falhou")?;
    let prs = prs.join().map_err(|_| "falhou")?;
    let runs = runs.join().map_err(|_| "falhou")?;

    let info = match info {
        Ok(v) => v,
        Err(e) => {
            let low = e.to_lowercase();
            let state = if low.contains("gh auth login") || low.contains("not logged") || low.contains("authentication") { "noLogin" } else { "error" };
            let msg = if state == "noLogin" { None } else { Some(gh_error(&e)) };
            return Ok(GitHub { state: state.into(), repo: Some(repo), message: msg, ..Default::default() });
        }
    };
    let arr = |v: Result<serde_json::Value, String>| v.ok().and_then(|v| v.as_array().cloned()).unwrap_or_default();
    Ok(GitHub { state: "ok".into(), repo: Some(repo), message: None, info: Some(slim_info(info)), prs: arr(prs).into_iter().map(slim_pr).collect(), runs: arr(runs) })
}

fn gh_error(e: &str) -> String {
    let l = e.to_lowercase();
    if l.contains("could not resolve to a repository") || l.contains("not found") {
        "O GitHub não achou este repositório (é privado de outra conta ou foi apagado?).".into()
    } else if l.contains("could not resolve host") || l.contains("network") || l.contains("timeout") || l.contains("demorou") {
        "Sem conexão com o GitHub agora.".into()
    } else {
        format!("O GitHub CLI respondeu: {e}")
    }
}

/// Só o que a tela usa, com issues e PRs como números.
fn slim_info(mut v: serde_json::Value) -> serde_json::Value {
    for k in ["issues", "pullRequests"] {
        let n = v.get(k).and_then(|x| x.get("totalCount")).cloned();
        if let Some(n) = n {
            v[k] = n;
        }
    }
    v
}

/// Os checks de um PR resumidos: quantos passaram, falharam e estão rodando.
fn slim_pr(mut pr: serde_json::Value) -> serde_json::Value {
    let (mut ok, mut fail, mut run) = (0, 0, 0);
    if let Some(list) = pr.get("statusCheckRollup").and_then(|x| x.as_array()) {
        for c in list {
            let s = |k: &str| c.get(k).and_then(|x| x.as_str()).unwrap_or("").to_uppercase();
            let (status, concl, state) = (s("status"), s("conclusion"), s("state"));
            if state == "SUCCESS" || concl == "SUCCESS" || concl == "NEUTRAL" || concl == "SKIPPED" {
                ok += 1;
            } else if ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"].contains(&concl.as_str()) || state == "FAILURE" || state == "ERROR" {
                fail += 1;
            } else if !status.is_empty() || state == "PENDING" || state == "EXPECTED" {
                run += 1;
            }
        }
    }
    if let Some(o) = pr.as_object_mut() {
        o.remove("statusCheckRollup");
        o.insert("checks".into(), serde_json::json!({ "ok": ok, "fail": fail, "running": run }));
    }
    pr
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_porcelain_v2() {
        let raw = "# branch.oid 1234567890abcdef\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -1\0\
1 .M N... 100644 100644 100644 aaa bbb src/a.ts\0\
1 A. N... 000000 100644 100644 000 ccc novo arquivo.txt\0\
2 R. N... 100644 100644 100644 ddd eee R100 b.rs\0velho.rs\0\
u UU N... 100644 100644 100644 100644 f1 f2 f3 conflito.md\0\
? solto.log\0";
        let p = parse_status(raw);
        assert_eq!(p.branch.as_deref(), Some("main"));
        assert_eq!(p.upstream.as_deref(), Some("origin/main"));
        assert_eq!((p.ahead, p.behind), (2, 1));
        assert_eq!(p.changes.len(), 5);
        assert_eq!(p.changes[0], Change { path: "src/a.ts".into(), from: None, index: ".".into(), work: "M".into(), untracked: false, conflict: false });
        assert_eq!(p.changes[1].path, "novo arquivo.txt");
        assert_eq!(p.changes[1].index, "A");
        assert_eq!(p.changes[2].path, "b.rs");
        assert_eq!(p.changes[2].from.as_deref(), Some("velho.rs"));
        assert!(p.changes[3].conflict);
        assert!(p.changes[4].untracked);

        let d = parse_status("# branch.oid (initial)\0# branch.head (detached)\0");
        assert!(d.detached);
        assert!(d.branch.is_none());
    }

    #[test]
    fn remotes_never_show_tokens_and_find_github() {
        let r = parse_remotes(
            "origin\thttps://eu:ghp_SEGREDO@github.com/dono/repo.git (fetch)\norigin\thttps://eu:ghp_SEGREDO@github.com/dono/repo.git (push)\n\
up\tgit@github.com:outro/coisa.git (fetch)\nlab\tssh://git@gitlab.com/g/p.git (fetch)\nlocal\t/tmp/x (fetch)\n",
        );
        assert_eq!(r.len(), 4);
        assert_eq!(r[0].url, "https://github.com/dono/repo.git");
        assert!(!r.iter().any(|x| x.url.contains("SEGREDO")));
        assert_eq!(r[0].github.as_deref(), Some("dono/repo"));
        assert_eq!(r[0].web.as_deref(), Some("https://github.com/dono/repo"));
        assert_eq!(r[1].github.as_deref(), Some("outro/coisa"));
        assert_eq!(r[2].github, None);
        assert_eq!(r[2].web.as_deref(), Some("https://gitlab.com/g/p"));
        assert_eq!(r[3].web, None);
    }

    #[test]
    fn reads_branches_and_log() {
        let b = parse_branches("*\u{1f}main\u{1f}origin/main\u{1f}ahead 1, behind 3\u{1f}1700000000\u{1f}fix\u{1e}\n \u{1f}velho\u{1f}origin/velho\u{1f}gone\u{1f}1600000000\u{1f}x\u{1e}\n");
        assert_eq!(b.len(), 2);
        assert!(b[0].current);
        assert_eq!((b[0].ahead, b[0].behind), (1, 3));
        assert!(b[1].gone);
        let l = parse_log("abc\u{1f}ab\u{1f}Ana\u{1f}1700000000\u{1f}Primeiro\u{1f}HEAD -> main, origin/main, tag: v1\u{1e}\n");
        assert_eq!(l[0].refs, vec!["main", "origin/main", "tag: v1"]);
        let m = parse_log("abc\u{1f}ab\u{1f}Ana\u{1f}1\u{1f}Merge\u{1f}\u{1f}p1 p2\u{1e}\n");
        assert_eq!(m[0].parents, vec!["p1", "p2"]);
        let files = parse_commit_files("M\0src/a.rs\0R100\0old.txt\0new.txt\0A\0b.md\0", "3\t1\tsrc/a.rs\n0\t0\t{old.txt => new.txt}\n-\t-\tb.md\n");
        assert_eq!(files.len(), 3);
        assert_eq!((files[0].added, files[0].removed), (Some(3), Some(1)));
        assert_eq!(files[1].from.as_deref(), Some("old.txt"));
        assert_eq!(files[1].added, Some(0));
        assert_eq!(files[2].added, None, "binário não tem contagem");
    }

    /// Repositório de verdade: um remoto local, um commit enviado e um não.
    #[test]
    fn real_repo_knows_what_was_pushed() {
        if git_bin().is_err() {
            return;
        }
        let d = tempfile::tempdir().unwrap();
        let remote = d.path().join("remoto.git");
        let work = d.path().join("trabalho");
        std::fs::create_dir_all(&work).unwrap();
        let g = |dir: &Path, args: &[&str]| {
            let ok = Command::new("git").arg("-C").arg(dir).args(args).env("GIT_AUTHOR_NAME", "T").env("GIT_AUTHOR_EMAIL", "t@t").env("GIT_COMMITTER_NAME", "T").env("GIT_COMMITTER_EMAIL", "t@t").output().unwrap();
            assert!(ok.status.success(), "{args:?}: {}", String::from_utf8_lossy(&ok.stderr));
        };
        g(d.path(), &["init", "-q", "--bare", "remoto.git"]);
        g(&work, &["init", "-q", "-b", "main"]);
        std::fs::write(work.join("a.txt"), "1").unwrap();
        g(&work, &["add", "."]);
        g(&work, &["commit", "-q", "-m", "primeiro"]);
        g(&work, &["remote", "add", "origin", remote.to_str().unwrap()]);
        g(&work, &["push", "-q", "-u", "origin", "main"]);
        std::fs::write(work.join("a.txt"), "2").unwrap();
        g(&work, &["commit", "-q", "-am", "segundo"]);
        std::fs::write(work.join("b.txt"), "novo").unwrap();

        let s = status(&work).unwrap();
        assert!(s.repo);
        assert_eq!(s.branch.as_deref(), Some("main"));
        assert_eq!(s.upstream.as_deref(), Some("origin/main"));
        assert_eq!((s.ahead, s.behind), (1, 0));
        assert_eq!(s.commits.len(), 2);
        assert!(!s.commits[0].pushed, "segundo ainda não foi enviado");
        assert!(s.commits[1].pushed);
        assert_eq!(s.changes.len(), 1);
        assert!(s.changes[0].untracked);
        assert_eq!(s.branches.len(), 1);
        assert!(fetch(&work).is_ok());
        assert!(status(&work).unwrap().fetched_at.is_some());

        let sum = summary(&work);
        assert_eq!((sum.ahead, sum.changed), (1, 1));
        assert!(!status(d.path()).unwrap().repo);
    }
}

#[cfg(test)]
mod live {
    /// `VEOCODE_GIT_DIR=/caminho cargo test git::live -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn print_a_real_project() {
        let dir = std::path::PathBuf::from(std::env::var("VEOCODE_GIT_DIR").unwrap());
        let s = super::status(&dir).unwrap();
        println!("branch={:?} up={:?} +{} -{} mudanças={} commits={} branches={} remotos={:?} fetch={:?}", s.branch, s.upstream, s.ahead, s.behind, s.changes.len(), s.commits.len(), s.branches.len(), s.remotes.iter().map(|r| (&r.name, &r.github)).collect::<Vec<_>>(), s.fetched_at);
        let g = super::github(&dir, s.branch.as_deref()).unwrap();
        println!("gh state={} repo={:?} msg={:?}", g.state, g.repo, g.message);
        if let Some(i) = &g.info {
            println!("info: vis={} issues={} prs={} default={}", i["visibility"], i["issues"], i["pullRequests"], i["defaultBranchRef"]);
        }
        println!("prs={} runs={}", g.prs.len(), g.runs.len());
        if let Some(r) = g.runs.first() {
            println!("run: {} {} {}", r["name"], r["status"], r["conclusion"]);
        }
    }
}
