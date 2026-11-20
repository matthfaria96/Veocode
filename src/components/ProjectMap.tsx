// A aba do mapa do projeto, no editor: o desenho inteiro (mapEngine.ts), a busca, as áreas para
// ligar e desligar, o que está vivo agora e, ao clicar num ponto, um cartão com quem ele usa e
// quem usa ele. Sem mapa ainda: um convite para desenhar a partir do código ou pedir à IA.
import { FileCode2, GitCompareArrows, LocateFixed, Minus, Plus, RefreshCw, Search, Sparkles, Waypoints, X } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js";
import { groupColor, mountMap, type MapCtl } from "../mapEngine";
import { askAiForMap, liveFiles, liveOf, loadMap, MAP_FILE, mapIntent, mapOf, scanMap, setMapIntent, type Live, type MapData, type MapNode } from "../projmap";
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

/** Sem mapa ainda: o que é e os dois jeitos de fazer. */
export function MapInvite(props: { compact?: boolean }) {
  const pid = () => currentProject().id;
  const e = () => mapOf(pid());
  return (
    <div class="pmap-empty" classList={{ compact: props.compact }}>
      <div class="pmap-hero-mark"><Waypoints size={props.compact ? 20 : 26} /></div>
      <strong>{tx("Desenhe o mapa deste projeto")}</strong>
      <p>{tx("As áreas, os arquivos e quem usa quem, num desenho para explorar. O que a IA está mexendo e o que mudou no git aparecem por cima, ao vivo.")}</p>
      <div class="pmap-empty-actions">
        <button class="primary-btn" disabled={!!e().busy} onClick={() => void scanMap(pid())}>
          <Show when={e().busy} fallback={<Waypoints size={14} />}><span class="spinner tiny" /></Show>
          {e().busy ? tx("Lendo o código…") : tx("Desenhar a partir do código")}
        </button>
        <button class="ghost-btn" onClick={() => askAiForMap(pid())} title={tx("A IA do projeto lê o código e escreve um mapa de ideias (telas, serviços, dados) no mesmo arquivo")}>
          <Sparkles size={14} /> {tx("Pedir à IA um mapa de ideias")}
        </button>
      </div>
      <Show when={e().error}><small class="pmap-err">{e().error}</small></Show>
      <small class="pmap-file">{tx("Tudo fica num arquivo só: {file}", { file: MAP_FILE })}</small>
    </div>
  );
}

function MapView(props: { data: MapData }) {
  const pid = () => currentProject().id;
  const d = () => props.data;
  let host!: HTMLDivElement;
  let ctl: MapCtl | null = null;
  const [sel, setSel] = createSignal<MapNode | null>(null);
  const [tip, setTip] = createSignal<{ n: MapNode; x: number; y: number } | null>(null);
  const [hidden, setHidden] = createSignal(new Set<number>());
  const [q, setQ] = createSignal("");
  const live = createMemo(() => liveOf(d(), liveFiles()));
  const liveCount = (k: Live | "ai+now") => [...live().values()].filter((v) => (k === "ai+now" ? v !== "git" : v === k)).length;

  // um motor por mapa: o arquivo mudou, o desenho recomeça
  createEffect(
    on(d, (data) => {
      ctl?.stop();
      setSel(null);
      ctl = mountMap(host, data, {
        onSelect: setSel,
        onOpen: (n) => open(n),
        onHover: (n, x, y) => setTip(n ? { n, x, y } : null),
      });
      ctl.setHidden(hidden());
      ctl.setLive(live());
    }),
  );
  createEffect(() => ctl?.setLive(live()));
  const onKey = (e: KeyboardEvent) => e.key === "Escape" && sel() && !(e.target instanceof HTMLInputElement) && ctl?.select(null);
  window.addEventListener("keydown", onKey);
  onCleanup(() => (ctl?.stop(), window.removeEventListener("keydown", onKey)));

  // pedido de fora (painel da direita): focar um ponto ou uma área
  createEffect(
    on(mapIntent, (it) => {
      if (!it || !ctl) return;
      setMapIntent(null);
      if (it.group != null) ctl.focusGroup(it.group);
      else if (it.node) {
        const n = d().nodes.find((x) => x.id === it.node || x.path === it.node);
        if (n) window.setTimeout(() => ctl?.select(n.i), 250);
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
  createEffect(() => ctl?.highlight(q().trim() ? matches() : null));

  const toggle = (g: number, solo: boolean) => {
    const all = d().groups.map((_, i) => i);
    let h = new Set(hidden());
    if (solo) h = h.size === all.length - 1 && !h.has(g) ? new Set() : new Set(all.filter((i) => i !== g));
    else h.has(g) ? h.delete(g) : h.add(g);
    if (h.size === all.length) h = new Set();
    setHidden(h);
    ctl?.setHidden(h);
  };

  const open = (n: MapNode) => {
    if (!n.path) return showToast(tx("Este ponto não aponta para um arquivo."));
    if (currentProject().demo) return showToast(tx("No projeto de exemplo os arquivos do mapa não abrem."));
    openRealFile(n.path);
  };
  const by = () => (d().by === "veocode" ? tx("tirado do código") : tx("desenhado pela IA"));
  const when = () => since(Math.floor(d().at / 1000));
  const unit = () => (d().files ? txn(d().nodes.length, "{n} arquivo", "{n} arquivos") : txn(d().nodes.length, "{n} peça", "{n} peças"));

  return (
    <>
      <header class="pmap-head">
        <div class="pmap-title">
          <span class="pmap-mark"><Waypoints size={15} /></span>
          <div>
            <strong>{tx("Mapa do projeto")}</strong>
            <small title={MAP_FILE}>{by()} · {when()} · {MAP_FILE} · {formatSize(d().bytes)}</small>
          </div>
        </div>
        <div class="pmap-stats">
          <span>{unit()}</span>
          <span>{txn(d().groups.length, "{n} área", "{n} áreas")}</span>
          <span>{txn(d().links.length, "{n} ligação", "{n} ligações")}</span>
          <Show when={liveCount("ai+now")}><span class="live ai"><i />{txn(liveCount("ai+now"), "{n} com a IA", "{n} com a IA")}</span></Show>
          <Show when={liveCount("git")}><span class="live git"><i />{txn(liveCount("git"), "{n} mudado", "{n} mudados")}</span></Show>
        </div>
        <div class="pmap-actions">
          <button class="ghost-btn small" disabled={!!mapOf(pid()).busy} onClick={() => void scanMap(pid())} title={tx("Ler o código de novo e redesenhar")}>
            <Show when={mapOf(pid()).busy} fallback={<RefreshCw size={13} />}><span class="spinner tiny" /></Show>
            {tx("Atualizar")}
          </button>
          <button class="ghost-btn small" onClick={() => askAiForMap(pid())} title={tx("A IA do projeto reescreve o mapa com ideias (telas, serviços, dados) em vez de arquivos")}>
            <Sparkles size={13} /> {tx("Pedir à IA")}
          </button>
        </div>
      </header>

      <div class="pmap-bar">
        <label class="pmap-search">
          <Search size={13} />
          <input
            value={q()}
            placeholder={tx("Buscar no mapa…")}
            spellcheck={false}
            onInput={(e) => setQ(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches().length) ctl?.select(matches()[0]);
              if (e.key === "Escape") setQ("");
            }}
          />
          <Show when={q().trim()}><small>{matches().length}</small></Show>
        </label>
        <div class="pmap-legend">
          <For each={d().groups}>
            {(g, i) => (
              <button
                class="pmap-chip"
                classList={{ off: hidden().has(i()) }}
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
      </div>

      <div class="pmap-stage" ref={host}>
        <Show when={tip() && tip()!.n !== sel()}>
          <div class="pmap-tip" style={{ left: `${tip()!.x + 14}px`, top: `${tip()!.y + 16}px` }}>
            <strong>{tip()!.n.label}</strong>
            <span>{d().groups[tip()!.n.g]?.label}{tip()!.n.path && tip()!.n.path !== tip()!.n.label ? ` · ${tip()!.n.path}` : ""}</span>
            <Show when={live().get(tip()!.n.i)}>{(k) => <em class={k()}>{tx(LIVE_WORD[k()])}</em>}</Show>
          </div>
        </Show>

        <div class="pmap-zoom">
          <button title={tx("Aproximar")} onClick={() => ctl?.zoomBy(1.3)}><Plus size={14} /></button>
          <button title={tx("Afastar")} onClick={() => ctl?.zoomBy(1 / 1.3)}><Minus size={14} /></button>
          <button title={tx("Ver tudo")} onClick={() => ctl?.fit()}><LocateFixed size={14} /></button>
        </div>

        <div class="pmap-hint">
          <Show when={d().flow.length > 1}><span class="pmap-flow-key"><i />{tx("caminho principal")}</span></Show>
          <span class="pmap-live-key now"><i />{tx("a IA mexendo")}</span>
          <span class="pmap-live-key git"><i />{tx("mudado no git")}</span>
          <span class="pmap-hint-text">{tx("Clique para ver as ligações · dois cliques abrem · role para dar zoom")}</span>
        </div>

        <Show when={sel()}>{(n) => <Detail data={d()} n={n()} live={live().get(n().i)} onPick={(i) => ctl?.select(i)} onClose={() => ctl?.select(null)} onOpen={() => open(n())} />}</Show>
      </div>
    </>
  );
}

function Detail(props: { data: MapData; n: MapNode; live?: Live; onPick: (i: number) => void; onClose: () => void; onOpen: () => void }) {
  const n = () => props.n;
  const g = () => props.data.groups[n().g];
  const name = (i: number) => props.data.nodes[i];
  const List = (p: { title: string; ids: number[] }) => (
    <Show when={p.ids.length}>
      <div class="pmap-list">
        <span class="pmap-list-title">{p.title} <small>{p.ids.length}</small></span>
        <div>
          <For each={p.ids.slice(0, 10)}>
            {(i) => (
              <button onClick={() => props.onPick(i)} title={name(i).path ?? name(i).label}>
                <i style={{ background: groupColor(props.data, name(i).g) }} />
                {name(i).label}
              </button>
            )}
          </For>
          <Show when={p.ids.length > 10}><small class="pmap-more">{tx("+{n} outros", { n: p.ids.length - 10 })}</small></Show>
        </div>
      </div>
    </Show>
  );
  const linkLabel = () => {
    const ls = props.data.links.filter((l) => (l.a === n().i || l.b === n().i) && l.label);
    return ls.slice(0, 4).map((l) => `${l.a === n().i ? "→" : "←"} ${l.label} ${(l.a === n().i ? name(l.b) : name(l.a)).label}`);
  };
  return (
    <aside class="pmap-detail pop-in">
      <button class="icon-btn small pmap-x" title={tx("Fechar (Esc)")} onClick={props.onClose}><X size={13} /></button>
      <span class="pmap-eyebrow" style={{ color: groupColor(props.data, n().g) }}><i style={{ background: groupColor(props.data, n().g) }} />{g()?.label}</span>
      <strong class="pmap-name">{n().label}</strong>
      <Show when={n().path}><code class="pmap-path">{n().path}</code></Show>
      <div class="pmap-facts">
        <Show when={props.data.files}><span>{txn(n().size, "{n} linha", "{n} linhas")}</span></Show>
        <span>{tx("usa {n}", { n: n().out.length })}</span>
        <span>{tx("usado por {n}", { n: n().inn.length })}</span>
      </div>
      <Show when={props.live}>{(k) => <span class={`pmap-live ${k()}`}><i />{tx(LIVE_WORD[k()])}</span>}</Show>
      <Show when={n().note}><p class="pmap-note">{n().note}</p></Show>
      <For each={linkLabel()}>{(t) => <small class="pmap-rel">{t}</small>}</For>
      <List title={tx("Usa")} ids={n().out} />
      <List title={tx("Usado por")} ids={n().inn} />
      <div class="pmap-detail-actions">
        <Show when={n().path}>
          <button class="primary-btn small" onClick={props.onOpen}><FileCode2 size={13} /> {tx("Abrir arquivo")}</button>
        </Show>
        <Show when={props.live === "git" && n().path}>
          <button class="ghost-btn small" onClick={() => openDiff(n().path!)}><GitCompareArrows size={13} /> {tx("Ver mudanças")}</button>
        </Show>
      </div>
    </aside>
  );
}

