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
const saved = recall("veocode.ws.panel");
const [panelAt, setPanelRaw] = createSignal<PanelAt>(saved === "bottom" || saved === "tab" ? saved : recall("veocode.ws.bottom") === "1" ? "bottom" : "none");
export { panelAt };
export function setPanelAt(v: PanelAt) {
  setPanelRaw(v);
  remember("veocode.ws.panel", v);
}
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
