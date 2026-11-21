// Uma coluna da tela Início: um projeto, com a conversa inteira (o mesmo chat da tela do projeto:
// passos, tarefas, linha viva, permissões, editar e bifurcar, a caixa com conta, nível e contexto),
// a troca entre as conversas dele que rodam ao mesmo tempo (as abas do Veocode e as de fora) e o
// modo Código (o que mudou, commit e o terminal da pasta).
import { dismissable } from "../dismiss";
import { ArrowLeftRight, ChevronDown, Code2, Eye, FolderGit2, GitBranch, Maximize2, MessagesSquare, Minimize2, MoreHorizontal, PanelRightOpen, Pin, Plus, Sparkles, SquareTerminal, X } from "lucide-solid";
import { createEffect, createMemo, createRoot, createSignal, For, lazy, Match, on, onCleanup, onMount, Show, Suspense, Switch } from "solid-js";
import { accountById } from "../accounts";
import { closePane, isPinned, maximized, panes, paneChat, paneMode, projectState, replacePane, setMaximized, setPaneChat, setPaneMode, swapPanes, togglePin, type PaneMode } from "../board";
import { activeKey, closeTab, openInTab, selectTab, startConversation, tabsOf, type ConvTab } from "../convTabs";
import { drag, dropOver, startDrag } from "../drag";
import { chatOf, openConversation, setInput } from "../chat";
import { feedOf, loadedWhole } from "../feeds";
import { changeLabel, commitDraft, commitGit, fileDiff, git, gitOf, gitWords, loadGit, pullGit, pushGit, setCommitDraft, type GitChange } from "../git";
import { histFind, loadHist } from "../convHist";
import { customName } from "../forks";
import { outsideTurn } from "../outside";
import { openAccess } from "../modals";
import { isTauri } from "../api";
import { every } from "../every";
import { showChange } from "../showChange";
import { setProjMode } from "../layoutMode";
import { projects, setProjectId, setView, showToast, type ActivityEvent } from "../store";
import { ProjectIcon } from "./icons";
import { ChatTail, Composer, RealConversation, useFollow } from "./ChatPanel";
import { Delta } from "./Work";
import { DiffRows, parseDiff } from "./DiffView";
import { focusComposer } from "./MsgTools";
import { tx, txn } from "../i18n";

const ProjectTerminal = lazy(() => import("./ProjectTerminal"));

// relógio de 5 s: uma conversa de fora "trabalhando" é deduzida do tempo sem novidade
const now5 = createRoot(() => {
  const [t, setT] = createSignal(Date.now());
  setInterval(() => setT(Date.now()), 5000);
  return t;
});

/** Conversa de fora do Veocode que ainda aparece na troca: trabalhando agora ou mexida nas últimas 3 h. */
const OUTSIDE_FRESH = 3 * 3_600_000;
const EXT = "ext:";
const cut = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

/** Uma conversa do projeto na troca de conversas da coluna. */
interface Conv {
  key: string;
  title: string;
  ext: boolean;
  session?: string;
  busy: boolean;
  ask: boolean;
  err: boolean;
  last: number;
}

// a conversa de uma aba do Veocode volta inteira (como na tela do projeto) na 1ª vez que aparece
const filled = new Set<string>();
async function fillTab(pid: string, t: ConvTab) {
  const p = projects.find((x) => x.id === pid);
  const c = chatOf(t.key);
  if (!isTauri || filled.has(t.key) || !p || p.demo || c.busy || c.fork) return;
  filled.add(t.key);
  const blank = { lastPrompt: null, origin: null, updated: 0, bytes: 0 };
  if (c.conv?.kind === "api") {
    await openConversation(t.key, { id: c.conv.id, kind: "api", account: t.account ?? p.accountId, title: c.conv.title, ...blank }, true);
    return;
  }
  const session = c.session ?? t.session;
  if (!session || loadedWhole(session) || (t.account && t.account !== p.accountId)) return;
  await openConversation(t.key, { id: session, kind: "claude", account: p.accountId, title: t.title, ...blank }, true);
}

export default function ChatPane(props: { pid: string; index: number; span?: number }) {
  const p = () => projects.find((x) => x.id === props.pid)!;
  const a = () => accountById(p().accountId);
  const st = () => projectState(props.pid);
  const feed = () => feedOf(props.pid);
  const mode = () => paneMode(props.pid);

  // ------------------------------------------------ as conversas do projeto

  const tabs = () => tabsOf(props.pid);
  const sessionOf = (t: ConvTab) => chatOf(t.key).session ?? t.session ?? null;
  /** Cada evento na conversa dele: a aba que o marcou, a aba dona da sessão, ou a sessão de fora. */
  const groups = createMemo(() => {
    const byTab = new Set(tabs().map((t) => t.key));
    const bySession = new Map<string, string>();
    for (const t of tabs()) {
      const s = sessionOf(t);
      if (s) bySession.set(s, t.key);
    }
    const out = new Map<string, ActivityEvent[]>();
    const add = (k: string, e: ActivityEvent) => {
      const l = out.get(k);
      if (l) l.push(e);
      else out.set(k, [e]);
    };
    for (const e of feed().items) {
      if (e.agent === "disco") continue;
      if (e.tab) {
        if (byTab.has(e.tab)) add(e.tab, e);
      } else if (e.session) add(bySession.get(e.session) ?? EXT + e.session, e);
    }
    return out;
  });
  const lastTs = (l?: ActivityEvent[]) => (l?.length ? Math.max(...l.slice(-20).map((e) => e.ts ?? 0)) : 0);
  const convs = createMemo<Conv[]>(() => {
    const now = now5();
    const list: Conv[] = tabs().map((t) => {
      const c = chatOf(t.key);
      const evs = groups().get(t.key);
      const s = sessionOf(t);
      return {
        key: t.key,
        title: (s && customName(s)) || tx(t.title),
        ext: false,
        busy: c.busy || (!!evs && !!outsideTurn(evs.filter((e) => !e.sub), now)),
        ask: c.perms.length > 0,
        err: !!c.error,
        last: Math.max(lastTs(evs), c.lastAt ?? 0, t.at ?? 0),
      };
    });
    const ext: Conv[] = [];
    for (const [k, evs] of groups()) {
      if (!k.startsWith(EXT)) continue;
      const session = k.slice(EXT.length);
      const main = evs.filter((e) => !e.sub);
      const busy = !!outsideTurn(main, now);
      const last = lastTs(evs);
      if (!busy && now - last > OUTSIDE_FRESH && paneChat(props.pid) !== k) continue;
      const first = main.find((e) => e.kind === "user");
      const title = customName(session) ?? histFind(props.pid, session)?.title ?? (first ? cut(first.title.replace(/\n📎[^\n]*/g, ""), 48) : tx("Conversa de fora"));
      ext.push({ key: k, title, ext: true, session, busy, ask: false, err: false, last });
    }
    ext.sort((x, y) => y.last - x.last);
    return [...list, ...ext.slice(0, 6)];
  });
  // título das conversas de fora: a lista do projeto sabe o nome que o Claude deu
  createEffect(on(() => convs().some((c) => c.ext), (any) => any && isTauri && void loadHist(props.pid, 5 * 60_000)));

  /** A conversa na frente da coluna: a escolhida; sem escolha, a que mexeu por último (e fica nela). */
  const sel = createMemo<string, string | undefined>((prev) => {
    const list = convs();
    const has = (k?: string) => !!k && list.some((c) => c.key === k);
    const picked = paneChat(props.pid);
    if (has(picked)) return picked!;
    if (has(prev) && (groups().get(prev!)?.length || chatOf(prev!).busy)) return prev!;
    const best = [...list].sort((x, y) => y.last - x.last)[0];
    return best && best.last > 0 ? best.key : activeKey(props.pid);
  }, undefined);
  const cur = () => convs().find((c) => c.key === sel());
  const isExt = () => sel().startsWith(EXT);
  const events = createMemo(() => groups().get(sel()) ?? [], undefined, { equals: (x, y) => x.length === y.length && x[x.length - 1] === y[y.length - 1] });
  const chat = () => chatOf(sel());

  // a aba na frente traz a conversa inteira
  createEffect(on(sel, (k) => {
    if (k.startsWith(EXT)) return;
    const t = tabs().find((x) => x.key === k);
    if (t) void fillTab(props.pid, t);
  }));

  const pick = (k: string) => {
    setPaneChat(props.pid, k);
    // a aba escolhida aqui também fica na frente na tela do projeto
    if (!k.startsWith(EXT)) selectTab(props.pid, k);
  };
  const newConv = () => {
    const k = startConversation(props.pid);
    if (!k) return;
    setPaneChat(props.pid, k);
    if (mode() !== "ai") setPaneMode(props.pid, "ai");
    requestAnimationFrame(() => focusComposer(section));
  };
  /** Conversa de fora: continua numa aba do Veocode (a coluna passa para ela). */
  const adopt = async () => {
    const c = cur();
    if (!c?.session) return;
    const ok = await openInTab(props.pid, { id: c.session, kind: "claude", account: p().accountId, title: c.title, lastPrompt: null, origin: null, updated: c.last, bytes: 0 });
    if (!ok) return;
    const t = tabsOf(props.pid).find((x) => (chatOf(x.key).session ?? x.session) === c.session);
    if (t) pick(t.key);
    requestAnimationFrame(() => focusComposer(section));
  };

  // ------------------------------------------------ rolagem

  let scroller: HTMLDivElement | undefined;
  let section!: HTMLElement;
  const follow = useFollow(
    () => scroller,
    () => [events().length, chat().draft.length >> 6, chat().perms.length, chat().error],
    () => [sel(), mode()],
    () => events()[events().length - 1]?.kind === "user",
  );

  // ------------------------------------------------ cabeçalho

  const [pickProject, setPickProject] = createSignal(false);
  const [more, setMore] = createSignal(false);
  let titleBtn!: HTMLButtonElement;
  let moreBtn!: HTMLButtonElement;
  const openFull = () => {
    setProjectId(props.pid);
    setProjMode(mode() === "code" ? "code" : "ai");
    setView("workspace");
  };
  const others = () => projects.filter((x) => !x.demo && x.id !== props.pid);
  const full = () => maximized() === props.pid;

  return (
    <section
      class="pane"
      ref={section}
      data-drop-pane={props.pid}
      data-chat-key={sel()}
      classList={{ ask: st().tone === "ask", work: st().tone === "work", max: full(), "drop-on": dropOver() === props.pid, lifted: drag()?.kind === "pane" && drag()?.id === props.pid, "in-code": mode() === "code" }}
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
        <button class="pane-title" ref={titleBtn} onClick={() => setPickProject(!pickProject())} title={tx("{name} · arraste para trocar de lugar, clique para trocar o projeto", { name: p().name })}>
          <ProjectIcon id={p().id} name={p().name} stack={p().stack} size={18} />
          <strong>{p().name}</strong>
          <ChevronDown size={12} />
        </button>
        <span class={`pane-state ${st().tone}`} title={st().label}>
          <i />
          <span class="pane-state-text">{st().label}</span>
        </span>
        <Show when={isPinned(props.pid)}><span class="pane-pinned" title={tx("Fixado neste lugar")}><Pin size={11} /></span></Show>
        <span class="pane-gap" />
        <ModeSwitch pid={props.pid} mode={mode()} />
        <span class="pane-tools">
          <Show when={panes().length > 1}>
            <button class="icon-btn small" title={full() ? tx("Sair da tela cheia (Esc)") : tx("Tela cheia (os outros continuam rodando)")} onClick={() => setMaximized(full() ? null : props.pid)}>
              {full() ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
          </Show>
          <button class="icon-btn small" ref={moreBtn} classList={{ on: more() }} title={tx("Mais opções")} onClick={() => setMore(!more())}><MoreHorizontal size={14} /></button>
          <button class="icon-btn small pane-close" title={tx("Tirar da tela (o projeto continua na lista e trabalhando)")} onClick={() => closePane(props.pid)}><X size={13} /></button>
        </span>
        <Show when={more()}>
          <div class="menu pop-in pane-menu right" ref={(el) => dismissable(el, () => setMore(false), () => moreBtn)}>
            <button class="menu-item" onClick={() => (setMore(false), openFull())}><PanelRightOpen size={15} /><span>{tx("Abrir o projeto completo")}</span><small>{tx("arquivos, editor, terminal")}</small></button>
            <button class="menu-item" onClick={() => (setMore(false), newConv())}><Plus size={15} /><span>{tx("Nova conversa")}</span><small>{tx("as outras continuam")}</small></button>
            <button class="menu-item" onClick={() => (setMore(false), togglePin(props.pid))}><Pin size={15} /><span>{isPinned(props.pid) ? tx("Soltar deste lugar") : tx("Fixar neste lugar")}</span><small>{isPinned(props.pid) ? tx("pode dar lugar a outro") : tx("não sai sozinho")}</small></button>
            <button class="menu-item" onClick={() => (setMore(false), setPickProject(true))}><ArrowLeftRight size={15} /><span>{tx("Trocar o projeto desta coluna")}</span></button>
            <div class="menu-sep" />
            <button class="menu-item" onClick={() => (setMore(false), closePane(props.pid))}><X size={15} /><span>{tx("Tirar da tela")}</span></button>
          </div>
        </Show>
        <Show when={pickProject()}>
          <div class="menu pop-in pane-menu" ref={(el) => dismissable(el, () => setPickProject(false), () => titleBtn)}>
            <small class="menu-title">{tx("Mostrar nesta coluna")}</small>
            <For each={others()} fallback={<small class="menu-title">{tx("Nenhum outro projeto")}</small>}>
              {(o) => (
                <button class="menu-item" onClick={() => (replacePane(props.pid, o.id), setPickProject(false))}>
                  <ProjectIcon id={o.id} name={o.name} stack={o.stack} size={16} />
                  <span>{o.name}</span>
                  <Show when={panes().includes(o.id)}><small>{tx("troca de lugar")}</small></Show>
                </button>
              )}
            </For>
          </div>
        </Show>
      </header>

      <Show when={mode() === "ai"} fallback={<PaneCode pid={props.pid} />}>
        <div class="pane-convs" role="tablist" aria-label={tx("Conversas de {name}", { name: p().name })}>
          <For each={convs()}>
            {(c) => (
              <div
                class="pane-conv"
                role="tab"
                tabIndex={0}
                aria-selected={sel() === c.key}
                classList={{ on: sel() === c.key, busy: c.busy, ask: c.ask, err: c.err, ext: c.ext }}
                title={`${c.title}${c.ask ? tx(" · esperando você") : c.busy ? tx(" · trabalhando") : ""}${c.ext ? `\n${tx("Rodando fora do Veocode (Terminal, editor ou app do Claude)")}` : ""}`}
                onClick={() => pick(c.key)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), pick(c.key))}
              >
                <Show when={c.ext} fallback={<i class="conv-dot" />}><Eye size={11} class="pane-conv-ext" /></Show>
                <span>{c.title}</span>
                <Show when={!c.ext && tabs().length > 1}>
                  <button class="pane-conv-x" title={tx("Fechar a aba (a conversa fica no histórico)")} onClick={(e) => (e.stopPropagation(), void closeTab(props.pid, c.key))}><X size={10} /></button>
                </Show>
              </div>
            )}
          </For>
          <button class="pane-conv-new" title={tx("Nova conversa (as outras continuam)")} onClick={newConv}><Plus size={13} /></button>
        </div>

        <div class="chat-scroll pane-scroll" ref={scroller} onScroll={follow}>
          <Show when={feed().loaded || feed().items.length} fallback={<div class="pane-empty"><span class="spinner" /> {tx("Lendo a conversa…")}</div>}>
            <Show when={events().length || chat().busy || chat().error || chat().perms.length} fallback={<PaneIdle pid={props.pid} k={sel()} onFocus={() => focusComposer(section)} />}>
              <RealConversation pid={props.pid} events={events} tail={!isExt()} k={sel()} />
              <Show when={isExt()}><ChatTail pid={props.pid} k={sel()} events={events} /></Show>
            </Show>
          </Show>
        </div>

        <Show
          when={!isExt()}
          fallback={
            <div class="pane-ext">
              <Eye size={14} />
              <span>
                <b>{cur()?.busy ? tx("Trabalhando fora do Veocode") : tx("Conversa de fora do Veocode")}</b>
                <small>{tx("Terminal, editor ou app do Claude. Aqui é para acompanhar.")}</small>
              </span>
              <button class="ghost-btn small" disabled={cur()?.busy} title={cur()?.busy ? tx("Espere ela terminar lá fora para continuar aqui") : tx("Continua esta conversa numa aba do Veocode")} onClick={() => void adopt()}>
                {tx("Continuar aqui")}
              </button>
            </div>
          }
        >
          <Composer pid={props.pid} k={sel()} onLevel={() => openAccess(props.pid)} placeholder={tx("Pedir algo… (Enter envia)")} />
        </Show>
      </Show>
    </section>
  );
}

/** IA ou Código, só com ícones (o nome aparece ao passar o mouse). */
function ModeSwitch(props: { pid: string; mode: PaneMode }) {
  const set = (m: PaneMode) => setPaneMode(props.pid, m);
  return (
    <div class="pane-mode" role="radiogroup" aria-label={tx("Modo da coluna")}>
      <button role="radio" aria-checked={props.mode === "ai"} classList={{ on: props.mode === "ai" }} title={tx("IA: a conversa")} onClick={() => set("ai")}>
        <MessagesSquare size={13} />
      </button>
      <button role="radio" aria-checked={props.mode === "code"} classList={{ on: props.mode === "code" }} title={tx("Código: o que mudou, commit e terminal")} onClick={() => set("code")}>
        <Code2 size={13} />
      </button>
      <span class="pane-mode-thumb" style={{ transform: `translateX(${props.mode === "code" ? 100 : 0}%)` }} />
    </div>
  );
}

/** Coluna sem conversa recente: o projeto e ideias para começar. */
function PaneIdle(props: { pid: string; k: string; onFocus: () => void }) {
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
      <p>{tx("Nada nesta conversa ainda. Que tal começar por uma destas?")}</p>
      <div class="pane-ideas">
        <For each={ideas()}>
          {(t, i) => (
            <button style={{ "--i": i(), "--c": a().color }} onClick={() => (setInput(props.k, t), props.onFocus())}>
              <Sparkles size={12} /> {t}
            </button>
          )}
        </For>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- modo Código

/** O que mudou (com o diff ali mesmo), commit, enviar e baixar, e o terminal da pasta. */
function PaneCode(props: { pid: string }) {
  const [tab, setTab] = createSignal<"changes" | "term">("changes");
  const [open, setOpen] = createSignal<string | null>(null);
  const [acting, setActing] = createSignal(false);
  const entry = () => gitOf(props.pid);
  const st = () => entry().status;
  onMount(() => void loadGit(props.pid, !!st()));
  onCleanup(every(() => tab() === "changes" && void loadGit(props.pid, true), 4000));
  const rel = (path: string) => {
    const pre = st()?.prefix ?? "";
    return pre ? (path.startsWith(pre) ? path.slice(pre.length) : null) : path;
  };
  const changes = () => (st()?.changes ?? []).filter((c) => !c.path.endsWith("/"));
  const staged = () => changes().filter((c) => !c.untracked && !c.conflict && c.index !== ".").length;
  const byPath = createMemo(() => new Map(changes().map((c) => [c.path, c])));
  const paths = createMemo(() => changes().map((c) => c.path), [], { equals: (a, b) => a.length === b.length && a.every((x, i) => x === b[i]) });
  const msg = () => commitDraft(props.pid);
  const act = async (f: () => Promise<string | null>, ok: string) => {
    setActing(true);
    const err = await f();
    setActing(false);
    showToast(err ?? ok);
  };
  const commit = () => {
    if (!msg().trim()) return showToast(tx("Escreva a mensagem do commit"));
    void act(async () => {
      const err = await commitGit(props.pid, msg(), staged() === 0);
      if (!err) setCommitDraft(props.pid, "");
      return err;
    }, tx("Commit feito"));
  };
  return (
    <div class="pane-code">
      <div class="pane-code-bar">
        <div class="pane-seg" role="tablist">
          <button role="tab" aria-selected={tab() === "changes"} classList={{ on: tab() === "changes" }} onClick={() => setTab("changes")}>
            <FolderGit2 size={13} /> <span>{tx("Mudanças")}</span>
            <Show when={changes().length}><i class="pane-seg-n">{changes().length > 99 ? "99+" : changes().length}</i></Show>
          </button>
          <button role="tab" aria-selected={tab() === "term"} classList={{ on: tab() === "term" }} onClick={() => setTab("term")}>
            <SquareTerminal size={13} /> <span>{tx("Terminal")}</span>
          </button>
        </div>
        <span class="pane-gap" />
        <Show when={st()?.repo}>
          <span class="pane-branch" title={tx("Branch atual")}><GitBranch size={12} /> <span>{st()!.branch ?? "HEAD"}</span></span>
        </Show>
        <button class="icon-btn small" title={tx("Abrir no modo Código do projeto (editor e Git completos)")} onClick={() => showChange(props.pid, open())}><PanelRightOpen size={13} /></button>
      </div>
      <Switch>
        <Match when={tab() === "changes"}>
          <div class="pane-changes">
            <Show when={st()} fallback={<div class="pane-empty">{entry().error || <><span class="spinner" /> {tx("Lendo o git…")}</>}</div>}>
              <Show when={st()!.repo} fallback={<div class="pane-empty">{tx("Esta pasta não usa git.")}</div>}>
                <Show when={changes().length} fallback={<div class="pane-empty">{tx("Nada mudou desde o último commit.")}</div>}>
                  {/* pelo caminho: a leitura do git a cada 4 s traz objetos novos, e a linha
                      (com o diff aberto) não deve ser recriada por isso */}
                  <For each={paths()}>
                    {(path) => (
                      <Show when={byPath().get(path)}>
                        {(c) => <ChangeRow pid={props.pid} c={c()} rel={rel(path)} open={open() === rel(path)} onToggle={(r) => setOpen(open() === r ? null : r)} />}
                      </Show>
                    )}
                  </For>
                </Show>
              </Show>
            </Show>
          </div>
          <Show when={st()?.repo}>
            <div class="pane-commit">
              <input
                value={msg()}
                placeholder={staged() ? txn(staged(), "Mensagem do commit ({n} preparado)", "Mensagem do commit ({n} preparados)") : tx("Mensagem do commit (leva tudo)")}
                onInput={(e) => setCommitDraft(props.pid, e.currentTarget.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.isComposing && (e.preventDefault(), commit())}
              />
              <button class="primary-btn small" disabled={acting() || !changes().length} onClick={commit}>{tx("Commit")}</button>
              <Show when={st()!.ahead}>
                <button class="ghost-btn small" disabled={acting()} title={tx("Enviar: git push")} onClick={() => void act(() => pushGit(props.pid), tx("Enviado"))}>↑{st()!.ahead}</button>
              </Show>
              <Show when={st()!.behind}>
                <button class="ghost-btn small" disabled={acting()} title={tx("Baixar: git pull")} onClick={() => void act(() => pullGit(props.pid), tx("Atualizado"))}>↓{st()!.behind}</button>
              </Show>
            </div>
          </Show>
        </Match>
        <Match when={tab() === "term"}>
          <div class="pane-term">
            <Suspense fallback={<div class="pane-empty"><span class="spinner" /></div>}>
              <ProjectTerminal pid={props.pid} />
            </Suspense>
          </div>
        </Match>
      </Switch>
    </div>
  );
}

/** Um arquivo mudado: letra, nome, +/−; um clique mostra o diff ali mesmo. */
function ChangeRow(props: { pid: string; c: GitChange; rel: string | null; open: boolean; onToggle: (r: string) => void }) {
  const l = () => changeLabel(props.c);
  const name = () => props.c.path.slice(props.c.path.lastIndexOf("/") + 1);
  const dir = () => (props.c.path.includes("/") ? props.c.path.slice(0, props.c.path.lastIndexOf("/")) : "");
  const [raw, setRaw] = createSignal<string | null>(null);
  // abre: lê o diff; aberto e o arquivo mudou de novo (outros +/−): lê outra vez
  createEffect(on(() => [props.open, props.c.added, props.c.removed] as const, async ([o]) => {
    if (!o || !props.rel) return;
    try {
      setRaw(await fileDiff(props.pid, props.rel));
    } catch (e) {
      setRaw("");
      showToast(String(e instanceof Error ? e.message : e));
    }
  }));
  const parsed = createMemo(() => (raw() ? parseDiff(raw()!) : null));
  return (
    <div class="pane-change" classList={{ open: props.open }}>
      <button class="pane-change-row" disabled={props.rel === null} title={`${props.c.path} · ${tx(l().word)}`} onClick={() => props.rel !== null && props.onToggle(props.rel)}>
        <i class={`pane-letter ${l().tone}`}>{l().letter}</i>
        <span class="pane-change-name">{name()}</span>
        <small class="pane-change-dir">{dir()}</small>
        <Show when={props.c.added != null || props.c.removed != null}>
          <Delta add={props.c.added ?? 0} del={props.c.removed ?? 0} pid={props.rel !== null ? props.pid : null} path={props.rel} />
        </Show>
        <ChevronDown size={12} class="pane-change-chev" />
      </button>
      <Show when={props.open}>
        <div class="pane-diff">
          <Show when={parsed()} fallback={<div class="pane-empty"><span class="spinner" /></div>}>
            {(d) => (
              <Show when={!d().binary} fallback={<div class="pane-empty">{tx("Arquivo binário: o git não mostra as linhas dele.")}</div>}>
                <DiffRows rows={d().rows} ext={props.c.path.split(".").pop() ?? ""} split={false} />
              </Show>
            )}
          </Show>
        </div>
      </Show>
    </div>
  );
}
