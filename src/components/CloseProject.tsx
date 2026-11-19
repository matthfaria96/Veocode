// "Fechar projeto": tira do Veocode (a pasta fica) ou também manda a pasta para a Lixeira.
// Um só diálogo, aberto de qualquer lugar com `askCloseProject(id)`.
import { AlertTriangle, FolderMinus, Trash2, X } from "lucide-solid";
import { createSignal, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { api } from "../api";
import { chatOf } from "../chat";
import { saveAll } from "../editing";
import { forgetFeed } from "../feeds";
import { forgetGit, git } from "../git";
import { absPathOf, projects, removeProject } from "../store";
import { forgetProject } from "../terminal";
import { ProjectIcon } from "./icons";

const [closing, setClosing] = createSignal<string | null>(null);
export const askCloseProject = (id: string) => setClosing(id);

export default function CloseProjectHost() {
  return (
    <Show when={projects.find((p) => p.id === closing())}>
      {(p) => <Portal><CloseDialog id={p().id} onClose={() => setClosing(null)} /></Portal>}
    </Show>
  );
}

function CloseDialog(props: { id: string; onClose: () => void }) {
  const p = () => projects.find((x) => x.id === props.id)!;
  const [trash, setTrash] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const path = () => absPathOf(props.id) ?? p().path;
  const changed = () => git.summaries[props.id]?.changed ?? 0;
  const ahead = () => git.summaries[props.id]?.ahead ?? 0;
  const go = async () => {
    setBusy(true);
    await saveAll();
    const ok = await removeProject(props.id, trash());
    setBusy(false);
    if (!ok) return;
    forgetProject(props.id);
    forgetGit(props.id);
    forgetFeed(props.id);
    props.onClose();
  };
  return (
    <div class="palette-backdrop" onClick={props.onClose}>
      <div class="dialog close-dialog" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && props.onClose()} tabIndex={-1} ref={(el) => queueMicrotask(() => el.focus())}>
        <button class="icon-btn close-dialog-x" title="Cancelar" onClick={props.onClose}><X size={15} /></button>
        <div class="close-dialog-head">
          <ProjectIcon id={p().id} name={p().name} stack={p().stack} size={34} />
          <div>
            <h3>Fechar {p().name}</h3>
            <code title={path()}>{path()}</code>
          </div>
        </div>

        <div class="close-choices" role="radiogroup">
          <button role="radio" aria-checked={!trash()} class="close-choice" classList={{ on: !trash() }} onClick={() => setTrash(false)}>
            <span class="close-choice-icon"><FolderMinus size={18} /></span>
            <span>
              <strong>Só tirar do Veocode</strong>
              <small>Sai da lista e da tela inicial. A pasta continua no computador e dá para adicionar de novo.</small>
            </span>
          </button>
          <button role="radio" aria-checked={trash()} class="close-choice danger" classList={{ on: trash() }} onClick={() => setTrash(true)}>
            <span class="close-choice-icon"><Trash2 size={18} /></span>
            <span>
              <strong>Tirar e mandar a pasta para a Lixeira</strong>
              <small>Para quando terminou de vez. Dá para recuperar pela Lixeira enquanto ela não for esvaziada.</small>
            </span>
          </button>
        </div>

        <Show when={trash() && (changed() > 0 || ahead() > 0)}>
          <p class="close-warn">
            <AlertTriangle size={14} />
            <span>
              {changed() > 0 ? `${changed()} ${changed() === 1 ? "arquivo mudado ainda não foi guardado" : "arquivos mudados ainda não foram guardados"} no git` : ""}
              {changed() > 0 && ahead() > 0 ? " e " : ""}
              {ahead() > 0 ? `${ahead()} ${ahead() === 1 ? "commit não foi enviado" : "commits não foram enviados"} ao GitHub` : ""}. Se a pasta sumir, isso só fica na Lixeira.
            </span>
          </p>
        </Show>
        <Show when={chatOf(props.id).busy}>
          <p class="close-warn"><AlertTriangle size={14} /><span>A IA está trabalhando neste projeto agora: fechar interrompe a resposta.</span></p>
        </Show>

        <div class="dialog-actions">
          <button class="ghost-btn" onClick={() => api.reveal(path()).catch(() => {})}>Mostrar no Finder</button>
          <span style={{ flex: 1 }} />
          <button class="ghost-btn" onClick={props.onClose}>Cancelar</button>
          <button class={trash() ? "danger-btn" : "primary-btn"} disabled={busy()} onClick={() => void go()}>
            {trash() ? "Fechar e mandar para a Lixeira" : "Fechar projeto"}
          </button>
        </div>
      </div>
    </div>
  );
}
