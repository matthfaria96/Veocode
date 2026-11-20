// O que mudou num arquivo: o que era (esquerda) e o que é agora (direita), lado a lado como num
// editor, ou numa coluna só. Lê o diff do git e se atualiza sozinho enquanto está aberto.
import { Columns2, FileText, RefreshCw, Rows3 } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Index, on, onCleanup, Show } from "solid-js";
import { every } from "../every";
import { textOf } from "../editing";
import { fileDiff } from "../git";
import { openRealFile } from "../realProject";
import { currentProject, openFile } from "../store";
import { tokenize } from "../syntax";
import { tx } from "../i18n";

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
          <div class="df-seg" role="radiogroup" aria-label={tx("Como mostrar")}>
            <button role="radio" aria-checked={split()} classList={{ on: split() }} title={tx("Lado a lado: antes à esquerda, agora à direita")} onClick={() => setSplit(true)}><Columns2 size={13} /></button>
            <button role="radio" aria-checked={!split()} classList={{ on: !split() }} title={tx("Numa coluna só")} onClick={() => setSplit(false)}><Rows3 size={13} /></button>
          </div>
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
                  <div class="df-grid" classList={{ split: split(), unified: !split() }}>
                    <Index each={x().rows}>
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
                            when={split()}
                            fallback={
                              <>
                                <Show when={(row() as { l?: Side }).l && row().k !== "ctx"}>
                                  <div class="df-line del"><span class="df-n">{(row() as { l: Side }).l.n}</span><span class="df-n" /><span class="df-sign">−</span><Code t={(row() as { l: Side }).l.t} ext={ext()} /></div>
                                </Show>
                                <Show when={(row() as { r?: Side }).r}>
                                  <div class="df-line" classList={{ add: row().k !== "ctx" }}>
                                    <span class="df-n">{row().k === "ctx" ? (row() as { l: Side }).l.n : ""}</span>
                                    <span class="df-n">{(row() as { r: Side }).r.n}</span>
                                    <span class="df-sign">{row().k === "ctx" ? "" : "+"}</span>
                                    <Code t={(row() as { r: Side }).r.t} ext={ext()} />
                                  </div>
                                </Show>
                              </>
                            }
                          >
                            <div class="df-row" classList={{ [row().k]: true }}>
                              <div class="df-side l" classList={{ blank: !(row() as { l?: Side }).l }}>
                                <span class="df-n">{(row() as { l?: Side }).l?.n ?? ""}</span>
                                <Show when={(row() as { l?: Side }).l}>{(l) => <Code t={l().t} ext={ext()} />}</Show>
                              </div>
                              <div class="df-side r" classList={{ blank: !(row() as { r?: Side }).r }}>
                                <span class="df-n">{(row() as { r?: Side }).r?.n ?? ""}</span>
                                <Show when={(row() as { r?: Side }).r}>{(r) => <Code t={r().t} ext={ext()} />}</Show>
                              </div>
                            </div>
                          </Show>
                        </Show>
                      )}
                    </Index>
                  </div>
                </Show>
              </Show>
            )}
          </Show>
        </Show>
      </div>
    </div>
  );
}
