// Projetos reais: árvore carregada pasta por pasta, leitura de arquivos e reação
// às mudanças no disco (vindas do observador em Rust).

import { reconcile } from "solid-js/store";
import { api, type FsChange } from "./api";
import { openFile, projectId, pushEvent, resetWorkspace, setWs, showToast, ws } from "./store";
import { touchedByAgent } from "./agentFeed";
import { dropDraft, isUnsaved, savedByMe, saveNow } from "./editing";

const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const nameOf = (path: string) => path.split("/").pop() ?? path;

/** Linhas do texto novo que não existiam no antigo (comparação por contagem — barata e boa o suficiente). */
export function changedLineNumbers(oldText: string, newText: string): number[] {
  const counts = new Map<string, number>();
  for (const l of oldText.split("\n")) counts.set(l, (counts.get(l) ?? 0) + 1);
  const out: number[] = [];
  newText.split("\n").forEach((l, i) => {
    const c = counts.get(l) ?? 0;
    if (c > 0) counts.set(l, c - 1);
    else out.push(i + 1);
  });
  return out;
}

export async function openRealProject() {
  resetWorkspace(false);
  setWs("expanded", "", true);
  await loadDir("");
}

export async function loadDir(dir: string) {
  const pid = projectId();
  try {
    const listing = await api.listDir(pid, dir);
    if (pid !== projectId()) return; // trocou de projeto no meio do caminho
    setWs("tree", dir, reconcile(listing, { key: "path" })); // mantém os itens já desenhados
  } catch (e) {
    if (pid !== projectId()) return;
    // pasta que sumiu (ou ainda não existe): fecha em vez de ficar "carregando…"
    if (dir) setWs("expanded", dir, false);
    showToast(`Não abriu ${dir || "a pasta"}: ${e}`);
  }
}

export function toggleDir(dir: string) {
  const open = !ws.expanded[dir];
  setWs("expanded", dir, open);
  if (open && !ws.tree[dir]) loadDir(dir);
}

export async function loadContent(path: string, opts: { diff?: boolean } = {}) {
  const pid = projectId();
  const before = ws.contents[path];
  if (!before) setWs("contents", path, { kind: "loading" });
  try {
    const content = await api.readFile(pid, path);
    if (pid !== projectId()) return;
    if (opts.diff && before?.kind === "text" && content.kind === "text") {
      setWs("changedLines", path, changedLineNumbers(before.text, content.text));
    }
    setWs("contents", path, content);
  } catch (e) {
    if (pid === projectId()) setWs("contents", path, { kind: "error", message: String(e) });
  }
}

export function openRealFile(path: string) {
  openFile(path);
  if (!ws.contents[path] || ws.contents[path].kind === "error") loadContent(path);
}

/** Algo mudou no disco: atualiza a árvore, marca os arquivos e registra na atividade. */
export function handleFsChange(e: FsChange) {
  if (e.projectId !== projectId()) return;
  const dirsToReload = new Set<string>();

  for (const c of e.changes) {
    const parent = parentOf(c.path);
    const listing = ws.tree[parent];
    const known = listing?.entries.some((x) => x.path === c.path) ?? false;

    if (listing) dirsToReload.add(parent);
    if (c.isDir && ws.tree[c.path]) dirsToReload.add(c.path);

    // feito pela própria pessoa no Veocode (salvar, criar, renomear, apagar): a tela já mostra
    if (savedByMe(e.projectId, c.path)) {
      if (c.exists && !c.isDir && ws.marks[c.path] !== "new") setWs("marks", c.path, "edit");
      continue;
    }

    if (!c.exists) {
      if (!known && !ws.marks[c.path]) continue; // arquivo temporário que nasceu e morreu
      setWs("marks", c.path, "deleted");
      pushEvent({ kind: "delete", title: `Apagado: ${c.path}`, agent: "disco", status: "ok" });
      if (ws.openTabs.includes(c.path)) setWs("contents", c.path, { kind: "error", message: "Este arquivo foi apagado do disco." });
      continue;
    }

    if (c.isDir) {
      if (listing && !known) {
        setWs("marks", c.path, "new");
        if (!touchedByAgent(c.path)) pushEvent({ kind: "create", title: `Pasta nova: ${c.path}`, agent: "disco", status: "ok" });
      }
      continue;
    }

    // Só dá para afirmar "novo" se a pasta-mãe já estava carregada e não tinha esse arquivo.
    const prev = ws.marks[c.path];
    const isNew = !!listing && !known && prev !== "edit" && prev !== "new";
    setWs("marks", c.path, isNew || prev === "new" ? "new" : "edit");
    // o agente acabou de mexer aqui: a linha dele na Atividade já conta a história
    if (!touchedByAgent(c.path)) pushEvent({ kind: isNew ? "create" : "edit", title: `${isNew ? "Criado" : "Alterado"}: ${c.path}`, detail: nameOf(c.path), agent: "disco", status: "ok", path: c.path });
    if (ws.openTabs.includes(c.path)) {
      if (isUnsaved(c.path)) {
        showToast(`${nameOf(c.path)} mudou no disco enquanto você escrevia. Fica valendo o seu texto (salvando agora).`);
        void saveNow(c.path);
      } else {
        dropDraft(c.path);
        loadContent(c.path, { diff: true });
      }
    }
  }

  dirsToReload.forEach((d) => loadDir(d));
}
