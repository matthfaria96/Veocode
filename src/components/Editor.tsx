import { X } from "lucide-solid";
import { FileIcon } from "./icons";
import { createMemo, For, Index, Match, Show, Switch } from "solid-js";
import { formatSize } from "../api";
import { openRealFile } from "../realProject";
import { defaultFileContent, fileContents } from "../data/mock";
import { closeTab, currentProject, openFile, ws } from "../store";

type Tok = { t: string; c?: string };

const KW =
  /^(import|from|export|default|function|return|const|let|fn|pub|use|mod|struct|impl|mut|for|if|else|match|type|interface|async|await|new|self|Self|true|false)$/;

/** Realce de sintaxe simplificado — suficiente para o protótipo. */
function tokenize(line: string, ext: string): Tok[] {
  if (ext === "md") return [{ t: line, c: line.startsWith("#") ? "tk-head" : line.startsWith("-") ? "tk-str" : undefined }];
  const re = /(\/\/.*$|\/\*.*\*\/|\/\/\/.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`)|(<\/?[A-Za-z][\w.]*|\/?>)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][\w]*)(?=\s*\()|([A-Za-z_][\w]*)/g;
  const out: Tok[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push({ t: line.slice(last, m.index) });
    if (m[1]) out.push({ t: m[0], c: "tk-com" });
    else if (m[2]) out.push({ t: m[0], c: "tk-str" });
    else if (m[3]) out.push({ t: m[0], c: "tk-tag" });
    else if (m[4]) out.push({ t: m[0], c: "tk-num" });
    else if (m[5]) out.push({ t: m[0], c: KW.test(m[0]) ? "tk-kw" : "tk-fn" });
    else out.push({ t: m[0], c: KW.test(m[0]) ? "tk-kw" : /^[A-Z]/.test(m[0]) ? "tk-type" : undefined });
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({ t: line.slice(last) });
  return out;
}

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

/** Conteúdo de um arquivo real (somente leitura). */
function RealCode(props: { ext: string }) {
  const view = () => ws.contents[ws.activeFile];
  const text = () => {
    const v = view();
    return v?.kind === "text" ? v : null;
  };
  const lines = createMemo(() => {
    const t = text();
    if (!t) return [];
    const changed = new Set(ws.changedLines[ws.activeFile] ?? []);
    return t.text
      .split("\n")
      .slice(0, MAX_LINES)
      .map((line, i) => ({ t: line, added: changed.has(i + 1), removed: false }));
  });
  const totalLines = () => text()?.text.split("\n").length ?? 0;
  return (
    <Switch>
      <Match when={!view() || view()!.kind === "loading"}>
        <div class="editor-empty">carregando…</div>
      </Match>
      <Match when={view()!.kind === "error" && view()} keyed>
        {(v) => <div class="editor-empty">{(v as { message: string }).message}</div>}
      </Match>
      <Match when={view()!.kind === "binary"}>
        <div class="editor-empty">Arquivo binário ({formatSize((view() as { size: number }).size)}) — não dá para mostrar como texto.</div>
      </Match>
      <Match when={view()!.kind === "tooLarge"}>
        <div class="editor-empty">Arquivo grande demais ({formatSize((view() as { size: number }).size)}). O limite do visualizador é 1 MB.</div>
      </Match>
      <Match when={text()}>
        <CodeLines lines={lines()} ext={props.ext} />
        <Show when={totalLines() > MAX_LINES}>
          <div class="code-note">Mostrando as primeiras {MAX_LINES} de {totalLines()} linhas.</div>
        </Show>
      </Match>
    </Switch>
  );
}

export default function Editor() {
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
          {(path) => (
            <div class="tab" classList={{ active: ws.activeFile === path, edited: ws.marks[path] === "edit" || ws.marks[path] === "new" }} onClick={() => (currentProject().demo ? openFile(path) : openRealFile(path))}>
              <span class="tab-icon"><FileIcon name={path.split("/").pop() ?? path} size={12} /></span>
              <span class="tab-name">{path.split("/").pop()}</span>
              <span class="tab-dot" />
              <button
                class="tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(path);
                }}
              >
                <X size={12} />
              </button>
            </div>
          )}
        </For>
      </div>
      <Show when={ws.activeFile} fallback={<div class="editor-empty">{currentProject().demo ? "Nenhum arquivo aberto" : "Escolha um arquivo na árvore à esquerda"}</div>}>
        <div class="breadcrumb">{ws.activeFile.split("/").join("  ›  ")}</div>
        <Show when={currentProject().demo} fallback={<RealCode ext={ext()} />}>
          <CodeLines lines={lines()} ext={ext()} plusGutter />
        </Show>
      </Show>
    </div>
  );
}
