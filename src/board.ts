// Visão geral: os projetos ao vivo numa grade que se ajusta sozinha (até 9), escolhidos a partir dos
// projetos, e a situação de cada um.

import { createEffect, createRoot, createSignal, untrack } from "solid-js";
import { projectChat } from "./chat";
import { feedOf } from "./feeds";
import { absPathOf, projects } from "./store";
import { xray } from "./xray";
import { tx } from "./i18n";

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
const pins = () => pinsRaw().filter((id) => realIds().includes(id));
export const isPinned = (id: string) => pinsRaw().includes(id);
const setPins = (l: string[]) => {
  setPinsRaw(l);
  save("veocode.board.pins", l);
};
export function togglePin(id: string) {
  setPins(isPinned(id) ? pinsRaw().filter((x) => x !== id) : [...pinsRaw(), id]);
}

/** Quantos projetos cabem na tela Início ao mesmo tempo: a grade se ajusta sozinha (2, 3, 4, 6, 8, 9). */
const MAX_ON_SCREEN = 9;
const slots = () => Math.min(MAX_ON_SCREEN, realIds().filter((id) => !closed().includes(id)).length);

// ---------------------------------------------------------------- quem aparece na tela
// Os projetos entram sozinhos: primeiro os fixados, depois quem precisa de você, quem está trabalhando
// e quem mexeu por último. Quem já está na tela não pula de lugar; só sai um parado quando outro
// projeto passa a pedir você.

const [shown, setShown] = createSignal<string[]>(load("veocode.board.shown", []));
export const panes = shown;
export const inGrid = (id: string) => shown().includes(id);

/** Projetos que a pessoa tirou da tela: não voltam sozinhos (só pelo "Pôr na tela" ou arrastando). */
const [closed, setClosedRaw] = createSignal<string[]>(load("veocode.board.closed", []));
const setClosed = (l: string[]) => {
  setClosedRaw(l);
  save("veocode.board.closed", l);
};
const isClosed = (id: string) => closed().includes(id);

/** Tira um painel da tela (o projeto continua na lista e rodando). */
export function closePane(id: string) {
  if (maximized() === id) setMaximized(null);
  if (isPinned(id)) setPins(pinsRaw().filter((x) => x !== id));
  if (!isClosed(id)) setClosed([...closed(), id]);
  const next = shown().filter((x) => x !== id);
  setShown(next);
  save("veocode.board.shown", next);
}

function rank(ids: string[]) {
  const st = new Map(ids.map((id) => [id, projectState(id)]));
  return [...ids].sort((a, b) => toneOrder[st.get(a)!.tone] - toneOrder[st.get(b)!.tone] || st.get(b)!.at - st.get(a)!.at);
}

function settle() {
  const off = closed();
  const ids = realIds().filter((id) => !off.includes(id));
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
  if (isClosed(newId)) setClosed(closed().filter((x) => x !== newId));
  const l = shown();
  // tem lugar sobrando (alguém foi tirado da tela): só entra, sem tirar ninguém
  if ((!oldId || !l.includes(oldId)) && !l.includes(newId) && l.length < slots()) {
    const next = [...l, newId];
    setShown(next);
    save("veocode.board.shown", next);
    if (!isPinned(newId)) setPins([...pinsRaw(), newId]);
    return;
  }
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
  const c = projectChat(pid);
  const f = feedOf(pid);
  const root = absPathOf(pid);
  const procs = xray.procs.filter((g) => inside(g.cwd, root));
  const busyProc = procs.some((g) => g.children.length > 0);
  const recent = Date.now() - f.activeAt < 45_000;
  const running = f.items.slice(-3).some((x) => x.status === "running" && Date.now() - x.ts < 10 * 60_000);
  const at = f.activeAt;
  if (c.perms.length) return { tone: "ask", label: c.perms.length === 1 ? tx("Pedindo sua permissão") : tx("{length} pedidos de permissão", { length: c.perms.length }), agents: procs.length, at };
  if (c.busy) return { tone: "work", label: c.draft ? tx("Escrevendo a resposta") : tx("Trabalhando"), agents: procs.length, at };
  if (c.error) return { tone: "error", label: tx("Parou com erro"), agents: procs.length, at };
  if (running || busyProc || recent) return { tone: "work", label: busyProc ? tx("Rodando comandos") : tx("Trabalhando"), agents: procs.length, at };
  return { tone: "idle", label: procs.length ? tx("Aberto, esperando") : tx("Parado"), agents: procs.length, at };
}

/** Prioridade na lista: quem precisa de você primeiro, depois quem está trabalhando. */
export const toneOrder: Record<Tone, number> = { ask: 0, error: 1, work: 2, idle: 3 };

// por último: o efeito usa toneOrder, definido logo acima
createRoot(() => createEffect(settle));

/** Arrastou um painel para cima de outro: os dois trocam de lugar. */
export function swapPanes(a: string, b: string) {
  const l = [...shown()];
  const i = l.indexOf(a);
  const j = l.indexOf(b);
  if (i < 0 || j < 0 || i === j) return;
  [l[i], l[j]] = [l[j], l[i]];
  setShown(l);
  save("veocode.board.shown", l);
}
