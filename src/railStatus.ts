// Bolinhas do menu lateral: um sinal discreto de que algo acontece naquela área, com um resumo
// curto ao passar o mouse. Só aparece quando há algo; "esperando você" é a única que pulsa.
import { accts, accountById } from "./accounts";
import { projectState } from "./board";
import { livre } from "./livre";
import { peak } from "./limits";
import { projects, type View } from "./store";
import { xray } from "./xray";
import type { AgentGroup } from "./api";
import { tx, txn } from "./i18n";

export type RailTone = "ask" | "error" | "warn" | "work";
export interface RailStatus {
  /** null: só o resumo na dica, sem bolinha */
  tone: RailTone | null;
  lines: string[];
}
type Row = { tone: RailTone; text: string };

const rank: Record<RailTone, number> = { ask: 0, error: 1, warn: 2, work: 3 };
const MAX = 4;

// a primeira linha dá o tom da bolinha; o resumo mostra as primeiras e conta o resto
function pack(rows: Row[]): RailStatus | null {
  if (!rows.length) return null;
  const lines = rows.slice(0, MAX).map((r) => r.text);
  if (rows.length > MAX) lines.push(tx("e mais {n}", { n: rows.length - MAX }));
  return { tone: rows[0].tone, lines };
}
const urgentFirst = (rows: Row[]) => [...rows].sort((a, b) => rank[a.tone] - rank[b.tone]);

/** "6 no VS Code, 2 no app do Claude…" — onde estão abertas as IAs. */
export function hostParts(procs: readonly AgentGroup[]): string[] {
  const by = new Map<string, number>();
  for (const g of procs) by.set(g.host ?? "outro", (by.get(g.host ?? "outro") ?? 0) + 1);
  return [...by.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([h, k]) => `${k} ${h === "outro" ? tx("em outro programa") : h === "Terminal" ? tx("no Terminal") : h === "Veocode" ? tx("no Veocode") : h === "app do Claude" ? tx("no app do Claude") : tx("no {h}", { h })}`);
}

const projectsStatus = () =>
  pack(
    urgentFirst(
      projects.flatMap((p): Row[] => {
        const st = projectState(p.id);
        return st.tone === "idle" ? [] : [{ tone: st.tone, text: `${p.name}: ${st.label}` }];
      }),
    ),
  );

const livreStatus = (): RailStatus | null =>
  livre.perms.length
    ? { tone: "ask", lines: [livre.perms.length === 1 ? tx("Pedindo sua permissão") : tx("{length} pedidos de permissão", { length: livre.perms.length })] }
    : livre.busy
      ? { tone: "work", lines: [tx("Trabalhando")] }
      : livre.error
        ? { tone: "error", lines: [tx("Parou com erro")] }
        : null;

function accountsStatus() {
  const rows: Row[] = [];
  for (const a of accts.list) {
    const label = accountById(a.id).label;
    const s = accts.status[a.id]?.state;
    if (s === "semLogin") rows.push({ tone: "error", text: tx("{label}: precisa entrar (login)", { label }) });
    else if (s === "semChave") rows.push({ tone: "error", text: tx("{label}: está sem a chave", { label }) });
    else if (s === "erro") rows.push({ tone: "error", text: tx("{label}: deu erro ao conferir", { label }) });
    const pk = a.provider === "claude" ? peak(a.id) : null;
    if (!pk || pk.pct < 75) continue;
    const win = pk.win === "5h" ? tx("das 5 h") : tx("da semana");
    rows.push(pk.pct >= 100 ? { tone: "error", text: tx("{label}: chegou no limite {win}", { label, win }) } : { tone: "warn", text: tx("{label}: usou {pct}% {win}", { label, pct: Math.round(pk.pct), win }) });
  }
  return pack(urgentFirst(rows));
}

// o resumo das IAs abertas mora aqui (saiu do topo da janela): aparece sempre na dica, mas a
// bolinha só acende com alguma trabalhando ou um servidor esquecido
function computerStatus(): RailStatus | null {
  const n = xray.procs.length;
  const busy = xray.procs.filter((g) => g.children.length > 0).length;
  const left = xray.ports?.leftovers.length ?? 0;
  const lines: string[] = [];
  if (n) {
    lines.push(busy ? txn(n, "{n} IA aberta · {busy} trabalhando", "{n} IAs abertas · {busy} trabalhando", { busy }) : txn(n, "{n} IA aberta", "{n} IAs abertas"));
    lines.push(hostParts(xray.procs).join(", "));
  }
  if (left) lines.push(txn(left, "{n} servidor ficou aberto sem ninguém", "{n} servidores ficaram abertos sem ninguém"));
  if (!lines.length) return null;
  return { tone: busy ? "work" : left ? "warn" : null, lines };
}

/** O que a bolinha de cada item do menu diz agora (ou nada). */
export function railStatus(v: View): RailStatus | null {
  switch (v) {
    case "workspace":
      return projectsStatus();
    case "livre":
      return livreStatus();
    case "accounts":
      return accountsStatus();
    case "inventory":
    case "system":
      return computerStatus();
    default:
      return null;
  }
}
