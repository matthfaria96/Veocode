// Ponte com o Rust (comandos Tauri). No navegador puro (npm run dev) cai num modo
// sem disco, para a interface continuar abrindo.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface ProjectInfo {
  id: string;
  name: string;
  path: string;
  accountId: string;
  access: number;
  addedAt: number;
  stack: string;
  branch: string | null;
  exists: boolean;
}

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  ignored: boolean;
}

export interface DirListing {
  entries: FileEntry[];
  truncated: number;
}

export type FileContent =
  | { kind: "text"; text: string; size: number }
  | { kind: "binary"; size: number }
  | { kind: "tooLarge"; size: number };

export interface FsChange {
  projectId: string;
  changes: { path: string; exists: boolean; isDir: boolean }[];
}

const needsApp = () => Promise.reject(new Error("Abra pelo app (npm run tauri dev) para acessar pastas de verdade."));

export const api = {
  listProjects: (): Promise<ProjectInfo[]> => (isTauri ? invoke("list_projects") : Promise.resolve([])),
  addProject: (path: string): Promise<ProjectInfo> => (isTauri ? invoke("add_project", { path }) : needsApp()),
  removeProject: (projectId: string, trashFolder = false): Promise<void> => (isTauri ? invoke("remove_project", { projectId, trashFolder }) : needsApp()),
  updateProject: (projectId: string, change: { accountId?: string; access?: number }): Promise<ProjectInfo> =>
    isTauri ? invoke("update_project", { projectId, ...change }) : needsApp(),
  listDir: (projectId: string, path: string): Promise<DirListing> => (isTauri ? invoke("list_dir", { projectId, path }) : needsApp()),
  readFile: (projectId: string, path: string): Promise<FileContent> => (isTauri ? invoke("read_file", { projectId, path }) : needsApp()),
  /** Grava o texto num arquivo que já existe. Devolve o tamanho gravado. */
  writeFile: (projectId: string, path: string, text: string): Promise<number> => (isTauri ? invoke("write_file", { projectId, path, text }) : needsApp()),
  /** Cria um arquivo vazio ou uma pasta dentro de `parent` ("" = raiz). Devolve o caminho novo. */
  createEntry: (projectId: string, parent: string, name: string, dir: boolean): Promise<string> =>
    isTauri ? invoke("create_entry", { projectId, parent, name, dir }) : needsApp(),
  renameEntry: (projectId: string, path: string, name: string): Promise<string> => (isTauri ? invoke("rename_entry", { projectId, path, name }) : needsApp()),
  trashEntry: (projectId: string, path: string): Promise<void> => (isTauri ? invoke("trash_entry", { projectId, path }) : needsApp()),
  projectTrail: (projectId: string): Promise<Trail> => (isTauri ? invoke("project_trail", { projectId }) : needsApp()),
  trailLink: (projectId: string, path: string): Promise<void> => (isTauri ? invoke("trail_link", { projectId, path }) : needsApp()),
  trailForget: (projectId: string, path: string): Promise<void> => (isTauri ? invoke("trail_forget", { projectId, path }) : needsApp()),
  /** Todos os arquivos do projeto (para a busca). */
  listFiles: (projectId: string): Promise<string[]> => (isTauri ? invoke("list_files", { projectId }) : Promise.resolve([])),
  /** Abre com o programa padrão do sistema. */
  openEntry: (projectId: string, path: string): Promise<void> => (isTauri ? invoke("open_entry", { projectId, path }) : needsApp()),

  /** Abre o seletor de pastas do sistema. Devolve null se a pessoa cancelar. */
  pickFolder: async (): Promise<string | null> => {
    if (!isTauri) return needsApp();
    const picked = await open({ directory: true, multiple: false, title: "Escolha a pasta do projeto" });
    return typeof picked === "string" ? picked : null;
  },

  reveal: (absPath: string) => (isTauri ? revealItemInDir(absPath) : needsApp()),

  /** Abre um link (só http/https) no navegador padrão. */
  openUrl: (url: string) => (isTauri ? openUrl(url) : Promise.resolve(void window.open(url, "_blank", "noopener"))),

  onFsChange: (cb: (e: FsChange) => void): Promise<UnlistenFn> =>
    isTauri ? listen<FsChange>("fs-change", (e) => cb(e.payload)) : Promise.resolve(() => {}),
};

/** Mostra /Users/nome/... como ~/... (só na tela). */
export const prettyPath = (p: string) => p.replace(/^\/Users\/[^/]+/, "~").replace(/^[A-Za-z]:\\Users\\[^\\]+/, "~");

export const formatSize = (b: number) =>
  b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1).replace(".", ",")} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`;

// ---------------------------------------------------------------- Raio-X

export interface CacheSpec {
  id: string;
  label: string;
  kind: "ia" | "pacotes" | "build";
  tool: string;
  displayPaths: string[];
  warning: string | null;
}

export type Manager = "brew" | "npm" | "pip" | "cargo" | "docker" | "gem" | "go";

export interface AiInstall {
  manager: Manager;
  package: string;
  command: string;
  project: string;
  when: string;
  source: string;
  status: "instalado" | "ausente" | "falhou";
  version: string | null;
  attempts: number;
  removeCmd: string;
}

export interface SystemPackage {
  manager: Manager;
  name: string;
  version: string;
  byAi: boolean;
}

export interface InstallReport {
  aiInstalls: AiInstall[];
  system: SystemPackage[];
  transcriptsRead: number;
  managersFound: Manager[];
}

export interface Machine {
  id: string;
  name: string;
  kind: "container" | "vm";
  engine: string;
  running: boolean;
  statusText: string;
  detail: string | null;
  cpu: string | null;
  ram: string | null;
  disk: string | null;
  ports: string | null;
  canToggle: boolean;
  /** pasta do projeto que criou o container (Docker Compose) */
  project?: string | null;
}

export interface LocalModel {
  tool: "Ollama" | "LM Studio" | "Hugging Face";
  name: string;
  size: number;
  path: string;
  removeCmd: string | null;
  project: string | null;
  when: string | null;
}

export interface ModelReport {
  models: LocalModel[];
  tools: string[];
}

export interface MachineReport {
  machines: Machine[];
  engines: { name: string; installed: boolean; notResponding: boolean }[];
}

export interface Proc {
  pid: number;
  name: string;
  cmd: string;
  cpu: number;
  mem: number;
  ports: number[];
  depth: number;
}

export interface AgentGroup {
  pid: number;
  agent: string;
  cwd: string | null;
  cpu: number;
  mem: number;
  runSecs: number;
  ports: number[];
  children: Proc[];
  /** onde está aberto: "VS Code", "Cursor", "app do Claude", "Veocode", "Terminal" ou "outro" */
  host?: string;
}

export const xrayApi = {
  caches: (): Promise<CacheSpec[]> => invoke("xray_caches"),
  measure: (id: string): Promise<number> => invoke("xray_measure", { id }),
  trash: (id: string): Promise<void> => invoke("xray_trash", { id }),
  installs: (): Promise<InstallReport> => invoke("xray_installs"),
  claudeSpace: (): Promise<ClaudeSpace> => invoke("claude_space"),
  claudeSpaceFix: (id: string): Promise<number> => invoke("claude_space_fix", { id }),
  machines: (): Promise<MachineReport> => invoke("xray_machines"),
  models: (): Promise<ModelReport> => invoke("xray_models"),
  toggleMachine: (engine: string, id: string, start: boolean): Promise<void> => invoke("xray_toggle_machine", { engine, id, start }),
  processes: (): Promise<AgentGroup[]> => invoke("xray_processes"),
  kill: (pid: number): Promise<void> => invoke("xray_kill", { pid }),
};

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

// ---------------------------------------------------------------- Rastro do projeto (src-tauri/src/trail.rs)

export interface TrailOutside {
  path: string;
  exists: boolean;
  isDir: boolean;
  bytes: number;
  files: number;
  how: string;
  last: number;
  manual: boolean;
  temporary: boolean;
}
export interface TrailSource {
  kind: "pagina" | "busca" | "conexao";
  label: string;
  examples: string[];
  count: number;
  last: number;
}
export interface TrailLeftover {
  path: string;
  kind: "depuracao" | "copia" | "temporario" | "ia";
  why: string;
  bytes: number;
  isDir: boolean;
  modified: number;
}
export interface TrailModel {
  name: string;
  tool: "ollama" | "huggingface" | "lmstudio";
  command: string;
  last: number;
}
export interface SpaceFix {
  id: string;
  label: string;
  frees: number;
  items: number;
  warning: string | null;
  needsAppClosed: boolean;
}
export interface SpacePart {
  id: string;
  label: string;
  hint: string;
  bytes: number;
  tone: "runtime" | "sessions" | "cache" | "other";
  paths: string[];
  details: { label: string; bytes: number; note: string | null }[];
  fix: SpaceFix | null;
}
export interface ClaudeSpace {
  total: number;
  groups: { id: "app" | "code" | "veocode"; label: string; hint: string; bytes: number; parts: SpacePart[] }[];
  appRunning: boolean;
  checkedAt: number;
}
export interface Trail {
  outside: TrailOutside[];
  sources: TrailSource[];
  leftovers: TrailLeftover[];
  leftoversBytes: number;
  models: TrailModel[];
  sessions: number;
}
