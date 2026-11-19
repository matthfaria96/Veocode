import { dismissable } from "../dismiss";
import { AlertTriangle, ArrowLeft, Ban, Check, ChevronDown, FileCode2, History, MessageSquarePlus, Paperclip, Plus, SendHorizontal, ShieldCheck, Square, TerminalSquare, X } from "lucide-solid";
import { createEffect, createMemo, createResource, createSignal, For, Match, on, Show, Switch } from "solid-js";
import { accessLevels } from "../data/mock";
import { accountById, accountSub, accts } from "../accounts";
import { currentProject, setProjectAccount, showToast, ws, type ActivityEvent } from "../store";
import { seenAgent } from "../agentFeed";
import { acc, loadAccess, openClaude } from "../access";
import { answerPermission, chatOf, clearError, deleteConvos, isClaudeChat, listConversations, newChat, openConversation, sendChat, setAttach, setInput, stopChat, type Convo } from "../chat";
import { isTauri } from "../api";
import AccessLevel from "./AccessLevel";
import GitPanel from "./GitPanel";
import TrailPanel from "./TrailPanel";
import ConvoRow from "./ConvoRow";
import { git, gitTab, setGitTab } from "../git";
import { claudeModels, efforts, prefsLabel, prefsOf, setPref } from "../chatPrefs";
import { attsOf, dropPid, pasteFiles, pickFiles } from "../attachments";
import AttachBar from "./AttachBar";
import ActivityIcon, { kindColor } from "./ActivityIcon";
import { ProviderMark } from "./ui";
import MsgTools, { focusComposer } from "./MsgTools";
import Markdown from "./Markdown";

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
          fallback={<>Peça abaixo e {a().label} trabalha nesta pasta pelas ferramentas do Veocode: lista, lê, busca, edita arquivos e roda comandos, obedecendo o nível de acesso. O que o nível manda perguntar aparece aqui para você permitir ou recusar. Se o modelo não aceitar ferramentas, vira só conversa.</>}
        >
          Peça abaixo e o Claude Code trabalha nesta pasta, com a conta {a().label} e obedecendo o nível de acesso. O que o nível manda
          perguntar aparece aqui para você permitir ou recusar. O que ele mudar fica marcado na árvore (<b class="c-edit">M</b>, <b class="c-new">N</b>, <b class="c-del">A</b>).
        </Show>
        <div class="idle-actions">
          <Show when={isClaude()}>
            <button class="ghost-btn" onClick={() => openClaude(p().id)}>
              <TerminalSquare size={13} /> Abrir no Terminal
            </button>
          </Show>
          <button class="ghost-btn" onClick={props.onConvos}>
            <History size={13} /> Conversas anteriores
          </button>
          <button class="ghost-btn" onClick={props.onAccess}>
            <ShieldCheck size={13} /> Nível de acesso
          </button>
        </div>
      </div>
      <Show when={changes().length > 0}>
        <div class="work-card pop-in">
          <div class="work-head">
            <span class="work-dot live" />
            Mudanças no disco
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

type Block = { t: "user" | "say" | "done"; e: ActivityEvent } | { t: "work"; items: ActivityEvent[] };

/** Conversa real: pedidos, respostas e os passos do Claude (lidos do histórico dele). */
function RealConversation() {
  const p = currentProject;
  // chaves estáveis por bloco: o DOM de cada bloco não é recriado a cada leitura
  const blocks = createMemo(() => {
    const map = new Map<string, Block>();
    let work: string | null = null;
    for (const e of ws.events) {
      if (e.agent === "disco") continue;
      if (e.kind === "user" || e.kind === "say" || e.kind === "done") {
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

  const a = () => accountById(p().accountId);
  const chat = () => chatOf(p().id);
  const head = () =>
    isClaudeChat(p().id)
      ? ws.running ? "O Claude está trabalhando nesta pasta" : chat().conv?.title ?? "Claude nesta pasta"
      : chat().busy ? `${a().label} está trabalhando nesta pasta` : chat().conv?.title ?? `${a().label} nesta pasta`;

  return (
    <>
      <div class="live-head">
        <span class="work-dot" classList={{ live: ws.running || chat().busy }} />
        <span class="live-title" title={chat().conv ? `Conversa retomada: ${chat().conv!.title}` : undefined}>{head()}</span>
        <button class="icon-btn small" title="Nova conversa" disabled={chat().busy} onClick={() => newChat(p().id)}>
          <MessageSquarePlus size={13} />
        </button>
        <Show when={isClaudeChat(p().id)}>
          <button class="icon-btn small" title="Abrir o Claude no Terminal" onClick={() => openClaude(p().id)}>
            <TerminalSquare size={13} />
          </button>
        </Show>
      </div>
      <For each={keys()}>
        {(k) => {
          const b = () => blocks().get(k);
          return (
            <Switch>
              <Match when={b()?.t === "user" && (b() as { e: ActivityEvent }).e}>{(e) => <div class="bubble user pop-in">{e().title}<MsgTools text={e().title} onReuse={() => (setInput(currentProject().id, e().title), focusComposer(document.querySelector(".chat-panel")))} /></div>}</Match>
              <Match when={b()?.t === "say" && (b() as { e: ActivityEvent }).e}>
                {(e) => <div class="bubble agent pop-in say md-bubble" style={{ "--c": e().color ?? "var(--accent)" }}><Markdown text={e().title} /><MsgTools text={e().title} /></div>}
              </Match>
              <Match when={b()?.t === "done" && (b() as { e: ActivityEvent }).e}>{(e) => <div class="done-line pop-in"><span>✓</span> {e().agent} terminou · {e().time}</div>}</Match>
              <Match when={b()?.t === "work" && (b() as { items: ActivityEvent[] }).items}>
                {(items) => {
                  const shown = () => items().slice(-8);
                  const running = () => items().some((x) => x.status === "running");
                  return (
                    <div class="work-card pop-in">
                      <div class="work-head">
                        <span class="work-dot" classList={{ live: running() }} />
                        {running() ? "Trabalhando…" : "Passos"}
                        <small>{items().length} {items().length === 1 ? "passo" : "passos"}</small>
                      </div>
                      <Show when={items().length > 8}><div class="work-more">+{items().length - 8} antes</div></Show>
                      <For each={shown()}>
                        {(x) => (
                          <div class="work-row slide-in" classList={{ running: x.status === "running", error: x.status === "error" }} title={x.detail ?? x.title}>
                            <span class="work-icon" style={{ color: kindColor[x.kind] }}>
                              <ActivityIcon kind={x.kind} />
                            </span>
                            <span class="work-title">{x.title}</span>
                            <Show when={x.status === "running"} fallback={<small class="work-detail">{x.status === "error" ? "falhou" : x.kind === "run" ? "" : x.detail}</small>}>
                              <span class="spinner" />
                            </Show>
                          </div>
                        )}
                      </For>
                    </div>
                  );
                }}
              </Match>
            </Switch>
          );
        }}
      </For>
      <ChatTail />
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
    if (!usable(c)) return showToast(`Esta conversa é da conta ${accountById(c.account).label}. Troque a conta do projeto para continuar nela.`);
    setOpening(`${c.kind}:${c.id}`);
    await openConversation(pid, c);
    setOpening(null);
    props.onClose();
  };
  return (
    <div class="convos">
      <div class="convos-head">
        <button class="icon-btn small" title="Voltar para a conversa" onClick={props.onClose}><ArrowLeft size={14} /></button>
        <strong>Conversas deste projeto</strong>
        <button
          class="ghost-btn small"
          disabled={chatOf(pid).busy}
          onClick={async () => {
            await newChat(pid);
            props.onClose();
          }}
        >
          <MessageSquarePlus size={12} /> Nova
        </button>
      </div>
      <Show when={!data.loading} fallback={<div class="convos-empty"><span class="spinner" /> Lendo os históricos…</div>}>
        <Show
          when={data()?.items.length}
          fallback={<div class="convos-empty">Nenhuma conversa ainda nesta pasta. As sessões do Claude (pelo chat, Terminal ou editor) e as conversas com APIs aparecem aqui.</div>}
        >
          <For each={data()!.items}>
            {(c, i) => {
              const key = `${c.kind}:${c.id}`;
              // a conversa aberta de outra conta (o projeto trocou de conta) não vale mais: mostra o cadeado
              const current = () => data()?.current === key && usable(c);
              return (
                <ConvoRow
                  c={c}
                  i={i()}
                  current={current()}
                  locked={!usable(c)}
                  opening={opening() === key}
                  disabled={!!opening()}
                  title={usable(c) ? (current() ? "Conversa aberta no chat" : "Continuar esta conversa") : `Da conta ${accountById(c.account).label}: troque a conta do projeto para continuar`}
                  extra={<Show when={c.origin}><span>· {c.origin}</span></Show>}
                  onOpen={() => open(c)}
                  onDelete={async () => (await deleteConvos(pid, [c], data()?.current ?? null)) && refetch()}
                />
              );
            }}
          </For>
          <div class="convos-foot">
            <button class="convos-refresh" onClick={() => refetch()}>Atualizar a lista</button>
            <button class="convos-clear" disabled={chatOf(pid).busy} onClick={async () => (await deleteConvos(pid, [...data()!.items], data()?.current ?? null)) && refetch()}>
              Apagar todas ({data()!.items.length})
            </button>
          </div>
        </Show>
      </Show>
    </div>
  );
}

/** Texto chegando, pedidos de permissão e erro da conversa. */
function ChatTail() {
  const p = currentProject;
  const chat = () => chatOf(p().id);
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
              <span>O nível pede para confirmar</span>
              <small>{q.tool}</small>
            </div>
            <strong>{q.title}</strong>
            <Show when={q.detail}><pre>{q.detail}</pre></Show>
            <div class="perm-ask-actions">
              <button class="ghost-btn" disabled={q.answering} onClick={() => answerPermission(p().id, q.requestId, false)}>
                <Ban size={13} /> Recusar
              </button>
              <button class="primary-btn small" disabled={q.answering} onClick={() => answerPermission(p().id, q.requestId, true)}>
                <Check size={13} /> Permitir
              </button>
            </div>
          </div>
        )}
      </For>
      <Show when={chat().error}>
        <div class="bubble chat-error pop-in">
          <AlertTriangle size={14} />
          <span>{chat().error}</span>
          <button class="icon-btn small" title="Fechar" onClick={() => clearError(p().id)}><X size={12} /></button>
        </div>
      </Show>
    </>
  );
}

/** Caixa de mensagem: Enter envia, Shift+Enter quebra linha. */
function Composer(props: { onLevel: () => void }) {
  const p = currentProject;
  const chat = () => chatOf(p().id);
  const a = () => accountById(p().accountId);
  const level = () => accessLevels[p().access];
  const demo = () => p().demo || !isTauri;
  const canAttach = () => !demo() && !!ws.activeFile;
  let box!: HTMLTextAreaElement;

  const send = () => {
    if (demo()) return showToast("Projeto de demonstração: abra uma pasta sua para conversar de verdade");
    sendChat(p().id);
    requestAnimationFrame(() => fit());
  };
  const fit = () => {
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, 160)}px`;
  };
  createEffect(on(() => p().id, () => requestAnimationFrame(() => box && fit())));

  return (
    <div class="composer" classList={{ busy: chat().busy, dropping: dropPid() === p().id }} data-attach-pid={demo() ? undefined : p().id}>
      <AttachBar
        pid={p().id}
        extra={
          <Show when={canAttach()}>
            <Show
              when={chat().attach}
              fallback={
                <button class="att-suggest" title="Mandar junto o arquivo aberto no editor" onClick={() => setAttach(p().id, true)}>
                  <Plus size={11} /> {fileName(ws.activeFile)}
                </button>
              }
            >
              <div class="att text open-file" title={ws.activeFile}>
                <span class="att-icon"><FileCode2 size={14} /></span>
                <span class="att-text"><strong>{fileName(ws.activeFile)}</strong><small>aberto no editor</small></span>
                <button class="att-x" title="Não mandar o arquivo aberto" onClick={() => setAttach(p().id, false)}><X size={11} /></button>
              </div>
            </Show>
          </Show>
        }
      />
      <textarea
        ref={box}
        rows={2}
        value={chat().input}
        placeholder={`Pedir algo a ${a().label}… (Enter envia, ⌘V cola imagens)`}
        onPaste={(e) => !demo() && void pasteFiles(p().id, e)}
        onInput={(e) => {
          setInput(p().id, e.currentTarget.value);
          fit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            if (!chat().busy) send();
          }
        }}
      />
      <div class="composer-bar">
        <button class="icon-btn" classList={{ on: attsOf(p().id).length > 0 }} disabled={demo()} title="Anexar arquivos ou imagens (ou cole com ⌘V, ou arraste do Finder)" onClick={() => void pickFiles(p().id)}>
          <Paperclip size={14} />
        </button>
        <button class="composer-chip" style={{ "--lc": level().color }} title="Nível de acesso deste projeto" onClick={props.onLevel}>
          {level().name}
        </button>
        <Show
          when={chat().busy}
          fallback={
            <button class="send-btn" disabled={!demo() && !chat().input.trim() && !attsOf(p().id).length} title="Enviar (Enter)" onClick={send}>
              <SendHorizontal size={14} />
            </button>
          }
        >
          <button class="send-btn stop" title="Parar a resposta" onClick={() => stopChat(p().id)}>
            <Square size={11} fill="currentColor" />
          </button>
        </Show>
      </div>
    </div>
  );
}

export default function ChatPanel() {
  const [tab, setTab] = [gitTab, setGitTab];
  const [pickAccount, setPickAccount] = createSignal(false);
  const [convos, setConvos] = createSignal(false);
  const project = currentProject;
  createEffect(on(() => project().id, () => setConvos(false)));
  const real = () => isTauri && !project().demo;
  const account = () => accountById(project().accountId);
  const level = () => accessLevels[project().access];
  // bolinha no selo do nível enquanto ele não vale de verdade no projeto
  const unapplied = () => isTauri && !project().demo && acc.reports[project().id]?.fileState.state !== "aplicado";
  createEffect(on(() => project().id, (id) => isTauri && loadAccess(id)));
  let scroller!: HTMLDivElement;

  // rola o chat junto com a atividade
  createEffect(on(() => [ws.events.length, chatOf(project().id).draft.length >> 6, chatOf(project().id).perms.length, chatOf(project().id).error], () => setTimeout(() => scroller && scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" }), 30)));

  const userMsgs = () => ws.events.filter((e) => e.kind === "user");
  const work = () => ws.events.filter((e) => e.kind !== "user" && e.kind !== "done");
  const done = () => ws.events.find((e) => e.kind === "done");

  return (
    <aside class="chat-panel" style={{ "--c": account().color }}>
      <div class="chat-head">
        <button class="agent-picker" onClick={() => setPickAccount(!pickAccount())}>
          <ProviderMark id={account().id} size={26} />
          <div>
            <strong>{account().label}</strong>
            <small>{account().provider === "claude" ? prefsLabel(project().id) ?? accountSub(account()) : accountSub(account())}</small>
          </div>
          <ChevronDown size={14} />
        </button>
        <Show when={real()}>
          <button
            class="icon-btn head-btn"
            classList={{ on: convos() && tab() === "chat" }}
            title="Conversas anteriores"
            onClick={() => {
              setTab("chat");
              setConvos(!convos());
            }}
          >
            <History size={15} />
          </button>
        </Show>
        <button class="level-pill" classList={{ unapplied: unapplied() }} title={unapplied() ? "Nível de acesso: ainda não vale no Claude Code, clique para gravar" : "Nível de acesso: o que a IA pode fazer aqui (clique para mudar)"} style={{ "--lc": level().color }} onClick={() => setTab(tab() === "access" ? "chat" : "access")}>
          {level().short}
        </button>
        <Show when={pickAccount()}>
          <div class="menu pop-in agent-menu" ref={(el) => dismissable(el, () => setPickAccount(false))}>
            <small class="menu-title">Conta neste projeto</small>
            <For each={accts.list}>
              {(a) => (
                <button
                  class="menu-item"
                  classList={{ sel: a.id === account().id }}
                  onClick={() => {
                    if (a.id === account().id) return;
                    setProjectAccount(project().id, a.id);
                    showToast(`${project().name} agora usa ${a.label}`);
                  }}
                >
                  <ProviderMark id={a.id} size={20} />
                  <span>{a.label}</span>
                  <small>{accountSub(a)}</small>
                  <Show when={a.id === account().id}><Check size={14} class="menu-check" /></Show>
                </button>
              )}
            </For>
            <Show when={account().provider === "claude"}>
              <div class="menu-sep" />
              <small class="menu-title">Modelo</small>
              <div class="agent-chips">
                <For each={claudeModels}>
                  {(m) => (
                    <button class="agent-chip" classList={{ on: (prefsOf(project().id).model ?? null) === m.id }} title={m.id ? `${m.label}: ${m.hint}` : `Usa o modelo da conta (${accountSub(account())})`} onClick={() => setPref(project().id, { model: m.id })}>
                      {m.label}
                    </button>
                  )}
                </For>
              </div>
              <small class="menu-title">Força do raciocínio</small>
              <div class="agent-chips effort">
                <For each={efforts}>
                  {(e, i) => (
                    <button class="agent-chip" classList={{ on: (prefsOf(project().id).effort ?? null) === e.id }} data-lvl={i()} title={e.id ? `Pensa ${e.label.toLowerCase()}: ${i() <= 2 ? "responde mais rápido e gasta menos" : "pensa mais antes de responder e gasta mais"}` : "Usa o padrão do Claude Code"} onClick={() => setPref(project().id, { effort: e.id })}>
                      <Show when={e.id}><i class="effort-bars"><b /><b /><b /><b /><b /></i></Show>
                      {e.label}
                    </button>
                  )}
                </For>
              </div>
              <p class="agent-menu-note">Vale a partir da próxima mensagem; a conversa continua de onde parou.</p>
            </Show>
          </div>
        </Show>
      </div>

      <div class="seg three">
        <button classList={{ active: tab() === "chat" || tab() === "access" }} onClick={() => setTab("chat")} title="Conversa com a IA e o que ela pode fazer">Agente</button>
        <button classList={{ active: tab() === "git" }} onClick={() => setTab("git")} title="Git e GitHub deste projeto">Git <GitBadge /></button>
        <button classList={{ active: tab() === "trail" }} onClick={() => setTab("trail")} title="O que a IA deixou: sobras para limpar, pastas fora do projeto e o que instalou">Rastro</button>
        <span class="seg-thumb" style={{ transform: `translateX(${(tab() === "access" ? 0 : ["chat", "git", "trail"].indexOf(tab())) * 100}%)` }} />
      </div>

      <Switch>
        <Match when={tab() === "chat"}>
          <Show when={convos() && real()}>
            <div class="chat-scroll">
              <Conversations onClose={() => setConvos(false)} />
            </div>
          </Show>
          <div class="chat-scroll" ref={scroller} data-target="chat" classList={{ hidden: convos() && real() }}>
            <Show
              when={project().demo}
              fallback={
                <Show when={(seenAgent() && ws.events.some((e) => e.agent !== "disco")) || chatOf(project().id).busy || chatOf(project().id).error} fallback={<RealIdle onAccess={() => setTab("access")} onConvos={() => setConvos(true)} />}>
                  <RealConversation />
                </Show>
              }
            >
              <Show when={ws.events.length === 0}>
                <div class="chat-empty">{ws.paused ? "Simulação parada: aperte Assistir (em cima do editor) para ver um agente de exemplo trabalhando." : "O agente de exemplo vai começar em instantes…"}</div>
              </Show>
              <For each={userMsgs()}>{(m) => <div class="bubble user pop-in">{m.title}</div>}</For>
              <Show when={work().length > 0}>
                <div class="work-card pop-in">
                  <div class="work-head">
                    <span class="work-dot" classList={{ live: ws.running }} />
                    {ws.running ? "Trabalhando…" : "Concluído"}
                    <small>{work().length} passos</small>
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
                    <strong>{d().title}.</strong> {d().detail}. Quer ver os dados reais do disco em Computador → Espaço e memória?
                  </div>
                )}
              </Show>
            </Show>
          </div>
          <Composer onLevel={() => setTab("access")} />
        </Match>
        <Match when={tab() === "access"}>
          <div class="chat-scroll">
            <button class="back-link" onClick={() => setTab("chat")}><ArrowLeft size={14} /> Voltar para a conversa</button>
            <AccessLevel projectId={project().id} />
          </div>
        </Match>
        <Match when={tab() === "trail"}>
          <div class="chat-scroll">
            <TrailPanel />
          </div>
        </Match>
        <Match when={tab() === "git"}>
          <div class="chat-scroll">
            <GitPanel />
          </div>
        </Match>
      </Switch>
    </aside>
  );
}

/** Na aba Git: quantos commits faltam enviar ou baixar, ou um ponto quando há mudanças. */
function GitBadge() {
  const sum = () => git.summaries[currentProject().id];
  return (
    <Show when={sum()?.repo}>
      <Show when={sum()!.ahead || sum()!.behind} fallback={<Show when={sum()!.changed}><i class="seg-dot" title={`${sum()!.changed} arquivos mudados`} /></Show>}>
        <span class="seg-badge" title="Commits para enviar / baixar">{sum()!.ahead ? `↑${sum()!.ahead}` : ""}{sum()!.behind ? `↓${sum()!.behind}` : ""}</span>
      </Show>
    </Show>
  );
}
