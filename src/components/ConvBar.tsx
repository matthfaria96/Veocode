// Barra de conversas do projeto (abas), medidor de contexto, aviso de conversa pesada e
// memória do projeto.
import { Activity, Brain, Check, Eye, Gauge, History, PanelBottom, Plus, Sparkles, X } from "lucide-solid";
import { createSignal, For, Show, type Component, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { bottomOpen, setBottomOpen } from "../layoutMode";
import { chatOf } from "../chat";
import { activeKey, CACHE_TTL, closeTab, concludeTab, continueFresh, fmtTokens, newTab, renameTab, selectTab, tabsOf, weightOf } from "../convTabs";
import { ws } from "../store";
import type { View } from "./ChatPanel";

// relógio de minuto em minuto (para saber se o cache da conversa já esfriou)
const [now, setNow] = createSignal(Date.now());
let clock: number | undefined;
const useClock = () => {
  if (!clock) clock = window.setInterval(() => setNow(Date.now()), 60_000);
};

const ago = (ms: number) => {
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} dia(s)`;
};

/** Botão só de ícone; o nome e uma linha de explicação aparecem ao passar o mouse. */
function Tool(props: { icon: Component<{ size?: number }>; name: string; hint: string; on?: boolean; onClick: () => void; children?: JSX.Element }) {
  return (
    <button class="ctool" classList={{ on: props.on }} aria-label={props.name} aria-pressed={!!props.on} onClick={props.onClick}>
      <Dynamic component={props.icon} size={15} />
      {props.children}
      <span class="ctip" role="tooltip"><b>{props.name}</b><small>{props.hint}</small></span>
    </button>
  );
}

export function ConvTabsBar(props: { pid: string; view: View; onView: (v: View) => void; extCount: number }) {
  const [editing, setEditing] = createSignal<string | null>(null);
  const k = () => activeKey(props.pid);
  const ctx = () => chatOf(k()).context;
  return (
    <div class="conv-bar">
      <div class="conv-tabs" role="tablist">
        <For each={tabsOf(props.pid)}>
          {(t) => {
            const c = () => chatOf(t.key);
            const on = () => props.view === "chat" && t.key === k();
            return (
              <div
                class="conv-tab"
                role="tab"
                aria-selected={on()}
                classList={{ on: on(), busy: c().busy, ask: c().perms.length > 0, err: !!c().error }}
                title={`${t.title}${c().busy ? " · trabalhando" : c().perms.length ? " · esperando você" : ""}\nDois cliques para renomear`}
                onClick={() => {
                  if (props.view !== "chat") props.onView("chat");
                  selectTab(props.pid, t.key);
                }}
                onDblClick={() => setEditing(t.key)}
              >
                <i class="conv-dot" />
                <Show when={editing() === t.key} fallback={<span class="conv-title">{t.title}</span>}>
                  <input
                    class="conv-rename"
                    value={t.title}
                    ref={(el) => requestAnimationFrame(() => (el.focus(), el.select()))}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setEditing(null);
                    }}
                    onBlur={(e) => {
                      if (editing() === t.key) renameTab(props.pid, t.key, e.currentTarget.value);
                      setEditing(null);
                    }}
                  />
                </Show>
                <button class="conv-act" title="Concluir: o resumo vai para a memória do projeto e a aba fecha" onClick={(e) => (e.stopPropagation(), void concludeTab(props.pid, t.key))}>
                  <Check size={11} />
                </button>
                <button class="conv-act" title="Fechar a aba (a conversa fica no histórico)" onClick={(e) => (e.stopPropagation(), void closeTab(props.pid, t.key))}>
                  <X size={11} />
                </button>
              </div>
            );
          }}
        </For>
        <button class="conv-new" title="Nova conversa (as outras continuam)" onClick={() => (props.view !== "chat" && props.onView("chat"), newTab(props.pid))}>
          <Plus size={14} />
        </button>
      </div>
      <Show when={ctx()}>
        <span class={`conv-ctx ${weightOf(ctx())}`} title={`Esta conversa carrega ${fmtTokens(ctx()!)} tokens. Cada mensagem manda tudo de novo para o Claude (com desconto de cache enquanto você está ativo). Conversas acima de ~150 mil gastam bem mais: conclua e comece outra.`}>
          <Gauge size={12} /> {fmtTokens(ctx()!)}
        </span>
      </Show>
      <div class="conv-tools">
        <Tool icon={Eye} name="Fora do Veocode" hint="Claude rodando nesta pasta pelo Terminal, editor ou app do Claude. Só para acompanhar." on={props.view === "ext"} onClick={() => props.onView("ext")}>
          <Show when={props.extCount > 0}><i class="ctool-badge">{props.extCount > 9 ? "9+" : props.extCount}</i></Show>
        </Tool>
        <i class="conv-sep" />
        <div class="ctool-pair" classList={{ on: props.view === "act" || bottomOpen() }}>
          <Tool icon={Activity} name="Atividade" hint="Atividade, comandos do agente e terminal numa aba, no lugar da conversa" on={props.view === "act"} onClick={() => props.onView("act")}>
            <Show when={ws.running}><i class="ctool-live" /></Show>
          </Tool>
          <Tool icon={PanelBottom} name={bottomOpen() ? "Esconder o painel de baixo" : "Painel embaixo"} hint="Mostra a atividade embaixo da conversa, para ver as duas juntas" on={bottomOpen()} onClick={() => setBottomOpen(!bottomOpen())} />
        </div>
        <i class="conv-sep" />
        <Tool icon={History} name="Histórico" hint="Conversas anteriores deste projeto" on={props.view === "hist"} onClick={() => props.onView("hist")} />
        <Tool icon={Brain} name="Memória" hint="O que o Claude já sabe deste projeto sem reler conversas antigas" on={props.view === "mem"} onClick={() => props.onView("mem")} />
      </div>
    </div>
  );
}

/** Aviso em cima da caixa: conversa pesada ou parada há muito tempo (a próxima mensagem sai cara). */
export function EconomyHint(props: { pid: string }) {
  useClock();
  const [hidden, setHidden] = createSignal<Record<string, boolean>>({});
  const k = () => activeKey(props.pid);
  const c = () => chatOf(k());
  const idle = () => (c().lastAt ? now() - c().lastAt! : 0);
  const kind = () => {
    const n = c().context ?? 0;
    if (c().busy || hidden()[k()] || n < 20_000) return null;
    if (idle() > CACHE_TTL) return "cold";
    if (weightOf(n) === "pesada") return "heavy";
    return null;
  };
  return (
    <Show when={kind()}>
      <div class="eco-hint pop-in" classList={{ cold: kind() === "cold" }}>
        <Sparkles size={14} />
        <span>
          <Show when={kind() === "cold"} fallback={<>Conversa pesada: cada mensagem manda <b>{fmtTokens(c().context!)}</b> tokens de novo.</>}>
            Parada há {ago(idle())}: a próxima mensagem relê <b>{fmtTokens(c().context!)}</b> tokens sem o desconto do cache.
          </Show>
        </span>
        <button class="primary-btn small" title="Abre outra aba com um resumo desta já na caixa" onClick={() => continueFresh(props.pid, k())}>Nova com resumo</button>
        <button class="ghost-btn small" title="Guarda o resumo na memória do projeto e fecha a aba" onClick={() => void concludeTab(props.pid, k())}>Concluir</button>
        <button class="icon-btn small" title="Continuar nesta mesmo" onClick={() => setHidden({ ...hidden(), [k()]: true })}><X size={12} /></button>
      </div>
    </Show>
  );
}
