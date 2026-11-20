// Desenho dos commits: cada branch é uma linha colorida; as linhas se separam
// quando alguém criou um branch e se juntam num merge. Clique num commit para
// abrir, no lugar do editor, os arquivos dele com o antes e o depois lado a lado.

import { ChevronRight, Cloud, Laptop, Tag } from "lucide-solid";
import { For, Show } from "solid-js";
import { since, type GitCommit } from "../git";
import { ALL_CHANGES, COMMIT, openCommit, ws } from "../store";
import { locale, tx, txn } from "../i18n";

const COLORS = ["#6b9cff", "#4cc38a", "#f5a524", "#e5649a", "#38bdf8", "#a78bfa", "#f97316", "#94a3b8"];
const LANE = 12;
const ROW = 34;
const color = (i: number) => COLORS[i % COLORS.length];
const x = (i: number) => 8 + i * LANE;

interface Seg { a: number; b: number; c: string }
interface Row { col: number; top: Seg[]; bottom: Seg[]; lanes: number }

/** Distribui os commits em faixas (uma por branch ativo) e calcula as linhas de cada linha da lista. */
function layout(commits: GitCommit[]): Row[] {
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

export default function CommitGraph(props: {
  pid: string;
  commits: GitCommit[];
  head: string | null;
  uncommitted: number;
  onUncommitted?: () => void;
}) {
  const rows = () => layout(props.commits);
  const width = () => Math.min(8, Math.max(1, ...rows().map((r) => r.lanes))) * LANE + 6;

  return (
    <div class="commit-graph">
      <Show when={props.uncommitted > 0}>
        <button class="graph-row uncommitted" classList={{ open: ws.activeFile === ALL_CHANGES }} onClick={() => props.onUncommitted?.()} title={tx("Ver todas as mudanças ainda sem commit, lado a lado")}>
          <svg class="graph-svg" width={width()} height={ROW} aria-hidden="true">
            <path d={`M${x(rows()[0]?.col ?? 0)} ${ROW / 2} L${x(rows()[0]?.col ?? 0)} ${ROW}`} stroke="var(--line-2)" stroke-dasharray="3 3" />
            <circle cx={x(rows()[0]?.col ?? 0)} cy={ROW / 2} r="4" fill="none" stroke="var(--text-3)" stroke-dasharray="2 2" stroke-width="1.5" />
          </svg>
          <span class="graph-text">
            <span class="graph-subject"><span>{tx("Mudanças ainda sem commit")}</span></span>
            <small>{txn(props.uncommitted, "{n} arquivo · ainda não salvo no git", "{n} arquivos · ainda não salvos no git")}</small>
          </span>
          <ChevronRight size={13} class="graph-go" />
        </button>
      </Show>
      <For each={props.commits}>
        {(c, i) => {
          const isHead = () => !!props.head && c.hash.startsWith(props.head);
          return (
            <button class="graph-row" classList={{ open: ws.activeFile === COMMIT + c.hash, head: isHead() }} onClick={() => openCommit(c.hash)} title={`${c.subject}\n${c.short} · ${c.author} · ${new Date(c.time * 1000).toLocaleString(locale())}\n${tx("Clique para comparar os arquivos deste commit, lado a lado")}`}>
              <Lines row={rows()[i()]} width={width()} pushed={c.pushed} head={isHead()} />
              <span class="graph-text">
                <span class="graph-subject"><span>{c.subject}</span></span>
                <small>
                  <span class="graph-where" title={c.pushed ? tx("Já está no remoto (nuvem)") : tx("Só neste computador")}>{c.pushed ? <Cloud size={10} /> : <Laptop size={10} />}</span>
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
              <ChevronRight size={13} class="graph-go" />
            </button>
          );
        }}
      </For>
    </div>
  );
}
