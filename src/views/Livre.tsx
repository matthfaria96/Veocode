import { dismissable } from "../dismiss";
import { AlertTriangle, ArrowLeft, Ban, Check, ChevronDown, Eye, History, HardDrive, Lock, MessageSquarePlus, MessagesSquare, SendHorizontal, ShieldCheck, Sparkles, Square, X } from "lucide-solid";
import { createEffect, createResource, createSignal, For, Match, on, onCleanup, onMount, Show, Switch } from "solid-js";
import { accountById, accountSub, accts, fmtAgo } from "../accounts";
import type { ActivityEvent } from "../store";
import { isTauri } from "../api";
import { settings } from "../settings";
import { answerLivre, freeAccount, freeAccountId, listLivre, livre, newLivre, openLivre, sendLivre, setFreeAccount, setFreePc, setLivre, stopLivre, type Item } from "../livre";
import type { Convo } from "../chat";
import ActivityIcon, { kindColor } from "../components/ActivityIcon";
import Markdown from "../components/Markdown";
import { ProviderMark } from "../components/ui";

const ideas = {
  conversa: [
    "Explique o que é uma API REST como se eu nunca tivesse programado",
    "Me ajude a escrever um e-mail pedindo um prazo maior",
    "Qual a diferença entre RAM e armazenamento?",
    "Monte um plano de estudos de 4 semanas para aprender Git",
  ],
  pc: [
    "O que tem na minha pasta Downloads?",
    "Ache os PDFs que eu baixei esta semana",
    "Resuma o arquivo de texto mais recente da Área de Trabalho",
    "Quais projetos de código eu tenho em Documents?",
  ],
};

/** Escolha da conta (Claude, DeepSeek, OpenAI-compatível, Ollama). */
function AccountPicker() {
  const [open, setOpen] = createSignal(false);
  const close = (e: MouseEvent) => !(e.target as HTMLElement).closest(".livre-picker") && setOpen(false);
  onMount(() => document.addEventListener("mousedown", close));
  onCleanup(() => document.removeEventListener("mousedown", close));
  const a = freeAccount;
  return (
    <div class="livre-picker inv-picker">
      <button class="inv-select" disabled={livre.busy} title={livre.busy ? "Espere a resposta terminar para trocar" : "Trocar a conta"} onClick={() => setOpen(!open())}>
        <ProviderMark id={a().id} size={16} />
        <span>{a().label}</span>
        <ChevronDown size={12} />
      </button>
      <Show when={open()}>
        <div class="inv-menu" ref={(el) => dismissable(el, () => setOpen(false))}>
          <For each={accts.list} fallback={<small class="inv-menu-empty">Nenhuma conta ainda: adicione em Contas e IAs</small>}>
            {(x) => (
              <button
                classList={{ on: x.id === freeAccountId() }}
                onClick={() => {
                  setFreeAccount(x.id);
                  setOpen(false);
                }}
              >
                <ProviderMark id={x.id} size={16} /> {x.label}
                <small>{accountSub(x)}</small>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

/** "Só conversa" ou "Olhar o computador" (só leitura). */
function ModeSwitch() {
  return (
    <div class="livre-mode" role="radiogroup" aria-label="O que o chat pode fazer" classList={{ pc: settings.freePc }}>
      <span class="livre-mode-thumb" />
      <button role="radio" aria-checked={!settings.freePc} disabled={livre.busy} onClick={() => setFreePc(false)} title="Só conversa: a IA não vê nenhum arquivo">
        <MessagesSquare size={13} /> Só conversa
      </button>
      <button role="radio" aria-checked={settings.freePc} disabled={livre.busy} onClick={() => setFreePc(true)} title="A IA pode listar, ler e buscar arquivos da sua pasta pessoal. Não edita nada.">
        <Eye size={13} /> Olhar o computador
      </button>
    </div>
  );
}

function Empty() {
  const list = () => (settings.freePc ? ideas.pc : ideas.conversa);
  return (
    <div class="livre-empty">
      <div class="livre-orbit" aria-hidden="true">
        <span class="livre-orbit-ring" />
        <span class="livre-orbit-core" style={{ "--c": freeAccount().color }}>
          <Show when={settings.freePc} fallback={<MessagesSquare size={26} />}>
            <HardDrive size={26} />
          </Show>
        </span>
        <span class="livre-bubble b1" />
        <span class="livre-bubble b2" />
        <span class="livre-bubble b3" />
      </div>
      <h2>{settings.freePc ? "Pergunte sobre o seu computador" : "Pergunte o que quiser"}</h2>
      <p>
        <Show
          when={settings.freePc}
          fallback={<>Uma conversa fora de qualquer projeto, com {freeAccount().label}. Bom para tirar dúvidas, escrever textos e pensar junto. A IA não vê nenhum arquivo seu.</>}
        >
          {freeAccount().label} pode listar, ler e buscar arquivos na sua pasta pessoal para responder. <b>Não edita, não apaga e não roda comandos</b>, e pastas de senhas e chaves (.ssh, .aws, chaveiro) ficam de fora.
        </Show>
      </p>
      <div class="livre-ideas">
        <For each={list()}>
          {(t, i) => (
            <button class="livre-idea pop-in" style={{ "animation-delay": `${80 + i() * 60}ms` }} onClick={() => sendLivre(t)}>
              <Sparkles size={13} />
              <span>{t}</span>
            </button>
          )}
        </For>
      </div>
    </div>
  );
}

function Steps(props: { steps: Item & { t: "work" } }) {
  const steps = () => props.steps.steps;
  const running = () => steps().some((x) => x.status === "running");
  const shown = () => steps().slice(-8);
  return (
    <div class="work-card livre-work pop-in">
      <div class="work-head">
        <span class="work-dot" classList={{ live: running() }} />
        {running() ? "Olhando…" : "Passos"}
        <small>{steps().length} {steps().length === 1 ? "passo" : "passos"}</small>
      </div>
      <Show when={steps().length > 8}><div class="work-more">+{steps().length - 8} antes</div></Show>
      <For each={shown()}>
        {(x) => (
          <div class="work-row slide-in" classList={{ running: x.status === "running", error: x.status === "error" }} title={x.detail ?? x.title}>
            <span class="work-icon" style={{ color: kindColor[x.kind as ActivityEvent["kind"]] }}>
              <ActivityIcon kind={x.kind as ActivityEvent["kind"]} />
            </span>
            <span class="work-title">{x.title}</span>
            <Show when={x.status === "running"} fallback={<small class="work-detail">{x.status === "error" ? x.detail ?? "falhou" : x.detail}</small>}>
              <span class="spinner" />
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}

function Message(props: { item: Item }) {
  return (
    <Switch>
      <Match when={props.item.t === "user" && props.item}>{(it) => <div class="livre-msg user pop-in">{it().text}</div>}</Match>
      <Match when={props.item.t === "say" && props.item}>
        {(it) => (
          <div class="livre-msg agent pop-in" style={{ "--c": accountById(it().account).color }}>
            <ProviderMark id={it().account} size={22} />
            <div class="livre-say"><Markdown text={it().text} /></div>
          </div>
        )}
      </Match>
      <Match when={props.item.t === "work" && (props.item as Item & { t: "work" })}>{(it) => <Steps steps={it()} />}</Match>
      <Match when={props.item.t === "done" && props.item}>
        {(it) => (
          <div class="done-line pop-in" classList={{ stopped: !it().ok }}>
            <span>{it().ok ? "✓" : "■"}</span> {accountById(it().account).label} {it().ok ? "respondeu" : "parou"}
            <Show when={it().detail}> · {it().detail}</Show>
          </div>
        )}
      </Match>
      <Match when={props.item.t === "note" && props.item}>{(it) => <div class="livre-note pop-in">{it().text}</div>}</Match>
    </Switch>
  );
}

/** Conversas anteriores do Chat livre, de todas as contas. */
function Conversations(props: { onClose: () => void }) {
  const [data, { refetch }] = createResource(() => listLivre().catch(() => ({ items: [] as Convo[], current: null })));
  const [opening, setOpening] = createSignal<string | null>(null);
  const ago = (ms: number) => fmtAgo(Math.max(0, (Date.now() - ms) / 1000));
  const open = async (c: Convo) => {
    setOpening(`${c.kind}:${c.id}`);
    await openLivre(c);
    setOpening(null);
    props.onClose();
  };
  return (
    <div class="livre-convos pop-in">
      <div class="convos-head">
        <button class="icon-btn small" title="Voltar" onClick={props.onClose}><ArrowLeft size={14} /></button>
        <strong>Conversas do Chat livre</strong>
        <button class="convos-refresh inline" onClick={() => refetch()}>Atualizar</button>
      </div>
      <Show when={!data.loading} fallback={<div class="convos-empty"><span class="spinner" /> Lendo os históricos…</div>}>
        <Show when={data()?.items.length} fallback={<div class="convos-empty">{isTauri ? "Nenhuma conversa guardada ainda. Cada conversa aqui fica salva para você voltar nela depois." : "No navegador as conversas não ficam guardadas: abra o app."}</div>}>
          <For each={data()!.items}>
            {(c, i) => {
              const a = () => accountById(c.account);
              const key = `${c.kind}:${c.id}`;
              const exists = () => accts.list.some((x) => x.id === c.account);
              return (
                <button
                  class="convo slide-in"
                  classList={{ current: data()?.current === key, locked: !exists(), opening: opening() === key }}
                  style={{ "--c": a().color, "animation-delay": `${Math.min(i(), 12) * 30}ms` }}
                  disabled={!!opening() || !exists() || livre.busy}
                  title={exists() ? (c.account === freeAccountId() ? "Continuar esta conversa" : `Continuar (troca para a conta ${a().label})`) : "A conta desta conversa não existe mais"}
                  onClick={() => open(c)}
                >
                  <span class="convo-bar" />
                  <span class="convo-main">
                    <span class="convo-title">{c.title}</span>
                    <Show when={c.lastPrompt}><span class="convo-last">↳ {c.lastPrompt}</span></Show>
                    <span class="convo-meta">
                      <ProviderMark id={c.account} size={14} />
                      <span>{a().label}</span>
                      <span>· {ago(c.updated)}</span>
                    </span>
                  </span>
                  <Show when={opening() === key} fallback={<Show when={data()?.current === key} fallback={<Show when={!exists()}><Lock size={12} class="convo-lock" /></Show>}><span class="convo-badge">aberta</span></Show>}>
                    <span class="spinner" />
                  </Show>
                </button>
              );
            }}
          </For>
        </Show>
      </Show>
    </div>
  );
}

export default function Livre() {
  const [convos, setConvos] = createSignal(false);
  let scroller!: HTMLDivElement;
  let box!: HTMLTextAreaElement;
  let stick = true;

  const fit = () => {
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, 180)}px`;
  };
  const send = () => {
    stick = true;
    sendLivre();
    requestAnimationFrame(fit);
  };
  // desce junto com a resposta, a não ser que a pessoa tenha subido para ler
  createEffect(on(() => [livre.items.length, livre.draft.length, livre.perms.length, livre.error], () => {
    if (stick) requestAnimationFrame(() => scroller && (scroller.scrollTop = scroller.scrollHeight));
  }));
  onMount(() => box.focus());

  const a = freeAccount;
  return (
    <div class="livre">
      <header class="livre-head">
        <div class="livre-name">
          <span class="livre-logo"><MessagesSquare size={17} /></span>
          <div>
            <strong>Chat livre</strong>
            <small title={livre.conv?.title}>{livre.conv ? `Conversa retomada: ${livre.conv.title}` : "Conversa sem projeto, para tirar dúvidas"}</small>
          </div>
        </div>
        <div class="livre-tools">
          <AccountPicker />
          <ModeSwitch />
          <button class="icon-btn" title="Conversas anteriores" classList={{ active: convos() }} onClick={() => setConvos(!convos())}><History size={15} /></button>
          <button class="icon-btn" title="Nova conversa" disabled={livre.busy || (!livre.items.length && !livre.conv)} onClick={() => newLivre()}><MessageSquarePlus size={15} /></button>
        </div>
      </header>

      <Show when={convos()}>
        <Conversations onClose={() => setConvos(false)} />
      </Show>

      <div class="livre-scroll" ref={scroller} onScroll={() => (stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80)}>
        <div class="livre-col">
          <Show when={livre.items.length} fallback={<Empty />}>
            <For each={livre.items}>{(it) => <Message item={it} />}</For>
          </Show>
          <Show when={livre.busy && !livre.perms.length}>
            <Show when={livre.draft} fallback={<div class="typing pop-in" style={{ "--c": a().color }}><span /><span /><span /></div>}>
              <div class="livre-msg agent streaming" style={{ "--c": a().color }}>
                <ProviderMark id={a().id} size={22} />
                <div class="livre-say"><Markdown text={livre.draft} /></div>
              </div>
            </Show>
          </Show>
          <For each={livre.perms}>
            {(q) => (
              <div class="perm-ask pop-in" style={{ "--c": a().color }}>
                <div class="perm-ask-head">
                  <ShieldCheck size={14} />
                  <span>Precisa da sua aprovação</span>
                  <small>{q.tool}</small>
                </div>
                <strong>{q.title}</strong>
                <Show when={q.detail}><pre>{q.detail}</pre></Show>
                <div class="perm-ask-actions">
                  <button class="ghost-btn" disabled={q.answering} onClick={() => answerLivre(q.requestId, false)}><Ban size={13} /> Recusar</button>
                  <button class="primary-btn small" disabled={q.answering} onClick={() => answerLivre(q.requestId, true)}><Check size={13} /> Permitir</button>
                </div>
              </div>
            )}
          </For>
          <Show when={livre.error}>
            <div class="bubble chat-error pop-in">
              <AlertTriangle size={14} />
              <span>{livre.error}</span>
              <button class="icon-btn small" title="Fechar" onClick={() => setLivre("error", null)}><X size={12} /></button>
            </div>
          </Show>
        </div>
      </div>

      <div class="livre-bottom">
        <div class="livre-col">
          <div class="composer livre-composer" classList={{ busy: livre.busy }} style={{ "--c": a().color }}>
            <textarea
              ref={box}
              rows={1}
              value={livre.input}
              placeholder={settings.freePc ? `Pergunte a ${a().label} sobre seus arquivos… (Enter envia)` : `Converse com ${a().label}… (Enter envia, Shift+Enter quebra a linha)`}
              onInput={(e) => {
                setLivre("input", e.currentTarget.value);
                fit();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <Show
              when={livre.busy}
              fallback={
                <button class="send-btn" title="Enviar (Enter)" disabled={!livre.input.trim()} onClick={send}>
                  <SendHorizontal size={15} />
                </button>
              }
            >
              <button class="send-btn stop" title="Parar a resposta" onClick={() => stopLivre()}>
                <Square size={13} fill="currentColor" />
              </button>
            </Show>
          </div>
          <div class="livre-foot">
            <Show when={settings.freePc} fallback={<span><MessagesSquare size={11} /> Só conversa: a IA não vê seus arquivos</span>}>
              <span class="pc"><Eye size={11} /> Pode ler a sua pasta pessoal · não edita nem roda comandos · senhas e chaves ficam de fora</span>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}
