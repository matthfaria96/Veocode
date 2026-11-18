// O que a pessoa faz com arquivos e pastas na árvore: criar, renomear, abrir no programa
// padrão, mostrar no Finder/Explorer e mandar para a Lixeira.

import { createSignal, type JSX } from "solid-js";
import { api } from "./api";
import { askName, confirmAction } from "./dialogs";
import { dropDraft, isUnsaved, markOwn, moveDraft, saveNow } from "./editing";
import { loadDir, openRealFile } from "./realProject";
import { absPathOf, closeTab, projectId, setWs, showToast, ws } from "./store";

const errText = (e: unknown) => String(e instanceof Error ? e.message : e);
const parentOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const nameOf = (p: string) => p.split("/").pop() ?? p;

/** Mostra a pasta aberta na árvore (e as de cima). */
export async function expandTo(dir: string) {
  const parts = dir ? dir.split("/") : [];
  for (let i = 0; i <= parts.length; i++) {
    const d = parts.slice(0, i).join("/");
    setWs("expanded", d, true);
    if (!ws.tree[d]) await loadDir(d);
  }
}

export async function newEntry(parent: string, dir: boolean) {
  const where = parent ? `em ${parent}` : "na pasta do projeto";
  const name = await askName(dir ? "Nova pasta" : "Novo arquivo", "Criar", dir ? "nova-pasta" : "novo-arquivo.txt", `Vai ser criado ${where}.`);
  if (!name) return;
  try {
    markOwn(projectId(), parent ? `${parent}/${name}` : name);
    const path = await api.createEntry(projectId(), parent, name, dir);
    await expandTo(parent);
    await loadDir(parent);
    if (dir) {
      setWs("expanded", path, true);
      await loadDir(path);
    } else openRealFile(path);
    showToast(`${dir ? "Pasta criada" : "Arquivo criado"}: ${name}`);
  } catch (e) {
    showToast(`Não criou: ${errText(e)}`);
  }
}

export async function renameEntry(path: string, isDir: boolean) {
  const name = await askName(isDir ? "Renomear pasta" : "Renomear arquivo", "Renomear", nameOf(path));
  if (!name || name === nameOf(path)) return;
  if (!isDir && isUnsaved(path)) await saveNow(path);
  try {
    markOwn(projectId(), path, parentOf(path) ? `${parentOf(path)}/${name}` : name);
    const to = await api.renameEntry(projectId(), path, name);
    // abas, rascunhos e pastas abertas acompanham o nome novo
    const swap = (p: string) => (p === path ? to : p.startsWith(`${path}/`) ? to + p.slice(path.length) : p);
    for (const t of ws.openTabs) if (swap(t) !== t) moveDraft(t, swap(t));
    setWs("openTabs", (l) => l.map(swap));
    if (swap(ws.activeFile) !== ws.activeFile) {
      const next = swap(ws.activeFile);
      setWs("contents", next, ws.contents[ws.activeFile]);
      setWs("activeFile", next);
    }
    if (ws.expanded[path]) setWs("expanded", to, true);
    await loadDir(parentOf(path));
    if (isDir && ws.expanded[to]) await loadDir(to);
    showToast(`Renomeado para ${name}`);
  } catch (e) {
    showToast(`Não renomeou: ${errText(e)}`);
  }
}

export async function trashEntry(path: string, isDir: boolean) {
  const ok = await confirmAction(
    `Mover ${nameOf(path)} para a Lixeira?`,
    isDir ? "A pasta e tudo o que tem dentro vão para a Lixeira. Dá para recuperar de lá enquanto ela não for esvaziada." : "Dá para recuperar da Lixeira enquanto ela não for esvaziada.",
    "Mover para a Lixeira",
    true,
  );
  if (!ok) return;
  try {
    markOwn(projectId(), path);
    await api.trashEntry(projectId(), path);
    for (const t of [...ws.openTabs]) {
      if (t === path || t.startsWith(`${path}/`)) {
        dropDraft(t);
        closeTab(t);
      }
    }
    await loadDir(parentOf(path));
    showToast(`${nameOf(path)} foi para a Lixeira`);
  } catch (e) {
    showToast(errText(e));
  }
}

/** Abre um arquivo do projeto atual no editor, com a árvore aberta até ele. */
export async function revealAndOpen(path: string) {
  await expandTo(parentOf(path));
  openRealFile(path);
  requestAnimationFrame(() => document.querySelector(`[data-target="${CSS.escape(`file:${path}`)}"]`)?.scrollIntoView({ block: "nearest" }));
}

export const openWithSystem = (path: string) => api.openEntry(projectId(), path).catch((e) => showToast(errText(e)));

export function revealEntry(path: string) {
  const root = absPathOf(projectId());
  if (!root) return;
  const sep = root.includes("\\") ? "\\" : "/";
  api.reveal(path ? `${root}${sep}${path.split("/").join(sep)}` : root).catch((e) => showToast(errText(e)));
}

export async function copyPath(path: string) {
  const root = absPathOf(projectId()) ?? "";
  try {
    await navigator.clipboard.writeText(path ? `${root}/${path}` : root);
    showToast("Caminho copiado");
  } catch {
    showToast("Não deu para copiar");
  }
}

// ---------------------------------------------------------------- menu de contexto

export interface MenuItem {
  label: string;
  icon?: () => JSX.Element;
  danger?: boolean;
  run: () => void;
}
export const [contextMenu, setContextMenu] = createSignal<{ x: number; y: number; items: (MenuItem | "sep")[] } | null>(null);
