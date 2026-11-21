// Aba Mapa do painel da direita (modo Código): uma miniatura do mapa do projeto que abre o mapa
// inteiro numa aba, o resumo do projeto, os fluxos, o que está vivo agora (a IA mexendo, mudado
// no git) e as áreas. Refazer o mapa abre a janela que explica os dois jeitos (código ou IA).
import { ArrowUpRight, FileText, RefreshCw, Route, Waypoints } from "lucide-solid";
import { createEffect, createMemo, For, on, onCleanup, Show } from "solid-js";
import { groupColor, mountMap, type MapCtl } from "../mapEngine";
import { liveFiles, liveOf, loadMap, MAP_FILE, MAP_NOTES, mapOf, openMap, type Live, type MapData } from "../projmap";
import { openMapMaker } from "../modals";
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

      <div class="mpanel-meta" title={`${d().by === "veocode" ? tx("tirado do código") : tx("feito pela IA")} · ${MAP_FILE} · ${formatSize(d().bytes)}`}>
        <strong>{d().files ? txn(d().nodes.length, "{n} arquivo", "{n} arquivos") : txn(d().nodes.length, "{n} peça", "{n} peças")}</strong>
        <span>{txn(d().groups.filter((g) => g.count).length, "{n} área", "{n} áreas")} · {d().by === "veocode" ? tx("do código") : tx("pela IA")} · {since(Math.floor(d().at / 1000))}</span>
      </div>
      <Show when={d().about}><p class="mpanel-about">{d().about}</p></Show>

      <div class="mpanel-actions">
        <button class="primary-btn" onClick={() => openMap({ view: "overview" })}><Waypoints size={14} /> {tx("Abrir o mapa")}</button>
        <button class="pmap-tool" disabled={!!mapOf(pid()).busy} onClick={() => openMapMaker(pid())} title={tx("Refazer o mapa…")}>
          <Show when={mapOf(pid()).busy} fallback={<RefreshCw size={14} />}><span class="spinner tiny" /></Show>
        </button>
      </div>
      <p class="mpanel-ai" title={tx("O Veocode avisa a IA do projeto que este resumo existe; ela lê quando precisa achar onde algo fica, em vez de varrer o projeto inteiro.")}>
        <FileText size={12} /> {tx("A IA do projeto consulta este mapa ({file})", { file: MAP_NOTES })}
      </p>

      <Show when={d().flows.length}>
        <section class="mpanel-sec">
          <h4>{tx("Como funciona")} <small>{d().flows.length}</small></h4>
          <div class="mpanel-flows">
            <For each={d().flows}>
              {(f, i) => (
                <button onClick={() => openMap({ view: "flows", flow: i() })} title={f.note ?? f.name}>
                  <Route size={13} />
                  <span>{f.name}</span>
                  <small>{txn(f.steps.length, "{n} passo", "{n} passos")}</small>
                </button>
              )}
            </For>
          </div>
        </section>
      </Show>

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
          <For each={d().groups.map((g, i) => ({ g, i })).filter((x) => x.g.count)}>
            {({ g, i }) => (
              <button onClick={() => openMap({ view: "overview", group: i })} title={g.note ?? g.label}>
                <i style={{ background: groupColor(d(), i) }} />
                <span>{g.label}</span>
                <span class="mpanel-bar"><b style={{ width: `${(g.count / biggest()) * 100}%`, background: groupColor(d(), i) }} /></span>
                <small>{g.count}</small>
              </button>
            )}
          </For>
        </div>
      </section>

    </>
  );
}
