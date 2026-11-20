import { AlertTriangle, ArrowLeft, ArrowUp, Ban, Check, Eye, History, HardDrive, MessageSquarePlus, MessagesSquare, Paperclip, ShieldCheck, Square, X } from "lucide-solid";
import { createEffect, createMemo, createResource, createSignal, For, Match, on, onMount, Show, Switch } from "solid-js";
import { accountById, accts } from "../accounts";
import { isTauri } from "../api";
import { settings } from "../settings";
import { answerLivre, freeAccount, freeAccountId, listLivre, livre, newLivre, openLivre, sendLivre, setFreeAccount, setFreePc, setLivre, stopLivre, type Item } from "../livre";
import { attsOf, dropPid, pasteFiles, pickFiles } from "../attachments";
import AttachBar from "../components/AttachBar";
import { SentThumbs } from "../components/Media";
import { deleteConvos, type Convo } from "../chat";
import { LIVRE } from "../livre";
import ConvoRow from "../components/ConvoRow";
import Markdown from "../components/Markdown";
import { LiveLine, LongText, latestPlan, PlanCard, WorkFold, type WorkStep } from "../components/Work";
import { Tool } from "../components/ConvBar";
import MsgTools, { focusComposer } from "../components/MsgTools";
import { MicButton } from "../components/Mic";
import { LimitHitCard, UsageRing } from "../components/Limits";
import { AgentChipButton, AgentMenu } from "../components/AgentMenu";
import { limitHit } from "../limits";
import { listeningTo, voiceKey } from "../voice";
import { locale, tx } from "../i18n";

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

/** Conversa vazia: igual ao chat dos projetos (marca, título, uma linha e atalhos) e ideias para começar. */
function Empty(props: { onConvos: () => void }) {
  const list = () => (settings.freePc ? ideas.pc : ideas.conversa).map((s) => tx(s));
  return (
    <div class="idle-hero livre-hero pop-in">
      <span class="idle-mark livre-mark" style={{ "--c": freeAccount().color }}>
        <Show when={settings.freePc} fallback={<MessagesSquare size={28} />}>
          <HardDrive size={28} />
        </Show>
      </span>
      <h2>{settings.freePc ? tx("Pergunte sobre o seu computador") : tx("Pergunte o que quiser")}</h2>
      <p>
        <Show
          when={settings.freePc}
          fallback={<>{tx("Uma conversa fora de qualquer projeto, com {label}. Bom para tirar dúvidas, escrever textos e pensar junto. A IA não vê nenhum arquivo seu.", { label: freeAccount().label })}</>}
        >
          {tx("{label} pode listar, ler e buscar arquivos na sua pasta pessoal para responder.", { label: freeAccount().label })} <b>{tx("Não edita, não apaga e não roda comandos")}</b>{tx(", e pastas de senhas e chaves (.ssh, .aws, chaveiro) ficam de fora.")}
        </Show>
      </p>
      <div class="idle-actions">
        <button class="idle-act" onClick={props.onConvos}>
          <History size={14} /> {tx("Conversas anteriores")}
        </button>
        <button class="idle-act" disabled={livre.busy} style={{ "--lc": settings.freePc ? "var(--info)" : "var(--text-3)" }} onClick={() => void setFreePc(!settings.freePc)}>
          <Show when={settings.freePc} fallback={<><Eye size={14} class="idle-lc" /> {tx("Deixar olhar o computador")}</>}>
            <MessagesSquare size={14} class="idle-lc" /> {tx("Voltar a só conversa")}
          </Show>
        </button>
      </div>
      <div class="livre-ideas">
        <For each={list()}>
          {(t, i) => (
            <button class="livre-idea pop-in" style={{ "animation-delay": `${80 + i() * 60}ms` }} onClick={() => sendLivre(t)}>
              <MessageSquarePlus size={14} />
              <span>{t}</span>
            </button>
          )}
        </For>
      </div>
    </div>
  );
}

const clock = (at: number) => new Date(at).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** As mesmas mensagens do chat dos projetos: seu pedido num balão, a resposta em texto corrido, os passos numa linha. */
function Message(props: { item: Item }) {
  return (
    <Switch>
      <Match when={props.item.t === "user" && props.item}>
        {(it) => (
          <div class="bubble user pop-in">
            <LongText text={it().text} />
            <SentThumbs text={it().text} />
            <MsgTools text={it().text} onReuse={() => (setLivre("input", it().text), focusComposer(document.querySelector(".livre-composer")))} />
          </div>
        )}
      </Match>
      <Match when={props.item.t === "say" && props.item}>
        {(it) => (
          <Show
            when={limitHit(it().text)}
            fallback={
              <div class="bubble agent say md-bubble pop-in" style={{ "--c": accountById(it().account).color }}>
                <Markdown text={it().text} />
                <MsgTools text={it().text} />
              </div>
            }
          >
            {(h) => <LimitHitCard accountId={it().account} win={h().win} raw={h().raw} onPick={(id) => void setFreeAccount(id)} />}
          </Show>
        )}
      </Match>
      <Match when={props.item.t === "work" && (props.item as Item & { t: "work" })}>{(it) => <WorkFold steps={it().steps} />}</Match>
      <Match when={props.item.t === "done" && props.item}>
        {(it) => (
          <Show
            when={it().ok}
            fallback={<div class="done-line stopped pop-in" title={it().detail ?? undefined}><span>■</span> {tx("Você parou · {time}", { time: clock(it().at) })}</div>}
          >
            <div class="done-line pop-in" title={it().detail ?? undefined}><span>✓</span> {tx("{agent} terminou · {time}", { agent: accountById(it().account).label, time: clock(it().at) })}</div>
          </Show>
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
        <Show when={data.latest?.items.length} fallback={<div class="convos-empty">{isTauri ? tx("Nenhuma conversa guardada ainda. Cada conversa aqui fica salva para você voltar nela depois.") : tx("No navegador as conversas não ficam guardadas: abra o app.")}</div>}>
          <For each={data.latest!.items}>
            {(c, i) => {
              const key = `${c.kind}:${c.id}`;
              const exists = () => accts.list.some((x) => x.id === c.account);
              return (
                <ConvoRow
                  c={c}
                  i={i()}
                  current={data.latest?.current === key}
                  locked={!exists()}
                  opening={opening() === key}
                  disabled={!!opening() || !exists() || livre.busy}
                  title={exists() ? (c.account === freeAccountId() ? tx("Continuar esta conversa") : tx("Continuar (troca para a conta {label})", { label: accountById(c.account).label })) : tx("A conta desta conversa não existe mais")}
                  onOpen={() => open(c)}
                  onDelete={async () => (await deleteConvos(LIVRE, [c], data.latest?.current ?? null)) && refetch()}
                />
              );
            }}
          </For>
          <div class="convos-foot">
            <button class="convos-clear" disabled={livre.busy} onClick={async () => (await deleteConvos(LIVRE, [...data.latest!.items], data.latest?.current ?? null)) && refetch()}>
              {tx("Apagar todas ({length})", { length: data.latest!.items.length })}
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

  // o pedido em curso: o que veio depois da sua última mensagem (para a lista de tarefas e a linha viva)
  const turn = createMemo(() => {
    let i = livre.items.length - 1;
    while (i >= 0 && livre.items[i].t !== "user") i--;
    const steps: WorkStep[] = [];
    for (const it of livre.items.slice(i + 1)) if (it.t === "work") steps.push(...it.steps);
    const u = livre.items[i];
    return { since: u?.t === "user" ? u.at : undefined, steps };
  });
  const plan = createMemo(() => latestPlan(livre.items.flatMap((it): WorkStep[] => (it.t === "work" ? it.steps : it.t === "user" ? [{ id: it.key, kind: "user", title: "", status: "ok" }] : []))));
  const runningStep = () => [...turn().steps].reverse().find((x) => x.status === "running");

  const a = freeAccount;
  return (
    <div class="livre">
      <header class="conv-bar slim livre-bar">
        <div class="conv-now">
          <span class="conv-crumb">
            <MessagesSquare size={14} />
            <span>{tx("Chat livre")}</span>
            <i>/</i>
          </span>
          <i class="conv-dot" classList={{ busy: livre.busy, ask: livre.perms.length > 0, err: !!livre.error }} />
          <strong title={livre.conv?.title}>{livre.conv?.title ?? (livre.items.length ? tx("Conversa nova") : tx("Nova conversa"))}</strong>
          <small>{livre.busy ? tx("trabalhando") : livre.perms.length ? tx("esperando você") : settings.freePc ? tx("pode olhar o computador") : tx("só conversa")}</small>
        </div>
        <div class="conv-tools">
          <Tool icon={History} name={tx("Conversas anteriores")} hint={tx("Todas as conversas do Chat livre, de todas as contas")} on={convos()} onClick={() => setConvos(!convos())} />
          <Tool icon={MessageSquarePlus} name={tx("Nova conversa")} hint={tx("Começa do zero; esta fica guardada nas conversas anteriores")} disabled={livre.busy || (!livre.items.length && !livre.conv)} onClick={() => void newLivre()} />
        </div>
      </header>

      <Show when={convos()}>
        <Conversations onClose={() => setConvos(false)} />
      </Show>

      <div class="livre-scroll" ref={scroller} onScroll={() => (stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80)}>
        <div class="livre-col" classList={{ empty: !livre.items.length }}>
          <Show when={livre.items.length} fallback={<Empty onConvos={() => setConvos(true)} />}>
            <For each={livre.items}>{(it) => <Message item={it} />}</For>
          </Show>
          <Show when={plan()}>{(t) => <PlanCard todos={t()} color={a().color} live={livre.busy} />}</Show>
          <Show when={livre.busy && !livre.perms.length}>
            <Show when={livre.draft}>
              <div class="bubble agent say streaming" style={{ "--c": a().color }}>{livre.draft.replace(/\*\*/g, "")}</div>
            </Show>
            <LiveLine color={a().color} step={livre.draft ? null : runningStep()} writing={!!livre.draft} since={turn().since} onStop={() => void stopLivre()} />
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
                    <ArrowUp size={16} stroke-width={2.4} />
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
