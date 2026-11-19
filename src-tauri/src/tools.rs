//! Ferramentas que o Veocode dá às contas por API (DeepSeek, OpenAI-compatível, Ollama):
//! listar, ler, buscar, escrever e editar arquivos do projeto e rodar comandos.
//!
//! O nível de acesso decide cada chamada, com as mesmas regras que vão para o Claude Code
//! (access.rs): Permitido roda, Pergunta espera a pessoa e Bloqueado nem roda.
//! Arquivos ficam sempre dentro da pasta do projeto.

use crate::access::{effective, Rule};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

/// Texto devolvido ao modelo por ferramenta (o resto é cortado).
const MAX_RESULT: usize = 20_000;
const MAX_READ_LINES: usize = 2000;
const MAX_MATCHES: usize = 80;
const COMMAND_TIMEOUT: Duration = Duration::from_secs(120);

/// Definições no formato de "tools" da OpenAI (o Ollama aceita o mesmo formato).
pub fn specs() -> Value {
    let f = |name: &str, desc: &str, props: Value, req: &[&str]| {
        json!({"type":"function","function":{"name":name,"description":desc,"parameters":{"type":"object","properties":props,"required":req}}})
    };
    let path = json!({"type":"string","description":crate::i18n::tr("caminho relativo à raiz do projeto, com /", "path relative to the project root, with /")});
    json!([
        f("list_files", crate::i18n::tr("Lista uma pasta do projeto (pastas terminam com /).", "Lists a project folder (folders end with /)."), json!({"path": {"type":"string","description":crate::i18n::tr("pasta relativa à raiz; vazio = raiz", "folder relative to the root; empty = root")}}), &[]),
        f("read_file", crate::i18n::tr("Lê um arquivo de texto do projeto. Linhas numeradas a partir de 1.", "Reads a text file from the project. Lines numbered from 1."), json!({"path": path, "start_line": {"type":"integer"}, "max_lines": {"type":"integer"}}), &["path"]),
        f("search", crate::i18n::tr("Busca um texto (sem diferenciar maiúsculas) nos arquivos do projeto, respeitando o .gitignore.", "Searches for text (case-insensitive) in the project's files, respecting .gitignore."), json!({"query": {"type":"string"}, "path": {"type":"string","description":crate::i18n::tr("pasta onde buscar; vazio = projeto todo", "folder to search in; empty = whole project")}}), &["query"]),
        f("write_file", crate::i18n::tr("Cria ou substitui um arquivo inteiro.", "Creates or replaces a whole file."), json!({"path": path, "content": {"type":"string"}}), &["path", "content"]),
        f("edit_file", crate::i18n::tr("Troca um trecho exato de um arquivo. old_text precisa aparecer uma única vez.", "Replaces an exact snippet of a file. old_text must appear exactly once."), json!({"path": path, "old_text": {"type":"string"}, "new_text": {"type":"string"}}), &["path", "old_text", "new_text"]),
        f("run_command", crate::i18n::tr("Roda um comando de terminal na pasta do projeto (até 2 minutos).", "Runs a terminal command in the project folder (up to 2 minutes)."), json!({"command": {"type":"string"}}), &["command"]),
    ])
}

#[derive(Debug, Clone)]
pub struct Call {
    pub id: String,
    pub name: String,
    pub args: Value,
}

impl Call {
    fn s(&self, k: &str) -> String {
        self.args.get(k).and_then(Value::as_str).unwrap_or("").to_string()
    }
}

/// Como o passo aparece na tela (mesmos tipos dos passos do Claude).
pub struct Look {
    pub kind: &'static str,
    pub title: String,
    pub detail: Option<String>,
    pub path: Option<String>,
}

pub fn look(c: &Call) -> Look {
    let p = clean(&c.s("path"));
    let name = |p: &str| p.rsplit('/').next().unwrap_or(p).to_string();
    match c.name.as_str() {
        "list_files" => Look { kind: "search", title: format!("Listando {}", if p.is_empty() { "a raiz".into() } else { p.clone() }), detail: None, path: None },
        "read_file" => Look { kind: "read", title: crate::trf!("Lendo {}", "Reading {}", name(&p)), detail: None, path: Some(p) },
        "search" => Look { kind: "search", title: format!("Buscando “{}”", cut(&c.s("query"), 40)), detail: None, path: None },
        "write_file" => Look { kind: "edit", title: format!("Escrevendo {}", name(&p)), detail: None, path: Some(p) },
        "edit_file" => Look { kind: "edit", title: format!("Editando {}", name(&p)), detail: None, path: Some(p) },
        "run_command" => {
            let cmd = c.s("command");
            Look { kind: "run", title: cut(&cmd, 70), detail: Some(cmd), path: None }
        }
        other => Look { kind: "tool", title: format!("Ferramenta {other}"), detail: None, path: None },
    }
}

// ---------------------------------------------------------------- regras do nível

/// Decisão do nível para uma chamada, com o motivo (o que aparece se for bloqueada).
pub fn decide(c: &Call, level: u8, overrides: &BTreeMap<String, Rule>) -> (Rule, &'static str) {
    let rules: BTreeMap<&str, Rule> = effective(level, overrides).into_iter().map(|(cap, r)| (cap.id, r)).collect();
    let r = |id: &str| rules.get(id).copied().unwrap_or(Rule::Bloqueado);
    let path = clean(&c.s("path"));
    match c.name.as_str() {
        "list_files" | "search" | "read_file" if is_private(&path) => (r("secrets"), "segredos"),
        "list_files" | "search" => (Rule::Permitido, "ler"),
        "read_file" if is_secret(&path) => (r("secrets"), "segredos"),
        "read_file" => (Rule::Permitido, "ler"),
        "write_file" | "edit_file" => {
            let e = r("edit");
            // configuração do Claude/Veocode: nunca muda sem a pessoa ver
            if e == Rule::Permitido && path.starts_with(".claude/") {
                (Rule::Pergunta, "editar")
            } else {
                (e, "editar")
            }
        }
        "run_command" => command_rule(&c.s("command"), &r),
        _ => (Rule::Bloqueado, "ferramenta desconhecida"),
    }
}

/// Comandos: bloqueio de qualquer categoria vence; a categoria específica (instalar, push,
/// VMs) manda sobre a regra geral de comandos; em Pergunta, comandos só de leitura passam.
fn command_rule(cmd: &str, r: &dyn Fn(&str) -> Rule) -> (Rule, &'static str) {
    let shell = r("shell");
    let mut cats: Vec<(&'static str, &'static str)> = vec![];
    for seg in segments(cmd) {
        let seg = seg.strip_prefix("sudo ").map(|_| "sudo").unwrap_or(seg);
        let starts = |pats: &[&str]| pats.iter().any(|p| seg == *p || seg.starts_with(&format!("{p} ")));
        if starts(&["sudo", "brew install", "brew upgrade", "npm install -g", "npm i -g", "npm install --global", "pnpm add -g", "yarn global add", "pip install", "pip3 install", "pipx install", "cargo install", "gem install", "go install"]) {
            cats.push(("install", crate::i18n::tr("instalar no sistema", "install on the system")));
        }
        if starts(&["git push"]) {
            cats.push(("push", "git push"));
        }
        if starts(&["docker", "podman", "limactl", "colima", "utmctl", "multipass"]) {
            cats.push(("vm", crate::i18n::tr("VMs e containers", "VMs and containers")));
        }
        if starts(&["curl", "wget"]) && r("net") == Rule::Bloqueado {
            cats.push(("net", "internet"));
        }
    }
    if shell == Rule::Bloqueado {
        return (Rule::Bloqueado, "comandos");
    }
    if let Some((_, why)) = cats.iter().find(|(id, _)| r(id) == Rule::Bloqueado) {
        return (Rule::Bloqueado, why);
    }
    if let Some((_, why)) = cats.iter().find(|(id, _)| r(id) == Rule::Pergunta) {
        return (Rule::Pergunta, why);
    }
    if !cats.is_empty() {
        return (Rule::Permitido, cats[0].1);
    }
    if shell == Rule::Pergunta && read_only(cmd) {
        return (Rule::Permitido, crate::i18n::tr("comando de leitura", "read command"));
    }
    (shell, "comandos")
}

fn segments(cmd: &str) -> Vec<&str> {
    cmd.split(['\n', ';', '|', '&']).map(str::trim).filter(|s| !s.is_empty()).collect()
}

/// Comando simples que só lê (como o Claude faz em Pergunta: ls, git status… rodam direto).
fn read_only(cmd: &str) -> bool {
    if cmd.contains(['>', '`', '\n', ';', '&']) || cmd.contains("$(") {
        return false;
    }
    let safe = ["ls", "pwd", "cat", "head", "tail", "wc", "grep", "rg", "file", "stat", "tree", "which", "echo", "git status", "git diff", "git log", "git show", "git branch"];
    cmd.split('|').map(str::trim).all(|seg| {
        let one = |p: &str| seg == p || seg.starts_with(&format!("{p} "));
        safe.iter().any(|p| one(p)) || (one("find") && !seg.contains("-exec") && !seg.contains("-delete"))
    })
}

fn is_secret(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path);
    is_private(path)
        || name == ".env"
        || name.starts_with(".env.")
        || name.ends_with(".pem")
        || name.ends_with(".key")
        || name.starts_with("id_rsa")
        || name.starts_with("id_ed25519")
}

/// Pastas e arquivos de credenciais da pasta pessoal (o Chat livre trabalha nela): chaves SSH,
/// nuvens, gerenciadores de pacote, chaveiro, cookies e a própria configuração do Veocode.
pub const PRIVATE: &[&str] = &[
    ".ssh",
    ".aws",
    ".gnupg",
    ".kube",
    ".docker/config.json",
    ".config/gh",
    ".config/gcloud",
    ".azure",
    ".netrc",
    ".npmrc",
    ".pypirc",
    ".git-credentials",
    "Library/Keychains",
    "Library/Cookies",
    "Library/Application Support/com.veocode.app",
    "AppData/Roaming/com.veocode.app",
];

/// O caminho (relativo à raiz) passa por uma pasta de [`PRIVATE`]?
fn is_private(path: &str) -> bool {
    let p = path.trim_start_matches("./").trim_end_matches('/');
    PRIVATE.iter().any(|x| p == *x || p.starts_with(&format!("{x}/")))
        || p.split('/').any(|c| matches!(c, ".ssh" | ".aws" | ".gnupg"))
}

// ---------------------------------------------------------------- execução

pub struct Outcome {
    pub ok: bool,
    /// o que volta para o modelo
    pub text: String,
    /// resumo curto na tela
    pub detail: Option<String>,
    /// arquivo novo (vira "Criando" e marca N na árvore)
    pub created: bool,
    /// fim da saída do comando, para o Terminal
    pub output: Vec<String>,
}

impl Outcome {
    fn err(msg: impl Into<String>) -> Self {
        let m = msg.into();
        Outcome { ok: false, text: crate::trf!("Erro: {m}", "Error: {m}"), detail: Some(m), created: false, output: vec![] }
    }
    fn ok(text: String, detail: Option<String>) -> Self {
        Outcome { ok: true, text, detail, created: false, output: vec![] }
    }
}

pub fn run(root: &Path, c: &Call, cancel: &AtomicBool) -> Outcome {
    let r = match c.name.as_str() {
        "list_files" => list(root, &c.s("path")),
        "read_file" => read(root, &c.s("path"), c.args.get("start_line").and_then(Value::as_u64), c.args.get("max_lines").and_then(Value::as_u64)),
        "search" => search(root, &c.s("query"), &c.s("path")),
        "write_file" => write(root, &c.s("path"), c.args.get("content").and_then(Value::as_str)),
        "edit_file" => edit(root, &c.s("path"), &c.s("old_text"), c.args.get("new_text").and_then(Value::as_str)),
        "run_command" => command(root, &c.s("command"), cancel),
        other => Err(format!("ferramenta desconhecida: {other}")),
    };
    let mut o = r.unwrap_or_else(Outcome::err);
    if o.text.len() > MAX_RESULT {
        let mut end = MAX_RESULT;
        while !o.text.is_char_boundary(end) {
            end -= 1;
        }
        o.text.truncate(end);
        o.text.push_str("\n… (cortado)");
    }
    o
}

/// Tira `./` e barras do começo; o resto da checagem fica em `inside`.
fn clean(p: &str) -> String {
    p.trim().trim_start_matches("./").trim_end_matches('/').replace('\\', "/")
}

/// Caminho dentro do projeto (o arquivo pode ainda não existir).
fn inside(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel = clean(rel);
    let p = Path::new(&rel);
    if p.is_absolute() || p.components().any(|c| matches!(c, Component::ParentDir | Component::Prefix(_) | Component::RootDir)) {
        return Err(crate::trf!("“{rel}” fica fora do projeto: use caminhos relativos à raiz", "“{rel}” is outside the project: use paths relative to the root"));
    }
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let full = root.join(p);
    // o pedaço que já existe precisa continuar dentro da raiz (links simbólicos)
    let existing = full.ancestors().find(|a| a.exists()).unwrap_or(&root);
    let real = existing.canonicalize().map_err(|e| e.to_string())?;
    if !real.starts_with(&root) {
        return Err(crate::trf!("“{rel}” aponta para fora do projeto", "“{rel}” points outside the project"));
    }
    Ok(full)
}

fn list(root: &Path, rel: &str) -> Result<Outcome, String> {
    let l = crate::files::list_dir(root, &clean(rel))?;
    let mut out: Vec<String> = l.entries.iter().map(|e| format!("{}{}", e.name, if e.is_dir { "/" } else { "" })).collect();
    if l.truncated > 0 {
        out.push(crate::trf!("… e mais {}", "… and {} more", l.truncated));
    }
    let n = l.entries.len();
    Ok(Outcome::ok(if out.is_empty() { crate::i18n::tr("(pasta vazia)", "(empty folder)").into() } else { out.join("\n") }, Some(format!("{n} itens"))))
}

fn read(root: &Path, rel: &str, start: Option<u64>, max: Option<u64>) -> Result<Outcome, String> {
    let full = inside(root, rel)?;
    let meta = fs::metadata(&full).map_err(|_| crate::trf!("{} não existe", "{} doesn't exist", clean(rel)))?;
    if meta.is_dir() {
        return Err(crate::trf!("{} é uma pasta: use list_files", "{} is a folder: use list_files", clean(rel)));
    }
    if meta.len() > 2 * 1024 * 1024 {
        return Err(crate::i18n::tr("arquivo grande demais (mais de 2 MB)", "file too large (over 2 MB)").into());
    }
    let bytes = fs::read(&full).map_err(|e| e.to_string())?;
    let text = String::from_utf8(bytes).map_err(|_| crate::i18n::tr("arquivo binário", "binary file").to_string())?;
    let lines: Vec<&str> = text.lines().collect();
    let from = start.unwrap_or(1).max(1) as usize - 1;
    let take = (max.unwrap_or(MAX_READ_LINES as u64) as usize).clamp(1, MAX_READ_LINES);
    let shown: Vec<String> = lines.iter().enumerate().skip(from).take(take).map(|(i, l)| format!("{:>5}| {l}", i + 1)).collect();
    let mut out = shown.join("\n");
    if from + shown.len() < lines.len() {
        out.push_str(&crate::trf!("\n… ({} linhas no total; use start_line para continuar)", "\n… ({} lines in total; use start_line to continue)", lines.len()));
    }
    Ok(Outcome::ok(out, Some(format!("{} linhas", lines.len()))))
}

fn search(root: &Path, query: &str, rel: &str) -> Result<Outcome, String> {
    if query.trim().is_empty() {
        return Err("busca vazia".into());
    }
    let root_c = root.canonicalize().map_err(|e| e.to_string())?;
    let base = if clean(rel).is_empty() { root_c.clone() } else { inside(root, rel)? };
    let q = query.to_lowercase();
    let mut hits = vec![];
    let mut files = 0;
    // pastas enormes (a pessoal, no Chat livre): para em 20 mil arquivos ou 20 s
    let (started, mut seen, mut partial) = (Instant::now(), 0usize, false);
    let rc = root_c.clone();
    let walk = ignore::WalkBuilder::new(&base)
        .hidden(false)
        .filter_entry(move |e| {
            let rel = e.path().strip_prefix(&rc).map(|p| p.to_string_lossy().replace('\\', "/")).unwrap_or_default();
            e.file_name() != ".git" && !is_private(&rel)
        })
        .build();
    'walk: for entry in walk.flatten() {
        seen += 1;
        if seen > 20_000 || started.elapsed() > Duration::from_secs(20) {
            partial = true;
            break;
        }
        if !entry.file_type().is_some_and(|t| t.is_file()) || entry.metadata().map(|m| m.len()).unwrap_or(0) > 1024 * 1024 {
            continue;
        }
        let relp = entry.path().canonicalize().ok().and_then(|p| p.strip_prefix(&root_c).ok().map(|p| p.to_string_lossy().replace('\\', "/"))).unwrap_or_default();
        if is_secret(&relp) {
            continue; // segredos só por read_file, que passa pela regra
        }
        let Ok(text) = fs::read_to_string(entry.path()) else { continue };
        let mut found = false;
        for (i, line) in text.lines().enumerate() {
            if line.to_lowercase().contains(&q) {
                found = true;
                hits.push(format!("{relp}:{}: {}", i + 1, cut(line.trim(), 200)));
                if hits.len() >= MAX_MATCHES {
                    break 'walk;
                }
            }
        }
        files += found as usize;
    }
    let detail = crate::trf!("{} resultado(s) em {files} arquivo(s){}", "{} result(s) in {files} file(s){}", hits.len(), if partial { " (busca parcial)" } else { "" });
    let mut text = if hits.is_empty() { "Nada encontrado.".to_string() } else { hits.join("\n") };
    if partial {
        text.push_str(crate::i18n::tr("\n(Busca parou no limite de arquivos ou de tempo: procure numa pasta mais específica.)", "\n(The search stopped at the file or time limit: search a more specific folder.)"));
    }
    Ok(Outcome::ok(text, Some(detail)))
}

fn write(root: &Path, rel: &str, content: Option<&str>) -> Result<Outcome, String> {
    let content = content.ok_or("faltou content")?;
    let full = inside(root, rel)?;
    if full.is_dir() {
        return Err(crate::i18n::tr("é uma pasta", "it's a folder").into());
    }
    let created = !full.exists();
    if let Some(dir) = full.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(&full, content).map_err(|e| e.to_string())?;
    let n = content.lines().count();
    let mut o = Outcome::ok(crate::trf!("{} {} ({n} linhas).", "{} {} ({n} lines).", if created { crate::i18n::tr("Criado", "Created") } else { crate::i18n::tr("Substituído", "Replaced") }, clean(rel)), Some(crate::trf!("{n} linhas", "{n} lines")));
    o.created = created;
    Ok(o)
}

fn edit(root: &Path, rel: &str, old: &str, new: Option<&str>) -> Result<Outcome, String> {
    let new = new.ok_or("faltou new_text")?;
    if old.is_empty() {
        return Err(crate::i18n::tr("old_text vazio: para criar o arquivo use write_file", "empty old_text: to create the file use write_file").into());
    }
    let full = inside(root, rel)?;
    let text = fs::read_to_string(&full).map_err(|_| crate::trf!("não deu para ler {}", "couldn't read {}", clean(rel)))?;
    match text.matches(old).count() {
        0 => Err(crate::i18n::tr("old_text não aparece no arquivo: leia o arquivo e copie o trecho exato", "old_text doesn't appear in the file: read the file and copy the exact snippet").into()),
        1 => {
            fs::write(&full, text.replacen(old, new, 1)).map_err(|e| e.to_string())?;
            let (a, b) = (old.lines().count(), new.lines().count());
            Ok(Outcome::ok(format!("Editado {}.", clean(rel)), Some(format!("−{a} +{b} linhas"))))
        }
        n => Err(crate::trf!("old_text aparece {n} vezes: inclua mais contexto para ficar único", "old_text appears {n} times: include more context to make it unique")),
    }
}

fn command(root: &Path, cmd: &str, cancel: &AtomicBool) -> Result<Outcome, String> {
    if cmd.trim().is_empty() {
        return Err("comando vazio".into());
    }
    #[cfg(windows)]
    let mut c = {
        // o cmd não entende as aspas escapadas do jeito do Rust: a linha vai crua, no formato
        // `cmd /S /C "<comando>"` (o /S tira só o primeiro e o último par de aspas)
        use std::os::windows::process::CommandExt;
        let mut c = Command::new("cmd");
        c.args(["/S", "/C"]).raw_arg(format!("\"{cmd} 2>&1\""));
        c.creation_flags(0x0800_0000); // sem janela de console
        c
    };
    #[cfg(not(windows))]
    let mut c = {
        let mut c = Command::new("/bin/sh");
        c.args(["-c", &format!("{cmd} 2>&1")]);
        c
    };
    let mut child = c.current_dir(root).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| e.to_string())?;
    let mut out = child.stdout.take().unwrap();
    let reader = std::thread::spawn(move || {
        let mut s = Vec::new();
        let _ = out.read_to_end(&mut s);
        s
    });
    let mut err = child.stderr.take().unwrap();
    let ereader = std::thread::spawn(move || {
        let mut s = Vec::new();
        let _ = err.read_to_end(&mut s);
        s
    });
    let start = Instant::now();
    let mut stopped = None;
    let status = loop {
        if let Some(st) = child.try_wait().map_err(|e| e.to_string())? {
            break Some(st);
        }
        if cancel.load(Ordering::SeqCst) {
            stopped = Some(crate::i18n::tr("parado", "stopped"));
        } else if start.elapsed() > COMMAND_TIMEOUT {
            stopped = Some(crate::i18n::tr("passou de 2 minutos", "went over 2 minutes"));
        }
        if stopped.is_some() {
            let _ = child.kill();
            let _ = child.wait();
            break None;
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    let mut bytes = reader.join().unwrap_or_default();
    bytes.extend(ereader.join().unwrap_or_default());
    let text = String::from_utf8_lossy(&bytes).to_string();
    let lines: Vec<String> = text.lines().map(String::from).collect();
    let output = lines[lines.len().saturating_sub(12)..].to_vec();
    let (ok, code) = match (status, stopped) {
        (_, Some(why)) => (false, format!("interrompido: {why}")),
        (Some(st), _) => (st.success(), st.code().map(|c| crate::trf!("saiu com código {c}", "exited with code {c}")).unwrap_or_else(|| "encerrado".into())),
        _ => (false, "encerrado".into()),
    };
    // para o modelo: o fim da saída é o que mais importa
    let tail = if text.len() > MAX_RESULT - 200 {
        let mut s = text.len() - (MAX_RESULT - 200);
        while !text.is_char_boundary(s) {
            s += 1;
        }
        crate::trf!("… (início cortado)\n{}", "… (start cut off)\n{}", &text[s..])
    } else {
        text
    };
    Ok(Outcome { ok, text: format!("{tail}\n[{code}]"), detail: Some(code), created: false, output })
}

fn cut(s: &str, n: usize) -> String {
    let t = s.trim().replace('\n', " ");
    if t.chars().count() > n { format!("{}…", t.chars().take(n).collect::<String>()) } else { t }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(name: &str, args: Value) -> Call {
        Call { id: "c".into(), name: name.into(), args }
    }
    fn rule(name: &str, args: Value, level: u8) -> Rule {
        decide(&call(name, args), level, &BTreeMap::new()).0
    }

    #[test]
    fn level_decides_each_tool() {
        use Rule::*;
        let w = || json!({"path":"a.txt","content":"x"});
        // Leitura: lê, não escreve nem roda nada
        assert_eq!(rule("read_file", json!({"path":"a.rs"}), 0), Permitido);
        assert_eq!(rule("write_file", w(), 0), Bloqueado);
        assert_eq!(rule("run_command", json!({"command":"ls"}), 0), Bloqueado);
        // Sugerir: escreve perguntando; comandos de leitura passam
        assert_eq!(rule("write_file", w(), 1), Pergunta);
        assert_eq!(rule("run_command", json!({"command":"git status"}), 1), Permitido);
        assert_eq!(rule("run_command", json!({"command":"ls | wc -l"}), 1), Permitido);
        assert_eq!(rule("run_command", json!({"command":"ls > x"}), 1), Pergunta);
        assert_eq!(rule("run_command", json!({"command":"npm test"}), 1), Pergunta);
        assert_eq!(rule("run_command", json!({"command":"git push origin main"}), 1), Bloqueado);
        // Editar: escreve direto; instalar pergunta
        assert_eq!(rule("write_file", w(), 2), Permitido);
        assert_eq!(rule("write_file", json!({"path":".claude/settings.local.json","content":"{}"}), 2), Pergunta);
        assert_eq!(rule("run_command", json!({"command":"cd x && npm i -g foo"}), 2), Pergunta);
        assert_eq!(rule("run_command", json!({"command":"sudo rm -rf /tmp/x"}), 2), Pergunta);
        // Total: comandos direto, push e segredos perguntam
        assert_eq!(rule("run_command", json!({"command":"cargo build"}), 3), Permitido);
        assert_eq!(rule("run_command", json!({"command":"git push"}), 3), Pergunta);
        assert_eq!(rule("read_file", json!({"path":"config/.env"}), 2), Bloqueado);
        assert_eq!(rule("read_file", json!({"path":".env"}), 3), Pergunta);
        // ajuste por cima do nível
        let mut o = BTreeMap::new();
        o.insert("push".to_string(), Permitido);
        assert_eq!(decide(&call("run_command", json!({"command":"git push"})), 2, &o).0, Permitido);
    }

    #[test]
    fn tools_work_inside_the_project() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path();
        let no = AtomicBool::new(false);
        let w = run(root, &call("write_file", json!({"path":"src/a.txt","content":"um\ndois\n"})), &no);
        assert!(w.ok && w.created, "{}", w.text);
        let w2 = run(root, &call("write_file", json!({"path":"src/a.txt","content":"um\ndois\ntrês\n"})), &no);
        assert!(w2.ok && !w2.created);
        let e = run(root, &call("edit_file", json!({"path":"src/a.txt","old_text":"dois","new_text":"2"})), &no);
        assert!(e.ok, "{}", e.text);
        assert_eq!(fs::read_to_string(root.join("src/a.txt")).unwrap(), "um\n2\ntrês\n");
        let r = run(root, &call("read_file", json!({"path":"./src/a.txt","start_line":2,"max_lines":1})), &no);
        assert!(r.text.starts_with("    2| 2"), "{}", r.text);
        let s = run(root, &call("search", json!({"query":"TRÊS"})), &no);
        assert!(s.text.contains("src/a.txt:3:"), "{}", s.text);
        let l = run(root, &call("list_files", json!({})), &no);
        assert_eq!(l.text, "src/");
        // fora do projeto: recusado
        for p in ["../x", "/etc/hosts", "src/../../x"] {
            let o = run(root, &call("read_file", json!({"path": p})), &no);
            assert!(!o.ok, "{p}");
        }
        let bad = run(root, &call("edit_file", json!({"path":"src/a.txt","old_text":"nada","new_text":"x"})), &no);
        assert!(!bad.ok);
        #[cfg(unix)]
        {
            let c = run(root, &call("run_command", json!({"command":"echo oi; exit 3"})), &no);
            assert!(!c.ok && c.output == ["oi"] && c.text.contains("código 3"), "{}", c.text);
            let stop = AtomicBool::new(true);
            let s = run(root, &call("run_command", json!({"command":"sleep 5"})), &stop);
            assert!(!s.ok && s.text.contains("parado"));
        }
    }

    #[test]
    fn private_folders_follow_the_secrets_rule() {
        let none = BTreeMap::new();
        for (name, path) in [("read_file", ".ssh/config"), ("list_files", ".aws"), ("search", "Library/Keychains"), ("read_file", "proj/.gnupg/x"), ("read_file", ".netrc")] {
            assert_eq!(decide(&call(name, json!({"path": path})), 0, &none).0, Rule::Bloqueado, "{path}");
            assert_eq!(decide(&call(name, json!({"path": path})), 3, &none).0, Rule::Pergunta, "{path}");
        }
        for path in ["Documents/notas.txt", ".sshx/a", "Library/Application Support/Outro/a.json"] {
            assert_eq!(decide(&call("read_file", json!({"path": path})), 0, &none).0, Rule::Permitido, "{path}");
        }
    }
}
