// Modelo e força do Claude escolhidos no chat, guardados por projeto (vazio = padrão da conta).
import { createStore } from "solid-js/store";
import { tx } from "./i18n";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type Prefs = { model?: string | null; effort?: Effort | null };

export const claudeModels: { id: string | null; label: string; hint: string }[] = [
  { id: null, get label() { return tx("Padrão"); }, get hint() { return tx("o que a conta usa"); } },
  { id: "opus", get label() { return tx("Opus"); }, get hint() { return tx("o mais capaz para código"); } },
  { id: "fable", get label() { return tx("Fable"); }, get hint() { return tx("o mais novo e forte"); } },
  { id: "sonnet", get label() { return tx("Sonnet"); }, get hint() { return tx("rápido e bom"); } },
  { id: "haiku", get label() { return tx("Haiku"); }, get hint() { return tx("o mais rápido e barato"); } },
];

export const efforts: { id: Effort | null; label: string }[] = [
  { id: null, get label() { return tx("Padrão"); } },
  { id: "low", get label() { return tx("Baixa"); } },
  { id: "medium", get label() { return tx("Média"); } },
  { id: "high", get label() { return tx("Alta"); } },
  { id: "xhigh", get label() { return tx("Muito alta"); } },
  { id: "max", get label() { return tx("Máxima"); } },
];

const KEY = "veocode.chat.prefs";
const read = (): Record<string, Prefs> => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
};
const [prefs, setPrefs] = createStore<Record<string, Prefs>>(read());

export const prefsOf = (pid: string): Prefs => prefs[pid] ?? {};

export function setPref(pid: string, change: Prefs) {
  setPrefs(pid, { ...prefsOf(pid), ...change });
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* sem armazenamento: vale só nesta sessão */
  }
}

/** O que vai para o `chat_send`. */
export const sendPrefs = (pid: string) => ({ model: prefsOf(pid).model ?? null, effort: prefsOf(pid).effort ?? null });

/** Linha curta: "Opus · força alta". */
export function prefsLabel(pid: string): string | null {
  const p = prefsOf(pid);
  const m = claudeModels.find((x) => x.id === (p.model ?? null));
  const e = efforts.find((x) => x.id === (p.effort ?? null));
  const parts = [p.model ? m?.label ?? p.model : null, p.effort ? tx("força {v}", { v: (e?.label ?? "").toLowerCase() }) : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** "claude-opus-5-5" → "Opus 5.5" (para mostrar o modelo no botão da IA). */
export const niceModel = (s: string) => s.replace(/\bclaude-([a-z]+)-(\d+)-(\d+)\b/gi, (_, n: string, a, b) => `${n[0].toUpperCase()}${n.slice(1)} ${a}.${b}`);
