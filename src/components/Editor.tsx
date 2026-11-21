import { AlertTriangle, Check, ExternalLink, FileText, GitCommitHorizontal, GitCompareArrows, MessageSquare, Search, SquareTerminal, Waypoints, X } from "lucide-solid";
import { commitByHash } from "../git";
import { projMode } from "../layoutMode";
import { FileIcon } from "./icons";
import { ImageView } from "./Media";
import { isImagePath } from "../media";
import { createMemo, For, Index, lazy, Match, Show, Suspense, Switch, type JSX } from "solid-js";
import { LazyWait } from "./ui";

// diferenças, commits e o mapa abrem sob demanda: ficam em arquivos à parte
const DiffView = lazy(() => import("./DiffView"));
const AllChanges = lazy(() => import("./DiffView").then((m) => ({ default: m.AllChanges })));
const CommitView = lazy(() => import("./CommitView"));
const ProjectMap = lazy(() => import("./ProjectMap"));
import { api, formatSize } from "../api";
import { ask } from "../dialogs";
import { draftOf, dropDraft, edit, isUnsaved, saveNow, textOf } from "../editing";
import { openRealFile } from "../realProject";
import { defaultFileContent, fileContents } from "../data/mock";
import { ALL_CHANGES, MAP_TAB, closeTab, commitOfTab, currentProject, diffPathOf, isCommitTab, isDiffTab, openFile, projectId, showToast, ws } from "../store";
import { tx } from "../i18n";
import { tokenize } from "../syntax";

/** Arquivos com mais linhas que isso mostram só o começo (virtualização fica para depois). */
const MAX_LINES = 3000;

function CodeLines(props: { lines: { t: string; added: boolean; removed: boolean }[]; ext: string; plusGutter?: boolean }) {
  return (
    <div class="code">
      <Index each={props.lines}>
        {(l, i) => (
          <div class="code-line" classList={{ added: l().added, removed: l().removed }} data-target={`line:${i + 1}`}>
            <span class="gutter">{l().removed ? "−" : l().added && props.plusGutter ? "+" : i + 1}</span>
            <span class="code-text">
              <For each={tokenize(l().t, props.ext)}>{(tk) => <span class={tk.c}>{tk.t}</span>}</For>
              {"\u200b"}
            </span>
          </div>
        )}
      </Index>
    </div>
  );
}

/** Conteúdo de um arquivo real: dá para escrever direto; grava sozinho (editing.ts). */
function RealCode(props: { ext: string }) {
  const view = () => ws.contents[ws.activeFile];
  const path = () => ws.activeFile;
  const text = () => textOf(path());
  const big = () => (text()?.split("\n").length ?? 0) > MAX_LINES;
  const lines = createMemo(() => {
    const t = text();
    if (t === null || big()) return [];
    const changed = new Set(isUnsaved(path()) ? [] : ws.changedLines[path()] ?? []);
    return t.split("\n").map((line, i) => ({ t: line, added: changed.has(i + 1), removed: false }));
  });
  let area!: HTMLTextAreaElement;

  const onKey = (e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void saveNow(path());
      return;
    }
    if (e.key === "Tab" && !mod && !e.altKey) {
      // Tab escreve espaços em vez de sair do editor
      e.preventDefault();
      const { selectionStart: a, selectionEnd: b, value } = area;
      const indent = /\t/.test(value) && !/^ {2,}/m.test(value) ? "\t" : "  ";
      area.setRangeText(indent, a, b, "end");
      edit(path(), area.value);
    }
  };

  return (
    <Switch>
      <Match when={!view() || view()!.kind === "loading"}>
        <div class="editor-empty">{tx("carregando…")}</div>
      </Match>
      <Match when={view()!.kind === "error" && view()} keyed>
        {(v) => <div class="editor-empty">{(v as { message: string }).message}</div>}
      </Match>
      <Match when={(view()!.kind === "binary" || view()!.kind === "tooLarge") && isImagePath(path())}>
        <ImageView pid={projectId()} path={path()} size={(view() as { size: number }).size} />
      </Match>
      <Match when={view()!.kind === "binary" || view()!.kind === "tooLarge"}>
        <div class="editor-empty">
          <div class="editor-other">
            <span>
              {view()!.kind === "binary" ? tx("Este arquivo não é texto") : tx("Arquivo grande demais para o editor")} ({formatSize((view() as { size: number }).size)}).
            </span>
            <button class="primary-btn small" onClick={() => api.openEntry(projectId(), path()).catch((e) => showToast(String(e)))}><ExternalLink size={13} /> {tx("Abrir com o programa padrão")}</button>
          </div>
        </div>
      </Match>
      <Match when={text() !== null}>
        <div class="code edit-scroll">
          <div
            class="edit-wrap"
            classList={{ plain: big() }}
            onMouseDown={(e) => {
              // clicou no espaço vazio abaixo do texto: o cursor vai para o fim
              if (e.target === area) return;
              e.preventDefault();
              area.focus();
              area.setSelectionRange(area.value.length, area.value.length);
            }}
          >
            <Show when={!big()}>
              <CodeLines lines={lines()} ext={props.ext} />
            </Show>
            <textarea
              ref={area}
              class="edit-area"
              value={text() ?? ""}
              wrap="off"
              spellcheck={false}
              autocomplete="off"
              autocapitalize="off"
              aria-label={tx("Conteúdo de {path}", { path: path() })}
              rows={Math.max(lines().length, text()?.split("\n").length ?? 1)}
              onInput={(e) => edit(path(), e.currentTarget.value)}
              onKeyDown={onKey}
              onBlur={() => void saveNow(path())}
            />
          </div>
        </div>
      </Match>
    </Switch>
  );
}

/** Situação da gravação do arquivo aberto, embaixo das abas. */
function SaveState() {
  const d = () => draftOf(ws.activeFile);
  return (
    <span class="save-state" classList={{ err: d()?.status === "error" }}>
      <Show when={d()} fallback={<span>{tx("Clique no texto para editar · grava sozinho")}</span>}>
        {(x) => (
          <Switch>
            <Match when={x().status === "editing" || x().status === "saving"}><span class="spinner inline" /> {tx("Salvando…")}</Match>
            <Match when={x().status === "saved"}><Check size={12} /> {tx("Salvo")}</Match>
            <Match when={x().status === "error"}>
              <AlertTriangle size={12} /> {tx("Não salvou: {error}", { error: x().error })}
              <button class="link-btn" onClick={() => void saveNow(ws.activeFile)}>{tx("Tentar de novo")}</button>
            </Match>
          </Switch>
        )}
      </Show>
    </span>
  );
}

/** Fecha a aba; se ainda falta gravar, grava antes (e avisa se não deu). */
async function closeRealTab(path: string) {
  if (isUnsaved(path)) {
    const ok = await saveNow(path);
    if (!ok) {
      const r = await ask({
        title: tx("Não deu para salvar {pop}", { pop: path.split("/").pop() }),
        body: tx("Se fechar agora, o que você escreveu depois da última gravação se perde."),
        options: [
          { id: "cancel", label: tx("Voltar e tentar de novo"), tone: "ghost" },
          { id: "drop", label: tx("Fechar sem salvar"), tone: "danger" },
        ],
      });
      if (r?.id !== "drop") return;
    }
  }
  dropDraft(path);
  closeTab(path);
}

export default function Editor(props: { tools?: JSX.Element }) {
  const lines = createMemo(() => {
    const path = ws.activeFile;
    const base = path in fileContents ? fileContents[path].split("\n") : path === "src/components/Gauge.tsx" ? [] : defaultFileContent(path).split("\n");
    const ins = ws.inserted[path];
    if (!ins) return base.map((t) => ({ t, added: false, removed: false }));
    const before = base.slice(0, ins.from).map((t) => ({ t, added: false, removed: false }));
    const removed = base.slice(ins.from, ins.from + ins.remove).map((t) => ({ t, added: false, removed: true }));
    const after = base.slice(ins.from + ins.remove).map((t) => ({ t, added: false, removed: false }));
    return [...before, ...removed, ...ins.lines.map((t) => ({ t, added: true, removed: false })), ...after];
  });
  const ext = () => ws.activeFile.split(".").pop() ?? "";

  return (
    <div class="editor">
      <div class="tabs">
        <For each={ws.openTabs}>
          {(path) => {
            const diff = isDiffTab(path);
            const all = path === ALL_CHANGES;
            const commit = isCommitTab(path);
            const map = path === MAP_TAB;
            const file = diff ? diffPathOf(path) : path;
            const cm = () => (commit ? commitByHash(projectId(), commitOfTab(path)) : undefined);
            const cmName = () => {
              const sub = cm()?.subject ?? commitOfTab(path).slice(0, 7);
              return sub.length > 34 ? `${sub.slice(0, 33)}…` : sub;
            };
            return (
              <div class="tab" classList={{ active: ws.activeFile === path, diff, commit, edited: !diff && !currentProject().demo && isUnsaved(path) }} title={map ? tx("Mapa do projeto: as áreas, os arquivos e quem usa quem") : commit ? tx("Commit {v}: os arquivos e o que mudou em cada um", { v: commitOfTab(path).slice(0, 7) }) : all ? tx("Todas as mudanças desde o último commit") : diff ? tx("{path}: o que mudou desde o último commit", { path: file }) : !currentProject().demo && isUnsaved(path) ? tx("Salvando…") : path} onClick={() => (diff || currentProject().demo ? openFile(path) : openRealFile(path))}>
                <span class="tab-icon">{map ? <Waypoints size={12} /> : commit ? <GitCommitHorizontal size={12} /> : diff ? <GitCompareArrows size={12} /> : <FileIcon name={file.split("/").pop() ?? file} size={12} />}</span>
                <span class="tab-name">{map ? tx("Mapa do projeto") : commit ? cmName() : all ? tx("Todas as mudanças") : file.split("/").pop()}</span>
                <Show when={diff && !all && !map}><small class="tab-sub">{commit ? tx("commit") : tx("mudanças")}</small></Show>
                <span class="tab-dot" />
                <button
                  class="tab-close"
                  title={tx("Fechar")}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (diff || currentProject().demo) closeTab(path);
                    else void closeRealTab(path);
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            );
          }}
        </For>
        <Show when={props.tools}><div class="tabs-tools">{props.tools}</div></Show>
      </div>
      <Show
        when={!isDiffTab(ws.activeFile)}
        fallback={
          <Suspense fallback={<LazyWait />}>
            <Switch fallback={<DiffView path={diffPathOf(ws.activeFile)} />}>
              <Match when={ws.activeFile === ALL_CHANGES}><AllChanges /></Match>
              <Match when={isCommitTab(ws.activeFile)}><CommitView hash={commitOfTab(ws.activeFile)} /></Match>
              <Match when={ws.activeFile === MAP_TAB}><ProjectMap /></Match>
            </Switch>
          </Suspense>
        }
      >
      <Show when={ws.activeFile} fallback={<EditorHome />}>
        <div class="breadcrumb">
          <span>{ws.activeFile.split("/").join("  ›  ")}</span>
          <Show when={!currentProject().demo && ws.contents[ws.activeFile]?.kind === "text"}><SaveState /></Show>
        </div>
        <Show when={currentProject().demo} fallback={<RealCode ext={ext()} />}>
          <CodeLines lines={lines()} ext={ext()} plusGutter />
        </Show>
      </Show>
      </Show>
    </div>
  );
}

/** Sem arquivo aberto: em vez de um vazio, o que dá para fazer aqui, com atalhos. */
function EditorHome() {
  const p = () => currentProject();
  return (
    <div class="editor-empty editor-home">
      <div class="eh-glow" aria-hidden="true" />
      <strong>{p().name}</strong>
      <Show
        when={projMode() === "code"}
        fallback={
          <>
            <p>{p().demo ? tx("Nenhum arquivo aberto.") : tx("Converse com a IA no centro, ou abra um arquivo para ler e editar.")}</p>
            <div class="eh-tips">
              <span style={{ "--i": 0 }}><MessageSquare size={14} /> {tx("Peça algo à IA")} <em>{tx("no centro")}</em></span>
              <span style={{ "--i": 1 }}><FileText size={14} /> {tx("Abra um arquivo")} <em>{tx("na árvore à esquerda")}</em></span>
              <span style={{ "--i": 2 }}><Search size={14} /> {tx("Busque qualquer coisa")} <kbd>⌘K</kbd></span>
            </div>
          </>
        }
      >
        <p>{tx("Abra um arquivo na árvore para editar, ou veja o que mudou no painel Git, à direita.")}</p>
        <div class="eh-tips">
          <span style={{ "--i": 0 }}><FileText size={14} /> {tx("Abra um arquivo")} <em>{tx("na árvore à esquerda")}</em></span>
          <span style={{ "--i": 1 }}><GitCompareArrows size={14} /> {tx("Veja o que mudou e faça o commit")} <kbd>⌥⌘B</kbd></span>
          <span style={{ "--i": 2 }}><SquareTerminal size={14} /> {tx("Terminal")} <kbd>⌘J</kbd></span>
          <span style={{ "--i": 3 }}><Search size={14} /> {tx("Busque qualquer coisa")} <kbd>⌘K</kbd></span>
        </div>
      </Show>
    </div>
  );
}
