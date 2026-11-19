import { AlertTriangle, Check, ExternalLink, FileText, MessageSquare, Search, X } from "lucide-solid";
import { FileIcon } from "./icons";
import { ImageView } from "./Media";
import { isImagePath } from "../media";
import { createMemo, For, Index, Match, Show, Switch } from "solid-js";
import { api, formatSize } from "../api";
import { ask } from "../dialogs";
import { draftOf, dropDraft, edit, isUnsaved, saveNow, textOf } from "../editing";
import { openRealFile } from "../realProject";
import { defaultFileContent, fileContents } from "../data/mock";
import { closeTab, currentProject, openFile, projectId, showToast, ws } from "../store";

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
        <div class="editor-empty">carregando…</div>
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
              {view()!.kind === "binary" ? "Este arquivo não é texto" : "Arquivo grande demais para o editor"} ({formatSize((view() as { size: number }).size)}).
            </span>
            <button class="primary-btn small" onClick={() => api.openEntry(projectId(), path()).catch((e) => showToast(String(e)))}><ExternalLink size={13} /> Abrir com o programa padrão</button>
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
              aria-label={`Conteúdo de ${path()}`}
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
      <Show when={d()} fallback={<span>Clique no texto para editar · grava sozinho</span>}>
        {(x) => (
          <Switch>
            <Match when={x().status === "editing" || x().status === "saving"}><span class="spinner inline" /> Salvando…</Match>
            <Match when={x().status === "saved"}><Check size={12} /> Salvo</Match>
            <Match when={x().status === "error"}>
              <AlertTriangle size={12} /> Não salvou: {x().error}
              <button class="link-btn" onClick={() => void saveNow(ws.activeFile)}>Tentar de novo</button>
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
        title: `Não deu para salvar ${path.split("/").pop()}`,
        body: "Se fechar agora, o que você escreveu depois da última gravação se perde.",
        options: [
          { id: "cancel", label: "Voltar e tentar de novo", tone: "ghost" },
          { id: "drop", label: "Fechar sem salvar", tone: "danger" },
        ],
      });
      if (r?.id !== "drop") return;
    }
  }
  dropDraft(path);
  closeTab(path);
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
            <div class="tab" classList={{ active: ws.activeFile === path, edited: !currentProject().demo && isUnsaved(path) }} title={!currentProject().demo && isUnsaved(path) ? "Salvando…" : path} onClick={() => (currentProject().demo ? openFile(path) : openRealFile(path))}>
              <span class="tab-icon"><FileIcon name={path.split("/").pop() ?? path} size={12} /></span>
              <span class="tab-name">{path.split("/").pop()}</span>
              <span class="tab-dot" />
              <button
                class="tab-close"
                title="Fechar"
                onClick={(e) => {
                  e.stopPropagation();
                  if (currentProject().demo) closeTab(path);
                  else void closeRealTab(path);
                }}
              >
                <X size={12} />
              </button>
            </div>
          )}
        </For>
      </div>
      <Show when={ws.activeFile} fallback={<EditorHome />}>
        <div class="breadcrumb">
          <span>{ws.activeFile.split("/").join("  ›  ")}</span>
          <Show when={!currentProject().demo && ws.contents[ws.activeFile]?.kind === "text"}><SaveState /></Show>
        </div>
        <Show when={currentProject().demo} fallback={<RealCode ext={ext()} />}>
          <CodeLines lines={lines()} ext={ext()} plusGutter />
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
      <p>{p().demo ? "Nenhum arquivo aberto." : "Converse com a IA no centro, ou abra um arquivo para ler e editar."}</p>
      <div class="eh-tips">
        <span style={{ "--i": 0 }}><MessageSquare size={14} /> Peça algo à IA <em>no centro</em></span>
        <span style={{ "--i": 1 }}><FileText size={14} /> Abra um arquivo <em>na árvore à esquerda</em></span>
        <span style={{ "--i": 2 }}><Search size={14} /> Busque qualquer coisa <kbd>⌘K</kbd></span>
      </div>
    </div>
  );
}
