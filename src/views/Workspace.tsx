import { ChevronDown, Code2, FilePlus, FlaskConical, FolderMinus, FolderPlus, FolderSearch, GitBranch, MessagesSquare, PanelRight, Pause, Play, RefreshCw, SquareTerminal, X } from "lucide-solid";
import { askCloseProject } from "../components/CloseProject";
import { ProjectIcon } from "../components/icons";
import { createEffect, createSignal, For, lazy, on, onCleanup, onMount, Show, Suspense } from "solid-js";
import { accessLevels } from "../data/mock";
import { accountById } from "../accounts";
import { git, gitWords, loadSummaries, setGitTab } from "../git";
import CodeSide, { GitCount } from "../components/CodeSide";
import { absPathOf, addProjectFromPicker, currentProject, projectId, projects, resetWorkspace, setProjectId, setWs, showToast, ws } from "../store";
import ConvSidebar from "../components/ConvSidebar";
import DebugPane from "../components/DebugPane";
// o xterm só carrega quando o terminal abre
const ProjectTerminal = lazy(() => import("../components/ProjectTerminal"));
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
import AgentCursors from "../components/AgentCursors";
import { ProviderMark } from "../components/ui";
import { codeSideOpen, codeSideW, debugOpen, debugW, focusMode, moveTerm, projMode, setCodeSideOpen, setCodeSideW, setDebugOpen, setDebugW, setProjMode, setTermH, setTermOpen, termAt, termH, termOpen, termShown, toggleTerm } from "../layoutMode";

import { tx } from "../i18n";

const [dragging, setDragging] = createSignal(false);
/** Arrastar uma borda: `apply` recebe o quanto o ponteiro andou desde o começo; `done` grava. */
function startDrag(e: PointerEvent, axis: "x" | "y", apply: (delta: number) => void, done: () => void) {
  e.preventDefault();
  const x0 = e.clientX;
  const y0 = e.clientY;
  setDragging(true);
  document.body.classList.add(axis === "x" ? "resizing-h" : "resizing-v");
  const move = (ev: PointerEvent) => apply(axis === "x" ? ev.clientX - x0 : ev.clientY - y0);
  const up = () => {
    setDragging(false);
    document.body.classList.remove("resizing-h", "resizing-v");
    done();
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

/** IA ou Código: o mesmo projeto visto como conversa com a IA (o principal) ou como editor. */
function ModeSwitch() {
  return (
    <div class="view-switch" role="radiogroup" aria-label={tx("Modo da tela")}>
      <button role="radio" aria-checked={projMode() === "ai"} classList={{ on: projMode() === "ai" }} onClick={() => setProjMode("ai")} title={tx("IA: conversas, e ao lado o app rodando, comandos e subagentes (⌘E alterna)")}>
        <MessagesSquare size={13} /><span>{tx("IA")}</span>
      </button>
      <button role="radio" aria-checked={projMode() === "code"} classList={{ on: projMode() === "code" }} onClick={() => setProjMode("code")} title={tx("Código: árvore de arquivos, editor e terminal; Git e Rastro no painel da direita (⌘E alterna)")}>
        <Code2 size={13} /><span>{tx("Código")}</span>
      </button>
      <span class="view-thumb" style={{ transform: `translateX(${projMode() === "code" ? 100 : 0}%)` }} />
    </div>
  );
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

  // ⌘E troca de modo; ⌘J (ou ⌃`) abre e fecha o terminal no modo Código
  onMount(() => {
    const key = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        setProjMode(projMode() === "code" ? "ai" : "code");
      } else if (projMode() === "code" && mod && e.altKey && !e.shiftKey && (e.key.toLowerCase() === "b" || e.code === "KeyB")) {
        e.preventDefault();
        setCodeSideOpen(!codeSideOpen());
      } else if (projMode() === "code" && ((mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "j") || (e.ctrlKey && (e.key === "`" || e.code === "Backquote")))) {
        e.preventDefault();
        toggleTerm();
      }
    };
    window.addEventListener("keydown", key);
    onCleanup(() => window.removeEventListener("keydown", key));
  });

  const code = () => projMode() === "code";
  // a simulação é uma demonstração da IA: no modo Código ela para (não fica abrindo arquivos no editor)
  createEffect(() => code() && p().demo && !ws.paused && setWs("paused", true));
  const dragDebug = (e: PointerEvent) => {
    const w0 = debugW();
    const max = Math.min(1400, window.innerWidth - 620);
    startDrag(e, "x", (d) => setDebugW(Math.round(Math.max(320, Math.min(max, w0 - d)))), () => setDebugW(debugW(), true));
  };
  const dragSide = (e: PointerEvent) => {
    const w0 = codeSideW();
    const max = Math.min(1200, window.innerWidth - 640);
    startDrag(e, "x", (d) => setCodeSideW(Math.round(Math.max(300, Math.min(max, w0 - d)))), () => setCodeSideW(codeSideW(), true));
  };
  const dragTerm = (e: PointerEvent) => {
    const h0 = termH();
    startDrag(e, "y", (d) => setTermH(Math.round(Math.max(120, Math.min(window.innerHeight - 220, h0 - d)))), () => setTermH(termH(), true));
  };
  const bottomTerm = () => termAt() === "bottom" && termOpen();

  return (
    <div
      class="workspace"
      classList={{ "ws-code": code(), "ws-ai": !code(), "debug-off": !debugOpen(), "cside-on": code() && codeSideOpen(), focus: !code() && focusMode() && isTauri && !p().demo, resizing: dragging() }}
      style={{ "--debug-w": `${debugW()}px`, "--cside-w": `${codeSideW()}px` }}
      ref={root}
    >
      <aside class="sidebar">
        <div class="side-top">
          <ModeSwitch />
        </div>
        <Show when={code()} fallback={<ConvSidebar />}>
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
          <button class="meta-git" title={tx("Git e GitHub deste projeto (painel da direita)")} onClick={() => setGitTab("git")}>
            <GitBranch size={12} /> {git.summaries[p().id]?.branch ?? p().branch}
            <For each={gitWords(git.summaries[p().id])}>{(w) => <span class="meta-n edit" title={w.tip}>· {w.text}</span>}</For>
          </button>
          <span class="meta-dot" style={{ background: accountById(p().accountId).color }} />
          <span>{accountById(p().accountId).label}</span>
        </div>

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
        </Show>
      </aside>

      <Show
        when={code()}
        fallback={
          <>
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
                  <Show when={!debugOpen()}>
                    <button class="icon-btn small" title={tx("Mostrar o painel da direita: navegador, comandos, subagentes")} onClick={() => setDebugOpen(true)}><PanelRight size={14} /></button>
                  </Show>
                </div>
              </Show>
              <ChatPanel slim />
            </section>
            <Show when={debugOpen()}>
              <div class="pane-resize" title={tx("Arraste para mudar a largura")} onPointerDown={dragDebug} onDblClick={() => setDebugW(440, true)} />
              <DebugPane />
            </Show>
          </>
        }
      >
        <>
        <section class="code-main" classList={{ "term-on": bottomTerm() }} style={{ "--term-h": `${termH()}px` }}>
          <div class="code-stage">
            <Editor
              tools={
                <>
                  <button class="icon-btn small" classList={{ on: termShown() }} title={termShown() ? tx("Esconder o terminal (⌘J)") : tx("Mostrar o terminal (⌘J)")} onClick={toggleTerm}>
                    <SquareTerminal size={14} />
                  </button>
                  <button class="icon-btn small side-toggle" classList={{ on: codeSideOpen() }} title={codeSideOpen() ? tx("Esconder o painel da direita (⌥⌘B)") : tx("Mostrar o painel da direita: Git, conversa com a IA e terminal (⌥⌘B)")} onClick={() => setCodeSideOpen(!codeSideOpen())}>
                    <PanelRight size={14} />
                    <Show when={!codeSideOpen()}><GitCount pid={p().id} /></Show>
                  </button>
                </>
              }
            />
          </div>
          <Show when={bottomTerm()}>
            <div class="term-split" onPointerDown={dragTerm} onDblClick={() => setTermH(260, true)} title={tx("Arraste para mudar o tamanho")} />
            <section class="code-term">
              <Suspense fallback={<div class="pterm-empty"><span class="spinner" /> {tx("Carregando o terminal…")}</div>}>
                <ProjectTerminal
                  tools={
                    <>
                      <button class="icon-btn small" title={tx("Pôr o terminal no painel da direita, como uma aba")} onClick={() => moveTerm("side")}>
                        <PanelRight size={13} />
                      </button>
                      <button class="icon-btn small" title={tx("Fechar o terminal (⌘J)")} onClick={() => setTermOpen(false)}><X size={13} /></button>
                    </>
                  }
                />
              </Suspense>
            </section>
          </Show>
        </section>
        <Show when={codeSideOpen()}>
          <div class="pane-resize" title={tx("Arraste para mudar a largura")} onPointerDown={dragSide} onDblClick={() => setCodeSideW(400, true)} />
          <CodeSide />
        </Show>
        </>
      </Show>
      <AgentCursors />
    </div>
  );
}
