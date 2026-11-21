// O modo Código de uma coluna da tela Início: o mesmo jeito do modo Código do projeto, no tamanho da
// coluna. À esquerda, os arquivos (a árvore) ou as mudanças com o commit; no centro, várias abas
// abertas para editar (grava sozinho) e a comparação do que mudou; embaixo, o terminal da pasta.
// Coluna estreita: o painel da esquerda abre por cima do editor e sai da frente ao abrir um arquivo.
import { ChevronRight, ExternalLink, FileText, FolderGit2, Folders, GitBranch, GitCompareArrows, PanelLeft, PanelRightOpen, RefreshCw, SquareTerminal, X } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, lazy, Match, on, onCleanup, onMount, Show, Suspense, Switch } from "solid-js";
import { every } from "../every";
import { isUnsaved } from "../editing";
import { changeLabel, commitDraft, commitGit, fileDiff, gitOf, loadGit, pullGit, pushGit, setCommitDraft, type GitChange } from "../git";
import { closePaneTab, filesOf, loadPaneDir, openPaneTab, setPaneSide, togglePaneDir, togglePaneSide, togglePaneTerm } from "../paneFiles";
import { openChangeInProject } from "../showChange";
import { DIFF, projects, showToast } from "../store";
import type { FileEntry } from "../api";
import { DiffRows, parseDiff } from "./DiffView";
import { EditFile, readyToClose, SaveState } from "./Editor";
import { FileIcon, FolderIcon } from "./icons";
import { Delta } from "./Work";
import { tx, txn } from "../i18n";

const ProjectTerminal = lazy(() => import("./ProjectTerminal"));

/** Abaixo disso o painel da esquerda abre por cima do editor (não divide a coluna). */
const NARROW = 620;

const nameOf = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

export default function PaneCode(props: { pid: string; onOpenFull: () => void }) {
  const f = () => filesOf(props.pid);
  const proj = () => projects.find((x) => x.id === props.pid);
  const entry = () => gitOf(props.pid);
  const st = () => entry().status;

  let root!: HTMLDivElement;
  const [narrow, setNarrow] = createSignal(false);
  onMount(() => {
    const ro = new ResizeObserver(([e]) => setNarrow(e.contentRect.width < NARROW));
    ro.observe(root);
    onCleanup(() => ro.disconnect());
    if (!f().tree[""]) void loadPaneDir(props.pid, "");
    void loadGit(props.pid, !!st());
    // estreita e já com arquivo aberto: começa no editor
    if (root.clientWidth < NARROW && f().tabs.length) setPaneSide(props.pid, null);
  });
  // o git em dia: as letras da árvore, a lista de mudanças e o diff aberto
  onCleanup(every(() => void loadGit(props.pid, true), 4000));

  /** Caminho do git (a partir da raiz do repositório) → caminho dentro do projeto. */
  const rel = (path: string) => {
    const pre = st()?.prefix ?? "";
    return pre ? (path.startsWith(pre) ? path.slice(pre.length) : null) : path;
  };
  const changes = () => (st()?.changes ?? []).filter((c) => !c.path.endsWith("/"));
  /** As mudanças pelo caminho dentro do projeto (para a árvore e as abas). */
  const byRel = createMemo(() => {
    const m = new Map<string, GitChange>();
    for (const c of changes()) {
      const r = rel(c.path);
      if (r !== null) m.set(r, c);
    }
    return m;
  });
  /** Pastas com alguma mudança dentro (a bolinha na árvore). */
  const dirty = createMemo(() => {
    const s = new Set<string>();
    for (const r of byRel().keys()) for (let d = dirOf(r); d; d = dirOf(d)) s.add(d);
    return s;
  });

  const open = (tab: string) => {
    openPaneTab(props.pid, tab);
    if (narrow()) setPaneSide(props.pid, null);
  };
  const close = async (tab: string) => {
    if (tab.startsWith(DIFF) || (await readyToClose(tab, props.pid))) closePaneTab(props.pid, tab);
  };
  const active = () => f().active;
  const isDiff = () => active().startsWith(DIFF);

  return (
    <div class="pcode" classList={{ narrow: narrow(), "side-on": f().sideOpen }} ref={root}>
      <Show when={f().sideOpen}>
        <aside class="pcode-side">
          <div class="pcode-side-head">
            <div class="pane-seg" role="tablist">
              <button role="tab" aria-selected={f().side === "files"} classList={{ on: f().side === "files" }} title={tx("Arquivos do projeto")} onClick={() => setPaneSide(props.pid, "files")}>
                <Folders size={13} /> <span>{tx("Arquivos")}</span>
              </button>
              <button role="tab" aria-selected={f().side === "changes"} classList={{ on: f().side === "changes" }} title={tx("O que mudou desde o último commit")} onClick={() => setPaneSide(props.pid, "changes")}>
                <FolderGit2 size={13} /> <span>{tx("Mudanças")}</span>
                <Show when={changes().length}><i class="pane-seg-n">{changes().length > 99 ? "99+" : changes().length}</i></Show>
              </button>
            </div>
            <span class="pane-gap" />
            <Show when={f().side === "files"}>
              <button class="icon-btn small" title={tx("Recarregar a lista de arquivos")} onClick={() => void loadPaneDir(props.pid, "")}><RefreshCw size={12} /></button>
            </Show>
          </div>
          <Switch>
            <Match when={f().side === "files"}>
              <div class="tree pcode-tree">
                <Show when={proj()?.exists !== false} fallback={<div class="tree-loading">{tx("A pasta {path} não existe mais.", { path: proj()?.path })}</div>}>
                  <Show when={f().tree[""]} fallback={<div class="tree-loading">{tx("carregando…")}</div>}>
                    <Level pid={props.pid} dir="" depth={0} active={active()} byRel={byRel()} dirty={dirty()} onOpen={open} />
                  </Show>
                </Show>
              </div>
            </Match>
            <Match when={f().side === "changes"}>
              <Changes pid={props.pid} changes={changes()} rel={rel} active={active()} onOpen={open} />
            </Match>
          </Switch>
          <Show when={st()?.repo}>
            <div class="pcode-branch" title={tx("Branch atual")}>
              <GitBranch size={12} /> <span>{st()!.branch ?? "HEAD"}</span>
              <Show when={st()!.ahead}><small>↑{st()!.ahead}</small></Show>
              <Show when={st()!.behind}><small>↓{st()!.behind}</small></Show>
            </div>
          </Show>
        </aside>
      </Show>
      <Show when={narrow() && f().sideOpen}>
        <div class="pcode-scrim" onClick={() => setPaneSide(props.pid, null)} />
      </Show>

      <div class="editor pcode-main">
        <div class="tabs pcode-tabs">
          <div class="pcode-tabs-lead">
            <button class="icon-btn small" classList={{ on: f().sideOpen }} title={f().sideOpen ? tx("Esconder arquivos e mudanças") : tx("Mostrar arquivos e mudanças")} onClick={() => togglePaneSide(props.pid)}>
              <PanelLeft size={14} />
            </button>
          </div>
          <For each={f().tabs}>
            {(tab) => {
              const diff = tab.startsWith(DIFF);
              const path = diff ? tab.slice(DIFF.length) : tab;
              return (
                <div
                  class="tab"
                  classList={{ active: active() === tab, diff, edited: !diff && isUnsaved(path, props.pid) }}
                  title={diff ? tx("{path}: o que mudou desde o último commit", { path }) : path}
                  onClick={() => openPaneTab(props.pid, tab)}
                  onAuxClick={(e) => e.button === 1 && void close(tab)}
                >
                  <span class="tab-icon">{diff ? <GitCompareArrows size={12} /> : <FileIcon name={nameOf(path)} size={12} />}</span>
                  <span class="tab-name">{nameOf(path)}</span>
                  <Show when={diff}><small class="tab-sub">{tx("mudanças")}</small></Show>
                  <span class="tab-dot" />
                  <button class="tab-close" title={tx("Fechar")} onClick={(e) => (e.stopPropagation(), void close(tab))}><X size={12} /></button>
                </div>
              );
            }}
          </For>
          <div class="tabs-tools">
            <button class="icon-btn small" classList={{ on: f().term }} title={f().term ? tx("Esconder o terminal") : tx("Terminal da pasta do projeto")} onClick={() => togglePaneTerm(props.pid)}><SquareTerminal size={14} /></button>
            <button class="icon-btn small" title={tx("Abrir no projeto completo (editor, Git e terminal)")} onClick={() => (isDiff() ? openChangeInProject(props.pid, active().slice(DIFF.length)) : props.onOpenFull())}><PanelRightOpen size={14} /></button>
          </div>
        </div>

        <div class="pcode-view">
          <Show when={active()} fallback={<PaneCodeHome pid={props.pid} changed={changes().length} onChanges={() => setPaneSide(props.pid, "changes")} onOpenFull={props.onOpenFull} />}>
            <Show when={isDiff()} fallback={
              <>
                <div class="breadcrumb">
                  <span>{active().split("/").join("  ›  ")}</span>
                  <Show when={f().contents[active()]?.kind === "text"}><SaveState pid={props.pid} path={active()} /></Show>
                </div>
                <EditFile pid={props.pid} path={active()} view={f().contents[active()]} ext={active().split(".").pop() ?? ""} />
              </>
            }>
              <PaneDiff pid={props.pid} path={active().slice(DIFF.length)} change={byRel().get(active().slice(DIFF.length))} onOpenFile={() => open(active().slice(DIFF.length))} />
            </Show>
          </Show>
        </div>

        <Show when={f().term}>
          <div class="pcode-term">
            <Suspense fallback={<div class="pane-empty"><span class="spinner" /></div>}>
              <ProjectTerminal
                pid={props.pid}
                tools={<button class="icon-btn small" title={tx("Esconder o terminal")} onClick={() => togglePaneTerm(props.pid)}><X size={13} /></button>}
              />
            </Suspense>
          </div>
        </Show>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- a árvore

interface TreeProps {
  pid: string;
  active: string;
  byRel: Map<string, GitChange>;
  dirty: Set<string>;
  onOpen: (path: string) => void;
}

function Level(props: TreeProps & { dir: string; depth: number }) {
  const listing = () => filesOf(props.pid).tree[props.dir];
  const pad = () => `${34 + props.depth * 14}px`;
  return (
    <div class="tree-level">
      <For each={listing()?.entries} fallback={<div class="tree-loading" style={{ "padding-left": pad() }}>{tx("pasta vazia")}</div>}>
        {(e) => <Entry {...props} e={e} />}
      </For>
      <Show when={(listing()?.truncated ?? 0) > 0}>
        <div class="tree-loading" style={{ "padding-left": pad() }}>{tx("+{truncated} itens não mostrados", { truncated: listing()!.truncated })}</div>
      </Show>
    </div>
  );
}

function Entry(props: TreeProps & { e: FileEntry; depth: number }) {
  const open = () => !!filesOf(props.pid).expanded[props.e.path];
  const ch = () => (props.e.isDir ? undefined : props.byRel.get(props.e.path));
  const l = () => (ch() ? changeLabel(ch()!) : null);
  const act = () => (props.e.isDir ? togglePaneDir(props.pid, props.e.path) : props.onOpen(props.e.path));
  return (
    <>
      <div
        role="button"
        tabIndex={0}
        class="tree-row"
        classList={{ active: props.active === props.e.path, ignored: props.e.ignored, dir: props.e.isDir, [`git-${l()?.tone}`]: !!l(), "has-change": props.e.isDir && props.dirty.has(props.e.path) }}
        style={{ "padding-left": `${10 + props.depth * 14}px` }}
        title={l() ? `${props.e.path} · ${tx(l()!.word)}` : props.e.path}
        onClick={act}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), act())}
      >
        <span class="tree-chevron" classList={{ open: open(), hidden: !props.e.isDir }}><ChevronRight size={12} /></span>
        <span class="tree-icon">{props.e.isDir ? <FolderIcon name={props.e.name} open={open()} /> : <FileIcon name={props.e.name} />}</span>
        <span class="tree-name">{props.e.name}</span>
        <Show when={!props.e.isDir && isUnsaved(props.e.path, props.pid)}><span class="tree-unsaved" title={tx("Salvando…")} /></Show>
        <Show when={l()}>{(x) => <i class={`pane-letter ${x().tone}`}>{x().letter}</i>}</Show>
        <Show when={props.e.isDir && props.dirty.has(props.e.path)}><span class="pcode-dirty" /></Show>
      </div>
      <Show when={props.e.isDir && open()}>
        <Show when={filesOf(props.pid).tree[props.e.path]} fallback={<div class="tree-loading" style={{ "padding-left": `${34 + props.depth * 14}px` }}>{tx("carregando…")}</div>}>
          <Level {...props} dir={props.e.path} depth={props.depth + 1} />
        </Show>
      </Show>
    </>
  );
}

// ---------------------------------------------------------------- as mudanças e o commit

function Changes(props: { pid: string; changes: GitChange[]; rel: (p: string) => string | null; active: string; onOpen: (tab: string) => void }) {
  const st = () => gitOf(props.pid).status;
  const [acting, setActing] = createSignal(false);
  const staged = () => props.changes.filter((c) => !c.untracked && !c.conflict && c.index !== ".").length;
  const msg = () => commitDraft(props.pid);
  const act = async (fn: () => Promise<string | null>, ok: string) => {
    setActing(true);
    const err = await fn();
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
    <>
      <div class="pane-changes">
        <Show when={st()} fallback={<div class="pane-empty">{gitOf(props.pid).error || <><span class="spinner" /> {tx("Lendo o git…")}</>}</div>}>
          <Show when={st()!.repo} fallback={<div class="pane-empty">{tx("Esta pasta não usa git.")}</div>}>
            <Show when={props.changes.length} fallback={<div class="pane-empty">{tx("Nada mudou desde o último commit.")}</div>}>
              <For each={props.changes}>
                {(c) => {
                  const r = () => props.rel(c.path);
                  const l = () => changeLabel(c);
                  return (
                    <button
                      class="pane-change-row"
                      classList={{ on: r() !== null && props.active === DIFF + r() }}
                      disabled={r() === null}
                      title={`${c.path} · ${tx(l().word)}`}
                      onClick={() => r() !== null && props.onOpen(DIFF + r())}
                    >
                      <i class={`pane-letter ${l().tone}`}>{l().letter}</i>
                      <span class="pane-change-name">{nameOf(c.path)}</span>
                      <small class="pane-change-dir">{dirOf(c.path)}</small>
                      <Show when={c.added != null || c.removed != null}><Delta add={c.added ?? 0} del={c.removed ?? 0} /></Show>
                    </button>
                  );
                }}
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
          <button class="primary-btn small" disabled={acting() || !props.changes.length} onClick={commit}>{tx("Commit")}</button>
          <Show when={st()!.ahead}>
            <button class="ghost-btn small" disabled={acting()} title={tx("Enviar: git push")} onClick={() => void act(() => pushGit(props.pid), tx("Enviado"))}>↑{st()!.ahead}</button>
          </Show>
          <Show when={st()!.behind}>
            <button class="ghost-btn small" disabled={acting()} title={tx("Baixar: git pull")} onClick={() => void act(() => pullGit(props.pid), tx("Atualizado"))}>↓{st()!.behind}</button>
          </Show>
        </div>
      </Show>
    </>
  );
}

// ---------------------------------------------------------------- a comparação

/** O que mudou num arquivo, numa coluna só; relê quando o arquivo muda de novo (outros +/−). */
function PaneDiff(props: { pid: string; path: string; change: GitChange | undefined; onOpenFile: () => void }) {
  const [raw, setRaw] = createSignal<string | null>(null);
  createEffect(on(() => [props.path, props.change?.added, props.change?.removed] as const, async ([path], prev) => {
    if (!prev || prev[0] !== path) setRaw(null);
    try {
      const d = await fileDiff(props.pid, path);
      if (path === props.path) setRaw(d);
    } catch (e) {
      setRaw("");
      showToast(String(e instanceof Error ? e.message : e));
    }
  }));
  const parsed = createMemo(() => (raw() ? parseDiff(raw()!) : null));
  const gone = () => props.change && changeLabel(props.change).tone === "deleted";
  return (
    <div class="pcode-diff">
      <div class="breadcrumb">
        <span>{props.path.split("/").join("  ›  ")}</span>
        <Show when={props.change && (props.change.added != null || props.change.removed != null)}>
          <Delta add={props.change!.added ?? 0} del={props.change!.removed ?? 0} />
        </Show>
        <Show when={!gone()}>
          <button class="link-btn" onClick={props.onOpenFile}><FileText size={12} /> {tx("Abrir o arquivo")}</button>
        </Show>
      </div>
      <div class="pcode-diff-body">
        <Show when={raw() !== null} fallback={<div class="pane-empty"><span class="spinner" /></div>}>
          <Show when={parsed()} fallback={<div class="pane-empty">{tx("Sem mudanças neste arquivo desde o último commit.")}</div>}>
            {(d) => (
              <Show when={!d().binary} fallback={<div class="pane-empty">{tx("Arquivo binário: o git não mostra as linhas dele.")}</div>}>
                <DiffRows rows={d().rows} ext={props.path.split(".").pop() ?? ""} split={false} />
              </Show>
            )}
          </Show>
        </Show>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- sem aba aberta

function PaneCodeHome(props: { pid: string; changed: number; onChanges: () => void; onOpenFull: () => void }) {
  const p = () => projects.find((x) => x.id === props.pid);
  return (
    <div class="pcode-home">
      <strong>{p()?.name}</strong>
      <p>{tx("Abra um arquivo na árvore para editar. Dá para deixar vários abertos, cada um numa aba.")}</p>
      <div class="pcode-home-acts">
        <Show when={props.changed}>
          <button class="ghost-btn small" onClick={props.onChanges}><GitCompareArrows size={13} /> {txn(props.changed, "Ver {n} mudança", "Ver {n} mudanças")}</button>
        </Show>
        <button class="ghost-btn small" onClick={() => togglePaneTerm(props.pid)}><SquareTerminal size={13} /> {tx("Terminal")}</button>
        <button class="ghost-btn small" onClick={props.onOpenFull} title={tx("Abrir no projeto completo (editor, Git e terminal)")}><ExternalLink size={13} /> {tx("Projeto completo")}</button>
      </div>
    </div>
  );
}
