import { FolderPlus, PanelRightOpen, Pin } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js";
import { accountById } from "../accounts";
import { isTauri } from "../api";
import { inGrid, layout, layouts, maximized, panes, projectState, replacePane, setLayout, setMaximized, toneOrder, type Layout } from "../board";
import { feedOf, watchFeeds } from "../feeds";
import { git, gitWords, loadSummaries, since } from "../git";
import { needs } from "../attention";
import { addProjectFromPicker, projects, setProjectId, setView } from "../store";
import ChatPane from "../components/ChatPane";
import { ProjectIcon } from "../components/icons";
import { PageHeader, ProviderMark } from "../components/ui";
import { every } from "../every";

/** Visão geral: as conversas dos projetos rolando ao vivo, escolhidas sozinhas (quem precisa de você primeiro). */
export default function Board() {
  const real = () => projects.filter((p) => !p.demo);

  // a tela lê os seus rápido; os de fora, devagar
  createEffect(on(() => real().map((p) => p.id).join(","), (ids) => {
    const stop = watchFeeds("board-all", ids ? ids.split(",") : [], 2500);
    onCleanup(stop);
  }));
  createEffect(on(() => panes().join(","), (ids) => {
    const stop = watchFeeds("board-grid", ids ? ids.split(",") : [], 900);
    onCleanup(stop);
  }));
  void loadSummaries(true);
  onCleanup(every(() => void loadSummaries(), 15000));
  const key = (e: KeyboardEvent) => e.key === "Escape" && maximized() && setMaximized(null);
  window.addEventListener("keydown", key);
  onCleanup(() => window.removeEventListener("keydown", key));

  const asking = () => real().filter((p) => projectState(p.id).tone === "ask").length;
  const working = () => real().filter((p) => projectState(p.id).tone === "work").length;
  const others = createMemo(() =>
    real()
      .filter((p) => !inGrid(p.id))
      .sort((a, b) => {
        const sa = projectState(a.id);
        const sb = projectState(b.id);
        return toneOrder[sa.tone] - toneOrder[sb.tone] || sb.at - sa.at || a.name.localeCompare(b.name);
      }),
  );
  const shown = () => (maximized() && panes().includes(maximized()!) ? [maximized()!] : panes());

  return (
    <div class="page board">
      <PageHeader
        title="Visão geral"
        subtitle={
          !real().length
            ? "Seus projetos aparecem aqui sozinhos, com a conversa de cada IA rolando ao vivo."
            : `${real().length} ${real().length === 1 ? "projeto" : "projetos"}${working() ? ` · ${working()} trabalhando` : ""}${asking() ? ` · ${asking()} esperando você` : ""}`
        }
        actions={
          <div class="board-actions">
            <Show when={real().length > 1}>
              <div class="layout-picks" role="radiogroup" aria-label="Quantos projetos na tela">
                <For each={layouts}>
                  {(l) => (
                    <button
                      role="radio"
                      aria-checked={layout() === l.id}
                      classList={{ active: layout() === l.id }}
                      disabled={l.slots > real().length}
                      title={l.slots > real().length ? `${l.label} (precisa de ${l.slots} projetos)` : l.label}
                      onClick={() => { setMaximized(null); setLayout(l.id); }}
                    >
                      <LayoutIcon id={l.id} />
                    </button>
                  )}
                </For>
              </div>
            </Show>
            <Show when={isTauri}>
              <button class="ghost-btn" onClick={() => void addProjectFromPicker()}><FolderPlus size={14} /> Adicionar projeto</button>
            </Show>
          </div>
        }
      />
      <NeedsStrip />
      <Show when={real().length} fallback={<Empty />}>
        <Show when={others().length}>
          <p class="board-hint">
            Os projetos entram sozinhos: quem precisa de você e quem está trabalhando vem primeiro. O <Pin size={11} /> fixa um projeto no lugar.
          </p>
        </Show>
        <div class={`board-grid lay-${maximized() ? "1" : layout()}`}>
          <For each={shown()}>{(id, i) => <ChatPane pid={id} index={i()} />}</For>
        </div>
        <Show when={others().length && !maximized()}>
          <div class="board-rail">
            <div class="board-rail-head">
              <strong>Fora da tela</strong>
              <small>{others().length} {others().length === 1 ? "projeto" : "projetos"} · clique para trazer</small>
            </div>
            <div class="board-rail-list">
              <For each={others()}>{(p, i) => <Mini id={p.id} i={i()} />}</For>
            </div>
          </div>
        </Show>
      </Show>
    </div>
  );

  /** Um projeto fora da tela: situação, última fala e o dia, num cartão pequeno. */
  function Mini(props: { id: string; i: number }) {
    const p = () => projects.find((x) => x.id === props.id)!;
    const a = () => accountById(p().accountId);
    const st = () => projectState(props.id);
    const g = () => git.summaries[props.id];
    const last = () => [...feedOf(props.id).items].reverse().find((x) => x.kind === "say" || x.kind === "user");
    // vida só quando algo muda: brilho verde ao terminar, amarelo ao começar a esperar você
    const [flash, setFlash] = createSignal("");
    createEffect(on(() => st().tone, (t, prev) => {
      if (!prev || t === prev) return;
      const kind = prev === "work" && t === "idle" ? "done" : t === "ask" ? "ask" : t === "error" ? "err" : "";
      if (!kind) return;
      setFlash(kind);
      setTimeout(() => setFlash(""), 1800);
    }));
    const open = (e: MouseEvent) => {
      e.stopPropagation();
      setProjectId(props.id);
      setView("workspace");
    };
    return (
      <div
        class={`board-card mini ${st().tone}`}
        classList={{ [`flash-${flash()}`]: !!flash() }}
        style={{ "--c": a().color, "--i": props.i }}
        onClick={() => replacePane(undefined, props.id)}
        title="Trazer para a tela (fica fixado)"
      >
        <div class="board-card-top">
          <ProjectIcon id={p().id} name={p().name} stack={p().stack} size={22} />
          <div class="board-card-name">
            <strong>{p().name}</strong>
            <span class={`board-state ${st().tone}`}><i /><span>{st().label}</span><small>{st().at ? since(st().at / 1000) : ""}</small></span>
          </div>
          <button class="board-pin" onClick={open} title="Abrir o projeto completo"><PanelRightOpen size={13} /></button>
        </div>
        <div class="board-last" classList={{ none: !last() }}>
          <Show when={last()} fallback={<span>Nenhuma conversa nas últimas 24 h</span>}>
            {(l) => <span><b>{l().kind === "user" ? "Você: " : `${a().label}: `}</b>{l().title.replace(/[#*`>_]/g, "").slice(0, 140)}</span>}
          </Show>
        </div>
        <DayStrip id={props.id} />
        <div class="board-chips">
          <span class="board-chip" title={`Conta: ${a().label}`}><ProviderMark id={a().id} size={13} /> {a().label}</span>
          <Show when={g()?.repo}>
            <For each={gitWords(g()).slice(0, 2)}>{(w) => <span class="board-chip" title={w.tip}>{w.text}</span>}</For>
          </Show>
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
      <p>{isTauri ? "Quando você adicionar uma pasta na tela Projetos, ela aparece aqui sozinha, com a conversa da IA rolando ao vivo. Até 4 ao mesmo tempo." : "No navegador não há projetos de verdade: abra pelo app."}</p>
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

/** No topo da Visão geral: o que espera você agora (o resto fica no sininho). */
function NeedsStrip() {
  const top = () => needs().filter((n) => n.urgency !== "lembrete").slice(0, 3);
  return (
    <Show when={top().length}>
      <div class="needs-strip">
        <strong>Precisa de você</strong>
        <For each={top()}>
          {(n) => (
            <button class={`needs-chip ${n.urgency}`} onClick={() => n.go()} title={n.detail}>
              <i /> {n.title} <span>{n.action} →</span>
            </button>
          )}
        </For>
      </div>
    </Show>
  );
}

/** O dia do projeto: quantos passos a IA deu em cada hora das últimas 24 h. */
function DayStrip(props: { id: string }) {
  const hours = () => {
    const now = Date.now();
    const b = Array.from({ length: 24 }, () => 0);
    for (const it of feedOf(props.id).items) {
      const ago = Math.floor((now - it.ts) / 3_600_000);
      if (ago >= 0 && ago < 24) b[23 - ago]++;
    }
    return b;
  };
  const total = () => hours().reduce((a, x) => a + x, 0);
  const max = () => Math.max(1, ...hours());
  const busiest = () => {
    const h = hours();
    const i = h.indexOf(Math.max(...h));
    const d = new Date(Date.now() - (23 - i) * 3_600_000);
    return `${d.getHours()}h`;
  };
  return (
    <Show when={total() > 0}>
      <div class="day-strip" title="Passos da IA em cada hora das últimas 24 h (a última barra é a hora atual)">
        <div class="day-bars" aria-hidden="true">
          <For each={hours()}>{(n, i) => <span classList={{ now: i() === 23, zero: !n }} style={{ height: `${n ? Math.max(12, (n / max()) * 100) : 6}%` }} />}</For>
        </div>
        <small>{total()} {total() === 1 ? "passo" : "passos"} nas últimas 24 h · mais movimento por volta das {busiest()}</small>
      </div>
    </Show>
  );
}
