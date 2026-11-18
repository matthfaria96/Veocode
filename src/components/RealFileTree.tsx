import { ChevronRight } from "lucide-solid";
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

function Entry(props: { e: FileEntry; depth: number }) {
  const open = () => !!ws.expanded[props.e.path];
  const mark = () => ws.marks[props.e.path];
  return (
    <>
      <button
        class="tree-row"
        classList={{ active: ws.activeFile === props.e.path, ignored: props.e.ignored, [`mark-${mark()}`]: !!mark(), dir: props.e.isDir }}
        style={{ "padding-left": `${10 + props.depth * 14}px` }}
        title={props.e.ignored ? `${props.e.path} (no .gitignore)` : props.e.path}
        data-target={`file:${props.e.path}`}
        onClick={() => (props.e.isDir ? toggleDir(props.e.path) : openRealFile(props.e.path))}
      >
        <span class="tree-chevron" classList={{ open: open(), hidden: !props.e.isDir }}>
          <ChevronRight size={12} />
        </span>
        <span class="tree-icon">{props.e.isDir ? <FolderIcon name={props.e.name} open={open()} /> : <FileIcon name={props.e.name} />}</span>
        <span class="tree-name">{props.e.name}</span>
        <Show when={mark()}>{(m) => <span class="tree-mark" title={markTitle[m()]}>{markLabel[m()]}</span>}</Show>
      </button>
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
    <div class="tree">
      <Show when={ws.tree[""]} fallback={<div class="tree-loading">carregando…</div>}>
        <Level dir="" depth={0} />
      </Show>
    </div>
  );
}
