// Ajustes do Veocode. No app ficam em settings.json (Rust: settings.rs); no navegador, no
// armazenamento da página (se der).

import { invoke } from "@tauri-apps/api/core";
import { createStore } from "solid-js/store";
import { isTauri } from "./api";
import { showToast } from "./store";

export type IconStyle = "minimalista" | "detalhado";
export type Motion = "completa" | "reduzida";

export interface Settings {
  icons: IconStyle;
  motion: Motion;
  /** conta do Chat livre ("" = a padrão) */
  freeAccount: string;
  /** Chat livre pode olhar o computador (só leitura) */
  freePc: boolean;
}

const defaults: Settings = { icons: "detalhado", motion: "completa", freeAccount: "", freePc: false };
const KEY = "veocode.settings";

export const [settings, setSettings] = createStore<Settings>({ ...defaults });

/** Animações reduzidas: uma classe na raiz desliga as animações longas e os laços. */
const applyMotion = () => document.documentElement.classList.toggle("reduce-motion", settings.motion === "reduzida");

export async function loadSettings() {
  try {
    if (isTauri) setSettings(await invoke<Settings>("settings_get"));
    else {
      const raw = localStorage.getItem(KEY);
      if (raw) setSettings({ ...defaults, ...JSON.parse(raw) });
    }
  } catch {
    /* fica o padrão */
  }
  applyMotion();
}

/** Muda na hora e grava; se a gravação falhar, volta ao que estava. */
export async function updateSettings(change: Partial<Settings>) {
  const before = { ...settings };
  setSettings(change);
  applyMotion();
  try {
    if (isTauri) await invoke("settings_set", { settings: { ...settings } });
    else localStorage.setItem(KEY, JSON.stringify(settings));
  } catch (e) {
    setSettings(before);
    applyMotion();
    showToast(`Não deu para guardar o ajuste: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export const detailed = () => settings.icons === "detalhado";
