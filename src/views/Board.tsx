import { Columns2, FolderPlus, LayoutGrid, Plus, SquareTerminal } from "lucide-solid";
import { createEffect, createMemo, For, on, onCleanup, Show } from "solid-js";
import { accountById } from "../accounts";
import { isTauri, prettyPath } from "../api";
import { boardMode, inGrid, MAX_PANES, maximized, panes, projectState, setBoardMode, setMaximized, toggleGrid, toneOrder } from "../board";
import { feedOf, watchFeeds } from "../feeds";
import { git, loadSummaries, since } from "../git";
import { accessLevels } from "../data/mock";
import { addProjectFromPicker, projects, setProjectId, setView, showToast } from "../store";
import { terms } from "../terminal";
import ChatPane from "../components/ChatPane";
import { ProjectIcon } from "../components/icons";
import { PageHeader, ProviderMark } from "../components/ui";

/** Todos os projetos de uma vez, e até 4 conversas lado a lado. */
export default function Board() {
  const real = () => projects.filter((p) => !p.demo);

  // a lista lê todos os projetos devagar; a grade lê os seus rápido
  createEffect(on(() => real().map((p) => p.id).join(","), (ids) => {
    const stop = watchFeeds("board-all", ids ? ids.split(",") : [], 2500);
    onCleanup(stop);
  }));
  createEffect(on(() => panes().join(","), (ids) => {
    const stop = watchFeeds("board-grid", ids ? ids.split(",") : [], 900);
    onCleanup(stop);
  }));
  void loadSummaries(true);
  const t = window.setInterval(() => void loadSummaries(), 15000);
  onCleanup(() => clearInterval(t));
  // quem pede atenção aparece primeiro; esc sai da tela cheia
  const key = (e: KeyboardEvent) => e.key === "Escape" && maximized() && setMaximized(null);
  window.addEventListener("keydown", key);
  onCleanup(() => window.removeEventListener("keydown", key));

  const asking = () => real().filter((p) => projectState(p.id).tone === "ask").length;
  const working = () => real().filter((p) => projectState(p.id).tone === "work").length;

  return (
    <div class="page board">
      <PageHeader
        title="Painel"
        subtitle={
          !real().length
            ? "Todos os seus projetos num lugar só, com o que cada IA está fazendo."
            : `${real().length} ${real().length === 1 ? "projeto" : "projetos"}${working() ? ` · ${working()} trabalhando` : ""}${asking() ? ` · ${asking()} esperando você` : ""}`
        }
        actions={
          <div class="seg board-seg">
            <button classList={{ active: boardMode() === "all" }} onClick={() => setBoardMode("all")}><LayoutGrid size={13} /> Todos</button>
            <button classList={{ active: boardMode() === "grid" }} onClick={() => setBoardMode("grid")}><Columns2 size={13} /> Lado a lado <small class="count">{panes().length}</small></button>
            <span class="seg-thumb" style={{ transform: `translateX(${boardMode() === "all" ? 0 : 100}%)` }} />
          </div>
        }
      />
      <Show when={real().length} fallback={<Empty />}>
        <Show when={boardMode() === "all"} fallback={<Grid />}>
          <All />
        </Show>
      </Show>
    </div>
  );

  function All() {
    const sorted = createMemo(() =>
      [...real()].sort((a, b) => {
        const sa = projectState(a.id);
        const sb = projectState(b.id);
        return toneOrder[sa.tone] - toneOrder[sb.tone] || sb.at - sa.at || a.name.localeCompare(b.name);
      }),
    );
    return (
      <div class="board-cards">
        <For each={sorted()}>{(p) => <Card id={p.id} />}</For>
      </div>
    );
  }

  function Card(props: { id: string }) {
    const p = () => projects.find((x) => x.id === props.id)!;
    const a = () => accountById(p().accountId);
    const st = () => projectState(props.id);
    const g = () => git.summaries[props.id];
    const last = () => [...feedOf(props.id).items].reverse().find((x) => x.kind === "say" || x.kind === "user");
    const nTerms = () => (terms.byProject[props.id] ?? []).filter((t) => t.alive).length;
    const lv = () => accessLevels[p().access];
    const open = () => {
      setProjectId(props.id);
      setView("workspace");
    };
    const grid = (e: MouseEvent) => {
      e.stopPropagation();
      if (!toggleGrid(props.id)) return showToast(`A grade já tem ${MAX_PANES} projetos: tire um para pôr este`);
      if (inGrid(props.id)) showToast(`${p().name} está lado a lado (${panes().length} de ${MAX_PANES})`);
    };
    return (
      <div class={`board-card ${st().tone}`} style={{ "--c": a().color }} onClick={open} title="Abrir o projeto">
        <div class="board-card-top">
          <ProjectIcon id={p().id} name={p().name} stack={p().stack} size={26} />
          <div class="board-card-name">
            <strong>{p().name}</strong>
            <small title={p().path}>{prettyPath(p().path)}</small>
          </div>
          <button class="board-pin" classList={{ on: inGrid(props.id) }} onClick={grid} title={inGrid(props.id) ? "Tirar do lado a lado" : "Pôr lado a lado com outros (até 4)"}>
            <Columns2 size={13} />
          </button>
        </div>
        <div class={`board-state ${st().tone}`}>
          <i />
          <span>{st().label}</span>
          <small>{st().at ? since(st().at / 1000) : ""}</small>
        </div>
        <div class="board-last" classList={{ none: !last() }}>
          <Show when={last()} fallback={<span>Nenhuma conversa nas últimas 24 h</span>}>
            {(l) => <span><b>{l().kind === "user" ? "Você: " : `${a().label}: `}</b>{l().title.replace(/[#*`>_]/g, "").slice(0, 160)}</span>}
          </Show>
        </div>
        <div class="board-chips">
          <span class="board-chip" title={`Conta: ${a().label}`}><ProviderMark id={a().id} size={14} /> {a().label}</span>
          <span class="board-chip" style={{ color: lv().color }} title="Nível de acesso">{lv().short}</span>
          <Show when={g()?.repo}>
            <span class="board-chip" title="Git: branch, para enviar / para baixar / arquivos mudados">
              {g()!.branch ?? "git"}
              <Show when={g()!.ahead}><b class="warn">↑{g()!.ahead}</b></Show>
              <Show when={g()!.behind}><b class="info">↓{g()!.behind}</b></Show>
              <Show when={g()!.changed}><b>●{g()!.changed}</b></Show>
            </span>
          </Show>
          <Show when={st().agents}><span class="board-chip" title="Agentes de IA rodando nesta pasta (Veocode, Terminal, editor…)">{st().agents} {st().agents === 1 ? "agente aberto" : "agentes abertos"}</span></Show>
          <Show when={nTerms()}><span class="board-chip"><SquareTerminal size={11} /> {nTerms()}</span></Show>
        </div>
      </div>
    );
  }

  function Grid() {
    const shown = () => (maximized() && panes().includes(maximized()!) ? [maximized()!] : panes());
    const canAdd = () => !maximized() && panes().length < MAX_PANES && real().length > panes().length;
    return (
      <Show
        when={panes().length}
        fallback={
          <div class="board-grid-empty">
            <Columns2 size={26} />
            <strong>Escolha até {MAX_PANES} projetos para acompanhar ao mesmo tempo</strong>
            <p>Cada um fica num canto da tela com a conversa rolando ao vivo, e dá para pedir, permitir e parar em qualquer um. Clique nos projetos abaixo ou no botão <Columns2 size={11} /> dos cartões em Todos.</p>
            <div class="board-quick">
              <For each={real().slice(0, 8)}>
                {(p) => (
                  <button class="ghost-btn" onClick={() => toggleGrid(p.id)}>
                    <ProjectIcon id={p.id} name={p.name} stack={p.stack} size={16} /> {p.name}
                  </button>
                )}
              </For>
            </div>
          </div>
        }
      >
        <div class={`board-grid n${shown().length + (canAdd() ? 1 : 0)}`} classList={{ "with-add": canAdd() }}>
          <For each={shown()}>{(id, i) => <ChatPane pid={id} index={i()} />}</For>
          <Show when={canAdd()}>
            <AddPane />
          </Show>
        </div>
      </Show>
    );
  }

  function AddPane() {
    const rest = () => real().filter((p) => !inGrid(p.id));
    return (
      <div class="pane pane-add">
        <Plus size={18} />
        <strong>Mais um projeto aqui</strong>
        <div class="board-quick">
          <For each={rest()}>
            {(p) => (
              <button class="ghost-btn small" onClick={() => toggleGrid(p.id)}>
                <ProjectIcon id={p.id} name={p.name} stack={p.stack} size={14} /> {p.name}
              </button>
            )}
          </For>
        </div>
      </div>
    );
  }
}

function Empty() {
  return (
    <div class="board-grid-empty">
      <FolderPlus size={26} />
      <strong>Nenhum projeto ainda</strong>
      <p>{isTauri ? "Adicione uma pasta: ela aparece aqui com o que a IA está fazendo, e dá para acompanhar até 4 ao mesmo tempo." : "No navegador não há projetos de verdade: abra pelo app."}</p>
      <Show when={isTauri}><button class="primary-btn small" onClick={() => void addProjectFromPicker()}><FolderPlus size={13} /> Adicionar projeto</button></Show>
    </div>
  );
}
