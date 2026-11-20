// Modo IA, à esquerda: os projetos, cada um abrindo as conversas dele (como no Claude), da mais
// recente para a mais antiga. Ramos (bifurcações) ficam embaixo da conversa de onde saíram.
// Um clique abre a conversa no meio; o "+" do projeto começa uma conversa nova nele.
import { Archive, ArchiveRestore, ChevronRight, Code2, ExternalLink, FolderPlus, FolderSearch, GitBranch, LayoutGrid, Lock, Mail, MailOpen, MoreHorizontal, Pencil, Pin, PinOff, Plus, Search, SquarePen, SquareTerminal, Trash2, Check, Square, X } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js";
import { createStore } from "solid-js/store";
import { accountById } from "../accounts";
import { api, isTauri } from "../api";
import { openClaude } from "../access";
import { chatOf, deleteConvos, onChatDone, stopChat } from "../chat";
import { isArchived, isPinned, isUnread, setArchived, setPinned, setUnread } from "../convMarks";
import { focusMode, projMode, setFocusMode } from "../layoutMode";
import { histLoaded, histLoading, loadHist, dropFromHist } from "../convHist";
import { convItems, projectLive, shortAgo, type ConvItem } from "../convList";
import { activeKey, closeTab, concludeTab, forkConversation, openInTab, renameConversation, selectTab, startConversation, tabsOf } from "../convTabs";
import { every } from "../every";
import { setContextMenu, type MenuEntry } from "../fileActions";
import { gitTab } from "../git";
import { absPathOf, addProjectFromPicker, currentProject, projectId, projects, setProjectId, showToast, ws } from "../store";
import { ProjectIcon } from "./icons";
import { chatPane, showChatPane } from "./ChatPanel";
import { lang, tx, txn } from "../i18n";

const OPEN_KEY = "veocode.ai.groups";
const readOpen = (): Record<string, boolean> => {
  try {
    return JSON.parse(localStorage.getItem(OPEN_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
};
// projetos abertos na lista (o atual abre sozinho na primeira vez)
const [openGroups, setOpenGroups] = createStore<Record<string, boolean>>(readOpen());
const setGroup = (pid: string, v: boolean) => {
  setOpenGroups(pid, v);
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify({ ...openGroups }));
  } catch {
    /* sem armazenamento */
  }
};

// relógio de 30 em 30 s para "há 5 min" andar sozinho
const [now, setNow] = createSignal(Date.now());
let ticking = false;

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const focusComposer = () => requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".chat-panel .composer textarea")?.focus());

/** Troca para o projeto (se preciso) e espera a tela dele montar. */
async function goProject(pid: string) {
  if (projectId() === pid) return;
  setProjectId(pid);
  await new Promise((r) => setTimeout(r, 0));
}

export async function openItem(it: ConvItem) {
  if (it.locked) {
    return showToast(tx("Esta conversa é da conta {label}. Troque a conta do projeto para continuar nela.", { label: accountById(it.convo!.account).label }));
  }
  setUnread(it.id, false);
  await goProject(it.pid);
  if (it.tab) selectTab(it.pid, it.tab.key);
  else if (it.convo) await openInTab(it.pid, it.convo);
  showChatPane("chat");
}

export async function newConversationIn(pid: string) {
  await goProject(pid);
  setGroup(pid, true);
  if (startConversation(pid)) {
    showChatPane("chat");
    focusComposer();
  }
}

export async function forkItem(it: ConvItem) {
  if (!it.session || it.convo?.kind === "api") return showToast(tx("Só dá para bifurcar conversas do Claude que já têm mensagens"));
  if (it.locked) return openItem(it);
  await goProject(it.pid);
  const acc = it.convo?.account ?? currentProject().accountId;
  const k = await forkConversation(it.pid, { session: it.session, account: acc, title: it.title });
  if (k) showChatPane("chat");
}

/** Id da linha de uma aba na lista (o mesmo de convItems). */
const idOfTab = (pid: string, key: string) => {
  const c = chatOf(key);
  return c.session ?? c.conv?.id ?? tabsOf(pid).find((t) => t.key === key)?.session ?? key;
};
/** A conversa que está na tela agora (modo IA, conversa aberta no meio). */
const shownId = () => {
  if (projMode() !== "ai" || gitTab() !== "chat" || chatPane() !== "chat") return null;
  const pid = projectId();
  return idOfTab(pid, activeKey(pid));
};
// resposta pronta: não lida se você não estava olhando para ela; e sai do arquivo (tem coisa nova)
onChatDone((key) => {
  const pid = key.split("~")[0];
  const id = idOfTab(pid, key);
  setArchived(id, false);
  const seen = pid === projectId() && projMode() === "ai" && gitTab() === "chat" && chatPane() === "chat" && (focusMode() || activeKey(pid) === key);
  if (!seen) setUnread(id, true);
});

const finderName = () => (navigator.userAgent.includes("Windows") ? "Explorer" : "Finder");

async function archiveItem(it: ConvItem) {
  if (isArchived(it.id)) return setArchived(it.id, false);
  if (it.busy) return showToast(tx("Pare a resposta antes de arquivar"));
  setArchived(it.id, true);
  setPinned(it.id, false);
  setUnread(it.id, false);
  if (it.tab) await closeTab(it.pid, it.tab.key);
  showToast(tx("Arquivada: fica em “Arquivadas”, no fim da lista do projeto. Nada foi apagado."));
}

export default function ConvSidebar() {
  const [q, setQ] = createSignal("");
  const [editing, setEditing] = createSignal<string | null>(null);
  // com o mouse em cima da lista a ordem não muda (o clique não cai na conversa vizinha);
  // a ordem nova entra quando o mouse sai
  const [hold, setHold] = createSignal(false);

  if (!ticking) {
    ticking = true;
    window.setInterval(() => setNow(Date.now()), 30_000);
  }
  // o projeto da frente sempre aparece aberto ao entrar nele
  createEffect(on(projectId, (pid) => openGroups[pid] === undefined && setGroup(pid, true)));
  // abriu a conversa: deixa de ser não lida (só na troca; "marcar como não lida" na da tela fica)
  createEffect(on(shownId, (id) => id && setUnread(id, false)));

  const p = currentProject;
  const real = () => isTauri && !p().demo;
  // o mesmo menu do Claude, com o que faz sentido aqui (não tem nuvem, janela nova nem seções:
  // as conversas já ficam no projeto de onde são)
  const menuFor = (it: ConvItem): MenuEntry[] => {
    const claudeSession = !!it.session && it.convo?.kind !== "api" && !it.locked;
    const marks = !it.blank;
    const items: MenuEntry[] = [];
    if (!it.locked && real()) {
      const open: MenuEntry[] = [
        { label: tx("Lado a lado"), hint: tx("No modo foco, junto das outras abertas"), icon: () => <LayoutGrid size={14} />, key: "1", run: () => void openItem(it).then(() => setFocusMode(true)) },
      ];
      if (claudeSession) {
        open.push({
          label: tx("Terminal"),
          hint: tx("Continua esta conversa com claude --resume"),
          icon: () => <SquareTerminal size={14} />,
          key: "2",
          run: () => (it.busy ? showToast(tx("Pare a resposta antes de continuar no Terminal")) : void openClaude(it.pid, it.session!)),
        });
      }
      open.push(
        { head: tx("Pasta do projeto") },
        { label: tx("VS Code"), icon: () => <Code2 size={14} />, key: "3", run: () => void api.openInVscode(it.pid).catch((e) => showToast(String(e instanceof Error ? e.message : e))) },
        { label: finderName(), icon: () => <FolderSearch size={14} />, key: "4", run: () => { const abs = absPathOf(it.pid); if (abs) void api.reveal(abs).catch((e) => showToast(String(e))); } },
      );
      items.push({ label: tx("Abrir em"), icon: () => <ExternalLink size={14} />, sub: open }, "sep");
    }
    if (marks && !it.forkOf) items.push({ label: isPinned(it.id) ? tx("Desafixar") : tx("Fixar"), icon: () => (isPinned(it.id) ? <PinOff size={14} /> : <Pin size={14} />), key: "P", run: () => setPinned(it.id, !isPinned(it.id)) });
    if (marks) items.push({ label: isUnread(it.id) ? tx("Marcar como lida") : tx("Marcar como não lida"), icon: () => (isUnread(it.id) ? <MailOpen size={14} /> : <Mail size={14} />), key: "U", run: () => setUnread(it.id, !isUnread(it.id)) });
    items.push({ label: tx("Renomear"), icon: () => <Pencil size={14} />, key: "R", run: () => setEditing(it.id) });
    if (claudeSession) items.push({ label: tx("Bifurcar"), hint: tx("Nova conversa a partir desta; a original não muda"), icon: () => <GitBranch size={14} />, key: "F", run: () => void forkItem(it) });
    if (it.busy && it.tab) items.push({ label: tx("Parar a resposta"), icon: () => <Square size={13} />, run: () => void stopChat(it.tab!.key) });
    if (it.tab && !it.blank && real()) items.push({ label: tx("Concluir: resumo na memória do projeto"), icon: () => <Check size={14} />, run: () => void concludeTab(it.pid, it.tab!.key) });
    if (it.tab && tabsOf(it.pid).length > 1) items.push({ label: tx("Tirar das abertas"), icon: () => <X size={14} />, run: () => void closeTab(it.pid, it.tab!.key) });
    if (marks || it.convo) items.push("sep");
    if (marks) items.push({ label: isArchived(it.id) ? tx("Desarquivar") : tx("Arquivar"), icon: () => (isArchived(it.id) ? <ArchiveRestore size={14} /> : <Archive size={14} />), key: "A", run: () => void archiveItem(it) });
    if (it.convo) {
      items.push({
        label: tx("Apagar…"),
        icon: () => <Trash2 size={14} />,
        danger: true,
        key: "D",
        run: async () => {
          if (it.busy) return showToast(tx("Pare a resposta antes de apagar"));
          const n = await deleteConvos(it.pid, [it.convo!], null);
          if (!n) return;
          dropFromHist(it.pid, [it.convo!.id]);
          for (const f of [setPinned, setArchived, setUnread]) f(it.id, false);
          if (it.tab) await closeTab(it.pid, it.tab.key);
        },
      });
    }
    return items;
  };
  const openMenu = (e: MouseEvent, it: ConvItem) => {
    e.preventDefault();
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setContextMenu({ x: e.type === "contextmenu" ? e.clientX : r.left, y: e.type === "contextmenu" ? e.clientY : r.bottom + 4, items: menuFor(it) });
  };

  function Row(props: { it: ConvItem; fork?: boolean }) {
    const it = () => props.it;
    const on = () => it().active && it().pid === projectId() && gitTab() === "chat" && chatPane() === "chat";
    const tip = () => [it().title, it().convo?.lastPrompt ? tx("Último pedido: {v}", { v: it().convo!.lastPrompt }) : "", it().convo?.origin ? tx("Começou em: {v}", { v: it().convo!.origin }) : ""].filter(Boolean).join("\n");
    return (
      <div
        class="cv-row"
        classList={{ on: on(), busy: it().busy, ask: it().ask, err: it().err, fork: !!props.fork, locked: it().locked, blank: it().blank, unread: isUnread(it().id) && !on(), pinned: isPinned(it().id), arch: isArchived(it().id) }}
        role="button"
        tabindex="0"
        title={tip()}
        onClick={() => editing() !== it().id && void openItem(it())}
        onKeyDown={(e) => e.key === "Enter" && editing() !== it().id && void openItem(it())}
        onDblClick={() => setEditing(it().id)}
        onContextMenu={(e) => openMenu(e, it())}
      >
        <span class="cv-st">
          <Show when={it().busy && !it().ask} fallback={<Show when={props.fork} fallback={<Show when={isPinned(it().id) && !it().ask && !it().err} fallback={<i class="cv-dot" />}><Pin size={10} class="cv-pin" /></Show>}><GitBranch size={11} /></Show>}>
            <span class="spinner inline" />
          </Show>
        </span>
        <Show
          when={editing() === it().id}
          fallback={
            <span class="cv-title">{it().blank ? tx("Nova conversa") : tx(it().title)}</span>
          }
        >
          <input
            class="cv-rename"
            value={it().title}
            ref={(el) => requestAnimationFrame(() => (el.focus(), el.select()))}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setEditing(null);
            }}
            onBlur={(e) => {
              if (editing() === it().id) renameConversation(it().pid, it().session, it().tab?.key ?? null, e.currentTarget.value);
              setEditing(null);
            }}
          />
        </Show>
        <span class="cv-meta">
          <Show when={it().ask} fallback={<Show when={it().locked} fallback={<Show when={!it().pendingFork} fallback={<em class="cv-tag" title={tx("O ramo nasce no próximo pedido; até lá a original não muda")}>{tx("ramo novo")}</em>}><small class="cv-time">{it().busy ? "" : it().blank ? "" : shortAgo(it().updated, now(), lang())}</small></Show>}><Lock size={10} /></Show>}>
            <small class="cv-wait">{tx("esperando você")}</small>
          </Show>
        </span>
        <button class="cv-more" title={tx("Mais ações")} onClick={(e) => openMenu(e, it())}>
          <MoreHorizontal size={14} />
        </button>
      </div>
    );
  }

  function Group(props: { pid: string }) {
    const pr = () => projects.find((x) => x.id === props.pid)!;
    const open = () => !!openGroups[props.pid];
    const cur = () => props.pid === projectId();
    const [shown, setShown] = createSignal(10);
    // lê o histórico ao abrir o grupo e de tempos em tempos enquanto ele está aberto
    createEffect(() => {
      if (!open() || pr().demo || !isTauri) return;
      void loadHist(props.pid);
      onCleanup(every(() => void loadHist(props.pid, 20_000), 30_000));
    });
    const all = createMemo(() => (pr().demo ? [] : convItems(props.pid)));
    // arquivadas ficam fora (a não ser na busca, em "Arquivadas" ou se voltaram a ser abertas);
    // fixadas sobem para o topo
    const [showArch, setShowArch] = createSignal(false);
    const archN = createMemo(() => all().reduce((n, x) => n + Number(isArchived(x.id)) + x.forks.filter((f) => isArchived(f.id)).length, 0));
    const unreadN = createMemo(() => all().reduce((n, x) => n + Number(isUnread(x.id)) + x.forks.filter((f) => isUnread(f.id)).length, 0));
    const items = createMemo(() => {
      const keep = (x: ConvItem) => showArch() || !!q().trim() || !isArchived(x.id) || x.busy || x.active;
      const list = all()
        .filter(keep)
        .map((x) => (x.forks.every(keep) ? x : { ...x, forks: x.forks.filter(keep) }));
      return [...list.filter((x) => isPinned(x.id)), ...list.filter((x) => !isPinned(x.id))];
    });
    const filtered = createMemo(() => {
      const t = norm(q().trim());
      if (!t) return items();
      const hit = (x: ConvItem) => norm(`${x.title} ${x.convo?.lastPrompt ?? ""}`).includes(t);
      return items().filter((x) => hit(x) || x.forks.some(hit));
    });
    let lastOrder: string[] = [];
    const ordered = createMemo(() => {
      const list = filtered();
      if (!hold() || !lastOrder.length) {
        lastOrder = list.map((x) => x.id);
        return list;
      }
      // as novas (sem lugar ainda) entram no topo
      const pos = new Map(lastOrder.map((id, i) => [id, i]));
      return [...list].sort((a, b) => (pos.get(a.id) ?? -1) - (pos.get(b.id) ?? -1));
    });
    // as linhas ficam as mesmas entre uma leitura e outra (só o texto muda): nada pisca e o
    // nome sendo editado não se perde
    const byId = createMemo(() => {
      const m = new Map<string, ConvItem>();
      for (const r of ordered()) {
        m.set(r.id, r);
        for (const f of r.forks) m.set(f.id, f);
      }
      return m;
    });
    const rootIds = createMemo(() => ordered().slice(0, shown()).map((x) => x.id));
    const live = () => projectLive(props.pid);
    const demoBusy = () => pr().demo && cur() && ws.running && !ws.paused;
    const pick = () => {
      if (!cur()) {
        setProjectId(props.pid);
        setGroup(props.pid, true);
      } else setGroup(props.pid, !open());
    };
    return (
      <Show when={!q().trim() || filtered().length || norm(pr().name).includes(norm(q().trim()))}>
        <div class="cv-group" classList={{ open: open() || !!q().trim(), cur: cur() }}>
          <div class="cv-ghead" role="button" tabindex="0" onClick={pick} onKeyDown={(e) => e.key === "Enter" && pick()} title={pr().path}>
            <button class="cv-chev" title={open() ? tx("Fechar") : tx("Abrir")} onClick={(e) => (e.stopPropagation(), setGroup(props.pid, !open()))}>
              <ChevronRight size={13} />
            </button>
            <ProjectIcon id={pr().id} name={pr().name} stack={pr().stack} size={16} />
            <span class="cv-gname">{pr().name}</span>
            <Show when={live().ask}><i class="cv-gask" title={tx("Esperando você")} /></Show>
            <Show when={!live().ask && !open() && unreadN()}><i class="cv-gunread" title={txn(unreadN(), "{n} resposta que você ainda não viu", "{n} respostas que você ainda não viu")} /></Show>
            <Show when={live().busy || demoBusy()}><span class="spinner inline" title={tx("Trabalhando")} /></Show>
            <Show when={!pr().demo}>
              <button class="cv-gnew" title={tx("Nova conversa em {name}", { name: pr().name })} onClick={(e) => (e.stopPropagation(), void newConversationIn(props.pid))}>
                <Plus size={13} />
              </button>
            </Show>
          </div>
          <Show when={open() || !!q().trim()}>
            <div class="cv-items">
              <Show
                when={!pr().demo}
                fallback={
                  <div class="cv-row" classList={{ on: cur(), busy: demoBusy() }} role="button" onClick={() => (setProjectId(props.pid), showChatPane("chat"))}>
                    <span class="cv-st"><Show when={demoBusy()} fallback={<i class="cv-dot" />}><span class="spinner inline" /></Show></span>
                    <span class="cv-title">{tx("Agente de exemplo")}</span>
                    <span class="cv-meta"><small class="cv-time">{tx("simulação")}</small></span>
                  </div>
                }
              >
                <For each={rootIds()}>
                  {(id) => (
                    <Show when={byId().get(id)}>
                      {(it) => (
                        <>
                          <Row it={it()} />
                          <Show when={it().forks.length}>
                            <div class="cv-forks">
                              <For each={it().forks.map((f) => f.id)}>{(fid) => <Show when={byId().get(fid)}>{(f) => <Row it={f()} fork />}</Show>}</For>
                            </div>
                          </Show>
                        </>
                      )}
                    </Show>
                  )}
                </For>
                <Show when={filtered().length > shown()}>
                  <button class="cv-more-list" onClick={() => setShown(shown() + 20)}>{tx("Mostrar mais ({n})", { n: filtered().length - shown() })}</button>
                </Show>
                <Show when={archN() && !q().trim()}>
                  <button class="cv-more-list cv-arch-btn" classList={{ on: showArch() }} onClick={() => setShowArch(!showArch())}>
                    <Archive size={12} /> {showArch() ? tx("Esconder as arquivadas") : txn(archN(), "{n} arquivada", "{n} arquivadas")}
                  </button>
                </Show>
                <Show when={!filtered().length}>
                  <p class="cv-empty">
                    <Show when={histLoading(props.pid) && !histLoaded(props.pid)} fallback={q().trim() ? tx("Nada com esse nome aqui.") : tx("Nenhuma conversa ainda.")}>
                      <span class="spinner inline" /> {tx("Lendo as conversas…")}
                    </Show>
                  </p>
                </Show>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    );
  }

  return (
    <div class="cs">
      <div class="cv-top">
        <button class="cv-new" onClick={() => void newConversationIn(projectId())} title={tx("Começar uma conversa nova neste projeto (⌘N)")}>
          <SquarePen size={14} />
          <span>{tx("Nova conversa")}</span>
          <kbd>⌘N</kbd>
        </button>
        <label class="cv-search">
          <Search size={13} />
          <input value={q()} placeholder={tx("Buscar conversas")} onInput={(e) => setQ(e.currentTarget.value)} onKeyDown={(e) => e.key === "Escape" && setQ("")} />
          <Show when={q()}><button class="cv-clear" title={tx("Limpar")} onClick={() => setQ("")}><X size={12} /></button></Show>
        </label>
      </div>
      <div class="cv-scroll" onPointerEnter={() => setHold(true)} onPointerLeave={() => setHold(false)}>
        <div class="cv-sec">
          <span>{tx("Projetos")}</span>
          <button class="icon-btn small" title={tx("Adicionar pasta")} onClick={() => void addProjectFromPicker()}><FolderPlus size={13} /></button>
        </div>
        <For each={projects}>{(pr) => <Group pid={pr.id} />}</For>
      </div>
    </div>
  );
}

/** Para o atalho ⌘N: conversa nova no projeto da frente. */
export const newConversationHere = () => void newConversationIn(projectId());
export { activeKey };
