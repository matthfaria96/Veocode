import { dismissable } from "../dismiss";
import { AlertTriangle, ArrowLeftRight, Ban, Check, ChevronDown, Layers, Maximize2, MessageSquarePlus, Minimize2, MoreHorizontal, PanelRightOpen, Paperclip, Pin, GripVertical, GitBranch, Sparkles, ArrowUp, ShieldCheck, Square, X } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import { accountById } from "../accounts";
import { closePane, isPinned, maximized, panes, projectState, replacePane, setMaximized, swapPanes, togglePin } from "../board";
import { attsOf, dropPid, pasteFiles, pickFiles } from "../attachments";
import AttachBar from "./AttachBar";
import Thinking from "./Thinking";
import { activeKey, nameFromPrompt, tabsOf } from "../convTabs";
import { setFocusMode } from "../layoutMode";
import { MicButton } from "./Mic";
import { listeningTo, voiceKey } from "../voice";
import { MediaStrip, SentThumbs } from "./Media";
import { drag, dropOver, startDrag } from "../drag";
import { answerPermission, chatOf, clearError, newChat, sendChat, setInput, stopChat } from "../chat";
import { clearFeed, feedOf, type FeedItem } from "../feeds";
import { git, gitWords } from "../git";
import { projects, setProjectId, setView } from "../store";
import ActivityIcon, { kindColor } from "./ActivityIcon";
import { stepsSummary } from "../steps";
import { LimitHitCard, requestSwitch, UsageRing } from "./Limits";
import { limitHit } from "../limits";
import { ProjectIcon } from "./icons";
import Markdown from "./Markdown";
import { ProviderMark } from "./ui";
import MsgTools, { focusComposer } from "./MsgTools";
import { tx, txn } from "../i18n";

type Block = { kind: "msg"; item: FeedItem } | { kind: "steps"; items: FeedItem[] };

/** Junta os passos seguidos num cartão só, entre um pedido e uma resposta. */
function blocks(items: FeedItem[]): Block[] {
  const out: Block[] = [];
  for (const it of items) {
    if (it.kind === "step") {
      const last = out[out.length - 1];
      if (last?.kind === "steps") last.items.push(it);
      else out.push({ kind: "steps", items: [it] });
    } else out.push({ kind: "msg", item: it });
  }
  return out;
}

const STEP_KINDS = new Set(["think", "read", "search", "swarm", "edit", "create", "delete", "run", "tool", "done", "user", "say", "web", "plan"]);
const stepKind = (k?: string) => (k && STEP_KINDS.has(k) ? k : "tool") as keyof typeof kindColor;

/** Um canto da grade: a conversa de um projeto rolando ao vivo, com a caixa para pedir. */
export default function ChatPane(props: { pid: string; index: number; span?: number }) {
  const p = () => projects.find((x) => x.id === props.pid)!;
  // conversa da frente deste projeto (a mesma aba aberta na tela Projetos)
  const ck = () => activeKey(props.pid);
  const a = () => accountById(p().accountId);
  const chat = () => chatOf(ck());
  const feed = () => feedOf(props.pid);
  const st = () => projectState(props.pid);
  const g = () => git.summaries[props.pid];
  const list = createMemo(() => blocks(feed().items.slice(-120)));
  const [pick, setPick] = createSignal(false);
  const [more, setMore] = createSignal(false);
  let scroller!: HTMLDivElement;
  let titleBtn!: HTMLButtonElement;
  let moreBtn!: HTMLButtonElement;
  let stick = true;

  // fica colado no fim enquanto a conversa rola, a não ser que a pessoa tenha subido para ler
  const onScroll = () => {
    stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 60;
  };
  createEffect(on(() => [feed().items.length, chat().draft.length, chat().perms.length, chat().busy], () => {
    if (stick) requestAnimationFrame(() => scroller && (scroller.scrollTop = scroller.scrollHeight));
  }));

  const openFull = () => {
    setProjectId(props.pid);
    setView("workspace");
  };
  const send = () => (nameFromPrompt(ck(), chat().input), void sendChat(ck()));
  const others = () => projects.filter((x) => !x.demo && x.id !== props.pid);
  // resumo das outras conversas (abas) do projeto: esta janela mostra a principal
  const convs = () => tabsOf(props.pid);
  const working = () => convs().filter((t) => chatOf(t.key).busy).length;
  const asking = () => convs().some((t) => t.key !== ck() && chatOf(t.key).perms.length > 0);
  const convTip = () =>
    [...convs().map((t) => `${t.key === ck() ? "▸ " : "· "}${tx(t.title)}${chatOf(t.key).perms.length ? tx(" · esperando você") : chatOf(t.key).busy ? tx(" · trabalhando") : ""}`), "", tx("Clique para ver todas lado a lado (modo foco)")].join("\n");
  const openFocus = () => {
    setProjectId(props.pid);
    setFocusMode(true);
    setView("workspace");
  };

  return (
    <section
      class="pane"
      data-drop-pane={props.pid}
      classList={{ ask: st().tone === "ask", work: st().tone === "work", max: maximized() === props.pid, "drop-on": dropOver() === props.pid, lifted: drag()?.kind === "pane" && drag()?.id === props.pid }}
      style={{ "--c": a().color, "grid-column": props.span ? `span ${props.span}` : undefined }}
    >
      <Show when={dropOver() === props.pid}>
        <div class="pane-drop-hint">{drag()?.kind === "pane" ? tx("Trocar de lugar") : tx("Pôr {label} aqui", { label: drag()?.label })}</div>
      </Show>
      <header
        class="pane-head"
        onPointerDown={(e) => {
          if ((e.target as Element).closest("button:not(.pane-title), input, textarea, .menu")) return;
          startDrag(e, props.pid, "pane", p().name, (target) => swapPanes(props.pid, target));
        }}
      >
        <span class="pane-grip" title={tx("Arraste para trocar de lugar")}><GripVertical size={13} /></span>
        <button class="pane-title" ref={titleBtn} onClick={() => setPick(!pick())} title={tx("Trocar o projeto deste canto")}>
          <ProjectIcon id={p().id} name={p().name} stack={p().stack} size={18} />
          <strong>{p().name}</strong>
          <ChevronDown size={12} />
        </button>
        <span class={`pane-state ${st().tone}`} title={st().label}><i />{st().label}</span>
        <Show when={convs().length > 1}>
          <button class="pane-convs" classList={{ work: working() > 0, ask: asking() }} title={convTip()} onClick={openFocus}>
            <Layers size={11} />
            <span class="pc-full">{txn(convs().length, "{n} conversa", "{n} conversas")}</span>
            <b class="pc-short">{convs().length}</b>
            <Show when={working() > 0}><span class="pc-work"> · {tx("{n} trabalhando", { n: working() })}</span></Show>
          </button>
        </Show>
        <Show when={g()?.repo && (g()!.ahead || g()!.behind || g()!.changed)}>
          <span class="pane-git" title={gitWords(g()).map((w) => w.text).join(" · ")}>
            <Show when={g()!.ahead}><b class="warn">↑{g()!.ahead}</b></Show>
            <Show when={g()!.behind}><b class="info">↓{g()!.behind}</b></Show>
            <Show when={g()!.changed}><b>●{g()!.changed}</b></Show>
          </span>
        </Show>
        <span class="pane-tools">
          <span class="pane-acc" title={tx("Conta: {label}", { label: a().label })}><ProviderMark id={a().id} size={16} /></span>
          <Show when={isPinned(props.pid)}><span class="pane-pinned" title={tx("Fixado neste lugar")}><Pin size={11} /></span></Show>
          <Show when={panes().length > 1}>
            <button class="icon-btn small" title={maximized() === props.pid ? tx("Voltar para a divisão (Esc)") : tx("Ampliar na tela toda (os outros continuam rodando)")} onClick={() => setMaximized(maximized() === props.pid ? null : props.pid)}>
              {maximized() === props.pid ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            </button>
          </Show>
          <button class="icon-btn small" title={tx("Abrir o projeto completo (arquivos, editor, terminal)")} onClick={openFull}><PanelRightOpen size={12} /></button>
          <button class="icon-btn small" ref={moreBtn} classList={{ on: more() }} title={tx("Mais opções")} onClick={() => setMore(!more())}><MoreHorizontal size={13} /></button>
          <button class="icon-btn small pane-close" title={tx("Tirar da tela (o projeto continua na lista e trabalhando)")} onClick={() => closePane(props.pid)}><X size={13} /></button>
        </span>
        <Show when={more()}>
          <div class="menu pop-in pane-menu right" ref={(el) => dismissable(el, () => setMore(false), () => moreBtn)}>
            <button class="menu-item" disabled={chat().busy} onClick={() => (setMore(false), void newChat(ck()).then(() => clearFeed(props.pid)))}><MessageSquarePlus size={15} /><span>{tx("Nova conversa")}</span><small>{tx("a anterior fica guardada")}</small></button>
            <button class="menu-item" onClick={() => (setMore(false), togglePin(props.pid))}><Pin size={15} /><span>{isPinned(props.pid) ? tx("Soltar deste lugar") : tx("Fixar neste lugar")}</span><small>{isPinned(props.pid) ? tx("pode dar lugar a outro") : tx("não sai sozinho")}</small></button>
            <button class="menu-item" onClick={() => (setMore(false), setPick(true))}><ArrowLeftRight size={15} /><span>{tx("Trocar o projeto deste canto")}</span></button>
            <div class="menu-sep" />
            <button class="menu-item" onClick={() => (setMore(false), closePane(props.pid))}><X size={15} /><span>{tx("Tirar da tela")}</span></button>
          </div>
        </Show>
        <Show when={pick()}>
          <div class="menu pop-in pane-menu" ref={(el) => dismissable(el, () => setPick(false), () => titleBtn)}>
            <small class="menu-title">{tx("Mostrar neste canto")}</small>
            <For each={others()} fallback={<small class="menu-title">{tx("Nenhum outro projeto")}</small>}>
              {(o) => (
                <button class="menu-item" onClick={() => (replacePane(props.pid, o.id), setPick(false))}>
                  <ProjectIcon id={o.id} name={o.name} stack={o.stack} size={16} />
                  <span>{o.name}</span>
                  <Show when={panes().includes(o.id)}><small>{tx("troca de lugar")}</small></Show>
                </button>
              )}
            </For>
          </div>
        </Show>
      </header>

      <div class="pane-scroll" ref={scroller} onScroll={onScroll}>
        <Show when={feed().loaded || feed().items.length} fallback={<div class="pane-empty"><span class="spinner" /> {tx("Lendo a conversa…")}</div>}>
          <Show when={list().length || chat().busy} fallback={<PaneIdle pid={props.pid} />}>
            <For each={list()}>
              {(b) =>
                b.kind === "steps" ? (
                  <Steps items={b.items} />
                ) : b.item.kind === "user" ? (
                  <div class="bubble user">{b.item.title}<SentThumbs text={b.item.title} /><MsgTools text={b.item.title} onReuse={() => (setInput(ck(), b.item.title), focusComposer(scroller.closest(".pane")))} /></div>
                ) : b.item.kind === "say" ? (
                  limitHit(b.item.title) ? (
                    <LimitHitCard accountId={p().accountId} win={limitHit(b.item.title)!.win} raw={b.item.title} onPick={(id) => requestSwitch(props.pid, id)} />
                  ) : (
                    <div class="bubble agent say" style={{ "--c": a().color }}><Markdown text={b.item.title} /><MsgTools text={b.item.title} /></div>
                  )
                ) : b.item.kind === "error" ? (
                  <div class="pane-done err"><AlertTriangle size={11} /> {b.item.title}</div>
                ) : (
                  <div class="pane-done" classList={{ err: b.item.status === "error" }}>
                    <Check size={11} /> {b.item.title}{b.item.detail ? ` · ${b.item.detail}` : ""}
                  </div>
                )
              }
            </For>
          </Show>
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
                  <button class="ghost-btn" disabled={q.answering} onClick={() => answerPermission(ck(), q.requestId, false)}><Ban size={13} /> {tx("Recusar")}</button>
                  <button class="primary-btn small" disabled={q.answering} onClick={() => answerPermission(ck(), q.requestId, true)}><Check size={13} /> {tx("Permitir")}</button>
                </div>
              </div>
            )}
          </For>
          <Show when={chat().error}>
            <div class="bubble chat-error">
              <AlertTriangle size={14} />
              <span>{chat().error}</span>
              <button class="icon-btn small" title={tx("Fechar")} onClick={() => clearError(ck())}><X size={12} /></button>
            </div>
          </Show>
        </Show>
      </div>

      <MediaStrip pid={props.pid} compact />
      <div class="pane-composer" classList={{ dropping: dropPid() === ck(), "has-atts": attsOf(ck()).length > 0, listening: listeningTo(ck()) }} data-attach-pid={ck()}>
        <AttachBar pid={ck()} />
        <button class="icon-btn pane-clip" classList={{ on: attsOf(ck()).length > 0 }} title={tx("Anexar arquivos ou imagens (ou cole com ⌘V, ou arraste do Finder)")} onClick={() => void pickFiles(ck())}><Paperclip size={14} /></button>
        <textarea
          rows={1}
          value={chat().input}
          readOnly={listeningTo(ck())}
          placeholder={listeningTo(ck()) ? tx("Pode falar… (Enter para, Esc cancela)") : tx("Pedir algo em {name}… (⌥ Espaço para falar)", { name: p().name })}
          onPaste={(e) => void pasteFiles(ck(), e)}
          onInput={(e) => setInput(ck(), e.currentTarget.value)}
          onKeyDown={(e) => {
            if (voiceKey(ck(), e)) return;
            if (e.key === "Escape" && chat().busy) return (e.preventDefault(), void stopChat(ck()));
            if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
              e.preventDefault();
              if (!chat().busy) send();
            }
          }}
        />
        <UsageRing id={p().accountId} small />
        <MicButton target={ck()} compact />
        <Show
          when={chat().busy}
          fallback={<button class="send-btn" disabled={!chat().input.trim() && !attsOf(ck()).length} title={tx("Enviar (Enter)")} onClick={send}><ArrowUp size={15} stroke-width={2.4} /></button>}
        >
          <button class="send-btn stop" title={tx("Parar (Esc)")} onClick={() => void stopChat(ck())}><Square size={12} /></button>
        </Show>
      </div>
    </section>
  );
}

function Steps(props: { items: FeedItem[] }) {
  // fechado numa linha só, como na conversa; enquanto trabalha mostra o passo atual
  const [open, setOpen] = createSignal(false);
  const running = () => props.items.find((s) => s.status === "running");
  const failed = () => props.items.filter((s) => s.status === "error").length;
  return (
    <div class="pane-steps" classList={{ open: open() }}>
      <button class="work-sum" aria-expanded={open()} onClick={() => setOpen(!open())}>
        <Show when={running()} fallback={<span class="work-sum-text">{stepsSummary(props.items.map((s) => stepKind(s.step)))}</span>}>
          {(r) => (
            <>
              <span class="spinner" />
              <span class="work-sum-text now">{r().title}</span>
            </>
          )}
        </Show>
        <Show when={failed() > 0}><small class="work-sum-fail">{tx("{failed} falhou", { failed: failed() })}</small></Show>
        <ChevronDown size={12} class="work-chev" />
      </button>
      <Show when={open()}>
        <div class="pane-steps-list slide-in">
          <For each={props.items}>
            {(s) => (
              <div class="pane-step" classList={{ running: s.status === "running", err: s.status === "error" }} title={s.detail ?? s.title}>
                <span class="pane-step-icon" style={{ color: kindColor[stepKind(s.step)] }}><ActivityIcon kind={stepKind(s.step)} size={12} /></span>
                <span class="pane-step-title">{s.sub ? <em>{s.sub}: </em> : null}{s.title}</span>
                <Show when={s.status === "running"}><span class="spinner" /></Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

/** Painel sem conversa recente: em vez de um vazio, o projeto e ideias para começar. */
function PaneIdle(props: { pid: string }) {
  const p = () => projects.find((x) => x.id === props.pid)!;
  const a = () => accountById(p().accountId);
  const g = () => git.summaries[props.pid];
  const ideas = () => [
    g()?.changed ? tx("Revise as mudanças que ainda não foram salvas no git e me diga se algo parece errado") : tx("Me explique como este projeto está organizado"),
    tx("Procure bugs ou pontos frágeis no código e liste os mais importantes"),
    tx("Rode os testes (ou o build) e me diga o que falhou"),
  ];
  return (
    <div class="pane-idle">
      <div class="pane-idle-mark"><ProjectIcon id={p().id} name={p().name} stack={p().stack} size={40} /></div>
      <strong>{p().name}</strong>
      <small>
        {p().stack || tx("Projeto")}
        <Show when={g()?.repo}> · <GitBranch size={11} /> {g()!.branch ?? "git"}</Show>
        <Show when={gitWords(g()).length}> · {gitWords(g()).map((w) => w.text).join(" · ")}</Show>
      </small>
      <p>{tx("Nenhuma conversa nas últimas 24 h. Que tal começar por uma destas?")}</p>
      <div class="pane-ideas">
        <For each={ideas()}>
          {(t, i) => (
            <button style={{ "--i": i(), "--c": a().color }} onClick={() => (setInput(activeKey(props.pid), t), focusComposer(document.querySelector(`[data-drop-pane="${props.pid}"]`)))}>
              <Sparkles size={12} /> {t}
            </button>
          )}
        </For>
      </div>
    </div>
  );
}
