// Pastas onde o Claude Code já trabalhou neste computador: a Visão geral oferece como projeto
// com um clique, sem precisar procurar a pasta.

import { invoke } from "@tauri-apps/api/core";
import { createSignal } from "solid-js";
import { isTauri } from "./api";
import { absPathOf, projects } from "./store";

export interface Found {
  path: string;
  name: string;
  last: number;
  sessions: number;
}

const [list, setList] = createSignal<Found[]>([]);
const [loaded, setLoaded] = createSignal(false);
export const foundLoaded = loaded;

const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/$/, "");

/** As que ainda não são projetos. */
export const found = () => {
  const have = new Set(projects.filter((p) => !p.demo).map((p) => norm(absPathOf(p.id) ?? p.path)));
  return list().filter((f) => !have.has(norm(f.path)));
};

export async function loadFound() {
  if (!isTauri) {
    const now = Date.now() / 1000;
    setList([
      { path: "/Users/voce/Projetos/loja-api", name: "loja-api", last: now - 600, sessions: 14 },
      { path: "/Users/voce/Projetos/site-portfolio", name: "site-portfolio", last: now - 7200, sessions: 6 },
      { path: "/Users/voce/Projetos/app-financas", name: "app-financas", last: now - 86400 * 2, sessions: 9 },
      { path: "/Users/voce/Projetos/bot-whatsapp", name: "bot-whatsapp", last: now - 86400 * 5, sessions: 3 },
    ]);
    setLoaded(true);
    return;
  }
  try {
    setList(await invoke<Found[]>("recent_folders"));
  } catch {
    /* sem histórico do Claude: só não sugere */
  }
  setLoaded(true);
}
