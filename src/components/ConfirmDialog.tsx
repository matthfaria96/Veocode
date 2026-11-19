import { onCleanup, onMount, type JSX } from "solid-js";
import { tx } from "../i18n";

/** Janela de confirmação para ações com consequência (mover para a Lixeira, encerrar processo…). */
export default function ConfirmDialog(props: {
  title: string;
  confirmLabel: string;
  danger?: boolean;
  disabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children: JSX.Element;
}) {
  const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onCancel();
  let cancel!: HTMLButtonElement;
  onMount(() => {
    window.addEventListener("keydown", onKey);
    // foco no "Cancelar": Enter por engano não apaga nada
    cancel.focus();
  });
  onCleanup(() => window.removeEventListener("keydown", onKey));
  return (
    <div class="palette-backdrop" onClick={props.onCancel}>
      <div class="dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3>{props.title}</h3>
        <div class="dialog-body">{props.children}</div>
        <div class="dialog-actions">
          <button class="ghost-btn" ref={cancel} onClick={props.onCancel}>{tx("Cancelar")}</button>
          <button class={props.danger ? "danger-btn" : "primary-btn"} disabled={props.disabled} onClick={props.onConfirm}>
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
