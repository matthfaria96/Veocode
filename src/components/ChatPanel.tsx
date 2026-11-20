import { AlertTriangle, Eye, ArrowLeft, Ban, Check, ChevronDown, FileCode2, History, Maximize2, MessageSquarePlus, Pencil, Paperclip, Plus, SendHorizontal, Shrink, ShieldCheck, Square, TerminalSquare, X } from "lucide-solid";
import { createEffect, createMemo, createResource, createSignal, For, Match, on, Show, Switch } from "solid-js";
import { accessLevels } from "../data/mock";
import { accountById } from "../accounts";
import { currentProject, isDiffTab, showToast, ws, type ActivityEvent } from "../store";
import { seenAgent } from "../agentFeed";
import { acc, loadAccess, openClaude } from "../access";
import { answerPermission, chatOf, clearError, deleteConvos, listConversations, ofChat, resendEdited, sendChat, setAttach, setInput, stopChat, type Convo } from "../chat";
import { activeKey, closeTab, nameFromPrompt, newTab, openInTab, selectTab, syncRunning, tabsOf, wakeActive, wakeTab, type ConvTab } from "../convTabs";
import { ConvTabsBar, EconomyHint } from "./ConvBar";
import { MemoryPanel } from "./Memory";
import { isTauri } from "../api";
import AccessLevel from "./AccessLevel";
import ConvoRow from "./ConvoRow";
import { gitTab, setChatTab } from "../git";
import { focusMode, panelAt, setFocusMode, setPanelAt } from "../layoutMode";
import BottomPanel from "./BottomPanel";
import { MicButton } from "./Mic";
import { stepsSummary } from "../steps";
import { LimitHitCard, requestSwitch, UsageRing } from "./Limits";
import { limitHit } from "../limits";
import { listeningTo, voiceKey } from "../voice";
import { attsOf, dropPid, pasteFiles, pickFiles } from "../attachments";
import AttachBar from "./AttachBar";
import { MediaStrip, SentThumbs } from "./Media";
import ActivityIcon, { kindColor } from "./ActivityIcon";
import { AgentChipButton, AgentMenu } from "./AgentMenu";
import MsgTools, { focusComposer } from "./MsgTools";
import Markdown from "./Markdown";
import { tx, txn } from "../i18n";
import { gridFit, spanOf, useWidth } from "../gridFit";

/** Projeto real sem conversa ainda. */
function RealIdle(props: { onAccess: () => void; onConvos: () => void }) {
  const changes = () => ws.events.filter((e) => e.agent === "disco").slice(-8);
  const p = currentProject;
  const a = () => accountById(p().accountId);
  const isClaude = () => a().provider === "claude";
  return (
    <>
      <div class="bubble agent pop-in">
        <Show
          when={isClaude()}
          fallback={<>{tx("Peça abaixo e {label} trabalha nesta pasta pelas ferramentas do Veocode: lista, lê, busca, edita arquivos e roda comandos, obedecendo o nível de acesso. O que o nível manda perguntar aparece aqui para você permitir ou recusar. Se o modelo não aceitar ferramentas, vira só conversa.", { label: a().label })}</>}
        >
          {tx("Peça abaixo e o Claude Code trabalha nesta pasta, com a conta {label} e obedecendo o nível de acesso. O que o nível manda perguntar aparece aqui para você permitir ou recusar. O que ele mudar fica marcado na árvore (", { label: a().label })}<b class="c-edit">M</b>, <b class="c-new">N</b>, <b class="c-del">A</b>).
        </Show>
        <div class="idle-actions">
          <Show when={isClaude()}>
            <button class="ghost-btn" onClick={() => openClaude(p().id)}>
              <TerminalSquare size={13} /> {tx("Abrir no Terminal")}
            </button>
          </Show>
          <button class="ghost-btn" onClick={props.onConvos}>
            <History size={13} /> {tx("Conversas anteriores")}
          </button>
          <button class="ghost-btn" onClick={props.onAccess}>
            <ShieldCheck size={13} /> {tx("Nível de acesso")}
          </button>
        </div>
      </div>
      <Show when={changes().length > 0}>
        <div class="work-card pop-in">
          <div class="work-head">
            <span class="work-dot live" />
            {tx("Mudanças no disco")}
            <small>{ws.events.filter((e) => e.agent === "disco").length}</small>
          </div>
          <For each={changes()}>
            {(e) => (
              <div class="work-row slide-in">
                <span class="work-icon" style={{ color: kindColor[e.kind] }}>
                  <ActivityIcon kind={e.kind} />
                </span>
                <span class="work-title">{e.title}</span>
                <small class="work-detail">{e.time}</small>
              </div>
            )}
          </For>
        </div>
      </Show>
    </>
  );
}

const fileName = (p: string) => p.slice(p.lastIndexOf("/") + 1);

type Block = { t: "user" | "say" | "done" | "compact"; e: ActivityEvent } | { t: "work"; items: ActivityEvent[] };

/** Conversa real: pedidos, respostas e os passos do Claude (lidos do histórico dele). */
function RealConversation(props: { events: () => ActivityEvent[]; tail?: boolean; k?: string }) {
  // editar um pedido já mandado (como no Claude): o texto volta na própria bolha
  const key = () => props.k ?? activeKey(currentProject().id);
  const [editing, setEditing] = createSignal<number | null>(null);
  const [draft, setDraft] = createSignal("");
  const clean = (t: string) => t.replace(/\n📎[^\n]*/g, "").trim();
  const startEdit = (e: ActivityEvent) => (setDraft(clean(e.title)), setEditing(e.id));
  const lastUser = () => [...props.events()].reverse().find((e) => e.kind === "user");
  const confirmEdit = async (e: ActivityEvent) => {
    const text = draft().trim();
    if (!text) return;
    setEditing(null);
    await resendEdited(key(), e, text);
  };
  // chaves estáveis por bloco: o DOM de cada bloco não é recriado a cada leitura
  const blocks = createMemo(() => {
    const map = new Map<string, Block>();
    let work: string | null = null;
    for (const e of props.events()) {
      if (e.kind === "user" || e.kind === "say" || e.kind === "done" || e.kind === "compact") {
        map.set(`${e.kind}:${e.id}`, { t: e.kind, e });
        work = null;
      } else if (work) {
        (map.get(work) as { items: ActivityEvent[] }).items.push(e);
      } else {
        work = `work:${e.id}`;
        map.set(work, { t: "work", items: [e] });
      }
    }
    return map;
  });
  const keys = createMemo(() => [...blocks().keys()].slice(-16), undefined, { equals: (a, b) => a.length === b.length && a.every((k, i) => k === b[i]) });


  return (
    <>
      <For each={keys()}>
        {(k) => {
          const b = () => blocks().get(k);
          return (
            <Switch>
              <Match when={b()?.t === "user" && (b() as { e: ActivityEvent }).e}>
                {(e) => (
                  <Show
                    when={editing() === e().id}
                    fallback={
                      <div class="bubble user pop-in">
                        {e().title}
                        <SentThumbs text={e().title} />
                        <MsgTools
                          text={e().title}
                          onEdit={props.tail && e().anchor !== undefined ? () => startEdit(e()) : undefined}
                          onReuse={() => (setInput(key(), e().title), focusComposer(props.k ? document.querySelector(`[data-chat-key="${props.k}"]`) : document.querySelector(".chat-panel")))}
                        />
                      </div>
                    }
                  >
                    <div class="bubble user editing pop-in">
                      <textarea
                        value={draft()}
                        rows={Math.min(10, Math.max(2, draft().split("\n").length))}
                        ref={(el) => requestAnimationFrame(() => (el.focus(), el.setSelectionRange(el.value.length, el.value.length)))}
                        onInput={(ev) => setDraft(ev.currentTarget.value)}
                        onKeyDown={(ev) => {
                          if (ev.key === "Escape") (ev.preventDefault(), setEditing(null));
                          if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) (ev.preventDefault(), void confirmEdit(e()));
                        }}
                      />
                      <div class="edit-bar">
                        <small>{tx("{v}O Claude esquece esta versão e o que veio depois", { v: chatOf(key()).busy ? tx("Para a resposta atual e ") : "" })}</small>
                        <button class="ghost-btn small" onClick={() => setEditing(null)}>{tx("Cancelar")}</button>
                        <button class="primary-btn small" disabled={!draft().trim()} onClick={() => void confirmEdit(e())}><SendHorizontal size={12} /> {tx("Enviar")}</button>
                      </div>
                    </div>
                  </Show>
                )}
              </Match>
              <Match when={b()?.t === "say" && (b() as { e: ActivityEvent }).e}>
                {(e) => (
                  <Show when={limitHit(e().title)} fallback={<div class="bubble agent pop-in say md-bubble" style={{ "--c": e().color ?? "var(--accent)" }}><Markdown text={e().title} /><MsgTools text={e().title} /></div>}>
                    {(h) => <LimitHitCard accountId={currentProject().accountId} win={h().win} raw={h().raw} onPick={(id) => requestSwitch(currentProject().id, id)} />}
                  </Show>
                )}
              </Match>
              <Match when={b()?.t === "done" && (b() as { e: ActivityEvent }).e}>
                {(e) => (
                  <Show when={e().status === "error"} fallback={<div class="done-line pop-in"><span>✓</span> {tx("{agent} terminou · {time}", { agent: e().agent, time: e().time })}</div>}>
                    <div class="done-line stopped pop-in">
                      <span>■</span> {tx("Você parou · {time}", { time: e().time })}
                      <Show when={props.tail && lastUser()?.anchor !== undefined}>
                        <button class="link-btn" onClick={() => startEdit(lastUser()!)}><Pencil size={11} /> {tx("Editar o pedido")}</button>
                      </Show>
                    </div>
                  </Show>
                )}
              </Match>
              <Match when={b()?.t === "compact" && (b() as { e: ActivityEvent }).e}>
                {(e) => (
                  <div class="compact-line pop-in" classList={{ running: e().status === "running", error: e().status === "error" }}>
                    <Show when={e().status === "running"} fallback={<Shrink size={12} />}><span class="spinner" /></Show>
                    <span>{e().title}</span>
                    <Show when={e().detail}><b>{e().detail}</b></Show>
                  </div>
                )}
              </Match>
              <Match when={b()?.t === "work" && (b() as { items: ActivityEvent[] }).items}>
                {(items) => {
                  // fechado por padrão: uma linha só ("Executou 2 comandos, leu 1 arquivo ›"); abre com um clique
                  const [open, setOpen] = createSignal(false);
                  const [all, setAll] = createSignal(false);
                  const shown = () => (all() ? items() : items().slice(-8));
                  const running = () => items().some((x) => x.status === "running");
                  const now = () => [...items()].reverse().find((x) => x.status === "running") ?? items()[items().length - 1];
                  const failed = () => items().filter((x) => x.status === "error").length;
                  return (
                    <div class="work-fold pop-in" classList={{ open: open(), live: running() }}>
                      <button class="work-sum" aria-expanded={open()} onClick={() => setOpen(!open())}>
                        <Show when={running()} fallback={<span class="work-sum-text">{stepsSummary(items().map((x) => x.kind))}</span>}>
                          <span class="spinner" />
                          <span class="work-sum-text now">{now()?.title}</span>
                          <small class="work-sum-count">{txn(items().length, "{n} passo", "{n} passos")}</small>
                        </Show>
                        <Show when={failed() > 0}><small class="work-sum-fail">{tx("{failed} falhou", { failed: failed() })}</small></Show>
                        <ChevronDown size={13} class="work-chev" />
                      </button>
                      <Show when={open()}>
                        <div class="work-card slide-in">
                          <Show when={items().length > 8 && !all()}><button class="work-more" onClick={() => setAll(true)}>{tx("+{v} antes · mostrar tudo", { v: items().length - 8 })}</button></Show>
                          <For each={shown()}>
                            {(x) => (
                              <div class="work-row" classList={{ running: x.status === "running", error: x.status === "error" }} title={x.detail ?? x.title}>
                                <span class="work-icon" style={{ color: kindColor[x.kind] }}>
                                  <ActivityIcon kind={x.kind} />
                                </span>
                                <span class="work-title">{x.title}</span>
                                <Show when={x.status === "running"} fallback={<small class="work-detail">{x.status === "error" ? tx("falhou") : x.kind === "run" ? "" : x.detail}</small>}>
                                  <span class="spinner" />
                                </Show>
                              </div>
                            )}
                          </For>
                        </div>
                      </Show>
                    </div>
                  );
                }}
              </Match>
            </Switch>
          );
        }}
      </For>
      <Show when={props.tail !== false}><ChatTail k={props.k} /></Show>
    </>
  );
}

/** Conversas anteriores do projeto: sessões do Claude (de todas as contas) e conversas com APIs. */
function Conversations(props: { onClose: () => void }) {
  const p = currentProject;
  const pid = p().id;
  const [data, { refetch }] = createResource(() => listConversations(pid).catch((e) => (showToast(String(e)), { items: [] as Convo[], current: null })));
  const [opening, setOpening] = createSignal<string | null>(null);
  const usable = (c: Convo) => c.account === p().accountId;
  const open = async (c: Convo) => {
    if (!usable(c)) return showToast(tx("Esta conversa é da conta {label}. Troque a conta do projeto para continuar nela.", { label: accountById(c.account).label }));
    setOpening(`${c.kind}:${c.id}`);
    await openInTab(pid, c);
    setOpening(null);
    props.onClose();
  };
  return (
    <div class="convos">
      <div class="convos-head">
        <button class="icon-btn small" title={tx("Voltar para a conversa")} onClick={props.onClose}><ArrowLeft size={14} /></button>
        <strong>{tx("Conversas deste projeto")}</strong>
        <button
          class="ghost-btn small"
          onClick={() => {
            newTab(pid);
            props.onClose();
          }}
        >
          <MessageSquarePlus size={12} /> {tx("Nova")}
        </button>
      </div>
      <Show when={!data.loading} fallback={<div class="convos-empty"><span class="spinner" /> {tx("Lendo os históricos…")}</div>}>
        <Show
          when={data()?.items.length}
          fallback={<div class="convos-empty">{tx("Nenhuma conversa ainda nesta pasta. As sessões do Claude (pelo chat, Terminal ou editor) e as conversas com APIs aparecem aqui.")}</div>}
        >
          <For each={data()!.items}>
            {(c, i) => {
              const key = `${c.kind}:${c.id}`;
              // a conversa aberta de outra conta (o projeto trocou de conta) não vale mais: mostra o cadeado
              const current = () => usable(c) && tabsOf(pid).some((t) => (chatOf(t.key).session ?? t.session) === c.id || chatOf(t.key).conv?.id === c.id);
              return (
                <ConvoRow
                  c={c}
                  i={i()}
                  current={current()}
                  locked={!usable(c)}
                  opening={opening() === key}
                  disabled={!!opening()}
                  title={usable(c) ? (current() ? tx("Aberta numa aba: clique para ir até ela") : tx("Continuar esta conversa numa aba")) : tx("Da conta {label}: troque a conta do projeto para continuar", { label: accountById(c.account).label })}
                  extra={<Show when={c.origin}><span>· {c.origin}</span></Show>}
                  onOpen={() => open(c)}
                  onDelete={async () => (await deleteConvos(pid, [c], data()?.current ?? null)) && refetch()}
                />
              );
            }}
          </For>
          <div class="convos-foot">
            <button class="convos-refresh" onClick={() => refetch()}>{tx("Atualizar a lista")}</button>
            <button class="convos-clear" disabled={chatOf(pid).busy} onClick={async () => (await deleteConvos(pid, [...data()!.items], data()?.current ?? null)) && refetch()}>
              {tx("Apagar todas ({length})", { length: data()!.items.length })}
            </button>
          </div>
        </Show>
      </Show>
    </div>
  );
}

/** Texto chegando, pedidos de permissão e erro da conversa. */
function ChatTail(props: { k?: string }) {
  const p = currentProject;
  const ck = () => props.k ?? activeKey(p().id);
  const chat = () => chatOf(ck());
  const a = () => accountById(p().accountId);
  return (
    <>
      <Show when={chat().busy && !chat().perms.length}>
        <Show when={chat().draft} fallback={<div class="typing pop-in" style={{ "--c": a().color }}><span /><span /><span /></div>}>
          <div class="bubble agent say streaming" style={{ "--c": a().color }}>{chat().draft.replace(/\*\*/g, "")}</div>
        </Show>
      </Show>
      <For each={chat().perms}>
        {(q) => (
          <div class="perm-ask pop-in" style={{ "--c": a().color }}>
            <div class="perm-ask-head">
              <ShieldCheck size={14} />
              <span>{tx("O nível pede para confirmar")}</span>
              <small>{q.tool}</small>
            </div>
            <strong>{q.title}</strong>
            <Show when={q.detail}><pre>{q.detail}</pre></Show>
            <div class="perm-ask-actions">
              <button class="ghost-btn" disabled={q.answering} onClick={() => answerPermission(ck(), q.requestId, false)}>
                <Ban size={13} /> {tx("Recusar")}
              </button>
              <button class="primary-btn small" disabled={q.answering} onClick={() => answerPermission(ck(), q.requestId, true)}>
                <Check size={13} /> {tx("Permitir")}
              </button>
            </div>
          </div>
        )}
      </For>
      <Show when={chat().error}>
        <div class="bubble chat-error pop-in">
          <AlertTriangle size={14} />
          <span>{chat().error}</span>
          <button class="icon-btn small" title={tx("Fechar")} onClick={() => clearError(ck())}><X size={12} /></button>
        </div>
      </Show>
    </>
  );
}

/** Caixa de mensagem: Enter envia, Shift+Enter quebra linha. */
function Composer(props: { onLevel: () => void; levelOn?: boolean; k?: string; compact?: boolean }) {
  const p = currentProject;
  const k = () => props.k ?? activeKey(p().id);
  const chat = () => chatOf(k());
  const a = () => accountById(p().accountId);
  const level = () => accessLevels[p().access];
  const demo = () => p().demo || !isTauri;
  const canAttach = () => !demo() && !!ws.activeFile && !isDiffTab(ws.activeFile);
  const [menu, setMenu] = createSignal(false);
  // bolinha no nível enquanto ele não vale de verdade no projeto
  const unapplied = () => isTauri && !p().demo && acc.reports[p().id]?.fileState.state !== "aplicado";
  let box!: HTMLTextAreaElement;

  const send = () => {
    if (demo()) return showToast(tx("Projeto de demonstração: abra uma pasta sua para conversar de verdade"));
    nameFromPrompt(k(), chat().input);
    sendChat(k());
    requestAnimationFrame(() => fit());
  };
  const fit = () => {
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, 160)}px`;
  };
  createEffect(on(k, () => requestAnimationFrame(() => box && fit())));
  createEffect(on(() => listeningTo(k()) && chat().input, () => box && fit(), { defer: true }));

  return (
    <>
    <Show when={!demo() && !props.compact}><MediaStrip pid={p().id} /></Show>
    <Show when={!demo() && !props.compact}><EconomyHint pid={p().id} /></Show>
    <div class="composer" classList={{ busy: chat().busy, dropping: dropPid() === k(), listening: listeningTo(k()) }} data-attach-pid={demo() ? undefined : k()}>
      <AttachBar
        pid={k()}
        extra={
          <Show when={canAttach()}>
            <Show
              when={chat().attach}
              fallback={
                <button class="att-suggest" title={tx("Mandar junto o arquivo aberto no editor")} onClick={() => setAttach(k(), true)}>
                  <Plus size={11} /> {fileName(ws.activeFile)}
                </button>
              }
            >
              <div class="att text open-file" title={ws.activeFile}>
                <span class="att-icon"><FileCode2 size={14} /></span>
                <span class="att-text"><strong>{fileName(ws.activeFile)}</strong><small>{tx("aberto no editor")}</small></span>
                <button class="att-x" title={tx("Não mandar o arquivo aberto")} onClick={() => setAttach(k(), false)}><X size={11} /></button>
              </div>
            </Show>
          </Show>
        }
      />
      <textarea
        ref={box}
        rows={props.compact ? 1 : 2}
        value={chat().input}
        readOnly={listeningTo(k())}
        placeholder={listeningTo(k()) ? tx("Pode falar… (Enter para, Esc cancela)") : props.compact ? tx("Pedir algo… (Enter envia)") : tx("Pedir algo a {label}… (Enter envia, ⌥ Espaço para falar)", { label: a().label })}
        onPaste={(e) => !demo() && void pasteFiles(k(), e)}
        onInput={(e) => {
          setInput(k(), e.currentTarget.value);
          fit();
        }}
        onKeyDown={(e) => {
          if (!demo() && voiceKey(k(), e)) return;
          // Esc para a resposta (como no Claude Code)
          if (e.key === "Escape" && chat().busy) return (e.preventDefault(), void stopChat(k()));
          if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            if (!chat().busy) send();
          }
        }}
      />
      <div class="composer-bar">
        <button class="icon-btn" classList={{ on: attsOf(k()).length > 0 }} disabled={demo()} title={tx("Anexar arquivos ou imagens (ou cole com ⌘V, ou arraste do Finder)")} onClick={() => void pickFiles(k())}>
          <Paperclip size={14} />
        </button>
        <AgentChipButton prefKey={p().id} accountId={a().id} open={menu()} title={tx("Conta, modelo e força do raciocínio deste projeto")} onClick={() => setMenu(!menu())} />
        <button class="composer-chip" classList={{ on: props.levelOn, unapplied: unapplied() }} style={{ "--lc": level().color }} title={unapplied() ? tx("Nível de acesso: ainda não vale no Claude Code, clique para gravar") : tx("Nível de acesso: o que a IA pode fazer aqui (clique para mudar)")} onClick={props.onLevel}>
          <ShieldCheck size={12} /> {level().short}
        </button>
        <span class="composer-gap" />
        <UsageRing id={a().id} />
        <Show when={!demo()}><MicButton target={k()} /></Show>
        <Show
          when={chat().busy}
          fallback={
            <button class="send-btn" disabled={!demo() && !chat().input.trim() && !attsOf(k()).length} title={tx("Enviar (Enter)")} onClick={send}>
              <SendHorizontal size={14} />
            </button>
          }
        >
          <button class="send-btn stop" title={tx("Parar (Esc). Depois dá para editar o pedido e mandar de novo")} onClick={() => stopChat(k())}>
            <Square size={11} fill="currentColor" />
          </button>
        </Show>
      </div>
      <Show when={menu()}>
        <AgentMenu prefKey={p().id} accountId={a().id} title={tx("Conta neste projeto")} onPick={(id) => requestSwitch(p().id, id)} onClose={() => setMenu(false)} />
      </Show>
    </div>
    </>
  );
}

/** Modo foco: todas as conversas (abas) do projeto ao mesmo tempo, cada uma com a sua caixa. */
function FocusGrid(props: { pid: string; onLevel: () => void }) {
  const list = () => tabsOf(props.pid);
  let grid!: HTMLDivElement;
  const width = useWidth(() => grid);
  // cada aba carrega a sua conversa (a da frente já está carregada)
  createEffect(on(() => list().map((t) => t.key).join(","), () => list().forEach((t) => wakeTab(props.pid, t.key))));
  // a aba escolhida na barra vem para a vista
  createEffect(on(() => activeKey(props.pid), (k) => requestAnimationFrame(() => grid?.querySelector(`[data-chat-key="${k}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" })), { defer: true }));
  const layout = createMemo(() => gridFit(list().length, width()));
  return (
    <div
      class="focus-grid"
      ref={grid}
      style={{ "grid-template-columns": `repeat(${layout().units}, minmax(0, 1fr))`, "grid-template-rows": `repeat(${layout().rows}, minmax(${layout().rows > 2 ? 280 : 240}px, 1fr))` }}
    >
      <For each={list()}>
        {(t, i) => <FocusTile pid={props.pid} tab={t} span={spanOf(layout(), i())} onLevel={props.onLevel} />}
      </For>
    </div>
  );
}

function FocusTile(props: { pid: string; tab: ConvTab; span: number; onLevel: () => void }) {
  const k = () => props.tab.key;
  const c = () => chatOf(k());
  const events = createMemo(() => ws.events.filter((e) => ofChat(k(), e)));
  const active = () => activeKey(props.pid) === k();
  const state = () => (c().perms.length ? tx("esperando você") : c().busy ? tx("trabalhando") : c().error ? tx("com erro") : events().length ? "" : tx("vazia"));
  let scroller!: HTMLDivElement;
  createEffect(on(() => [events().length, c().draft.length >> 6, c().perms.length, c().error], () => setTimeout(() => scroller?.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" }), 30)));
  return (
    <section
      class="focus-tile pop-in"
      classList={{ on: active(), busy: c().busy, ask: c().perms.length > 0, err: !!c().error }}
      style={{ "grid-column": `span ${props.span}` }}
      data-chat-key={k()}
      onFocusIn={() => !active() && selectTab(props.pid, k())}
    >
      <header class="focus-head">
        <i class="conv-dot" />
        <strong title={tx(props.tab.title)}>{tx(props.tab.title)}</strong>
        <small>{state()}</small>
        <span class="composer-gap" />
        <button class="icon-btn small" title={tx("Abrir só esta conversa (sai do modo foco)")} onClick={() => (selectTab(props.pid, k()), setFocusMode(false))}><Maximize2 size={13} /></button>
        <button class="icon-btn small" title={tx("Fechar a aba (a conversa fica no histórico)")} onClick={() => void closeTab(props.pid, k())}><X size={13} /></button>
      </header>
      <div class="chat-scroll focus-scroll" ref={scroller}>
        <Show when={events().length > 0 || c().busy || c().error} fallback={<div class="focus-empty"><MessageSquarePlus size={18} /><span>{tx("Conversa nova: peça algo aqui embaixo.")}</span></div>}>
          <RealConversation events={events} tail k={k()} />
        </Show>
      </div>
      <Composer k={k()} compact onLevel={props.onLevel} />
    </section>
  );
}

export type Pane = "chat" | "ext" | "mem" | "hist";
export type View = Pane | "act";
// o que aparece no lugar da conversa: ela mesma, sessões de fora, histórico ou memória. Fica fora do
// componente para a lista de conversas (modo IA, à esquerda) poder trocar.
const [pane, setPane] = createSignal<Pane>("chat");
export const chatPane = pane;
export function showChatPane(v: Pane) {
  if (panelAt() === "tab") setPanelAt("none");
  setChatTab("chat");
  setPane(v);
}

export default function ChatPanel(props: { slim?: boolean }) {
  const [tab, setTab] = [gitTab, setChatTab];
  const project = currentProject;
  const view = (): View => (panelAt() === "tab" ? "act" : pane());
  const go = (v: View) => {
    if (v === "act") {
      setPane("chat");
      return setPanelAt(panelAt() === "tab" ? "none" : "tab");
    }
    if (panelAt() === "tab") setPanelAt("none");
    setPane(pane() === v ? "chat" : v);
  };
  const ext = () => view() === "ext";
  // a memória fica montada depois da 1ª vez: voltar nela não recarrega
  const [memSeen, setMemSeen] = createSignal(false);
  createEffect(() => view() === "mem" && setMemSeen(true));
  const mem = () => view() === "mem";
  const convos = () => view() === "hist";
  const setConvos = (v: boolean) => (v ? go("hist") : pane() === "hist" && setPane("chat"));
  const setMem = (_: false) => pane() === "mem" && setPane("chat");
  createEffect(on(() => project().id, (id) => {
    setPane("chat");
    if (isTauri && !project().demo) {
      wakeActive(id);
      syncRunning(id);
    }
  }));
  const real = () => isTauri && !project().demo;
  const focusOn = () => focusMode() && real() && view() === "chat";
  const key = () => activeKey(project().id);
  const tabEvents = createMemo(() => ws.events.filter((e) => ofChat(key(), e)));
  // sessões do Claude nesta pasta que não são de nenhuma aba (Terminal, editor, app do Claude)
  const extEvents = createMemo(() => {
    const owned = new Set(tabsOf(project().id).map((t) => chatOf(t.key).session ?? t.session).filter(Boolean));
    return ws.events.filter((e) => e.agent !== "disco" && !e.tab && !!e.session && !owned.has(e.session));
  });
  const shown = () => (ext() ? extEvents() : tabEvents());
  const account = () => accountById(project().accountId);
  createEffect(on(() => project().id, (id) => isTauri && loadAccess(id)));
  let scroller!: HTMLDivElement;

  // rola o chat junto com a atividade
  createEffect(on(() => [shown().length, key(), ext(), chatOf(key()).draft.length >> 6, chatOf(key()).perms.length, chatOf(key()).error], () => setTimeout(() => scroller && scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" }), 30)));

  const userMsgs = () => ws.events.filter((e) => e.kind === "user");
  const work = () => ws.events.filter((e) => e.kind !== "user" && e.kind !== "done");
  const done = () => ws.events.find((e) => e.kind === "done");

  return (
    <aside class="chat-panel" style={{ "--c": account().color }}>
      <Switch>
        <Match when={tab() === "chat"}>
          <Show when={real()}>
            <ConvTabsBar pid={project().id} view={view()} onView={go} extCount={new Set(extEvents().map((e) => e.session)).size} slim={props.slim} />
          </Show>
          <Show when={memSeen() && real()}>
            <div class="chat-scroll mem-scroll" classList={{ hidden: !mem() }}>
              <MemoryPanel pid={project().id} onClose={() => setMem(false)} />
            </div>
          </Show>
          <Show when={convos() && real() && !mem()}>
            <div class="chat-scroll">
              <Conversations onClose={() => setConvos(false)} />
            </div>
          </Show>
          <Show when={view() === "act"}>
            <div class="act-view pop-in">
              <BottomPanel asTab />
            </div>
          </Show>
          <Show when={focusOn()}>
            <FocusGrid pid={project().id} onLevel={() => setTab("access")} />
          </Show>
          <div class="chat-scroll" ref={scroller} data-target="chat" classList={{ hidden: ((convos() || mem()) && real()) || view() === "act" || focusOn() }}>
            <Show when={ext() && real()}>
              <div class="ext-head pop-in">
                <span class="ext-head-icon"><Eye size={15} /></span>
                <div>
                  <strong>{tx("Fora do Veocode")}</strong>
                  <span>{tx("O Claude rodando nesta pasta por fora (Terminal, editor ou o app do Claude) aparece aqui ao vivo. É só para acompanhar: para pedir algo, use as abas de conversa.")}</span>
                </div>
                <button class="icon-btn small" title={tx("Voltar para a conversa")} onClick={() => go("chat")}><X size={13} /></button>
              </div>
            </Show>
            <Show
              when={project().demo}
              fallback={
                <Show when={(seenAgent() && shown().length > 0) || (!ext() && (chatOf(key()).busy || chatOf(key()).error))} fallback={<Show when={!ext()} fallback={<div class="chat-empty ext-empty"><strong>{tx("Nada rodando por fora agora")}</strong><span>{tx("Abra o Claude nesta pasta pelo Terminal ou pelo editor e ele aparece aqui.")}</span></div>}><RealIdle onAccess={() => setTab("access")} onConvos={() => setConvos(true)} /></Show>}>
                  <RealConversation events={shown} tail={!ext()} />
                </Show>
              }
            >
              <Show when={ws.events.length === 0}>
                <div class="chat-empty">{ws.paused ? tx("Simulação parada: aperte Assistir (em cima do editor) para ver um agente de exemplo trabalhando.") : tx("O agente de exemplo vai começar em instantes…")}</div>
              </Show>
              <For each={userMsgs()}>{(m) => <div class="bubble user pop-in">{m.title}</div>}</For>
              <Show when={work().length > 0}>
                <div class="work-card pop-in">
                  <div class="work-head">
                    <span class="work-dot" classList={{ live: ws.running }} />
                    {ws.running ? tx("Trabalhando…") : tx("Concluído")}
                    <small>{tx("{length} passos", { length: work().length })}</small>
                  </div>
                  <For each={work()}>
                    {(e) => (
                      <div class="work-row slide-in" classList={{ running: e.status === "running" }}>
                        <span class="work-icon" style={{ color: kindColor[e.kind] }}>
                          <ActivityIcon kind={e.kind} />
                        </span>
                        <span class="work-title">{e.title}</span>
                        <Show when={e.status === "running"} fallback={<small class="work-detail">{e.detail}</small>}>
                          <span class="spinner" />
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
              <Show when={done()}>
                {(d) => (
                  <div class="bubble agent pop-in">
                    <strong>{d().title}.</strong> {tx("{detail}. Quer ver os dados reais do disco em Computador → Espaço e memória?", { detail: d().detail })}
                  </div>
                )}
              </Show>
            </Show>
          </div>
          <Show when={!focusOn() && (view() === "chat" || view() === "hist")} fallback={<Show when={ext()}><p class="ext-note">{tx("Sessões do Claude abertas fora do Veocode nesta pasta (Terminal, editor, app do Claude). Aqui é só para acompanhar: para conversar, use uma aba sua.")}</p></Show>}>
            <Composer onLevel={() => setTab("access")} />
          </Show>
        </Match>
        <Match when={tab() === "access"}>
          <div class="chat-scroll">
            <button class="back-link" onClick={() => setTab("chat")}><ArrowLeft size={14} /> {tx("Voltar para a conversa")}</button>
            <AccessLevel projectId={project().id} />
          </div>
        </Match>
      </Switch>
    </aside>
  );
}
