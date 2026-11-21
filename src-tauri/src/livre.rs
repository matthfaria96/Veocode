//! Chat livre: conversa sem projeto, para tirar dúvidas rápidas. Conversa normalmente e, quando
//! a pergunta pede, olha o computador.
//!
//! Usa a mesma máquina dos chats de projeto (chat.rs) com o id especial [`ID`]. O que muda é
//! onde e com que regras roda:
//! - o Claude roda sempre na pasta própria do Chat livre (dados do app/chat-livre), para as
//!   conversas ficarem juntas e poderem ser retomadas; a pasta pessoal entra como pasta extra
//!   (`--add-dir`), para ele poder ler o computador quando ajudar;
//! - o nível vem dos ajustes (o selo de permissão na caixa de mensagem): Leitura por padrão, em
//!   modo de conversa normal, não de plano. Em Leitura os comandos de leitura (ls, du, cat…) rodam
//!   sem perguntar, como no Claude Code normal; os que mudam algo (rm, mv, touch…) ficam
//!   bloqueados e qualquer outro pede aprovação. Editar arquivos continua bloqueado;
//! - pastas de credenciais da pasta pessoal ficam bloqueadas em qualquer nível (tools.rs `PRIVATE`);
//! - pesquisar na internet não pergunta; abrir páginas pergunta até o nível Editar, para nada
//!   lido no PC sair numa URL sem você ver.

use crate::access::{self, Rule};

/// Comandos que mudam algo no computador: bloqueados em Leitura (os de leitura rodam sozinhos).
const CHANGES: &[&str] = &[
    "rm", "rmdir", "mv", "cp", "ln", "touch", "mkdir", "chmod", "chown", "chflags", "xattr", "dd", "truncate", "shred", "srm", "trash", "tee",
    "kill", "killall", "pkill", "osascript", "shutdown", "reboot", "halt", "diskutil", "launchctl", "crontab", "defaults write", "defaults delete",
    "git commit", "git reset", "git checkout", "git clean", "git rm", "git mv", "git restore", "git stash", "npm install", "npm i", "pnpm install", "yarn add",
];
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub const ID: &str = "livre";

/// Pasta própria do Chat livre.
pub fn dir(data: &Path) -> PathBuf {
    data.join("chat-livre")
}

pub struct Target {
    /// pasta do processo do Claude (sempre a do Chat livre)
    pub cwd: PathBuf,
    /// raiz das ferramentas das contas por API (pasta pessoal ou a do chat)
    pub tools_root: PathBuf,
    pub add_dir: Option<PathBuf>,
    pub level: u8,
    pub overrides: BTreeMap<String, Rule>,
    pub settings: Value,
    pub mode: &'static str,
    /// instruções extras: vão no `--append-system-prompt` do Claude e no lugar das do projeto nas APIs
    pub prompt: String,
    pub tools: bool,
}

/// Regras do Claude que barram as pastas de credenciais da pasta pessoal.
/// As de segredos do nível (.env, chaves) valem só na pasta do processo; estas valem na pessoal toda.
pub fn private_rules() -> Vec<String> {
    let mut v: Vec<String> = crate::tools::PRIVATE.iter().flat_map(|x| [format!("Read(~/{x})"), format!("Read(~/{x}/**)")]).collect();
    for x in [".env", ".env.*", "*.pem", "*.key", "id_rsa*", "id_ed25519*"] {
        v.push(format!("Read(~/**/{x})"));
    }
    v
}

pub fn target(data: &Path, home: &Path, level: u8) -> Result<Target, String> {
    let level = level.min(3);
    let cwd = dir(data);
    std::fs::create_dir_all(&cwd).map_err(|e| crate::trf!("não deu para criar a pasta do Chat livre: {e}", "couldn't create the Free chat folder: {e}"))?;
    // Leitura: o terminal fica em "pergunta" (o Claude roda sozinho só o que é de leitura) em vez de
    // bloqueado, para dar um `ls` numa pasta; o que muda algo vai para a lista de bloqueio abaixo
    let mut overrides = BTreeMap::new();
    if level == 0 {
        overrides.insert("shell".to_string(), Rule::Pergunta);
    }
    let mut c = access::compile(level, &overrides);
    if level == 0 {
        for x in CHANGES.iter().map(|c| format!("Bash({c} *)")) {
            if !c.deny.contains(&x) {
                c.deny.push(x);
            }
        }
    }
    for x in private_rules() {
        if !c.deny.contains(&x) {
            c.deny.push(x);
        }
    }
    // pesquisar não leva nada do computador: não pergunta
    if !c.allow.iter().any(|x| x == "WebSearch") {
        c.allow.push("WebSearch".into());
    }
    // Leitura conversa normalmente (o modo de plano faria ele só planejar)
    let mode = if level == 0 { "default" } else { access::MODES[level as usize] };
    c.keys.insert("defaultMode".into(), Value::String(mode.into()));
    let base = crate::i18n::tr("Você está no Chat livre do Veocode: uma conversa geral, fora de qualquer projeto, para tirar dúvidas rápidas. \
                Responda em português do Brasil, direto e amigável.", "You're in Veocode's Free chat: a general conversation, outside any project, for quick questions. Answer in the language the person writes in (English if unsure), direct and friendly.");
    let can = match level {
        0 => crate::i18n::tr("Você só lê: não edita nem cria arquivos. Pode rodar comandos de leitura (ls, du, wc, head, mdfind, find sem -delete…) para olhar o computador; comandos que mudam algo estão bloqueados, não tente.", "You only read: you don't edit or create files. You can run read-only commands (ls, du, wc, head, mdfind, find without -delete…) to look around the computer; commands that change something are blocked, don't try them."),
        1 => crate::i18n::tr("Pode editar arquivos e rodar comandos, mas cada um espera a aprovação da pessoa: só faça isso quando ela pedir.", "You can edit files and run commands, but each one waits for the person's approval: only do it when they ask."),
        2 => crate::i18n::tr("Pode editar arquivos quando a pessoa pedir; comandos esperam a aprovação dela.", "You can edit files when the person asks; commands wait for their approval."),
        _ => crate::i18n::tr("Pode editar arquivos e rodar comandos quando a pessoa pedir.", "You can edit files and run commands when the person asks."),
    };
    let prompt = crate::trf!(
        "{base} {can}\nPara perguntas gerais, responda direto, sem abrir nada. Quando a pergunta for sobre o computador \
         (achar um arquivo, explicar um documento, ver o que tem numa pasta), pode listar, ler e buscar na pasta pessoal, {}. \
         Prefira pastas específicas (Documents, Downloads, Desktop) a varrer a pasta pessoal inteira, e diga em uma linha o que \
         vai olhar antes de abrir algo pessoal. Pastas de credenciais (.ssh, .aws, chaveiro, cookies e afins) estão bloqueadas: \
         não tente abrir. Pode pesquisar na internet quando ajudar.",
        "{base} {can}\nFor general questions, answer directly without opening anything. When the question is about the computer (find a file, explain a document, see what's in a folder), you can list, read and search the home folder, {}. Prefer specific folders (Documents, Downloads, Desktop) over scanning the whole home folder, and say in one line what you're going to look at before opening something personal. Credential folders (.ssh, .aws, keychain, cookies and the like) are blocked: don't try to open them. You can search the web when it helps.",
        home.display()
    );
    Ok(Target {
        tools_root: home.to_path_buf(),
        add_dir: Some(home.to_path_buf()),
        cwd,
        level,
        overrides,
        settings: c.settings(),
        mode,
        prompt,
        tools: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn free_chat_rules() {
        let data = std::env::temp_dir().join(format!("veocode-livre-{}", std::process::id()));
        let home = Path::new("/Users/ana");
        let list = |t: &Target, k: &str| t.settings["permissions"][k].as_array().map(|a| a.iter().map(|v| v.as_str().unwrap().to_string()).collect::<Vec<_>>()).unwrap_or_default();

        // Leitura (padrão): conversa normal, lê a pasta pessoal, nada de editar, rodar comandos ou MCP
        let t = target(&data, home, 0).unwrap();
        assert!(t.cwd.is_dir() && t.tools && t.mode == "default" && t.level == 0);
        assert_eq!(t.add_dir.as_deref(), Some(home));
        assert_eq!(t.tools_root, home);
        assert!(t.prompt.contains("/Users/ana"));
        assert_eq!(t.settings["permissions"]["defaultMode"], "default");
        let deny = list(&t, "deny");
        for x in ["Edit", "Write", "mcp__*", "Bash(rm *)", "Bash(mv *)", "Bash(touch *)", "Bash(git push *)", "Read(~/.ssh/**)", "Read(~/Library/Keychains/**)", "Read(~/.netrc)"] {
            assert!(deny.contains(&x.to_string()), "{x}");
        }
        // o terminal não fica todo bloqueado: os comandos de leitura (ls…) rodam sozinhos
        assert!(!deny.contains(&"Bash".to_string()));
        assert_eq!(t.overrides.get("shell"), Some(&Rule::Pergunta));
        // pesquisar não pergunta; abrir páginas pergunta (não está nem liberado nem barrado)
        let allow = list(&t, "allow");
        assert!(allow.contains(&"WebSearch".to_string()) && !allow.contains(&"WebFetch".to_string()));
        assert!(!deny.contains(&"WebFetch".to_string()));

        // Total: edita e roda comandos, mas as credenciais continuam barradas
        let t = target(&data, home, 9).unwrap();
        assert_eq!((t.level, t.mode), (3, "acceptEdits"));
        let deny = list(&t, "deny");
        assert!(!deny.contains(&"Bash".to_string()) && !deny.contains(&"Edit".to_string()) && !deny.contains(&"Bash(rm *)".to_string()));
        assert!(deny.contains(&"Read(~/.ssh/**)".to_string()));
        assert!(list(&t, "allow").contains(&"Bash".to_string()));
        let _ = std::fs::remove_dir_all(&data);
    }
}
