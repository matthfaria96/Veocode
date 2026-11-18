import { Columns2, FolderPlus, LayoutGrid, MonitorPlay, Plus, SquareTerminal } from "lucide-solid";
import { createEffect, createMemo, For, on, onCleanup, Show } from "solid-js";
import { accountById } from "../accounts";
import { isTauri, prettyPath } from "../api";
import { boardMode, inGrid, layout, layouts, MAX_PANES, maximized, panes, projectState, replacePane, setBoardMode, setLayout, setMaximized, slots, toggleGrid, toneOrder, type Layout } from "../board";
import { feedOf, watchFeeds } from "../feeds";
import { git, loadSummaries, since } from "../git";
import { accessLevels } from "../data/mock";
import { addProjectFromPicker, projects, setProjectId, setView, showToast } from "../store";
import { terms } from "../terminal";
import ChatPane from "../components/ChatPane";
import { ProjectIcon } from "../components/icons";
import { PageHeader, ProviderMark } from "../components/ui";

/** Visão geral: todos os projetos de uma vez (Panorama) e até 4 conversas ao vivo, divididas como a pessoa quiser. */
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
        title="Visão geral"
        subtitle={
          !real().length
            ? "Todos os seus projetos num lugar só, com o que cada IA está fazendo."
            : `${real().length} ${real().length === 1 ? "projeto" : "projetos"}${working() ? ` · ${working()} trabalhando` : ""}${asking() ? ` · ${asking()} esperando você` : ""}`
        }
        actions={
          <div class="board-actions">
            <div class="seg board-seg">
              <button classList={{ active: boardMode() === "all" }} onClick={() => setBoardMode("all")} title="Um cartão por projeto, com a situação de cada um"><LayoutGrid size={13} /> Panorama</button>
              <button classList={{ active: boardMode() === "grid" }} onClick={() => setBoardMode("grid")} title="As conversas rolando ao mesmo tempo, na divisão que você escolher"><MonitorPlay size={13} /> Ao vivo <small class="count">{panes().length}</small></button>
              <span class="seg-thumb" style={{ transform: `translateX(${boardMode() === "all" ? 0 : 100}%)` }} />
            </div>
            <Show when={isTauri}>
              <button class="ghost-btn" onClick={() => void addProjectFromPicker()}><FolderPlus size={14} /> Adicionar projeto</button>
            </Show>
          </div>
        }
      />
      <Show when={real().length && boardMode() === "all"}>
        <p class="board-hint">Clique num cartão para abrir o projeto. O botão <Columns2 size={11} /> põe o projeto em <strong>Ao vivo</strong>, para acompanhar junto com outros.</p>
      </Show>
      <Show when={real().length && boardMode() === "grid"}>
        <LayoutBar />
      </Show>
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
      if (!toggleGrid(props.id)) return showToast(`Ao vivo já tem ${MAX_PANES} projetos: tire um para pôr este`);
      if (inGrid(props.id)) showToast(`${p().name} está em Ao vivo (${panes().length} de ${MAX_PANES})`);
    };
    return (
      <div class={`board-card ${st().tone}`} style={{ "--c": a().color }} onClick={open} title="Abrir o projeto">
        <div class="board-card-top">
          <ProjectIcon id={p().id} name={p().name} stack={p().stack} size={26} />
          <div class="board-card-name">
            <strong>{p().name}</strong>
            <small title={p().path}>{prettyPath(p().path)}</small>
          </div>
          <button class="board-pin" classList={{ on: inGrid(props.id) }} onClick={grid} title={inGrid(props.id) ? "Tirar do Ao vivo" : "Acompanhar em Ao vivo junto com outros (até 4)"}>
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
    // cada lugar da divisão escolhida mostra um projeto; lugar vazio mostra a lista para escolher
    const shown = () => (maximized() && panes().includes(maximized()!) ? [maximized()!] : panes().slice(0, slots()));
    const empty = () => (maximized() ? 0 : Math.max(0, Math.min(slots() - shown().length, real().length - panes().length)));
    return (
      <Show
        when={panes().length}
        fallback={
          <div class="board-grid-empty">
            <Columns2 size={26} />
            <strong>Escolha até {MAX_PANES} projetos para acompanhar ao mesmo tempo</strong>
            <p>Cada um ocupa um pedaço da tela com a conversa rolando ao vivo, e dá para pedir, permitir e parar em qualquer um. Escolha a divisão logo acima e clique nos projetos abaixo.</p>
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
        <div class={`board-grid lay-${maximized() ? "1" : layout()}`}>
          <For each={shown()}>{(id, i) => <ChatPane pid={id} index={i()} />}</For>
          <For each={Array.from({ length: empty() })}>{() => <AddPane />}</For>
        </div>
      </Show>
    );
  }

  function LayoutBar() {
    // projetos escolhidos que não cabem na divisão atual: um clique traz para o último lugar
    const off = () => panes().slice(slots());
    return (
      <div class="layout-bar">
        <span class="layout-label">Dividir a tela em</span>
        <div class="layout-picks" role="radiogroup">
          <For each={layouts}>
            {(l) => (
              <button role="radio" aria-checked={layout() === l.id} classList={{ active: layout() === l.id }} title={l.label} onClick={() => { setMaximized(null); setLayout(l.id); }}>
                <LayoutIcon id={l.id} />
              </button>
            )}
          </For>
        </div>
        <Show when={off().length}>
          <span class="layout-off">
            Fora da tela:
            <For each={off()}>
              {(id) => {
                const p = () => projects.find((x) => x.id === id);
                return (
                  <button class="ghost-btn small" title="Trazer para a tela (troca com o último)" onClick={() => replacePane(panes()[slots() - 1], id)}>
                    <Show when={p()}>{(pp) => <ProjectIcon id={pp().id} name={pp().name} stack={pp().stack} size={13} />}</Show> {p()?.name}
                  </button>
                );
              }}
            </For>
          </span>
        </Show>
        <span class="layout-tip">Dica: o botão de tela cheia em cada conversa põe ela em destaque (Esc volta).</span>
      </div>
    );
  }

  function AddPane() {
    const rest = () => real().filter((p) => !inGrid(p.id));
    return (
      <div class="pane pane-add">
        <Plus size={18} />
        <strong>Escolha um projeto para este espaço</strong>
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

/** Desenho pequeno de cada divisão da tela. */
function LayoutIcon(props: { id: Layout }) {
  const r = (x: number, y: number, w: number, h: number) => <rect x={x} y={y} width={w} height={h} rx="1.5" />;
  return (
    <svg width="26" height="18" viewBox="0 0 26 18" class="layout-icon" aria-hidden="true">
      {props.id === "1" && r(1, 1, 24, 16)}
      {props.id === "2c" && [r(1, 1, 11.5, 16), r(13.5, 1, 11.5, 16)]}
      {props.id === "2r" && [r(1, 1, 24, 7.5), r(1, 9.5, 24, 7.5)]}
      {props.id === "3" && [r(1, 1, 13, 16), r(15, 1, 10, 7.5), r(15, 9.5, 10, 7.5)]}
      {props.id === "4" && [r(1, 1, 11.5, 7.5), r(13.5, 1, 11.5, 7.5), r(1, 9.5, 11.5, 7.5), r(13.5, 9.5, 11.5, 7.5)]}
    </svg>
  );
}
