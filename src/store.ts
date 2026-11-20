import { createSignal } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { demoProject, type Project } from "./data/mock";
import { api, isTauri, prettyPath, type FileContent, type DirListing, type ProjectInfo } from "./api";
import { locale, tx } from "./i18n";

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
  branch: i.branch ?? tx("sem git"),
  lastActive: i.exists ? "—" : tx("pasta sumiu"),
  live: false,
  demo: false,
  exists: i.exists,
});

/** Caminho absoluto real (o `path` do Project é só para exibir). */
const absPaths = new Map<string, string>();
export const absPathOf = (id: string) => absPaths.get(id);

/** A lista de projetos já veio do disco? (até lá a tela inicial não diz "nenhum projeto") */
export const [projectsReady, setProjectsReady] = createSignal(!isTauri);
/** Demorando: quase sempre é o macOS esperando você liberar o acesso à pasta (pede de novo após atualizar o app). */
export const [projectsSlow, setProjectsSlow] = createSignal(false);

export async function loadProjects() {
  const slow = window.setTimeout(() => setProjectsSlow(true), 2500);
  try {
    const list = await api.listProjects();
    list.forEach((i) => absPaths.set(i.id, i.path));
    // a simulação só aparece enquanto não há nenhuma pasta de verdade (para não confundir com o real)
    setProjects(reconcile(list.length ? list.map(fromInfo) : [structuredClone(demoProject)], { key: "id" }));
    if (list.length > 0) setProjectId(list[0].id);
  } catch (e) {
    showToast(tx("Não deu para abrir a lista de projetos: {e}", { e }));
  } finally {
    window.clearTimeout(slow);
    setProjectsSlow(false);
    setProjectsReady(true);
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
    showToast(tx("{name} adicionado em modo Leitura", { name: info.name }));
  } catch (e) {
    showToast(String(e instanceof Error ? e.message : e));
  }
}

export async function removeProject(id: string, trashFolder = false): Promise<boolean> {
  const name = projects.find((p) => p.id === id)?.name ?? tx("Projeto");
  try {
    await api.removeProject(id, trashFolder);
    const rest = projects.filter((p) => p.id !== id && !p.demo);
    setProjects(rest.length ? rest : [structuredClone(demoProject)]);
    if (projectId() === id) setProjectId(rest[0]?.id ?? "demo");
    if (!rest.length && view() === "workspace") setView("board");
    showToast(trashFolder ? tx("{name} fechado e a pasta foi para a Lixeira", { name }) : tx("{name} saiu do Veocode (a pasta continua no disco)", { name }));
    return true;
  } catch (e) {
    showToast(String(e));
    return false;
  }
}

const persist = (id: string, change: { accountId?: string; access?: number }): Promise<void> => {
  const p = projects.find((x) => x.id === id);
  if (!p || p.demo) return Promise.resolve();
  return Promise.resolve(api.updateProject(id, change)).then(() => undefined, (e) => showToast(tx("Não salvou: {e}", { e })));
};

export function setProjectAccount(id: string, accountId: string): Promise<void> {
  setProjects((p) => p.id === id, "accountId", accountId);
  return persist(id, { accountId });
}

// ---------- Estado do workspace ----------
// No projeto demo é alimentado pela simulação; nos reais, pelo disco (src/realProject.ts).

export type FileMark = "read" | "search" | "edit" | "new" | "deleted";

/** Conteúdo de arquivo real como a interface vê (inclui estados de carregamento). */
export type FileView = FileContent | { kind: "loading" } | { kind: "error"; message: string };

export interface ActivityEvent {
  id: number;
  kind: "think" | "read" | "search" | "swarm" | "edit" | "create" | "delete" | "run" | "tool" | "done" | "user" | "say" | "web" | "plan" | "compact";
  title: string;
  detail?: string;
  time: string;
  status: "running" | "ok" | "error";
  agent: string; // rótulo do cursor que fez
  /** cor de quem fez (conta), para os eventos reais */
  color?: string;
  path?: string;
  /** pedido da pessoa: de onde a conversa recomeça se ela editar ("" = do começo) */
  anchor?: string;
  /** sessão do Claude que fez (passos lidos do histórico) */
  session?: string;
  /** aba do chat (pedidos e respostas enviados por ela) */
  tab?: string;
  /** subagente que fez o passo (id) e o rótulo dele */
  sub?: string;
  subLabel?: string;
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

/** Aba de "o que mudou" de um arquivo (no editor, ao lado das abas de arquivo). */
export const DIFF = "diff:";
export const isDiffTab = (t: string) => t.startsWith(DIFF);
export const diffPathOf = (t: string) => t.slice(DIFF.length);
/** A aba que junta todas as mudanças da pasta, um arquivo embaixo do outro. */
export const ALL_CHANGES = DIFF + "*";
export const openAllChanges = () => openFile(ALL_CHANGES);
/** Aba de um commit: os arquivos dele à esquerda e, ao lado, antes e depois de cada um. */
export const COMMIT = DIFF + "@commit:";
export const isCommitTab = (t: string) => t.startsWith(COMMIT);
export const commitOfTab = (t: string) => t.slice(COMMIT.length);
const isFileDiff = (t: string) => isDiffTab(t) && t !== ALL_CHANGES && !isCommitTab(t);

/** Abre `tab` no lugar da aba de comparação que já está aberta (do mesmo tipo), como a prévia do
 *  VS Code: clicar em vários arquivos ou commits seguidos não enche a fileira de abas. */
function openPreview(tab: string, same: (t: string) => boolean) {
  if (ws.openTabs.includes(tab)) return setWs("activeFile", tab);
  const old = ws.openTabs.find(same);
  if (old) setWs("openTabs", (l) => l.map((t) => (t === old ? tab : t)));
  else setWs("openTabs", (l) => [...l, tab]);
  setWs("activeFile", tab);
}
export const openDiff = (path: string) => openPreview(DIFF + path, isFileDiff);
export const openCommit = (hash: string) => openPreview(COMMIT + hash, isCommitTab);

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
  const time = now.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const ev: ActivityEvent = { status: "running", ...e, id, time };
  setWs("events", (list) => [...list, ev].slice(-4000));
  return id;
}
export function finishEvent(id: number, detail?: string) {
  setWs("events", (e) => e.id === id, (e): ActivityEvent => ({ ...e, status: "ok", detail: detail ?? e.detail }));
}
