// Terminais de cada projeto: a lista, as chamadas ao Rust (src-tauri/src/term.rs) e os
// eventos de saída. O desenho (xterm.js) fica em termView.ts, que só carrega quando a aba
// Terminal aparece pela primeira vez; até lá, a saída que chegar fica guardada aqui.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createStore, produce } from "solid-js/store";
import { isTauri } from "./api";
import { showToast } from "./store";

export interface TermInfo {
  id: string;
  projectId: string;
  name: string;
  shell: string;
  cwd: string;
  alive: boolean;
}

interface State {
  /** terminais de cada projeto, na ordem em que abriram */
  byProject: Record<string, TermInfo[]>;
  /** terminal aparecendo em cada projeto */
  active: Record<string, string>;
  loaded: Record<string, boolean>;
  opening: boolean;
}

export const [terms, setTerms] = createStore<State>({ byProject: {}, active: {}, loaded: {}, opening: false });

/** Quem desenha os terminais (termView.ts, quando carregado). */
export interface Sink {
  write(id: string, data: string): void;
  exit(id: string): void;
  dispose(id: string): void;
}
let sink: Sink | null = null;
export const setSink = (s: Sink) => {
  sink = s;
  // o que chegou antes do desenho existir
  for (const [id, parts] of early) s.write(id, parts.join(""));
  early.clear();
};
const early = new Map<string, string[]>();

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------------------------------------------------------------- eventos do Rust

let listening = false;
export function startTermEvents() {
  if (!isTauri || listening) return;
  listening = true;
  listen<{ id: string; data: string }>("term-output", ({ payload }) => {
    if (sink) return sink.write(payload.id, payload.data);
    const l = early.get(payload.id) ?? [];
    l.push(payload.data);
    early.set(payload.id, l.slice(-400));
  });
  listen<{ id: string }>("term-exit", ({ payload }) => {
    sink?.exit(payload.id);
    setTerms("byProject", produce((all) => {
      for (const list of Object.values(all)) for (const t of list) if (t.id === payload.id) t.alive = false;
    }));
  });
}

// ---------------------------------------------------------------- ações

export const listTerms = (pid: string) => invoke<TermInfo[]>("term_list", { projectId: pid });

/** Abre um shell do tamanho já medido na tela (sem isso o zsh desenha o primeiro prompt torto). */
export async function openTermSized(pid: string, cols: number, rows: number): Promise<TermInfo | null> {
  if (!isTauri || terms.opening) return null;
  setTerms("opening", true);
  try {
    const t = await invoke<TermInfo>("term_open", { projectId: pid, cols, rows });
    setTerms(produce((s) => {
      s.byProject[pid] = [...(s.byProject[pid] ?? []), t];
      s.active[pid] = t.id;
      s.loaded[pid] = true;
    }));
    return t;
  } catch (e) {
    showToast(errMsg(e));
    return null;
  } finally {
    setTerms("opening", false);
  }
}

export async function closeTerm(pid: string, id: string) {
  await invoke("term_close", { id }).catch(() => {});
  sink?.dispose(id);
  early.delete(id);
  setTerms(produce((s) => {
    const all = s.byProject[pid] ?? [];
    const i = all.findIndex((t) => t.id === id);
    const list = all.filter((t) => t.id !== id);
    s.byProject[pid] = list;
    if (s.active[pid] === id) s.active[pid] = list[Math.max(0, i - 1)]?.id ?? "";
  }));
}

export const setActiveTerm = (pid: string, id: string) => setTerms("active", pid, id);

/** Projeto removido: os terminais dele já foram fechados no Rust; aqui só some da tela. */
export function forgetProject(pid: string) {
  for (const t of terms.byProject[pid] ?? []) {
    sink?.dispose(t.id);
    early.delete(t.id);
  }
  setTerms(produce((s) => {
    delete s.byProject[pid];
    delete s.active[pid];
    delete s.loaded[pid];
  }));
}
