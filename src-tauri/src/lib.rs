mod access;
mod agent;
mod apiagent;
mod chat;
mod convos;
mod inventory;
mod accounts;
mod files;
mod git;
mod projects;
mod livre;
mod term;
mod settings;
mod skills;
mod tools;
mod trail;
mod vault;
mod watch;
mod xray;

use files::{DirListing, FileContent};
use projects::{ProjectInfo, ProjectStore};
use accounts::{AccountInfo, AccountStatus, AccountStore, NewAccount, Provider};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};

struct AppState {
    store: Mutex<ProjectStore>,
    accounts: Mutex<AccountStore>,
    /// Uso lido dos históricos do Claude, para não reler o que não mudou.
    usage: Arc<Mutex<accounts::claude::UsageCache>>,
    /// Onde ficam as pastas de contas novas do Claude.
    claude_root: PathBuf,
    /// Arquivos que a tela de Skills pode abrir (os do último relatório).
    skill_paths: Mutex<HashSet<String>>,
    /// Pastas que aparecem no último inventário (plugins e MCP de projeto): as únicas aceitas
    /// para rodar `claude plugin|mcp` dentro delas.
    inv_projects: Mutex<HashSet<String>>,
    watchers: Mutex<HashMap<String, watch::Watcher>>,
    /// Históricos do Claude acompanhados por projeto (eventos reais do agente).
    agents: Arc<Mutex<HashMap<String, agent::Watch>>>,
    /// Conversas abertas no painel do agente (Claude sem terminal e APIs).
    chats: Arc<chat::Chats>,
    /// Terminais de cada projeto (shell de verdade num pseudo-terminal).
    terms: term::Terms,
    /// Mantido entre chamadas para o cálculo de CPU (precisa de duas leituras).
    sys: Mutex<Option<sysinfo::System>>,
    /// Pastas do app: configuração (projects.json, accounts.json, settings.json) e dados (conversas…).
    config_dir: PathBuf,
    data_dir: PathBuf,
    settings: Mutex<settings::Settings>,
}

impl AppState {
    fn root_of(&self, project_id: &str) -> Result<PathBuf, String> {
        if project_id == livre::ID {
            return Ok(livre::dir(&self.data_dir));
        }
        let store = self.store.lock().map_err(|e| e.to_string())?;
        store.get(project_id).map(|p| PathBuf::from(&p.path)).ok_or_else(|| "projeto não encontrado".into())
    }

    /// Conta do Chat livre: a escolhida nos ajustes ou, se ela sumiu, a padrão.
    fn free_account(&self) -> Result<accounts::Account, String> {
        let chosen = self.settings.lock().map_err(|e| e.to_string())?.free_account.clone();
        let accs = self.accounts.lock().map_err(|e| e.to_string())?;
        accs.get(&chosen).or_else(|| accs.get(&accs.default_id())).cloned().ok_or_else(|| "Nenhuma conta de IA no Veocode. Adicione uma em Contas.".into())
    }

    /// (id, pasta de configuração) de cada conta do Claude.
    fn claude_dirs(&self) -> Result<Vec<(String, PathBuf)>, String> {
        Ok(self
            .accounts
            .lock()
            .map_err(|e| e.to_string())?
            .accounts
            .iter()
            .filter(|a| a.provider == Provider::Claude)
            .map(|a| (a.id.clone(), accounts::claude::config_dir(a)))
            .collect())
    }

    fn project_roots(&self) -> Vec<(String, PathBuf)> {
        self.store.lock().map(|s| s.projects.iter().map(|p| (p.name.clone(), PathBuf::from(&p.path))).collect()).unwrap_or_default()
    }

    fn watch(&self, app: &AppHandle, id: &str, root: &PathBuf) {
        match watch::start(app.clone(), id.to_string(), root) {
            Ok(w) => {
                if let Ok(mut ws) = self.watchers.lock() {
                    ws.insert(id.to_string(), w);
                }
            }
            Err(e) => eprintln!("[veocode] não deu para observar {}: {e}", root.display()),
        }
    }
}

#[tauri::command(async)]
fn list_projects(state: State<'_, AppState>) -> Result<Vec<ProjectInfo>, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    Ok(store.projects.iter().map(projects::info).collect())
}

#[tauri::command(async)]
fn add_project(app: AppHandle, state: State<'_, AppState>, path: String) -> Result<ProjectInfo, String> {
    let default_account = state.accounts.lock().map_err(|e| e.to_string())?.default_id();
    let project = {
        let mut store = state.store.lock().map_err(|e| e.to_string())?;
        let p = store.add(&PathBuf::from(&path), &default_account)?;
        store.save()?;
        p
    };
    let already = state.watchers.lock().map(|w| w.contains_key(&project.id)).unwrap_or(false);
    if !already {
        state.watch(&app, &project.id, &PathBuf::from(&project.path));
    }
    Ok(projects::info(&project))
}

#[tauri::command(async)]
fn remove_project(state: State<'_, AppState>, project_id: String) -> Result<(), String> {
    let mut store = state.store.lock().map_err(|e| e.to_string())?;
    store.remove(&project_id);
    store.save()?;
    if let Ok(mut ws) = state.watchers.lock() {
        ws.remove(&project_id); // soltar o Debouncer para de observar
    }
    state.terms.close_project(&project_id);
    Ok(())
}

#[tauri::command(async)]
fn update_project(state: State<'_, AppState>, project_id: String, account_id: Option<String>, access: Option<u8>) -> Result<ProjectInfo, String> {
    if let Some(a) = &account_id {
        if state.accounts.lock().map_err(|e| e.to_string())?.get(a).is_none() {
            return Err("conta não encontrada".into());
        }
    }
    let mut store = state.store.lock().map_err(|e| e.to_string())?;
    let p = store.update(&project_id, account_id, access)?;
    store.save()?;
    Ok(projects::info(&p))
}

#[tauri::command]
async fn list_dir(state: State<'_, AppState>, project_id: String, path: String) -> Result<DirListing, String> {
    let root = state.root_of(&project_id)?;
    files::list_dir(&root, &path)
}

#[tauri::command]
async fn read_file(state: State<'_, AppState>, project_id: String, path: String) -> Result<FileContent, String> {
    let root = state.root_of(&project_id)?;
    files::read_file(&root, &path)
}

#[tauri::command]
async fn write_file(state: State<'_, AppState>, project_id: String, path: String, text: String) -> Result<u64, String> {
    let root = state.root_of(&project_id)?;
    blocking(move || files::write_file(&root, &path, &text)).await?
}

#[tauri::command]
async fn create_entry(state: State<'_, AppState>, project_id: String, parent: String, name: String, dir: bool) -> Result<String, String> {
    let root = state.root_of(&project_id)?;
    blocking(move || files::create(&root, &parent, &name, dir)).await?
}

#[tauri::command]
async fn rename_entry(state: State<'_, AppState>, project_id: String, path: String, name: String) -> Result<String, String> {
    let root = state.root_of(&project_id)?;
    blocking(move || files::rename(&root, &path, &name)).await?
}

#[tauri::command]
async fn trash_entry(state: State<'_, AppState>, project_id: String, path: String) -> Result<(), String> {
    let root = state.root_of(&project_id)?;
    blocking(move || {
        let target = files::trash_target(&root, &path)?;
        inventory::to_trash(&[target]).map_err(|e| format!("não foi para a Lixeira: {e}"))
    })
    .await?
}

// ---------------------------------------------------------------- Rastro do projeto

/// O que a IA deixou por causa do projeto: pastas fora dele, sites, modelos locais e sobras.
#[tauri::command]
async fn project_trail(state: State<'_, AppState>, project_id: String) -> Result<trail::Trail, String> {
    let root = state.root_of(&project_id)?;
    let dirs: Vec<PathBuf> = state.claude_dirs()?.into_iter().map(|(_, d)| d).collect();
    let file = trail::store_file(&state.data_dir, &project_id);
    blocking(move || {
        let mut saved = trail::load(&file);
        let t = trail::report(&root, &dirs, &xray::util::home(), &mut saved);
        trail::save(&file, &saved)?;
        Ok(t)
    })
    .await?
}

/// Liga uma pasta de fora ao projeto (escolhida pela pessoa).
#[tauri::command]
async fn trail_link(state: State<'_, AppState>, project_id: String, path: String) -> Result<(), String> {
    state.root_of(&project_id)?;
    let file = trail::store_file(&state.data_dir, &project_id);
    blocking(move || {
        if !std::path::Path::new(&path).is_absolute() {
            return Err("caminho inválido".into());
        }
        let mut saved = trail::load(&file);
        saved.hidden.retain(|h| h != &path);
        if !saved.links.iter().any(|l| l.path == path) {
            saved.links.push(trail::Link { path, how: "vinculada por você".into(), last: 0, manual: true });
        }
        trail::save(&file, &saved)
    })
    .await?
}

/// Esquece uma pasta de fora (não apaga nada; ela só sai da lista deste projeto).
#[tauri::command]
async fn trail_forget(state: State<'_, AppState>, project_id: String, path: String) -> Result<(), String> {
    state.root_of(&project_id)?;
    let file = trail::store_file(&state.data_dir, &project_id);
    blocking(move || {
        let mut saved = trail::load(&file);
        saved.links.retain(|l| l.path != path);
        if !saved.hidden.contains(&path) {
            saved.hidden.push(path);
        }
        trail::save(&file, &saved)
    })
    .await?
}

/// Abre um arquivo do projeto com o programa padrão do sistema (imagem, PDF, planilha…).
#[tauri::command]
async fn open_entry(app: AppHandle, state: State<'_, AppState>, project_id: String, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let root = state.root_of(&project_id)?;
    let real = files::resolve_in_root(&root, &path)?;
    app.opener().open_path(real.to_string_lossy(), None::<&str>).map_err(|e| format!("não abriu: {e}"))
}

#[tauri::command]
async fn list_files(state: State<'_, AppState>, project_id: String) -> Result<Vec<String>, String> {
    let root = state.root_of(&project_id)?;
    blocking(move || files::all_files(&root, 20_000)).await?
}

// ---------------------------------------------------------------- Git e GitHub (só leitura)

#[tauri::command]
async fn git_status(state: State<'_, AppState>, project_id: String) -> Result<git::Status, String> {
    let root = state.root_of(&project_id)?;
    blocking(move || git::status(&root)).await?
}

/// Resumo de todos os projetos (Mapa e barra lateral).
#[tauri::command]
async fn git_summaries(state: State<'_, AppState>) -> Result<HashMap<String, git::Summary>, String> {
    let list: Vec<(String, PathBuf)> = {
        let store = state.store.lock().map_err(|e| e.to_string())?;
        store.projects.iter().map(|p| (p.id.clone(), PathBuf::from(&p.path))).collect()
    };
    blocking(move || {
        let handles: Vec<_> = list.into_iter().map(|(id, root)| std::thread::spawn(move || (id, git::summary(&root)))).collect();
        handles.into_iter().filter_map(|h| h.join().ok()).collect()
    })
    .await
}

#[tauri::command]
async fn git_fetch(state: State<'_, AppState>, project_id: String) -> Result<git::Status, String> {
    let root = state.root_of(&project_id)?;
    blocking(move || {
        git::fetch(&root)?;
        git::status(&root)
    })
    .await?
}

#[tauri::command]
async fn git_commit_files(state: State<'_, AppState>, project_id: String, hash: String) -> Result<Vec<git::CommitFile>, String> {
    let root = state.root_of(&project_id)?;
    blocking(move || git::commit_files(&root, &hash)).await?
}

#[tauri::command]
async fn git_commit_diff(state: State<'_, AppState>, project_id: String, hash: String, path: String) -> Result<String, String> {
    let root = state.root_of(&project_id)?;
    blocking(move || git::commit_diff(&root, &hash, &path)).await?
}

#[tauri::command]
async fn git_github(state: State<'_, AppState>, project_id: String, branch: Option<String>) -> Result<git::GitHub, String> {
    let root = state.root_of(&project_id)?;
    blocking(move || git::github(&root, branch.as_deref())).await?
}

// ---------------------------------------------------------------- Contas

#[tauri::command(async)]
fn accounts_list(state: State<'_, AppState>) -> Result<Vec<AccountInfo>, String> {
    Ok(state.accounts.lock().map_err(|e| e.to_string())?.accounts.iter().map(accounts::info).collect())
}

#[tauri::command(async)]
fn account_add(state: State<'_, AppState>, account: NewAccount) -> Result<AccountInfo, String> {
    let mut store = state.accounts.lock().map_err(|e| e.to_string())?;
    let a = store.add(account, &state.claude_root)?;
    store.save()?;
    Ok(accounts::info(&a))
}

#[tauri::command(async)]
fn account_update(state: State<'_, AppState>, id: String, label: Option<String>, color: Option<String>, model: Option<String>) -> Result<AccountInfo, String> {
    let mut store = state.accounts.lock().map_err(|e| e.to_string())?;
    let a = store.update(&id, label, color, model)?;
    store.save()?;
    Ok(accounts::info(&a))
}

#[tauri::command]
async fn account_set_key(state: State<'_, AppState>, id: String, key: String) -> Result<AccountInfo, String> {
    let provider = state.accounts.lock().map_err(|e| e.to_string())?.get(&id).map(|a| a.provider).ok_or("conta não encontrada")?;
    if !matches!(provider, Provider::Deepseek | Provider::Openai) {
        return Err("essa conta não usa chave de API".into());
    }
    let key_id = id.clone();
    let hint = blocking(move || accounts::remote::set_key(&key_id, &key)).await??;
    let mut store = state.accounts.lock().map_err(|e| e.to_string())?;
    let a = store.set_key_hint(&id, Some(hint))?;
    store.save()?;
    Ok(accounts::info(&a))
}

/// Tira a conta da lista. Não apaga a pasta do Claude; apaga a chave do chaveiro.
#[tauri::command(async)]
fn account_remove(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let using: Vec<String> = state.store.lock().map_err(|e| e.to_string())?.projects.iter().filter(|p| p.account_id == id).map(|p| p.name.clone()).collect();
    if !using.is_empty() {
        return Err(format!("Ainda em uso por: {}. Troque a conta desses projetos antes.", using.join(", ")));
    }
    let mut store = state.accounts.lock().map_err(|e| e.to_string())?;
    if let Some(a) = store.remove(&id) {
        if matches!(a.provider, Provider::Deepseek | Provider::Openai) {
            accounts::remote::delete_key(&a.id);
        }
    }
    store.save()
}

#[tauri::command]
async fn account_status(state: State<'_, AppState>, id: String) -> Result<AccountStatus, String> {
    let account = state.accounts.lock().map_err(|e| e.to_string())?.get(&id).cloned().ok_or("conta não encontrada")?;
    let cache = state.usage.clone();
    blocking(move || {
        let mut c = cache.lock().unwrap_or_else(|e| e.into_inner());
        accounts::status(&account, &mut c)
    })
    .await
}

#[tauri::command(async)]
fn account_login(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let account = state.accounts.lock().map_err(|e| e.to_string())?.get(&id).cloned().ok_or("conta não encontrada")?;
    if account.provider != Provider::Claude {
        return Err("só contas do Claude fazem login pelo terminal".into());
    }
    accounts::claude::open_login(&account)
}

// ---------------------------------------------------------------- Nível de acesso

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Outros arquivos de configuração do Claude que também valem neste projeto.
fn access_others(state: &AppState, account_id: &str, root: &std::path::Path) -> Vec<(String, PathBuf)> {
    let mut out = vec![];
    if let Ok(accs) = state.accounts.lock() {
        if let Some(a) = accs.get(account_id).filter(|a| a.provider == Provider::Claude) {
            out.push((format!("conta {}", a.label), accounts::claude::config_dir(a).join("settings.json")));
        }
    }
    out.push(("projeto (.claude/settings.json)".into(), root.join(".claude").join("settings.json")));
    #[cfg(target_os = "macos")]
    out.push(("gerenciado (empresa)".into(), PathBuf::from("/Library/Application Support/ClaudeCode/managed-settings.json")));
    #[cfg(target_os = "windows")]
    out.push(("gerenciado (empresa)".into(), PathBuf::from(r"C:\Program Files\ClaudeCode\managed-settings.json")));
    out.into_iter().filter(|(_, p)| p.exists()).collect()
}

fn access_report_for(state: &AppState, project_id: &str) -> Result<access::Report, String> {
    let p = state.store.lock().map_err(|e| e.to_string())?.get(project_id).cloned().ok_or("projeto não encontrado")?;
    let root = PathBuf::from(&p.path);
    let others = access_others(state, &p.account_id, &root);
    Ok(access::report(&root, p.access, &p.overrides, p.applied.as_ref(), &others))
}

/// Grava as regras do nível atual (se `force` ou se o projeto já estava aplicado).
fn reapply(state: &AppState, project_id: &str, force: bool) -> Result<(), String> {
    let mut store = state.store.lock().map_err(|e| e.to_string())?;
    let p = store.get_mut(project_id).ok_or("projeto não encontrado")?;
    if !force && p.applied.is_none() {
        return Ok(());
    }
    let root = PathBuf::from(&p.path);
    if !root.is_dir() {
        return Err("a pasta do projeto não existe mais".into());
    }
    let compiled = access::compile(p.access, &p.overrides);
    let applied = access::apply(&root, &compiled, p.applied.as_ref(), now_ms())?;
    p.applied = Some(applied);
    store.save()
}

#[tauri::command(async)]
fn access_report(state: State<'_, AppState>, project_id: String) -> Result<access::Report, String> {
    access_report_for(&state, &project_id)
}

/// Muda o nível ou um ajuste. `cap` + `rule: null` volta o ajuste ao padrão do nível.
#[tauri::command(async)]
fn access_set(state: State<'_, AppState>, project_id: String, level: Option<u8>, cap: Option<String>, rule: Option<access::Rule>) -> Result<access::Report, String> {
    {
        let mut store = state.store.lock().map_err(|e| e.to_string())?;
        if level.is_some() {
            store.update(&project_id, None, level)?;
        }
        if let Some(id) = cap {
            let spec = access::cap(&id).ok_or("ajuste desconhecido")?;
            let p = store.get_mut(&project_id).ok_or("projeto não encontrado")?;
            match rule {
                Some(r) if !spec.choices.contains(&r) => return Err("essa opção não existe para este item".into()),
                Some(r) if r == spec.levels[p.access.min(3) as usize] => {
                    p.overrides.remove(&id);
                }
                Some(r) => {
                    p.overrides.insert(id, r);
                }
                None => {
                    p.overrides.remove(&id);
                }
            }
        }
        store.save()?;
    }
    reapply(&state, &project_id, false)?;
    access_report_for(&state, &project_id)
}

#[tauri::command(async)]
fn access_apply(state: State<'_, AppState>, project_id: String) -> Result<access::Report, String> {
    reapply(&state, &project_id, true)?;
    access_report_for(&state, &project_id)
}

/// Tira do projeto só as regras que o Veocode gravou.
#[tauri::command(async)]
fn access_remove(state: State<'_, AppState>, project_id: String) -> Result<access::Report, String> {
    {
        let mut store = state.store.lock().map_err(|e| e.to_string())?;
        let p = store.get_mut(&project_id).ok_or("projeto não encontrado")?;
        if let Some(a) = p.applied.take() {
            if let Err(e) = access::remove(&a) {
                p.applied = Some(a);
                return Err(e);
            }
        }
        store.save()?;
    }
    access_report_for(&state, &project_id)
}

/// Só calcula (projeto demo): nada é lido nem gravado.
#[tauri::command]
fn access_preview(level: u8, overrides: std::collections::BTreeMap<String, access::Rule>) -> access::Report {
    let mut r = access::report(std::path::Path::new(""), level, &overrides, None, &[]);
    r.file = String::new();
    r
}

/// Abre o Claude Code no projeto, com a conta dele.
#[tauri::command(async)]
fn open_claude(state: State<'_, AppState>, project_id: String) -> Result<(), String> {
    let p = state.store.lock().map_err(|e| e.to_string())?.get(&project_id).cloned().ok_or("projeto não encontrado")?;
    let a = state.accounts.lock().map_err(|e| e.to_string())?.get(&p.account_id).cloned().ok_or("conta não encontrada")?;
    if a.provider != Provider::Claude {
        return Err(format!("{} não é uma conta do Claude. Troque a conta do projeto para abrir o Claude Code.", a.label));
    }
    accounts::claude::open_terminal(&a, Some(std::path::Path::new(&p.path)))
}

// ---------------------------------------------------------------- Eventos do agente

/// Novos passos dos agentes do Claude neste projeto (a 1ª chamada traz o fim das sessões recentes).
#[tauri::command]
async fn agent_poll(state: State<'_, AppState>, project_id: String, reset: Option<bool>, channel: Option<String>) -> Result<Vec<agent::AgentEvent>, String> {
    let root = state.root_of(&project_id)?;
    let accounts = state.claude_dirs()?;
    let agents = state.agents.clone();
    // cada leitor tem a sua posição no histórico: a tela do projeto e o Painel (vários
    // projetos ao mesmo tempo) leem os mesmos arquivos sem tirar eventos um do outro
    let key = match channel.as_deref() {
        Some(c) if !c.is_empty() => format!("{project_id}#{c}"),
        _ => project_id,
    };
    blocking(move || {
        let mut map = agents.lock().map_err(|e| e.to_string())?;
        if reset == Some(true) {
            map.remove(&key);
        }
        let w = map.entry(key).or_insert_with(|| agent::Watch::new(root, accounts));
        Ok(w.poll())
    })
    .await?
}

// ---------------------------------------------------------------- Chat

/// Manda um pedido para o agente do projeto (Claude Code sem terminal, ou API). A resposta
/// chega aos poucos pelo evento `chat-event`.
#[tauri::command(async)]
fn chat_send(app: AppHandle, state: State<'_, AppState>, project_id: String, text: String, attach: Option<String>) -> Result<(), String> {
    if project_id == livre::ID {
        let account = state.free_account()?;
        let pc = state.settings.lock().map_err(|e| e.to_string())?.free_pc;
        let t = livre::target(&state.data_dir, &xray::util::home(), pc)?;
        let claude = account.provider == Provider::Claude;
        return state.chats.send(
            app,
            chat::SendArgs {
                project_id,
                root: if claude { t.cwd } else { t.tools_root },
                project_name: "Chat livre".into(),
                account,
                text,
                attach: None,
                level: t.level,
                overrides: t.overrides,
                settings: t.settings,
                mode: t.mode,
                add_dir: t.add_dir,
                prompt: Some(t.prompt),
                tools: t.tools,
                stream_steps: true,
            },
        );
    }
    let p = state.store.lock().map_err(|e| e.to_string())?.get(&project_id).cloned().ok_or("projeto não encontrado")?;
    let account = state.accounts.lock().map_err(|e| e.to_string())?.get(&p.account_id).cloned().ok_or("conta não encontrada")?;
    let root = PathBuf::from(&p.path);
    chat::project_root_ok(&root)?;
    // arquivo anexado: só dentro do projeto e até 60 KB
    let attach = match attach.filter(|a| !a.is_empty()) {
        Some(rel) => {
            let full = files::resolve_in_root(&root, &rel)?;
            let mut body = std::fs::read_to_string(&full).map_err(|_| format!("não deu para ler {rel} como texto"))?;
            if body.len() > 60_000 {
                let mut cut = 60_000;
                while !body.is_char_boundary(cut) {
                    cut -= 1;
                }
                body.truncate(cut);
                body.push_str("\n… (cortado)");
            }
            Some((rel, body))
        }
        None => None,
    };
    let settings = access::compile(p.access, &p.overrides).settings();
    state.chats.send(
        app,
        chat::SendArgs {
            project_id,
            root,
            project_name: p.name.clone(),
            account,
            text,
            attach,
            level: p.access,
            overrides: p.overrides.clone(),
            settings,
            mode: access::MODES[p.access.min(3) as usize],
            add_dir: None,
            prompt: None,
            tools: true,
            stream_steps: false,
        },
    )
}

#[tauri::command(async)]
fn term_open(app: AppHandle, state: State<'_, AppState>, project_id: String, cols: u16, rows: u16) -> Result<term::TermInfo, String> {
    let p = state.store.lock().map_err(|e| e.to_string())?.get(&project_id).cloned().ok_or("projeto não encontrado")?;
    let root = PathBuf::from(&p.path);
    chat::project_root_ok(&root)?;
    let account = state.accounts.lock().map_err(|e| e.to_string())?.get(&p.account_id).cloned();
    // só contas do Claude com pasta própria mudam o CLAUDE_CONFIG_DIR; as outras usam a padrão
    let claude_dir = account.filter(|a| a.provider == Provider::Claude && a.config_dir.is_some()).map(|a| accounts::claude::config_dir(&a));
    state.terms.open(app, term::OpenArgs { project_id, project_name: p.name.clone(), root, claude_dir, cols, rows })
}

#[tauri::command]
fn term_list(state: State<'_, AppState>, project_id: String) -> Vec<term::TermInfo> {
    state.terms.list(&project_id)
}

#[tauri::command(async)]
fn term_write(state: State<'_, AppState>, id: String, data: String) -> Result<(), String> {
    state.terms.write(&id, &data)
}

#[tauri::command(async)]
fn term_resize(state: State<'_, AppState>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    state.terms.resize(&id, cols, rows)
}

#[tauri::command(async)]
fn term_buffer(state: State<'_, AppState>, id: String) -> Result<String, String> {
    state.terms.buffer(&id)
}

#[tauri::command]
fn term_close(state: State<'_, AppState>, id: String) {
    state.terms.close(&id);
}

#[tauri::command(async)]
fn chat_permission(state: State<'_, AppState>, project_id: String, request_id: String, allow: bool) -> Result<(), String> {
    state.chats.answer(&project_id, &request_id, allow)
}

#[tauri::command(async)]
fn chat_stop(app: AppHandle, state: State<'_, AppState>, project_id: String) -> Result<(), String> {
    state.chats.stop(&app, &project_id)
}

#[tauri::command]
fn chat_reset(state: State<'_, AppState>, project_id: String) {
    state.chats.reset(&project_id);
}

/// Conversas anteriores do projeto: sessões do Claude (todas as contas) e conversas com APIs.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ConvoList {
    items: Vec<convos::Convo>,
    /// conversa aberta agora no chat ("claude"/"api", id)
    current: Option<(String, String)>,
}

#[tauri::command]
async fn chat_conversations(state: State<'_, AppState>, project_id: String) -> Result<ConvoList, String> {
    let root = state.root_of(&project_id)?;
    let claude = state.claude_dirs()?;
    let api_dir = state.chats.api_dir(&project_id);
    let current = state.chats.current(&project_id);
    let mut items = blocking(move || {
        let mut all = convos::claude_sessions(&root, &claude);
        all.extend(convos::api_list(&api_dir));
        all
    })
    .await?;
    items.sort_by(|a, b| b.updated.cmp(&a.updated));
    items.truncate(convos::MAX_LISTED);
    #[cfg(debug_assertions)]
    eprintln!("[convos] {project_id}: {} conversas, atual {current:?}: {:?}", items.len(), items.iter().map(|c| (&c.kind, &c.account, &c.title, &c.origin)).collect::<Vec<_>>());
    Ok(ConvoList { items, current })
}

/// Retoma uma conversa: o próximo pedido continua dela. Devolve o fim dela para a tela.
#[tauri::command]
async fn chat_open(state: State<'_, AppState>, project_id: String, kind: String, id: String, account: String) -> Result<Vec<agent::AgentEvent>, String> {
    if !convos::valid_id(&id) {
        return Err("conversa inválida".into());
    }
    let owner = state.accounts.lock().map_err(|e| e.to_string())?.get(&account).cloned().ok_or("A conta desta conversa não existe mais no Veocode.")?;
    let (current, root) = if project_id == livre::ID {
        (state.free_account()?.id, livre::dir(&state.data_dir))
    } else {
        let p = state.store.lock().map_err(|e| e.to_string())?.get(&project_id).cloned().ok_or("projeto não encontrado")?;
        (p.account_id.clone(), PathBuf::from(&p.path))
    };
    if current != account {
        return Err(format!("Esta conversa é da conta {}. Troque a conta para continuar nela.", owner.label));
    }
    let chats = state.chats.clone();
    #[cfg(debug_assertions)]
    let shown = id.clone();
    let r = blocking(move || {
        if kind == "claude" {
            if owner.provider != Provider::Claude {
                return Err("conversa inválida".to_string());
            }
            let file = convos::claude_dir(&accounts::claude::config_dir(&owner), &root).join(format!("{id}.jsonl"));
            if !file.is_file() {
                return Err("Essa sessão do Claude não existe mais.".into());
            }
            chats.open(&project_id, &account, "claude", &id, None)?;
            Ok(agent::read_session(&root, &account, &file, convos::MAX_STEPS))
        } else {
            let (acc, msgs) = convos::load_api(&chats.api_dir(&project_id), &id)?;
            if acc != account {
                return Err("conversa inválida".into());
            }
            let ts = convos::api_list(&chats.api_dir(&project_id)).iter().find(|c| c.id == id).map(|c| c.updated).unwrap_or(0);
            let evs = convos::api_events(&account, &msgs, ts);
            chats.open(&project_id, &account, "api", &id, Some(msgs))?;
            Ok(evs)
        }
    })
    .await?;
    #[cfg(debug_assertions)]
    eprintln!("[convos] abrir {shown}: {:?}", r.as_ref().map(|e| e.iter().map(|x| format!("{}:{}", x.kind, x.title.chars().take(40).collect::<String>())).collect::<Vec<_>>()));
    r
}

/// Apaga uma conversa anterior: o arquivo dela vai para a Lixeira (dá para recuperar lá).
/// Se for a conversa aberta agora, o chat do projeto começa uma nova.
/// Pastas onde o Claude Code já trabalhou, para a Visão geral sugerir como projeto.
#[tauri::command]
async fn recent_folders(state: State<'_, AppState>) -> Result<Vec<convos::Found>, String> {
    let mut dirs: Vec<PathBuf> = state.claude_dirs()?.into_iter().map(|(_, d)| d).collect();
    for d in xray::caches::claude_config_dirs() {
        if !dirs.contains(&d) {
            dirs.push(d);
        }
    }
    blocking(move || convos::recent_folders(&dirs, 16)).await
}

#[tauri::command]
async fn vault_list() -> Result<Vec<vault::Item>, String> {
    blocking(vault::list).await
}

#[tauri::command]
async fn vault_save(item: vault::Item, secret: Option<String>) -> Result<vault::Item, String> {
    blocking(move || vault::save(item, secret)).await?
}

#[tauri::command]
async fn vault_delete(id: String) -> Result<(), String> {
    blocking(move || vault::delete(&id)).await?
}

#[tauri::command]
async fn vault_reveal(id: String) -> Result<String, String> {
    blocking(move || vault::reveal(&id)).await?
}

#[tauri::command]
async fn chat_delete(state: State<'_, AppState>, project_id: String, kind: String, id: String, account: String) -> Result<(), String> {
    if !convos::valid_id(&id) {
        return Err("conversa inválida".into());
    }
    let root = state.root_of(&project_id)?;
    let files: Vec<PathBuf> = if kind == "claude" {
        let owner = state.accounts.lock().map_err(|e| e.to_string())?.get(&account).cloned().ok_or("A conta desta conversa não existe mais no Veocode.")?;
        if owner.provider != Provider::Claude {
            return Err("conversa inválida".into());
        }
        let dir = convos::claude_dir(&accounts::claude::config_dir(&owner), &root);
        // a sessão e, se houver, a pasta dos ajudantes dela (subagentes)
        [dir.join(format!("{id}.jsonl")), dir.join(&id)].into_iter().filter(|p| p.exists()).collect()
    } else {
        let dir = state.chats.api_dir(&project_id);
        [dir.join(format!("{id}.json")), dir.join(format!("{id}.meta.json"))].into_iter().filter(|p| p.exists()).collect()
    };
    if files.is_empty() {
        return Err("Essa conversa já não existe.".into());
    }
    if state.chats.current(&project_id).is_some_and(|(k, c)| k == kind && c == id) {
        state.chats.reset(&project_id);
    }
    blocking(move || inventory::to_trash(&files).map_err(|e| format!("Não deu para mandar para a Lixeira: {e}"))).await?
}

#[tauri::command]
fn chat_history(state: State<'_, AppState>, project_id: String) -> (Vec<chat::Msg>, bool) {
    (state.chats.history(&project_id), state.chats.is_busy(&project_id))
}

// ---------------------------------------------------------------- Skills e MCP

#[tauri::command]
async fn skills_report(state: State<'_, AppState>) -> Result<skills::Report, String> {
    skills_now(&state).await
}

/// Lê skills, plugins e MCP e guarda os arquivos que a tela pode abrir ou mandar para a Lixeira.
async fn skills_now(state: &AppState) -> Result<skills::Report, String> {
    let homes: Vec<skills::ClaudeHome> = state
        .accounts
        .lock()
        .map_err(|e| e.to_string())?
        .accounts
        .iter()
        .filter(|a| a.provider == Provider::Claude)
        .map(|a| skills::ClaudeHome { account: a.id.clone(), dir: accounts::claude::config_dir(a), json: accounts::claude::json_path(a) })
        .collect();
    let roots: Vec<PathBuf> = state.project_roots().into_iter().map(|(_, r)| r).collect();
    let report = blocking(move || skills::report(&homes, &roots)).await?;
    let allowed: HashSet<String> = report.items.iter().filter_map(|i| i.path.clone()).filter(|p| p.ends_with(".md")).collect();
    *state.skill_paths.lock().map_err(|e| e.to_string())? = allowed;
    Ok(report)
}

// ---------------------------------------------------------------- Inventário

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct InventoryReport {
    skills: skills::Report,
    /// o que procurar nos processos (a tela manda de volta a cada atualização)
    probes: Vec<inventory::Probe>,
}

/// Skills, plugins e MCP de todas as contas (leitura de disco: só ao abrir e ao atualizar).
#[tauri::command]
async fn inventory_report(state: State<'_, AppState>) -> Result<InventoryReport, String> {
    let skills = skills_now(&state).await?;
    let probes = inventory::probes(&skills.items);
    let projects: HashSet<String> = skills.items.iter().filter_map(|i| i.project.clone()).chain(skills.plugins.iter().filter_map(|p| p.project.clone())).collect();
    *state.inv_projects.lock().map_err(|e| e.to_string())? = projects;
    Ok(InventoryReport { skills, probes })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct InventoryRunning {
    /// id do servidor MCP → cópias rodando agora
    mcp: HashMap<String, Vec<inventory::McpRun>>,
    agents: Vec<xray::procs::AgentGroup>,
}

/// O que está rodando agora (leve: só a lista de processos). A tela chama a cada poucos segundos.
#[tauri::command]
async fn inventory_running(state: State<'_, AppState>, probes: Vec<inventory::Probe>) -> Result<InventoryRunning, String> {
    let agents = {
        let mut guard = state.sys.lock().map_err(|e| e.to_string())?;
        guard.as_mut().map(xray::procs::snapshot).unwrap_or_default()
    };
    Ok(InventoryRunning { mcp: inventory::mcp_running(&probes, &agents), agents })
}

/// Skill, comando ou agente → Lixeira.
#[tauri::command]
async fn inventory_trash(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let allowed = state.skill_paths.lock().map_err(|e| e.to_string())?.clone();
    let p = path.clone();
    blocking(move || inventory::trash_item(&p, &allowed)).await??;
    state.skill_paths.lock().map_err(|e| e.to_string())?.remove(&path);
    Ok(())
}

/// Conta do Claude e pasta do projeto validadas para rodar `claude plugin|mcp`.
fn claude_target(state: &AppState, account: &str, project: Option<String>) -> Result<(Option<PathBuf>, Option<PathBuf>), String> {
    let a = state.accounts.lock().map_err(|e| e.to_string())?.get(account).cloned().ok_or("conta não encontrada")?;
    if a.provider != Provider::Claude {
        return Err("só contas do Claude têm plugins e MCP".into());
    }
    // conta padrão: sem CLAUDE_CONFIG_DIR (senão o Claude procuraria o .claude.json no lugar errado)
    let dir = a.config_dir.is_some().then(|| accounts::claude::config_dir(&a));
    let project = match project.filter(|p| !p.is_empty()) {
        Some(p) => {
            if !state.inv_projects.lock().map_err(|e| e.to_string())?.contains(&p) {
                return Err("Essa pasta não está no inventário. Atualize e tente de novo.".into());
            }
            Some(PathBuf::from(p))
        }
        None => None,
    };
    Ok((dir, project))
}

#[tauri::command]
async fn inventory_plugin(state: State<'_, AppState>, account: String, plugin_id: String, scope: String, project: Option<String>, action: String) -> Result<String, String> {
    let (dir, project) = claude_target(&state, &account, project)?;
    blocking(move || inventory::plugin_action(dir.as_deref(), &plugin_id, &scope, project.as_deref(), &action)).await?
}

#[tauri::command]
async fn inventory_mcp_remove(state: State<'_, AppState>, account: String, name: String, scope: String, project: Option<String>) -> Result<String, String> {
    let (dir, project) = claude_target(&state, &account, project)?;
    blocking(move || inventory::mcp_remove(dir.as_deref(), &name, &scope, project.as_deref())).await?
}

#[tauri::command(async)]
fn skill_read(state: State<'_, AppState>, path: String) -> Result<String, String> {
    let allowed = state.skill_paths.lock().map_err(|e| e.to_string())?;
    skills::read_item(&path, &allowed)
}

// ---------------------------------------------------------------- Raio-X

/// Trabalho pesado (disco, comandos externos) fora das threads do Tauri.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())
}

#[tauri::command(async)]
fn xray_caches(state: State<'_, AppState>) -> Result<Vec<xray::caches::CacheSpec>, String> {
    Ok(xray::caches::known(&state.project_roots()))
}

fn find_cache(state: &AppState, id: &str) -> Result<xray::caches::CacheSpec, String> {
    xray::caches::known(&state.project_roots()).into_iter().find(|c| c.id == id).ok_or_else(|| "cache não encontrado".into())
}

#[tauri::command]
async fn xray_measure(state: State<'_, AppState>, id: String) -> Result<u64, String> {
    let spec = find_cache(&state, &id)?;
    blocking(move || xray::caches::measure(&spec)).await
}

#[tauri::command]
async fn xray_trash(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let spec = find_cache(&state, &id)?;
    let roots: Vec<PathBuf> = state.project_roots().into_iter().map(|(_, r)| r).collect();
    blocking(move || xray::caches::move_to_trash(&spec, &roots)).await?
}

#[tauri::command]
async fn xray_installs() -> Result<xray::installs::InstallReport, String> {
    blocking(|| xray::installs::report(&xray::caches::claude_config_dirs())).await
}

#[tauri::command]
async fn xray_machines() -> Result<xray::machines::MachineReport, String> {
    blocking(xray::machines::report).await
}

#[tauri::command]
async fn xray_models() -> Result<xray::models::ModelReport, String> {
    blocking(|| xray::models::report(&xray::caches::claude_config_dirs())).await
}

#[tauri::command]
async fn xray_toggle_machine(engine: String, id: String, start: bool) -> Result<(), String> {
    blocking(move || xray::machines::toggle(&engine, &id, start)).await?
}

#[tauri::command]
async fn xray_processes(state: State<'_, AppState>) -> Result<Vec<xray::procs::AgentGroup>, String> {
    let mut guard = state.sys.lock().map_err(|e| e.to_string())?;
    let sys = guard.as_mut().ok_or("não deu para ler os processos do sistema")?;
    Ok(xray::procs::snapshot(sys))
}

#[tauri::command]
async fn xray_kill(state: State<'_, AppState>, pid: u32) -> Result<(), String> {
    let mut guard = state.sys.lock().map_err(|e| e.to_string())?;
    let sys = guard.as_mut().ok_or("não deu para ler os processos do sistema")?;
    xray::procs::kill(sys, pid)
}

// ---------------------------------------------------------------- Ajustes

#[tauri::command(async)]
fn settings_get(state: State<'_, AppState>) -> Result<settings::Settings, String> {
    Ok(state.settings.lock().map_err(|e| e.to_string())?.clone())
}

#[tauri::command(async)]
fn settings_set(state: State<'_, AppState>, settings: settings::Settings) -> Result<settings::Settings, String> {
    settings::save(&state.config_dir, &settings)?;
    *state.settings.lock().map_err(|e| e.to_string())? = settings.clone();
    Ok(settings)
}

#[derive(serde::Serialize)]
struct AppPaths {
    config: String,
    data: String,
}

#[tauri::command]
fn app_paths(state: State<'_, AppState>) -> AppPaths {
    AppPaths { config: state.config_dir.to_string_lossy().into(), data: state.data_dir.to_string_lossy().into() }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            vault::init(&config_dir);
            let mut store = ProjectStore::load(&config_dir);
            let account_store = AccountStore::load(&config_dir);
            if !config_dir.join("accounts.json").exists() && !account_store.accounts.is_empty() {
                let _ = account_store.save(); // grava o que foi descoberto: os ids ficam estáveis
            }
            // projeto apontando para conta que não existe mais → conta padrão
            let fallback = account_store.default_id();
            let mut fixed = false;
            for p in store.projects.iter_mut() {
                if account_store.get(&p.account_id).is_none() && !fallback.is_empty() {
                    p.account_id = fallback.clone();
                    fixed = true;
                }
            }
            if fixed {
                let _ = store.save();
            }
            let existing: Vec<(String, PathBuf)> = store.projects.iter().map(|p| (p.id.clone(), PathBuf::from(&p.path))).collect();
            let state = AppState {
                store: Mutex::new(store),
                accounts: Mutex::new(account_store),
                usage: Arc::new(Mutex::new(Default::default())),
                claude_root: app.path().app_data_dir()?.join("claude-accounts"),
                skill_paths: Mutex::new(HashSet::new()),
                inv_projects: Mutex::new(HashSet::new()),
                watchers: Mutex::new(HashMap::new()),
                agents: Arc::new(Mutex::new(HashMap::new())),
                chats: Arc::new(chat::Chats::new(app.path().app_data_dir()?)),
                terms: term::Terms::new(app.path().app_data_dir()?),
                sys: Mutex::new(xray::procs::new_system()),
                settings: Mutex::new(settings::load(&config_dir)),
                data_dir: app.path().app_data_dir()?,
                config_dir,
            };
            for (id, root) in existing {
                if root.is_dir() {
                    state.watch(app.handle(), &id, &root);
                }
            }
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            git_status,
            git_summaries,
            git_fetch,
            git_github,
            git_commit_files,
            git_commit_diff,
            settings_get,
            settings_set,
            app_paths,
            access_report,
            access_set,
            access_apply,
            access_remove,
            open_claude,
            access_preview,
            agent_poll,
            chat_send,
            chat_permission,
            chat_stop,
            chat_reset,
            chat_history,
            chat_conversations,
            chat_delete,
            vault_list,
            recent_folders,
            vault_save,
            vault_delete,
            vault_reveal,
            chat_open,
            list_projects,
            add_project,
            remove_project,
            update_project,
            list_dir,
            read_file,
            write_file,
            create_entry,
            rename_entry,
            trash_entry,
            open_entry,
            list_files,
            project_trail,
            trail_link,
            trail_forget,
            accounts_list,
            account_add,
            account_update,
            account_set_key,
            account_remove,
            account_status,
            account_login,
            skills_report,
            inventory_report,
            inventory_running,
            inventory_trash,
            inventory_plugin,
            inventory_mcp_remove,
            skill_read,
            xray_caches,
            xray_measure,
            xray_trash,
            xray_installs,
            xray_machines,
            xray_models,
            xray_toggle_machine,
            xray_processes,
            xray_kill,
            term_open,
            term_list,
            term_write,
            term_resize,
            term_buffer,
            term_close
        ])
        .build(tauri::generate_context!())
        .expect("erro ao iniciar o Veocode")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // fecha os Claudes abertos pelo chat
                app.state::<AppState>().chats.shutdown();
                app.state::<AppState>().terms.shutdown();
            }
        });
}
