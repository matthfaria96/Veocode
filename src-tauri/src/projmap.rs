//! Mapa do projeto: um arquivo só, `.veocode/map.json`, com as áreas, os arquivos e quem usa quem.
//! O Veocode já traz o desenho (um grafo como o do Obsidian); este arquivo é só a "leitura".
//! Aqui o Veocode escreve a versão tirada do código: lê os imports (JS/TS, Rust, Python, Java,
//! Kotlin, C/C++, CSS, HTML, Dart, Ruby), junta os arquivos por pasta e liga quem importa quem.
//! A IA do projeto pode escrever o mesmo arquivo com ideias (telas, serviços, dados) no lugar.
//!
//! Formato (compacto, um item por linha):
//! {"v":1,"title":"…","by":"veocode","at":1763600000,"files":true,
//!  "groups":[["src/components","components"],…],     // [id, nome, cor?, nota?]
//!  "nodes":[["src/App.tsx","App.tsx",0,120],…],      // [id, nome, grupo, tamanho?, caminho?, nota?]
//!  "links":[[0,3],[0,5],…],                          // [de, para, rótulo?] por índice ou id
//!  "flow":[…]}                                       // opcional: o caminho principal, em ordem
//! Com "files":true, o id de cada ponto é o caminho do arquivo.

use crate::i18n::tr;
use std::collections::{HashMap, HashSet};
use std::path::Path;

pub const FILE: &str = ".veocode/map.json";
const MAX_SCAN: usize = 6000;
const MAX_NODES: usize = 700;
const MAX_BYTES: u64 = 300_000;
const MAX_GROUPS: usize = 10;

const JS: &[&str] = &["ts", "tsx", "js", "jsx", "mjs", "cjs", "vue", "svelte", "astro"];
const CSS: &[&str] = &["css", "scss", "sass", "less"];
const CODE: &[&str] = &[
    "ts", "tsx", "js", "jsx", "mjs", "cjs", "vue", "svelte", "astro", "rs", "py", "go", "swift", "kt", "kts", "java", "scala", "rb", "php", "cs", "c", "h",
    "cc", "cpp", "hpp", "m", "mm", "dart", "lua", "css", "scss", "sass", "less", "html", "sql", "sh", "ex", "exs", "zig",
];
const SKIP: &[&str] = &[
    ".git", "node_modules", "target", "dist", "build", ".next", ".nuxt", ".svelte-kit", "out", "coverage", "vendor", "Pods", "DerivedData", ".venv", "venv",
    "__pycache__", ".turbo", ".cache", ".veocode", ".idea", ".vscode",
];
/// Pastas que só embrulham o código: o nome da área vem da pasta de dentro.
const GENERIC: &[&str] = &["src", "lib", "app", "source", "sources", "Sources", "pkg", "internal", "packages", "apps", "crates", "main", "java", "kotlin"];

struct Src {
    rel: String,
    ext: String,
    lines: usize,
    text: String,
}

/// O mapa salvo, se houver.
pub fn read(root: &Path) -> Option<(String, u64)> {
    let path = root.join(FILE);
    let text = std::fs::read_to_string(&path).ok()?;
    let at = std::fs::metadata(&path).ok()?.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs();
    Some((text, at))
}

/// Lê o código, monta o mapa, grava em `.veocode/map.json` e devolve o texto.
pub fn scan(root: &Path, title: &str) -> Result<String, String> {
    let files = collect(root);
    if files.is_empty() {
        return Err(tr("não achei código nesta pasta para desenhar", "found no code in this folder to draw").into());
    }
    let text = build(&files, title);
    let dir = root.join(".veocode");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let tmp = dir.join("map.json.tmp");
    std::fs::write(&tmp, &text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, root.join(FILE)).map_err(|e| e.to_string())?;
    Ok(text)
}

fn collect(root: &Path) -> Vec<Src> {
    let mut out = Vec::new();
    let walk = ignore::WalkBuilder::new(root)
        .hidden(false)
        .git_ignore(true)
        .git_exclude(true)
        .parents(false)
        .follow_links(false)
        .filter_entry(|e| !SKIP.contains(&e.file_name().to_string_lossy().as_ref()))
        .build();
    for e in walk.flatten() {
        if out.len() >= MAX_SCAN {
            break;
        }
        if !e.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        let name = e.file_name().to_string_lossy().to_string();
        let Some(ext) = name.rsplit_once('.').map(|(_, x)| x.to_lowercase()) else { continue };
        if !CODE.contains(&ext.as_str()) || name.ends_with(".min.js") || name.ends_with(".d.ts") || name.ends_with(".min.css") {
            continue;
        }
        if e.metadata().map(|m| m.len() > MAX_BYTES).unwrap_or(true) {
            continue;
        }
        let Ok(rel) = e.path().strip_prefix(root) else { continue };
        let rel = rel.components().map(|c| c.as_os_str().to_string_lossy().to_string()).collect::<Vec<_>>().join("/");
        let text = std::fs::read_to_string(e.path()).unwrap_or_default();
        let lines = text.lines().count().max(1);
        out.push(Src { rel, ext, lines, text });
    }
    out.sort_by(|a, b| a.rel.cmp(&b.rel));
    out
}

fn build(files: &[Src], title: &str) -> String {
    let index: HashMap<&str, usize> = files.iter().enumerate().map(|(i, f)| (f.rel.as_str(), i)).collect();
    let mut stems: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, f) in files.iter().enumerate() {
        stems.entry(stem_of(&f.rel).to_string()).or_default().push(i);
    }
    let r = Resolver { files, index: &index, stems: &stems };

    let mut edges: Vec<(usize, usize)> = Vec::new();
    let mut seen = HashSet::new();
    for (i, f) in files.iter().enumerate() {
        for t in r.imports(f) {
            if t != i && seen.insert((i, t)) {
                edges.push((i, t));
            }
        }
    }

    // muitos arquivos: ficam os mais ligados e os maiores
    let mut degree = vec![0usize; files.len()];
    for &(a, b) in &edges {
        degree[a] += 1;
        degree[b] += 1;
    }
    let mut keep: Vec<usize> = (0..files.len()).collect();
    if keep.len() > MAX_NODES {
        keep.sort_by_key(|&i| std::cmp::Reverse(degree[i] * 400 + files[i].lines.min(2000)));
        keep.truncate(MAX_NODES);
        keep.sort_unstable();
    }
    let pos: HashMap<usize, usize> = keep.iter().enumerate().map(|(k, &i)| (i, k)).collect();

    // áreas: a pasta (pulando src/, lib/…); uma área grande demais se abre um nível
    let n = keep.len();
    let mut keys: Vec<String> = keep.iter().map(|&i| area(&files[i].rel, 0)).collect();
    for extra in 1..=2 {
        let mut count: HashMap<&str, usize> = HashMap::new();
        for k in &keys {
            *count.entry(k.as_str()).or_default() += 1;
        }
        let big: HashSet<String> = count.into_iter().filter(|(_, c)| *c > 30.max(n / 4)).map(|(k, _)| k.to_string()).collect();
        if big.is_empty() {
            break;
        }
        for (k, &i) in keys.iter_mut().zip(&keep) {
            if big.contains(k.as_str()) {
                *k = area(&files[i].rel, extra);
            }
        }
    }
    let mut count: HashMap<String, usize> = HashMap::new();
    for k in &keys {
        *count.entry(k.clone()).or_default() += 1;
    }
    let mut order: Vec<(String, usize)> = count.into_iter().collect();
    order.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    const OTHER: &str = "\u{1}";
    // áreas de um ou dois arquivos (num projeto com várias) e as que passam de MAX_GROUPS viram "outros"
    let tiny = (n / 40).max(2);
    let cut = if order.len() > 6 { order.iter().position(|x| x.1 <= tiny).unwrap_or(order.len()) } else { order.len() }.min(MAX_GROUPS - 1);
    if cut + 1 < order.len() {
        let rest: usize = order[cut..].iter().map(|x| x.1).sum();
        let gone: HashSet<String> = order[cut..].iter().map(|x| x.0.clone()).collect();
        order.truncate(cut);
        order.push((OTHER.into(), rest));
        for k in keys.iter_mut() {
            if gone.contains(k.as_str()) {
                *k = OTHER.into();
            }
        }
    }
    let gid: HashMap<&str, usize> = order.iter().enumerate().map(|(g, (k, _))| (k.as_str(), g)).collect();
    let mut labels: Vec<String> = order
        .iter()
        .map(|(k, _)| match k.as_str() {
            "" => tr("raiz", "root").to_string(),
            OTHER => tr("outros", "other").to_string(),
            k => area_label(k),
        })
        .collect();
    let dup: Vec<bool> = labels.iter().map(|l| labels.iter().filter(|x| *x == l).count() > 1).collect();
    for (g, d) in dup.into_iter().enumerate() {
        if d && !order[g].0.is_empty() && order[g].0 != OTHER {
            labels[g] = order[g].0.clone();
        }
    }

    let js = |v: &str| serde_json::to_string(v).unwrap_or_else(|_| "\"\"".into());
    let mut out = String::with_capacity(64 * n + 16 * edges.len());
    let at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    out.push_str(&format!("{{\"v\":1,\"title\":{},\"by\":\"veocode\",\"at\":{at},\"files\":true,\n\"groups\":[\n", js(title)));
    for (g, (k, _)) in order.iter().enumerate() {
        let note = match k.as_str() {
            "" | OTHER => String::new(),
            k if k == labels[g] => String::new(),
            k => format!(",null,{}", js(k)),
        };
        out.push_str(&format!("[{},{}{note}]{}\n", js(if k == OTHER { "*" } else { k }), js(&labels[g]), if g + 1 < order.len() { "," } else { "" }));
    }
    out.push_str("],\n\"nodes\":[\n");
    for (k, &i) in keep.iter().enumerate() {
        let f = &files[i];
        let name = f.rel.rsplit('/').next().unwrap_or(&f.rel);
        out.push_str(&format!("[{},{},{},{}]{}\n", js(&f.rel), js(name), gid[keys[k].as_str()], f.lines, if k + 1 < n { "," } else { "" }));
    }
    out.push_str("],\n\"links\":[");
    let kept: Vec<(usize, usize)> = edges.iter().filter_map(|(a, b)| Some((*pos.get(a)?, *pos.get(b)?))).collect();
    for (j, (a, b)) in kept.iter().enumerate() {
        if j % 16 == 0 {
            out.push('\n');
        }
        out.push_str(&format!("[{a},{b}]{}", if j + 1 < kept.len() { "," } else { "" }));
    }
    out.push_str("\n]}\n");
    out
}

/// Área de um arquivo: a primeira pasta que não é só embrulho (src/, lib/…) e, com `extra`,
/// mais tantos níveis (embrulhos no meio não contam).
fn area(rel: &str, extra: usize) -> String {
    let parts: Vec<&str> = rel.split('/').collect();
    let dirs = &parts[..parts.len() - 1];
    let (mut take, mut counted) = (0, 0);
    while take < dirs.len() {
        let generic = GENERIC.contains(&dirs[take]);
        take += 1;
        if !generic {
            counted += 1;
            if counted > extra {
                break;
            }
        }
    }
    dirs[..take].join("/")
}

/// Nome curto de uma área: a última pasta que não é só embrulho.
fn area_label(key: &str) -> String {
    key.rsplit('/').find(|s| !GENERIC.contains(s)).or_else(|| key.rsplit('/').next()).unwrap_or(key).to_string()
}

fn stem_of(rel: &str) -> &str {
    let name = rel.rsplit('/').next().unwrap_or(rel);
    name.split_once('.').map(|(s, _)| s).unwrap_or(name)
}

fn dir_of(rel: &str) -> &str {
    rel.rsplit_once('/').map(|(d, _)| d).unwrap_or("")
}

/// Junta `dir` com um caminho relativo, resolvendo `.` e `..`. None se sair da raiz.
fn join(dir: &str, rel: &str) -> Option<String> {
    let mut parts: Vec<&str> = if dir.is_empty() { vec![] } else { dir.split('/').collect() };
    for p in rel.split('/') {
        match p {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            p => parts.push(p),
        }
    }
    Some(parts.join("/"))
}

/// Textos entre aspas de uma linha.
fn quoted(line: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let b = line.as_bytes();
    let mut i = 0;
    while i < b.len() {
        let q = b[i];
        if q == b'"' || q == b'\'' || q == b'`' {
            if let Some(end) = line[i + 1..].find(q as char) {
                out.push(&line[i + 1..i + 1 + end]);
                i += end + 2;
                continue;
            }
            break;
        }
        i += 1;
    }
    out
}

struct Resolver<'a> {
    files: &'a [Src],
    index: &'a HashMap<&'a str, usize>,
    stems: &'a HashMap<String, Vec<usize>>,
}

impl Resolver<'_> {
    fn hit(&self, p: &str) -> Option<usize> {
        self.index.get(p).copied()
    }

    fn first(&self, cands: impl IntoIterator<Item = String>) -> Option<usize> {
        cands.into_iter().find_map(|c| self.hit(&c))
    }

    fn imports(&self, f: &Src) -> Vec<usize> {
        let dir = dir_of(&f.rel);
        let mut out = Vec::new();
        let ext = f.ext.as_str();
        if JS.contains(&ext) || ext == "dart" {
            for line in f.text.lines().filter(|l| l.contains("import") || l.contains("require") || l.contains("from") || l.contains("export")) {
                for q in quoted(line) {
                    if let Some(i) = self.js(dir, q) {
                        out.push(i);
                    }
                }
            }
        } else if CSS.contains(&ext) {
            for line in f.text.lines().filter(|l| l.contains("@import") || l.contains("@use") || l.contains("@forward")) {
                for q in quoted(line) {
                    let Some(p) = join(dir, q) else { continue };
                    let (d, n) = p.rsplit_once('/').unwrap_or(("", &p));
                    let partial = if d.is_empty() { format!("_{n}") } else { format!("{d}/_{n}") };
                    if let Some(i) = self.first(["", ".css", ".scss", ".sass", ".less"].iter().flat_map(|x| [format!("{p}{x}"), format!("{partial}{x}")])) {
                        out.push(i);
                    }
                }
            }
        } else if ext == "html" {
            for line in f.text.lines().filter(|l| l.contains("src=") || l.contains("href=")) {
                for q in quoted(line) {
                    if q.contains("://") || q.starts_with('#') || q.starts_with("data:") || q.is_empty() {
                        continue;
                    }
                    let p = if let Some(r) = q.strip_prefix('/') { Some(r.to_string()) } else { join(dir, q) };
                    if let Some(i) = p.and_then(|p| self.hit(&p)) {
                        out.push(i);
                    }
                }
            }
        } else if ext == "rs" {
            self.rust(f, &mut out);
        } else if ext == "py" {
            self.python(f, &mut out);
        } else if matches!(ext, "java" | "kt" | "kts" | "scala") {
            for line in f.text.lines().map(str::trim).filter(|l| l.starts_with("import ")) {
                let spec = line["import ".len()..].trim_start_matches("static ").trim_end_matches(';').trim().trim_end_matches(".*");
                let spec = spec.split_whitespace().next().unwrap_or("");
                if let Some(i) = self.suffix(&spec.replace('.', "/")) {
                    out.push(i);
                }
            }
        } else if matches!(ext, "c" | "h" | "cc" | "cpp" | "hpp" | "m" | "mm") {
            for line in f.text.lines().map(str::trim).filter(|l| l.starts_with("#include") || l.starts_with("#import")) {
                for q in quoted(line) {
                    if let Some(i) = join(dir, q).and_then(|p| self.hit(&p)).or_else(|| self.suffix_file(q)) {
                        out.push(i);
                    }
                }
            }
        } else if ext == "rb" {
            for line in f.text.lines().map(str::trim).filter(|l| l.starts_with("require_relative")) {
                for q in quoted(line) {
                    let q = q.trim_end_matches(".rb");
                    if let Some(i) = join(dir, &format!("{q}.rb")).and_then(|p| self.hit(&p)) {
                        out.push(i);
                    }
                }
            }
        }
        out
    }

    fn js(&self, dir: &str, spec: &str) -> Option<usize> {
        let spec = spec.split(['?', '#']).next().unwrap_or(spec);
        let base = if let Some(r) = spec.strip_prefix("@/").or_else(|| spec.strip_prefix("~/")) {
            format!("src/{r}")
        } else if spec.starts_with("src/") {
            spec.to_string()
        } else if let Some(r) = spec.strip_prefix("package:") {
            // Dart: package:nome/x.dart → lib/x.dart
            format!("lib/{}", r.split_once('/')?.1)
        } else if spec.starts_with("./") || spec.starts_with("../") || (spec.ends_with(".dart") && !spec.contains(':')) {
            join(dir, spec)?
        } else {
            return None;
        };
        let mut cands = vec![base.clone()];
        for x in JS.iter().chain(CSS) {
            cands.push(format!("{base}.{x}"));
        }
        for x in JS {
            cands.push(format!("{base}/index.{x}"));
        }
        // ESM em TypeScript: import "./x.js" aponta para x.ts
        if let Some(s) = base.strip_suffix(".js").or_else(|| base.strip_suffix(".jsx")).or_else(|| base.strip_suffix(".mjs")) {
            cands.extend([format!("{s}.ts"), format!("{s}.tsx"), format!("{s}.mts")]);
        }
        self.first(cands)
    }

    /// `mod x;`, `crate::a::b` e `super::x`.
    fn rust(&self, f: &Src, out: &mut Vec<usize>) {
        let dir = dir_of(&f.rel);
        let stem = stem_of(&f.rel);
        let own = if matches!(stem, "main" | "lib" | "mod") { dir.to_string() } else { join(dir, stem).unwrap_or_default() };
        // a pasta src do crate: a mais próxima com lib.rs ou main.rs
        let mut root = Some(dir.to_string());
        let mut src = None;
        while let Some(d) = root {
            let p = |n: &str| if d.is_empty() { n.to_string() } else { format!("{d}/{n}") };
            if self.hit(&p("lib.rs")).is_some() || self.hit(&p("main.rs")).is_some() {
                src = Some(d.clone());
                break;
            }
            root = d.rsplit_once('/').map(|(a, _)| a.to_string()).or(if d.is_empty() { None } else { Some(String::new()) });
        }
        let module = |base: &str, segs: &[&str]| -> Option<usize> {
            for k in (1..=segs.len()).rev() {
                let p = join(base, &segs[..k].join("/"))?;
                if let Some(i) = self.first([format!("{p}.rs"), format!("{p}/mod.rs")]) {
                    return Some(i);
                }
            }
            None
        };
        for line in f.text.lines() {
            let t = line.trim();
            let t2 = t.trim_start_matches("pub(crate) ").trim_start_matches("pub(super) ").trim_start_matches("pub ");
            if let Some(name) = t2.strip_prefix("mod ").and_then(|r| r.strip_suffix(';')) {
                if let Some(i) = module(&own, &[name.trim()]) {
                    out.push(i);
                }
                continue;
            }
            for (key, base) in [("crate::", src.clone()), ("super::", Some(if stem == "mod" { dir_of(dir).to_string() } else { dir.to_string() }))] {
                let Some(base) = base else { continue };
                let mut rest = t;
                while let Some(at) = rest.find(key) {
                    let after = &rest[at + key.len()..];
                    rest = after;
                    let items: Vec<&str> = if let Some(inner) = after.strip_prefix('{') {
                        inner.split('}').next().unwrap_or("").split(',').collect()
                    } else {
                        vec![after]
                    };
                    for it in items {
                        let path: String = it.trim().chars().take_while(|c| c.is_alphanumeric() || *c == '_' || *c == ':').collect();
                        let segs: Vec<&str> = path.split("::").filter(|s| !s.is_empty()).collect();
                        if segs.is_empty() {
                            continue;
                        }
                        if let Some(i) = module(&base, &segs) {
                            out.push(i);
                        } else if key == "super::" {
                            // item do próprio módulo pai (pasta.rs ou pasta/mod.rs)
                            if let Some(i) = self.first([format!("{base}.rs"), format!("{base}/mod.rs")]) {
                                out.push(i);
                            }
                        }
                    }
                }
            }
        }
    }

    fn python(&self, f: &Src, out: &mut Vec<usize>) {
        let dir = dir_of(&f.rel);
        for line in f.text.lines().map(str::trim) {
            let specs: Vec<&str> = if let Some(r) = line.strip_prefix("from ") {
                vec![r.split_whitespace().next().unwrap_or("")]
            } else if let Some(r) = line.strip_prefix("import ") {
                r.split(',').map(|s| s.split_whitespace().next().unwrap_or("")).collect()
            } else {
                continue;
            };
            for spec in specs {
                let dots = spec.chars().take_while(|c| *c == '.').count();
                let path = spec[dots..].replace('.', "/");
                let bases: Vec<String> = if dots > 0 {
                    let mut d = dir.to_string();
                    for _ in 1..dots {
                        d = dir_of(&d).to_string();
                    }
                    vec![d]
                } else {
                    vec![String::new(), "src".into(), dir.to_string()]
                };
                let hit = bases.iter().find_map(|b| {
                    let p = if path.is_empty() { b.clone() } else { join(b, &path)? };
                    self.first([format!("{p}.py"), format!("{p}/__init__.py")])
                });
                if let Some(i) = hit {
                    out.push(i);
                }
            }
        }
    }

    /// Arquivo cujo caminho (sem extensão) termina em `a/b/C`.
    fn suffix(&self, path: &str) -> Option<usize> {
        let stem = path.rsplit('/').next()?;
        self.stems.get(stem)?.iter().copied().find(|&i| {
            let rel = &self.files[i].rel;
            let no_ext = rel.rsplit_once('.').map(|(a, _)| a).unwrap_or(rel);
            no_ext == path || no_ext.ends_with(&format!("/{path}"))
        })
    }

    /// Arquivo cujo caminho termina em `x/y.h`.
    fn suffix_file(&self, name: &str) -> Option<usize> {
        let stem = stem_of(name);
        self.stems.get(stem)?.iter().copied().find(|&i| {
            let rel = &self.files[i].rel;
            rel == name || rel.ends_with(&format!("/{name}"))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn put(root: &Path, rel: &str, text: &str) {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }

    #[test]
    fn links_imports_across_languages() {
        let t = tempfile::tempdir().unwrap();
        let r = t.path();
        put(r, "src/App.tsx", "import Home from \"./views/Home\";\nimport { a } from '@/lib/util';\nimport './styles.css';\n");
        put(r, "src/views/Home.tsx", "export default function Home() {}\nimport x from \"../lib/util.js\";\n");
        put(r, "src/lib/util.ts", "export const a = 1;\n");
        put(r, "src/styles.css", "@import \"./base\";\n");
        put(r, "src/_base.scss", "");
        put(r, "src/base.css", "body{}\n");
        put(r, "src-tauri/src/main.rs", "mod git;\nmod xray;\nfn main() { crate::xray::procs::kill_tree(1); }\n");
        put(r, "src-tauri/src/git.rs", "use crate::xray::procs;\nuse super::main;\n");
        put(r, "src-tauri/src/xray/mod.rs", "pub mod procs;\n");
        put(r, "src-tauri/src/xray/procs.rs", "use super::mod_helper;\n");
        put(r, "py/pkg/a.py", "from .b import x\nimport os\n");
        put(r, "py/pkg/b.py", "");
        put(r, "node_modules/x/index.js", "");

        let text = scan(r, "demo").unwrap();
        let v: serde_json::Value = serde_json::from_str(&text).unwrap();
        let nodes: Vec<&str> = v["nodes"].as_array().unwrap().iter().map(|n| n[0].as_str().unwrap()).collect();
        assert!(!nodes.iter().any(|n| n.starts_with("node_modules")));
        let id = |p: &str| nodes.iter().position(|n| *n == p).unwrap_or_else(|| panic!("{p} missing"));
        let links: HashSet<(usize, usize)> = v["links"].as_array().unwrap().iter().map(|l| (l[0].as_u64().unwrap() as usize, l[1].as_u64().unwrap() as usize)).collect();
        let has = |a: &str, b: &str| links.contains(&(id(a), id(b)));
        assert!(has("src/App.tsx", "src/views/Home.tsx"));
        assert!(has("src/App.tsx", "src/lib/util.ts"));
        assert!(has("src/App.tsx", "src/styles.css"));
        assert!(has("src/views/Home.tsx", "src/lib/util.ts"));
        assert!(has("src/styles.css", "src/base.css"));
        assert!(has("src-tauri/src/main.rs", "src-tauri/src/git.rs"));
        assert!(has("src-tauri/src/main.rs", "src-tauri/src/xray/mod.rs"));
        assert!(has("src-tauri/src/main.rs", "src-tauri/src/xray/procs.rs"));
        assert!(has("src-tauri/src/git.rs", "src-tauri/src/xray/procs.rs"));
        assert!(has("src-tauri/src/xray/mod.rs", "src-tauri/src/xray/procs.rs"));
        assert!(has("py/pkg/a.py", "py/pkg/b.py"));
        // grupos: views, lib, src-tauri…; o arquivo fica gravado
        let groups: Vec<&str> = v["groups"].as_array().unwrap().iter().map(|g| g[1].as_str().unwrap()).collect();
        assert!(groups.contains(&"views") && groups.contains(&"lib"));
        assert!(read(r).is_some());
    }

    #[test]
    fn areas_skip_wrapper_folders() {
        assert_eq!(area("src/components/X.tsx", 0), "src/components");
        assert_eq!(area("src/App.tsx", 0), "src");
        assert_eq!(area("README.md", 0), "");
        assert_eq!(area("src-tauri/src/xray/procs.rs", 0), "src-tauri");
        assert_eq!(area("src-tauri/src/xray/procs.rs", 1), "src-tauri/src/xray");
        assert_eq!(area("src-tauri/src/lib.rs", 1), "src-tauri/src");
        assert_eq!(area_label("src-tauri/src"), "src-tauri");
        assert_eq!(join("a/b", "../c"), Some("a/c".into()));
        assert_eq!(join("", "../c"), None);
    }
}

#[cfg(test)]
mod dump {
    /// `VEOCODE_MAP_ROOT=/pasta cargo test projmap::dump -- --ignored`: grava o mapa daquela pasta.
    #[test]
    #[ignore]
    fn scan_folder() {
        let root = std::env::var("VEOCODE_MAP_ROOT").expect("VEOCODE_MAP_ROOT");
        let text = super::scan(std::path::Path::new(&root), "Veocode").unwrap();
        println!("{} bytes", text.len());
    }
}
