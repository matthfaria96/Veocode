mod access;
mod attach;
mod agent;
mod apiagent;
mod chat;
mod context;
mod convos;
mod inventory;
mod accounts;
mod files;
mod git;
mod projects;
mod livre;
mod memory;
mod term;
mod settings;
mod i18n;
mod skills;
mod tools;
mod trail;
mod vault;
mod voice;
mod limits;
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
        let project_id = chat::base_project(project_id);
        if project_id == livre::ID {
            return Ok(livre::dir(&self.data_dir));
        }
        let store = self.store.lock().map_err(|e| e.to_string())?;
        store.get(project_id).map(|p| PathBuf::from(&p.path)).ok_or_else(|| crate::i18n::tr("projeto não encontrado", "project not found").into())
    }

    /// Conta do Chat livre: a escolhida nos ajustes ou, se ela sumiu, a padrão.
    fn free_account(&self) -> Result<accounts::Account, String> {
        let chosen = self.settings.lock().map_err(|e| e.to_string())?.free_account.clone();
        let accs = self.accounts.lock().map_err(|e| e.to_string())?;
        accs.get(&chosen).or_else(|| accs.get(&accs.default_id())).cloned().ok_or_else(|| crate::i18n::tr("Nenhuma conta de IA no Veocode. Adicione uma em Contas.", "No AI accounts in Veocode. Add one in Accounts.").into())
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

/// Lê as pastas FORA da trava da lista: logo depois de atualizar o app, o macOS pode pedir de novo
/// a permissão de acesso a Documentos e a leitura fica parada até você responder. Assim só esta
/// chamada espera; o resto do app continua.
#[tauri::command]
async fn list_projects(state: State<'_, AppState>) -> Result<Vec<ProjectInfo>, String> {
    let list = state.store.lock().map_err(|e| e.to_string())?.projects.clone();
    blocking(move || list.iter().map(projects::info).collect()).await
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
fn remove_project(state: State<'_, AppState>, project_id: String, trash_folder: Option<bool>) -> Result<(), String> {
    let root = state.root_of(&project_id).ok();
    // mandar a pasta para a Lixeira: confere antes de tirar da lista, para não sumir pela metade
    let trash = trash_folder.unwrap_or(false);
    if trash {
        let r = root.as_ref().ok_or(crate::i18n::tr("projeto não encontrado", "project not found"))?;
        projects::folder_trashable(r, &[state.config_dir.clone(), state.data_dir.clone()])?;
    }
    state.chats.reset_project(&project_id); // fecha o Claude deste projeto (a conversa continua guardada)
    if let Ok(mut ws) = state.watchers.lock() {
        ws.remove(&project_id); // soltar o Debouncer para de observar
    }
    state.terms.close_project(&project_id);
    if trash {
        let r = root.clone().unwrap();
        inventory::to_trash(&[r]).map_err(|e| crate::trf!("não deu para mandar a pasta para a Lixeira: {e}", "couldn't send the folder to the Trash: {e}"))?;
    }
    let mut store = state.store.lock().map_err(|e| e.to_string())?;
    store.remove(&project_id);
    store.save()?;
    Ok(())
}

#[tauri::command(async)]
fn update_project(state: State<'_, AppState>, project_id: String, account_id: Option<String>, access: Option<u8>) -> Result<ProjectInfo, String> {
    if let Some(a) = &account_id {
        if state.accounts.lock().map_err(|e| e.to_string())?.get(a).is_none() {
            return Err(crate::i18n::tr("conta não encontrada", "account not found").into());
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
        inventory::to_trash(&[target]).map_err(|e| crate::trf!("não foi para a Lixeira: {e}", "didn't go to the Trash: {e}"))
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
            return Err(crate::i18n::tr("caminho inválido", "invalid path").into());
        }
        let mut saved = trail::load(&file);
        saved.hidden.retain(|h| h != &path);
        if !saved.links.iter().any(|l| l.path == path) {
            saved.links.push(trail::Link { path, how: crate::i18n::tr("vinculada por você", "linked by you").into(), last: 0, manual: true });
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
    app.opener().open_path(real.to_string_lossy(), None::<&str>).map_err(|e| crate::trf!("não abriu: {e}", "didn't open: {e}"))
}

/// Imagem do projeto como data URL (visualizador e faixa de imagens novas).
#[tauri::command]
async fn image_preview(state: State<'_, AppState>, project_id: String, path: String) -> Result<String, String> {
    let root = state.root_of(&project_id)?;
    blocking(move || attach::preview(&files::resolve_in_root(&root, &path)?)).await?
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
async fn git_file_diff(state: State<'_, AppState>, project_id: String, path: String) -> Result<String, String> {
    let root = state.root_of(&project_id)?;
    blocking(move || git::file_diff(&root, &path)).await?
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
    let provider = state.accounts.lock().map_err(|e| e.to_string())?.get(&id).map(|a| a.provider).ok_or(crate::i18n::tr("conta não encontrada", "account not found"))?;
    if !matches!(provider, Provider::Deepseek | Provider::Openai) {
        return Err(crate::i18n::tr("essa conta não usa chave de API", "this account doesn't use an API key").into());
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
        return Err(crate::trf!("Ainda em uso por: {}. Troque a conta desses projetos antes.", "Still in use by: {}. Change those projects' account first.", using.join(", ")));
    }
    let mut store = state.accounts.lock().map_err(|e| e.to_string())?;
    if let Some(a) = store.remove(&id) {
        if matches!(a.provider, Provider::Deepseek | Provider::Openai) {
            accounts::remote::delete_key(&a.id);
        }
    }
    store.save()
}

/// Limites do plano (5 horas e semana) de uma conta do Claude. Leitura: não gasta tokens.
#[tauri::command]
async fn account_limits(state: State<'_, AppState>, id: String, force: Option<bool>) -> Result<limits::Limits, String> {
    let a = state.accounts.lock().map_err(|e| e.to_string())?.get(&id).cloned().ok_or(crate::i18n::tr("conta não encontrada", "account not found"))?;
    if a.provider != Provider::Claude {
        return Err(crate::i18n::tr("Limites só existem nas contas do Claude", "Limits only exist for Claude accounts").into());
    }
    blocking(move || limits::for_account(&a, force.unwrap_or(false))).await
}

#[tauri::command]
async fn account_status(state: State<'_, AppState>, id: String) -> Result<AccountStatus, String> {
    let account = state.accounts.lock().map_err(|e| e.to_string())?.get(&id).cloned().ok_or(crate::i18n::tr("conta não encontrada", "account not found"))?;
    let cache = state.usage.clone();
    blocking(move || {
        let mut c = cache.lock().unwrap_or_else(|e| e.into_inner());
        accounts::status(&account, &mut c)
    })
    .await
}

#[tauri::command(async)]
fn account_login(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let account = state.accounts.lock().map_err(|e| e.to_string())?.get(&id).cloned().ok_or(crate::i18n::tr("conta não encontrada", "account not found"))?;
    if account.provider != Provider::Claude {
        return Err(crate::i18n::tr("só contas do Claude fazem login pelo terminal", "only Claude accounts sign in through the terminal").into());
    }
    accounts::claude::open_login(&account)
}

/// Login do Claude pelo navegador. Termina quando a pessoa entra (ou cancela).
#[tauri::command]
async fn account_browser_login(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<(), String> {
    use tauri::Emitter;
    let account = state.accounts.lock().map_err(|e| e.to_string())?.get(&id).cloned().ok_or(crate::i18n::tr("conta não encontrada", "account not found"))?;
    if account.provider != Provider::Claude {
        return Err(crate::i18n::tr("só contas do Claude fazem login pelo navegador", "only Claude accounts sign in through the browser").into());
    }
    blocking(move || {
        accounts::claude::browser_login(&account, |url| {
            let _ = app.emit("login-url", serde_json::json!({ "id": account.id, "url": url }));
        })
    })
    .await?
}

#[tauri::command]
fn account_login_code(id: String, code: String) -> Result<(), String> {
    accounts::claude::login_code(&id, &code)
}

#[tauri::command]
fn account_login_cancel(id: String) {
    accounts::claude::cancel_login(&id)
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
            out.push((crate::trf!("conta {}", "account {}", a.label), accounts::claude::config_dir(a).join("settings.json")));
        }
    }
    out.push((crate::i18n::tr("projeto (.claude/settings.json)", "project (.claude/settings.json)").into(), root.join(".claude").join("settings.json")));
    #[cfg(target_os = "macos")]
    out.push(("gerenciado (empresa)".into(), PathBuf::from("/Library/Application Support/ClaudeCode/managed-settings.json")));
    #[cfg(target_os = "windows")]
    out.push(("gerenciado (empresa)".into(), PathBuf::from(r"C:\Program Files\ClaudeCode\managed-settings.json")));
    out.into_iter().filter(|(_, p)| p.exists()).collect()
}

fn access_report_for(state: &AppState, project_id: &str) -> Result<access::Report, String> {
    let p = state.store.lock().map_err(|e| e.to_string())?.get(project_id).cloned().ok_or(crate::i18n::tr("projeto não encontrado", "project not found"))?;
    let root = PathBuf::from(&p.path);
    let others = access_others(state, &p.account_id, &root);
    Ok(access::report(&root, p.access, &p.overrides, p.applied.as_ref(), &others))
}

/// Grava as regras do nível atual (se `force` ou se o projeto já estava aplicado).
fn reapply(state: &AppState, project_id: &str, force: bool) -> Result<(), String> {
    let mut store = state.store.lock().map_err(|e| e.to_string())?;
    let p = store.get_mut(project_id).ok_or(crate::i18n::tr("projeto não encontrado", "project not found"))?;
    if !force && p.applied.is_none() {
        return Ok(());
    }
    let root = PathBuf::from(&p.path);
    if !root.is_dir() {
        return Err(crate::i18n::tr("a pasta do projeto não existe mais", "the project folder no longer exists").into());
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
            let p = store.get_mut(&project_id).ok_or(crate::i18n::tr("projeto não encontrado", "project not found"))?;
            match rule {
                Some(r) if !spec.choices.contains(&r) => return Err(crate::i18n::tr("essa opção não existe para este item", "that option doesn't exist for this item").into()),
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
        let p = store.get_mut(&project_id).ok_or(crate::i18n::tr("projeto não encontrado", "project not found"))?;
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
    let p = state.store.lock().map_err(|e| e.to_string())?.get(&project_id).cloned().ok_or(crate::i18n::tr("projeto não encontrado", "project not found"))?;
    let a = state.accounts.lock().map_err(|e| e.to_string())?.get(&p.account_id).cloned().ok_or(crate::i18n::tr("conta não encontrada", "account not found"))?;
    if a.provider != Provider::Claude {
        return Err(crate::trf!("{} não é uma conta do Claude. Troque a conta do projeto para abrir o Claude Code.", "{} isn't a Claude account. Change the project's account to open Claude Code.", a.label));
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
fn chat_send(
    app: AppHandle,
    state: State<'_, AppState>,
    project_id: String,
    text: String,
    attach: Option<String>,
    model: Option<String>,
    effort: Option<String>,
    files: Option<Vec<String>>,
    rewind: Option<String>,
) -> Result<Option<String>, String> {
    let (model, effort) = chat::model_choice(model, effort)?;
    let files = attach::checked(files)?;
    let mut args = chat_args(&state, project_id, model, effort)?;
    // arquivo anexado: só dentro do projeto e até 60 KB (Chat livre não anexa)
    if args.project_id != livre::ID {
        if let Some(rel) = attach.filter(|a| !a.is_empty()) {
            let full = files::resolve_in_root(&args.root, &rel)?;
            let mut body = std::fs::read_to_string(&full).map_err(|_| crate::trf!("não deu para ler {rel} como texto", "couldn't read {rel} as text"))?;
            if body.len() > 60_000 {
                let mut cut = 60_000;
                while !body.is_char_boundary(cut) {
                    cut -= 1;
                }
                body.truncate(cut);
                body.push_str("\n… (cortado)");
            }
            args.attach = Some((rel, body));
        }
    }
    args.text = text;
    args.files = files;
    args.rewind = rewind;
    state.chats.send(app, args)
}

/// Como o agente de uma conversa roda (conta, pasta, nível, memória). Texto e anexos vêm vazios.
fn chat_args(state: &AppState, project_id: String, model: Option<String>, effort: Option<String>) -> Result<chat::SendArgs, String> {
    if project_id == livre::ID {
        let mut account = state.free_account()?;
        if account.provider == Provider::Claude && model.is_some() {
            account.model = model.clone();
        }
        let pc = state.settings.lock().map_err(|e| e.to_string())?.free_pc;
        let t = livre::target(&state.data_dir, &xray::util::home(), pc)?;
        let claude = account.provider == Provider::Claude;
        return Ok(chat::SendArgs {
            project_id,
            root: if claude { t.cwd } else { t.tools_root },
            project_name: "Chat livre".into(),
            account,
            text: String::new(),
            attach: None,
            level: t.level,
            overrides: t.overrides,
            settings: t.settings,
            mode: t.mode,
            add_dir: t.add_dir,
            prompt: Some(t.prompt),
            tools: t.tools,
            stream_steps: true,
            effort: if claude { effort } else { None },
            files: vec![],
            rewind: None,
        });
    }
    let base = chat::base_project(&project_id).to_string();
    let p = state.store.lock().map_err(|e| e.to_string())?.get(&base).cloned().ok_or(crate::i18n::tr("projeto não encontrado", "project not found"))?;
    let mut account = state.accounts.lock().map_err(|e| e.to_string())?.get(&p.account_id).cloned().ok_or(crate::i18n::tr("conta não encontrada", "account not found"))?;
    let claude = account.provider == Provider::Claude;
    // memória do projeto: só para o Claude (nas APIs o texto substituiria as instruções)
    let memory = if claude { memory::prompt(&state.data_dir, &base) } else { None };
    if claude && model.is_some() {
        account.model = model;
    }
    let root = PathBuf::from(&p.path);
    chat::project_root_ok(&root)?;
    let settings = access::compile(p.access, &p.overrides).settings();
    Ok(chat::SendArgs {
        project_id,
        root,
        project_name: p.name.clone(),
        account,
        text: String::new(),
        attach: None,
        level: p.access,
        overrides: p.overrides.clone(),
        settings,
        mode: access::MODES[p.access.min(3) as usize],
        add_dir: None,
        prompt: memory,
        tools: true,
        stream_steps: false,
        effort: if claude { effort } else { None },
        files: vec![],
        rewind: None,
    })
}

/// Raio-x do contexto da conversa (o `/context` do Claude): o que ocupa a janela e quanto falta.
#[tauri::command]
async fn chat_context(state: State<'_, AppState>, project_id: String, model: Option<String>, session: Option<String>) -> Result<context::Context, String> {
    let (model, _) = chat::model_choice(model, None)?;
    let args = chat_args(&state, project_id, model, None)?;
    if args.account.provider != Provider::Claude {
        return Err(crate::i18n::tr("O raio-x do contexto é só para conversas com o Claude.", "The context breakdown is only for conversations with Claude.").into());
    }
    // a do chat aberto; senão a que a aba lembra (conversa ainda não retomada neste processo)
    let session = state.chats.current(&args.project_id).filter(|(k, _)| k == "claude").map(|(_, s)| s).or(session.filter(|s| convos::valid_id(s)));
    blocking(move || context::run(&args, session.as_deref())).await?
}

/// Guarda um anexo colado (imagem do ⌘V) e devolve o que a interface mostra.
#[tauri::command]
async fn attach_stage(state: State<'_, AppState>, name: String, data: String) -> Result<attach::Staged, String> {
    let dir = state.data_dir.join("anexos");
    blocking(move || attach::stage(&dir, &name, &data)).await?
}

/// Confere arquivos escolhidos no Finder ou arrastados para o chat.
#[tauri::command]
async fn attach_info(paths: Vec<String>) -> Result<Vec<attach::Staged>, String> {
    blocking(move || paths.iter().take(20).map(|p| attach::info(p)).collect()).await?
}

#[tauri::command(async)]
fn term_open(app: AppHandle, state: State<'_, AppState>, project_id: String, cols: u16, rows: u16) -> Result<term::TermInfo, String> {
    let p = state.store.lock().map_err(|e| e.to_string())?.get(&project_id).cloned().ok_or(crate::i18n::tr("projeto não encontrado", "project not found"))?;
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
        return Err(crate::i18n::tr("conversa inválida", "invalid conversation").into());
    }
    let owner = state.accounts.lock().map_err(|e| e.to_string())?.get(&account).cloned().ok_or(crate::i18n::tr("A conta desta conversa não existe mais no Veocode.", "This conversation's account no longer exists in Veocode."))?;
    let (current, root) = if project_id == livre::ID {
        (state.free_account()?.id, livre::dir(&state.data_dir))
    } else {
        let p = state.store.lock().map_err(|e| e.to_string())?.get(chat::base_project(&project_id)).cloned().ok_or(crate::i18n::tr("projeto não encontrado", "project not found"))?;
        (p.account_id.clone(), PathBuf::from(&p.path))
    };
    if current != account {
        return Err(crate::trf!("Esta conversa é da conta {}. Troque a conta para continuar nela.", "This conversation belongs to the {} account. Switch accounts to continue it.", owner.label));
    }
    let chats = state.chats.clone();
    #[cfg(debug_assertions)]
    let shown = id.clone();
    let r = blocking(move || {
        if kind == "claude" {
            if owner.provider != Provider::Claude {
                return Err(crate::i18n::tr("conversa inválida", "invalid conversation").to_string());
            }
            let file = convos::claude_dir(&accounts::claude::config_dir(&owner), &root).join(format!("{id}.jsonl"));
            if !file.is_file() {
                return Err(crate::i18n::tr("Essa sessão do Claude não existe mais.", "That Claude session no longer exists.").into());
            }
            chats.open(&project_id, &account, "claude", &id, None)?;
            Ok(agent::read_session(&root, &account, &file, convos::MAX_STEPS))
        } else {
            let (acc, msgs) = convos::load_api(&chats.api_dir(&project_id), &id)?;
            if acc != account {
                return Err(crate::i18n::tr("conversa inválida", "invalid conversation").into());
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
        return Err(crate::i18n::tr("conversa inválida", "invalid conversation").into());
    }
    let root = state.root_of(&project_id)?;
    let files: Vec<PathBuf> = if kind == "claude" {
        let owner = state.accounts.lock().map_err(|e| e.to_string())?.get(&account).cloned().ok_or(crate::i18n::tr("A conta desta conversa não existe mais no Veocode.", "This conversation's account no longer exists in Veocode."))?;
        if owner.provider != Provider::Claude {
            return Err(crate::i18n::tr("conversa inválida", "invalid conversation").into());
        }
        let dir = convos::claude_dir(&accounts::claude::config_dir(&owner), &root);
        // a sessão e, se houver, a pasta dos ajudantes dela (subagentes)
        [dir.join(format!("{id}.jsonl")), dir.join(&id)].into_iter().filter(|p| p.exists()).collect()
    } else {
        let dir = state.chats.api_dir(&project_id);
        [dir.join(format!("{id}.json")), dir.join(format!("{id}.meta.json"))].into_iter().filter(|p| p.exists()).collect()
    };
    if files.is_empty() {
        return Err(crate::i18n::tr("Essa conversa já não existe.", "That conversation no longer exists.").into());
    }
    if state.chats.current(&project_id).is_some_and(|(k, c)| k == kind && c == id) {
        state.chats.reset(&project_id);
    }
    blocking(move || inventory::to_trash(&files).map_err(|e| crate::trf!("Não deu para mandar para a Lixeira: {e}", "Couldn't send it to the Trash: {e}"))).await?
}

#[tauri::command]
async fn memory_get(state: State<'_, AppState>, project_id: String) -> Result<String, String> {
    memory::get(&state.data_dir, chat::base_project(&project_id))
}

#[tauri::command]
async fn memory_set(state: State<'_, AppState>, project_id: String, text: String) -> Result<String, String> {
    memory::set(&state.data_dir, chat::base_project(&project_id), &text)
}

#[tauri::command]
async fn memory_add(state: State<'_, AppState>, project_id: String, entry: String) -> Result<String, String> {
    memory::add(&state.data_dir, chat::base_project(&project_id), &entry)
}

#[tauri::command]
fn voice_start(app: AppHandle, locale: String) -> Result<u64, String> {
    voice::start(app, &locale)
}

#[tauri::command]
fn voice_stop() {
    voice::stop()
}

#[tauri::command]
fn voice_cancel() {
    voice::cancel()
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
    let a = state.accounts.lock().map_err(|e| e.to_string())?.get(account).cloned().ok_or(crate::i18n::tr("conta não encontrada", "account not found"))?;
    if a.provider != Provider::Claude {
        return Err(crate::i18n::tr("só contas do Claude têm plugins e MCP", "only Claude accounts have plugins and MCP").into());
    }
    // conta padrão: sem CLAUDE_CONFIG_DIR (senão o Claude procuraria o .claude.json no lugar errado)
    let dir = a.config_dir.is_some().then(|| accounts::claude::config_dir(&a));
    let project = match project.filter(|p| !p.is_empty()) {
        Some(p) => {
            if !state.inv_projects.lock().map_err(|e| e.to_string())?.contains(&p) {
                return Err(crate::i18n::tr("Essa pasta não está no inventário. Atualize e tente de novo.", "That folder isn't in the inventory. Refresh and try again.").into());
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
    xray::caches::known(&state.project_roots()).into_iter().find(|c| c.id == id).ok_or_else(|| crate::i18n::tr("cache não encontrado", "cache not found").into())
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

/// Quanto o Claude ocupa nesta máquina (app, Claude Code e o Veocode), com consertos.
#[tauri::command]
async fn claude_space(state: State<'_, AppState>) -> Result<xray::claude_space::Report, String> {
    let accounts: Vec<PathBuf> = state.claude_dirs()?.into_iter().map(|(_, d)| d).collect();
    let mine = vec![state.config_dir.clone(), state.data_dir.clone()];
    blocking(move || xray::claude_space::report(&accounts, &mine)).await
}

/// Aplica um conserto do espaço do Claude (só por id; manda para a Lixeira).
#[tauri::command]
async fn claude_space_fix(state: State<'_, AppState>, id: String) -> Result<u64, String> {
    let accounts: Vec<PathBuf> = state.claude_dirs()?.into_iter().map(|(_, d)| d).collect();
    blocking(move || xray::claude_space::apply(&id, &accounts)).await?
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
    let sys = guard.as_mut().ok_or(crate::i18n::tr("não deu para ler os processos do sistema", "couldn't read the system processes"))?;
    Ok(xray::procs::snapshot(sys))
}

#[tauri::command]
async fn xray_kill(state: State<'_, AppState>, pid: u32) -> Result<(), String> {
    let mut guard = state.sys.lock().map_err(|e| e.to_string())?;
    let sys = guard.as_mut().ok_or(crate::i18n::tr("não deu para ler os processos do sistema", "couldn't read the system processes"))?;
    xray::procs::kill(sys, pid)
}

/// Todas as portas abertas, com o que sobrou de sessões já fechadas.
#[tauri::command]
async fn xray_ports(state: State<'_, AppState>) -> Result<xray::procs::PortReport, String> {
    let roots = state.project_roots();
    let mut guard = state.sys.lock().map_err(|e| e.to_string())?;
    let sys = guard.as_mut().ok_or(crate::i18n::tr("não deu para ler os processos do sistema", "couldn't read the system processes"))?;
    Ok(xray::procs::ports(sys, &roots, &xray::util::home()))
}

/// O que está rodando dentro da pasta do projeto agora (servidores de dev, builds, testes).
#[tauri::command]
async fn project_procs(state: State<'_, AppState>, project_id: String) -> Result<Vec<xray::procs::ProjProc>, String> {
    let root = state.root_of(&project_id)?;
    let mut guard = state.sys.lock().map_err(|e| e.to_string())?;
    let sys = guard.as_mut().ok_or(crate::i18n::tr("não deu para ler os processos do sistema", "couldn't read the system processes"))?;
    Ok(xray::procs::project_procs(sys, &root))
}

#[tauri::command]
async fn project_kill(state: State<'_, AppState>, project_id: String, pid: u32) -> Result<(), String> {
    let root = state.root_of(&project_id)?;
    let mut guard = state.sys.lock().map_err(|e| e.to_string())?;
    let sys = guard.as_mut().ok_or(crate::i18n::tr("não deu para ler os processos do sistema", "couldn't read the system processes"))?;
    xray::procs::kill_in_project(sys, &root, pid)
}

#[tauri::command]
async fn xray_kill_leftover(state: State<'_, AppState>, pid: u32) -> Result<(), String> {
    let roots = state.project_roots();
    let mut guard = state.sys.lock().map_err(|e| e.to_string())?;
    let sys = guard.as_mut().ok_or(crate::i18n::tr("não deu para ler os processos do sistema", "couldn't read the system processes"))?;
    xray::procs::kill_leftover(sys, pid, &roots, &xray::util::home())
}

// ---------------------------------------------------------------- Ajustes

#[tauri::command(async)]
fn settings_get(state: State<'_, AppState>) -> Result<settings::Settings, String> {
    Ok(state.settings.lock().map_err(|e| e.to_string())?.clone())
}

/// A tela avisa o idioma em uso (o ajuste ou o do sistema) para as mensagens do Rust.
#[tauri::command]
fn i18n_set(en: bool) {
    i18n::set_en(en);
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
            voice_start,
            voice_stop,
            voice_cancel,
            git_status,
            git_summaries,
            git_fetch,
            git_github,
            git_commit_files,
            git_commit_diff,
            git_file_diff,
            settings_get,
            i18n_set,
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
            chat_context,
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
            image_preview,
            memory_get,
            memory_set,
            memory_add,
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
            account_limits,
            account_login,
            account_browser_login,
            account_login_code,
            account_login_cancel,
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
            claude_space,
            attach_stage,
            attach_info,
            claude_space_fix,
            xray_installs,
            xray_machines,
            xray_models,
            xray_toggle_machine,
            xray_processes,
            xray_kill,
            project_procs,
            project_kill,
            xray_ports,
            xray_kill_leftover,
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
