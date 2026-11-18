// Contas de IA. No app vêm do Rust (src-tauri/src/accounts); no navegador puro usam dados fictícios.

import { invoke } from "@tauri-apps/api/core";
import { createStore, reconcile } from "solid-js/store";
import { isTauri } from "./api";
import { accounts as mockAccounts } from "./data/mock";
import { setProjects, showToast } from "./store";

export type ProviderId = "claude" | "deepseek" | "openai" | "ollama";

export const providers: Record<ProviderId, { id: ProviderId; name: string; kind: "nuvem" | "local"; auth: string }> = {
  claude: { id: "claude", name: "Claude", kind: "nuvem", auth: "Login do Claude Code" },
  deepseek: { id: "deepseek", name: "DeepSeek", kind: "nuvem", auth: "Chave de API" },
  openai: { id: "openai", name: "Compatível com OpenAI", kind: "nuvem", auth: "Chave de API" },
  ollama: { id: "ollama", name: "Ollama", kind: "local", auth: "Servidor local" },
};

export interface Account {
  id: string;
  label: string;
  provider: ProviderId;
  color: string;
  model: string | null;
  configDir: string | null;
  baseUrl: string | null;
  keyHint: string | null;
  createdAt: number;
  /** Claude: pasta de configuração já resolvida. */
  dir: string | null;
}

export interface Usage {
  today: number;
  todayOut: number;
  last5h: number;
  days: number[];
  sessionsToday: number;
  messagesToday: number;
  lastActiveSecs: number | null;
  models: [string, number][];
}

export type AccountState = "pronta" | "semLogin" | "semChave" | "offline" | "erro";

export interface AccountStatus {
  id: string;
  state: AccountState;
  plan: string | null;
  who: string | null;
  detail: string | null;
  models: string[];
  balance: string | null;
  active: boolean;
  usage: Usage | null;
}

export interface NewAccount {
  provider: ProviderId;
  label: string;
  color: string;
  model?: string | null;
  baseUrl?: string | null;
  configDir?: string | null;
}

interface AcctState {
  list: Account[];
  loaded: boolean;
  status: Record<string, AccountStatus>;
  checking: Record<string, boolean>;
}

export const [accts, setAccts] = createStore<AcctState>({ list: [], loaded: false, status: {}, checking: {} });

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const placeholder: Account = { id: "", label: "Sem conta", provider: "claude", color: "#6c7589", model: null, configDir: null, baseUrl: null, keyHint: null, createdAt: 0, dir: null };

/** Nunca devolve undefined: conta apagada (ou o projeto demo) cai na primeira conta. */
export const accountById = (id: string): Account => accts.list.find((a) => a.id === id) ?? accts.list[0] ?? placeholder;

/** Linha curta embaixo do nome: modelo escolhido, senão o mais usado, senão o plano. */
export const accountSub = (a: Account) => {
  const s = accts.status[a.id];
  return a.model ?? s?.models[0] ?? s?.plan ?? providers[a.provider].name;
};

export const isWorking = (id: string) => !!accts.status[id]?.active;

// ---------------------------------------------------------------- dados fictícios (navegador)

const mockList = (): Account[] =>
  mockAccounts.map((a) => ({ id: a.id, label: a.label, provider: a.provider, color: a.color, model: a.model, configDir: null, baseUrl: null, keyHint: a.provider === "deepseek" ? "…9f2c" : null, createdAt: 0, dir: a.provider === "claude" ? `~/.veocode/${a.id}` : null }));

const mockStatus = (a: Account): AccountStatus => {
  const m = mockAccounts.find((x) => x.id === a.id);
  const base = { id: a.id, state: "pronta" as AccountState, plan: m?.plan ?? null, who: a.provider === "claude" ? "voce@exemplo.com" : null, detail: null, models: m ? [m.model] : [], balance: a.provider === "deepseek" ? "US$ 7,40" : null, active: m?.status === "ativa", usage: null };
  if (a.provider !== "claude") return base;
  const days = [3.1, 5.4, 2.2, 6.8, 4.1, 1.2, 1.8].map((x) => Math.round(x * 1e6 * (a.id === "claude-trabalho" ? 0.4 : 1)));
  return { ...base, usage: { today: days[6], todayOut: days[6] / 5, last5h: days[6] * 0.6, days, sessionsToday: 3, messagesToday: 120, lastActiveSecs: m?.status === "ativa" ? 4 : 5400, models: [["claude-opus-5-5", days[6] * 4]] } };
};

// ---------------------------------------------------------------- carregar

export async function loadAccounts() {
  const list = isTauri ? await invoke<Account[]>("accounts_list").catch((e) => (showToast(`Contas: ${errMsg(e)}`), [] as Account[])) : mockList();
  setAccts("list", reconcile(list, { key: "id" }));
  setAccts("loaded", true);
  // o projeto demo nasce apontando para uma conta fictícia: usa a primeira de verdade
  if (list.length) setProjects((p) => !!p.demo && !list.some((a) => a.id === p.accountId), "accountId", list[0].id);
  refreshStatuses();
}

/** `apis`: também testa as contas por API (vai à internet). */
export async function refreshStatuses(apis = true) {
  await Promise.all(accts.list.filter((a) => apis || a.provider === "claude" || a.provider === "ollama").map((a) => checkAccount(a.id)));
}

export async function checkAccount(id: string) {
  const a = accts.list.find((x) => x.id === id);
  if (!a || accts.checking[id]) return;
  setAccts("checking", id, true);
  try {
    const s = isTauri ? await invoke<AccountStatus>("account_status", { id }) : mockStatus(a);
    setAccts("status", id, reconcile(s));
  } catch (e) {
    showToast(`${a.label}: ${errMsg(e)}`);
  }
  setAccts("checking", id, false);
}

// ---------------------------------------------------------------- alterar

const needsApp = () => {
  throw new Error("No navegador é só demonstração. Abra pelo app para mexer nas contas.");
};

export async function addAccount(n: NewAccount, key?: string): Promise<Account> {
  if (!isTauri) needsApp();
  let a = await invoke<Account>("account_add", { account: n });
  setAccts("list", (l) => [...l, a]);
  if (key?.trim()) {
    a = await invoke<Account>("account_set_key", { id: a.id, key });
    setAccts("list", (x) => x.id === a.id, a);
  }
  checkAccount(a.id);
  return a;
}

export async function updateAccount(id: string, change: { label?: string; color?: string; model?: string }) {
  if (!isTauri) {
    setAccts("list", (x) => x.id === id, (a) => ({ ...a, ...change }));
    return;
  }
  const a = await invoke<Account>("account_update", { id, ...change });
  setAccts("list", (x) => x.id === id, a);
}

export async function setAccountKey(id: string, key: string) {
  if (!isTauri) needsApp();
  const a = await invoke<Account>("account_set_key", { id, key });
  setAccts("list", (x) => x.id === id, a);
  checkAccount(id);
}

export async function removeAccount(id: string) {
  if (!isTauri) needsApp();
  await invoke("account_remove", { id });
  setAccts("list", (l) => l.filter((a) => a.id !== id));
}

export async function loginAccount(id: string) {
  if (!isTauri) needsApp();
  await invoke("account_login", { id });
}

// ---------------------------------------------------------------- formatação

export const fmtTokens = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(".", ",")} M` : n >= 1e3 ? `${Math.round(n / 1e3)} k` : `${Math.round(n)}`;

export const fmtAgo = (s: number | null) =>
  s === null ? "nunca" : s < 90 ? "agora" : s < 3600 ? `há ${Math.round(s / 60)} min` : s < 86400 ? `há ${Math.round(s / 3600)} h` : `há ${Math.round(s / 86400)} d`;

export const prettyModel = (m: string) =>
  m.replace(/^claude-/, "").replace(/-(\d+)-(\d+)$/, " $1.$2").replace(/^./, (c) => c.toUpperCase());

export const stateText: Record<AccountState, string> = {
  pronta: "pronta",
  semLogin: "sem login",
  semChave: "sem chave",
  offline: "fora do ar",
  erro: "com erro",
};

export const palette = ["#e8915b", "#c084fc", "#4f8cff", "#34d399", "#f472b6", "#fbbf24", "#22d3ee", "#f87171"];
