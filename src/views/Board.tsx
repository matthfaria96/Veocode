import { ArrowUpRight, FolderMinus, FolderOpen, FolderPlus, GripVertical, LayoutGrid, Plus, SquareArrowOutUpRight } from "lucide-solid";
import { askCloseProject } from "../components/CloseProject";
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { accountById } from "../accounts";
import { api, isTauri } from "../api";
import { inGrid, maximized, panes, projectState, replacePane, setMaximized, toneOrder } from "../board";
import { gridFit, spanOf, useWidth } from "../gridFit";
import { drag, dropOver, startDrag } from "../drag";
import { watchFeeds } from "../feeds";
import { found, foundLoaded, loadFound, type Found } from "../found";
import { loadSummaries, since } from "../git";
import { needs } from "../attention";
import { absPathOf, addProjectFromPicker, addProjectPath, projects, projectsReady, projectsSlow, setProjectId, setView, showToast } from "../store";
import { every } from "../every";
import { dismissable } from "../dismiss";
import ChatPane from "../components/ChatPane";
import { ProjectIcon } from "../components/icons";
import { tx, txn } from "../i18n";

const ago = (secs: number) => since(secs);

/** Visão geral: os projetos na tela, cada um com a conversa ao vivo (arrastáveis), e os outros numa faixa embaixo. */
export default function Board() {
  const real = () => projects.filter((p) => !p.demo);

  // os da tela leem rápido; os de fora, devagar
  createEffect(on(() => real().map((p) => p.id).join(","), (ids) => {
    const stop = watchFeeds("board-all", ids ? ids.split(",") : [], 2500);
    onCleanup(stop);
  }));
  createEffect(on(() => panes().join(","), (ids) => {
    const stop = watchFeeds("board-grid", ids ? ids.split(",") : [], 900);
    onCleanup(stop);
  }));
  void loadSummaries(true);
  onCleanup(every(() => void loadSummaries(), 15000));
  onMount(() => void loadFound());
  const key = (e: KeyboardEvent) => {
    if (e.key === "Escape" && maximized()) setMaximized(null);
  };
  window.addEventListener("keydown", key);
  onCleanup(() => window.removeEventListener("keydown", key));

  const shown = () => (maximized() && panes().includes(maximized()!) ? [maximized()!] : panes());
  // grade que se ajusta ao número de projetos na tela (2, 3, 4, 6, 8, 9)
  let page!: HTMLDivElement;
  const width = useWidth(() => page);
  const fit = createMemo(() => gridFit(shown().length, width()));
  const shelf = createMemo(() =>
    [...real()].sort((a, b) => {
      const sa = projectState(a.id);
      const sb = projectState(b.id);
      return Number(inGrid(a.id)) - Number(inGrid(b.id)) || toneOrder[sa.tone] - toneOrder[sb.tone] || sb.at - sa.at || a.name.localeCompare(b.name);
    }),
  );

  // uma linha no topo: como estão as IAs agora (o detalhe fica em cada painel)
  const working = () => real().filter((p) => projectState(p.id).tone === "work").length;
  const asking = () => real().filter((p) => ["ask", "error"].includes(projectState(p.id).tone)).length;
  const status = () => {
    if (asking()) return { tone: "warn", text: txn(asking(), "Um projeto precisa de você", "{n} projetos precisam de você") };
    if (working()) return { tone: "ok", text: working() === 1 ? tx("Uma IA está trabalhando agora") : tx("{working} IAs estão trabalhando agora", { working: working() }) };
    return { tone: "idle", text: txn(real().length, "Tudo calmo · {n} projeto", "Tudo calmo · {n} projetos") };
  };

  return (
    <div class="page board home focus" ref={page}>
      <Show
        when={real().length}
        fallback={
          <div class="home-start">
            <header class="home-top">
              <div class="home-title">
                <h1>{tx("Visão geral")}</h1>
                <p class="home-status"><i />{tx("Vamos começar: escolha as pastas em que você quer trabalhar com IA.")}</p>
              </div>
            </header>
            <Show when={projectsReady()} fallback={<Show when={projectsSlow()} fallback={<div class="loading-rows"><div /><div /></div>}><PermWait /></Show>}><Discover /></Show>
          </div>
        }
      >
        {/* com projetos na tela o espaço é deles: o título e o "como estão as IAs" só aparecem
            com a tela vazia (o estado de cada um já está no próprio painel) */}
        <Show when={shown().length} fallback={
          <header class="home-top">
            <div class="home-title">
              <h1>{tx("Visão geral")}</h1>
              <p class="home-status" data-tone={status().tone}><i />{status().text}</p>
            </div>
            <NeedsStrip />
          </header>
        }>
          <NeedsStrip />
        </Show>
        <Show
          when={shown().length}
          fallback={
            <div class="board-empty" classList={{ "drop-on": dropOver() === "__empty", "is-dragging": !!drag() }} data-drop-pane="__empty">
              <span class="board-empty-icon"><LayoutGrid size={22} /></span>
              <strong>{tx("Nenhum projeto na tela")}</strong>
              <span>{tx("Clique num projeto aqui embaixo, ou arraste ele para cá.")}</span>
            </div>
          }
        >
          <div
            class="board-grid"
            classList={{ "is-dragging": !!drag(), single: shown().length === 1 }}
            style={{ "grid-template-columns": `repeat(${fit().units}, minmax(0, 1fr))`, "grid-template-rows": `repeat(${fit().rows}, minmax(${fit().rows > 2 ? 260 : 220}px, 1fr))`, "--rows": fit().rows }}
          >
            <For each={shown()}>{(id, i) => <ChatPane pid={id} index={i()} span={spanOf(fit(), i())} />}</For>
          </div>
        </Show>
        <Dock />
      </Show>

      <Show when={drag()}>
        {(d) => (
          <Portal>
            <div class="drag-ghost" classList={{ hit: !!dropOver() }} style={{ transform: `translate(${d().x + 14}px, ${d().y + 10}px)` }}>
              <GripVertical size={13} /> {d().label}
              <small>{dropOver() ? (d().kind === "pane" ? tx("solte para trocar de lugar") : tx("solte para pôr aqui")) : tx("leve até um painel")}</small>
            </div>
          </Portal>
        )}
      </Show>
    </div>
  );

  /** Sem projetos: as pastas onde você já usou o Claude, para adicionar com um clique. */
  function Discover() {
    return (
      <section class="discover">
        <div class="home-bar">
          <div>
            <h2>{tx("Comece por aqui")}</h2>
            <small>{found().length ? tx("Achamos estas pastas onde você já usou o Claude. Um clique e ela vira projeto.") : tx("Escolha uma pasta do seu computador para trabalhar com a IA.")}</small>
          </div>
          <Show when={isTauri}><button class="ghost-btn" onClick={() => void addProjectFromPicker()}><FolderPlus size={14} /> {tx("Escolher outra pasta")}</button></Show>
        </div>
        <Show when={foundLoaded()} fallback={<div class="loading-rows"><div /><div /></div>}>
          <div class="found-grid">
            <For each={found()}>{(f, i) => <FoundCard f={f} i={i()} />}</For>
            <button class="found-card pick" style={{ "--i": found().length }} onClick={() => void addProjectFromPicker()}>
              <span class="found-icon"><Plus size={20} /></span>
              <strong>{tx("Outra pasta")}</strong>
              <small>{tx("Escolher no Finder")}</small>
            </button>
          </div>
        </Show>
      </section>
    );
  }

  function FoundCard(props: { f: Found; i: number }) {
    const [busy, setBusy] = createSignal(false);
    const add = async () => {
      setBusy(true);
      await addProjectPath(props.f.path, false);
      setBusy(false);
    };
    return (
      <button class="found-card" style={{ "--i": props.i }} disabled={busy()} onClick={() => void add()} title={props.f.path}>
        <span class="found-icon"><ProjectIcon id={props.f.path} name={props.f.name} stack="" size={26} /></span>
        <strong>{props.f.name}</strong>
        <small>{txn(props.f.sessions, "{n} conversa", "{n} conversas")} · {ago(props.f.last)}</small>
        <span class="found-add">{busy() ? <span class="spinner inline" /> : <><Plus size={12} /> {tx("Adicionar")}</>}</span>
      </button>
    );
  }

  /** Clique direito num projeto da faixa: abrir, pôr na tela, mostrar no Finder e fechar o projeto. */
  function ProjectMenu(props: { id: string; at: { x: number; y: number }; onClose: () => void }) {
    const open = () => (setProjectId(props.id), setView("workspace"));
    const act = (f: () => void) => (e: MouseEvent) => (e.stopPropagation(), props.onClose(), f());
    const h = 170;
    const left = Math.max(12, Math.min(props.at.x, window.innerWidth - 232));
    const top = props.at.y + h + 12 > window.innerHeight ? props.at.y - h - 6 : props.at.y + 6;
    return (
      <Portal>
        <div class="menu pop-in card-menu" role="menu" ref={(el) => dismissable(el, props.onClose)} style={{ left: `${left}px`, top: `${top}px` }} onPointerDown={(e) => e.stopPropagation()}>
          <button class="menu-item" onClick={act(open)}><SquareArrowOutUpRight size={15} /><span>{tx("Abrir")}</span></button>
          <Show when={!inGrid(props.id)}>
            <button class="menu-item" onClick={act(() => replacePane(undefined, props.id))}><LayoutGrid size={15} /><span>{tx("Pôr na tela")}</span></button>
          </Show>
          <button class="menu-item" onClick={act(() => { const a = absPathOf(props.id); if (a) api.reveal(a).catch((e) => showToast(String(e))); })}><FolderOpen size={15} /><span>{tx("Mostrar no Finder")}</span></button>
          <div class="menu-sep" />
          <button class="menu-item danger" onClick={act(() => askCloseProject(props.id))}><FolderMinus size={15} /><span>{tx("Fechar projeto…")}</span></button>
        </div>
      </Portal>
    );
  }

  /** Embaixo, numa faixa: os projetos que não estão na tela (clique põe na tela, arraste escolhe o lugar, clique direito abre o menu). */
  function Dock() {
    const off = () => shelf().filter((p) => !inGrid(p.id));
    const [menu, setMenu] = createSignal<{ id: string; x: number; y: number } | null>(null);
    return (
      <div class="home-dock" role="list" aria-label={tx("Projetos fora da tela")}>
        <span class="dock-label">{tx("Outros projetos")}</span>
        <For each={off()}>
          {(p, i) => {
            const st = () => projectState(p.id);
            const a = () => accountById(p.accountId);
            const open = () => (setProjectId(p.id), setView("workspace"));
            return (
              <div
                class={`dock-item ${st().tone}`}
                role="listitem"
                classList={{ lifted: drag()?.id === p.id }}
                style={{ "--c": a().color, "--i": i() }}
                title={tx("{name} · {label}\nClique para pôr na tela · arraste até um painel para trocar · clique direito para mais", { name: p.name, label: st().label })}
                onPointerDown={(e) => e.button === 0 && startDrag(e, p.id, "project", p.name, (target) => replacePane(target, p.id))}
                onClick={() => replacePane(undefined, p.id)}
                onContextMenu={(e) => (e.preventDefault(), setMenu({ id: p.id, x: e.clientX, y: e.clientY }))}
              >
                <ProjectIcon id={p.id} name={p.name} stack={p.stack} size={18} />
                <span class="dock-name">{p.name}</span>
                <i class="dock-dot" />
                <button class="dock-open" title={tx("Abrir o projeto")} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => (e.stopPropagation(), open())}><ArrowUpRight size={12} /></button>
              </div>
            );
          }}
        </For>
        <Show when={!off().length}>
          <span class="dock-note">{tx("Todos os projetos estão na tela")}</span>
        </Show>
        <span class="dock-gap" />
        <AddCard dock />
        <Show when={menu()}>{(m) => <ProjectMenu id={m().id} at={{ x: m().x, y: m().y }} onClose={() => setMenu(null)} />}</Show>
      </div>
    );
  }

  function AddCard(_props: { dock?: boolean }) {
    const [pos, setPos] = createSignal<{ left: number; top?: number; bottom?: number; max: number } | null>(null);
    let btn!: HTMLButtonElement;
    const toggle = () => {
      if (pos()) return setPos(null);
      const r = btn.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - 12;
      const above = r.top - 12;
      const left = Math.max(12, Math.min(r.left, window.innerWidth - 320));
      // abre para o lado com mais espaço; nunca sai da janela
      setPos(below >= 260 || below >= above ? { left, top: r.bottom + 6, max: Math.min(380, below) } : { left, bottom: window.innerHeight - r.top + 6, max: Math.min(380, above) });
    };
    const close = () => setPos(null);
    let menu: HTMLDivElement | undefined;
    onMount(() => {
      // rolar a tela fecha (o menu ficaria solto); rolar a lista do próprio menu, não
      const off = (e: Event) => {
        if (menu && e.target instanceof Node && menu.contains(e.target)) return;
        close();
      };
      window.addEventListener("resize", off);
      document.addEventListener("scroll", off, true);
      onCleanup(() => (window.removeEventListener("resize", off), document.removeEventListener("scroll", off, true)));
    });
    return (
      <div class="shelf-add-wrap">
        <button class="dock-add" classList={{ open: !!pos() }} ref={btn} onClick={toggle} title={tx("Adicionar projeto")}>
          <Plus size={14} /> <span>{tx("Adicionar projeto")}</span>
        </button>
        <Show when={pos()}>
          {(p) => (
            <Portal>
              <div
                class="menu pop-in shelf-menu"
                ref={(el) => ((menu = el), dismissable(el, close, () => btn))}
                style={{ left: `${p().left}px`, top: p().top != null ? `${p().top}px` : "auto", bottom: p().bottom != null ? `${p().bottom}px` : "auto", "max-height": `${p().max}px` }}
              >
                <small class="menu-title">{tx("Onde você já usou o Claude")}</small>
                <For each={found().slice(0, 8)} fallback={<small class="menu-title">{tx("Nenhuma sugestão por aqui")}</small>}>
                  {(f) => (
                    <button class="menu-item" onClick={() => (close(), void addProjectPath(f.path, false))} title={f.path}>
                      <ProjectIcon id={f.path} name={f.name} stack="" size={16} />
                      <span>{f.name}</span>
                      <small>{ago(f.last)}</small>
                    </button>
                  )}
                </For>
                <div class="menu-sep" />
                <button class="menu-item" onClick={() => (close(), void addProjectFromPicker())}><FolderPlus size={16} /><span>{tx("Escolher outra pasta…")}</span></button>
              </div>
            </Portal>
          )}
        </Show>
      </div>
    );
  }
}

/** No topo da Visão geral: o que espera você agora (o resto fica no sininho). */
function NeedsStrip() {
  const top = () => needs().filter((n) => n.urgency !== "lembrete").slice(0, 3);
  return (
    <Show when={top().length}>
      <div class="needs-strip">
        <strong>{tx("Precisa de você")}</strong>
        <For each={top()}>
          {(n) => (
            <button class={`needs-chip ${n.urgency}`} onClick={() => n.go()} title={n.detail}>
              <i /> {n.title} <span>{n.action} →</span>
            </button>
          )}
        </For>
      </div>
    </Show>
  );
}

/** O macOS segura a leitura das pastas até você responder ao aviso de permissão. */
function PermWait() {
  return (
    <div class="perm-wait pop-in">
      <span class="perm-wait-dot" />
      <div>
        <strong>{tx("Esperando a permissão do macOS")}</strong>
        <small>{tx("Depois de atualizar o Veocode, o macOS pergunta de novo se ele pode abrir a pasta dos seus projetos (ex.: Documentos). Clique em")} <b>{tx("Permitir")}</b> {tx("no aviso do sistema e os projetos aparecem aqui sozinhos.")}</small>
      </div>
    </div>
  );
}
