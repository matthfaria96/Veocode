// Modo da tela Projetos: "simples" (um projeto por vez, troca pelo nome no topo) ou
// "avancado" (uma coluna com todos os projetos ao lado da árvore de arquivos). Lembrado
// neste computador.
import { createSignal } from "solid-js";

export type WsMode = "simples" | "avancado";
const KEY = "veocode.workspace.mode";
const first = (): WsMode => {
  try {
    return localStorage.getItem(KEY) === "avancado" ? "avancado" : "simples";
  } catch {
    return "simples";
  }
};
const [mode, setModeRaw] = createSignal<WsMode>(first());
export const wsMode = mode;
export function setWsMode(m: WsMode) {
  setModeRaw(m);
  try {
    localStorage.setItem(KEY, m);
  } catch {
    /* sem armazenamento: só não lembra */
  }
}

const remember = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* sem armazenamento: só não lembra */
  }
};
const recall = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};

/** Atividade, comandos do agente e terminal: fechado, na faixa de baixo ou numa aba fixa no lugar da conversa. */
export type PanelAt = "none" | "bottom" | "tab";
// começa fechado; Ajustes → "Painel de baixo" escolhe se já abre aberto (settings.ts aplica ao carregar)
const [panelAt, setPanelAt] = createSignal<PanelAt>("none");
export { panelAt, setPanelAt };
export const bottomOpen = () => panelAt() === "bottom";
export const setBottomOpen = (v: boolean) => setPanelAt(v ? "bottom" : "none");

/** Painel de arquivos ao lado do chat: largura arrastável e "maximizado". */
const FILES_W = 520;
const savedW = Number(recall("veocode.files.width"));
const [filesW, setFilesWRaw] = createSignal(savedW >= 340 && savedW <= 1400 ? savedW : FILES_W);
export { filesW };
export const setFilesW = (w: number, save = false) => {
  setFilesWRaw(w);
  if (save) remember("veocode.files.width", String(w));
};
export const resetFilesW = () => setFilesW(FILES_W, true);
export const [filesMax, setFilesMax] = createSignal(false);

/** Modo foco (tela Projetos): todas as conversas do projeto lado a lado, numa grade. Lembrado neste computador. */
const [focusMode, setFocusRaw] = createSignal(recall("veocode.ws.focus") === "1");
export { focusMode };
export function setFocusMode(v: boolean) {
  setFocusRaw(v);
  remember("veocode.ws.focus", v ? "1" : "0");
}

/** Tela Projetos em dois modos: "code" (como um editor: árvore, arquivos, git, terminal) ou
 *  "ai" (conversas à esquerda, a conversa no meio e o painel de depuração à direita). */
export type ProjMode = "code" | "ai";
const [projMode, setProjModeRaw] = createSignal<ProjMode>(recall("veocode.ws.view") === "code" ? "code" : "ai");
export { projMode };
export function setProjMode(m: ProjMode) {
  setProjModeRaw(m);
  remember("veocode.ws.view", m);
}

/** Terminal do modo Código: aberto ou não, embaixo ou à direita, e o tamanho de cada lado. */
export type TermAt = "bottom" | "right";
const [termAt, setTermAtRaw] = createSignal<TermAt>(recall("veocode.code.termAt") === "right" ? "right" : "bottom");
export { termAt };
export const setTermAt = (v: TermAt) => (setTermAtRaw(v), remember("veocode.code.termAt", v));
export const [termOpen, setTermOpen] = createSignal(false);
const size = (k: string, d: number, lo: number, hi: number) => {
  const n = Number(recall(k));
  return n >= lo && n <= hi ? n : d;
};
const [termH, setTermHRaw] = createSignal(size("veocode.code.termH", 260, 120, 2000));
const [termW, setTermWRaw] = createSignal(size("veocode.code.termW", 460, 260, 2000));
export { termH, termW };
export const setTermH = (v: number, save = false) => (setTermHRaw(v), save && remember("veocode.code.termH", String(v)));
export const setTermW = (v: number, save = false) => (setTermWRaw(v), save && remember("veocode.code.termW", String(v)));

/** Painel de depuração do modo IA (à direita): aberto, largura e a aba da frente. */
export type DebugTab = "browser" | "procs" | "subs" | "activity" | "file";
const [debugOpen, setDebugOpenRaw] = createSignal(recall("veocode.ai.debug") !== "0");
export { debugOpen };
export const setDebugOpen = (v: boolean) => (setDebugOpenRaw(v), remember("veocode.ai.debug", v ? "1" : "0"));
const [debugW, setDebugWRaw] = createSignal(size("veocode.ai.debugW", 440, 320, 1400));
export { debugW };
export const setDebugW = (v: number, save = false) => (setDebugWRaw(v), save && remember("veocode.ai.debugW", String(v)));
const savedTab = recall("veocode.ai.debugTab");
const [debugTab, setDebugTabRaw] = createSignal<DebugTab>(savedTab === "procs" || savedTab === "subs" || savedTab === "activity" ? savedTab : "browser");
export { debugTab };
export const setDebugTab = (v: DebugTab) => (setDebugTabRaw(v), v !== "file" && remember("veocode.ai.debugTab", v));
