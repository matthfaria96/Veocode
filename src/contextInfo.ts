// Raio-x do contexto de uma conversa do Claude (o `/context` dele): o que ocupa a janela,
// quanto falta e o que dá para tirar. Medido sob demanda (leva alguns segundos e não gasta
// tokens) e guardado por conversa até a próxima mensagem.

import { invoke } from "@tauri-apps/api/core";
import { createStore } from "solid-js/store";
import { isTauri } from "./api";
import { modal, setModal } from "./modals";
import { projects } from "./store";
import { chatOf } from "./chat";
import { LIVRE, livre } from "./livre";
import { sendPrefs } from "./chatPrefs";
import { tx } from "./i18n";
import { tabsOf } from "./convTabs";

const sessionOfTab = (key: string) => tabsOf(key.split("~")[0]).find((t) => t.key === key)?.session ?? null;

export interface CtxCategory {
  name: string;
  tokens: number;
  pct: number;
}
export interface CtxItem {
  name: string;
  source: string | null;
  tokens: number;
  label: string;
}
export interface CtxGroup {
  title: string;
  items: CtxItem[];
}
export interface ContextData {
  model: string | null;
  used: number;
  total: number;
  categories: CtxCategory[];
  groups: CtxGroup[];
}

interface Entry {
  data: ContextData | null;
  /** quando foi medido (ms) */
  at: number;
  loading: boolean;
  error: string | null;
  /** Chat livre: de qual conversa é a medição (a chave é sempre a mesma) */
  conv?: number;
}

const [store, setStore] = createStore<Record<string, Entry>>({});
const blank: Entry = { data: null, at: 0, loading: false, error: null };
const convOf = (key: string) => (key === LIVRE ? livre.convVer : undefined);
/** A medição da conversa (no Chat livre, só se for da conversa aberta agora). */
export const ctxOf = (key: string): Entry => {
  const e = store[key];
  return e && e.conv === convOf(key) ? e : blank;
};

/** Conversa com a janela do contexto aberta (a paleta de comandos abre por aqui também). */
export const ctxPanel = (): string | null => {
  const m = modal();
  return m?.kind === "context" ? m.k ?? null : null;
};

/** Medição antiga: a conversa mexeu depois dela. */
export const isStale = (key: string) => {
  const e = ctxOf(key);
  return !e.data || ((key === LIVRE ? livre.lastAt : chatOf(key).lastAt) ?? 0) > e.at;
};

/** Total da janela do modelo, se já foi medido alguma vez nesta conversa. */
export const windowOf = (key: string) => ctxOf(key).data?.total ?? null;

export async function measure(key: string) {
  if (ctxOf(key).loading) return;
  const conv = convOf(key);
  setStore(key, { ...ctxOf(key), loading: true, error: null, conv });
  try {
    const base = key.split("~")[0];
    const sim = !isTauri || !!projects.find((p) => p.id === base)?.demo;
    const data = !sim ? await invoke<ContextData>("chat_context", { projectId: key, model: sendPrefs(base).model ?? null, session: chatOf(key).session ?? sessionOfTab(key) }) : demo();
    setStore(key, { data, at: Date.now(), loading: false, error: null, conv });
  } catch (e) {
    setStore(key, { ...ctxOf(key), loading: false, error: e instanceof Error ? e.message : String(e) });
  }
}

/** Abre (ou fecha) a janela do contexto e mede se a medição estiver velha. */
export function toggleCtx(key: string) {
  if (ctxPanel() === key) return setModal(null);
  setModal({ kind: "context", pid: key.split("~")[0], k: key });
  if (isStale(key)) void measure(key);
}

// ---------------------------------------------------------------- nomes e cores

const NAMES: Record<string, string> = {
  "System prompt": "Instruções do sistema",
  "System tools": "Ferramentas do sistema",
  "System tools (deferred)": "Ferramentas do sistema (sob demanda)",
  "MCP tools": "Ferramentas MCP",
  "MCP tools (deferred)": "Ferramentas MCP (sob demanda)",
  "MCP server instructions": "Instruções dos servidores MCP",
  "Custom agents": "Agentes",
  "Memory files": "Arquivos de memória",
  Skills: "Skills",
  Messages: "Mensagens",
  "Free space": "Espaço livre",
  "Autocompact buffer": "Reserva da compactação",
  "MCP Tools": "Ferramentas MCP",
  "Memory Files": "Arquivos de memória",
  "Custom Agents": "Agentes",
  "System Tools": "Ferramentas do sistema",
};
export const ctxName = (n: string) => (NAMES[n] ? tx(NAMES[n]) : n);

const COLORS: Record<string, string> = {
  "System prompt": "#94a3b8",
  "System tools": "#60a5fa",
  "MCP tools": "#22d3ee",
  "MCP server instructions": "#2dd4bf",
  "Custom agents": "#e879f9",
  "Memory files": "#f472b6",
  Skills: "#a78bfa",
  Messages: "#fb923c",
};
export const ctxColor = (n: string) => COLORS[n] ?? "#a3a3a3";

/** Categorias que não ocupam a janela (ferramentas carregadas só quando usadas). */
export const isDeferred = (n: string) => /\(deferred\)/i.test(n);
export const isFree = (n: string) => n === "Free space";
export const isBuffer = (n: string) => /autocompact/i.test(n);

// dados de exemplo para o modo navegador (sem o app)
function demo(): ContextData {
  return {
    model: "claude-opus-5-5",
    used: 141_300,
    total: 400_000,
    categories: [
      { name: "System prompt", tokens: 2900, pct: 0.7 },
      { name: "System tools", tokens: 12_500, pct: 3.1 },
      { name: "MCP tools", tokens: 8400, pct: 2.1 },
      { name: "System tools (deferred)", tokens: 22_400, pct: 5.6 },
      { name: "Memory files", tokens: 1800, pct: 0.5 },
      { name: "Skills", tokens: 10_000, pct: 2.5 },
      { name: "Messages", tokens: 105_700, pct: 26.4 },
      { name: "Free space", tokens: 225_700, pct: 56.4 },
      { name: "Autocompact buffer", tokens: 33_000, pct: 8.3 },
    ],
    groups: [
      { title: "MCP Tools", items: [
        { name: "mcp__github__create_issue", source: "github", tokens: 1100, label: "1.1k" },
        { name: "mcp__github__search_code", source: "github", tokens: 900, label: "900" },
        { name: "mcp__figma__get_design", source: "figma", tokens: 2400, label: "2.4k" },
      ] },
      { title: "Memory Files", items: [{ name: "CLAUDE.md", source: "Project", tokens: 1800, label: "1.8k" }] },
      { title: "Skills", items: [
        { name: "dataviz", source: "Built-in", tokens: 480, label: "~480" },
        { name: "code-review", source: "Built-in", tokens: 400, label: "~400" },
        { name: "pdf", source: "claude.ai sync", tokens: 150, label: "~150" },
      ] },
    ],
  };
}
