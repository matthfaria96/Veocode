import { ChevronRight, Copy, ExternalLink, FilePlus, FolderOpen, FolderPlus, MoreHorizontal, Pencil, Trash2 } from "lucide-solid";
import { copyPath, newEntry, openWithSystem, renameEntry, revealEntry, setContextMenu, trashEntry, type MenuItem } from "../fileActions";
import { isUnsaved } from "../editing";
import { FileIcon, FolderIcon } from "./icons";
import { For, Show } from "solid-js";
import type { FileEntry } from "../api";
import { ws, type FileMark } from "../store";
import { openRealFile, toggleDir } from "../realProject";

const markLabel: Record<FileMark, string> = { read: "L", search: "B", edit: "M", new: "N", deleted: "A" };
const markTitle: Record<FileMark, string> = {
  read: "Lido",
  search: "Encontrado na busca",
  edit: "Alterado no disco",
  new: "Criado agora",
  deleted: "Apagado",
};

/** O que dá para fazer com um item da árvore ("" = a pasta do projeto). */
function itemsFor(path: string, isDir: boolean): (MenuItem | "sep")[] {
  const here = isDir ? path : path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const out: (MenuItem | "sep")[] = [];
  if (!isDir) out.push({ label: "Abrir com o programa padrão", icon: () => <ExternalLink size={14} />, run: () => void openWithSystem(path) });
  out.push(
    { label: "Novo arquivo aqui", icon: () => <FilePlus size={14} />, run: () => void newEntry(here, false) },
    { label: "Nova pasta aqui", icon: () => <FolderPlus size={14} />, run: () => void newEntry(here, true) },
    "sep",
    { label: navigator.userAgent.includes("Mac") ? "Mostrar no Finder" : "Mostrar no Explorer", icon: () => <FolderOpen size={14} />, run: () => revealEntry(path) },
    { label: "Copiar caminho", icon: () => <Copy size={14} />, run: () => void copyPath(path) },
  );
  if (path) {
    out.push(
      "sep",
      { label: "Renomear…", icon: () => <Pencil size={14} />, run: () => void renameEntry(path, isDir) },
      { label: "Mover para a Lixeira…", icon: () => <Trash2 size={14} />, danger: true, run: () => void trashEntry(path, isDir) },
    );
  }
  return out;
}

const openMenu = (e: MouseEvent, path: string, isDir: boolean) => {
  e.preventDefault();
  e.stopPropagation();
  setContextMenu({ x: e.clientX, y: e.clientY, items: itemsFor(path, isDir) });
};

function Entry(props: { e: FileEntry; depth: number }) {
  const open = () => !!ws.expanded[props.e.path];
  const mark = () => ws.marks[props.e.path];
  return (
    <>
      <div
        role="button"
        tabIndex={0}
        class="tree-row"
        classList={{ active: ws.activeFile === props.e.path, ignored: props.e.ignored, [`mark-${mark()}`]: !!mark(), dir: props.e.isDir }}
        style={{ "padding-left": `${10 + props.depth * 14}px` }}
        title={props.e.ignored ? `${props.e.path} (no .gitignore)` : props.e.path}
        data-target={`file:${props.e.path}`}
        onClick={() => (props.e.isDir ? toggleDir(props.e.path) : openRealFile(props.e.path))}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            props.e.isDir ? toggleDir(props.e.path) : openRealFile(props.e.path);
          } else if (e.key === "F2") void renameEntry(props.e.path, props.e.isDir);
        }}
        onContextMenu={(e) => openMenu(e, props.e.path, props.e.isDir)}
      >
        <span class="tree-chevron" classList={{ open: open(), hidden: !props.e.isDir }}>
          <ChevronRight size={12} />
        </span>
        <span class="tree-icon">{props.e.isDir ? <FolderIcon name={props.e.name} open={open()} /> : <FileIcon name={props.e.name} />}</span>
        <span class="tree-name">{props.e.name}</span>
        <Show when={!props.e.isDir && isUnsaved(props.e.path)}><span class="tree-unsaved" title="Salvando…" /></Show>
        <Show when={mark()}>{(m) => <span class="tree-mark" title={markTitle[m()]}>{markLabel[m()]}</span>}</Show>
        <button class="tree-more" title="Mais ações (renomear, apagar…)" onClick={(e) => openMenu(e, props.e.path, props.e.isDir)}>
          <MoreHorizontal size={13} />
        </button>
      </div>
      <Show when={props.e.isDir && open()}>
        <Show when={ws.tree[props.e.path]} fallback={<div class="tree-loading" style={{ "padding-left": `${34 + props.depth * 14}px` }}>carregando…</div>}>
          <Level dir={props.e.path} depth={props.depth + 1} />
        </Show>
      </Show>
    </>
  );
}

function Level(props: { dir: string; depth: number }) {
  const listing = () => ws.tree[props.dir];
  return (
    <div class="tree-level">
      <For each={listing()?.entries} fallback={<div class="tree-loading" style={{ "padding-left": `${34 + props.depth * 14}px` }}>pasta vazia</div>}>
        {(e) => <Entry e={e} depth={props.depth} />}
      </For>
      <Show when={(listing()?.truncated ?? 0) > 0}>
        <div class="tree-loading" style={{ "padding-left": `${34 + props.depth * 14}px` }}>+{listing()!.truncated} itens não mostrados</div>
      </Show>
    </div>
  );
}

export default function RealFileTree() {
  return (
    <div class="tree" onContextMenu={(e) => openMenu(e, "", true)}>
      <Show when={ws.tree[""]} fallback={<div class="tree-loading">carregando…</div>}>
        <Level dir="" depth={0} />
      </Show>
    </div>
  );
}
