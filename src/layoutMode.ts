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
