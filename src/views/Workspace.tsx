import { ChevronDown, FilePlus, FlaskConical, FolderMinus, FolderPlus, FolderSearch, GitBranch, Maximize2, Minimize2, Pause, Play, Plus, RefreshCw, X } from "lucide-solid";
import { askCloseProject } from "../components/CloseProject";
import { ProjectIcon } from "../components/icons";
import { createEffect, createSignal, For, Match, on, onCleanup, Show, Switch } from "solid-js";
import { accessLevels } from "../data/mock";
import { accountById } from "../accounts";
import { git, gitWords, loadSummaries, setGitTab, setSideTab, sideTab } from "../git";
import { isUnsaved, saveNow } from "../editing";
import GitPanel from "../components/GitPanel";
import TrailPanel from "../components/TrailPanel";
import { absPathOf, addProjectFromPicker, currentProject, projectId, projects, resetWorkspace, setProjectId, setWs, showToast, ws } from "../store";
import { startAgentSim } from "../sim/agentSim";
import { dismissable } from "../dismiss";
import { newEntry } from "../fileActions";
import { startAgentFeed } from "../agentFeed";
import { anyBusy, restoreChat } from "../chat";
import { loadDir, openRealProject } from "../realProject";
import { api, isTauri } from "../api";
import FileTree from "../components/FileTree";
import RealFileTree from "../components/RealFileTree";
import Editor from "../components/Editor";
import ChatPanel from "../components/ChatPanel";
import BottomPanel from "../components/BottomPanel";
import AgentCursors from "../components/AgentCursors";
import { ProviderMark } from "../components/ui";
import { projectState } from "../board";
import { watchFeeds } from "../feeds";
import { bottomOpen, filesMax, filesW, focusMode, resetFilesW, setFilesMax, setFilesW, setWsMode, wsMode } from "../layoutMode";

import { tx, txn } from "../i18n";

const [dragging, setDragging] = createSignal(false);
/** Arrastar a borda do painel de arquivos (à direita do chat). */
function startDrag(e: PointerEvent) {
  e.preventDefault();
  const x0 = e.clientX;
  const w0 = filesW();
  const max = Math.min(1400, window.innerWidth - 640);
  setDragging(true);
  const move = (ev: PointerEvent) => setFilesW(Math.round(Math.max(340, Math.min(max, w0 + (x0 - ev.clientX)))));
  const up = () => {
    setDragging(false);
    setFilesW(filesW(), true);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

/** Fecha todas as abas de arquivo (grava antes o que ainda falta gravar). */
async function closeAllFiles() {
  for (const path of [...ws.openTabs]) if (!currentProject().demo && isUnsaved(path) && !(await saveNow(path))) return showToast(tx("Não deu para salvar {path}: feche a aba dele para decidir", { path }));
  setWs("openTabs", []);
  setWs("activeFile", "");
  setFilesMax(false);
}

export default function Workspace() {
  let root!: HTMLDivElement;
  const [pick, setPick] = createSignal(false);
  const p = currentProject;

  // Troca de projeto: demo liga a simulação; real carrega a pasta do disco.
  createEffect(
    on(projectId, () => {
      const project = currentProject();
      if (project.demo) {
        resetWorkspace(true);
        // começa parada: a pessoa escolhe assistir
        setWs("paused", true);
        const stop = startAgentSim(root);
        onCleanup(stop);
      } else {
        openRealProject();
        void loadSummaries(true);
        // passos reais do Claude nesta pasta (lidos dos históricos dele)
        const stop = startAgentFeed(root);
        onCleanup(stop);
        // conversa com API guardada no Rust; resposta ainda chegando
        restoreChat(project.id);
        if (anyBusy(project.id)) setWs("running", true);
      }
    }),
  );

  const removeFromList = () => askCloseProject(p().id);

  const reveal = () => {
    const abs = absPathOf(p().id);
    if (abs) api.reveal(abs).catch((e) => showToast(String(e)));
  };

  return (
    <div class="workspace" classList={{ focus: focusMode() && isTauri && !p().demo, adv: wsMode() === "avancado", "has-files": ws.openTabs.length > 0, "files-max": filesMax() && ws.openTabs.length > 0, resizing: dragging() }} style={{ "--files-w": `${filesW()}px` }} ref={root}>
      <Show when={wsMode() === "avancado"}>
        <ProjectsColumn />
      </Show>
      <aside class="sidebar">
        <div class="project-switch">
          <button class="project-btn" onClick={() => setPick(!pick())}>
            <ProjectIcon id={p().id} name={p().name} stack={p().stack} size={20} />
            <div>
              <strong>{p().name}</strong>
              <small>{p().stack}</small>
            </div>
            <ChevronDown size={14} />
          </button>
          <Show when={pick()}>
            <div class="menu pop-in" ref={(el) => dismissable(el, () => setPick(false))}>
              <small class="menu-title">{tx("Projetos")}</small>
              <For each={projects}>
                {(pr) => (
                  <button
                    class="menu-item"
                    classList={{ sel: pr.id === p().id }}
                    onClick={() => {
                      setProjectId(pr.id);
                      setPick(false);
                    }}
                  >
                    <ProjectIcon id={pr.id} name={pr.name} stack={pr.stack} size={16} />
                    <span>{pr.name}</span>
                    <ProviderMark id={pr.accountId} size={16} />
                    <small style={{ color: accessLevels[pr.access].color }}>{accessLevels[pr.access].short}</small>
                  </button>
                )}
              </For>
              <div class="menu-sep" />
              <button
                class="menu-item"
                onClick={() => {
                  setPick(false);
                  addProjectFromPicker();
                }}
              >
                <FolderPlus size={16} />
                <span>{tx("Adicionar pasta…")}</span>
              </button>
              <Show when={!p().demo}>
                <button
                  class="menu-item danger"
                  onClick={() => {
                    setPick(false);
                    removeFromList();
                  }}
                >
                  <FolderMinus size={16} />
                  <span>{tx("Fechar {name}…", { name: p().name })}</span>
                </button>
              </Show>
            </div>
          </Show>
        </div>

        <div class="sidebar-meta">
          <button class="meta-git" title={tx("Git e GitHub deste projeto")} onClick={() => setGitTab("git")}>
            <GitBranch size={12} /> {git.summaries[p().id]?.branch ?? p().branch}
            <For each={gitWords(git.summaries[p().id])}>{(w) => <span class="meta-n edit" title={w.tip}>· {w.text}</span>}</For>
          </button>
          <span class="meta-dot" style={{ background: accountById(p().accountId).color }} />
          <span>{accountById(p().accountId).label}</span>
        </div>

        <div class="seg three side-seg">
          <button classList={{ active: sideTab() === "files" }} onClick={() => setSideTab("files")} title={tx("Arquivos da pasta")}>{tx("Arquivos")}</button>
          <button classList={{ active: sideTab() === "git" }} onClick={() => setSideTab("git")} title={tx("Git e GitHub deste projeto")}>{tx("Git")} <GitBadge /></button>
          <button classList={{ active: sideTab() === "trail" }} onClick={() => setSideTab("trail")} title={tx("O que a IA deixou: sobras para limpar, pastas fora do projeto e o que instalou")}>{tx("Rastro")}</button>
          <span class="seg-thumb" style={{ transform: `translateX(${["files", "git", "trail"].indexOf(sideTab()) * 100}%)` }} />
        </div>

        <Switch>
          <Match when={sideTab() === "files"}>
            <div class="sidebar-title">
              <span title={p().path}>{tx("Arquivos{v}", { v: p().demo ? tx(" (fictícios)") : "" })}</span>
              <Show when={!p().demo}>
                <span class="sidebar-tools">
                  <button class="icon-btn small" title={tx("Novo arquivo")} onClick={() => void newEntry("", false)}><FilePlus size={12} /></button>
                  <button class="icon-btn small" title={tx("Nova pasta")} onClick={() => void newEntry("", true)}><FolderPlus size={12} /></button>
                  <button class="icon-btn small" title={tx("Recarregar a lista de arquivos")} onClick={() => loadDir("")}><RefreshCw size={12} /></button>
                  <button class="icon-btn small" title={tx("Mostrar no Finder/Explorer")} onClick={reveal}><FolderSearch size={12} /></button>
                  <button class="icon-btn small" title={tx("Fechar este projeto (tirar do Veocode)")} onClick={removeFromList}><FolderMinus size={12} /></button>
                </span>
              </Show>
            </div>

            <Show when={p().demo} fallback={<Show when={p().exists} fallback={<div class="tree-loading">{tx("A pasta {path} não existe mais.", { path: p().path })}</div>}><RealFileTree /></Show>}>
              <FileTree />
            </Show>

          </Match>
          <Match when={sideTab() === "git"}>
            <div class="side-scroll"><GitPanel /></div>
          </Match>
          <Match when={sideTab() === "trail"}>
            <div class="side-scroll"><TrailPanel /></div>
          </Match>
        </Switch>

        <div class="mode-switch" role="radiogroup" aria-label={tx("Modo da tela")}>
          <button role="radio" aria-checked={wsMode() === "simples"} classList={{ active: wsMode() === "simples" }} onClick={() => setWsMode("simples")} title={tx("Um projeto por vez: troque pelo nome lá em cima")}>{tx("Simples")}</button>
          <button role="radio" aria-checked={wsMode() === "avancado"} classList={{ active: wsMode() === "avancado" }} onClick={() => setWsMode("avancado")} title={tx("Todos os projetos numa coluna ao lado dos arquivos: um clique troca")}>{tx("Avançado")}</button>
        </div>
      </aside>

      <section class="center">
        <Show when={p().demo}>
          <div class="sim-banner">
            <FlaskConical size={15} />
            <div>
              <strong>{tx("Simulação de exemplo")}</strong>
              <span>{tx("Nada aqui é real: os arquivos e a IA são de mentira, só para mostrar como fica. Adicione uma pasta sua para ver as suas IAs de verdade.")}</span>
            </div>
            <button class="ghost-btn small" onClick={() => setWs("paused", !ws.paused)}>{ws.paused ? <Play size={12} /> : <Pause size={12} />} {ws.paused ? tx("Assistir") : tx("Pausar")}</button>
            <button class="primary-btn small" onClick={() => void addProjectFromPicker()}><FolderPlus size={13} /> {tx("Adicionar pasta")}</button>
          </div>
        </Show>
        <ChatPanel />
        <Show when={bottomOpen()}>
          <BottomPanel />
        </Show>
      </section>

      <Show when={ws.openTabs.length > 0}>
        <div class="chat-resize" title={tx("Arraste para alargar ou estreitar os arquivos (dois cliques volta ao normal)")} onPointerDown={startDrag} onDblClick={resetFilesW} />
        <section class="files-pane pop-in">
          <Editor />
          <div class="files-tools">
            <button class="icon-btn small" title={filesMax() ? tx("Voltar ao normal") : tx("Maximizar os arquivos (o chat fica estreito)")} onClick={() => setFilesMax(!filesMax())}>
              {filesMax() ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
            <button class="icon-btn small" title={tx("Fechar os arquivos")} onClick={() => void closeAllFiles()}><X size={14} /></button>
          </div>
        </section>
      </Show>
      <AgentCursors />
    </div>
  );
}

/** Modo avançado: todos os projetos um embaixo do outro, com a situação de cada um; um clique troca. */
function ProjectsColumn() {
  const ids = () => projects.filter((x) => !x.demo).map((x) => x.id).join(",");
  createEffect(on(ids, (l) => {
    const stop = watchFeeds("ws-column", l ? l.split(",") : [], 4000);
    onCleanup(stop);
  }));
  return (
    <aside class="proj-col">
      <div class="proj-col-head">
        <span>{tx("Projetos")}</span>
        <button class="icon-btn small" title={tx("Adicionar pasta")} onClick={() => void addProjectFromPicker()}><Plus size={13} /></button>
      </div>
      <div class="proj-col-list">
        <For each={projects}>
          {(pr) => {
            const st = () => (pr.demo ? { tone: "idle", label: tx("simulação") } : projectState(pr.id));
            const g = () => git.summaries[pr.id];
            return (
              <button class="proj-col-item" classList={{ sel: pr.id === projectId() }} onClick={() => setProjectId(pr.id)} title={pr.path}>
                <ProjectIcon id={pr.id} name={pr.name} stack={pr.stack} size={18} />
                <span class="proj-col-text">
                  <strong>{pr.name}</strong>
                  <small>
                    <i class={`proj-col-dot ${st().tone}`} />
                    {st().label}
                    <Show when={g()?.changed}><span class="meta-n edit" title={tx("Arquivos mudados desde o último commit")}> {tx("· {changed} mudados", { changed: g()!.changed })}</span></Show>
                  </small>
                </span>
                <span class="proj-col-acc" style={{ background: accountById(pr.accountId).color }} title={accountById(pr.accountId).label} />
              </button>
            );
          }}
        </For>
      </div>
    </aside>
  );
}

/** Na aba Git: quantos commits faltam enviar ou baixar, ou um ponto quando há mudanças. */
function GitBadge() {
  const sum = () => git.summaries[currentProject().id];
  return (
    <Show when={sum()?.repo}>
      <Show when={sum()!.ahead || sum()!.behind} fallback={<Show when={sum()!.changed}><i class="seg-dot" title={txn(sum()!.changed, "{n} arquivo mudado", "{n} arquivos mudados")} /></Show>}>
        <span class="seg-badge" title={tx("Commits para enviar / baixar")}>{sum()!.ahead ? `↑${sum()!.ahead}` : ""}{sum()!.behind ? `↓${sum()!.behind}` : ""}</span>
      </Show>
    </Show>
  );
}
