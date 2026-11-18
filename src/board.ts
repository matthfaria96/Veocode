// Visão geral: até 4 conversas ao vivo, escolhidas sozinhas a partir dos projetos, e a situação de cada projeto.

import { createEffect, createRoot, createSignal, untrack } from "solid-js";
import { chatOf } from "./chat";
import { feedOf } from "./feeds";
import { absPathOf, projects } from "./store";
import { xray } from "./xray";

const load = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const save = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* sem armazenamento */
  }
};

/** Projetos fixados pela pessoa: ficam sempre na tela, no mesmo lugar. */
const [pinsRaw, setPinsRaw] = createSignal<string[]>(load("veocode.board.pins", []));
/** Um painel aberto em tela cheia (os outros continuam rodando). */
export const [maximized, setMaximized] = createSignal<string | null>(null);

const realIds = () => projects.filter((p) => !p.demo).map((p) => p.id);
export const pins = () => pinsRaw().filter((id) => realIds().includes(id));
export const isPinned = (id: string) => pinsRaw().includes(id);
const setPins = (l: string[]) => {
  setPinsRaw(l);
  save("veocode.board.pins", l);
};
export function togglePin(id: string) {
  setPins(isPinned(id) ? pinsRaw().filter((x) => x !== id) : [...pinsRaw(), id]);
}

/** Como a tela se divide: 1 grande, 2 lado a lado, 2 um em cima do outro, 3 (um grande e dois menores) ou 4. */
export type Layout = "1" | "2c" | "2r" | "3" | "4";
export const layouts: { id: Layout; slots: number; label: string }[] = [
  { id: "1", slots: 1, label: "Um projeto, tela inteira" },
  { id: "2c", slots: 2, label: "Dois lado a lado" },
  { id: "2r", slots: 2, label: "Dois, um em cima do outro" },
  { id: "3", slots: 3, label: "Três: um grande e dois menores" },
  { id: "4", slots: 4, label: "Quatro, um em cada canto" },
];
const [layoutRaw, setLayoutRaw] = createSignal<Layout>(load("veocode.board.layout", "2c"));
export const slots = () => layouts.find((l) => l.id === layoutRaw())?.slots ?? 2;
export const setLayout = (l: Layout) => {
  setLayoutRaw(l);
  save("veocode.board.layout", l);
};
/** A divisão que de fato aparece: com menos projetos do que lugares, usa a divisão do tamanho certo. */
export const layout = (): Layout => {
  const n = panes().length;
  if (n >= slots()) return layoutRaw();
  return n <= 1 ? "1" : n === 2 ? (layoutRaw() === "2r" ? "2r" : "2c") : "3";
};

// ---------------------------------------------------------------- quem aparece na tela
// Os projetos entram sozinhos: primeiro os fixados, depois quem precisa de você, quem está trabalhando
// e quem mexeu por último. Quem já está na tela não pula de lugar; só sai um parado quando outro
// projeto passa a pedir você.

const [shown, setShown] = createSignal<string[]>(load("veocode.board.shown", []));
export const panes = shown;
export const inGrid = (id: string) => shown().includes(id);

function rank(ids: string[]) {
  const st = new Map(ids.map((id) => [id, projectState(id)]));
  return [...ids].sort((a, b) => toneOrder[st.get(a)!.tone] - toneOrder[st.get(b)!.tone] || st.get(b)!.at - st.get(a)!.at);
}

function settle() {
  const ids = realIds();
  const n = Math.min(slots(), ids.length);
  const pinned = pins();
  let next = untrack(shown).filter((id) => ids.includes(id));
  for (const id of pinned) if (!next.includes(id)) next.push(id);
  // sobrou gente: tira os não fixados de menor prioridade
  if (next.length > n) {
    const drop = rank(next.filter((id) => !pinned.includes(id))).reverse();
    while (next.length > n && drop.length) {
      const d = drop.shift()!;
      next = next.filter((x) => x !== d);
    }
    next = next.slice(0, n);
  }
  const rest = rank(ids.filter((id) => !next.includes(id)));
  while (next.length < n && rest.length) next.push(rest.shift()!);
  // quem pede você toma o lugar de um projeto parado (nunca de um fixado)
  for (const id of rest) {
    const t = projectState(id).tone;
    if (t !== "ask" && t !== "error") continue;
    const idle = next
      .filter((x) => !pinned.includes(x) && projectState(x).tone === "idle")
      .sort((a, b) => projectState(a).at - projectState(b).at)[0];
    if (!idle) break;
    next = next.map((x) => (x === idle ? id : x));
  }
  const cur = untrack(shown);
  if (next.length !== cur.length || next.some((x, i) => x !== cur[i])) {
    setShown(next);
    save("veocode.board.shown", next);
  }
}

/** Põe um projeto na tela no lugar de outro (e fixa, para não sair sozinho). */
export function replacePane(oldId: string | undefined, newId: string) {
  const l = shown();
  if (!oldId || !l.includes(oldId)) {
    // sem lugar indicado: entra no lugar do não fixado mais parado
    const pinned = pins();
    const free = rank(l.filter((x) => !pinned.includes(x))).reverse()[0];
    oldId = free ?? l[l.length - 1];
  }
  const next = l.includes(newId) ? l.map((x) => (x === oldId ? newId : x === newId ? oldId! : x)) : l.map((x) => (x === oldId ? newId : x));
  setShown(next);
  save("veocode.board.shown", next);
  if (oldId && isPinned(oldId)) setPins(pinsRaw().filter((x) => x !== oldId));
  if (!isPinned(newId)) setPins([...pinsRaw(), newId]);
}

/** Leva um painel um lugar para trás ou para frente. */
export function movePane(id: string, dir: -1 | 1) {
  const l = [...shown()];
  const i = l.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= l.length) return;
  [l[i], l[j]] = [l[j], l[i]];
  setShown(l);
  save("veocode.board.shown", l);
}

// ---------------------------------------------------------------- situação de cada projeto

export type Tone = "ask" | "work" | "error" | "idle";
export interface ProjectState {
  tone: Tone;
  label: string;
  /** agentes de IA rodando nesta pasta (Veocode, Terminal, editor…) */
  agents: number;
  /** último sinal de atividade (ms) */
  at: number;
}

const inside = (cwd: string | null, root: string | undefined) => {
  if (!cwd || !root) return false;
  const a = cwd.replace(/\\/g, "/").replace(/\/$/, "");
  const b = root.replace(/\\/g, "/").replace(/\/$/, "");
  return a === b || a.startsWith(`${b}/`);
};

export function projectState(pid: string): ProjectState {
  const c = chatOf(pid);
  const f = feedOf(pid);
  const root = absPathOf(pid);
  const procs = xray.procs.filter((g) => inside(g.cwd, root));
  const busyProc = procs.some((g) => g.children.length > 0);
  const recent = Date.now() - f.activeAt < 45_000;
  const running = f.items.slice(-3).some((x) => x.status === "running" && Date.now() - x.ts < 10 * 60_000);
  const at = f.activeAt;
  if (c.perms.length) return { tone: "ask", label: c.perms.length === 1 ? "Pedindo sua permissão" : `${c.perms.length} pedidos de permissão`, agents: procs.length, at };
  if (c.busy) return { tone: "work", label: c.draft ? "Escrevendo a resposta" : "Trabalhando", agents: procs.length, at };
  if (c.error) return { tone: "error", label: "Parou com erro", agents: procs.length, at };
  if (running || busyProc || recent) return { tone: "work", label: busyProc ? "Rodando comandos" : "Trabalhando", agents: procs.length, at };
  return { tone: "idle", label: procs.length ? "Aberto, esperando" : "Parado", agents: procs.length, at };
}

/** Prioridade na lista: quem precisa de você primeiro, depois quem está trabalhando. */
export const toneOrder: Record<Tone, number> = { ask: 0, error: 1, work: 2, idle: 3 };

// por último: o efeito usa toneOrder, definido logo acima
createRoot(() => createEffect(settle));
