import { Crosshair, PanelBottom, PanelTop, Pause, Play, X } from "lucide-solid";
import { lazy, Suspense } from "solid-js";
// o xterm só carrega quando a aba Terminal aparece
const ProjectTerminal = lazy(() => import("./ProjectTerminal"));
import { terms } from "../terminal";
import { follow, setFollow } from "../agentFeed";
import { createEffect, createSignal, For, Match, on, Show, Switch } from "solid-js";
import { currentProject, setWs, ws } from "../store";
import { panelAt, setPanelAt } from "../layoutMode";
import ActivityIcon, { kindColor } from "./ActivityIcon";
import { tx } from "../i18n";

// a aba escolhida continua a mesma ao mudar o painel de lugar (embaixo ↔ aba fixa)
const [tab, setTab] = createSignal<"activity" | "agent" | "terminal">("activity");

export default function BottomPanel(props: { asTab?: boolean }) {
  // altura arrastando a borda de cima (fica guardada neste computador)
  const saved = (() => {
    try {
      return Number(localStorage.getItem("veocode.panelH")) || 0;
    } catch {
      return 0;
    }
  })();
  const [height, setHeight] = createSignal(saved || 240);
  const drag = (e: PointerEvent) => {
    e.preventDefault();
    const start = e.clientY;
    const h0 = height();
    const move = (m: PointerEvent) => setHeight(Math.round(Math.min(window.innerHeight * 0.72, Math.max(150, h0 + start - m.clientY))));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("resizing-v");
      try {
        localStorage.setItem("veocode.panelH", String(height()));
      } catch {
        /* sem armazenamento */
      }
    };
    document.body.classList.add("resizing-v");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  let activityEl!: HTMLDivElement;
  let termEl!: HTMLDivElement;

  createEffect(on(() => ws.events.length, () => requestAnimationFrame(() => activityEl && activityEl.scrollTo({ top: activityEl.scrollHeight, behavior: "smooth" }))));
  createEffect(on(() => ws.terminal.length, () => requestAnimationFrame(() => termEl && termEl.scrollTo({ top: termEl.scrollHeight, behavior: "smooth" }))));
  // quando o agente roda um comando, mostra o terminal sozinho
  createEffect(on(() => ws.terminal.length, (n) => n > 1 && (currentProject().demo || ws.running) && tab() !== "terminal" && setTab("agent"), { defer: true }));
  createEffect(on(() => ws.events.length, (n) => n <= 1 && setTab("activity"), { defer: true }));

  return (
    <section class="bottom-panel" classList={{ "as-tab": props.asTab }} style={props.asTab ? undefined : { height: `${height()}px` }}>
      <Show when={!props.asTab}>
        <div class="panel-resize" onPointerDown={drag} onDblClick={() => setHeight(height() > 300 ? 240 : Math.round(window.innerHeight * 0.5))} title={tx("Arraste para mudar a altura (dois cliques: alto/baixo)")} />
      </Show>
      <div class="panel-tabs">
        <button classList={{ active: tab() === "activity" }} onClick={() => setTab("activity")}>
          {tx("Atividade")} <span class="count">{ws.events.length}</span>
        </button>
        <button classList={{ active: tab() === "agent" }} onClick={() => setTab("agent")} data-target="terminal">
          {tx("Comandos do agente")}
        </button>
        <button classList={{ active: tab() === "terminal" }} onClick={() => setTab("terminal")} title={tx("Terminal seu, aberto na pasta deste projeto")}>
          Terminal <Show when={(terms.byProject[currentProject().id] ?? []).length}><span class="count">{(terms.byProject[currentProject().id] ?? []).length}</span></Show>
        </button>
        <div class="panel-spacer" />
        <Show
          when={currentProject().demo}
          fallback={
            <>
              <button class="demo-btn" classList={{ on: follow() }} onClick={() => setFollow(!follow())} title={tx("Abrir a árvore e o arquivo que o agente está mexendo")}>
                <Crosshair size={12} /> {follow() ? tx("Seguindo o agente") : tx("Seguir o agente")}
              </button>
              <span class="watching"><span class="work-dot live" /> {tx("observando a pasta")}</span>
            </>
          }
        >
          <button class="demo-btn" onClick={() => setWs("paused", !ws.paused)} title={tx("Pausar a demonstração do agente")}>
            {ws.paused ? <Play size={12} /> : <Pause size={12} />}
            {ws.paused ? tx("Continuar demo") : tx("Pausar demo")}
          </button>
        </Show>
        <span class="panel-moves">
          <button class="icon-btn small" title={panelAt() === "tab" ? tx("Mover para baixo da conversa") : tx("Abrir como aba fixa, no lugar da conversa")} onClick={() => setPanelAt(panelAt() === "tab" ? "bottom" : "tab")}>
            {panelAt() === "tab" ? <PanelBottom size={13} /> : <PanelTop size={13} />}
          </button>
          <button class="icon-btn small" title={tx("Fechar")} onClick={() => setPanelAt("none")}><X size={13} /></button>
        </span>
      </div>
      <Switch>
        <Match when={tab() === "activity"}>
          <ActivityTimeline ref={(el) => (activityEl = el)} />
        </Match>
        <Match when={tab() === "terminal"}>
          <Suspense fallback={<div class="pterm-empty"><span class="spinner" /> {tx("Carregando o terminal…")}</div>}>
            <ProjectTerminal />
          </Suspense>
        </Match>
        <Match when={tab() === "agent"}>
          <div class="terminal" ref={termEl}>
            <Show when={!currentProject().demo}>
              <div class="term-line dim">{tx("Comandos que o agente roda aparecem aqui, com o fim da saída. Para digitar os seus, use a aba Terminal.")}</div>
            </Show>
            <For each={ws.terminal}>{(l) => <div class={`term-line ${l.tone ?? ""}`}>{l.text}</div>}</For>
            <div class="term-line"><span class="caret" /></div>
          </div>
        </Match>
      </Switch>
    </section>
  );
}

/** A linha do tempo da Atividade: cada passo do agente (e mudanças no disco), com hora e quem fez. */
export function ActivityTimeline(props: { ref?: (el: HTMLDivElement) => void }) {
  return (
    <div class="timeline" ref={(el) => props.ref?.(el)}>
      <Show when={ws.events.length === 0 && !currentProject().demo}>
        <div class="tl-empty">{tx("Nada ainda. Quando um agente trabalhar nesta pasta (pelo chat, pelo Terminal ou pelo editor), cada passo aparece aqui. Mudanças feitas por você ou por outro programa também.")}</div>
      </Show>
      <For each={ws.events}>
        {(e) => (
          <div class="tl-row slide-in" classList={{ running: e.status === "running", error: e.status === "error" }}>
            <span class="tl-time">{e.time}</span>
            <span class="tl-node" style={{ "--k": kindColor[e.kind] }}>
              <ActivityIcon kind={e.kind} size={11} />
            </span>
            <span class="tl-agent" style={e.color ? { color: e.color } : undefined}>{tx(e.agent)}</span>
            <span class="tl-title">{e.title}</span>
            <span class="tl-detail">{e.status === "running" ? "…" : e.detail}</span>
          </div>
        )}
      </For>
    </div>
  );
}
