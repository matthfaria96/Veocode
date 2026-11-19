//! Chat livre: conversa sem projeto, para tirar dúvidas e, se a pessoa ligar, olhar o
//! computador (só leitura).
//!
//! Usa a mesma máquina dos chats de projeto (chat.rs) com o id especial [`ID`]. O que muda é
//! onde e com que regras roda:
//! - o Claude roda sempre na pasta própria do Chat livre (dados do app/chat-livre), para as
//!   conversas ficarem juntas e poderem ser retomadas; com o computador ligado, a pasta pessoal
//!   entra como pasta extra (`--add-dir`);
//! - o nível é o de Leitura (nada de editar nem rodar comandos), mas em modo de conversa
//!   normal, não de plano;
//! - pastas de credenciais da pasta pessoal ficam bloqueadas (tools.rs `PRIVATE`);
//! - só conversa: a internet roda sem perguntar (não há arquivo para vazar). Com o computador
//!   ligado, abrir páginas volta a pedir aprovação, para nada lido no PC sair numa URL.

use crate::access::{self, Rule};
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

pub fn target(data: &Path, home: &Path, pc: bool) -> Result<Target, String> {
    let cwd = dir(data);
    std::fs::create_dir_all(&cwd).map_err(|e| crate::trf!("não deu para criar a pasta do Chat livre: {e}", "couldn't create the Free chat folder: {e}"))?;
    let mut overrides = BTreeMap::new();
    overrides.insert("net".to_string(), if pc { Rule::Pergunta } else { Rule::Permitido });
    let mut c = access::compile(0, &overrides);
    for x in private_rules() {
        if !c.deny.contains(&x) {
            c.deny.push(x);
        }
    }
    let base = crate::i18n::tr("Você está no Chat livre do Veocode: uma conversa geral, fora de qualquer projeto, para tirar dúvidas. \
                Responda em português do Brasil, direto e amigável. Você não edita nem cria arquivos e não roda comandos.", "You're in Veocode's Free chat: a general conversation, outside any project, for questions. Answer in the language the person writes in (English if unsure), direct and friendly. You don't edit or create files and don't run commands.");
    let prompt = if pc {
        crate::trf!(
            "{base}\nA pessoa deixou você olhar o computador dela, só para ler. A pasta pessoal é {}. \
             Pode listar, ler e buscar arquivos para responder (achar um arquivo, explicar um documento, ver o que tem numa pasta). \
             Pastas de credenciais (.ssh, .aws, chaveiro, cookies e afins) estão bloqueadas: não tente abrir. \
             Prefira buscas em pastas específicas (Documents, Downloads, Desktop) a varrer a pasta pessoal inteira, \
             e diga em uma linha o que vai olhar antes de abrir algo pessoal.", "{base}\nThe person let you look at their computer, read-only. The home folder is {}. You can list, read and search files to answer (find a file, explain a document, see what's in a folder). Credential folders (.ssh, .aws, keychain, cookies and the like) are blocked: don't try to open them. Prefer searching specific folders (Documents, Downloads, Desktop) over scanning the whole home folder, and say in one line what you're going to look at before opening something personal.",
            home.display()
        )
    } else {
        crate::trf!("{base}\nVocê não tem acesso aos arquivos do computador: só vê o que a pessoa escrever. Pode pesquisar na internet quando ajudar.", "{base}\nYou have no access to the computer's files: you only see what the person writes. You can search the web when it helps.")
    };
    Ok(Target {
        tools_root: if pc { home.to_path_buf() } else { cwd.clone() },
        add_dir: pc.then(|| home.to_path_buf()),
        cwd,
        level: 0,
        overrides,
        settings: c.settings(),
        mode: "default",
        prompt,
        tools: pc,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn free_chat_rules() {
        let data = std::env::temp_dir().join(format!("veocode-livre-{}", std::process::id()));
        let home = Path::new("/Users/ana");
        let t = target(&data, home, false).unwrap();
        assert!(t.cwd.is_dir() && t.add_dir.is_none() && !t.tools && t.mode == "default");
        let deny = t.settings["permissions"]["deny"].as_array().unwrap().iter().map(|v| v.as_str().unwrap().to_string()).collect::<Vec<_>>();
        // nada de editar, rodar comandos, MCP; credenciais barradas
        for x in ["Edit", "Write", "Bash", "mcp__*", "Read(~/.ssh/**)", "Read(~/Library/Keychains/**)", "Read(~/.netrc)"] {
            assert!(deny.contains(&x.to_string()), "{x}");
        }
        // só conversa: internet sem perguntar
        assert!(t.settings["permissions"]["allow"].as_array().unwrap().iter().any(|v| v == "WebFetch"));

        let t = target(&data, home, true).unwrap();
        assert_eq!(t.add_dir.as_deref(), Some(home));
        assert_eq!(t.tools_root, home);
        assert!(t.tools && t.prompt.contains("/Users/ana"));
        // com o computador ligado a internet volta a perguntar
        assert!(t.settings["permissions"].get("allow").is_none());
        assert!(!t.settings["permissions"]["deny"].as_array().unwrap().iter().any(|v| v == "WebFetch"));
        let _ = std::fs::remove_dir_all(&data);
    }
}
