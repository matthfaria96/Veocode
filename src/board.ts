// Painel: todos os projetos de uma vez e até 4 chats lado a lado. Guarda quais projetos estão
// na grade (neste computador) e calcula a situação de cada projeto para os cartões.

import { createSignal } from "solid-js";
import { chatOf } from "./chat";
import { feedOf } from "./feeds";
import { absPathOf, projects } from "./store";
import { xray } from "./xray";

export const MAX_PANES = 4;

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

/** Projetos na grade, na ordem dos cantos: superior esquerdo, superior direito, inferior esquerdo, inferior direito. */
const [panesRaw, setPanesRaw] = createSignal<string[]>(load("veocode.board.panes", []));
export const [boardMode, setBoardModeRaw] = createSignal<"all" | "grid">(load("veocode.board.mode", "all"));
/** Um painel da grade aberto em tela cheia (os outros continuam rodando). */
export const [maximized, setMaximized] = createSignal<string | null>(null);

/** Só projetos que ainda existem (um removido sai sozinho da grade). */
export const panes = () => panesRaw().filter((id) => projects.some((p) => p.id === id && !p.demo));

const setPanes = (l: string[]) => {
  setPanesRaw(l);
  save("veocode.board.panes", l);
};
export const setBoardMode = (m: "all" | "grid") => {
  setBoardModeRaw(m);
  save("veocode.board.mode", m);
};

export const inGrid = (id: string) => panes().includes(id);

/** Põe ou tira da grade. Devolve false se a grade já está cheia. */
export function toggleGrid(id: string): boolean {
  const l = panes();
  if (l.includes(id)) {
    setPanes(l.filter((x) => x !== id));
    if (maximized() === id) setMaximized(null);
    return true;
  }
  if (l.length >= MAX_PANES) return false;
  setPanes([...l, id]);
  return true;
}

/** Troca o projeto de um canto da grade por outro. */
export function replacePane(oldId: string, newId: string) {
  const l = panes();
  if (l.includes(newId)) {
    // já está em outro canto: os dois trocam de lugar
    setPanes(l.map((x) => (x === oldId ? newId : x === newId ? oldId : x)));
  } else setPanes(l.map((x) => (x === oldId ? newId : x)));
}

/** Leva um painel um lugar para trás ou para frente na grade. */
export function movePane(id: string, dir: -1 | 1) {
  const l = [...panes()];
  const i = l.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= l.length) return;
  [l[i], l[j]] = [l[j], l[i]];
  setPanes(l);
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
