import { AlertTriangle, ArrowLeft, Ban, Check, Eye, History, HardDrive, MessageSquarePlus, MessagesSquare, Paperclip, SendHorizontal, ShieldCheck, Square, X } from "lucide-solid";
import { createEffect, createResource, createSignal, For, Match, on, onMount, Show, Switch } from "solid-js";
import { accountById, accts } from "../accounts";
import type { ActivityEvent } from "../store";
import { isTauri } from "../api";
import { settings } from "../settings";
import { answerLivre, freeAccount, freeAccountId, listLivre, livre, newLivre, openLivre, sendLivre, setFreeAccount, setFreePc, setLivre, stopLivre, type Item } from "../livre";
import { attsOf, dropPid, pasteFiles, pickFiles } from "../attachments";
import AttachBar from "../components/AttachBar";
import { SentThumbs } from "../components/Media";
import { deleteConvos, type Convo } from "../chat";
import { LIVRE } from "../livre";
import ConvoRow from "../components/ConvoRow";
import ActivityIcon, { kindColor } from "../components/ActivityIcon";
import Markdown from "../components/Markdown";
import { ProviderMark } from "../components/ui";
import MsgTools, { focusComposer } from "../components/MsgTools";
import { MicButton } from "../components/Mic";
import { LimitHitCard, UsageRing } from "../components/Limits";
import { AgentChipButton, AgentMenu } from "../components/AgentMenu";
import { limitHit } from "../limits";
import { listeningTo, voiceKey } from "../voice";
import { tx, txn } from "../i18n";

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

function Empty() {
  const list = () => (settings.freePc ? ideas.pc : ideas.conversa).map((s) => tx(s));
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
      <h2>{settings.freePc ? tx("Pergunte sobre o seu computador") : tx("Pergunte o que quiser")}</h2>
      <p>
        <Show
          when={settings.freePc}
          fallback={<>{tx("Uma conversa fora de qualquer projeto, com {label}. Bom para tirar dúvidas, escrever textos e pensar junto. A IA não vê nenhum arquivo seu.", { label: freeAccount().label })}</>}
        >
          {tx("{label} pode listar, ler e buscar arquivos na sua pasta pessoal para responder.", { label: freeAccount().label })} <b>{tx("Não edita, não apaga e não roda comandos")}</b>{tx(", e pastas de senhas e chaves (.ssh, .aws, chaveiro) ficam de fora.")}
        </Show>
      </p>
      <div class="livre-ideas">
        <For each={list()}>
          {(t, i) => (
            <button class="livre-idea pop-in" style={{ "animation-delay": `${80 + i() * 60}ms` }} onClick={() => sendLivre(t)}>
              <MessageSquarePlus size={13} />
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
        {running() ? tx("Olhando…") : tx("Passos")}
        <small>{txn(steps().length, "{n} passo", "{n} passos")}</small>
      </div>
      <Show when={steps().length > 8}><div class="work-more">{tx("+{v} antes", { v: steps().length - 8 })}</div></Show>
      <For each={shown()}>
        {(x) => (
          <div class="work-row slide-in" classList={{ running: x.status === "running", error: x.status === "error" }} title={x.detail ?? x.title}>
            <span class="work-icon" style={{ color: kindColor[x.kind as ActivityEvent["kind"]] }}>
              <ActivityIcon kind={x.kind as ActivityEvent["kind"]} />
            </span>
            <span class="work-title">{x.title}</span>
            <Show when={x.status === "running"} fallback={<small class="work-detail">{x.status === "error" ? x.detail ?? tx("falhou") : x.detail}</small>}>
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
      <Match when={props.item.t === "user" && props.item}>{(it) => <div class="livre-msg user pop-in">{it().text}<SentThumbs text={it().text} /><MsgTools text={it().text} onReuse={() => (setLivre("input", it().text), focusComposer(document.querySelector(".livre-composer")))} /></div>}</Match>
      <Match when={props.item.t === "say" && props.item}>
        {(it) => (
          <Show
            when={limitHit(it().text)}
            fallback={
              <div class="livre-msg agent pop-in" style={{ "--c": accountById(it().account).color }}>
                <ProviderMark id={it().account} size={22} />
                <div class="livre-say"><Markdown text={it().text} /></div>
                <MsgTools text={it().text} />
              </div>
            }
          >
            {(h) => <LimitHitCard accountId={it().account} win={h().win} raw={h().raw} onPick={(id) => void setFreeAccount(id)} />}
          </Show>
        )}
      </Match>
      <Match when={props.item.t === "work" && (props.item as Item & { t: "work" })}>{(it) => <Steps steps={it()} />}</Match>
      <Match when={props.item.t === "done" && props.item}>
        {(it) => (
          <div class="done-line pop-in" classList={{ stopped: !it().ok }}>
            <span>{it().ok ? "✓" : "■"}</span> {accountById(it().account).label} {it().ok ? tx("respondeu") : tx("parou")}
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
  const open = async (c: Convo) => {
    setOpening(`${c.kind}:${c.id}`);
    await openLivre(c);
    setOpening(null);
    props.onClose();
  };
  return (
    <div class="livre-convos pop-in">
      <div class="convos-head">
        <button class="icon-btn small" title={tx("Voltar")} onClick={props.onClose}><ArrowLeft size={14} /></button>
        <strong>{tx("Conversas do Chat livre")}</strong>
        <button class="convos-refresh inline" onClick={() => refetch()}>{tx("Atualizar")}</button>
      </div>
      <Show when={!data.loading} fallback={<div class="convos-empty"><span class="spinner" /> {tx("Lendo os históricos…")}</div>}>
        <Show when={data()?.items.length} fallback={<div class="convos-empty">{isTauri ? tx("Nenhuma conversa guardada ainda. Cada conversa aqui fica salva para você voltar nela depois.") : tx("No navegador as conversas não ficam guardadas: abra o app.")}</div>}>
          <For each={data()!.items}>
            {(c, i) => {
              const key = `${c.kind}:${c.id}`;
              const exists = () => accts.list.some((x) => x.id === c.account);
              return (
                <ConvoRow
                  c={c}
                  i={i()}
                  current={data()?.current === key}
                  locked={!exists()}
                  opening={opening() === key}
                  disabled={!!opening() || !exists() || livre.busy}
                  title={exists() ? (c.account === freeAccountId() ? tx("Continuar esta conversa") : tx("Continuar (troca para a conta {label})", { label: accountById(c.account).label })) : tx("A conta desta conversa não existe mais")}
                  onOpen={() => open(c)}
                  onDelete={async () => (await deleteConvos(LIVRE, [c], data()?.current ?? null)) && refetch()}
                />
              );
            }}
          </For>
          <div class="convos-foot">
            <button class="convos-clear" disabled={livre.busy} onClick={async () => (await deleteConvos(LIVRE, [...data()!.items], data()?.current ?? null)) && refetch()}>
              {tx("Apagar todas ({length})", { length: data()!.items.length })}
            </button>
          </div>
        </Show>
      </Show>
    </div>
  );
}

export default function Livre() {
  const [convos, setConvos] = createSignal(false);
  const [menu, setMenu] = createSignal(false);
  let scroller!: HTMLDivElement;
  let box!: HTMLTextAreaElement;
  let stick = true;

  const fit = () => {
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, 160)}px`;
  };
  // texto que chega pelo ditado (ou é limpo ao enviar) também ajusta a altura da caixa
  createEffect(on(() => livre.input, () => box && requestAnimationFrame(fit), { defer: true }));
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
            <strong>{tx("Chat livre")}</strong>
            <small title={livre.conv?.title}>{livre.conv ? tx("Conversa retomada: {title}", { title: livre.conv.title }) : tx("Conversa sem projeto, para tirar dúvidas")}</small>
          </div>
        </div>
        <div class="livre-tools">
          <button class="icon-btn" title={tx("Conversas anteriores")} classList={{ active: convos() }} onClick={() => setConvos(!convos())}><History size={15} /></button>
          <button class="icon-btn" title={tx("Nova conversa")} disabled={livre.busy || (!livre.items.length && !livre.conv)} onClick={() => newLivre()}><MessageSquarePlus size={15} /></button>
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
                  <span>{tx("Precisa da sua aprovação")}</span>
                  <small>{q.tool}</small>
                </div>
                <strong>{q.title}</strong>
                <Show when={q.detail}><pre>{q.detail}</pre></Show>
                <div class="perm-ask-actions">
                  <button class="ghost-btn" disabled={q.answering} onClick={() => answerLivre(q.requestId, false)}><Ban size={13} /> {tx("Recusar")}</button>
                  <button class="primary-btn small" disabled={q.answering} onClick={() => answerLivre(q.requestId, true)}><Check size={13} /> {tx("Permitir")}</button>
                </div>
              </div>
            )}
          </For>
          <Show when={livre.error}>
            <div class="bubble chat-error pop-in">
              <AlertTriangle size={14} />
              <span>{livre.error}</span>
              <button class="icon-btn small" title={tx("Fechar")} onClick={() => setLivre("error", null)}><X size={12} /></button>
            </div>
          </Show>
        </div>
      </div>

      <div class="livre-bottom">
        <div class="livre-col">
          <div class="composer livre-composer" classList={{ busy: livre.busy, listening: listeningTo(LIVRE), dropping: dropPid() === LIVRE }} style={{ "--c": a().color }} data-attach-pid={LIVRE}>
            <AttachBar pid={LIVRE} />
            <textarea
              onPaste={(e) => void pasteFiles(LIVRE, e)}
              ref={box}
              rows={2}
              value={livre.input}
              readOnly={listeningTo(LIVRE)}
              placeholder={listeningTo(LIVRE) ? tx("Pode falar… (Enter para, Esc cancela)") : settings.freePc ? tx("Pergunte a {label} sobre seus arquivos… (Enter envia, ⌥ Espaço para falar)", { label: a().label }) : tx("Converse com {label}… (Enter envia, ⌥ Espaço para falar)", { label: a().label })}
              onInput={(e) => {
                setLivre("input", e.currentTarget.value);
                fit();
              }}
              onKeyDown={(e) => {
                if (voiceKey(LIVRE, e)) return;
                if (e.key === "Escape" && livre.busy) return (e.preventDefault(), void stopLivre());
                if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
                  e.preventDefault();
                  if (!livre.busy) send();
                }
              }}
            />
            <div class="composer-bar">
              <button class="icon-btn" classList={{ on: attsOf(LIVRE).length > 0 }} title={tx("Anexar arquivos ou imagens (ou cole com ⌘V, ou arraste do Finder)")} onClick={() => void pickFiles(LIVRE)}>
                <Paperclip size={14} />
              </button>
              <AgentChipButton prefKey={LIVRE} accountId={a().id} open={menu()} disabled={livre.busy} title={livre.busy ? tx("Espere a resposta terminar para trocar") : tx("Conta, modelo e força do raciocínio do Chat livre")} onClick={() => setMenu(!menu())} />
              <button
                class="composer-chip"
                style={{ "--lc": settings.freePc ? "var(--info)" : "var(--text-2)" }}
                disabled={livre.busy}
                title={settings.freePc ? tx("Olhar o computador: a IA pode listar, ler e buscar na sua pasta pessoal, sem editar nada (clique para voltar a Só conversa)") : tx("Só conversa: a IA não vê nenhum arquivo (clique para deixar ela olhar o computador)")}
                onClick={() => setFreePc(!settings.freePc)}
              >
                <Show when={settings.freePc} fallback={<><MessagesSquare size={12} /> {tx("Só conversa")}</>}>
                  <Eye size={12} /> {tx("Olhar o computador")}
                </Show>
              </button>
              <span class="composer-gap" />
              <UsageRing id={freeAccountId()} />
              <MicButton target={LIVRE} />
              <Show
                when={livre.busy}
                fallback={
                  <button class="send-btn" title={tx("Enviar (Enter)")} disabled={!livre.input.trim() && !attsOf(LIVRE).length} onClick={send}>
                    <SendHorizontal size={14} />
                  </button>
                }
              >
                <button class="send-btn stop" title={tx("Parar (Esc)")} onClick={() => stopLivre()}>
                  <Square size={11} fill="currentColor" />
                </button>
              </Show>
            </div>
            <Show when={menu()}>
              <AgentMenu prefKey={LIVRE} accountId={a().id} title={tx("Conta no Chat livre")} onPick={(id) => void setFreeAccount(id)} onClose={() => setMenu(false)} />
            </Show>
          </div>
          <div class="livre-foot">
            <Show when={settings.freePc} fallback={<span><MessagesSquare size={11} /> {tx("Só conversa: a IA não vê seus arquivos")}</span>}>
              <span class="pc"><Eye size={11} /> {tx("Pode ler a sua pasta pessoal · não edita nem roda comandos · senhas e chaves ficam de fora")}</span>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}
