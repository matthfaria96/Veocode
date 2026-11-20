//! Aba Ambiente do modo Código: perfis do .env e os serviços do projeto.
//!
//! Perfis: no .env a pessoa deixa as opções de uma variável (ou de um bloco delas) uma embaixo
//! da outra, uma ativa e as outras comentadas com `#`. Um comentário logo em cima (ou depois do
//! valor) vira o nome da opção:
//!
//! ```text
//! # local
//! DATABASE_URL=postgres://localhost/app
//! # homolog
//! # DATABASE_URL=postgres://hml.empresa.com/app
//! ```
//!
//! O Veocode acha esses grupos e troca qual vale comentando e descomentando só essas linhas: o
//! resto do arquivo fica igual, byte a byte. Os valores não saem daqui inteiros: a tela recebe o
//! nome da opção, o endereço (host) de URLs e um pedaço mascarado das chaves.
//!
//! Serviços: os comandos de desenvolvimento achados na pasta (dev/start do package.json, Tauri,
//! Django, Rails, Go, Cargo), para rodar cada um num terminal do projeto.

use serde::Serialize;
use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};

const SKIP_DIRS: &[&str] = &[
    "node_modules", "target", "dist", "build", "out", "vendor", "venv", "__pycache__", "coverage", "Pods", "DerivedData", "bin", "obj",
];
const MAX_FILE: u64 = 256 * 1024;
const MAX_SERVICES: usize = 8;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EnvOption {
    /// primeira linha da opção no arquivo (0 = a primeira): identifica a opção na hora de trocar
    pub line: usize,
    pub label: String,
    /// host da URL ou pedaço mascarado do valor
    pub hint: String,
    pub active: bool,
    /// aponta para outra máquina (não localhost, nem um serviço do docker)
    pub remote: bool,
    /// parece produção (prod, production, live…)
    pub prod: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EnvGroup {
    pub id: String,
    pub keys: Vec<String>,
    pub options: Vec<EnvOption>,
    /// mais de uma opção ativa ao mesmo tempo (vale a última)
    pub clash: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EnvFile {
    /// relativo à pasta do projeto, com /
    pub path: String,
    /// pasta do arquivo, relativa ("" = a do projeto)
    pub dir: String,
    pub groups: Vec<EnvGroup>,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct EnvList {
    pub files: Vec<EnvFile>,
    /// .env achados sem nenhuma variável com opções
    pub plain: Vec<String>,
}

// ---------------------------------------------------------------- leitura de cada linha

#[derive(Debug, Clone, PartialEq)]
enum Line {
    Var { key: String, value: String, active: bool },
    Note(String),
    Blank,
    Other,
}

fn parse_var(s: &str) -> Option<(String, String)> {
    let s = s.trim_start();
    let s = s.strip_prefix("export ").map(str::trim_start).unwrap_or(s);
    let eq = s.find('=')?;
    let key = s[..eq].trim_end();
    let first = key.chars().next()?;
    if !(first.is_ascii_alphabetic() || first == '_') || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.') {
        return None;
    }
    Some((key.to_string(), s[eq + 1..].trim().to_string()))
}

fn classify(raw: &str) -> Line {
    let t = raw.trim();
    if t.is_empty() {
        return Line::Blank;
    }
    if let Some(rest) = t.strip_prefix('#') {
        let rest = rest.trim_start_matches('#').trim_start();
        if let Some((key, value)) = parse_var(rest) {
            return Line::Var { key, value, active: false };
        }
        return Line::Note(rest.trim().to_string());
    }
    match parse_var(t) {
        Some((key, value)) => Line::Var { key, value, active: true },
        None => Line::Other,
    }
}

/// Valor sem aspas e o comentário depois dele, se houver (`URL=x # local`).
fn split_inline(v: &str) -> (String, Option<String>) {
    let v = v.trim();
    if let Some(q) = v.chars().next().filter(|c| *c == '"' || *c == '\'' || *c == '`') {
        if let Some(end) = v[1..].find(q) {
            let inner = v[1..1 + end].to_string();
            let rest = v[2 + end..].trim_start();
            return (inner, rest.strip_prefix('#').map(|c| c.trim().to_string()).filter(|c| !c.is_empty()));
        }
        return (v.to_string(), None);
    }
    match v.find(" #").or_else(|| v.find("\t#")) {
        Some(i) => (v[..i].trim().to_string(), Some(v[i + 2..].trim().to_string()).filter(|c| !c.is_empty())),
        None => (v.to_string(), None),
    }
}

/// Nome de opção a partir de um comentário: sem enfeites (`--- local ---` → `local`).
fn clean_label(s: &str) -> Option<String> {
    let t = s.trim_matches(|c: char| c.is_whitespace() || matches!(c, '-' | '=' | '*' | '#' | '>' | '<' | '[' | ']' | ':' | '_' | '~' | '|'));
    if t.is_empty() {
        return None;
    }
    let mut out: String = t.chars().take(32).collect();
    if t.chars().count() > 32 {
        out.push('…');
    }
    Some(out)
}

// ---------------------------------------------------------------- host, máscara e o semáforo

/// Endereço de uma URL (`postgres://u:senha@db.x.com:5432/app` → `db.x.com:5432`) ou o próprio
/// valor quando ele já é um host. Nunca a senha.
fn host_of(key: &str, v: &str) -> Option<String> {
    if let Some(i) = v.find("://") {
        let rest = &v[i + 3..];
        let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
        let auth = &rest[..end];
        let host = auth.rsplit('@').next().unwrap_or(auth);
        // mongodb+srv e afins podem listar vários hosts: fica o primeiro
        let host = host.split(',').next().unwrap_or(host);
        return (!host.is_empty()).then(|| host.to_string());
    }
    let k = key.to_ascii_uppercase();
    let hostish = !v.is_empty() && v.len() <= 80 && v.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':' | '[' | ']'));
    ((k.contains("HOST") || k.contains("SERVER") || k.ends_with("_ADDR")) && hostish).then(|| v.to_string())
}

fn bare_host(h: &str) -> String {
    let h = h.trim_start_matches('[');
    let h = match h.find(']') {
        Some(i) => &h[..i],
        None if h.matches(':').count() == 1 => h.split(':').next().unwrap_or(h),
        None => h,
    };
    h.to_ascii_lowercase()
}

/// Esta máquina ou um serviço do docker (nome sem ponto, como `db` ou `postgres`).
fn is_local(host: &str) -> bool {
    let h = bare_host(host);
    matches!(h.as_str(), "localhost" | "127.0.0.1" | "0.0.0.0" | "::1" | "host.docker.internal")
        || h.starts_with("127.")
        || h.ends_with(".localhost")
        || h.ends_with(".local")
        || h.ends_with(".test")
        || (!h.contains('.') && !h.contains(':'))
}

fn looks_prod(texts: &[&str]) -> bool {
    texts.iter().any(|t| {
        t.to_lowercase()
            .split(|c: char| !c.is_alphanumeric())
            .any(|w| matches!(w, "prod" | "production" | "producao" | "produção" | "prd" | "live"))
    })
}

/// Pedaço que ajuda a reconhecer o valor sem mostrar o segredo.
fn mask(v: &str) -> String {
    if v.is_empty() {
        return crate::i18n::tr("(vazio)", "(empty)").into();
    }
    let n = v.chars().count();
    let plain = n <= 20 && v.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-' | ':' | '/'));
    let mixed = v.chars().any(|c| c.is_ascii_digit()) && v.chars().any(|c| c.is_ascii_alphabetic()) && n > 10;
    if plain && !mixed {
        return v.to_string();
    }
    if n > 10 {
        let head: String = v.chars().take(4).collect();
        let tail: String = v.chars().skip(n - 2).collect();
        return format!("{head}…{tail}");
    }
    "•••".into()
}

// ---------------------------------------------------------------- grupos

/// Variáveis seguidas, ativas ou não, entre linhas em branco ou comentários: o que fica embaixo
/// de um comentário como `# homolog`. Trocar de opção não muda onde um bloco começa e termina.
struct Run {
    lines: Vec<usize>,
    keys: Vec<String>,
    header: Option<String>,
    dup: bool,
}

struct Opt {
    lines: Vec<usize>,
    out: EnvOption,
}

struct Group {
    keys: Vec<String>,
    opts: Vec<Opt>,
}

/// Rótulo, dica e o semáforo de uma opção (uma linha ou um bloco).
fn describe(parsed: &[Line], lines: &[usize], header: Option<&str>, n: usize) -> EnvOption {
    let vars: Vec<(&str, String, Option<String>, bool)> = lines
        .iter()
        .filter_map(|i| match &parsed[*i] {
            Line::Var { key, value, active } => {
                let (v, c) = split_inline(value);
                Some((key.as_str(), v, c, *active))
            }
            _ => None,
        })
        .collect();
    let inline = (vars.len() == 1).then(|| vars[0].2.clone()).flatten();
    // o valor que melhor diz para onde a opção aponta: o de uma URL/host, senão o primeiro
    let host = vars.iter().find_map(|(k, v, _, _)| host_of(k, v));
    let hint = host.clone().unwrap_or_else(|| vars.first().map(|(_, v, _, _)| mask(v)).unwrap_or_default());
    let label = inline
        .as_deref()
        .and_then(clean_label)
        .or_else(|| header.and_then(clean_label))
        .or_else(|| host.as_deref().map(|h| if is_local(h) { "local".into() } else { bare_host(h) }))
        .unwrap_or_else(|| crate::trf!("opção {n}", "option {n}"));
    let remote = host.as_deref().is_some_and(|h| !is_local(h));
    let mut texts = vec![label.as_str()];
    texts.extend(vars.iter().map(|(_, v, _, _)| v.as_str()));
    let prod = looks_prod(&texts);
    EnvOption { line: lines[0], label, hint, active: vars.iter().all(|x| x.3), remote, prod }
}

fn groups_of(text: &str) -> (Vec<Line>, Vec<Group>) {
    let parsed: Vec<Line> = text.lines().map(classify).collect();

    // blocos: linhas de variáveis seguidas
    let mut runs: Vec<Run> = Vec::new();
    for (i, l) in parsed.iter().enumerate() {
        let Line::Var { key, .. } = l else { continue };
        if let Some(r) = runs.last_mut().filter(|r| r.lines.last() == Some(&(i.wrapping_sub(1)))) {
            r.dup |= r.keys.contains(key);
            r.keys.push(key.clone());
            r.lines.push(i);
            continue;
        }
        let header = i.checked_sub(1).and_then(|p| match &parsed[p] {
            Line::Note(n) => Some(n.clone()),
            _ => None,
        });
        runs.push(Run { lines: vec![i], keys: vec![key.clone()], header, dup: false });
    }

    // blocos com as mesmas variáveis viram um grupo (troca o bloco inteiro)
    let mut by_set: BTreeMap<Vec<String>, Vec<usize>> = BTreeMap::new();
    for (ri, r) in runs.iter().enumerate() {
        if r.dup || r.keys.len() > 12 {
            continue;
        }
        let mut set = r.keys.clone();
        set.sort();
        by_set.entry(set).or_default().push(ri);
    }
    let mut groups: Vec<Group> = Vec::new();
    let mut covered: HashSet<String> = HashSet::new();
    for (set, rs) in by_set.iter().filter(|(_, rs)| rs.len() >= 2) {
        if set.iter().any(|k| covered.contains(k)) {
            continue;
        }
        covered.extend(set.iter().cloned());
        let opts = rs
            .iter()
            .enumerate()
            .map(|(n, ri)| {
                let r = &runs[*ri];
                Opt { lines: r.lines.clone(), out: describe(&parsed, &r.lines, r.header.as_deref(), n + 1) }
            })
            .collect();
        groups.push(Group { keys: set.clone(), opts });
    }

    // o resto: cada variável que aparece mais de uma vez vira um grupo dela
    let mut by_key: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for (i, l) in parsed.iter().enumerate() {
        if let Line::Var { key, .. } = l {
            if !covered.contains(key) {
                by_key.entry(key.clone()).or_default().push(i);
            }
        }
    }
    for (key, ls) in by_key.into_iter().filter(|(_, ls)| ls.len() >= 2) {
        let opts = ls
            .iter()
            .enumerate()
            .map(|(n, i)| {
                let header = runs.iter().find(|r| r.lines[0] == *i).and_then(|r| r.header.clone());
                Opt { lines: vec![*i], out: describe(&parsed, &[*i], header.as_deref(), n + 1) }
            })
            .collect();
        groups.push(Group { keys: vec![key], opts });
    }

    // na ordem do arquivo
    groups.sort_by_key(|g| g.opts.first().map(|o| o.out.line).unwrap_or(0));
    (parsed, groups)
}

fn public(file: &str, g: &Group) -> EnvGroup {
    let mut options: Vec<EnvOption> = g.opts.iter().map(|o| o.out.clone()).collect();
    let actives = options.iter().filter(|o| o.active).count();
    // com duas ativas, vale a última (é o que os carregadores de .env fazem)
    if actives > 1 {
        let last = options.iter().rposition(|o| o.active).unwrap_or(0);
        for (i, o) in options.iter_mut().enumerate() {
            o.active = i == last;
        }
    }
    EnvGroup { id: format!("{file}|{}", g.keys.join(",")), keys: g.keys.clone(), options, clash: actives > 1 }
}

// ---------------------------------------------------------------- arquivos

fn skip_dir(name: &str) -> bool {
    name.starts_with('.') || SKIP_DIRS.contains(&name)
}

/// Pastas do projeto até dois níveis (raiz, `back/`, `apps/web/`), sem dependências e builds.
fn dirs(root: &Path) -> Vec<PathBuf> {
    let mut out = vec![root.to_path_buf()];
    let mut level = vec![root.to_path_buf()];
    for _ in 0..2 {
        let mut next = Vec::new();
        for d in &level {
            let Ok(rd) = std::fs::read_dir(d) else { continue };
            let mut subs: Vec<PathBuf> = rd
                .flatten()
                .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
                .filter(|e| !skip_dir(&e.file_name().to_string_lossy()))
                .map(|e| e.path())
                .collect();
            subs.sort();
            next.extend(subs);
        }
        if next.len() > 400 {
            next.truncate(400);
        }
        out.extend(next.iter().cloned());
        level = next;
    }
    out
}

fn is_env_name(name: &str) -> bool {
    if name == ".env" {
        return true;
    }
    let Some(rest) = name.strip_prefix(".env.") else { return false };
    let r = rest.to_ascii_lowercase();
    !(r.contains("example") || r.contains("sample") || r.contains("template") || r.ends_with("dist") || r.contains("defaults") || r.contains("schema") || r.ends_with(".bak") || r.ends_with('~'))
}

fn rel(root: &Path, p: &Path) -> String {
    p.strip_prefix(root).unwrap_or(p).to_string_lossy().replace('\\', "/")
}

fn env_files(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for d in dirs(root) {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        let mut found: Vec<PathBuf> = rd
            .flatten()
            .filter(|e| e.file_type().is_ok_and(|t| t.is_file()) && is_env_name(&e.file_name().to_string_lossy()))
            .filter(|e| e.metadata().is_ok_and(|m| m.len() <= MAX_FILE))
            .map(|e| e.path())
            .collect();
        found.sort();
        out.extend(found);
        if out.len() >= 40 {
            break;
        }
    }
    out
}

pub fn list(root: &Path) -> EnvList {
    let mut l = EnvList::default();
    for f in env_files(root) {
        let Ok(text) = std::fs::read_to_string(&f) else { continue };
        let path = rel(root, &f);
        let (_, groups) = groups_of(&text);
        if groups.is_empty() {
            l.plain.push(path);
            continue;
        }
        let dir = f.parent().map(|d| rel(root, d)).unwrap_or_default();
        l.files.push(EnvFile { groups: groups.iter().map(|g| public(&path, g)).collect(), path, dir });
    }
    l
}

/// Caminho de um .env pedido pela tela: dentro da pasta do projeto e com nome de .env.
fn resolve(root: &Path, file: &str) -> Result<PathBuf, String> {
    let bad = || crate::i18n::tr("arquivo .env inválido", "invalid .env file").to_string();
    if file.split('/').any(|p| p == "..") {
        return Err(bad());
    }
    let p = root.join(file);
    let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let real_root = root.canonicalize().map_err(|e| e.to_string())?;
    let real = p.canonicalize().map_err(|_| crate::i18n::tr("Esse .env não existe mais.", "That .env no longer exists.").to_string())?;
    if !is_env_name(&name) || !real.starts_with(&real_root) {
        return Err(bad());
    }
    Ok(real)
}

fn comment(line: &str) -> String {
    format!("# {line}")
}

fn uncomment(line: &str) -> String {
    let t = line.trim_start();
    let lead = &line[..line.len() - t.len()];
    let rest = t.trim_start_matches('#');
    let rest = rest.strip_prefix(' ').unwrap_or(rest);
    format!("{lead}{rest}")
}

/// Texto novo com a opção escolhida ativa e as outras do grupo comentadas.
fn switched(text: &str, group: &str, file: &str, line: usize) -> Result<String, String> {
    let (parsed, groups) = groups_of(text);
    let changed = || crate::i18n::tr("O .env mudou enquanto isso. Atualizei a lista: tente de novo.", "The .env changed in the meantime. I refreshed the list: try again.").to_string();
    let g = groups.iter().find(|g| public(file, g).id == group).ok_or_else(changed)?;
    if !g.opts.iter().any(|o| o.out.line == line) {
        return Err(changed());
    }
    let mut want: BTreeMap<usize, bool> = BTreeMap::new();
    for o in &g.opts {
        for l in &o.lines {
            want.insert(*l, o.out.line == line);
        }
    }
    let mut out = String::with_capacity(text.len() + 16);
    for (i, piece) in text.split_inclusive('\n').enumerate() {
        let body = piece.trim_end_matches(['\n', '\r']);
        let eol = &piece[body.len()..];
        match (want.get(&i), &parsed.get(i)) {
            (Some(true), Some(Line::Var { active: false, .. })) => out.push_str(&uncomment(body)),
            (Some(false), Some(Line::Var { active: true, .. })) => out.push_str(&comment(body)),
            _ => out.push_str(body),
        }
        out.push_str(eol);
    }
    Ok(out)
}

pub fn switch(root: &Path, file: &str, group: &str, line: usize) -> Result<EnvList, String> {
    let path = resolve(root, file)?;
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let next = switched(&text, group, file, line)?;
    if next != text {
        std::fs::write(&path, next).map_err(|e| crate::trf!("não deu para gravar o {file}: {e}", "couldn't save {file}: {e}"))?;
    }
    Ok(list(root))
}

// ---------------------------------------------------------------- serviços

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ServiceSpec {
    pub key: String,
    pub name: String,
    pub cmd: String,
    /// pasta onde roda, relativa ("" = a do projeto)
    pub dir: String,
}

/// Como chamar um script do package.json com o gerenciador que a pasta usa.
fn runner(dir: &Path, root: &Path) -> &'static str {
    for d in [dir, root] {
        if d.join("pnpm-lock.yaml").is_file() {
            return "pnpm";
        }
        if d.join("yarn.lock").is_file() {
            return "yarn";
        }
        if d.join("bun.lockb").is_file() || d.join("bun.lock").is_file() {
            return "bun run";
        }
        if d.join("package-lock.json").is_file() {
            return "npm run";
        }
    }
    "npm run"
}

fn node_service(dir: &Path, root: &Path) -> Option<(String, String)> {
    let text = std::fs::read_to_string(dir.join("package.json")).ok()?;
    let json: serde_json::Value = serde_json::from_str(&text).ok()?;
    let scripts = json.get("scripts")?.as_object()?;
    let run = runner(dir, root);
    // app Tauri: o `tauri dev` já sobe o front junto
    if scripts.contains_key("tauri") && dir.join("src-tauri").is_dir() {
        return Some(("tauri".into(), format!("{run} tauri dev")));
    }
    let script = ["dev", "start:dev", "develop", "serve", "start"].into_iter().find(|s| scripts.contains_key(*s))?;
    Some((script.into(), format!("{run} {script}")))
}

pub fn detect(root: &Path) -> Vec<ServiceSpec> {
    let root_name = root.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "app".into());
    let mut out: Vec<ServiceSpec> = Vec::new();
    for d in dirs(root) {
        if out.len() >= MAX_SERVICES {
            break;
        }
        let dir = rel(root, &d);
        let name = if dir.is_empty() { root_name.clone() } else { d.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| dir.clone()) };
        let py = if cfg!(windows) { "python" } else { "python3" };
        let found: Option<(String, String)> = if let Some(x) = node_service(&d, root) {
            Some(x)
        } else if d.join("manage.py").is_file() {
            Some(("django".into(), format!("{py} manage.py runserver")))
        } else if d.join("bin/rails").is_file() {
            Some(("rails".into(), "bin/rails server".into()))
        } else if d.join("go.mod").is_file() && d.join("main.go").is_file() {
            Some(("go".into(), "go run .".into()))
        } else if d.join("Cargo.toml").is_file() && d.join("src/main.rs").is_file() && !d.ends_with("src-tauri") {
            Some(("cargo".into(), "cargo run".into()))
        } else {
            None
        };
        if let Some((kind, cmd)) = found {
            out.push(ServiceSpec { key: format!("{dir}:{kind}"), name, cmd, dir });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const FILE: &str = "PORT=3000\n# local\nDATABASE_URL=postgres://dev:segredo@localhost:5432/app\n# homolog\n# DATABASE_URL=postgres://hml:outra@db.hml.empresa.com/app\n#DATABASE_URL=postgres://u:p@db.prod.empresa.com/app # produção\n\n# Banco A\nDB_HOST=localhost\nDB_USER=dev\n\n# Banco B\n# DB_HOST=10.0.0.5\n# DB_USER=b\n\nSTRIPE_KEY=sk_test_51Habcdefghijkl\n# STRIPE_KEY=sk_live_51Hzyxwvutsrqpo\n";

    fn groups(text: &str) -> Vec<EnvGroup> {
        groups_of(text).1.iter().map(|g| public(".env", g)).collect()
    }

    #[test]
    fn finds_single_and_block_groups() {
        let g = groups(FILE);
        assert_eq!(g.len(), 3, "{g:#?}");
        let db = &g[0];
        assert_eq!(db.keys, vec!["DATABASE_URL"]);
        let labels: Vec<&str> = db.options.iter().map(|o| o.label.as_str()).collect();
        assert_eq!(labels, vec!["local", "homolog", "produção"]);
        assert!(db.options[0].active && !db.options[1].active);
        assert!(!db.options[0].remote && db.options[1].remote && db.options[2].prod);
        // a senha nunca vai para a tela
        assert_eq!(db.options[1].hint, "db.hml.empresa.com");
        let block = &g[1];
        assert_eq!(block.keys, vec!["DB_HOST", "DB_USER"]);
        assert_eq!(block.options.iter().map(|o| o.label.as_str()).collect::<Vec<_>>(), vec!["Banco A", "Banco B"]);
        assert!(block.options[1].remote);
        let stripe = &g[2];
        assert_eq!(stripe.options[0].hint, "sk_t…kl");
        assert!(stripe.options[1].prod && !stripe.options[0].prod);
    }

    #[test]
    fn switching_touches_only_the_group_lines() {
        let text = FILE.replace('\n', "\r\n");
        let g = groups(&text);
        let hml = g[0].options[1].line;
        let out = switched(&text, &g[0].id, ".env", hml).unwrap();
        let after = groups(&out);
        assert!(after[0].options[1].active && !after[0].options[0].active && !after[0].options[2].active);
        // o resto continua igual, com as mesmas quebras de linha
        assert!(out.contains("\r\nPORT=3000") || out.starts_with("PORT=3000\r\n"));
        assert!(out.contains("# DATABASE_URL=postgres://dev:segredo@localhost:5432/app\r\n"));
        assert!(out.contains("\r\nDATABASE_URL=postgres://hml:outra@db.hml.empresa.com/app\r\n"));
        assert_eq!(out.lines().count(), text.lines().count());
        // bloco inteiro
        let b = switched(&out, &after[1].id, ".env", after[1].options[1].line).unwrap();
        assert!(b.contains("\r\n# DB_HOST=localhost\r\n# DB_USER=dev\r\n") && b.contains("\r\nDB_HOST=10.0.0.5\r\nDB_USER=b\r\n"));
        // de volta: igual ao começo
        let back = switched(&b, &after[1].id, ".env", after[1].options[0].line).unwrap();
        let back = switched(&back, &g[0].id, ".env", g[0].options[0].line).unwrap();
        assert_eq!(back, text);
    }

    #[test]
    fn two_active_lines_clash_and_the_last_wins() {
        let g = groups("API_URL=http://localhost:3000\nAPI_URL=https://api.empresa.com\n");
        assert!(g[0].clash);
        assert!(!g[0].options[0].active && g[0].options[1].active);
    }

    #[test]
    fn ignores_notes_that_look_like_text() {
        assert_eq!(classify("# Note: x=1"), Line::Note("Note: x=1".into()));
        assert_eq!(classify("# see https://x.com/?a=b"), Line::Note("see https://x.com/?a=b".into()));
        assert!(matches!(classify("# export TOKEN=abc"), Line::Var { active: false, .. }));
        assert!(is_env_name(".env.local") && !is_env_name(".env.example") && !is_env_name(".envrc"));
    }

    #[test]
    fn finds_services_and_env_files() {
        let base = std::env::temp_dir().join(format!("veocode-envs-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("front")).unwrap();
        std::fs::create_dir_all(base.join("back")).unwrap();
        std::fs::create_dir_all(base.join("node_modules/x")).unwrap();
        std::fs::write(base.join("front/package.json"), r#"{"scripts":{"dev":"vite","build":"vite build"}}"#).unwrap();
        std::fs::write(base.join("front/pnpm-lock.yaml"), "").unwrap();
        std::fs::write(base.join("back/package.json"), r#"{"scripts":{"start":"node index.js"}}"#).unwrap();
        std::fs::write(base.join("node_modules/x/package.json"), r#"{"scripts":{"dev":"x"}}"#).unwrap();
        std::fs::write(base.join("back/.env"), "# a\nURL=http://localhost\n# b\n# URL=https://b.com\n").unwrap();
        std::fs::write(base.join("back/.env.example"), "URL=\n# URL=x\n").unwrap();
        std::fs::write(base.join(".env"), "ONLY=1\n").unwrap();
        let s = detect(&base);
        assert_eq!(s.iter().map(|x| (x.name.as_str(), x.cmd.as_str(), x.dir.as_str())).collect::<Vec<_>>(), vec![("back", "npm run start", "back"), ("front", "pnpm dev", "front")]);
        let l = list(&base);
        assert_eq!(l.files.len(), 1);
        assert_eq!((l.files[0].path.as_str(), l.files[0].dir.as_str()), ("back/.env", "back"));
        assert_eq!(l.plain, vec![".env"]);
        let g = &l.files[0].groups[0];
        let l2 = switch(&base, "back/.env", &g.id, g.options[1].line).unwrap();
        assert!(l2.files[0].groups[0].options[1].active);
        assert!(switch(&base, "../x/.env", &g.id, 0).is_err());
        assert!(switch(&base, "back/package.json", &g.id, 0).is_err());
        let _ = std::fs::remove_dir_all(&base);
    }
}
