// Qual parte do Painel está aberta. Fica fora da tela (que carrega sob demanda) para que o topo,
// a busca e os avisos possam abrir o Painel direto numa parte.
import { createSignal } from "solid-js";
import { setView } from "./store";

export type PanelSec =
  | "overview"
  | "claude"
  | "caches"
  | "models"
  | "installed"
  | "processes"
  | "ports"
  | "machines"
  | "skills"
  | "mcp"
  | "plugins";

export const [panelSec, setPanelSec] = createSignal<PanelSec>("overview");

/** Abre o Painel numa parte (a Visão geral, se não disser qual). */
export function openPanel(sec: PanelSec = "overview") {
  setPanelSec(sec);
  setView("system");
  requestAnimationFrame(() => document.querySelector(".dash-main")?.scrollTo({ top: 0 }));
}
