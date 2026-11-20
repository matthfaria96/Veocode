import { Activity, ArrowUpRight, FolderMinus, Maximize, FolderOpen, FolderPlus, GitBranch, GripVertical, Hand, LayoutGrid, MoreHorizontal, Plus, Sparkles, SquareArrowOutUpRight, Zap } from "lucide-solid";
import { askCloseProject } from "../components/CloseProject";
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { accountById } from "../accounts";
import { api, isTauri } from "../api";
import { homeFocus, inGrid, maximized, panes, projectState, replacePane, setHomeFocus, setMaximized, toneOrder } from "../board";
import { gridFit, spanOf, useWidth } from "../gridFit";
import { drag, dropOver, startDrag } from "../drag";
import { feedOf, watchFeeds } from "../feeds";
import { found, foundLoaded, loadFound, type Found } from "../found";
import { git, gitWords, loadSummaries, since } from "../git";
import { needs } from "../attention";
import { absPathOf, addProjectFromPicker, addProjectPath, projects, projectsReady, projectsSlow, setProjectId, setView, showToast } from "../store";
import { every } from "../every";
import { dismissable } from "../dismiss";
import ChatPane from "../components/ChatPane";
import { ProjectIcon } from "../components/icons";
import { CountUp, ProviderMark, Toggle } from "../components/ui";
import { locale, tx, txn } from "../i18n";

const greet = () => {
  const h = new Date().getHours();
  return h < 5 ? tx("Boa madrugada") : h < 12 ? tx("Bom dia") : h < 18 ? tx("Boa tarde") : tx("Boa noite");
};
const today = () => new Date().toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" });
const ago = (secs: number) => since(secs);

/** Visão geral: a tela de boas-vindas. Mostra o dia, os projetos ao vivo (arrastáveis) e o que dá para adicionar. */
export default function Board() {
  const real = () => projects.filter((p) => !p.demo);

  // os da tela leem rápido; os de fora, devagar
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
  onMount(() => void loadFound());
  const key = (e: KeyboardEvent) => {
    if (e.key === "Escape" && maximized()) return setMaximized(null);
    // F liga/desliga o foco (fora de campos de texto)
    const t = e.target as HTMLElement | null;
    if ((e.key === "f" || e.key === "F") && !e.metaKey && !e.ctrlKey && !e.altKey && !(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) && real().length) {
      e.preventDefault();
      setHomeFocus(!homeFocus());
    }
  };
  window.addEventListener("keydown", key);
  onCleanup(() => window.removeEventListener("keydown", key));

  const shown = () => (maximized() && panes().includes(maximized()!) ? [maximized()!] : panes());
  // grade que se ajusta ao número de projetos na tela (2, 3, 4, 6, 8, 9)
  let page!: HTMLDivElement;
  const width = useWidth(() => page);
  const fit = createMemo(() => gridFit(shown().length, width()));
  const shelf = createMemo(() =>
    [...real()].sort((a, b) => {
      const sa = projectState(a.id);
      const sb = projectState(b.id);
      return Number(inGrid(a.id)) - Number(inGrid(b.id)) || toneOrder[sa.tone] - toneOrder[sb.tone] || sb.at - sa.at || a.name.localeCompare(b.name);
    }),
  );

  return (
    <div class="page board home" ref={page} classList={{ focus: homeFocus() && real().length > 0 }}>
      <Show when={!homeFocus() || !real().length}>
        <Welcome />
        <NeedsStrip />
      </Show>
      <Show when={real().length} fallback={<Show when={projectsReady()} fallback={<Show when={projectsSlow()} fallback={<div class="loading-rows"><div /><div /></div>}><PermWait /></Show>}><Discover /></Show>}>
        <div class="home-bar">
          <div>
            <h2>{tx("Na tela agora")}</h2>
            <small><Hand size={12} /> {tx("Arraste pelo título para trocar de lugar · o ✕ tira da tela · arraste um projeto lá de baixo para pôr")}</small>
          </div>
          <label class="focus-switch" classList={{ on: homeFocus() }} title={homeFocus() ? tx("Sair do modo foco (volta o resumo do dia e os cartões)") : tx("Modo foco: só os projetos na tela, os outros numa faixa embaixo (F)")}>
            <Maximize size={13} />
            <span>{tx("Foco")}</span>
            <Toggle on={homeFocus()} onChange={setHomeFocus} />
          </label>
        </div>
        <Show
          when={shown().length}
          fallback={
            <div class="board-empty" classList={{ "drop-on": dropOver() === "__empty", "is-dragging": !!drag() }} data-drop-pane="__empty">
              <span class="board-empty-icon"><LayoutGrid size={22} /></span>
              <strong>{tx("Nenhum projeto na tela")}</strong>
              <span>{tx("Arraste um projeto lá de baixo para cá, ou use o")} <b>+</b> {tx("do cartão dele.")}</span>
            </div>
          }
        >
          <div
            class="board-grid"
            classList={{ "is-dragging": !!drag(), single: shown().length === 1 }}
            style={{ "grid-template-columns": `repeat(${fit().units}, minmax(0, 1fr))`, "grid-template-rows": `repeat(${fit().rows}, minmax(${fit().rows > 2 ? 260 : 220}px, 1fr))`, "--rows": fit().rows }}
          >
            <For each={shown()}>{(id, i) => <ChatPane pid={id} index={i()} span={spanOf(fit(), i())} />}</For>
          </div>
        </Show>

        <Show when={homeFocus()}>
          <Dock />
        </Show>
        <div class="home-shelf" classList={{ hidden: homeFocus() }}>
          <div class="home-bar">
            <div>
              <h2>{tx("Seus projetos")}</h2>
              <small>{txn(real().length, "{n} projeto · clique para abrir, arraste para a tela", "{n} projetos · clique para abrir, arraste para a tela")}</small>
            </div>
          </div>
          <div class="shelf-list">
            <For each={shelf()}>{(p, i) => <ShelfCard id={p.id} i={i()} />}</For>
            <AddCard />
          </div>
        </div>
      </Show>

      <Show when={drag()}>
        {(d) => (
          <Portal>
            <div class="drag-ghost" classList={{ hit: !!dropOver() }} style={{ transform: `translate(${d().x + 14}px, ${d().y + 10}px)` }}>
              <GripVertical size={13} /> {d().label}
              <small>{dropOver() ? (d().kind === "pane" ? tx("solte para trocar de lugar") : tx("solte para pôr aqui")) : tx("leve até um painel")}</small>
            </div>
          </Portal>
        )}
      </Show>
    </div>
  );

  /** Topo: saudação, números do dia e o gráfico das últimas 24 h de todos os projetos. */
  function Welcome() {
    const hours = createMemo(() => {
      const now = Date.now();
      const b = Array.from({ length: 24 }, () => 0);
      for (const p of real()) {
        for (const it of feedOf(p.id).items) {
          const h = Math.floor((now - it.ts) / 3_600_000);
          if (h >= 0 && h < 24) b[23 - h]++;
        }
      }
      return b;
    });
    const steps = () => hours().reduce((a, b) => a + b, 0);
    const working = () => real().filter((p) => projectState(p.id).tone === "work").length;
    const asking = () => real().filter((p) => ["ask", "error"].includes(projectState(p.id).tone)).length;
    const changed = () => real().reduce((t, p) => t + (git.summaries[p.id]?.changed ?? 0), 0);
    const line = () => {
      if (!real().length) return tx("Vamos começar: escolha abaixo as pastas em que você quer trabalhar com IA.");
      if (asking()) return txn(asking(), "Um projeto precisa de você.", "{n} projetos precisam de você.");
      if (working()) return tx("{v} trabalhando agora.", { v: working() === 1 ? tx("Uma IA está") : tx("{working} IAs estão", { working: working() }) });
      return steps() ? tx("Tudo em ordem. Veja abaixo como foi o dia.") : tx("Tudo calmo por aqui. Peça algo em qualquer projeto abaixo.");
    };
    const W = 520;
    const H = 86;
    const path = (close: boolean) => {
      const h = hours();
      const max = Math.max(1, ...h);
      const pts = h.map((v, i) => [(i / 23) * W, H - 6 - (v / max) * (H - 14)] as const);
      let d = `M ${pts[0][0]} ${pts[0][1]}`;
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1];
        const [x1, y1] = pts[i];
        const cx = (x0 + x1) / 2;
        d += ` C ${cx} ${y0}, ${cx} ${y1}, ${x1} ${y1}`;
      }
      return close ? `${d} L ${W} ${H} L 0 ${H} Z` : d;
    };
    const tiles = () => [
      { label: tx("Projetos"), value: real().length, icon: FolderPlus, color: "#8b7bff" },
      { label: tx("Trabalhando agora"), value: working(), icon: Zap, color: "#34d399", live: working() > 0 },
      { label: tx("Esperando você"), value: asking(), icon: Hand, color: "#fbbf24", live: asking() > 0 },
      { label: tx("Passos da IA hoje"), value: steps(), icon: Activity, color: "#38bdf8" },
      { label: tx("Arquivos mudados"), value: changed(), icon: GitBranch, color: "#f472b6" },
    ];
    return (
      <section class="home-hero">
        <span class="cx-orb a" />
        <span class="cx-orb b" />
        <div class="home-hero-top">
          <div class="home-hello">
            <small class="cx-eyebrow"><Sparkles size={12} /> {today()}</small>
            <h1>{greet()}</h1>
            <p>{line()}</p>
          </div>
          <div class="home-chart" title={tx("Passos das IAs em todos os projetos, hora a hora, nas últimas 24 h")}>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
              <defs>
                <linearGradient id="home-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.45" />
                  <stop offset="100%" stop-color="var(--accent)" stop-opacity="0" />
                </linearGradient>
                <linearGradient id="home-line" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stop-color="#38bdf8" />
                  <stop offset="100%" stop-color="#a78bfa" />
                </linearGradient>
              </defs>
              <path d={path(true)} fill="url(#home-area)" class="home-area" />
              <path d={path(false)} fill="none" stroke="url(#home-line)" stroke-width="2.2" class="home-line" vector-effect="non-scaling-stroke" />
            </svg>
            <div class="home-chart-axis"><span>{tx("24 h atrás")}</span><span>12 h</span><span>{tx("agora")}</span></div>
          </div>
        </div>
        <div class="home-tiles">
          <For each={tiles()}>
            {(t, i) => (
              <div class="home-tile" classList={{ live: !!t.live }} style={{ "--k": t.color, "--i": i() }}>
                <span class="home-tile-icon"><t.icon size={15} /></span>
                <div>
                  <strong><CountUp value={t.value} /></strong>
                  <small>{t.label}</small>
                </div>
              </div>
            )}
          </For>
        </div>
      </section>
    );
  }

  /** Sem projetos: as pastas onde você já usou o Claude, para adicionar com um clique. */
  function Discover() {
    return (
      <section class="discover">
        <div class="home-bar">
          <div>
            <h2>{tx("Comece por aqui")}</h2>
            <small>{found().length ? tx("Achamos estas pastas onde você já usou o Claude. Um clique e ela vira projeto.") : tx("Escolha uma pasta do seu computador para trabalhar com a IA.")}</small>
          </div>
          <Show when={isTauri}><button class="ghost-btn" onClick={() => void addProjectFromPicker()}><FolderPlus size={14} /> {tx("Escolher outra pasta")}</button></Show>
        </div>
        <Show when={foundLoaded()} fallback={<div class="loading-rows"><div /><div /></div>}>
          <div class="found-grid">
            <For each={found()}>{(f, i) => <FoundCard f={f} i={i()} />}</For>
            <button class="found-card pick" style={{ "--i": found().length }} onClick={() => void addProjectFromPicker()}>
              <span class="found-icon"><Plus size={20} /></span>
              <strong>{tx("Outra pasta")}</strong>
              <small>{tx("Escolher no Finder")}</small>
            </button>
          </div>
        </Show>
      </section>
    );
  }

  function FoundCard(props: { f: Found; i: number }) {
    const [busy, setBusy] = createSignal(false);
    const add = async () => {
      setBusy(true);
      await addProjectPath(props.f.path, false);
      setBusy(false);
    };
    return (
      <button class="found-card" style={{ "--i": props.i }} disabled={busy()} onClick={() => void add()} title={props.f.path}>
        <span class="found-icon"><ProjectIcon id={props.f.path} name={props.f.name} stack="" size={26} /></span>
        <strong>{props.f.name}</strong>
        <small>{txn(props.f.sessions, "{n} conversa", "{n} conversas")} · {ago(props.f.last)}</small>
        <span class="found-add">{busy() ? <span class="spinner inline" /> : <><Plus size={12} /> {tx("Adicionar")}</>}</span>
      </button>
    );
  }

  /** Um projeto na lista de baixo: arraste para um painel ou clique para abrir. */
  function ShelfCard(props: { id: string; i: number }) {
    const p = () => projects.find((x) => x.id === props.id)!;
    const a = () => accountById(p().accountId);
    const st = () => projectState(props.id);
    const g = () => git.summaries[props.id];
    const last = () => [...feedOf(props.id).items].reverse().find((x) => x.kind === "say" || x.kind === "user");
    const [flash, setFlash] = createSignal("");
    createEffect(on(() => st().tone, (t, prev) => {
      if (!prev || t === prev) return;
      const kind = prev === "work" && t === "idle" ? "done" : t === "ask" ? "ask" : t === "error" ? "err" : "";
      if (!kind) return;
      setFlash(kind);
      setTimeout(() => setFlash(""), 1800);
    }));
    const open = () => {
      setProjectId(props.id);
      setView("workspace");
    };
    return (
      <div
        class={`board-card mini shelf ${st().tone}`}
        classList={{ [`flash-${flash()}`]: !!flash(), onscreen: inGrid(props.id), lifted: drag()?.id === props.id }}
        style={{ "--c": a().color, "--i": props.i }}
        onPointerDown={(e) => startDrag(e, props.id, "project", p().name, (target) => replacePane(target, props.id))}
        onClick={open}
        title={tx("Clique para abrir · arraste para um painel da tela")}
      >
        <div class="board-card-top">
          <ProjectIcon id={p().id} name={p().name} stack={p().stack} size={22} />
          <div class="board-card-name">
            <strong>{p().name}</strong>
            <span class={`board-state ${st().tone}`}><i /><span>{st().label}</span><small>{st().at ? since(st().at / 1000) : ""}</small></span>
          </div>
          <Show when={inGrid(props.id)} fallback={<button class="board-pin" title={tx("Pôr na tela")} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => (e.stopPropagation(), replacePane(undefined, props.id))}><Plus size={13} /></button>}>
            <span class="shelf-on" title={tx("Está na tela agora")}>{tx("na tela")}</span>
          </Show>
          <CardMenu id={props.id} open={open} />
        </div>
        <div class="board-last" classList={{ none: !last() }}>
          <Show when={last()} fallback={<span>{tx("Nenhuma conversa nas últimas 24 h")}</span>}>
            {(l) => <span><b>{l().kind === "user" ? tx("Você: ") : `${a().label}: `}</b>{l().title.replace(/[#*`>_]/g, "").slice(0, 140)}</span>}
          </Show>
        </div>
        <DayStrip id={props.id} />
        <div class="board-chips">
          <span class="board-chip" title={tx("Conta: {label}", { label: a().label })}><ProviderMark id={a().id} size={13} /> {a().label}</span>
          <Show when={g()?.repo}>
            <For each={gitWords(g()).slice(0, 2)}>{(w) => <span class="board-chip" title={w.tip}>{w.text}</span>}</For>
          </Show>
        </div>
      </div>
    );
  }

  /** Menu "⋯" do cartão: abrir, pôr na tela, mostrar no Finder e fechar o projeto. */
  function CardMenu(props: { id: string; open: () => void }) {
    const [pos, setPos] = createSignal<{ left: number; top: number } | null>(null);
    let btn!: HTMLButtonElement;
    const toggle = (e: MouseEvent) => {
      e.stopPropagation();
      if (pos()) return setPos(null);
      const r = btn.getBoundingClientRect();
      const h = 190;
      setPos({ left: Math.max(12, Math.min(r.right - 220, window.innerWidth - 232)), top: r.bottom + h + 12 > window.innerHeight ? r.top - h - 6 : r.bottom + 6 });
    };
    const close = () => setPos(null);
    const act = (f: () => void) => (e: MouseEvent) => (e.stopPropagation(), close(), f());
    return (
      <>
        <button class="board-more" ref={btn} title={tx("Mais opções")} aria-haspopup="menu" aria-expanded={!!pos()} onPointerDown={(e) => e.stopPropagation()} onClick={toggle}><MoreHorizontal size={15} /></button>
        <Show when={pos()}>
          {(p) => (
            <Portal>
              <div class="menu pop-in card-menu" role="menu" ref={(el) => dismissable(el, close, () => btn)} style={{ left: `${p().left}px`, top: `${p().top}px` }} onPointerDown={(e) => e.stopPropagation()}>
                <button class="menu-item" onClick={act(props.open)}><SquareArrowOutUpRight size={15} /><span>{tx("Abrir")}</span></button>
                <Show when={!inGrid(props.id)}>
                  <button class="menu-item" onClick={act(() => replacePane(undefined, props.id))}><LayoutGrid size={15} /><span>{tx("Pôr na tela")}</span></button>
                </Show>
                <button class="menu-item" onClick={act(() => { const a = absPathOf(props.id); if (a) api.reveal(a).catch((e) => showToast(String(e))); })}><FolderOpen size={15} /><span>{tx("Mostrar no Finder")}</span></button>
                <div class="menu-sep" />
                <button class="menu-item danger" onClick={act(() => askCloseProject(props.id))}><FolderMinus size={15} /><span>{tx("Fechar projeto…")}</span></button>
              </div>
            </Portal>
          )}
        </Show>
      </>
    );
  }

  /** Último cartão da lista: adiciona uma pasta (sugestões do histórico do Claude ou o Finder). */
  /** Modo foco: os projetos fora da tela numa faixa fina (clique põe na tela, arraste escolhe o lugar). */
  function Dock() {
    const off = () => shelf().filter((p) => !inGrid(p.id));
    return (
      <div class="home-dock" role="list" aria-label={tx("Projetos fora da tela")}>
        <For each={off()}>
          {(p, i) => {
            const st = () => projectState(p.id);
            const a = () => accountById(p.accountId);
            const open = () => (setProjectId(p.id), setView("workspace"));
            return (
              <div
                class={`dock-item ${st().tone}`}
                role="listitem"
                classList={{ lifted: drag()?.id === p.id }}
                style={{ "--c": a().color, "--i": i() }}
                title={tx("{name} · {label}\nClique para pôr na tela · arraste até um painel para trocar", { name: p.name, label: st().label })}
                onPointerDown={(e) => startDrag(e, p.id, "project", p.name, (target) => replacePane(target, p.id))}
                onClick={() => replacePane(undefined, p.id)}
              >
                <ProjectIcon id={p.id} name={p.name} stack={p.stack} size={18} />
                <span class="dock-name">{p.name}</span>
                <i class="dock-dot" />
                <button class="dock-open" title={tx("Abrir o projeto")} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => (e.stopPropagation(), open())}><ArrowUpRight size={12} /></button>
              </div>
            );
          }}
        </For>
        <Show when={!off().length}>
          <span class="dock-note">{tx("Todos os projetos estão na tela")}</span>
        </Show>
        <AddCard dock />
      </div>
    );
  }

  function AddCard(props: { dock?: boolean }) {
    const [pos, setPos] = createSignal<{ left: number; top?: number; bottom?: number; max: number } | null>(null);
    let btn!: HTMLButtonElement;
    const toggle = () => {
      if (pos()) return setPos(null);
      const r = btn.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - 12;
      const above = r.top - 12;
      const left = Math.max(12, Math.min(r.left, window.innerWidth - 320));
      // abre para o lado com mais espaço; nunca sai da janela
      setPos(below >= 260 || below >= above ? { left, top: r.bottom + 6, max: Math.min(380, below) } : { left, bottom: window.innerHeight - r.top + 6, max: Math.min(380, above) });
    };
    const close = () => setPos(null);
    let menu: HTMLDivElement | undefined;
    onMount(() => {
      // rolar a tela fecha (o menu ficaria solto); rolar a lista do próprio menu, não
      const off = (e: Event) => {
        if (menu && e.target instanceof Node && menu.contains(e.target)) return;
        close();
      };
      window.addEventListener("resize", off);
      document.addEventListener("scroll", off, true);
      onCleanup(() => (window.removeEventListener("resize", off), document.removeEventListener("scroll", off, true)));
    });
    return (
      <div class="shelf-add-wrap">
        <Show
          when={props.dock}
          fallback={
            <button class="board-card mini shelf-add" classList={{ open: !!pos() }} ref={btn} onClick={toggle} style={{ "--i": shelf().length }}>
              <span class="found-icon"><Plus size={20} /></span>
              <strong>{tx("Adicionar projeto")}</strong>
              <small>{found().length ? txn(found().length, "{n} pasta sugerida", "{n} pastas sugeridas") : tx("escolher uma pasta")}</small>
            </button>
          }
        >
          <button class="dock-add" classList={{ open: !!pos() }} ref={btn} onClick={toggle} title={tx("Adicionar projeto")}>
            <Plus size={14} /> <span>{tx("Adicionar")}</span>
          </button>
        </Show>
        <Show when={pos()}>
          {(p) => (
            <Portal>
              <div
                class="menu pop-in shelf-menu"
                ref={(el) => ((menu = el), dismissable(el, close, () => btn))}
                style={{ left: `${p().left}px`, top: p().top != null ? `${p().top}px` : "auto", bottom: p().bottom != null ? `${p().bottom}px` : "auto", "max-height": `${p().max}px` }}
              >
                <small class="menu-title">{tx("Onde você já usou o Claude")}</small>
                <For each={found().slice(0, 8)} fallback={<small class="menu-title">{tx("Nenhuma sugestão por aqui")}</small>}>
                  {(f) => (
                    <button class="menu-item" onClick={() => (close(), void addProjectPath(f.path, false))} title={f.path}>
                      <ProjectIcon id={f.path} name={f.name} stack="" size={16} />
                      <span>{f.name}</span>
                      <small>{ago(f.last)}</small>
                    </button>
                  )}
                </For>
                <div class="menu-sep" />
                <button class="menu-item" onClick={() => (close(), void addProjectFromPicker())}><FolderPlus size={16} /><span>{tx("Escolher outra pasta…")}</span></button>
              </div>
            </Portal>
          )}
        </Show>
      </div>
    );
  }
}

/** No topo da Visão geral: o que espera você agora (o resto fica no sininho). */
function NeedsStrip() {
  const top = () => needs().filter((n) => n.urgency !== "lembrete").slice(0, 3);
  return (
    <Show when={top().length}>
      <div class="needs-strip">
        <strong>{tx("Precisa de você")}</strong>
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
      <div class="day-strip" title={tx("Passos da IA em cada hora das últimas 24 h (a última barra é a hora atual)")}>
        <div class="day-bars" aria-hidden="true">
          <For each={hours()}>{(n, i) => <span classList={{ now: i() === 23, zero: !n }} style={{ height: `${n ? Math.max(12, (n / max()) * 100) : 6}%` }} />}</For>
        </div>
        <small>{txn(total(), "{n} passo nas últimas 24 h · mais movimento por volta das {busiest}", "{n} passos nas últimas 24 h · mais movimento por volta das {busiest}", { busiest: busiest() })}</small>
      </div>
    </Show>
  );
}

/** O macOS segura a leitura das pastas até você responder ao aviso de permissão. */
function PermWait() {
  return (
    <div class="perm-wait pop-in">
      <span class="perm-wait-dot" />
      <div>
        <strong>{tx("Esperando a permissão do macOS")}</strong>
        <small>{tx("Depois de atualizar o Veocode, o macOS pergunta de novo se ele pode abrir a pasta dos seus projetos (ex.: Documentos). Clique em")} <b>{tx("Permitir")}</b> {tx("no aviso do sistema e os projetos aparecem aqui sozinhos.")}</small>
      </div>
    </div>
  );
}
