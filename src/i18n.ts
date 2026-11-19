// Idioma da interface: português (o texto do próprio código) ou inglês (dicionário em i18n/en.ts).
// A chave é o texto em português, como está no código: se faltar a tradução, aparece o português.
// tx() lê o ajuste reativo, então trocar o idioma em Ajustes troca a tela na hora.

import { invoke } from "@tauri-apps/api/core";
import { createEffect, createSignal } from "solid-js";
import en from "./i18n/en";

export type Lang = "pt" | "en";

const systemLang = (): Lang => {
  const first = (typeof navigator !== "undefined" && (navigator.languages?.[0] || navigator.language)) || "";
  return first.toLowerCase().startsWith("pt") ? "pt" : "en";
};

// O ajuste fica aqui (e não lido de settings.ts) para este arquivo não depender de nenhum outro do app:
// quase todos importam tx(), e uma volta settings → api → i18n travaria a abertura.
const [pref, setPref] = createSignal<"sistema" | Lang>("sistema");
/** settings.ts chama ao carregar e ao mudar o ajuste. */
export const setLanguagePref = (v: string) => setPref(v === "pt" || v === "en" ? v : "sistema");

/** Idioma em uso agora. */
export const lang = (): Lang => {
  const p = pref();
  return p === "sistema" ? systemLang() : p;
};

/** Para datas e números (toLocaleString). */
export const locale = () => (lang() === "en" ? "en-US" : "pt-BR");

const dict = en as Record<string, string>;

/**
 * Texto no idioma da tela. `vars` preenche {nome} nos dois idiomas:
 * tx("Aberta há {tempo}", { tempo: "3 h" }).
 */
export function tx(pt: string, vars?: Record<string, unknown>): string {
  let s = lang() === "en" ? dict[pt] ?? pt : pt;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k] ?? "") : m));
  return s;
}

/** Singular ou plural: txn(n, "{n} projeto", "{n} projetos"). */
export const txn = (n: number, one: string, many: string, vars?: Record<string, unknown>) =>
  tx(n === 1 ? one : many, { n, ...vars });

/** Mantém o Rust e o `<html lang>` no idioma da tela (ao abrir e quando o ajuste muda). */
export function watchLanguage() {
  createEffect(() => {
    const l = lang();
    document.documentElement.lang = l === "en" ? "en" : "pt-BR";
    if ("__TAURI_INTERNALS__" in window) void invoke("i18n_set", { en: l === "en" }).catch(() => {});
  });
}

/** Número com casas decimais na vírgula (pt) ou no ponto (en). */
export const dec = (n: number, digits = 1) => {
  const s = n.toFixed(digits);
  return lang() === "en" ? s : s.replace(".", ",");
};
