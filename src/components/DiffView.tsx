// O que mudou num arquivo: o que era (esquerda) e o que é agora (direita), lado a lado como num
// editor, ou numa coluna só. Lê o diff do git e se atualiza sozinho enquanto está aberto.
// Também a revisão de tudo de uma vez (AllChanges): um arquivo embaixo do outro.
import { Check, ChevronRight, Columns2, FileText, RefreshCw, Rows3 } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Index, on, onCleanup, Show } from "solid-js";
import { every } from "../every";
import { textOf } from "../editing";
import { diffAll, fileDiff } from "../git";
import { openRealFile } from "../realProject";
import { currentProject, openFile } from "../store";
import { tokenize } from "../syntax";
import { FileIcon } from "./icons";
import { tx, txn } from "../i18n";

type Side = { n: number; t: string };
type Row = { k: "ctx" | "mod" | "del" | "add"; l?: Side; r?: Side } | { k: "hunk"; text: string; from: number };
type Parsed = { rows: Row[]; added: number; removed: number; binary: boolean; isNew: boolean; gone: boolean };

/** Diff unificado do git → linhas para mostrar lado a lado (remoções emparelhadas com adições). */
export function parseDiff(raw: string): Parsed {
  const rows: Row[] = [];
  let added = 0;
  let removed = 0;
  let binary = false;
  let isNew = false;
  let gone = false;
  let o = 0;
  let n = 0;
  let inHunk = false;
  let dels: Side[] = [];
  let adds: Side[] = [];
  const flush = () => {
    const len = Math.max(dels.length, adds.length);
    for (let i = 0; i < len; i++) {
      const l = dels[i];
      const r = adds[i];
      rows.push({ k: l && r ? "mod" : l ? "del" : "add", l, r });
    }
    dels = [];
    adds = [];
  };
  for (const line of raw.split("\n")) {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/.exec(line);
    if (h) {
      flush();
      o = Number(h[1]);
      n = Number(h[2]);
      inHunk = true;
      rows.push({ k: "hunk", text: h[3], from: n });
      continue;
    }
    if (!inHunk) {
      if (line.startsWith("Binary files")) binary = true;
      if (line.startsWith("new file mode") || line.startsWith("--- /dev/null")) isNew = true;
      if (line.startsWith("deleted file mode") || line.startsWith("+++ /dev/null")) gone = true;
      continue;
    }
    if (line.startsWith("diff --git")) {
      inHunk = false;
      continue;
    }
    const c = line[0];
    const t = line.slice(1);
    if (c === "-") (dels.push({ n: o++, t }), removed++);
    else if (c === "+") (adds.push({ n: n++, t }), added++);
    else if (c === " " || line === "") {
      if (line === "" && !dels.length && !adds.length && o === 0) continue;
      flush();
      rows.push({ k: "ctx", l: { n: o++, t }, r: { n: n++, t } });
    }
    // "\ No newline at end of file": nada a mostrar
  }
  flush();
  // a linha vazia do fim do texto do git não é do arquivo
  const last = rows[rows.length - 1];
  if (last && last.k === "ctx" && last.l?.t === "" && raw.endsWith("\n")) rows.pop();
  return { rows, added, removed, binary, isNew, gone };
}

const KEY = "veocode.diff.split";
const [split, setSplitRaw] = createSignal((() => {
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
})());
const setSplit = (v: boolean) => {
  setSplitRaw(v);
  try {
    localStorage.setItem(KEY, v ? "1" : "0");
  } catch {
    /* sem armazenamento */
  }
};

function Code(props: { t: string; ext: string }) {
  return (
    <span class="df-text">
      <For each={tokenize(props.t, props.ext)}>{(tk) => <span class={tk.c}>{tk.t}</span>}</For>
      {"​"}
    </span>
  );
}

function SplitSwitch() {
  return (
    <div class="df-seg" role="radiogroup" aria-label={tx("Como mostrar")}>
      <button role="radio" aria-checked={split()} classList={{ on: split() }} title={tx("Lado a lado: antes à esquerda, agora à direita")} onClick={() => setSplit(true)}><Columns2 size={13} /></button>
      <button role="radio" aria-checked={!split()} classList={{ on: !split() }} title={tx("Numa coluna só")} onClick={() => setSplit(false)}><Rows3 size={13} /></button>
    </div>
  );
}

/** As linhas de um diff: lado a lado (antes | agora) ou numa coluna só. */
export function DiffRows(props: { rows: Row[]; ext: string; split: boolean }) {
  return (
    <div class="df-grid" classList={{ split: props.split, unified: !props.split }}>
      <Index each={props.rows}>
        {(row) => (
          <Show
            when={row().k !== "hunk"}
            fallback={
              <div class="df-hunk">
                <span>{tx("linha {n}", { n: (row() as { from: number }).from })}</span>
                <Show when={(row() as { text: string }).text}><code>{(row() as { text: string }).text}</code></Show>
              </div>
            }
          >
            <Show
              when={props.split}
              fallback={
                <>
                  <Show when={(row() as { l?: Side }).l && row().k !== "ctx"}>
                    <div class="df-line del"><span class="df-n">{(row() as { l: Side }).l.n}</span><span class="df-n" /><span class="df-sign">−</span><Code t={(row() as { l: Side }).l.t} ext={props.ext} /></div>
                  </Show>
                  <Show when={(row() as { r?: Side }).r}>
                    <div class="df-line" classList={{ add: row().k !== "ctx" }}>
                      <span class="df-n">{row().k === "ctx" ? (row() as { l: Side }).l.n : ""}</span>
                      <span class="df-n">{(row() as { r: Side }).r.n}</span>
                      <span class="df-sign">{row().k === "ctx" ? "" : "+"}</span>
                      <Code t={(row() as { r: Side }).r.t} ext={props.ext} />
                    </div>
                  </Show>
                </>
              }
            >
              <div class="df-row" classList={{ [row().k]: true }}>
                <div class="df-side l" classList={{ blank: !(row() as { l?: Side }).l }}>
                  <span class="df-n">{(row() as { l?: Side }).l?.n ?? ""}</span>
                  <Show when={(row() as { l?: Side }).l}>{(l) => <Code t={l().t} ext={props.ext} />}</Show>
                </div>
                <div class="df-side r" classList={{ blank: !(row() as { r?: Side }).r }}>
                  <span class="df-n">{(row() as { r?: Side }).r?.n ?? ""}</span>
                  <Show when={(row() as { r?: Side }).r}>{(r) => <Code t={r().t} ext={props.ext} />}</Show>
                </div>
              </div>
            </Show>
          </Show>
        )}
      </Index>
    </div>
  );
}

export default function DiffView(props: { path: string }) {
  const pid = () => currentProject().id;
  const ext = () => props.path.split(".").pop() ?? "";
  const [raw, setRaw] = createSignal<string | null>(null);
  const [err, setErr] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  let seq = 0;
  const load = async () => {
    const my = ++seq;
    setBusy(true);
    try {
      const d = await fileDiff(pid(), props.path);
      if (my === seq) (setRaw(d), setErr(""));
    } catch (e) {
      if (my === seq) setErr(e instanceof Error ? e.message : String(e));
    }
    if (my === seq) setBusy(false);
  };
  createEffect(on(() => [pid(), props.path], () => (setRaw(null), void load())));
  // enquanto aberto: relê de tempos em tempos e logo depois de você digitar no arquivo
  onCleanup(every(() => void load(), 4000));
  let t: number | undefined;
  createEffect(on(() => textOf(props.path), () => (clearTimeout(t), (t = window.setTimeout(() => void load(), 700))), { defer: true }));
  onCleanup(() => clearTimeout(t));

  const d = createMemo(() => (raw() === null ? null : parseDiff(raw()!)));
  const name = () => props.path.split("/").pop() ?? props.path;
  const open = () => (currentProject().demo ? openFile(props.path) : openRealFile(props.path));

  return (
    <div class="diff-view">
      <div class="df-head">
        <span class="df-name" title={props.path}>
          <strong>{name()}</strong>
          <small>{props.path.includes("/") ? props.path.slice(0, props.path.lastIndexOf("/")) : ""}</small>
        </span>
        <Show when={d()}>
          {(x) => (
            <span class="df-count">
              <Show when={x().isNew}><em class="df-tag new">{tx("arquivo novo")}</em></Show>
              <Show when={x().gone}><em class="df-tag gone">{tx("apagado")}</em></Show>
              <b class="plus">+{x().added}</b>
              <b class="minus">−{x().removed}</b>
            </span>
          )}
        </Show>
        <span class="df-tools">
          <SplitSwitch />
          <button class="icon-btn small" classList={{ spin: busy() }} title={tx("Ler de novo")} onClick={() => void load()}><RefreshCw size={12} /></button>
          <Show when={!d()?.gone}>
            <button class="ghost-btn small" title={tx("Abrir o arquivo para editar")} onClick={open}><FileText size={12} /> {tx("Abrir arquivo")}</button>
          </Show>
        </span>
      </div>
      <Show when={split() && d() && d()!.rows.length}>
        <div class="df-cols"><span>{tx("Último commit")}</span><span>{tx("Agora")}</span></div>
      </Show>
      <div class="df-body">
        <Show when={!err()} fallback={<div class="df-empty">{err()}</div>}>
          <Show when={d()} fallback={<div class="df-empty"><span class="spinner" /> {tx("Lendo as mudanças…")}</div>}>
            {(x) => (
              <Show when={!x().binary} fallback={<div class="df-empty">{tx("Arquivo binário: o git não mostra as linhas dele.")}</div>}>
                <Show when={x().rows.length} fallback={<div class="df-empty"><strong>{tx("Sem mudanças")}</strong><span>{tx("O arquivo está igual ao último commit.")}</span></div>}>
                  <DiffRows rows={x().rows} ext={ext()} split={split()} />
                </Show>
              </Show>
            )}
          </Show>
        </Show>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- todas as mudanças

/** Diff de vários arquivos → um pedaço por arquivo (o caminho de agora; o antigo se foi apagado). */
export function splitDiff(raw: string): { path: string; raw: string }[] {
  return raw
    .split(/^(?=diff --git )/m)
    .filter((part) => part.startsWith("diff --git "))
    .map((part) => {
      const now = /^\+\+\+ b\/(.+)$/m.exec(part)?.[1];
      const before = /^--- a\/(.+)$/m.exec(part)?.[1];
      const head = /^diff --git a\/.+ b\/(.+)$/m.exec(part)?.[1];
      return { path: (now ?? before ?? head ?? "?").trim(), raw: part };
    });
}

// "visto" por projeto e arquivo: guarda o diff de quando foi marcado; se o arquivo mudar, volta a abrir
const [seen, setSeen] = createSignal<Record<string, string>>({});
const [manual, setManual] = createSignal<Record<string, boolean>>({});

/** Todas as mudanças da pasta numa tela só, um arquivo embaixo do outro, para revisar o que a IA
 *  (ou você) fez antes do commit. "Visto" recolhe o arquivo até ele mudar de novo. */
export function AllChanges() {
  const pid = () => currentProject().id;
  const [raw, setRaw] = createSignal<string | null>(null);
  const [err, setErr] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  let seq = 0;
  const load = async () => {
    const my = ++seq;
    setBusy(true);
    try {
      const d = await diffAll(pid());
      if (my === seq && d !== raw()) setRaw(d);
      if (my === seq) setErr("");
    } catch (e) {
      if (my === seq) setErr(e instanceof Error ? e.message : String(e));
    }
    if (my === seq) setBusy(false);
  };
  createEffect(on(pid, () => (setRaw(null), void load())));
  onCleanup(every(() => void load(), 5000));

  const files = createMemo(() => (raw() === null ? null : splitDiff(raw()!).map((f) => ({ ...f, d: parseDiff(f.raw) }))));
  const sum = () => (files() ?? []).reduce((t, f) => ({ a: t.a + f.d.added, r: t.r + f.d.removed }), { a: 0, r: 0 });
  const key = (path: string) => `${pid()}:${path}`;
  const isSeen = (f: { path: string; raw: string }) => seen()[key(f.path)] === f.raw;
  const isOpen = (f: { path: string; raw: string }) => manual()[key(f.path)] ?? !isSeen(f);
  const toggle = (f: { path: string; raw: string }) => setManual({ ...manual(), [key(f.path)]: !isOpen(f) });
  const markSeen = (f: { path: string; raw: string }) => {
    const k = key(f.path);
    const { [k]: _m, ...restManual } = manual();
    setManual(restManual);
    if (isSeen(f)) {
      const { [k]: _s, ...rest } = seen();
      setSeen(rest);
    } else setSeen({ ...seen(), [k]: f.raw });
  };
  const seenCount = () => (files() ?? []).filter(isSeen).length;
  const open = (path: string) => (currentProject().demo ? openFile(path) : openRealFile(path));

  return (
    <div class="diff-view all-changes">
      <div class="df-head">
        <span class="df-name">
          <strong>{tx("Todas as mudanças")}</strong>
          <Show when={files()?.length}>
            <small>{txn(files()!.length, "{n} arquivo", "{n} arquivos")}{seenCount() ? ` · ${txn(seenCount(), "{n} visto", "{n} vistos")}` : ""}</small>
          </Show>
        </span>
        <Show when={files()?.length}>
          <span class="df-count"><b class="plus">+{sum().a}</b><b class="minus">−{sum().r}</b></span>
        </Show>
        <span class="df-tools">
          <SplitSwitch />
          <button class="icon-btn small" classList={{ spin: busy() }} title={tx("Ler de novo")} onClick={() => void load()}><RefreshCw size={12} /></button>
        </span>
      </div>
      <div class="df-body">
        <Show when={!err()} fallback={<div class="df-empty">{err()}</div>}>
          <Show when={files()} fallback={<div class="df-empty"><span class="spinner" /> {tx("Lendo as mudanças…")}</div>}>
            {(list) => (
              <Show when={list().length} fallback={<div class="df-empty"><strong>{tx("Sem mudanças")}</strong><span>{tx("A pasta está igual ao último commit.")}</span></div>}>
                <Index each={list()}>
                  {(f) => {
                    const name = () => f().path.split("/").pop() ?? f().path;
                    const dir = () => (f().path.includes("/") ? f().path.slice(0, f().path.lastIndexOf("/")) : "");
                    return (
                      <section class="df-file" classList={{ open: isOpen(f()), seen: isSeen(f()) }}>
                        <header class="df-file-head" role="button" tabindex="0" aria-expanded={isOpen(f())} onClick={() => toggle(f())} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggle(f()))}>
                          <ChevronRight size={13} class="df-chev" />
                          <FileIcon name={name()} size={13} />
                          <span class="df-name" title={f().path}>
                            <strong>{name()}</strong>
                            <small>{dir()}</small>
                          </span>
                          <Show when={f().d.isNew}><em class="df-tag new">{tx("arquivo novo")}</em></Show>
                          <Show when={f().d.gone}><em class="df-tag gone">{tx("apagado")}</em></Show>
                          <span class="df-count">
                            <Show when={f().d.added}><b class="plus">+{f().d.added}</b></Show>
                            <Show when={f().d.removed}><b class="minus">−{f().d.removed}</b></Show>
                          </span>
                          <span class="df-file-tools" onClick={(e) => e.stopPropagation()}>
                            <button class="df-seen" classList={{ on: isSeen(f()) }} aria-pressed={isSeen(f())} title={isSeen(f()) ? tx("Marcar como não visto") : tx("Marcar como visto: recolhe até o arquivo mudar de novo")} onClick={() => markSeen(f())}>
                              <Check size={12} /> {tx("Visto")}
                            </button>
                            <Show when={!f().d.gone}>
                              <button class="icon-btn small" title={tx("Abrir o arquivo para editar")} onClick={() => open(f().path)}><FileText size={12} /></button>
                            </Show>
                          </span>
                        </header>
                        <Show when={isOpen(f())}>
                          <Show when={!f().d.binary && f().d.rows.length} fallback={<div class="df-file-empty">{f().d.binary ? tx("Arquivo binário: o git não mostra as linhas dele.") : tx("Nada para mostrar aqui (arquivo grande ou vazio).")}</div>}>
                            <DiffRows rows={f().d.rows} ext={name().split(".").pop() ?? ""} split={split()} />
                          </Show>
                        </Show>
                      </section>
                    );
                  }}
                </Index>
              </Show>
            )}
          </Show>
        </Show>
      </div>
    </div>
  );
}
