// Raio-x do contexto de uma conversa do Claude: roda `/context` sem tocar na sessão
// (`--no-session-persistence`) e transforma a tabela em markdown que ele devolve em dados.

use serde::Serialize;
use serde_json::Value;
use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[derive(Debug, Serialize, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub name: String,
    pub tokens: u64,
    pub pct: f64,
}

#[derive(Debug, Serialize, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub name: String,
    /// origem (servidor do MCP, "User", "Plugin (x)"…), quando a tabela tem
    pub source: Option<String>,
    pub tokens: u64,
    /// como o Claude escreveu ("~120", "< 20", "2.1k")
    pub label: String,
}

#[derive(Debug, Serialize, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub title: String,
    pub items: Vec<Item>,
}

#[derive(Debug, Serialize, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Context {
    pub model: Option<String>,
    pub used: u64,
    pub total: u64,
    pub categories: Vec<Category>,
    pub groups: Vec<Group>,
}

/// "26.8k" → 26800, "~120" → 120, "< 20" → 20, "1.2M" → 1200000.
pub fn parse_tokens(s: &str) -> u64 {
    let t: String = s.trim().trim_start_matches(['~', '<', '>', ' ']).replace(',', "");
    let t = t.trim();
    let (num, mult) = match t.chars().last() {
        Some('k' | 'K') => (&t[..t.len() - 1], 1_000.0),
        Some('m' | 'M') => (&t[..t.len() - 1], 1_000_000.0),
        _ => (t, 1.0),
    };
    num.trim().parse::<f64>().map(|n| (n * mult).round() as u64).unwrap_or(0)
}

fn cells(line: &str) -> Option<Vec<String>> {
    let l = line.trim();
    if !l.starts_with('|') {
        return None;
    }
    Some(l.trim_matches('|').split('|').map(|c| c.trim().to_string()).collect())
}

/// Lê o markdown do `/context`.
pub fn parse(md: &str) -> Context {
    let mut out = Context::default();
    let mut section = String::new();
    let mut header: Option<Vec<String>> = None;
    for line in md.lines() {
        let l = line.trim();
        if let Some(m) = l.strip_prefix("**Model:**") {
            out.model = Some(m.trim().to_string()).filter(|m| !m.is_empty());
            continue;
        }
        if let Some(t) = l.strip_prefix("**Tokens:**") {
            // "40.9k / 400k (10%)"
            let t = t.split('(').next().unwrap_or("");
            let mut it = t.split('/');
            out.used = parse_tokens(it.next().unwrap_or(""));
            out.total = parse_tokens(it.next().unwrap_or(""));
            continue;
        }
        if let Some(h) = l.strip_prefix('#') {
            section = h.trim_start_matches('#').trim().to_string();
            header = None;
            continue;
        }
        let Some(row) = cells(l) else {
            if !l.is_empty() {
                header = None;
            }
            continue;
        };
        if row.iter().all(|c| c.chars().all(|ch| ch == '-' || ch == ':' || ch == ' ')) {
            continue; // |----|----|
        }
        let Some(head) = &header else {
            header = Some(row);
            continue;
        };
        if row.len() < 2 || row[0].is_empty() {
            continue;
        }
        if head.first().is_some_and(|h| h.eq_ignore_ascii_case("Category")) {
            let tokens = parse_tokens(&row[1]);
            let pct = row.get(2).map(|p| p.trim_end_matches('%').trim().parse::<f64>().unwrap_or(0.0)).unwrap_or(0.0);
            out.categories.push(Category { name: row[0].clone(), tokens, pct });
            continue;
        }
        let label = row.last().cloned().unwrap_or_default();
        let source = (row.len() > 2).then(|| row[1..row.len() - 1].join(" · ")).filter(|s| !s.is_empty());
        let item = Item { name: row[0].clone(), source, tokens: parse_tokens(&label), label };
        match out.groups.last_mut().filter(|g| g.title == section) {
            Some(g) => g.items.push(item),
            None => out.groups.push(Group { title: section.clone(), items: vec![item] }),
        }
    }
    out
}

/// Roda `/context` para a conversa (`session`) ou, sem sessão, para uma conversa nova no projeto.
pub fn run(a: &crate::chat::SendArgs, session: Option<&str>) -> Result<Context, String> {
    let claude = crate::xray::util::which("claude").ok_or(crate::i18n::tr("Não achei o comando `claude`. Instale o Claude Code e tente de novo.", "Couldn't find the `claude` command. Install Claude Code and try again."))?;
    let mut cmd = Command::new(&claude);
    cmd.args(["-p", "/context", "--no-session-persistence", "--output-format", "json"]).arg("--settings").arg(a.settings.to_string());
    if let Some(d) = &a.add_dir {
        cmd.arg("--add-dir").arg(d);
    }
    if let Some(p) = a.prompt.as_deref().filter(|p| !p.is_empty()) {
        cmd.arg("--append-system-prompt").arg(p);
    }
    if let Some(m) = a.account.model.as_deref().filter(|m| !m.is_empty()) {
        cmd.args(["--model", m]);
    }
    if let Some(s) = session {
        cmd.arg(format!("--resume={s}"));
    }
    crate::chat::claude_env(&mut cmd, &claude, &a.account);
    cmd.current_dir(&a.root).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let mut child = cmd.spawn().map_err(|e| crate::trf!("não deu para abrir o Claude: {e}", "couldn't open Claude: {e}"))?;
    let mut stdout = child.stdout.take().ok_or(crate::i18n::tr("sem saída do Claude", "no output from Claude"))?;
    let mut stderr = child.stderr.take();
    let reader = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stdout.read_to_string(&mut s);
        s
    });
    let err_reader = std::thread::spawn(move || {
        let mut s = String::new();
        if let Some(se) = stderr.as_mut() {
            let _ = se.read_to_string(&mut s);
        }
        s
    });
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if start.elapsed() > Duration::from_secs(90) => {
                let _ = child.kill();
                return Err(crate::i18n::tr("O Claude demorou demais para medir o contexto.", "Claude took too long to measure the context.").into());
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(100)),
            Err(e) => return Err(e.to_string()),
        }
    }
    let raw = reader.join().unwrap_or_default();
    let err = err_reader.join().unwrap_or_default();
    let v: Value = serde_json::from_str(raw.trim()).map_err(|_| {
        let why = err.trim().lines().last().unwrap_or("").to_string();
        if why.is_empty() { crate::i18n::tr("O Claude não respondeu ao /context.", "Claude didn't answer /context.").to_string() } else { why }
    })?;
    let md = v.get("result").and_then(Value::as_str).unwrap_or("");
    let ctx = parse(md);
    if ctx.total == 0 {
        return Err(crate::i18n::tr("Não deu para ler o contexto desta conversa.", "Couldn't read this conversation's context.").into());
    }
    Ok(ctx)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "## Context Usage\n\n**Model:** claude-opus-5-5  \n**Tokens:** 40.9k / 400k (10%)\n\n### Estimated usage by category\n\n| Category | Tokens | Percentage |\n|----------|--------|------------|\n| System prompt | 2.9k | 0.7% |\n| Messages | 15.5k | 3.9% |\n| Free space | 326.2k | 81.5% |\n| Autocompact buffer | 33k | 8.3% |\n\n### MCP Tools\n\n| Tool | Server | Tokens |\n|------|--------|--------|\n| mcp__x__y | x | 1.1k |\n\n### Skills\n\n| Skill | Source | Tokens |\n|-------|--------|--------|\n| dataviz | Built-in | ~480 |\n| docs | claude.ai sync | < 20 |\n";

    #[test]
    fn tokens() {
        assert_eq!(parse_tokens("26.8k"), 26_800);
        assert_eq!(parse_tokens("~120"), 120);
        assert_eq!(parse_tokens("< 20"), 20);
        assert_eq!(parse_tokens("1.2M"), 1_200_000);
        assert_eq!(parse_tokens("400"), 400);
        assert_eq!(parse_tokens("?"), 0);
    }

    #[test]
    fn sample() {
        let c = parse(SAMPLE);
        assert_eq!(c.model.as_deref(), Some("claude-opus-5-5"));
        assert_eq!((c.used, c.total), (40_900, 400_000));
        assert_eq!(c.categories.len(), 4);
        assert_eq!(c.categories[1], Category { name: "Messages".into(), tokens: 15_500, pct: 3.9 });
        assert_eq!(c.groups.len(), 2);
        assert_eq!(c.groups[0].title, "MCP Tools");
        assert_eq!(c.groups[0].items[0].source.as_deref(), Some("x"));
        assert_eq!(c.groups[1].items[1], Item { name: "docs".into(), source: Some("claude.ai sync".into()), tokens: 20, label: "< 20".into() });
    }
}
