// Modo IA, à esquerda: as conversas do projeto (as abertas e as anteriores). Um clique troca a
// conversa do meio; o resto (fora do Veocode, memória, nível de acesso) fica no rodapé.
import { Brain, Check, Eye, History, Lock, MessageSquarePlus, ShieldCheck, X } from "lucide-solid";
import { createMemo, createResource, createSignal, For, on, onCleanup, Show, createEffect } from "solid-js";
import { accountById, fmtAgo } from "../accounts";
import { isTauri } from "../api";
import { chatOf, listConversations, ofChat, type Convo } from "../chat";
import { activeKey, closeTab, concludeTab, newTab, openInTab, renameTab, selectTab, tabsOf } from "../convTabs";
import { every } from "../every";
import { setChatTab, gitTab } from "../git";
import { currentProject, showToast, ws } from "../store";
import { chatPane, showChatPane } from "./ChatPanel";
import { tx } from "../i18n";

export default function ChatList() {
  const p = currentProject;
  const pid = () => p().id;
  const real = () => isTauri && !p().demo;

  // conversas anteriores desta pasta (relê ao trocar de projeto e de tempos em tempos)
  const [hist, { refetch }] = createResource(
    () => (real() ? pid() : null),
    (id) => listConversations(id).catch(() => ({ items: [] as Convo[], current: null })),
  );
  onCleanup(every(() => real() && void refetch(), 30_000));
  // uma aba nova ganhou sessão: a lista de anteriores muda
  createEffect(on(() => tabsOf(pid()).map((t) => chatOf(t.key).session ?? t.session ?? "").join(","), () => real() && void refetch(), { defer: true }));

  const openIds = createMemo(() => new Set(tabsOf(pid()).flatMap((t) => [chatOf(t.key).session, t.session, chatOf(t.key).conv?.id]).filter(Boolean) as string[]));
  const older = () => (hist()?.items ?? []).filter((c) => !openIds().has(c.id)).slice(0, 14);
  const usable = (c: Convo) => c.account === p().accountId;
  const [opening, setOpening] = createSignal<string | null>(null);
  const openOld = async (c: Convo) => {
    if (!usable(c)) return showToast(tx("Esta conversa é da conta {label}. Troque a conta do projeto para continuar nela.", { label: accountById(c.account).label }));
    setOpening(c.id);
    await openInTab(pid(), c);
    setOpening(null);
    showChatPane("chat");
  };

  // sessões do Claude nesta pasta que não são de nenhuma aba (Terminal, editor, app do Claude)
  const extCount = createMemo(() => {
    const owned = new Set(tabsOf(pid()).map((t) => chatOf(t.key).session ?? t.session).filter(Boolean));
    return new Set(ws.events.filter((e) => e.agent !== "disco" && !e.tab && !!e.session && !owned.has(e.session)).map((e) => e.session)).size;
  });

  const [editing, setEditing] = createSignal<string | null>(null);
  const here = (v: "chat" | "ext" | "mem" | "hist") => gitTab() === "chat" && chatPane() === v;

  return (
    <div class="ai-list">
      <div class="ai-list-head">
        <span>{tx("Conversas")}</span>
        <button class="ai-new" title={tx("Nova conversa (as outras continuam)")} onClick={() => (newTab(pid()), showChatPane("chat"))}>
          <MessageSquarePlus size={13} /> {tx("Nova")}
        </button>
      </div>
      <div class="ai-list-scroll">
        <For each={tabsOf(pid())}>
          {(t) => {
            const c = () => chatOf(t.key);
            const busy = () => (p().demo ? ws.running && !ws.paused : c().busy);
            const on = () => here("chat") && t.key === activeKey(pid());
            const last = createMemo(() => {
              const evs = ws.events.filter((e) => (p().demo ? true : ofChat(t.key, e)));
              const say = [...evs].reverse().find((e) => e.kind === "say" || e.kind === "user");
              return say ? { text: say.title.replace(/\s+/g, " ").slice(0, 90), time: say.time.slice(0, 5) } : null;
            });
            const status = () => (c().perms.length ? tx("esperando você") : busy() ? tx("trabalhando…") : c().error ? tx("parou com erro") : null);
            return (
              <div
                class="ai-chat"
                role="button"
                tabindex="0"
                classList={{ on: on(), busy: busy(), ask: c().perms.length > 0, err: !!c().error }}
                onClick={() => (selectTab(pid(), t.key), showChatPane("chat"))}
                onKeyDown={(e) => e.key === "Enter" && (selectTab(pid(), t.key), showChatPane("chat"))}
                onDblClick={() => setEditing(t.key)}
                title={tx("Dois cliques para renomear")}
              >
                <i class="ai-dot" />
                <span class="ai-chat-text">
                  <Show when={editing() === t.key} fallback={<strong>{tx(t.title)}</strong>}>
                    <input
                      class="conv-rename"
                      value={t.title}
                      ref={(el) => requestAnimationFrame(() => (el.focus(), el.select()))}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") setEditing(null);
                      }}
                      onBlur={(e) => {
                        if (editing() === t.key) renameTab(pid(), t.key, e.currentTarget.value);
                        setEditing(null);
                      }}
                    />
                  </Show>
                  <small>
                    <Show when={status()} fallback={<Show when={last()} fallback={tx("vazia")}>{(l) => <>{l().text}</>}</Show>}>
                      <span class="ai-state">{status()}</span>
                    </Show>
                  </small>
                </span>
                <Show when={real()}>
                  <span class="ai-acts">
                    <button title={tx("Concluir: o resumo vai para a memória do projeto e a aba fecha")} onClick={(e) => (e.stopPropagation(), void concludeTab(pid(), t.key))}><Check size={12} /></button>
                    <button title={tx("Fechar (a conversa fica nas anteriores)")} onClick={(e) => (e.stopPropagation(), void closeTab(pid(), t.key))}><X size={12} /></button>
                  </span>
                </Show>
              </div>
            );
          }}
        </For>

        <Show when={real()}>
          <div class="ai-list-sub">
            <span>{tx("Anteriores")}</span>
            <Show when={hist.loading}><span class="spinner inline" /></Show>
          </div>
          <Show when={older().length} fallback={<Show when={!hist.loading}><p class="ai-list-empty">{tx("As conversas fechadas desta pasta aparecem aqui.")}</p></Show>}>
            <For each={older()}>
              {(c) => (
                <button class="ai-old" classList={{ locked: !usable(c) }} disabled={!!opening()} onClick={() => void openOld(c)} title={usable(c) ? tx("Continuar esta conversa") : tx("Da conta {label}: troque a conta do projeto para continuar", { label: accountById(c.account).label })}>
                  <span class="ai-old-title">{tx(c.title)}</span>
                  <small>
                    <Show when={opening() === c.id} fallback={<Show when={!usable(c)} fallback={fmtAgo(Math.max(0, (Date.now() - c.updated) / 1000))}><Lock size={10} /></Show>}>
                      <span class="spinner inline" />
                    </Show>
                  </small>
                </button>
              )}
            </For>
            <button class="ai-list-more" onClick={() => showChatPane("hist")}><History size={12} /> {tx("Ver todas")}</button>
          </Show>
        </Show>
      </div>
      <Show when={real()}>
        <div class="ai-list-foot">
          <button classList={{ on: here("ext") }} onClick={() => showChatPane(here("ext") ? "chat" : "ext")} title={tx("Claude rodando nesta pasta pelo Terminal, editor ou app do Claude. Só para acompanhar.")}>
            <Eye size={13} /> {tx("Fora do Veocode")}
            <Show when={extCount() > 0}><i class="ai-badge">{extCount() > 9 ? "9+" : extCount()}</i></Show>
          </button>
          <button classList={{ on: here("mem") }} onClick={() => showChatPane(here("mem") ? "chat" : "mem")} title={tx("O que o Claude já sabe deste projeto sem reler conversas antigas")}>
            <Brain size={13} /> {tx("Memória")}
          </button>
          <button classList={{ on: gitTab() === "access" }} onClick={() => setChatTab(gitTab() === "access" ? "chat" : "access")} title={tx("O que a IA pode fazer nesta pasta sem perguntar")}>
            <ShieldCheck size={13} /> {tx("Nível de acesso")}
          </button>
        </div>
      </Show>
    </div>
  );
}
