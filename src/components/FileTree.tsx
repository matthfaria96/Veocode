import { ChevronRight } from "lucide-solid";
import { FileIcon, FolderIcon } from "./icons";
import { createSignal, For, Show } from "solid-js";
import { fileTree, type FileNode } from "../data/mock";
import { openFile, ws, type FileMark } from "../store";
import { tx } from "../i18n";

const markLabel: Record<FileMark, string> = { read: "L", search: "B", edit: "M", new: "N", deleted: "A" };
const markTitle: Record<FileMark, string> = { get read() { return tx("Lido pelo agente"); }, get search() { return tx("Encontrado na busca"); }, get edit() { return tx("Modificado"); }, get new() { return tx("Criado agora"); }, get deleted() { return tx("Apagado"); } };

// Pastas abertas (todas começam abertas para o agente sempre ter onde "clicar").
const [closed, setClosed] = createSignal<Set<string>>(new Set());
const toggle = (p: string) =>
  setClosed((s) => {
    const n = new Set(s);
    n.has(p) ? n.delete(p) : n.add(p);
    return n;
  });

function withExtras(nodes: FileNode[]): FileNode[] {
  return nodes.map((n) => {
    if (!n.dir) return n;
    const extra = ws.extraFiles
      .filter((p) => p.substring(0, p.lastIndexOf("/")) === n.path)
      .map((p): FileNode => ({ name: p.split("/").pop()!, path: p }));
    return { ...n, children: [...withExtras(n.children ?? []), ...extra].sort((a, b) => Number(!!b.dir) - Number(!!a.dir) || a.name.localeCompare(b.name)) };
  });
}

function Node(props: { node: FileNode; depth: number }) {
  const isOpen = () => !closed().has(props.node.path);
  const mark = () => ws.marks[props.node.path];
  const icon = () =>
    props.node.dir ? <FolderIcon name={props.node.name} open={isOpen()} /> : <FileIcon name={props.node.name} />;

  return (
    <>
      <button
        class="tree-row"
        classList={{ active: ws.activeFile === props.node.path, [`mark-${mark()}`]: !!mark(), dir: props.node.dir }}
        style={{ "padding-left": `${10 + props.depth * 14}px` }}
        data-target={props.node.dir ? undefined : `file:${props.node.path}`}
        onClick={() => (props.node.dir ? toggle(props.node.path) : openFile(props.node.path))}
      >
        <span class="tree-chevron" classList={{ open: isOpen(), hidden: !props.node.dir }}>
          <ChevronRight size={12} />
        </span>
        <span class="tree-icon">{icon()}</span>
        <span class="tree-name">{props.node.name}</span>
        <Show when={mark()}>
          {(m) => (
            <span class="tree-mark" title={markTitle[m()]}>
              {markLabel[m()]}
            </span>
          )}
        </Show>
      </button>
      <Show when={props.node.dir}>
        <div class="tree-children" classList={{ collapsed: !isOpen() }}>
          <div>
            <For each={props.node.children}>{(c) => <Node node={c} depth={props.depth + 1} />}</For>
          </div>
        </div>
      </Show>
    </>
  );
}

export default function FileTree() {
  return (
    <div class="tree">
      <For each={withExtras(fileTree)}>{(n) => <Node node={n} depth={0} />}</For>
    </div>
  );
}
