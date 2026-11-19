// Fileira de anexos em cima da caixa de mensagem: miniatura nas imagens, chip nos outros.
import { FileCode2, FileText, File as FileIcon, X } from "lucide-solid";
import { For, Show, type JSX } from "solid-js";
import { attsOf, removeAtt, type Att } from "../attachments";
import { formatBytes } from "../data/mock";

const icon = (a: Att) => (a.kind === "pdf" ? <FileText size={14} /> : a.kind === "text" ? <FileCode2 size={14} /> : <FileIcon size={14} />);

export default function AttachBar(props: { pid: string; extra?: JSX.Element }) {
  return (
    <Show when={attsOf(props.pid).length || props.extra}>
      <div class="att-bar">
        <For each={attsOf(props.pid)}>
          {(a) => (
            <div class={`att ${a.kind}`} classList={{ thumb: !!a.thumb }} title={`${a.path.startsWith("colado:") ? a.name : a.path}\n${formatBytes(a.bytes)}`}>
              <Show when={a.thumb} fallback={<span class="att-icon">{icon(a)}</span>}>
                <img src={a.thumb!} alt={a.name} />
              </Show>
              <Show when={!a.thumb}>
                <span class="att-text">
                  <strong>{a.name}</strong>
                  <small>{a.kind === "pdf" ? "PDF" : a.kind === "text" ? "texto" : "arquivo"} · {formatBytes(a.bytes)}</small>
                </span>
              </Show>
              <button class="att-x" title="Tirar o anexo" onClick={() => removeAtt(props.pid, a.path)}><X size={11} /></button>
            </div>
          )}
        </For>
        {props.extra}
      </div>
    </Show>
  );
}
