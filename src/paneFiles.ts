// Os arquivos de um projeto no modo Código de uma coluna da tela Início: a árvore, as abas abertas
// e o conteúdo, guardados por projeto. A tela do projeto tem o `ws` dela (um projeto por vez); aqui
// cada coluna tem o seu, e várias podem estar no modo Código ao mesmo tempo. Os rascunhos (o que a
// pessoa escreveu) ficam em editing.ts, por projeto e arquivo: o mesmo arquivo aberto aqui e na
// tela do projeto mostra o mesmo texto.

import { createStore, reconcile } from "solid-js/store";
import { api, type DirListing, type FsChange } from "./api";
import { DIFF, showToast, type FileView } from "./store";
import { dropDraft, isUnsaved, savedByMe, saveNow } from "./editing";
import { tx } from "./i18n";

interface PaneFiles {
  /** Pastas já lidas ("" = a raiz). */
  tree: Record<string, DirListing>;
  expanded: Record<string, boolean>;
  contents: Record<string, FileView>;
  /** Abas abertas: caminhos de arquivo, ou DIFF + caminho para o que mudou nele. */
  tabs: string[];
  active: string;
  /** O painel da esquerda: aberto (o padrão) e com Arquivos ou Mudanças na frente. */
  side: "files" | "changes";
  sideOpen: boolean;
  /** O terminal embaixo do editor. */
  term: boolean;
}

const blank = (): PaneFiles => ({ tree: {}, expanded: { "": true }, contents: {}, tabs: [], active: "", side: "files", sideOpen: true, term: false });
const EMPTY = blank();
const [files, setFiles] = createStore<Record<string, PaneFiles>>({});

export const filesOf = (pid: string): PaneFiles => files[pid] ?? EMPTY;
const ensure = (pid: string) => !files[pid] && setFiles(pid, blank());
const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

export function setPaneSide(pid: string, side: PaneFiles["side"] | null) {
  ensure(pid);
  if (side) setFiles(pid, { side, sideOpen: true });
  else setFiles(pid, "sideOpen", false);
}
export const togglePaneSide = (pid: string) => (ensure(pid), setFiles(pid, "sideOpen", (o) => !o));
export const togglePaneTerm = (pid: string) => (ensure(pid), setFiles(pid, "term", (o) => !o));

export async function loadPaneDir(pid: string, dir: string) {
  ensure(pid);
  try {
    const listing = await api.listDir(pid, dir);
    setFiles(pid, "tree", dir, reconcile(listing, { key: "path" }));
  } catch (e) {
    if (dir) setFiles(pid, "expanded", dir, false);
    else setFiles(pid, "tree", "", { entries: [], truncated: 0 });
    showToast(tx("Não abriu {v}: {e}", { v: dir || tx("a pasta"), e }));
  }
}

export function togglePaneDir(pid: string, dir: string) {
  ensure(pid);
  const open = !files[pid].expanded[dir];
  setFiles(pid, "expanded", dir, open);
  if (open && !files[pid].tree[dir]) void loadPaneDir(pid, dir);
}

async function loadContent(pid: string, path: string) {
  if (!files[pid].contents[path]) setFiles(pid, "contents", path, { kind: "loading" });
  try {
    setFiles(pid, "contents", path, await api.readFile(pid, path));
  } catch (e) {
    setFiles(pid, "contents", path, { kind: "error", message: String(e) });
  }
}

/** Abre (ou traz para a frente) a aba de um arquivo, ou a do que mudou nele (DIFF + caminho). */
export function openPaneTab(pid: string, tab: string) {
  ensure(pid);
  const f = files[pid];
  if (!f.tabs.includes(tab)) {
    // a do "o que mudou" é de passagem, como a prévia do VS Code: clicar em vários arquivos
    // seguidos troca a aba em vez de encher a fileira
    const old = tab.startsWith(DIFF) ? f.tabs.find((t) => t.startsWith(DIFF)) : undefined;
    setFiles(pid, "tabs", (l) => (old ? l.map((t) => (t === old ? tab : t)) : [...l, tab]));
  }
  setFiles(pid, "active", tab);
  if (!tab.startsWith(DIFF)) {
    const v = files[pid].contents[tab];
    if (!v || v.kind === "error") void loadContent(pid, tab);
  }
}

export function closePaneTab(pid: string, tab: string) {
  const f = files[pid];
  if (!f) return;
  const i = f.tabs.indexOf(tab);
  const rest = f.tabs.filter((t) => t !== tab);
  setFiles(pid, "tabs", rest);
  if (f.active === tab) setFiles(pid, "active", rest[Math.min(i, rest.length - 1)] ?? "");
  if (!tab.startsWith(DIFF)) setFiles(pid, "contents", tab, undefined!);
}

/** Algo mudou no disco (observador em Rust, todos os projetos): árvore e abas abertas em dia. */
export function paneFsChange(e: FsChange) {
  const f = files[e.projectId];
  if (!f) return;
  const pid = e.projectId;
  const reload = new Set<string>();
  for (const c of e.changes) {
    const parent = parentOf(c.path);
    if (f.tree[parent]) reload.add(parent);
    if (c.isDir && f.tree[c.path]) reload.add(c.path);
    if (c.isDir || !f.tabs.includes(c.path) || savedByMe(pid, c.path)) continue;
    if (!c.exists) {
      setFiles(pid, "contents", c.path, { kind: "error", message: tx("Este arquivo foi apagado do disco.") });
    } else if (isUnsaved(c.path, pid)) {
      // escreveu aqui enquanto outro programa (ou a IA) mudou o arquivo: fica o texto da pessoa
      void saveNow(c.path, pid);
    } else {
      dropDraft(c.path, pid);
      void loadContent(pid, c.path);
    }
  }
  reload.forEach((d) => void loadPaneDir(pid, d));
}
