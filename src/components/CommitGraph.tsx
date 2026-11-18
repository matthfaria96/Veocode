// Desenho dos commits: cada branch é uma linha colorida; as linhas se separam
// quando alguém criou um branch e se juntam num merge. Clique num commit para
// ver os arquivos que ele mudou e, num arquivo, o que mudou dentro dele.

import { ChevronDown, ChevronRight, Cloud, ExternalLink, Laptop, Tag } from "lucide-solid";
import { createSignal, For, Show } from "solid-js";
import { api } from "../api";
import { commitDiff, commitFiles, since, type CommitFile, type GitCommit } from "../git";

const COLORS = ["#6b9cff", "#4cc38a", "#f5a524", "#e5649a", "#38bdf8", "#a78bfa", "#f97316", "#94a3b8"];
const LANE = 12;
const ROW = 34;
const color = (i: number) => COLORS[i % COLORS.length];
const x = (i: number) => 8 + i * LANE;

interface Seg { a: number; b: number; c: string }
interface Row { col: number; top: Seg[]; bottom: Seg[]; lanes: number }

/** Distribui os commits em faixas (uma por branch ativo) e calcula as linhas de cada linha da lista. */
export function layout(commits: GitCommit[]): Row[] {
  const known = new Set(commits.map((c) => c.hash));
  let lanes: (string | null)[] = [];
  const rows: Row[] = [];
  for (const c of commits) {
    let col = lanes.indexOf(c.hash);
    if (col < 0) {
      col = lanes.indexOf(null);
      if (col < 0) col = lanes.length;
      lanes[col] = c.hash;
    }
    const top: Seg[] = [];
    lanes.forEach((h, i) => {
      if (h === null) return;
      top.push({ a: i, b: h === c.hash ? col : i, c: color(i) });
    });
    // faixas que esperavam este commit se fecham nele
    lanes = lanes.map((h, i) => (h === c.hash && i !== col ? null : h));

    const parents = (c.parents ?? []).filter((p) => known.has(p));
    const from: number[] = lanes.map((_, i) => i);
    lanes[col] = parents[0] ?? null;
    for (const p of parents.slice(1)) {
      let j = lanes.indexOf(p);
      if (j < 0) {
        j = lanes.indexOf(null);
        if (j < 0) j = lanes.length;
        lanes[j] = p;
      }
      from[j] = col;
    }
    from[col] = col;
    const bottom: Seg[] = [];
    lanes.forEach((h, i) => {
      if (h !== null) bottom.push({ a: from[i] ?? i, b: i, c: color(i) });
    });
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
    rows.push({ col, top, bottom, lanes: Math.max(col + 1, ...top.map((s) => Math.max(s.a, s.b) + 1), ...bottom.map((s) => Math.max(s.a, s.b) + 1)) });
  }
  return rows;
}

function Lines(props: { row: Row; width: number; pushed: boolean; head: boolean }) {
  const r = props.row;
  const mid = ROW / 2;
  const path = (s: Seg, y1: number, y2: number) => {
    const x1 = x(s.a), x2 = x(s.b);
    return x1 === x2 ? `M${x1} ${y1} L${x2} ${y2}` : `M${x1} ${y1} C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`;
  };
  return (
    <svg class="graph-svg" width={props.width} height={ROW} viewBox={`0 0 ${props.width} ${ROW}`} aria-hidden="true">
      <For each={r.top}>{(s) => <path d={path(s, 0, mid)} stroke={s.c} />}</For>
      <For each={r.bottom}>{(s) => <path d={path(s, mid, ROW)} stroke={s.c} />}</For>
      <circle cx={x(r.col)} cy={mid} r={props.head ? 5 : 4} fill={props.pushed ? color(r.col) : "var(--bg)"} stroke={color(r.col)} stroke-width="2" />
    </svg>
  );
}

const statusWord: Record<string, string> = { A: "novo", M: "alterado", D: "apagado", R: "renomeado", C: "copiado", T: "tipo mudou" };

export default function CommitGraph(props: {
  pid: string;
  commits: GitCommit[];
  head: string | null;
  web: string | null;
  uncommitted: number;
  onUncommitted?: () => void;
}) {
  const rows = () => layout(props.commits);
  const width = () => Math.min(8, Math.max(1, ...rows().map((r) => r.lanes))) * LANE + 6;
  const [open, setOpen] = createSignal<string | null>(null);
  const [files, setFiles] = createSignal<CommitFile[] | null>(null);
  const [err, setErr] = createSignal("");
  const [diffOf, setDiffOf] = createSignal<string | null>(null);
  const [diff, setDiff] = createSignal("");

  const toggle = async (c: GitCommit) => {
    if (open() === c.hash) return setOpen(null);
    setOpen(c.hash);
    setFiles(null);
    setErr("");
    setDiffOf(null);
    try {
      setFiles(await commitFiles(props.pid, c.hash));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  const showDiff = async (c: GitCommit, f: CommitFile) => {
    if (diffOf() === f.path) return setDiffOf(null);
    setDiffOf(f.path);
    setDiff("Carregando…");
    try {
      setDiff(await commitDiff(props.pid, c.hash, f.path));
    } catch (e) {
      setDiff(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div class="commit-graph">
      <Show when={props.uncommitted > 0}>
        <button class="graph-row uncommitted" onClick={() => props.onUncommitted?.()}>
          <svg class="graph-svg" width={width()} height={ROW} aria-hidden="true">
            <path d={`M${x(rows()[0]?.col ?? 0)} ${ROW / 2} L${x(rows()[0]?.col ?? 0)} ${ROW}`} stroke="var(--line-2)" stroke-dasharray="3 3" />
            <circle cx={x(rows()[0]?.col ?? 0)} cy={ROW / 2} r="4" fill="none" stroke="var(--text-3)" stroke-dasharray="2 2" stroke-width="1.5" />
          </svg>
          <span class="graph-text">
            <span class="graph-subject">Mudanças ainda sem commit</span>
            <small>{props.uncommitted} {props.uncommitted === 1 ? "arquivo" : "arquivos"} · ainda não salvos no git</small>
          </span>
        </button>
      </Show>
      <For each={props.commits}>
        {(c, i) => {
          const isHead = () => !!props.head && c.hash.startsWith(props.head);
          const url = () => (props.web?.includes("github.com") ? `${props.web}/commit/${c.hash}` : null);
          return (
            <>
              <button class="graph-row" classList={{ open: open() === c.hash, head: isHead() }} onClick={() => toggle(c)} title={`${c.hash}\n${c.author} · ${new Date(c.time * 1000).toLocaleString("pt-BR")}`}>
                <Lines row={rows()[i()]} width={width()} pushed={c.pushed} head={isHead()} />
                <span class="graph-text">
                  <span class="graph-subject">
                    {open() === c.hash ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                    <span>{c.subject}</span>
                  </span>
                  <small>
                    <span class="graph-where" title={c.pushed ? "Já está no remoto (nuvem)" : "Só neste computador"}>{c.pushed ? <Cloud size={10} /> : <Laptop size={10} />}</span>
                    {c.author} · {since(c.time)}
                    <For each={c.refs.filter((r) => !r.endsWith("/HEAD")).slice(0, 3)}>
                      {(r) => (
                        <span class="git-ref" classList={{ tag: r.startsWith("tag: "), remote: r.includes("/") && !r.startsWith("tag: ") }}>
                          {r.startsWith("tag: ") ? <><Tag size={9} />{r.slice(5)}</> : r.includes("/") ? <><Cloud size={9} />{r}</> : <><Laptop size={9} />{r}</>}
                        </span>
                      )}
                    </For>
                  </small>
                </span>
              </button>
              <Show when={open() === c.hash}>
                <div class="graph-detail" style={{ "margin-left": `${width()}px` }}>
                  <Show when={!err()} fallback={<div class="git-hint">{err()}</div>}>
                    <Show when={files()} fallback={<div class="git-hint">Lendo o commit…</div>}>
                      <Show when={files()!.length} fallback={<div class="git-hint">Este commit não mudou arquivos (é só uma junção).</div>}>
                        <div class="graph-files-head">
                          {files()!.length} {files()!.length === 1 ? "arquivo" : "arquivos"} · clique para ver o que mudou
                          <Show when={url() && c.pushed}>
                            <button class="git-link" onClick={(e) => { e.stopPropagation(); void api.openUrl(url()!).catch(() => {}); }}><ExternalLink size={10} /> GitHub</button>
                          </Show>
                        </div>
                        <For each={files()!}>
                          {(f) => (
                            <>
                              <button class="graph-file" classList={{ open: diffOf() === f.path }} onClick={() => showDiff(c, f)} title={f.from ? `${f.from} → ${f.path}` : f.path}>
                                <span class={`gf-status s-${f.status}`}>{statusWord[f.status] ?? f.status}</span>
                                <span class="gf-path">{f.path}</span>
                                <Show when={f.added !== null} fallback={<small>binário</small>}>
                                  <small><span class="plus">+{f.added}</span> <span class="minus">−{f.removed}</span></small>
                                </Show>
                              </button>
                              <Show when={diffOf() === f.path}>
                                <pre class="graph-diff">
                                  <For each={diff().split("\n").filter((l) => !/^(diff --git|index |--- |\+\+\+ )/.test(l))}>
                                    {(l) => <span class={l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : l.startsWith("@@") ? "hunk" : ""}>{l || " "}{"\n"}</span>}
                                  </For>
                                </pre>
                              </Show>
                            </>
                          )}
                        </For>
                      </Show>
                    </Show>
                  </Show>
                </div>
              </Show>
            </>
          );
        }}
      </For>
    </div>
  );
}
