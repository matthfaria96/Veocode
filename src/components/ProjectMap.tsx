// A aba do mapa do projeto, no editor, em três jeitos de ver:
// - Visão geral: as áreas em cartões, na ordem de quem usa quem, com o que cada uma faz e as
//   ligações entre elas; clicar numa área mostra as peças dela e com quem ela conversa.
// - Como funciona: os fluxos (o que alguém faz no app) passo a passo, com o que acontece em cada peça.
// - Desenho: o grafo inteiro (mapEngine.ts), com busca, áreas para ligar e desligar e o cartão de
//   cada ponto.
// Por cima, o que está vivo agora (a IA mexendo, mudado no git). Sem mapa ainda: um convite, e o
// jeito de fazer (do código ou com a IA) é escolhido na janela do MapMaker.
import { ArrowLeft, ArrowRight, FileCode2, GitCompareArrows, LayoutGrid, Maximize2, Minus, Plus, RefreshCw, Route, Search, Sparkles, Waypoints, X } from "lucide-solid";
import { batch, createEffect, createMemo, createSignal, For, Match, on, onCleanup, onMount, Show, Switch } from "solid-js";
import { groupColor, mountMap, type MapCtl } from "../mapEngine";
import { areaLinks, keyNodes, linkLabel, liveFiles, liveOf, loadMap, MAP_FILE, mapIntent, mapOf, mapView, setMapIntent, setMapView, type AreaLink, type Live, type MapData, type MapNode } from "../projmap";
import { openMapMaker } from "../modals";
import { openRealFile } from "../realProject";
import { currentProject, openDiff, showToast } from "../store";
import { since } from "../git";
import { formatSize } from "../api";
import { tx, txn } from "../i18n";

const LIVE_WORD: Record<Live, string> = { now: "a IA está mexendo agora", ai: "a IA mexeu há pouco", git: "mudado, sem commit" };

export default function ProjectMap() {
  const pid = () => currentProject().id;
  const entry = () => mapOf(pid());
  createEffect(on(pid, (id) => !mapOf(id).at && void loadMap(id)));
  return (
    <div class="pmap">
      <Show
        when={entry().data}
        fallback={
          <Show when={!entry().loading && entry().at} fallback={<div class="pmap-empty"><span class="spinner" /></div>}>
            <MapInvite />
          </Show>
        }
      >
        {(d) => <MapView data={d()} />}
      </Show>
    </div>
  );
}

/** Sem mapa ainda: o que é e um botão (o jeito de fazer é escolhido na janela). */
export function MapInvite(props: { compact?: boolean }) {
  const pid = () => currentProject().id;
  const e = () => mapOf(pid());
  return (
    <div class="pmap-empty" classList={{ compact: props.compact }}>
      <div class="pmap-hero-mark"><Waypoints size={props.compact ? 20 : 26} /></div>
      <strong>{tx("Um mapa para entender este projeto")}</strong>
      <p>{tx("As áreas do projeto, o que cada parte faz e como elas se ligam, num resumo para você e para a IA. O que a IA está mexendo aparece por cima, ao vivo.")}</p>
      <div class="pmap-empty-actions">
        <button class="primary-btn" disabled={!!e().busy} onClick={() => openMapMaker(pid())}>
          <Show when={e().busy} fallback={<Waypoints size={14} />}><span class="spinner tiny" /></Show>
          {e().busy ? tx("Lendo o código…") : tx("Fazer o mapa…")}
        </button>
      </div>
      <small class="pmap-hint">{tx("Do código, grátis e em segundos, ou com a IA, explicado passo a passo.")}</small>
      <Show when={e().error}><small class="pmap-err">{e().error}</small></Show>
    </div>
  );
}

/** Abre o arquivo de uma peça (se ela tiver um). */
function openNode(n: MapNode) {
  if (!n.path) return showToast(tx("Este ponto não aponta para um arquivo."));
  if (currentProject().demo) return showToast(tx("No projeto de exemplo os arquivos do mapa não abrem."));
  openRealFile(n.path);
}

const unitOf = (d: MapData, n: number) => (d.files ? txn(n, "{n} arquivo", "{n} arquivos") : txn(n, "{n} peça", "{n} peças"));

/** O que o desenho deve mostrar ao abrir: um ponto, uma área ou um fluxo. */
type Goal = { node?: number; group?: number; flow?: number; at: number };

function MapView(props: { data: MapData }) {
  const pid = () => currentProject().id;
  const d = () => props.data;
  const live = createMemo(() => liveOf(d(), liveFiles()));
  const liveCount = (k: Live | "ai+now") => [...live().values()].filter((v) => (k === "ai+now" ? v !== "git" : v === k)).length;
  const [area, setArea] = createSignal<number | null>(null);
  const [flow, setFlow] = createSignal(0);
  const [goal, setGoal] = createSignal<Goal | null>(null);
  const [hidden, setHidden] = createSignal(new Set<number>());
  const [q, setQ] = createSignal("");
  // o arquivo mudou: fica o que ainda existe
  createEffect(
    on(
      d,
      (data) =>
        batch(() => {
          if (area() != null && area()! >= data.groups.length) setArea(null);
          if (flow() >= data.flows.length) setFlow(0);
          setGoal(null);
          setHidden(new Set<number>());
        }),
      { defer: true },
    ),
  );

  const toGraph = (g: Omit<Goal, "at">) => batch(() => (setGoal({ ...g, at: Date.now() }), setMapView("graph")));

  // pedido de fora (painel da direita, ⌘K): um jeito de ver, uma área, um fluxo ou um ponto
  createEffect(
    on(mapIntent, (it) => {
      if (!it) return;
      setMapIntent(null);
      if (it.flow != null) setFlow(Math.min(it.flow, Math.max(0, d().flows.length - 1)));
      const view = it.view ?? (it.node ? "graph" : it.flow != null ? "flows" : "overview");
      if (view === "graph") {
        const n = it.node ? d().nodes.find((x) => x.id === it.node || x.path === it.node) : undefined;
        toGraph({ node: n?.i, group: n ? undefined : it.group });
      } else {
        if (view === "overview") setArea(it.group ?? null);
        setMapView(view);
      }
    }),
  );

  const matches = createMemo(() => {
    const k = q().trim().toLowerCase();
    if (!k) return [];
    // o nome exato primeiro, depois o que começa igual, depois o resto
    const rank = (n: MapNode) => {
      const l = n.label.toLowerCase();
      return l === k ? 0 : l.startsWith(k) ? 1 : l.includes(k) ? 2 : 3;
    };
    return d()
      .nodes.filter((n) => n.label.toLowerCase().includes(k) || n.path?.toLowerCase().includes(k) || n.note?.toLowerCase().includes(k))
      .sort((a, b) => rank(a) - rank(b))
      .map((n) => n.i);
  });

  const by = () => (d().by === "veocode" ? tx("tirado do código") : tx("feito pela IA"));
  const when = () => since(Math.floor(d().at / 1000));
  const busy = () => !!mapOf(pid()).busy;
  const VIEWS = [
    { id: "overview" as const, icon: LayoutGrid, label: () => tx("Visão geral") },
    { id: "flows" as const, icon: Route, label: () => tx("Como funciona") },
    { id: "graph" as const, icon: Waypoints, label: () => tx("Desenho") },
  ];

  return (
    <>
      <header class="pmap-head">
        <div class="pmap-title" title={`${by()} · ${when()} · ${MAP_FILE} · ${formatSize(d().bytes)}`}>
          <strong>{tx("Mapa do projeto")}</strong>
          <span>{unitOf(d(), d().nodes.length)}</span>
        </div>
        <div class="pmap-views" role="tablist">
          <For each={VIEWS}>
            {(v) => (
              <button role="tab" aria-selected={mapView() === v.id} classList={{ on: mapView() === v.id }} onClick={() => setMapView(v.id)} title={v.label()}>
                <v.icon size={13} />
                <span>{v.label()}</span>
                <Show when={v.id === "flows" && d().flows.length}><small>{d().flows.length}</small></Show>
              </button>
            )}
          </For>
        </div>
        <Show when={liveCount("ai+now") || liveCount("git")}>
          <div class="pmap-live-sum">
            <Show when={liveCount("ai+now")}><span class="ai"><i />{txn(liveCount("ai+now"), "{n} com a IA", "{n} com a IA")}</span></Show>
            <Show when={liveCount("git")}><span class="git"><i />{txn(liveCount("git"), "{n} mudado", "{n} mudados")}</span></Show>
          </div>
        </Show>
        <label class="pmap-search">
          <Search size={13} />
          <input
            value={q()}
            placeholder={tx("Buscar no mapa…")}
            spellcheck={false}
            onInput={(e) => {
              setQ(e.currentTarget.value);
              if (e.currentTarget.value.trim() && mapView() !== "graph") setMapView("graph");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches().length) toGraph({ node: matches()[0] });
              if (e.key === "Escape") setQ("");
            }}
          />
          <Show when={q().trim()}><small>{matches().length}</small></Show>
        </label>
        <div class="pmap-tools">
          <button class="pmap-tool" disabled={busy()} onClick={() => openMapMaker(pid())} title={tx("Refazer o mapa…")}>
            <Show when={busy()} fallback={<RefreshCw size={14} />}><span class="spinner tiny" /></Show>
          </button>
        </div>
      </header>

      <Switch>
        <Match when={mapView() === "overview"}>
          <Overview data={d()} live={live()} area={area()} setArea={setArea} onGraph={toGraph} onFlow={(i) => batch(() => (setFlow(i), setMapView("flows")))} />
        </Match>
        <Match when={mapView() === "flows"}>
          <Flows data={d()} live={live()} flow={flow()} setFlow={setFlow} onGraph={toGraph} />
        </Match>
        <Match when={mapView() === "graph"}>
          <Graph data={d()} live={live()} goal={goal()} clearGoal={() => setGoal(null)} hidden={hidden()} setHidden={setHidden} matches={q().trim() ? matches() : null} />
        </Match>
      </Switch>
    </>
  );
}

// ---------------------------------------------------------------- visão geral

/**
 * A ordem de leitura das áreas: quem usa vem antes de quem é usado (entre duas áreas que se usam
 * nos dois sentidos, vale o mais forte); áreas soltas e "outros" no fim.
 */
function areaOrder(d: MapData, links: AreaLink[]): number[] {
  const G = d.groups.length;
  const w = new Map(links.map((l) => [`${l.a}>${l.b}`, l.n]));
  const strong = links.filter((l) => {
    const back = w.get(`${l.b}>${l.a}`) ?? 0;
    return l.n > back || (l.n === back && l.a < l.b);
  });
  const adj = Array.from({ length: G }, () => [] as number[]);
  const reach = (from: number, to: number) => {
    const seen = new Set([from]), st = [from];
    while (st.length) {
      const x = st.pop()!;
      if (x === to) return true;
      for (const y of adj[x]) if (!seen.has(y)) (seen.add(y), st.push(y));
    }
    return false;
  };
  // as ligações mais fortes entram primeiro; uma que fecharia um ciclo fica de fora
  for (const l of strong) if (!reach(l.b, l.a)) adj[l.a].push(l.b);
  const deg = new Array(G).fill(0);
  for (const a of adj) for (const b of a) deg[b]++;
  const rank = new Array(G).fill(0);
  const queue = d.groups.map((_, i) => i).filter((i) => deg[i] === 0);
  while (queue.length) {
    const x = queue.shift()!;
    for (const y of adj[x]) {
      rank[y] = Math.max(rank[y], rank[x] + 1);
      if (--deg[y] === 0) queue.push(y);
    }
  }
  const touched = new Set(links.flatMap((l) => [l.a, l.b]));
  const last = (i: number) => (d.groups[i].id === "*" ? 2 : touched.has(i) ? 0 : 1);
  return d.groups
    .map((_, i) => i)
    .filter((i) => d.groups[i].count > 0)
    .sort((a, b) => last(a) - last(b) || rank[a] - rank[b] || d.groups[b].count - d.groups[a].count);
}

function Overview(props: {
  data: MapData;
  live: Map<number, Live>;
  area: number | null;
  setArea: (g: number | null) => void;
  onGraph: (g: { node?: number; group?: number }) => void;
  onFlow: (i: number) => void;
}) {
  const pid = () => currentProject().id;
  const d = () => props.data;
  const links = createMemo(() => areaLinks(d()));
  const order = createMemo(() => areaOrder(d(), links()));
  const max = () => Math.max(1, ...links().map((l) => l.n));
  const [hover, setHover] = createSignal<number | null>(null);
  const focus = () => hover() ?? props.area;
  const near = createMemo(() => {
    const f = focus();
    if (f == null) return null;
    const s = new Set([f]);
    for (const l of links()) if (l.a === f || l.b === f) s.add(l.a === f ? l.b : l.a);
    return s;
  });
  // linhas de base: as 2 mais fortes que saem de cada área e as bem fortes; com uma área em
  // foco, todas as dela
  const shown = createMemo(() => {
    const keep = new Set<AreaLink>();
    const per = new Map<number, number>();
    for (const l of links()) {
      const c = per.get(l.a) ?? 0;
      if (c < 2 || l.n >= max() * 0.3) keep.add(l);
      per.set(l.a, c + 1);
    }
    const f = focus();
    if (f != null) for (const l of links()) if (l.a === f || l.b === f) keep.add(l);
    return [...keep];
  });

  let grid!: HTMLDivElement;
  const cards = new Map<number, HTMLElement>();
  const [paths, setPaths] = createSignal<{ key: string; d: string; head: string; lit: boolean; dim: boolean; w: number; c: string }[]>([]);
  const [box, setBox] = createSignal({ w: 0, h: 0 });
  const layout = () => {
    if (!grid) return;
    const G = grid.getBoundingClientRect();
    setBox({ w: grid.scrollWidth, h: grid.scrollHeight });
    const f = focus();
    // quantas linhas saem/chegam por cada lado de cada cartão: espalha os pontos de encaixe
    const slots = new Map<string, number>();
    const take = (k: string) => {
      const n = slots.get(k) ?? 0;
      slots.set(k, n + 1);
      return n;
    };
    const out: ReturnType<typeof paths> = [];
    const list = [...shown()].sort((a, b) => b.n - a.n);
    for (const l of list) {
      const A = cards.get(l.a)?.getBoundingClientRect(), B = cards.get(l.b)?.getBoundingClientRect();
      if (!A || !B) continue;
      const ax = A.left + A.width / 2 - G.left, ay = A.top + A.height / 2 - G.top;
      const bx = B.left + B.width / 2 - G.left, by = B.top + B.height / 2 - G.top;
      let sx: number, sy: number, ex: number, ey: number, c1x: number, c1y: number, c2x: number, c2y: number;
      const spread = (k: string, width: number) => {
        const i = take(k);
        return (((i % 5) - 2) * Math.min(18, width / 8));
      };
      if (Math.abs(ay - by) < A.height / 2) {
        // mesma linha: de lado a lado, curvando por cima
        const dir = bx > ax ? 1 : -1;
        sx = ax + (dir * A.width) / 2; sy = ay - 10 + spread(`${l.a}s${dir}`, A.height) * 0.4;
        ex = bx - (dir * B.width) / 2; ey = by - 10 + spread(`${l.b}s${-dir}`, B.height) * 0.4;
        const dx = Math.abs(ex - sx), lift = dx > A.width ? Math.min(70, dx * 0.18) : 0;
        c1x = sx + dir * Math.max(30, dx * 0.4); c1y = sy - lift;
        c2x = ex - dir * Math.max(30, dx * 0.4); c2y = ey - lift;
      } else {
        const down = by > ay ? 1 : -1;
        sx = ax + spread(`${l.a}v${down}`, A.width); sy = ay + (down * A.height) / 2;
        ex = bx + spread(`${l.b}v${-down}`, B.width); ey = by - (down * B.height) / 2;
        const dy = Math.abs(ey - sy);
        c1x = sx; c1y = sy + down * Math.max(24, dy * 0.5);
        c2x = ex; c2y = ey - down * Math.max(24, dy * 0.5);
      }
      // ponta da seta, na direção da curva
      const tx_ = ex - c2x, ty = ey - c2y, len = Math.hypot(tx_, ty) || 1, ux = tx_ / len, uy = ty / len, s = 6;
      const head = `M${ex},${ey} L${ex - ux * s * 1.4 + uy * s * 0.75},${ey - uy * s * 1.4 - ux * s * 0.75} L${ex - ux * s * 1.4 - uy * s * 0.75},${ey - uy * s * 1.4 + ux * s * 0.75} Z`;
      const lit = f != null && (l.a === f || l.b === f);
      out.push({
        key: `${l.a}>${l.b}`,
        d: `M${sx},${sy} C${c1x},${c1y} ${c2x},${c2y} ${ex},${ey}`,
        head,
        lit,
        dim: f != null && !lit,
        w: 1 + (l.n / max()) * 1.6,
        c: groupColor(d(), lit ? f! : l.a),
      });
    }
    setPaths(out);
  };
  const relayout = () => requestAnimationFrame(layout);
  createEffect(on([shown, order, focus, () => props.area], relayout));
  onMount(() => {
    const ro = new ResizeObserver(relayout);
    ro.observe(grid);
    onCleanup(() => ro.disconnect());
    relayout();
  });

  const liveIn = (g: number) => {
    let ai = 0, git = 0;
    for (const [i, k] of props.live) if (d().nodes[i].g === g) k === "git" ? git++ : ai++;
    return { ai, git };
  };
  const autoAbout = () =>
    d().by === "veocode"
      ? tx("Tirado dos imports e dos comentários do código: {u} em {a}. Clique numa área para ver o que ela tem e com quem conversa.", { u: unitOf(d(), d().nodes.length), a: txn(order().length, "{n} área", "{n} áreas") })
      : tx("{u} em {a}. Clique numa área para ver o que ela tem e com quem conversa.", { u: unitOf(d(), d().nodes.length), a: txn(order().length, "{n} área", "{n} áreas") });
  const folder = (g: number) => (d().files && d().groups[g].id !== "*" && d().groups[g].id ? `${d().groups[g].id}/` : "");

  return (
    <div class="pmap-ov" classList={{ side: props.area != null }}>
      <div class="pmap-ov-main" onClick={(e) => e.target === e.currentTarget && props.setArea(null)}>
        <div class="ov-about">
          <p classList={{ auto: !d().about }}>{d().about ?? autoAbout()}</p>
          <div class="ov-meta">
            <span>{d().by === "veocode" ? tx("Tirado do código") : tx("Feito pela IA")} · {since(Math.floor(d().at / 1000))}</span>
            <Show when={d().by === "veocode"}>
              <button class="ov-link" onClick={() => openMapMaker(pid())}><Sparkles size={12} /> {tx("Explicar com a IA…")}</button>
            </Show>
          </div>
          <Show when={d().flows.length}>
            <div class="ov-flows">
              <span>{tx("Como funciona")}</span>
              <For each={d().flows}>
                {(f, i) => (
                  <button onClick={() => props.onFlow(i())} title={txn(f.steps.length, "{n} passo", "{n} passos")}>
                    <Route size={12} /> {f.name}
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>

        <div class="ov-grid" ref={grid} onClick={(e) => e.target === e.currentTarget && props.setArea(null)}>
          <svg class="ov-lines" width={box().w} height={box().h} aria-hidden="true">
            <For each={paths()}>
              {(p) => (
                <g classList={{ lit: p.lit, dim: p.dim }} style={{ "--c": p.c }}>
                  <path d={p.d} stroke-width={p.lit ? p.w + 0.6 : p.w} />
                  <path class="head" d={p.head} />
                </g>
              )}
            </For>
          </svg>
          <For each={order()}>
            {(g) => {
              const grp = () => d().groups[g];
              const keys = createMemo(() => keyNodes(d(), g));
              const lv = () => liveIn(g);
              return (
                <button
                  class="ov-card"
                  ref={(el) => cards.set(g, el)}
                  classList={{ on: props.area === g, dim: !!near() && !near()!.has(g) }}
                  style={{ "--c": groupColor(d(), g) }}
                  onMouseEnter={() => setHover(g)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => props.setArea(props.area === g ? null : g)}
                  onDblClick={() => props.onGraph({ group: g })}
                >
                  <span class="ov-card-head">
                    <i />
                    <strong>{grp().label}</strong>
                    <small>{grp().count}</small>
                  </span>
                  <Show when={grp().note} fallback={<code class="ov-card-folder">{folder(g) || tx("arquivos de várias pastas")}</code>}>
                    <span class="ov-card-note">{grp().note}</span>
                  </Show>
                  <span class="ov-card-keys">{keys().slice(0, 3).map((n) => n.label).join(" · ")}</span>
                  <Show when={lv().ai || lv().git}>
                    <span class="ov-card-live">
                      <Show when={lv().ai}><span class="ai"><i />{txn(lv().ai, "{n} com a IA", "{n} com a IA")}</span></Show>
                      <Show when={lv().git}><span class="git"><i />{txn(lv().git, "{n} mudado", "{n} mudados")}</span></Show>
                    </span>
                  </Show>
                </button>
              );
            }}
          </For>
        </div>
      </div>

      <Show when={props.area != null && d().groups[props.area!] ? props.area : null}>
        {(g) => <AreaSide data={d()} g={g()} live={props.live} links={links()} onPick={props.setArea} onGraph={props.onGraph} onClose={() => props.setArea(null)} />}
      </Show>
    </div>
  );
}

/** O que uma área tem e com quem ela conversa (ao lado da visão geral). */
function AreaSide(props: { data: MapData; g: number; live: Map<number, Live>; links: AreaLink[]; onPick: (g: number) => void; onGraph: (g: { node?: number; group?: number }) => void; onClose: () => void }) {
  const d = () => props.data;
  const grp = () => d().groups[props.g];
  const conns = createMemo(() =>
    props.links
      .filter((l) => l.a === props.g || l.b === props.g)
      .map((l) => ({ out: l.a === props.g, other: l.a === props.g ? l.b : l.a, n: l.n, labels: l.labels }))
      .sort((a, b) => b.n - a.n),
  );
  const uses = () => new Set(conns().filter((c) => c.out).map((c) => c.other)).size;
  const usedBy = () => new Set(conns().filter((c) => !c.out).map((c) => c.other)).size;
  const keys = createMemo(() => keyNodes(d(), props.g));
  const [all, setAll] = createSignal(false);
  createEffect(on(() => props.g, () => setAll(false)));
  const shownKeys = () => (all() ? keys() : keys().slice(0, 6));
  const onKey = (e: KeyboardEvent) => e.key === "Escape" && !(e.target instanceof HTMLInputElement) && props.onClose();
  window.addEventListener("keydown", onKey);
  onCleanup(() => window.removeEventListener("keydown", onKey));
  return (
    <aside class="ov-side pop-in" style={{ "--c": groupColor(d(), props.g) }}>
      <div class="pmap-d-body">
        <div class="pmap-d-head">
          <span class="pmap-d-area"><i style={{ background: groupColor(d(), props.g) }} />{tx("Área")}</span>
          <button class="icon-btn small" title={tx("Fechar (Esc)")} onClick={props.onClose}><X size={13} /></button>
        </div>
        <strong class="pmap-name">{grp().label}</strong>
        <Show when={d().files && grp().id && grp().id !== "*"}><code class="pmap-path">{grp().id}/</code></Show>
        <Show when={grp().note}><p class="pmap-note">{grp().note}</p></Show>
        <p class="pmap-facts">{[unitOf(d(), grp().count), tx("usa {n}", { n: txn(uses(), "{n} área", "{n} áreas") }), tx("usada por {n}", { n: txn(usedBy(), "{n} área", "{n} áreas") })].join(" · ")}</p>

        <Show when={conns().length}>
          <div class="pmap-list">
            <span class="pmap-list-title">{tx("Conversa com")}</span>
            <For each={conns().slice(0, 10)}>
              {(c) => (
                <button class="ov-conn" onClick={() => props.onPick(c.other)} title={c.out ? tx("{a} usa {b}", { a: grp().label, b: d().groups[c.other].label }) : tx("{a} usa {b}", { a: d().groups[c.other].label, b: grp().label })}>
                  <span class="ov-dir">{c.out ? <ArrowRight size={12} /> : <ArrowLeft size={12} />}</span>
                  <i style={{ background: groupColor(d(), c.other) }} />
                  <span class="ov-conn-main">
                    <span>{d().groups[c.other].label}</span>
                    <small>{c.labels.length ? c.labels.join(", ") : c.out ? tx("usada por esta área") : tx("usa esta área")}</small>
                  </span>
                  <small class="ov-n">{c.n}</small>
                </button>
              )}
            </For>
          </div>
        </Show>

        <div class="pmap-list">
          <span class="pmap-list-title">{tx("Peças principais")} <small>{keys().length}</small></span>
          <For each={shownKeys()}>
            {(n) => (
              <button class="ov-piece" onClick={() => props.onGraph({ node: n.i })} title={n.path ?? n.label}>
                <span class="ov-piece-top">
                  <span>{n.label}</span>
                  <Show when={props.live.get(n.i)}>{(k) => <em class={k()} title={tx(LIVE_WORD[k()])} />}</Show>
                </span>
                <Show when={n.note}><small>{n.note}</small></Show>
              </button>
            )}
          </For>
          <Show when={!all() && keys().length > 6}>
            <button class="pmap-more" onClick={() => setAll(true)}>{tx("+{n} outros", { n: keys().length - 6 })}</button>
          </Show>
        </div>
      </div>
      <div class="pmap-d-foot">
        <button class="ghost-btn small" onClick={() => props.onGraph({ group: props.g })}><Waypoints size={13} /> {tx("Ver no desenho")}</button>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------- como funciona

function Flows(props: { data: MapData; live: Map<number, Live>; flow: number; setFlow: (i: number) => void; onGraph: (g: { node?: number; flow?: number }) => void }) {
  const pid = () => currentProject().id;
  const d = () => props.data;
  const f = () => d().flows[props.flow] ?? d().flows[0];
  const areasOf = (i: number) => [...new Set(d().flows[i].steps.map((s) => d().nodes[s.n].g))];
  return (
    <Show
      when={d().flows.length}
      fallback={
        <div class="pmap-empty">
          <div class="pmap-hero-mark"><Route size={24} /></div>
          <strong>{tx("Os fluxos vêm da IA")}</strong>
          <p>{tx("Um fluxo explica, passo a passo, o caminho de uma ação no app (entrar, mandar uma mensagem, salvar): por onde ela passa e o que acontece em cada parte. Quem escreve é a IA, lendo o código.")}</p>
          <div class="pmap-empty-actions">
            <button class="primary-btn" onClick={() => openMapMaker(pid())}><Sparkles size={14} /> {tx("Fazer o mapa com a IA…")}</button>
          </div>
        </div>
      }
    >
      <div class="pmap-fl">
        <nav class="fl-list" aria-label={tx("Fluxos")}>
          <For each={d().flows}>
            {(fl, i) => (
              <button classList={{ on: i() === props.flow }} onClick={() => props.setFlow(i())}>
                <strong>{fl.name}</strong>
                <span class="fl-list-sub">
                  <span class="fl-dots">
                    <For each={areasOf(i())}>{(g) => <i style={{ background: groupColor(d(), g) }} />}</For>
                  </span>
                  <small>{txn(fl.steps.length, "{n} passo", "{n} passos")}</small>
                </span>
              </button>
            )}
          </For>
        </nav>
        <section class="fl-body">
          <Show when={f()} keyed>
            {(fl) => (
              <div class="fl-inner pop-in">
                <header class="fl-head">
                  <div>
                    <h3>{fl.name}</h3>
                    <Show when={fl.note}><p>{fl.note}</p></Show>
                  </div>
                  <button class="ghost-btn small" onClick={() => props.onGraph({ flow: d().flows.indexOf(fl) })}><Waypoints size={13} /> {tx("Ver no desenho")}</button>
                </header>
                <ol class="fl-steps">
                  <For each={fl.steps}>
                    {(s, i) => {
                      const n = d().nodes[s.n];
                      const next = fl.steps[i() + 1];
                      const via = next ? linkLabel(d(), s.n, next.n) : undefined;
                      return (
                        <li style={{ "--c": groupColor(d(), n.g) }} classList={{ last: !next }}>
                          <span class="fl-num">{i() + 1}</span>
                          <div class="fl-card">
                            <div class="fl-node">
                              <button class="fl-name" onClick={() => props.onGraph({ node: s.n })} title={tx("Ver no desenho")}>{n.label}</button>
                              <span class="fl-area"><i />{d().groups[n.g]?.label}</span>
                              <Show when={props.live.get(s.n)}>{(k) => <em class={`fl-live ${k()}`}>{tx(LIVE_WORD[k()])}</em>}</Show>
                            </div>
                            <Show when={s.note || n.note}><p>{s.note || n.note}</p></Show>
                            <Show when={n.path}>
                              <button class="fl-file" onClick={() => openNode(n)} title={tx("Abrir arquivo")}><FileCode2 size={12} /> {n.path}</button>
                            </Show>
                          </div>
                          <Show when={via}><span class="fl-via">{via}</span></Show>
                        </li>
                      );
                    }}
                  </For>
                </ol>
              </div>
            )}
          </Show>
        </section>
      </div>
    </Show>
  );
}

// ---------------------------------------------------------------- desenho

function Graph(props: { data: MapData; live: Map<number, Live>; goal: Goal | null; clearGoal: () => void; hidden: Set<number>; setHidden: (h: Set<number>) => void; matches: number[] | null }) {
  const d = () => props.data;
  let host!: HTMLDivElement;
  let ctl: MapCtl | null = null;
  let born = 0;
  const [sel, setSel] = createSignal<MapNode | null>(null);
  const [tip, setTip] = createSignal<{ n: MapNode; x: number; y: number } | null>(null);
  const flow = () => (props.goal?.flow != null ? d().flows[props.goal.flow] : null);

  // um motor por mapa: o arquivo mudou, o desenho recomeça
  createEffect(
    on(d, (data) => {
      ctl?.stop();
      setSel(null);
      born = performance.now();
      ctl = mountMap(host, data, {
        onSelect: setSel,
        onOpen: openNode,
        onHover: (n, x, y) => setTip(n ? { n, x, y } : null),
      });
      ctl.setHidden(props.hidden);
      ctl.setLive(props.live);
    }),
  );
  createEffect(() => ctl?.setLive(props.live));
  createEffect(() => ctl?.highlight(props.matches));
  // o que veio pedido (um ponto, uma área, um fluxo): espera o desenho assentar um pouco
  createEffect(
    on(
      () => props.goal,
      (g) => {
        if (!ctl) return;
        const apply = () => {
          if (!ctl) return;
          ctl.setFlow(g?.flow != null ? (d().flows[g.flow]?.steps.map((s) => s.n) ?? null) : null);
          if (g?.node != null) ctl.select(g.node);
          else if (g?.group != null) ctl.focusGroup(g.group);
        };
        const wait = Math.max(0, 320 - (performance.now() - born));
        wait ? window.setTimeout(apply, wait) : apply();
      },
    ),
  );
  const onKey = (e: KeyboardEvent) => e.key === "Escape" && sel() && !(e.target instanceof HTMLInputElement) && ctl?.select(null);
  window.addEventListener("keydown", onKey);
  onCleanup(() => (ctl?.stop(), window.removeEventListener("keydown", onKey)));

  const toggle = (g: number, solo: boolean) => {
    const all = d().groups.map((_, i) => i);
    let h = new Set(props.hidden);
    if (solo) h = h.size === all.length - 1 && !h.has(g) ? new Set() : new Set(all.filter((i) => i !== g));
    else h.has(g) ? h.delete(g) : h.add(g);
    if (h.size === all.length) h = new Set();
    props.setHidden(h);
    ctl?.setHidden(h);
  };

  return (
    <div class="pmap-stage" ref={host}>
      <Show when={tip() && tip()!.n !== sel()}>
        <div class="pmap-tip" style={{ left: `${tip()!.x + 14}px`, top: `${tip()!.y + 16}px` }}>
          <strong>{tip()!.n.label}</strong>
          <span>{d().groups[tip()!.n.g]?.label}{tip()!.n.path && tip()!.n.path !== tip()!.n.label ? ` · ${tip()!.n.path}` : ""}</span>
          <Show when={tip()!.n.note}><span class="pmap-tip-note">{tip()!.n.note}</span></Show>
          <Show when={props.live.get(tip()!.n.i)}>{(k) => <em class={k()}>{tx(LIVE_WORD[k()])}</em>}</Show>
        </div>
      </Show>

      <Show when={flow()}>
        {(fl) => (
          <div class="pmap-flowbar pmap-float pop-in">
            <Route size={13} />
            <strong>{fl().name}</strong>
            <small>{txn(fl().steps.length, "{n} passo", "{n} passos")}</small>
            <button class="icon-btn small" title={tx("Tirar o fluxo do desenho")} onClick={() => (ctl?.setFlow(null), props.clearGoal())}><X size={12} /></button>
          </div>
        )}
      </Show>

      <div class="pmap-legend pmap-float">
        <For each={d().groups}>
          {(g, i) => (
            <button
              classList={{ off: props.hidden.has(i()) }}
              style={{ "--c": groupColor(d(), i()) }}
              title={tx("Clique para esconder ou mostrar; ⌥ clique para ver só esta área{v}", { v: g.note ? ` · ${g.note}` : "" })}
              onClick={(e) => toggle(i(), e.altKey)}
              onDblClick={() => ctl?.focusGroup(i())}
            >
              <i />
              <span>{g.label}</span>
              <small>{g.count}</small>
            </button>
          )}
        </For>
      </div>

      <div class="pmap-zoom pmap-float">
        <button title={tx("Afastar")} onClick={() => ctl?.zoomBy(1 / 1.3)}><Minus size={14} /></button>
        <button title={tx("Aproximar")} onClick={() => ctl?.zoomBy(1.3)}><Plus size={14} /></button>
        <hr />
        <button title={tx("Ver tudo")} onClick={() => ctl?.fit()}><Maximize2 size={13} /></button>
      </div>

      <Show when={sel()}>{(n) => <Detail data={d()} n={n()} live={props.live} onPick={(i) => ctl?.select(i)} onClose={() => ctl?.select(null)} onOpen={() => openNode(n())} />}</Show>
    </div>
  );
}

/** Uma lista de vizinhos no cartão: cinco de cara, o resto num clique. */
function NodeList(props: { title: string; ids: number[]; data: MapData; live: Map<number, Live>; onPick: (i: number) => void }) {
  const [all, setAll] = createSignal(false);
  createEffect(on(() => props.ids, () => setAll(false)));
  const shown = () => (all() ? props.ids : props.ids.slice(0, 5));
  const node = (i: number) => props.data.nodes[i];
  return (
    <Show when={props.ids.length}>
      <div class="pmap-list">
        <span class="pmap-list-title">{props.title} <small>{props.ids.length}</small></span>
        <For each={shown()}>
          {(i) => (
            <button class="pmap-row" onClick={() => props.onPick(i)} title={node(i).note ?? node(i).path ?? node(i).label}>
              <i style={{ background: groupColor(props.data, node(i).g) }} />
              <span>{node(i).label}</span>
              <Show when={props.live.get(i)}>{(k) => <em class={k()} />}</Show>
            </button>
          )}
        </For>
        <Show when={!all() && props.ids.length > 5}>
          <button class="pmap-more" onClick={() => setAll(true)}>{tx("+{n} outros", { n: props.ids.length - 5 })}</button>
        </Show>
      </div>
    </Show>
  );
}

function Detail(props: { data: MapData; n: MapNode; live: Map<number, Live>; onPick: (i: number) => void; onClose: () => void; onOpen: () => void }) {
  const n = () => props.n;
  const g = () => props.data.groups[n().g];
  const lv = () => props.live.get(n().i);
  const name = (i: number) => props.data.nodes[i];
  const facts = () =>
    [props.data.files ? txn(n().size, "{n} linha", "{n} linhas") : "", tx("usa {n}", { n: n().out.length }), tx("usado por {n}", { n: n().inn.length })]
      .filter(Boolean)
      .join(" · ");
  const linkLabels = () => {
    const ls = props.data.links.filter((l) => (l.a === n().i || l.b === n().i) && l.label);
    return ls.slice(0, 4).map((l) => `${l.a === n().i ? "→" : "←"} ${l.label} ${(l.a === n().i ? name(l.b) : name(l.a)).label}`);
  };
  return (
    <aside class="pmap-detail pmap-float pop-in">
      <div class="pmap-d-body">
        <div class="pmap-d-head">
          <span class="pmap-d-area"><i style={{ background: groupColor(props.data, n().g) }} />{g()?.label}</span>
          <button class="icon-btn small" title={tx("Fechar (Esc)")} onClick={props.onClose}><X size={13} /></button>
        </div>
        <strong class="pmap-name">{n().label}</strong>
        <Show when={n().path && n().path !== n().label}><code class="pmap-path">{n().path}</code></Show>
        <Show when={n().note}><p class="pmap-note">{n().note}</p></Show>
        <p class="pmap-facts">{facts()}</p>
        <Show when={lv()}>{(k) => <span class={`pmap-live ${k()}`}><i />{tx(LIVE_WORD[k()])}</span>}</Show>
        <For each={linkLabels()}>{(t) => <small class="pmap-rel">{t}</small>}</For>
        <NodeList title={tx("Usa")} ids={n().out} data={props.data} live={props.live} onPick={props.onPick} />
        <NodeList title={tx("Usado por")} ids={n().inn} data={props.data} live={props.live} onPick={props.onPick} />
      </div>
      <Show when={n().path}>
        <div class="pmap-d-foot">
          <button class="ghost-btn small" onClick={props.onOpen}><FileCode2 size={13} /> {tx("Abrir arquivo")}</button>
          <Show when={lv() === "git"}>
            <button class="ghost-btn small" onClick={() => openDiff(n().path!)}><GitCompareArrows size={13} /> {tx("Ver mudanças")}</button>
          </Show>
        </div>
      </Show>
    </aside>
  );
}
