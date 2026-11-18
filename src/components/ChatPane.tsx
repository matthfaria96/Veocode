import { dismissable } from "../dismiss";
import { AlertTriangle, ArrowLeft, ArrowRight, Ban, Check, ChevronDown, Maximize2, MessageSquarePlus, Minimize2, PanelRightOpen, Pin, SendHorizontal, ShieldCheck, Square, X } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import { accountById } from "../accounts";
import { isPinned, maximized, movePane, panes, projectState, replacePane, setMaximized, togglePin } from "../board";
import { answerPermission, chatOf, clearError, newChat, sendChat, setInput, stopChat } from "../chat";
import { clearFeed, feedOf, type FeedItem } from "../feeds";
import { git, gitWords } from "../git";
import { projects, setProjectId, setView } from "../store";
import ActivityIcon, { kindColor } from "./ActivityIcon";
import { ProjectIcon } from "./icons";
import Markdown from "./Markdown";
import { ProviderMark } from "./ui";
import MsgTools, { focusComposer } from "./MsgTools";

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
export default function ChatPane(props: { pid: string; index: number }) {
  const p = () => projects.find((x) => x.id === props.pid)!;
  const a = () => accountById(p().accountId);
  const chat = () => chatOf(props.pid);
  const feed = () => feedOf(props.pid);
  const st = () => projectState(props.pid);
  const g = () => git.summaries[props.pid];
  const list = createMemo(() => blocks(feed().items.slice(-120)));
  const [pick, setPick] = createSignal(false);
  let scroller!: HTMLDivElement;
  let titleBtn!: HTMLButtonElement;
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
  const send = () => void sendChat(props.pid);
  const others = () => projects.filter((x) => !x.demo && x.id !== props.pid);

  return (
    <section class="pane" classList={{ ask: st().tone === "ask", work: st().tone === "work", max: maximized() === props.pid }} style={{ "--c": a().color }}>
      <header class="pane-head">
        <button class="pane-title" ref={titleBtn} onClick={() => setPick(!pick())} title="Trocar o projeto deste canto">
          <ProjectIcon id={p().id} name={p().name} stack={p().stack} size={18} />
          <strong>{p().name}</strong>
          <ChevronDown size={12} />
        </button>
        <span class={`pane-state ${st().tone}`}><i />{st().label}</span>
        <Show when={g()?.repo && (g()!.ahead || g()!.behind || g()!.changed)}>
          <span class="pane-git" title={gitWords(g()).map((w) => w.text).join(" · ")}>
            <Show when={g()!.ahead}><b class="warn">↑{g()!.ahead}</b></Show>
            <Show when={g()!.behind}><b class="info">↓{g()!.behind}</b></Show>
            <Show when={g()!.changed}><b>●{g()!.changed}</b></Show>
          </span>
        </Show>
        <span class="pane-tools">
          <span class="pane-acc" title={`Conta: ${a().label}`}><ProviderMark id={a().id} size={16} /></span>
          <Show when={panes().length > 1 && !maximized()}>
            <button class="icon-btn small" title="Trocar de lugar com o anterior" disabled={props.index === 0} onClick={() => movePane(props.pid, -1)}><ArrowLeft size={12} /></button>
            <button class="icon-btn small" title="Trocar de lugar com o próximo" disabled={props.index === panes().length - 1} onClick={() => movePane(props.pid, 1)}><ArrowRight size={12} /></button>
          </Show>
          <Show when={panes().length > 1}>
            <button class="icon-btn small" title={maximized() === props.pid ? "Voltar para a divisão" : "Pôr em destaque na tela toda (os outros continuam rodando; Esc volta)"} onClick={() => setMaximized(maximized() === props.pid ? null : props.pid)}>
              {maximized() === props.pid ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            </button>
          </Show>
          <button class="icon-btn small" title="Nova conversa (a anterior fica guardada no projeto)" disabled={chat().busy} onClick={() => void newChat(props.pid).then(() => clearFeed(props.pid))}><MessageSquarePlus size={12} /></button>
          <button class="icon-btn small" title="Abrir o projeto completo (árvore, editor, terminal)" onClick={openFull}><PanelRightOpen size={12} /></button>
          <button class="icon-btn small pane-pin" classList={{ on: isPinned(props.pid) }} title={isPinned(props.pid) ? "Fixado: fica sempre na tela, neste lugar. Clique para soltar" : "Fixar na tela (sem fixar, um projeto parado dá lugar a quem pedir você)"} onClick={() => togglePin(props.pid)}><Pin size={12} /></button>
        </span>
        <Show when={pick()}>
          <div class="menu pop-in pane-menu" ref={(el) => dismissable(el, () => setPick(false), () => titleBtn)}>
            <small class="menu-title">Mostrar neste canto</small>
            <For each={others()} fallback={<small class="menu-title">Nenhum outro projeto</small>}>
              {(o) => (
                <button class="menu-item" onClick={() => (replacePane(props.pid, o.id), setPick(false))}>
                  <ProjectIcon id={o.id} name={o.name} stack={o.stack} size={16} />
                  <span>{o.name}</span>
                  <Show when={panes().includes(o.id)}><small>troca de lugar</small></Show>
                </button>
              )}
            </For>
          </div>
        </Show>
      </header>

      <div class="pane-scroll" ref={scroller} onScroll={onScroll}>
        <Show when={feed().loaded || feed().items.length} fallback={<div class="pane-empty"><span class="spinner" /> Lendo a conversa…</div>}>
          <Show when={list().length || chat().busy} fallback={<div class="pane-empty">Nenhuma conversa nas últimas 24 h. Peça algo abaixo para {a().label} trabalhar em {p().name}.</div>}>
            <For each={list()}>
              {(b) =>
                b.kind === "steps" ? (
                  <Steps items={b.items} />
                ) : b.item.kind === "user" ? (
                  <div class="bubble user">{b.item.title}<MsgTools text={b.item.title} onReuse={() => (setInput(props.pid, b.item.title), focusComposer(scroller.closest(".pane")))} /></div>
                ) : b.item.kind === "say" ? (
                  <div class="bubble agent say" style={{ "--c": a().color }}><Markdown text={b.item.title} /><MsgTools text={b.item.title} /></div>
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
            <Show when={chat().draft} fallback={<div class="typing" style={{ "--c": a().color }}><span /><span /><span /></div>}>
              <div class="bubble agent say streaming" style={{ "--c": a().color }}>{chat().draft.replace(/\*\*/g, "")}</div>
            </Show>
          </Show>
          <For each={chat().perms}>
            {(q) => (
              <div class="perm-ask pop-in" style={{ "--c": a().color }}>
                <div class="perm-ask-head">
                  <ShieldCheck size={14} />
                  <span>O nível pede para confirmar</span>
                  <small>{q.tool}</small>
                </div>
                <strong>{q.title}</strong>
                <Show when={q.detail}><pre>{q.detail}</pre></Show>
                <div class="perm-ask-actions">
                  <button class="ghost-btn" disabled={q.answering} onClick={() => answerPermission(props.pid, q.requestId, false)}><Ban size={13} /> Recusar</button>
                  <button class="primary-btn small" disabled={q.answering} onClick={() => answerPermission(props.pid, q.requestId, true)}><Check size={13} /> Permitir</button>
                </div>
              </div>
            )}
          </For>
          <Show when={chat().error}>
            <div class="bubble chat-error">
              <AlertTriangle size={14} />
              <span>{chat().error}</span>
              <button class="icon-btn small" title="Fechar" onClick={() => clearError(props.pid)}><X size={12} /></button>
            </div>
          </Show>
        </Show>
      </div>

      <div class="pane-composer">
        <textarea
          rows={1}
          value={chat().input}
          placeholder={`Pedir algo em ${p().name}…`}
          onInput={(e) => setInput(props.pid, e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
              e.preventDefault();
              if (!chat().busy) send();
            }
          }}
        />
        <Show
          when={chat().busy}
          fallback={<button class="send-btn" disabled={!chat().input.trim()} title="Enviar (Enter)" onClick={send}><SendHorizontal size={14} /></button>}
        >
          <button class="send-btn stop" title="Parar a resposta" onClick={() => void stopChat(props.pid)}><Square size={12} /></button>
        </Show>
      </div>
    </section>
  );
}

function Steps(props: { items: FeedItem[] }) {
  const [open, setOpen] = createSignal(false);
  const shown = () => (open() ? props.items : props.items.slice(-4));
  return (
    <div class="pane-steps">
      <Show when={props.items.length > 4}>
        <button class="pane-steps-more" onClick={() => setOpen(!open())}>{open() ? "Mostrar só os últimos" : `${props.items.length} passos · ver todos`}</button>
      </Show>
      <For each={shown()}>
        {(s) => (
          <div class="pane-step" classList={{ running: s.status === "running", err: s.status === "error" }} title={s.detail ?? s.title}>
            <span class="pane-step-icon" style={{ color: kindColor[stepKind(s.step)] }}><ActivityIcon kind={stepKind(s.step)} size={12} /></span>
            <span class="pane-step-title">{s.sub ? <em>{s.sub}: </em> : null}{s.title}</span>
            <Show when={s.status === "running"}><span class="spinner" /></Show>
          </div>
        )}
      </For>
    </div>
  );
}
