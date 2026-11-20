// Aba Mapa do painel da direita (modo Código): uma miniatura do mapa do projeto que abre o mapa
// inteiro numa aba, as áreas com quantos arquivos cada uma tem, o que está vivo agora (a IA
// mexendo, mudado no git) e os dois jeitos de fazer o mapa: do código ou pela IA.
import { ArrowUpRight, RefreshCw, Sparkles, Waypoints } from "lucide-solid";
import { createEffect, createMemo, For, on, onCleanup, Show } from "solid-js";
import { groupColor, mountMap, type MapCtl } from "../mapEngine";
import { askAiForMap, liveFiles, liveOf, loadMap, MAP_FILE, mapOf, openMap, scanMap, type Live, type MapData } from "../projmap";
import { MapInvite } from "./ProjectMap";
import { currentProject } from "../store";
import { since } from "../git";
import { formatSize } from "../api";
import { tx, txn } from "../i18n";

export default function MapPanel() {
  const pid = () => currentProject().id;
  const entry = () => mapOf(pid());
  createEffect(on(pid, (id) => !mapOf(id).at && void loadMap(id)));
  return (
    <div class="side-scroll mpanel">
      <Show
        when={entry().data}
        fallback={
          <Show when={!entry().loading && entry().at} fallback={<div class="pmap-empty compact"><span class="spinner" /></div>}>
            <MapInvite compact />
          </Show>
        }
      >
        {(d) => <PanelBody data={d()} />}
      </Show>
    </div>
  );
}

function PanelBody(props: { data: MapData }) {
  const pid = () => currentProject().id;
  const d = () => props.data;
  let host!: HTMLButtonElement;
  let ctl: MapCtl | null = null;
  const live = createMemo(() => liveOf(d(), liveFiles()));
  createEffect(
    on(d, (data) => {
      ctl?.stop();
      ctl = mountMap(host, data, { mini: true });
      ctl.setLive(live());
    }),
  );
  createEffect(() => ctl?.setLive(live()));
  onCleanup(() => ctl?.stop());

  const biggest = () => Math.max(1, ...d().groups.map((g) => g.count));
  const now = createMemo(() => {
    const order: Record<Live, number> = { now: 0, ai: 1, git: 2 };
    return [...live().entries()].sort((a, b) => order[a[1]] - order[b[1]]).map(([i, k]) => ({ n: d().nodes[i], k }));
  });
  const word: Record<Live, string> = { now: "a IA está mexendo", ai: "a IA mexeu", git: "sem commit" };

  return (
    <>
      <button class="mpanel-preview" ref={host} onClick={() => openMap()} title={tx("Abrir o mapa inteiro numa aba")}>
        <span class="mpanel-open"><ArrowUpRight size={13} /> {tx("Abrir o mapa")}</span>
      </button>

      <div class="mpanel-meta">
        <strong>{d().files ? txn(d().nodes.length, "{n} arquivo", "{n} arquivos") : txn(d().nodes.length, "{n} peça", "{n} peças")}</strong>
        <span>{txn(d().groups.length, "{n} área", "{n} áreas")}</span>
        <span>{txn(d().links.length, "{n} ligação", "{n} ligações")}</span>
      </div>
      <small class="mpanel-sub" title={MAP_FILE}>
        {d().by === "veocode" ? tx("tirado do código") : tx("desenhado pela IA")} · {since(Math.floor(d().at / 1000))} · {formatSize(d().bytes)}
      </small>

      <div class="mpanel-actions">
        <button class="primary-btn" onClick={() => openMap()}><Waypoints size={14} /> {tx("Abrir o mapa")}</button>
        <button class="ghost-btn" disabled={!!mapOf(pid()).busy} onClick={() => void scanMap(pid())} title={tx("Ler o código de novo e redesenhar")}>
          <Show when={mapOf(pid()).busy} fallback={<RefreshCw size={13} />}><span class="spinner tiny" /></Show>
          {tx("Atualizar")}
        </button>
        <button class="ghost-btn" onClick={() => askAiForMap(pid())} title={tx("A IA do projeto reescreve o mapa com ideias (telas, serviços, dados) em vez de arquivos")}>
          <Sparkles size={13} /> {tx("Pedir à IA")}
        </button>
      </div>

      <section class="mpanel-sec">
        <h4>{tx("Agora")} <Show when={now().length}><small>{now().length}</small></Show></h4>
        <Show when={now().length} fallback={<p class="mpanel-none">{tx("Nada mudando agora: quando a IA mexer num arquivo ou algo ficar sem commit, aparece aqui e no mapa.")}</p>}>
          <div class="mpanel-live">
            <For each={now().slice(0, 8)}>
              {(x) => (
                <button onClick={() => openMap({ node: x.n.id })} title={x.n.path ?? x.n.label}>
                  <i class={x.k} />
                  <span>{x.n.label}</span>
                  <small>{tx(word[x.k])}</small>
                </button>
              )}
            </For>
            <Show when={now().length > 8}><small class="pmap-more">{tx("+{n} outros", { n: now().length - 8 })}</small></Show>
          </div>
        </Show>
      </section>

      <section class="mpanel-sec">
        <h4>{tx("Áreas")}</h4>
        <div class="mpanel-groups">
          <For each={d().groups}>
            {(g, i) => (
              <button onClick={() => openMap({ group: i() })} title={g.note ?? g.label}>
                <i style={{ background: groupColor(d(), i()) }} />
                <span>{g.label}</span>
                <span class="mpanel-bar"><b style={{ width: `${(g.count / biggest()) * 100}%`, background: groupColor(d(), i()) }} /></span>
                <small>{g.count}</small>
              </button>
            )}
          </For>
        </div>
      </section>

      <p class="mpanel-foot">
        <Waypoints size={12} />
        <span>{tx("O mapa é um arquivo só ({file}): o Veocode desenha, a IA pode reescrever com ideias em vez de arquivos.", { file: MAP_FILE })}</span>
      </p>
    </>
  );
}
