// Nível de acesso de verdade. O Rust (src-tauri/src/access.rs) traduz o nível em regras de
// permissão do Claude Code e grava em .claude/settings.local.json do projeto.

import { invoke } from "@tauri-apps/api/core";
import { createStore, reconcile } from "solid-js/store";
import { isTauri } from "./api";
import { projects, setProjects, showToast } from "./store";
import { tx } from "./i18n";

export type Rule = "permitido" | "pergunta" | "bloqueado";

export interface CapRow {
  id: string;
  label: string;
  hint: string;
  rule: Rule;
  fromLevel: Rule;
  choices: Rule[];
  rules: string[];
}

export type FileState =
  | { state: "naoAplicado" }
  | { state: "aplicado" }
  | { state: "alterado"; missing: string[] }
  | { state: "erro"; message: string };

export interface AccessReport {
  level: number;
  mode: string;
  caps: CapRow[];
  file: string;
  fileState: FileState;
  ownRules: string[];
  loosen: { source: string; rule: string; cap: string }[];
  preview: string;
}

interface AccState {
  reports: Record<string, AccessReport>;
  busy: Record<string, boolean>;
  /** ajustes do projeto demo (só na memória) */
  demo: Record<string, Rule>;
}

export const [acc, setAcc] = createStore<AccState>({ reports: {}, busy: {}, demo: {} });

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isDemo = (id: string) => !!projects.find((p) => p.id === id)?.demo;

export const ruleText: Record<Rule, string> = { get permitido() { return tx("Permitido"); }, get pergunta() { return tx("Pergunta"); }, get bloqueado() { return tx("Bloqueado"); } };
export const modeText: Record<string, string> = {
  get plan() { return tx("Plan (só planeja)"); },
  get default() { return tx("Manual (pergunta antes)"); },
  get acceptEdits() { return tx("Aceitar edições"); },
};

// ---------------------------------------------------------------- navegador puro (exemplo)

const MOCK: [string, string, string, Rule[], Rule[]][] = [
  ["edit", "Editar arquivos", "Edit, Write e notebooks", ["bloqueado", "pergunta", "permitido", "permitido"], ["permitido", "pergunta", "bloqueado"]],
  ["shell", "Rodar comandos no terminal", "comandos de leitura rodam sem perguntar", ["bloqueado", "pergunta", "pergunta", "permitido"], ["permitido", "pergunta", "bloqueado"]],
  ["install", "Instalar no sistema", "brew, npm -g, pip, cargo install, sudo", ["bloqueado", "bloqueado", "pergunta", "pergunta"], ["permitido", "pergunta", "bloqueado"]],
  ["push", "Publicar com git push", "manda o código para o remoto", ["bloqueado", "bloqueado", "pergunta", "pergunta"], ["permitido", "pergunta", "bloqueado"]],
  ["net", "Acesso à internet", "WebFetch e WebSearch", ["pergunta", "pergunta", "permitido", "permitido"], ["permitido", "pergunta", "bloqueado"]],
  ["mcp", "Ferramentas MCP", "servidores MCP", ["bloqueado", "pergunta", "pergunta", "pergunta"], ["pergunta", "bloqueado"]],
];
const mockReport = (level: number, o: Record<string, Rule>): AccessReport => ({
  level,
  mode: ["plan", "default", "acceptEdits", "acceptEdits"][level],
  caps: MOCK.map(([id, label, hint, levels, choices]) => ({ id, label: tx(label), hint: tx(hint), rule: o[id] ?? levels[level], fromLevel: levels[level], choices, rules: [] })),
  file: "",
  fileState: { state: "naoAplicado" },
  ownRules: [],
  loosen: [],
  preview: tx("No navegador é só exemplo."),
});

// ---------------------------------------------------------------- ações

async function run(id: string, f: () => Promise<AccessReport>) {
  setAcc("busy", id, true);
  try {
    const r = await f();
    setAcc("reports", id, reconcile(r, { key: "id" }));
    return r;
  } catch (e) {
    showToast(errMsg(e));
    // recarrega para a tela mostrar o estado real do arquivo
    if (isTauri && !isDemo(id)) invoke<AccessReport>("access_report", { projectId: id }).then((r) => setAcc("reports", id, reconcile(r, { key: "id" })), () => {});
  } finally {
    setAcc("busy", id, false);
  }
}

const levelOf = (id: string) => projects.find((p) => p.id === id)?.access ?? 0;

const preview = (id: string) =>
  isTauri ? invoke<AccessReport>("access_preview", { level: levelOf(id), overrides: acc.demo }) : Promise.resolve(mockReport(levelOf(id), acc.demo));

export function loadAccess(id: string) {
  return run(id, () => (isDemo(id) || !isTauri ? preview(id) : invoke<AccessReport>("access_report", { projectId: id })));
}

export function setLevel(id: string, level: number) {
  setProjects((p) => p.id === id, "access", level);
  if (isDemo(id) || !isTauri) {
    setAcc("demo", reconcile({}));
    return run(id, () => preview(id));
  }
  return run(id, () => invoke<AccessReport>("access_set", { projectId: id, level }));
}

/** `rule: null` volta ao padrão do nível. */
export function setCap(id: string, cap: string, rule: Rule | null) {
  if (isDemo(id) || !isTauri) {
    setAcc("demo", cap, rule ?? undefined!);
    return run(id, () => preview(id));
  }
  return run(id, () => invoke<AccessReport>("access_set", { projectId: id, cap, rule }));
}

export const applyAccess = (id: string) => run(id, () => invoke<AccessReport>("access_apply", { projectId: id }));
export const removeAccess = (id: string) => run(id, () => invoke<AccessReport>("access_remove", { projectId: id }));

export async function openClaude(id: string) {
  try {
    await invoke("open_claude", { projectId: id });
    showToast(tx("Abrindo o Claude Code no Terminal…"));
  } catch (e) {
    showToast(errMsg(e));
  }
}
