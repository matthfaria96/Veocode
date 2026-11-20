// Barra de conversas do projeto (abas), medidor de contexto, aviso de conversa pesada e
// memória do projeto.
import { Activity, Brain, Check, Eye, GitBranch, History, LayoutGrid, PanelBottom, PanelRight, Plus, Sparkles, X } from "lucide-solid";
import { createSignal, For, Show, type Component, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { bottomOpen, debugOpen, focusMode, setBottomOpen, setDebugOpen, setFocusMode } from "../layoutMode";
import { chatOf } from "../chat";
import { activeKey, CACHE_TTL, closeTab, concludeTab, continueFresh, fmtTokens, forkConversation, newTab, renameTab, selectTab, tabsOf, weightOf } from "../convTabs";
import { customName, forkParentOf } from "../forks";
import { histFind } from "../convHist";
import { ProjectIcon } from "./icons";
import { projects, ws } from "../store";
import { accountById } from "../accounts";
import { isOpen, openMemory } from "../modals";
import type { View } from "./ChatPanel";
import { tx, txn } from "../i18n";

// relógio de minuto em minuto (para saber se o cache da conversa já esfriou)
const [now, setNow] = createSignal(Date.now());
let clock: number | undefined;
const useClock = () => {
  if (!clock) clock = window.setInterval(() => setNow(Date.now()), 60_000);
};

const ago = (ms: number) => {
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : txn(Math.round(m / 1440), "{n} dia", "{n} dias");
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

export function ConvTabsBar(props: { pid: string; view: View; onView: (v: View) => void; extCount: number; slim?: boolean }) {
  const [editing, setEditing] = createSignal<string | null>(null);
  const k = () => activeKey(props.pid);
  const claude = () => accountById(projects.find((p) => p.id === props.pid)?.accountId ?? "").provider === "claude";
  const cur = () => tabsOf(props.pid).find((t) => t.key === k());
  const proj = () => projects.find((p) => p.id === props.pid);
  const session = () => chatOf(k()).session;
  const title = () => (session() && customName(session())) || cur()?.title || "Conversa";
  // ramo: de qual conversa saiu (nome dela)
  const parent = () => {
    const ps = chatOf(k()).fork?.parent ?? forkParentOf(session()) ?? forkParentOf(k());
    return ps ? customName(ps) ?? histFind(props.pid, ps)?.title ?? tx("outra conversa") : null;
  };
  const canFork = () => claude() && !!session() && !chatOf(k()).busy;
  const fork = () => {
    const s = session();
    if (s) void forkConversation(props.pid, { session: s, account: proj()?.accountId ?? "", title: title() });
  };
  return (
    <div class="conv-bar" classList={{ slim: props.slim }}>
      <Show when={props.slim}>
        <div class="conv-now">
          <Show
            when={props.view === "chat"}
            fallback={<strong>{props.view === "ext" ? tx("Fora do Veocode") : props.view === "hist" ? tx("Conversas anteriores") : tx("Atividade")}</strong>}
          >
            <Show when={proj()}>
              {(pr) => (
                <span class="conv-crumb" title={pr().path}>
                  <ProjectIcon id={pr().id} name={pr().name} stack={pr().stack} size={14} />
                  <span>{pr().name}</span>
                  <i>/</i>
                </span>
              )}
            </Show>
            <i class="conv-dot" classList={{ busy: chatOf(k()).busy, ask: chatOf(k()).perms.length > 0, err: !!chatOf(k()).error }} />
            <Show when={editing() === k()} fallback={<strong title={tx("Dois cliques para renomear")} onDblClick={() => setEditing(k())}>{tx(title())}</strong>}>
              <input
                class="conv-rename"
                value={title()}
                ref={(el) => requestAnimationFrame(() => (el.focus(), el.select()))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") setEditing(null);
                }}
                onBlur={(e) => {
                  if (editing() === k()) renameTab(props.pid, k(), e.currentTarget.value);
                  setEditing(null);
                }}
              />
            </Show>
            <Show when={parent()}>{(pn) => <small class="conv-branch" title={tx("Ramo de “{v}”: começou com as mensagens dela; o que acontece aqui não muda a original.", { v: pn() })}><GitBranch size={11} /> {tx("ramo de {v}", { v: pn().length > 28 ? `${pn().slice(0, 27)}…` : pn() })}</small>}</Show>
            <small>{chatOf(k()).busy ? tx("trabalhando") : chatOf(k()).perms.length ? tx("esperando você") : ""}</small>
          </Show>
        </div>
      </Show>
      <div class="conv-tabs" role="tablist" classList={{ hidden: props.slim }}>
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
                title={tx("{title}{v}\nDois cliques para renomear", { title: t.title, v: c().busy ? tx(" · trabalhando") : c().perms.length ? tx(" · esperando você") : "" })}
                onClick={() => {
                  if (props.view !== "chat") props.onView("chat");
                  selectTab(props.pid, t.key);
                }}
                onDblClick={() => setEditing(t.key)}
              >
                <i class="conv-dot" />
                <Show when={editing() === t.key} fallback={<span class="conv-title">{tx(t.title)}</span>}>
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
                <button class="conv-act" title={tx("Concluir: o resumo vai para a memória do projeto e a aba fecha")} onClick={(e) => (e.stopPropagation(), void concludeTab(props.pid, t.key))}>
                  <Check size={11} />
                </button>
                <button class="conv-act" title={tx("Fechar a aba (a conversa fica no histórico)")} onClick={(e) => (e.stopPropagation(), void closeTab(props.pid, t.key))}>
                  <X size={11} />
                </button>
              </div>
            );
          }}
        </For>
        <button class="conv-new" title={tx("Nova conversa (as outras continuam)")} onClick={() => (props.view !== "chat" && props.onView("chat"), newTab(props.pid))}>
          <Plus size={14} />
        </button>
      </div>
      <div class="conv-tools">
        <Tool
          icon={LayoutGrid}
          name={focusMode() ? tx("Sair do modo foco") : tx("Modo foco")}
          hint={tx("Todas as conversas deste projeto lado a lado, cada uma com a sua caixa. Abra mais com o +.")}
          on={focusMode()}
          onClick={() => {
            if (props.view !== "chat") props.onView("chat");
            setFocusMode(!focusMode());
          }}
        >
          <Show when={focusMode() && tabsOf(props.pid).length > 1}><i class="ctool-badge">{tabsOf(props.pid).length}</i></Show>
        </Tool>
        <Show when={props.slim && canFork()}>
          <Tool icon={GitBranch} name={tx("Bifurcar")} hint={tx("Uma conversa nova que começa com tudo desta. Para tentar outro caminho sem perder este.")} onClick={fork} />
        </Show>
        <Show when={props.slim}>
          <Tool icon={Brain} name={tx("Memória do projeto")} hint={tx("O que o Claude já sabe deste projeto sem reler conversas antigas")} on={isOpen("memory", props.pid)} onClick={() => openMemory(props.pid)} />
          <i class="conv-sep" />
          <Tool icon={PanelRight} name={debugOpen() ? tx("Esconder o painel da direita") : tx("Mostrar o painel da direita")} hint={tx("Navegador, comandos rodando, subagentes e atividade, ao lado da conversa")} on={debugOpen()} onClick={() => setDebugOpen(!debugOpen())} />
        </Show>
        <Show when={!props.slim}>
        <i class="conv-sep" />
        <Tool icon={Eye} name={tx("Fora do Veocode")} hint={tx("Claude rodando nesta pasta pelo Terminal, editor ou app do Claude. Só para acompanhar.")} on={props.view === "ext"} onClick={() => props.onView("ext")}>
          <Show when={props.extCount > 0}><i class="ctool-badge">{props.extCount > 9 ? "9+" : props.extCount}</i></Show>
        </Tool>
        <i class="conv-sep" />
        <div class="ctool-pair" classList={{ on: props.view === "act" || bottomOpen() }}>
          <Tool icon={Activity} name={tx("Atividade")} hint={tx("Atividade, comandos do agente e terminal numa aba, no lugar da conversa")} on={props.view === "act"} onClick={() => props.onView("act")}>
            <Show when={ws.running}><i class="ctool-live" /></Show>
          </Tool>
          <Tool icon={PanelBottom} name={bottomOpen() ? tx("Esconder o painel de baixo") : tx("Painel embaixo")} hint={tx("Mostra a atividade embaixo da conversa, para ver as duas juntas")} on={bottomOpen()} onClick={() => setBottomOpen(!bottomOpen())} />
        </div>
        <i class="conv-sep" />
        <Tool icon={History} name={tx("Histórico")} hint={tx("Conversas anteriores deste projeto")} on={props.view === "hist"} onClick={() => props.onView("hist")} />
        <Tool icon={Brain} name={tx("Memória")} hint={tx("O que o Claude já sabe deste projeto sem reler conversas antigas")} on={isOpen("memory", props.pid)} onClick={() => openMemory(props.pid)} />
        </Show>
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
          <Show when={kind() === "cold"} fallback={<>{tx("Conversa pesada: cada mensagem manda")} <b>{fmtTokens(c().context!)}</b> {tx("tokens de novo.")}</>}>
            {tx("Parada há {ago}: a próxima mensagem relê", { ago: ago(idle()) })} <b>{fmtTokens(c().context!)}</b> {tx("tokens sem o desconto do cache.")}
          </Show>
        </span>
        <button class="primary-btn small" title={tx("Abre outra aba com um resumo desta já na caixa")} onClick={() => continueFresh(props.pid, k())}>{tx("Nova com resumo")}</button>
        <button class="ghost-btn small" title={tx("Guarda o resumo na memória do projeto e fecha a aba")} onClick={() => void concludeTab(props.pid, k())}>{tx("Concluir")}</button>
        <button class="icon-btn small" title={tx("Continuar nesta mesmo")} onClick={() => setHidden({ ...hidden(), [k()]: true })}><X size={12} /></button>
      </div>
    </Show>
  );
}
