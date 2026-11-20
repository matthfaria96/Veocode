import { AlertTriangle, ArrowUp, Eye, ArrowLeft, Ban, Check, ChevronDown, FileCode2, History, Loader2, Maximize2, MessageSquarePlus, Pencil, Paperclip, Plus, SendHorizontal, Shrink, ShieldCheck, Square, TerminalSquare, X } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch } from "solid-js";
import { accessLevels } from "../data/mock";
import { accountById } from "../accounts";
import { currentProject, isDiffTab, showToast, ws, type ActivityEvent } from "../store";
import { seenAgent } from "../agentFeed";
import { acc, loadAccess, openClaude } from "../access";
import { answerPermission, chatOf, clearError, deleteConvos, ofChat, resendEdited, sendChat, setAttach, setInput, stopChat, type Convo } from "../chat";
import { activeKey, closeTab, forkConversation, nameFromPrompt, openInTab, selectTab, startConversation, syncRunning, tabsOf, wakeActive, wakeTab, type ConvTab } from "../convTabs";
import { dropFromHist, histLoaded, histLoading, histOf, loadHist } from "../convHist";
import { ConvTabsBar, EconomyHint } from "./ConvBar";
import { ContextChip } from "./ContextPanel";
import { isOpen, openAccess } from "../modals";
import { ProjectIcon } from "./icons";
import { isTauri } from "../api";
import ConvoRow from "./ConvoRow";
import { setChatTab } from "../git";
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
import Thinking from "./Thinking";
import { tx, txn } from "../i18n";
import { gridFit, spanOf, useWidth } from "../gridFit";

/**
 * Rola junto com o fim da conversa só enquanto você está perto dele; subiu para ler, fica onde
 * está (como no Claude). Trocar de conversa ou mandar um pedido volta para o fim.
 */
function useFollow(el: () => HTMLElement | undefined, changes: () => unknown, reset: () => unknown, force: () => boolean) {
  let stick = true;
  let mine = 0; // rolagem feita aqui (não é você rolando)
  const bottom = (smooth: boolean) =>
    setTimeout(() => {
      const s = el();
      if (!s) return;
      mine = Date.now();
      s.scrollTo({ top: s.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    }, 30);
  createEffect(on(reset, () => ((stick = true), bottom(false))));
  createEffect(on(changes, () => {
    if (force()) stick = true;
    if (stick) bottom(true);
  }, { defer: true }));
  return (e: Event) => {
    if (Date.now() - mine < 700) return;
    const s = e.currentTarget as HTMLElement;
    stick = s.scrollHeight - s.scrollTop - s.clientHeight < 120;
  };
}

/** Projeto real sem conversa ainda: uma tela calma, com o essencial e três atalhos. */
function RealIdle(props: { onAccess: () => void; onConvos: () => void }) {
  const changes = () => ws.events.filter((e) => e.agent === "disco").slice(-8);
  const p = currentProject;
  const a = () => accountById(p().accountId);
  const isClaude = () => a().provider === "claude";
  const level = () => accessLevels[p().access];
  return (
    <>
      <div class="idle-hero pop-in">
        <span class="idle-mark"><ProjectIcon id={p().id} name={p().name} stack={p().stack} size={40} /></span>
        <h2>{tx("O que vamos fazer em {name}?", { name: p().name })}</h2>
        <p>
          <Show when={isClaude()} fallback={tx("{label} trabalha nesta pasta pelas ferramentas do Veocode. O que precisar da sua permissão aparece aqui.", { label: a().label })}>
            {tx("O Claude Code trabalha nesta pasta com a conta {label}. O que precisar da sua permissão aparece aqui.", { label: a().label })}
          </Show>
        </p>
        <div class="idle-actions">
          <button class="idle-act" onClick={props.onConvos}>
            <History size={14} /> {tx("Conversas anteriores")}
          </button>
          <button class="idle-act" onClick={props.onAccess} style={{ "--lc": level().color }}>
            <ShieldCheck size={14} class="idle-lc" /> {tx("Acesso: {v}", { v: level().short })}
          </button>
          <Show when={isClaude()}>
            <button class="idle-act" onClick={() => openClaude(p().id)}>
              <TerminalSquare size={14} /> {tx("Abrir no Terminal")}
            </button>
          </Show>
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
  // mostra o fim da conversa; "Mostrar anteriores" vai abrindo para cima (sem pular a rolagem)
  const [limit, setLimit] = createSignal(40);
  createEffect(on(key, () => setLimit(40), { defer: true }));
  const allKeys = createMemo(() => [...blocks().keys()]);
  const hidden = () => Math.max(0, allKeys().length - limit());
  const keys = createMemo(() => allKeys().slice(-limit()), undefined, { equals: (a, b) => a.length === b.length && a.every((k, i) => k === b[i]) });
  let topEl: HTMLDivElement | undefined;
  const showMore = () => {
    const sc = topEl?.closest(".chat-scroll") as HTMLElement | null;
    const before = sc ? sc.scrollHeight - sc.scrollTop : 0;
    setLimit(limit() + 40);
    if (sc) requestAnimationFrame(() => (sc.scrollTop = sc.scrollHeight - before));
  };
  // ramo daqui: só nas conversas do Claude que já têm sessão (a âncora vem do histórico dele)
  const forkAt = (e: ActivityEvent) => {
    const pid = currentProject().id;
    const c = chatOf(key());
    const parent = c.session ?? c.fork?.parent;
    if (!parent || e.anchor === undefined || e.anchor.startsWith("api:")) return undefined;
    return () => void forkConversation(pid, { session: parent, account: currentProject().accountId, title: tabsOf(pid).find((t) => t.key === key())?.title ?? "Conversa" }, { anchor: e.anchor!, text: clean(e.title) });
  };


  return (
    <>
      <div ref={topEl} class="chat-top-anchor" />
      <Show when={hidden() > 0}>
        <button class="chat-more" onClick={showMore}>{txn(hidden(), "Mostrar {n} parte anterior", "Mostrar {n} partes anteriores")}</button>
      </Show>
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
                          onFork={props.tail ? forkAt(e()) : undefined}
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

/** Todas as conversas do projeto (sessões do Claude de todas as contas e conversas com APIs), para apagar várias. */
function Conversations(props: { onClose: () => void }) {
  const p = currentProject;
  const pid = p().id;
  void loadHist(pid, 0);
  const items = () => histOf(pid);
  const [opening, setOpening] = createSignal<string | null>(null);
  const usable = (c: Convo) => c.account === p().accountId;
  const open = async (c: Convo) => {
    if (!usable(c)) return showToast(tx("Esta conversa é da conta {label}. Troque a conta do projeto para continuar nela.", { label: accountById(c.account).label }));
    setOpening(`${c.kind}:${c.id}`);
    const ok = await openInTab(pid, c);
    setOpening(null);
    if (ok) props.onClose();
  };
  const remove = async (list: Convo[]) => {
    const n = await deleteConvos(pid, list, null);
    if (!n) return;
    dropFromHist(pid, list.map((c) => c.id));
    void loadHist(pid, 0);
  };
  return (
    <div class="convos">
      <div class="convos-head">
        <button class="icon-btn small" title={tx("Voltar para a conversa")} onClick={props.onClose}><ArrowLeft size={14} /></button>
        <strong>{tx("Conversas deste projeto")}</strong>
        <button
          class="ghost-btn small"
          onClick={() => {
            startConversation(pid);
            props.onClose();
          }}
        >
          <MessageSquarePlus size={12} /> {tx("Nova")}
        </button>
      </div>
      <Show when={histLoaded(pid) || !histLoading(pid)} fallback={<div class="convos-empty"><span class="spinner" /> {tx("Lendo os históricos…")}</div>}>
        <Show
          when={items().length}
          fallback={<div class="convos-empty">{tx("Nenhuma conversa ainda nesta pasta. As sessões do Claude (pelo chat, Terminal ou editor) e as conversas com APIs aparecem aqui.")}</div>}
        >
          <For each={items()}>
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
                  title={usable(c) ? (current() ? tx("Aberta: clique para ir até ela") : tx("Continuar esta conversa")) : tx("Da conta {label}: troque a conta do projeto para continuar", { label: accountById(c.account).label })}
                  extra={<Show when={c.origin}><span>· {c.origin}</span></Show>}
                  onOpen={() => open(c)}
                  onDelete={() => void remove([c])}
                />
              );
            }}
          </For>
          <div class="convos-foot">
            <button class="convos-refresh" onClick={() => void loadHist(pid, 0)}>{histLoading(pid) ? tx("Lendo…") : tx("Atualizar a lista")}</button>
            <button class="convos-clear" disabled={tabsOf(pid).some((t) => chatOf(t.key).busy)} onClick={() => void remove([...items()])}>
              {tx("Apagar todas ({length})", { length: items().length })}
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
        <Show when={chat().draft} fallback={<Thinking color={a().color} />}>
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
function Composer(props: { onLevel: () => void; k?: string; compact?: boolean }) {
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
        <button class="composer-chip" classList={{ on: isOpen("access", p().id), unapplied: unapplied() }} aria-haspopup="dialog" style={{ "--lc": level().color }} title={unapplied() ? tx("Nível de acesso: ainda não vale no Claude Code, clique para gravar") : tx("Nível de acesso: o que a IA pode fazer aqui (clique para mudar)")} onClick={props.onLevel}>
          <ShieldCheck size={13} /> <span>{level().short}</span>
        </button>
        <Show when={!demo() && !props.compact && a().provider === "claude"}>
          <ContextChip k={k()} />
        </Show>
        <span class="composer-gap" />
        <UsageRing id={a().id} />
        <Show when={!demo()}><MicButton target={k()} /></Show>
        <Show
          when={chat().busy}
          fallback={
            <button class="send-btn" disabled={!demo() && !chat().input.trim() && !attsOf(k()).length} title={tx("Enviar (Enter)")} onClick={send}>
              <ArrowUp size={16} stroke-width={2.4} />
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
  const follow = useFollow(() => scroller, () => [events().length, c().draft.length >> 6, c().perms.length, c().error], k, () => events()[events().length - 1]?.kind === "user");
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
      <div class="chat-scroll focus-scroll" ref={scroller} onScroll={follow}>
        <Show when={events().length > 0 || c().busy || c().error} fallback={<div class="focus-empty"><MessageSquarePlus size={18} /><span>{tx("Conversa nova: peça algo aqui embaixo.")}</span></div>}>
          <RealConversation events={events} tail k={k()} />
        </Show>
      </div>
      <Composer k={k()} compact onLevel={props.onLevel} />
    </section>
  );
}

export type Pane = "chat" | "ext" | "hist";
export type View = Pane | "act";
// o que aparece no lugar da conversa: ela mesma, sessões de fora ou o histórico. Fica fora do
// componente para a lista de conversas (modo IA, à esquerda) poder trocar.
const [pane, setPane] = createSignal<Pane>("chat");
export const chatPane = pane;
export function showChatPane(v: Pane) {
  if (panelAt() === "tab") setPanelAt("none");
  setChatTab("chat");
  setPane(v);
}

export default function ChatPanel(props: { slim?: boolean }) {
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
  const convos = () => view() === "hist";
  const setConvos = (v: boolean) => (v ? go("hist") : pane() === "hist" && setPane("chat"));
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
  // aba reaberta depois de fechar o app: a conversa dela está voltando (não é uma conversa nova)
  const waking = () => {
    const p = project();
    const t = tabsOf(p.id).find((x) => x.key === key());
    return real() && !!t?.session && !chatOf(key()).session && !chatOf(key()).conv && (!t.account || t.account === p.accountId);
  };
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

  // rola o chat junto com a atividade (se você não subiu para ler)
  const follow = useFollow(
    () => scroller,
    () => [shown().length, chatOf(key()).draft.length >> 6, chatOf(key()).perms.length, chatOf(key()).error],
    () => [key(), ext(), chatOf(key()).conv?.id, chatOf(key()).fork?.parent],
    () => shown()[shown().length - 1]?.kind === "user",
  );

  const work = () => ws.events.filter((e) => e.kind !== "user" && e.kind !== "done");
  const done = () => ws.events.find((e) => e.kind === "done");

  return (
    <aside class="chat-panel" style={{ "--c": account().color }}>
          <Show when={real()}>
            <ConvTabsBar pid={project().id} view={view()} onView={go} extCount={new Set(extEvents().map((e) => e.session)).size} slim={props.slim} />
          </Show>
          <Show when={convos() && real()}>
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
            <FocusGrid pid={project().id} onLevel={() => openAccess(project().id)} />
          </Show>
          <div class="chat-scroll" ref={scroller} onScroll={follow} data-target="chat" classList={{ hidden: (convos() && real()) || view() === "act" || focusOn() }}>
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
                <Show when={(seenAgent() && shown().length > 0) || (!ext() && (chatOf(key()).busy || chatOf(key()).error))} fallback={<Show when={!ext()} fallback={<div class="chat-empty ext-empty"><strong>{tx("Nada rodando por fora agora")}</strong><span>{tx("Abra o Claude nesta pasta pelo Terminal ou pelo editor e ele aparece aqui.")}</span></div>}><Show when={!waking()} fallback={<div class="chat-empty chat-waking"><Loader2 size={14} class="spin" /> {tx("Abrindo a conversa…")}</div>}><RealIdle onAccess={() => openAccess(project().id)} onConvos={() => setConvos(true)} /></Show></Show>}>
                  <RealConversation events={shown} tail={!ext()} />
                </Show>
              }
            >
              <Show when={ws.events.length === 0}>
                <div class="chat-empty">{ws.paused ? tx("Simulação parada: aperte Assistir (em cima do editor) para ver um agente de exemplo trabalhando.") : tx("O agente de exemplo vai começar em instantes…")}</div>
              </Show>
              <RealConversation events={() => ws.events} tail={false} />
              <Show when={!ws.paused && ws.running && ws.events.length > 0 && work().length === 0}><Thinking color={account().color} /></Show>
              <Show when={done()}>
                {(d) => (
                  <div class="bubble agent pop-in">
                    <strong>{d().title}.</strong> {tx("{detail}. Quer ver os dados reais do disco em Computador → Uso da máquina?", { detail: d().detail })}
                  </div>
                )}
              </Show>
            </Show>
          </div>
          <Show when={!focusOn() && (view() === "chat" || view() === "hist")} fallback={<Show when={ext()}><p class="ext-note">{tx("Sessões do Claude abertas fora do Veocode nesta pasta (Terminal, editor, app do Claude). Aqui é só para acompanhar: para conversar, use uma aba sua.")}</p></Show>}>
            <Composer onLevel={() => openAccess(project().id)} />
          </Show>
    </aside>
  );
}
