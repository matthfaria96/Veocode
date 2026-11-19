import { createSignal } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { demoProject, type Project } from "./data/mock";
import { api, prettyPath, type FileContent, type DirListing, type ProjectInfo } from "./api";

export type View = "board" | "workspace" | "accounts" | "system" | "inventory" | "settings" | "livre";

export const [view, setView] = createSignal<View>("board");
export const [paletteOpen, setPaletteOpen] = createSignal(false);
export const [helpOpen, setHelpOpen] = createSignal(false);
export const [toast, setToast] = createSignal<string | null>(null);

let toastTimer: number | undefined;
export function showToast(msg: string) {
  setToast(msg);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => setToast(null), 2600);
}

// ---------- Projetos (conta + nível de acesso editáveis) ----------

export const [projects, setProjects] = createStore<Project[]>([structuredClone(demoProject)]);
export const [projectId, setProjectId] = createSignal("demo");
export const currentProject = () => projects.find((p) => p.id === projectId()) ?? projects[0];

const fromInfo = (i: ProjectInfo): Project => ({
  id: i.id,
  name: i.name,
  path: prettyPath(i.path),
  stack: i.stack,
  accountId: i.accountId,
  access: i.access,
  branch: i.branch ?? "sem git",
  lastActive: i.exists ? "—" : "pasta sumiu",
  live: false,
  demo: false,
  exists: i.exists,
});

/** Caminho absoluto real (o `path` do Project é só para exibir). */
const absPaths = new Map<string, string>();
export const absPathOf = (id: string) => absPaths.get(id);

export async function loadProjects() {
  try {
    const list = await api.listProjects();
    list.forEach((i) => absPaths.set(i.id, i.path));
    // a simulação só aparece enquanto não há nenhuma pasta de verdade (para não confundir com o real)
    setProjects(reconcile(list.length ? list.map(fromInfo) : [structuredClone(demoProject)], { key: "id" }));
    if (list.length > 0) setProjectId(list[0].id);
  } catch (e) {
    showToast(`Não deu para abrir a lista de projetos: ${e}`);
  }
}

/** Abre o seletor de pastas e adiciona a escolhida como projeto. */
export async function addProjectFromPicker() {
  const path = await api.pickFolder().catch(() => null);
  if (path) await addProjectPath(path);
}

/** Põe uma pasta como projeto (ou só abre, se já é) e vai para a tela Projetos. */
export async function addProjectPath(path: string, go = true) {
  try {
    const info = await api.addProject(path);
    absPaths.set(info.id, info.path);
    if (!projects.some((p) => p.id === info.id)) setProjects((l) => [...l.filter((p) => !p.demo), fromInfo(info)]);
    if (go) {
      setProjectId(info.id);
      setView("workspace");
    }
    showToast(`${info.name} adicionado em modo Leitura`);
  } catch (e) {
    showToast(String(e instanceof Error ? e.message : e));
  }
}

export async function removeProject(id: string) {
  try {
    await api.removeProject(id);
    const rest = projects.filter((p) => p.id !== id && !p.demo);
    setProjects(rest.length ? rest : [structuredClone(demoProject)]);
    if (projectId() === id) setProjectId(rest[0]?.id ?? "demo");
    showToast("Removido da lista (a pasta continua no disco)");
  } catch (e) {
    showToast(String(e));
  }
}

const persist = (id: string, change: { accountId?: string; access?: number }) => {
  const p = projects.find((x) => x.id === id);
  if (p && !p.demo) api.updateProject(id, change).catch((e) => showToast(`Não salvou: ${e}`));
};

export function setProjectAccount(id: string, accountId: string) {
  setProjects((p) => p.id === id, "accountId", accountId);
  persist(id, { accountId });
}

// ---------- Estado do workspace ----------
// No projeto demo é alimentado pela simulação; nos reais, pelo disco (src/realProject.ts).

export type FileMark = "read" | "search" | "edit" | "new" | "deleted";

/** Conteúdo de arquivo real como a interface vê (inclui estados de carregamento). */
export type FileView = FileContent | { kind: "loading" } | { kind: "error"; message: string };

export interface ActivityEvent {
  id: number;
  kind: "think" | "read" | "search" | "swarm" | "edit" | "create" | "delete" | "run" | "tool" | "done" | "user" | "say" | "web" | "plan";
  title: string;
  detail?: string;
  time: string;
  status: "running" | "ok" | "error";
  agent: string; // rótulo do cursor que fez
  /** cor de quem fez (conta), para os eventos reais */
  color?: string;
  path?: string;
}

export interface Cursor {
  id: string;
  label: string;
  color: string;
  x: number;
  y: number;
  visible: boolean;
  clicking: boolean;
  main: boolean;
}

interface WorkspaceState {
  openTabs: string[];
  activeFile: string;
  marks: Record<string, FileMark>;
  extraFiles: string[];
  events: ActivityEvent[];
  terminal: { text: string; tone?: "cmd" | "ok" | "dim" }[];
  inserted: Record<string, { from: number; remove: number; lines: string[] }>;
  cursors: Cursor[];
  running: boolean;
  paused: boolean;
  // --- projetos reais ---
  /** Pastas já carregadas ("" = raiz). */
  tree: Record<string, DirListing>;
  expanded: Record<string, boolean>;
  contents: Record<string, FileView>;
  /** Linhas que mudaram na última vez que o arquivo foi alterado no disco. */
  changedLines: Record<string, number[]>;
}

const initialWorkspace = (demo = true): WorkspaceState => ({
  openTabs: demo ? ["src/App.tsx"] : [],
  activeFile: demo ? "src/App.tsx" : "",
  marks: {},
  extraFiles: [],
  events: [],
  terminal: demo ? [{ text: "veocode on  main", tone: "dim" }] : [],
  inserted: {},
  cursors: [],
  running: false,
  paused: false,
  tree: {},
  expanded: {},
  contents: {},
  changedLines: {},
});

export const [ws, setWs] = createStore<WorkspaceState>(initialWorkspace());
export const resetWorkspace = (demo = true) => setWs(reconcile(initialWorkspace(demo)));

export function openFile(path: string) {
  if (!ws.openTabs.includes(path)) setWs("openTabs", (t) => [...t, path]);
  setWs("activeFile", path);
}

export function closeTab(path: string) {
  const tabs = ws.openTabs.filter((t) => t !== path);
  setWs("openTabs", tabs);
  if (ws.activeFile === path) setWs("activeFile", tabs[tabs.length - 1] ?? "");
}

let eventSeq = 0;
export function pushEvent(e: Omit<ActivityEvent, "id" | "time" | "status"> & { status?: ActivityEvent["status"]; at?: number }) {
  const id = ++eventSeq;
  const now = e.at ? new Date(e.at) : new Date();
  delete e.at;
  const time = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const ev: ActivityEvent = { status: "running", ...e, id, time };
  setWs("events", (list) => [...list, ev].slice(-60));
  return id;
}
export function finishEvent(id: number, detail?: string) {
  setWs("events", (e) => e.id === id, (e): ActivityEvent => ({ ...e, status: "ok", detail: detail ?? e.detail }));
}
