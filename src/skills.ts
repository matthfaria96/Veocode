// Skills, comandos, agentes e MCP. No app vêm do Rust (src-tauri/src/skills.rs); no navegador, exemplo.

import { invoke } from "@tauri-apps/api/core";
import { createStore, reconcile } from "solid-js/store";
import { isTauri } from "./api";
import { skills as mockSkills } from "./data/mock";
import { showToast } from "./store";
import { tx } from "./i18n";

export type Kind = "skill" | "command" | "agent" | "mcp";
export type Layer = "conta" | "plugin" | "projeto";

export interface McpInfo {
  transport: string;
  command: string | null;
  args: string[];
  url: string | null;
  envNames: string[];
  headerNames: string[];
  found: boolean | null;
  definedIn: string;
  /** user (conta), local (conta + pasta), project (.mcp.json) ou plugin */
  scope: "user" | "local" | "project" | "plugin";
}

export interface Item {
  id: string;
  kind: Kind;
  name: string;
  description: string;
  layer: Layer;
  accounts: string[];
  project: string | null;
  plugin: string | null;
  origin: string | null;
  /** programa que instalou várias juntas (ex.: "chatcut-desktop"), lido da lista dele */
  group?: string | null;
  path: string | null;
  enabled: boolean;
  mcp: McpInfo | null;
  /** nome + descrição: entram em toda conversa */
  alwaysTokens: number;
  /** o arquivo inteiro: entra quando é usado */
  invokeTokens: number;
  /** como tirar: trash (Lixeira), plugin (vem de um plugin), synced (claude.ai), cli (MCP) */
  manage: "trash" | "plugin" | "synced" | "cli";
}

export interface PluginInfo {
  id: string;
  name: string;
  description: string;
  version: string | null;
  enabled: boolean;
  account: string;
  project: string | null;
  path: string;
  skills: number;
  mcp: number;
  /** id do Claude Code: nome@marketplace */
  pluginId: string;
  scope: "user" | "project" | "local";
  bytes: number;
  alwaysTokens: number;
}

interface SkillsState {
  items: Item[];
  plugins: PluginInfo[];
  loaded: boolean;
  loading: boolean;
  /** última leitura falhou: a tela mostra o motivo e "Tentar de novo" */
  error: string | null;
}

export const [sk, setSk] = createStore<SkillsState>({ items: [], plugins: [], loaded: false, loading: false, error: null });

const mock = (): { items: Item[]; plugins: PluginInfo[] } => ({
  items: mockSkills.map((s) => ({
    id: s.id,
    kind: s.kind,
    name: s.name,
    description: s.description,
    layer: s.scope === "projeto" ? "projeto" : "conta",
    accounts: s.usedBy,
    project: s.scope === "projeto" ? `~/dev/${s.scopeRef}` : null,
    plugin: null,
    origin: s.scope === "global" ? "exemplo" : null,
    path: null,
    enabled: s.enabled,
    mcp: s.kind === "mcp" ? { transport: "stdio", command: `npx @exemplo/${s.name}`, args: [], url: null, envNames: s.name === "github" ? ["GITHUB_TOKEN"] : [], headerNames: [], found: true, definedIn: "~/.claude.json", scope: "user" } : null,
    alwaysTokens: s.kind === "mcp" ? 0 : 60,
    invokeTokens: s.kind === "mcp" ? 0 : 1800,
    manage: s.kind === "mcp" ? "cli" : "trash",
  })),
  plugins: [{ id: "p", name: "figma", description: tx("Servidor MCP e skills do Figma."), version: "2.2.0", enabled: true, account: "claude-pessoal", project: null, path: "", skills: 16, mcp: 1, pluginId: "figma@exemplo", scope: "user", bytes: 4_200_000, alwaysTokens: 2400 }],
});

export async function loadSkills() {
  if (sk.loading) return;
  setSk({ loading: true, error: null });
  try {
    const r = isTauri ? await invoke<{ items: Item[]; plugins: PluginInfo[] }>("skills_report") : mock();
    setSk("items", reconcile(r.items, { key: "id" }));
    setSk({ plugins: r.plugins, loaded: true });
  } catch (e) {
    setSk("error", e instanceof Error ? e.message : String(e));
    showToast(tx("Não deu para ler os extras do Claude"));
  }
  setSk("loading", false);
}

export const readSkillFile = (path: string): Promise<string> =>
  isTauri ? invoke<string>("skill_read", { path }) : Promise.resolve(tx("---\nname: exemplo\n---\n\nNo navegador o conteúdo é só de exemplo."));

export const kindLabel: Record<Kind, string> = { get skill() { return tx("Receita"); }, command: "Atalho /", agent: "Ajudante", get mcp() { return tx("Conexão"); } };
