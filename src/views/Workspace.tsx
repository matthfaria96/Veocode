import { ArrowDown, ArrowUp, ChevronDown, Code2, FilePlus, FlaskConical, FolderMinus, FolderPlus, FolderSearch, GitBranch, MessagesSquare, PanelLeft, PanelRight, Pause, Play, RefreshCw } from "lucide-solid";
import { askCloseProject } from "../components/CloseProject";
import { ProjectIcon } from "../components/icons";
import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { accessLevels } from "../data/mock";
import { accountById } from "../accounts";
import { git, loadSummaries, setGitTab } from "../git";
import CodeSide, { GitCount } from "../components/CodeSide";
import { absPathOf, addProjectFromPicker, currentProject, isDiffTab, projectId, projects, resetWorkspace, setProjectId, setWs, showToast, ws } from "../store";
import ConvSidebar from "../components/ConvSidebar";
import DebugPane from "../components/DebugPane";
import { startAgentSim } from "../sim/agentSim";
import { dismissable } from "../dismiss";
import { newEntry } from "../fileActions";
import { startAgentFeed } from "../agentFeed";
import { anyBusy, restoreChat } from "../chat";
import { loadDir, openRealProject } from "../realProject";
import { api } from "../api";
import FileTree from "../components/FileTree";
import RealFileTree from "../components/RealFileTree";
import Editor from "../components/Editor";
import ChatPanel from "../components/ChatPanel";
import AgentCursors from "../components/AgentCursors";
import { ProviderMark } from "../components/ui";
import { chatFull, closeSheets, codeSideOpen, codeSideW, debugOpen, debugTab, debugW, leftSheet, narrowLeft, narrowRight, projMode, reviewWide, setCodeSideOpen, setCodeSideW, setDebugOpen, setDebugW, setLeftSheet, setChatFull, setProjMode, setReviewWide, sheetOpen, showTerm, toggleTerm } from "../layoutMode";

import { tx, txn } from "../i18n";
import { brFull } from "../browser";

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
      <button role="radio" aria-checked={projMode() === "code"} classList={{ on: projMode() === "code" }} onClick={() => setProjMode("code")} title={tx("Código: árvore de arquivos e editor; Git, terminal e Ambiente no painel da direita (⌘E alterna)")}>
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

  // ⌘E troca de modo; ⌘J (ou ⌃`) abre e fecha o terminal (painel da direita) no modo Código
  onMount(() => {
    const key = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const overlay = !!document.querySelector(".modal-backdrop, .palette-backdrop");
      if (e.key === "Escape" && sheetOpen() && !overlay) {
        closeSheets();
      } else if (e.key === "Escape" && wide() && !overlay) {
        setReviewWide(false);
      } else if (e.key === "Escape" && full() && !overlay && !document.querySelector(".menu, .agent-menu")) {
        setChatFull(false);
      } else if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        setProjMode(projMode() === "code" ? "ai" : "code");
      } else if (projMode() === "code" && mod && e.altKey && !e.shiftKey && (e.key.toLowerCase() === "b" || e.code === "KeyB")) {
        e.preventDefault();
        if (wide()) (setReviewWide(false), setCodeSideOpen(true));
        else setCodeSideOpen(!codeSideOpen());
      } else if (projMode() === "code" && ((mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "j") || (e.ctrlKey && (e.key === "`" || e.code === "Backquote")))) {
        e.preventDefault();
        if (wide()) (setReviewWide(false), showTerm());
        else toggleTerm();
      }
    };
    window.addEventListener("keydown", key);
    onCleanup(() => window.removeEventListener("keydown", key));
  });

  const code = () => projMode() === "code";
  // tela cheia: só a conversa (o modo IA sem a lista da esquerda e o painel da direita)
  const full = () => !code() && chatFull();
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
  // comparação ampliada: só vale com um diff ou commit na frente, no modo Código
  const wide = () => code() && reviewWide() && isDiffTab(ws.activeFile);
  createEffect(on(() => isDiffTab(ws.activeFile), (d) => !d && setReviewWide(false), { defer: true }));
  // janela estreita: o Git é uma gaveta por cima; ao abrir uma comparação ela sai da frente
  createEffect(on(() => ws.activeFile, (f) => code() && narrowRight() && isDiffTab(f) && setCodeSideOpen(false), { defer: true }));

  return (
    <div
      class="workspace"
      classList={{ "ws-code": code(), "ws-ai": !code(), "debug-off": !debugOpen(), "cside-on": code() && codeSideOpen() && !wide(), "review-wide": wide(), focus: full(), resizing: dragging(), "left-sheet": narrowLeft() && leftSheet(), "br-full": !code() && debugOpen() && debugTab() === "browser" && brFull() }}
      style={{ "--debug-w": `${debugW()}px`, "--cside-w": `${codeSideW()}px` }}
      ref={root}
    >
      <aside class="sidebar" onClick={(e) => narrowLeft() && (e.target as HTMLElement).closest(".cv-row, .tree-row:not(.dir)") && setLeftSheet(false)}>
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
            <GitBranch size={12} />
            <span class="meta-branch">{git.summaries[p().id]?.branch ?? p().branch}</span>
            <Show when={git.summaries[p().id]?.changed}>
              {(n) => <span class="meta-n edit" title={tx("Arquivos mudados desde o último commit (ainda não salvos no git)")}>{txn(n(), "{n} mudado", "{n} mudados")}</span>}
            </Show>
            <Show when={git.summaries[p().id]?.ahead}>
              {(n) => <span class="meta-n up" title={tx("Commits que só existem neste computador")}><ArrowUp size={10} stroke-width={2.4} />{n()}</span>}
            </Show>
            <Show when={git.summaries[p().id]?.behind}>
              {(n) => <span class="meta-n down" title={tx("Commits que estão no remoto e ainda não aqui")}><ArrowDown size={10} stroke-width={2.4} />{n()}</span>}
            </Show>
          </button>
          <span class="meta-acc" title={tx("Conta de IA deste projeto")}>
            <span class="meta-dot" style={{ background: accountById(p().accountId).color }} />
            <span class="meta-acc-name">{accountById(p().accountId).label}</span>
          </span>
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
              <NarrowBar code={false} name={p().name} />
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
        <section class="code-main">
          <NarrowBar code name={p().name} />
          <div class="code-stage">
            <Editor
              tools={
                <>
                  <button class="icon-btn small side-toggle" classList={{ on: codeSideOpen() && !wide() }} title={codeSideOpen() && !wide() ? tx("Esconder o painel da direita (⌥⌘B)") : tx("Mostrar o painel da direita: Git, Terminal (⌘J) e Ambiente (⌥⌘B)")} onClick={() => (wide() ? (setReviewWide(false), setCodeSideOpen(true)) : setCodeSideOpen(!codeSideOpen()))}>
                    <PanelRight size={14} />
                    <Show when={!codeSideOpen() || wide()}><GitCount pid={p().id} /></Show>
                  </button>
                </>
              }
            />
          </div>
        </section>
        <Show when={codeSideOpen() && !wide()}>
          <div class="pane-resize" title={tx("Arraste para mudar a largura")} onPointerDown={dragSide} onDblClick={() => setCodeSideW(400, true)} />
          <CodeSide />
        </Show>
        </>
      </Show>
      <Show when={sheetOpen()}><div class="ws-scrim" onClick={closeSheets} /></Show>
      <AgentCursors />
    </div>
  );
}

/** Janela estreita: a lateral sai da tela e este botão traz ela de volta, por cima. */
function NarrowBar(props: { code: boolean; name: string }) {
  return (
    <div class="ws-strip">
      <button class="ghost-btn small" onClick={() => setLeftSheet(true)}>
        <PanelLeft size={14} /> {props.code ? tx("Arquivos") : tx("Conversas")}
      </button>
      <span class="ws-strip-name">{props.name}</span>
    </div>
  );
}
