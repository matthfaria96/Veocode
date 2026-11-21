// Modelo e força do Claude escolhidos no chat, guardados por projeto (vazio = padrão da conta),
// e o Code mode do `claude` aberto no Terminal do projeto.
import { invoke } from "@tauri-apps/api/core";
import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { isTauri } from "./api";
import { tx } from "./i18n";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
/** `codeMode`: liga o Code mode do Claude Code nos terminais do projeto abertos depois. */
export type Prefs = { model?: string | null; effort?: Effort | null; codeMode?: boolean };

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

/** O Code mode do Claude Code só existe a partir desta versão (e só no `claude` interativo). */
export const CODE_MODE_MIN = "2.1.323";

/** Versão do Claude Code instalado: undefined = ainda não lida, null = não achou. */
const [cliVersion, setCliVersion] = createSignal<string | null | undefined>(undefined);
export { cliVersion, setCliVersion };
let reading = false;
/** Lê de novo a cada vez que o menu abre: a pessoa pode ter atualizado no Terminal. */
export function readCliVersion() {
  if (!isTauri || reading) return;
  reading = true;
  invoke<string | null>("claude_version")
    .then((v) => setCliVersion(v ?? null), () => setCliVersion(null))
    .finally(() => (reading = false));
}

/** "2.1.316" >= "2.1.323"? */
export function versionAtLeast(v: string, min: string) {
  const a = v.split(".").map((x) => parseInt(x, 10) || 0);
  const b = min.split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return true;
}

/** "claude-opus-5-5" → "Opus 5.5" (para mostrar o modelo no botão da IA). */
export const niceModel = (s: string) => s.replace(/\bclaude-([a-z]+)-(\d+)-(\d+)\b/gi, (_, n: string, a, b) => `${n[0].toUpperCase()}${n.slice(1)} ${a}.${b}`);
