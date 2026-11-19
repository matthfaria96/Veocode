// Cofre: chaves de API e logins que os projetos usam. O segredo fica no chaveiro do sistema;
// aqui chegam só o nome, o tipo, a variável e o final do segredo.

import { invoke } from "@tauri-apps/api/core";
import { createStore } from "solid-js/store";
import { copyText, isTauri } from "./api";
import { showToast } from "./store";
import { tx } from "./i18n";

export type VaultKind = "chave" | "login" | "outro";
export interface VaultItem {
  id: string;
  name: string;
  kind: VaultKind;
  env: string | null;
  user: string | null;
  site: string | null;
  projects: string[];
  hint: string;
  addedAt: number;
}

export const [vault, setVault] = createStore<{ items: VaultItem[]; loaded: boolean }>({ items: [], loaded: false });

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Atalhos para os serviços mais comuns: já vêm com o nome da variável certa. */
export const presets: { label: string; env: string; kind: VaultKind; color: string; hint: string }[] = [
  { label: "OpenAI", env: "OPENAI_API_KEY", kind: "chave", color: "#10a37f", hint: "sk-…" },
  { get label() { return tx("Anthropic"); }, env: "ANTHROPIC_API_KEY", kind: "chave", color: "#e8915b", hint: "sk-ant-…" },
  { get label() { return "Google Gemini"; }, env: "GEMINI_API_KEY", kind: "chave", color: "#4f8cff", hint: "AIza…" },
  { label: "GitHub", env: "GITHUB_TOKEN", kind: "chave", color: "#a78bfa", hint: "ghp_…" },
  { get label() { return tx("Stripe"); }, env: "STRIPE_SECRET_KEY", kind: "chave", color: "#635bff", get hint() { return tx("sk_live_… ou sk_test_…"); } },
  { get label() { return tx("Supabase"); }, env: "SUPABASE_KEY", kind: "chave", color: "#3ecf8e", hint: "eyJ…" },
  { get label() { return tx("Login de site"); }, env: "SITE", kind: "login", color: "#fbbf24", hint: "senha" },
  { get label() { return tx("Outro segredo"); }, env: "", kind: "outro", color: "#94a3b8", hint: "valor" },
];

const mock: VaultItem[] = [
  { id: "m1", name: "OpenAI pessoal", kind: "chave", env: "OPENAI_API_KEY", user: null, site: null, projects: [], hint: "…9f2c", addedAt: 0 },
  { id: "m2", name: "Painel da loja", kind: "login", env: "LOJA", user: "admin@exemplo.com", site: "loja.exemplo.com", projects: [], hint: "••••", addedAt: 0 },
];

export async function loadVault() {
  if (!isTauri) return setVault({ items: mock, loaded: true });
  try {
    setVault({ items: await invoke<VaultItem[]>("vault_list"), loaded: true });
  } catch (e) {
    showToast(tx("Não deu para abrir o cofre: {v}", { v: errMsg(e) }));
  }
}

export async function saveVault(item: Partial<VaultItem> & { name: string; kind: VaultKind }, secret: string | null): Promise<boolean> {
  const full = { id: "", env: null, user: null, site: null, projects: [], hint: "", addedAt: 0, ...item };
  if (!isTauri) {
    const it = { ...full, id: full.id || `m${Date.now()}`, hint: secret ? `…${secret.slice(-4)}` : full.hint };
    setVault("items", (l) => [...l.filter((x) => x.id !== it.id), it]);
    showToast(tx("Navegador: só simulação"));
    return true;
  }
  try {
    const saved = await invoke<VaultItem>("vault_save", { item: full, secret: secret || null });
    setVault("items", (l) => [...l.filter((x) => x.id !== saved.id), saved]);
    showToast(tx("{name} guardado no chaveiro", { name: saved.name }));
    return true;
  } catch (e) {
    showToast(errMsg(e));
    return false;
  }
}

export async function deleteVault(it: VaultItem) {
  try {
    if (isTauri) await invoke("vault_delete", { id: it.id });
    setVault("items", (l) => l.filter((x) => x.id !== it.id));
    showToast(tx("{name} saiu do cofre", { name: it.name }));
  } catch (e) {
    showToast(errMsg(e));
  }
}

export async function copyVault(it: VaultItem) {
  try {
    const s = isTauri ? await invoke<string>("vault_reveal", { id: it.id }) : "exemplo";
    await copyText(s);
    showToast(tx("{v} de {name} copiada", { v: it.kind === "login" ? tx("Senha") : tx("Chave"), name: it.name }));
  } catch (e) {
    showToast(errMsg(e));
  }
}

/** Os nomes das variáveis que a entrada cria no ambiente. */
export const envNames = (it: Pick<VaultItem, "kind" | "env">) => (!it.env ? [] : it.kind === "login" ? [`${it.env}_USER`, `${it.env}_PASSWORD`] : [it.env]);
