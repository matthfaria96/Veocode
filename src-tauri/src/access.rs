//! Nível de acesso de verdade. O Claude Code obedece às regras de permissão do arquivo
//! `.claude/settings.local.json` do projeto (deny > ask > allow, valendo sobre qualquer outro
//! arquivo). O Veocode traduz o nível + os ajustes da pessoa nessas regras e grava SÓ as
//! dele: lembra o que escreveu (`Applied`) e, ao mudar de nível, tira exatamente aquilo antes
//! de pôr o novo. Regras que a pessoa escreveu à mão ficam intocadas.

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Rule {
    Permitido,
    Pergunta,
    Bloqueado,
}
use Rule::*;

/// O que foi gravado da última vez, para conseguir desfazer só isso.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Applied {
    pub file: String,
    pub allow: Vec<String>,
    pub ask: Vec<String>,
    pub deny: Vec<String>,
    /// chaves de `permissions` (defaultMode, block…) com o valor que o Veocode pôs
    pub keys: BTreeMap<String, Value>,
    /// valor que a chave tinha antes do Veocode trocar (volta ao desfazer)
    #[serde(default)]
    pub replaced: BTreeMap<String, Value>,
    pub at: u64,
}

pub struct Cap {
    pub id: &'static str,
    /// [português, inglês]
    pub label: [&'static str; 2],
    pub hint: [&'static str; 2],
    /// estado em cada nível: leitura, sugerir, editar, total
    pub levels: [Rule; 4],
    pub choices: &'static [Rule],
}

impl Cap {
    /// Nome no idioma da tela.
    pub fn label(&self) -> &'static str {
        crate::i18n::tr(self.label[0], self.label[1])
    }
    pub fn hint(&self) -> &'static str {
        crate::i18n::tr(self.hint[0], self.hint[1])
    }
}

const ALL: &[Rule] = &[Permitido, Pergunta, Bloqueado];
const NO_ALLOW: &[Rule] = &[Pergunta, Bloqueado];

pub const CAPS: &[Cap] = &[
    Cap { id: "edit", label: ["Editar arquivos", "Edit files"], hint: ["Edit, Write e notebooks. Em Pergunta, o Claude mostra o diff e espera você aprovar.", "Edit, Write and notebooks. On Asks, Claude shows the diff and waits for your approval."], levels: [Bloqueado, Pergunta, Permitido, Permitido], choices: ALL },
    Cap { id: "shell", label: ["Rodar comandos no terminal", "Run commands in the terminal"], hint: ["Em Pergunta, só comandos de leitura (ls, git status…) rodam sem perguntar.", "On Asks, only read commands (ls, git status…) run without asking."], levels: [Bloqueado, Pergunta, Pergunta, Permitido], choices: ALL },
    Cap { id: "install", label: ["Instalar no sistema", "Install on the system"], hint: ["brew, npm -g, pip, cargo install, sudo", "brew, npm -g, pip, cargo install, sudo"], levels: [Bloqueado, Bloqueado, Pergunta, Pergunta], choices: ALL },
    Cap { id: "push", label: ["Publicar com git push", "Publish with git push"], hint: ["manda o código para o GitHub ou outro remoto", "sends the code to GitHub or another remote"], levels: [Bloqueado, Bloqueado, Pergunta, Pergunta], choices: ALL },
    Cap { id: "vm", label: ["Criar VMs e containers", "Create VMs and containers"], hint: ["docker, podman, lima, colima, utm", "docker, podman, lima, colima, utm"], levels: [Bloqueado, Bloqueado, Pergunta, Pergunta], choices: ALL },
    Cap { id: "net", label: ["Acesso à internet", "Internet access"], hint: ["WebFetch e WebSearch; bloqueado também barra curl e wget", "WebFetch and WebSearch; blocked also stops curl and wget"], levels: [Pergunta, Pergunta, Permitido, Permitido], choices: ALL },
    Cap { id: "mcp", label: ["Ferramentas MCP", "MCP tools"], hint: ["servidores MCP da conta e do projeto", "the account's and the project's MCP servers"], levels: [Bloqueado, Pergunta, Pergunta, Pergunta], choices: NO_ALLOW },
    Cap { id: "secrets", label: ["Ler arquivos secretos", "Read secret files"], hint: [".env, chaves .pem/.key, ~/.ssh, ~/.aws", ".env, .pem/.key keys, ~/.ssh, ~/.aws"], levels: [Bloqueado, Bloqueado, Bloqueado, Pergunta], choices: ALL },
    Cap { id: "outside", label: ["Sair da pasta do projeto", "Leave the project folder"], hint: ["ler ou escrever com as ferramentas de arquivo fora desta pasta", "read or write with the file tools outside this folder"], levels: [Bloqueado, Bloqueado, Bloqueado, Pergunta], choices: NO_ALLOW },
];

pub const MODES: [&str; 4] = ["plan", "default", "acceptEdits", "acceptEdits"];

pub fn cap(id: &str) -> Option<&'static Cap> {
    CAPS.iter().find(|c| c.id == id)
}

/// Estado final de cada capacidade: o do nível, salvo ajuste manual válido.
pub fn effective(level: u8, overrides: &BTreeMap<String, Rule>) -> Vec<(&'static Cap, Rule)> {
    let l = level.min(3) as usize;
    CAPS.iter()
        .map(|c| {
            let r = overrides.get(c.id).copied().filter(|r| c.choices.contains(r)).unwrap_or(c.levels[l]);
            (c, r)
        })
        .collect()
}

#[derive(Debug, Default, PartialEq)]
pub struct Compiled {
    pub allow: Vec<String>,
    pub ask: Vec<String>,
    pub deny: Vec<String>,
    pub keys: BTreeMap<String, Value>,
}

impl Compiled {
    /// `{"permissions": {...}}` — o mesmo que vai para o arquivo (e para `claude --settings`).
    pub fn settings(&self) -> Value {
        let mut p = Map::new();
        for (k, list) in [("allow", &self.allow), ("ask", &self.ask), ("deny", &self.deny)] {
            if !list.is_empty() {
                p.insert(k.into(), json!(list));
            }
        }
        for (k, v) in &self.keys {
            p.insert(k.clone(), v.clone());
        }
        json!({ "permissions": p })
    }
}

fn bash(cmds: &[&str]) -> Vec<String> {
    cmds.iter().map(|c| format!("Bash({c} *)")).collect()
}

/// Regras de cada capacidade em cada estado. `None` = deixa o Claude no comportamento normal.
fn rules_for(id: &str, r: Rule) -> Vec<String> {
    let v = |xs: &[&str]| xs.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    match (id, r) {
        ("edit", _) => v(&["Edit", "Write", "NotebookEdit"]),
        ("shell", Permitido) => v(&["Bash"]),
        ("shell", Bloqueado) => {
            let mut x = v(&["Bash"]);
            if cfg!(windows) {
                x.push("PowerShell".into());
            }
            x
        }
        ("install", _) => bash(&["brew install", "brew upgrade", "npm install -g", "npm i -g", "pnpm add -g", "yarn global add", "pip install", "pip3 install", "pipx install", "cargo install", "gem install", "go install", "sudo"]),
        ("push", _) => bash(&["git push"]),
        ("vm", _) => bash(&["docker", "podman", "limactl", "colima", "utmctl", "multipass"]),
        ("net", Bloqueado) => {
            let mut x = v(&["WebFetch", "WebSearch"]);
            x.extend(bash(&["curl", "wget"]));
            x
        }
        ("net", Permitido) => v(&["WebFetch", "WebSearch"]),
        ("mcp", Bloqueado) => v(&["mcp__*"]),
        ("secrets", Bloqueado | Pergunta) => v(&[
            "Read(./**/.env)",
            "Read(./**/.env.local)",
            "Read(./**/.env.*.local)",
            "Read(./**/.env.production)",
            "Read(./**/*.pem)",
            "Read(./**/*.key)",
            "Read(./**/id_rsa*)",
            "Read(./**/id_ed25519*)",
            "Read(~/.ssh/**)",
            "Read(~/.aws/**)",
            "Read(~/.config/gh/**)",
        ]),
        _ => vec![],
    }
}

pub fn compile(level: u8, overrides: &BTreeMap<String, Rule>) -> Compiled {
    let mut c = Compiled::default();
    for (cap, r) in effective(level, overrides) {
        let rules = rules_for(cap.id, r);
        // Pergunta só vira regra `ask` onde o Claude normalmente NÃO perguntaria
        // (edição em acceptEdits, comandos específicos, segredos). Shell, internet e MCP
        // já perguntam sozinhos.
        let ask_explicit = matches!(cap.id, "edit" | "install" | "push" | "vm" | "secrets");
        let list = match r {
            Permitido => &mut c.allow,
            Pergunta if ask_explicit => &mut c.ask,
            Pergunta => continue,
            Bloqueado => &mut c.deny,
        };
        for x in rules {
            if !list.contains(&x) {
                list.push(x);
            }
        }
        if cap.id == "outside" && r == Bloqueado {
            c.keys.insert("blockReadsOutsideWorkingDirectories".into(), json!(true));
            c.keys.insert("blockWritesOutsideWorkingDirectories".into(), json!(true));
        }
    }
    let l = level.min(3) as usize;
    c.keys.insert("defaultMode".into(), json!(MODES[l]));
    if l < 3 {
        // sem isso, --dangerously-skip-permissions ou o modo auto passariam por cima do nível
        c.keys.insert("disableBypassPermissionsMode".into(), json!("disable"));
        c.keys.insert("disableAutoMode".into(), json!("disable"));
    }
    c
}

// ---------------------------------------------------------------- arquivo

/// Raiz do git que contém `root`, se houver.
pub fn git_root(root: &Path) -> Option<PathBuf> {
    root.ancestors().find(|d| d.join(".git").exists()).map(Path::to_path_buf)
}

/// Onde o Claude Code lê o settings.local.json: na raiz do repositório (fora do Windows).
pub fn settings_file(root: &Path) -> PathBuf {
    let base = if cfg!(windows) { None } else { git_root(root) };
    base.unwrap_or_else(|| root.to_path_buf()).join(".claude").join("settings.local.json")
}

fn read_json(file: &Path) -> Result<Map<String, Value>, String> {
    match fs::read_to_string(file) {
        Ok(s) if s.trim().is_empty() => Ok(Map::new()),
        Ok(s) => match serde_json::from_str::<Value>(&s) {
            Ok(Value::Object(m)) => Ok(m),
            // nunca sobrescreve um arquivo que não entende
            _ => Err(crate::trf!("{} não é um JSON válido. Corrija ou apague o arquivo e tente de novo.", "{} isn't valid JSON. Fix or delete the file and try again.", file.display())),
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Map::new()),
        Err(e) => Err(e.to_string()),
    }
}

fn write_json(file: &Path, m: &Map<String, Value>) -> Result<(), String> {
    if let Some(d) = file.parent() {
        fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    let tmp = file.with_extension("json.veocode-tmp");
    let mut s = serde_json::to_string_pretty(m).map_err(|e| e.to_string())?;
    s.push('\n');
    fs::write(&tmp, s).map_err(|e| e.to_string())?;
    fs::rename(&tmp, file).map_err(|e| e.to_string())
}

fn str_list(v: Option<&Value>) -> Vec<String> {
    v.and_then(Value::as_array).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default()
}

/// Tira de `perms` o que o Veocode tinha acrescentado (chaves só se ainda estiverem com o
/// valor que ele pôs; nesse caso volta o valor de antes, se havia).
fn strip(perms: &mut Map<String, Value>, prev: &Applied) {
    for (key, ours) in [("allow", &prev.allow), ("ask", &prev.ask), ("deny", &prev.deny)] {
        if let Some(Value::Array(a)) = perms.get_mut(key) {
            a.retain(|x| !x.as_str().is_some_and(|s| ours.iter().any(|o| o == s)));
        }
    }
    for (k, v) in &prev.keys {
        if perms.get(k) == Some(v) {
            match prev.replaced.get(k) {
                Some(old) => perms.insert(k.clone(), old.clone()),
                None => perms.remove(k),
            };
        }
    }
}

/// Grava as regras do nível. `prev` = o que o Veocode tinha gravado antes (é trocado).
pub fn apply(root: &Path, c: &Compiled, prev: Option<&Applied>, now: u64) -> Result<Applied, String> {
    let file = settings_file(root);
    let mut doc = read_json(&file)?;
    let mut perms = match doc.remove("permissions") {
        Some(Value::Object(m)) => m,
        _ => Map::new(),
    };
    if let Some(p) = prev {
        strip(&mut perms, p);
    }
    // guarda só o que foi ACRESCENTADO: regra igual que a pessoa já tinha continua sendo dela
    let mut added: [Vec<String>; 3] = Default::default();
    for (i, (key, ours)) in [("allow", &c.allow), ("ask", &c.ask), ("deny", &c.deny)].into_iter().enumerate() {
        let mut list = str_list(perms.get(key));
        for x in ours {
            if !list.contains(x) {
                list.push(x.clone());
                added[i].push(x.clone());
            }
        }
        if list.is_empty() {
            perms.remove(key);
        } else {
            perms.insert(key.into(), json!(list));
        }
    }
    let mut replaced = BTreeMap::new();
    for (k, v) in &c.keys {
        let in_file = perms.insert(k.clone(), v.clone());
        // o valor "de antes" é sempre o de antes do Veocode: se a chave já era nossa, herda o
        // que foi guardado (assim um bypassPermissions posto por fora nunca vira o "original")
        let before = match prev {
            Some(p) if p.keys.contains_key(k) => p.replaced.get(k).cloned(),
            _ => in_file.filter(|old| old != v),
        };
        if let Some(old) = before {
            replaced.insert(k.clone(), old);
        }
    }
    doc.insert("permissions".into(), Value::Object(perms));
    write_json(&file, &doc)?;
    exclude_from_git(root);
    let [allow, ask, deny] = added;
    Ok(Applied { file: file.to_string_lossy().into(), allow, ask, deny, keys: c.keys.clone(), replaced, at: now })
}

/// Desfaz: tira só o que o Veocode pôs. Se o arquivo ficar vazio, apaga.
pub fn remove(prev: &Applied) -> Result<(), String> {
    let file = PathBuf::from(&prev.file);
    if !file.exists() {
        return Ok(());
    }
    let mut doc = read_json(&file)?;
    if let Some(Value::Object(perms)) = doc.get_mut("permissions") {
        strip(perms, prev);
        for k in ["allow", "ask", "deny"] {
            if perms.get(k).and_then(Value::as_array).is_some_and(|a| a.is_empty()) {
                perms.remove(k);
            }
        }
        if perms.is_empty() {
            doc.remove("permissions");
        }
    }
    if doc.is_empty() {
        fs::remove_file(&file).map_err(|e| e.to_string())
    } else {
        write_json(&file, &doc)
    }
}

/// O arquivo é pessoal: põe em `.git/info/exclude` (local, não mexe no .gitignore do projeto).
fn exclude_from_git(root: &Path) {
    let Some(g) = git_root(root) else { return };
    let git = g.join(".git");
    if !git.is_dir() {
        return; // worktree/submódulo: .git é um arquivo; deixa quieto
    }
    let line = ".claude/settings.local.json";
    for f in [g.join(".gitignore"), git.join("info").join("exclude")] {
        if fs::read_to_string(&f).is_ok_and(|s| s.lines().any(|l| l.trim() == line || l.trim() == "/.claude/settings.local.json")) {
            return;
        }
    }
    let ex = git.join("info").join("exclude");
    let _ = fs::create_dir_all(git.join("info"));
    let mut s = fs::read_to_string(&ex).unwrap_or_default();
    if !s.is_empty() && !s.ends_with('\n') {
        s.push('\n');
    }
    s += &crate::trf!("# Veocode: regras de acesso pessoais\n{line}\n", "# Veocode: personal access rules\n{line}\n");
    let _ = fs::write(&ex, s);
}

// ---------------------------------------------------------------- relatório

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CapRow {
    pub id: String,
    pub label: String,
    pub hint: String,
    pub rule: Rule,
    pub from_level: Rule,
    pub choices: Vec<Rule>,
    pub rules: Vec<String>,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Loosen {
    pub source: String,
    pub rule: String,
    pub cap: String,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase", tag = "state")]
pub enum FileState {
    /// o Veocode ainda não gravou nada neste projeto
    NaoAplicado,
    Aplicado,
    /// alguém mexeu: faltam regras do Veocode ou a chave mudou
    Alterado { missing: Vec<String> },
    Erro { message: String },
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub level: u8,
    pub mode: String,
    pub caps: Vec<CapRow>,
    pub file: String,
    pub file_state: FileState,
    /// regras da pessoa no mesmo arquivo (o Veocode não mexe)
    pub own_rules: Vec<String>,
    /// regras de outros arquivos que deixam passar algo que o nível manda perguntar
    pub loosen: Vec<Loosen>,
    /// o trecho `permissions` que o Veocode grava
    pub preview: String,
}

fn touches(cap: &str, rule: &str) -> bool {
    let tool = rule.split('(').next().unwrap_or(rule);
    match cap {
        "shell" => tool == "Bash" || tool == "PowerShell",
        "net" => tool == "WebFetch" || tool == "WebSearch",
        "mcp" => tool.starts_with("mcp__"),
        _ => false,
    }
}

/// `others`: (nome para mostrar, caminho) dos outros arquivos de configuração que valem aqui.
pub fn report(root: &Path, level: u8, overrides: &BTreeMap<String, Rule>, applied: Option<&Applied>, others: &[(String, PathBuf)]) -> Report {
    let c = compile(level, overrides);
    let l = level.min(3) as usize;
    let eff = effective(level, overrides);
    let caps = eff
        .iter()
        .map(|(cap, r)| CapRow {
            id: cap.id.into(),
            label: cap.label().into(),
            hint: cap.hint().into(),
            rule: *r,
            from_level: cap.levels[l],
            choices: cap.choices.to_vec(),
            rules: rules_for(cap.id, *r),
        })
        .collect();

    // raiz vazia = só prévia (projeto demo): não lê nada do disco
    let preview_only = root.as_os_str().is_empty();
    let file = if preview_only { PathBuf::new() } else { settings_file(root) };
    let doc = if preview_only { Ok(Map::new()) } else { read_json(&file) };
    let perms = doc.as_ref().ok().and_then(|d| d.get("permissions")).and_then(Value::as_object).cloned().unwrap_or_default();
    let in_file = |k: &str| str_list(perms.get(k));

    let file_state = match (&doc, applied) {
        (Err(e), _) => FileState::Erro { message: e.clone() },
        (_, None) => FileState::NaoAplicado,
        (Ok(_), Some(_)) => {
            let mut missing = vec![];
            for (k, ours) in [("allow", &c.allow), ("ask", &c.ask), ("deny", &c.deny)] {
                let have = in_file(k);
                missing.extend(ours.iter().filter(|x| !have.contains(x)).map(|x| format!("{k}: {x}")));
            }
            for (k, v) in &c.keys {
                if perms.get(k) != Some(v) {
                    missing.push(format!("{k}: {v}"));
                }
            }
            if missing.is_empty() { FileState::Aplicado } else { FileState::Alterado { missing } }
        }
    };

    let ours = applied.cloned().unwrap_or_default();
    let mut own_rules = vec![];
    for (k, mine) in [("allow", &ours.allow), ("ask", &ours.ask), ("deny", &ours.deny)] {
        own_rules.extend(in_file(k).into_iter().filter(|x| !mine.contains(x)).map(|x| format!("{k}: {x}")));
    }

    // regras `allow` (deste arquivo e dos outros) que passam por cima de um "Pergunta" implícito
    let asking: Vec<&str> = eff.iter().filter(|(cap, r)| *r == Pergunta && matches!(cap.id, "shell" | "net" | "mcp")).map(|(cap, _)| cap.id).collect();
    let mut loosen = vec![];
    let mut sources: Vec<(String, Vec<String>, Option<String>)> = others
        .iter()
        .filter_map(|(name, p)| {
            let d = read_json(p).ok()?;
            let pm = d.get("permissions").and_then(Value::as_object).cloned().unwrap_or_default();
            Some((name.clone(), str_list(pm.get("allow")), pm.get("defaultMode").and_then(Value::as_str).map(String::from)))
        })
        .collect();
    sources.push((crate::i18n::tr("este projeto (suas regras)", "this project (your rules)").into(), in_file("allow").into_iter().filter(|x| !ours.allow.contains(x)).collect(), None));
    for (name, allows, mode) in sources {
        for a in allows {
            if let Some(cap) = asking.iter().find(|cap| touches(cap, &a)) {
                loosen.push(Loosen { source: name.clone(), rule: a, cap: cap.to_string() });
            }
        }
        if let Some(m) = mode.filter(|m| m == "bypassPermissions" || m == "auto") {
            loosen.push(Loosen { source: name.clone(), rule: format!("defaultMode: {m}"), cap: "modo".into() });
        }
    }

    let preview = serde_json::to_string_pretty(&c.settings()).unwrap_or_default();

    Report { level, mode: MODES[l].into(), caps, file: file.to_string_lossy().into(), file_state, own_rules, loosen, preview }
}

// ---------------------------------------------------------------- testes

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("veocode-access-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn levels_get_stricter_downwards() {
        let none = BTreeMap::new();
        let read = compile(0, &none);
        assert!(read.deny.contains(&"Edit".to_string()));
        assert!(read.deny.contains(&"Bash".to_string()));
        assert!(read.deny.contains(&"mcp__*".to_string()));
        assert_eq!(read.keys["defaultMode"], json!("plan"));
        assert_eq!(read.keys["disableBypassPermissionsMode"], json!("disable"));

        let suggest = compile(1, &none);
        assert!(suggest.ask.contains(&"Edit".to_string()));
        assert!(!suggest.deny.contains(&"Bash".to_string()));
        assert!(suggest.deny.contains(&"Bash(git push *)".to_string()));

        let total = compile(3, &none);
        assert!(total.allow.contains(&"Bash".to_string()));
        // ask vence allow: push e sudo continuam perguntando mesmo no Total
        assert!(total.ask.contains(&"Bash(git push *)".to_string()));
        assert!(total.ask.contains(&"Bash(sudo *)".to_string()));
        assert!(!total.keys.contains_key("disableBypassPermissionsMode"));
    }

    #[test]
    fn override_wins_but_only_valid_choices() {
        let mut o = BTreeMap::new();
        o.insert("push".to_string(), Permitido);
        o.insert("mcp".to_string(), Permitido); // não existe allow para mcp__* → ignora
        let c = compile(2, &o);
        assert!(c.allow.contains(&"Bash(git push *)".to_string()));
        assert!(!c.allow.iter().any(|x| x.starts_with("mcp__")));
    }

    #[test]
    fn apply_keeps_own_rules_and_swaps_ours() {
        let root = tmp("apply");
        fs::create_dir_all(root.join(".git/info")).unwrap();
        fs::create_dir_all(root.join(".claude")).unwrap();
        fs::write(root.join(".claude/settings.local.json"), r#"{"model":"opus","permissions":{"allow":["Bash(npm run *)"],"deny":["Edit"],"defaultMode":"default"}}"#).unwrap();

        let none = BTreeMap::new();
        let a0 = apply(&root, &compile(0, &none), None, 1).unwrap();
        let r = report(&root, 0, &none, Some(&a0), &[]);
        assert_eq!(r.file_state, FileState::Aplicado);
        assert!(r.own_rules.contains(&"allow: Bash(npm run *)".to_string()));
        assert!(r.own_rules.contains(&"deny: Edit".to_string()));
        assert_eq!(a0.replaced["defaultMode"], json!("default"));

        // sobe para Total: as regras de Leitura saem, as da pessoa ficam
        let a3 = apply(&root, &compile(3, &none), Some(&a0), 2).unwrap();
        let doc: Value = serde_json::from_str(&fs::read_to_string(root.join(".claude/settings.local.json")).unwrap()).unwrap();
        let p = &doc["permissions"];
        assert_eq!(doc["model"], json!("opus"));
        assert!(p["allow"].as_array().unwrap().contains(&json!("Bash(npm run *)")));
        assert!(!p["deny"].as_array().unwrap().contains(&json!("Bash")));
        // "Edit" em deny já era da pessoa: continua lá
        assert!(p["deny"].as_array().unwrap().contains(&json!("Edit")));
        assert_eq!(p["defaultMode"], json!("acceptEdits"));
        assert!(p.get("disableBypassPermissionsMode").is_none());

        // a regra da pessoa que libera Bash aparece como afrouxando um "Pergunta"
        let r2 = report(&root, 2, &none, Some(&a3), &[]);
        assert!(r2.loosen.iter().any(|l| l.rule == "Bash(npm run *)" && l.cap == "shell"));

        // .git/info/exclude ganhou a linha
        assert!(fs::read_to_string(root.join(".git/info/exclude")).unwrap().contains(".claude/settings.local.json"));

        // desfazer: volta exatamente ao que era da pessoa
        remove(&a3).unwrap();
        let doc: Value = serde_json::from_str(&fs::read_to_string(root.join(".claude/settings.local.json")).unwrap()).unwrap();
        assert_eq!(doc["permissions"], json!({"allow":["Bash(npm run *)"],"deny":["Edit"],"defaultMode":"default"}));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn detects_manual_change_and_refuses_bad_json() {
        let root = tmp("drift");
        let none = BTreeMap::new();
        let a = apply(&root, &compile(1, &none), None, 1).unwrap();
        let f = root.join(".claude/settings.local.json");
        let s = fs::read_to_string(&f).unwrap().replace("\"Edit\",", "");
        fs::write(&f, s).unwrap();
        match report(&root, 1, &none, Some(&a), &[]).file_state {
            FileState::Alterado { missing } => assert!(missing.contains(&"ask: Edit".to_string())),
            other => panic!("{other:?}"),
        }
        // modo trocado por fora: regravar e desfazer volta ao ORIGINAL (sem defaultMode), não ao de fora
        let mut d: Value = serde_json::from_str(&fs::read_to_string(&f).unwrap()).unwrap();
        d["permissions"]["defaultMode"] = json!("bypassPermissions");
        fs::write(&f, d.to_string()).unwrap();
        let a = apply(&root, &compile(1, &none), Some(&a), 2).unwrap();
        assert!(a.replaced.is_empty());
        remove(&a).unwrap();
        assert!(!f.exists());
        let a = apply(&root, &compile(1, &none), None, 3).unwrap();
        fs::write(&f, "{ quebrado").unwrap();
        assert!(apply(&root, &compile(1, &none), Some(&a), 2).is_err());
        assert_eq!(fs::read_to_string(&f).unwrap(), "{ quebrado");
        // sem git: arquivo fica na própria pasta
        assert_eq!(settings_file(&root), root.join(".claude/settings.local.json"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn remove_deletes_file_when_only_ours() {
        let root = tmp("remove");
        let a = apply(&root, &compile(2, &BTreeMap::new()), None, 1).unwrap();
        remove(&a).unwrap();
        assert!(!root.join(".claude/settings.local.json").exists());
        let _ = fs::remove_dir_all(&root);
    }
}
