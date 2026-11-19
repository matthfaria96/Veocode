import { ChevronDown, FilePlus, FlaskConical, FolderMinus, FolderPlus, FolderSearch, GitBranch, Pause, Play, Plus, RefreshCw } from "lucide-solid";
import { askCloseProject } from "../components/CloseProject";
import { ProjectIcon } from "../components/icons";
import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import { accessLevels } from "../data/mock";
import { accountById } from "../accounts";
import { git, gitWords, loadSummaries, setGitTab } from "../git";
import { absPathOf, addProjectFromPicker, currentProject, projectId, projects, resetWorkspace, setProjectId, setWs, showToast, ws } from "../store";
import { startAgentSim } from "../sim/agentSim";
import { dismissable } from "../dismiss";
import { newEntry } from "../fileActions";
import { startAgentFeed } from "../agentFeed";
import { chatOf, restoreChat } from "../chat";
import { loadDir, openRealProject } from "../realProject";
import { api } from "../api";
import FileTree from "../components/FileTree";
import RealFileTree from "../components/RealFileTree";
import Editor from "../components/Editor";
import ChatPanel from "../components/ChatPanel";
import BottomPanel from "../components/BottomPanel";
import AgentCursors from "../components/AgentCursors";
import { ProviderMark } from "../components/ui";
import { projectState } from "../board";
import { watchFeeds } from "../feeds";
import { setWsMode, wsMode } from "../layoutMode";

// largura da conversa à direita: arrastável, lembrada neste computador
const CHAT_W = 400;
const readW = () => {
  try {
    const v = Number(localStorage.getItem("veocode.chat.width"));
    return v >= 320 && v <= 900 ? v : CHAT_W;
  } catch {
    return CHAT_W;
  }
};
const [chatW, setChatW] = createSignal(readW());
const saveChatW = (w: number) => {
  setChatW(w);
  try {
    localStorage.setItem("veocode.chat.width", String(w));
  } catch {
    /* sem armazenamento */
  }
};
const [dragging, setDragging] = createSignal(false);
function startDrag(e: PointerEvent) {
  e.preventDefault();
  const x0 = e.clientX;
  const w0 = chatW();
  const max = Math.min(900, window.innerWidth - 560);
  setDragging(true);
  const move = (ev: PointerEvent) => setChatW(Math.round(Math.max(320, Math.min(max, w0 + (x0 - ev.clientX)))));
  const up = () => {
    setDragging(false);
    saveChatW(chatW());
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
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
        if (chatOf(project.id).busy) setWs("running", true);
      }
    }),
  );

  const removeFromList = () => askCloseProject(p().id);

  const reveal = () => {
    const abs = absPathOf(p().id);
    if (abs) api.reveal(abs).catch((e) => showToast(String(e)));
  };

  return (
    <div class="workspace" classList={{ adv: wsMode() === "avancado", "no-file": !ws.activeFile, resizing: dragging() }} style={{ "--chat-w": `${chatW()}px` }} ref={root}>
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
              <small class="menu-title">Projetos</small>
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
                <span>Adicionar pasta…</span>
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
                  <span>Fechar {p().name}…</span>
                </button>
              </Show>
            </div>
          </Show>
        </div>

        <div class="sidebar-meta">
          <button class="meta-git" title="Git e GitHub deste projeto" onClick={() => setGitTab("git")}>
            <GitBranch size={12} /> {git.summaries[p().id]?.branch ?? p().branch}
            <For each={gitWords(git.summaries[p().id])}>{(w) => <span class="meta-n edit" title={w.tip}>· {w.text}</span>}</For>
          </button>
          <span class="meta-dot" style={{ background: accountById(p().accountId).color }} />
          <span>{accountById(p().accountId).label}</span>
        </div>

        <div class="sidebar-title">
          <span title={p().path}>Arquivos{p().demo ? " (fictícios)" : ""}</span>
          <Show when={!p().demo}>
            <span class="sidebar-tools">
              <button class="icon-btn small" title="Novo arquivo" onClick={() => void newEntry("", false)}><FilePlus size={12} /></button>
              <button class="icon-btn small" title="Nova pasta" onClick={() => void newEntry("", true)}><FolderPlus size={12} /></button>
              <button class="icon-btn small" title="Recarregar a lista de arquivos" onClick={() => loadDir("")}><RefreshCw size={12} /></button>
              <button class="icon-btn small" title="Mostrar no Finder/Explorer" onClick={reveal}><FolderSearch size={12} /></button>
              <button class="icon-btn small" title="Fechar este projeto (tirar do Veocode)" onClick={removeFromList}><FolderMinus size={12} /></button>
            </span>
          </Show>
        </div>

        <Show when={p().demo} fallback={<Show when={p().exists} fallback={<div class="tree-loading">A pasta {p().path} não existe mais.</div>}><RealFileTree /></Show>}>
          <FileTree />
        </Show>

        <div class="mode-switch" role="radiogroup" aria-label="Modo da tela">
          <button role="radio" aria-checked={wsMode() === "simples"} classList={{ active: wsMode() === "simples" }} onClick={() => setWsMode("simples")} title="Um projeto por vez: troque pelo nome lá em cima">Simples</button>
          <button role="radio" aria-checked={wsMode() === "avancado"} classList={{ active: wsMode() === "avancado" }} onClick={() => setWsMode("avancado")} title="Todos os projetos numa coluna ao lado dos arquivos: um clique troca">Avançado</button>
        </div>
      </aside>

      <section class="center">
        <Show when={p().demo}>
          <div class="sim-banner">
            <FlaskConical size={15} />
            <div>
              <strong>Simulação de exemplo</strong>
              <span>Nada aqui é real: os arquivos e a IA são de mentira, só para mostrar como fica. Adicione uma pasta sua para ver as suas IAs de verdade.</span>
            </div>
            <button class="ghost-btn small" onClick={() => setWs("paused", !ws.paused)}>{ws.paused ? <Play size={12} /> : <Pause size={12} />} {ws.paused ? "Assistir" : "Pausar"}</button>
            <button class="primary-btn small" onClick={() => void addProjectFromPicker()}><FolderPlus size={13} /> Adicionar pasta</button>
          </div>
        </Show>
        <Editor />
        <BottomPanel />
      </section>

      <div class="chat-resize" title="Arraste para alargar ou estreitar a conversa (dois cliques volta ao normal)" onPointerDown={startDrag} onDblClick={() => saveChatW(CHAT_W)} />
      <ChatPanel />
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
        <span>Projetos</span>
        <button class="icon-btn small" title="Adicionar pasta" onClick={() => void addProjectFromPicker()}><Plus size={13} /></button>
      </div>
      <div class="proj-col-list">
        <For each={projects}>
          {(pr) => {
            const st = () => (pr.demo ? { tone: "idle", label: "simulação" } : projectState(pr.id));
            const g = () => git.summaries[pr.id];
            return (
              <button class="proj-col-item" classList={{ sel: pr.id === projectId() }} onClick={() => setProjectId(pr.id)} title={pr.path}>
                <ProjectIcon id={pr.id} name={pr.name} stack={pr.stack} size={18} />
                <span class="proj-col-text">
                  <strong>{pr.name}</strong>
                  <small>
                    <i class={`proj-col-dot ${st().tone}`} />
                    {st().label}
                    <Show when={g()?.changed}><span class="meta-n edit" title="Arquivos mudados desde o último commit"> · {g()!.changed} mudados</span></Show>
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
