import { ChevronDown, Code2, FilePlus, FlaskConical, FolderMinus, FolderPlus, FolderSearch, GitBranch, MessagesSquare, PanelBottom, PanelRight, Pause, Play, Plus, RefreshCw, SquareTerminal, X } from "lucide-solid";
import { askCloseProject } from "../components/CloseProject";
import { ProjectIcon } from "../components/icons";
import { createEffect, createSignal, For, lazy, Match, on, onCleanup, onMount, Show, Suspense, Switch } from "solid-js";
import { accessLevels } from "../data/mock";
import { accountById } from "../accounts";
import { git, gitWords, loadSummaries, setGitTab, setSideTab, sideTab } from "../git";
import GitPanel from "../components/GitPanel";
import TrailPanel from "../components/TrailPanel";
import { absPathOf, addProjectFromPicker, currentProject, projectId, projects, resetWorkspace, setProjectId, setWs, showToast, ws } from "../store";
import ChatList from "../components/ChatList";
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
import { projectState } from "../board";
import { watchFeeds } from "../feeds";
import { debugOpen, debugW, focusMode, projMode, setDebugOpen, setDebugW, setProjMode, setTermAt, setTermH, setTermOpen, setTermW, setWsMode, termAt, termH, termOpen, termW, wsMode } from "../layoutMode";

import { tx, txn } from "../i18n";

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

/** Código ou IA: o mesmo projeto visto como editor ou como conversa com a IA. */
function ModeSwitch() {
  return (
    <div class="view-switch" role="radiogroup" aria-label={tx("Modo da tela")}>
      <button role="radio" aria-checked={projMode() === "code"} classList={{ on: projMode() === "code" }} onClick={() => setProjMode("code")} title={tx("Código: árvore de arquivos, editor, Git e terminal (⌘E alterna)")}>
        <Code2 size={13} /><span>{tx("Código")}</span>
      </button>
      <button role="radio" aria-checked={projMode() === "ai"} classList={{ on: projMode() === "ai" }} onClick={() => setProjMode("ai")} title={tx("IA: conversas, e ao lado o app rodando, comandos e subagentes (⌘E alterna)")}>
        <MessagesSquare size={13} /><span>{tx("IA")}</span>
      </button>
      <span class="view-thumb" style={{ transform: `translateX(${projMode() === "ai" ? 100 : 0}%)` }} />
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
      } else if (projMode() === "code" && ((mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "j") || (e.ctrlKey && (e.key === "`" || e.code === "Backquote")))) {
        e.preventDefault();
        setTermOpen(!termOpen());
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
  const dragTerm = (e: PointerEvent) => {
    if (termAt() === "right") {
      const w0 = termW();
      startDrag(e, "x", (d) => setTermW(Math.round(Math.max(260, Math.min(window.innerWidth - 560, w0 - d)))), () => setTermW(termW(), true));
    } else {
      const h0 = termH();
      startDrag(e, "y", (d) => setTermH(Math.round(Math.max(120, Math.min(window.innerHeight - 220, h0 - d)))), () => setTermH(termH(), true));
    }
  };

  return (
    <div
      class="workspace"
      classList={{ "ws-code": code(), "ws-ai": !code(), "debug-off": !debugOpen(), focus: !code() && focusMode() && isTauri && !p().demo, adv: wsMode() === "avancado", resizing: dragging() }}
      style={{ "--debug-w": `${debugW()}px` }}
      ref={root}
    >
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

        <ModeSwitch />

        <Show when={code()} fallback={<ChatList />}>
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
        </Show>

        <div class="mode-switch" role="radiogroup" aria-label={tx("Projetos na lateral")}>
          <button role="radio" aria-checked={wsMode() === "simples"} classList={{ active: wsMode() === "simples" }} onClick={() => setWsMode("simples")} title={tx("Um projeto por vez: troque pelo nome lá em cima")}>{tx("Simples")}</button>
          <button role="radio" aria-checked={wsMode() === "avancado"} classList={{ active: wsMode() === "avancado" }} onClick={() => setWsMode("avancado")} title={tx("Todos os projetos numa coluna ao lado: um clique troca")}>{tx("Avançado")}</button>
        </div>
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
        <section class="code-main" classList={{ right: termAt() === "right", "term-on": termOpen() }} style={{ "--term-h": `${termH()}px`, "--term-w": `${termW()}px` }}>
          <div class="code-stage">
            <Editor
              tools={
                <button class="icon-btn small" classList={{ on: termOpen() }} title={termOpen() ? tx("Fechar o terminal (⌘J)") : tx("Abrir o terminal (⌘J)")} onClick={() => setTermOpen(!termOpen())}>
                  <SquareTerminal size={14} />
                </button>
              }
            />
          </div>
          <Show when={termOpen()}>
            <div class="term-split" onPointerDown={dragTerm} onDblClick={() => (termAt() === "right" ? setTermW(460, true) : setTermH(260, true))} title={tx("Arraste para mudar o tamanho")} />
            <section class="code-term">
              <Suspense fallback={<div class="pterm-empty"><span class="spinner" /> {tx("Carregando o terminal…")}</div>}>
                <ProjectTerminal
                  tools={
                    <>
                      <button class="icon-btn small" title={termAt() === "right" ? tx("Pôr o terminal embaixo") : tx("Pôr o terminal à direita")} onClick={() => setTermAt(termAt() === "right" ? "bottom" : "right")}>
                        {termAt() === "right" ? <PanelBottom size={13} /> : <PanelRight size={13} />}
                      </button>
                      <button class="icon-btn small" title={tx("Fechar o terminal (⌘J)")} onClick={() => setTermOpen(false)}><X size={13} /></button>
                    </>
                  }
                />
              </Suspense>
            </section>
          </Show>
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
