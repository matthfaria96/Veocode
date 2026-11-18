import { ChevronDown, FolderPlus, FolderSearch, GitBranch, RefreshCw, X } from "lucide-solid";
import { ProjectIcon } from "../components/icons";
import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import { accessLevels } from "../data/mock";
import { accountById } from "../accounts";
import { forgetProject } from "../terminal";
import { forgetGit, git, loadSummaries, setGitTab } from "../git";
import { forgetFeed } from "../feeds";
import { absPathOf, addProjectFromPicker, currentProject, projectId, projects, removeProject, resetWorkspace, setProjectId, setWs, showToast } from "../store";
import { startAgentSim } from "../sim/agentSim";
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

  const reveal = () => {
    const abs = absPathOf(p().id);
    if (abs) api.reveal(abs).catch((e) => showToast(String(e)));
  };

  return (
    <div class="workspace" ref={root}>
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
            <div class="menu pop-in">
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
            </div>
          </Show>
        </div>

        <div class="sidebar-meta">
          <button class="meta-git" title="Git e GitHub deste projeto" onClick={() => setGitTab("git")}>
            <GitBranch size={12} /> {git.summaries[p().id]?.branch ?? p().branch}
            <Show when={git.summaries[p().id]?.ahead}><span class="meta-n warn">↑{git.summaries[p().id]!.ahead}</span></Show>
            <Show when={git.summaries[p().id]?.behind}><span class="meta-n info">↓{git.summaries[p().id]!.behind}</span></Show>
            <Show when={git.summaries[p().id]?.changed}><span class="meta-n edit" title="Arquivos mudados desde o último commit">●{git.summaries[p().id]!.changed}</span></Show>
          </button>
          <span class="meta-dot" style={{ background: accountById(p().accountId).color }} />
          <span>{accountById(p().accountId).label}</span>
        </div>

        <div class="sidebar-title">
          <span title={p().path}>Arquivos{p().demo ? " (fictícios)" : ""}</span>
          <Show when={!p().demo}>
            <span class="sidebar-tools">
              <button class="icon-btn small" title="Recarregar" onClick={() => loadDir("")}><RefreshCw size={12} /></button>
              <button class="icon-btn small" title="Mostrar no Finder/Explorer" onClick={reveal}><FolderSearch size={12} /></button>
              <button class="icon-btn small" title="Remover da lista (não apaga a pasta)" onClick={() => { const id = p().id; removeProject(id).then(() => (forgetProject(id), forgetGit(id), forgetFeed(id))); }}><X size={12} /></button>
            </span>
          </Show>
        </div>

        <Show when={p().demo} fallback={<Show when={p().exists} fallback={<div class="tree-loading">A pasta {p().path} não existe mais.</div>}><RealFileTree /></Show>}>
          <FileTree />
        </Show>

        <div class="legend">
          <span class="lg read">L lido</span>
          <span class="lg search">B busca</span>
          <span class="lg edit">M modificado</span>
          <span class="lg new">N novo</span>
          <Show when={!p().demo}><span class="lg deleted">A apagado</span></Show>
        </div>
      </aside>

      <section class="center">
        <Editor />
        <BottomPanel />
      </section>

      <ChatPanel />
      <AgentCursors />
    </div>
  );
}
