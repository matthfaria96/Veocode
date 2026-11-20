// Janela por cima de tudo com o fundo borrado. O mesmo desenho para nível de acesso, memória e
// contexto: ícone e título em cima (com um resumo curto à direita), o conteúdo no meio e, embaixo,
// uma nota à esquerda e os botões à direita. Fecha no X, no Esc ou clicando fora.
import { X } from "lucide-solid";
import { onCleanup, onMount, Show, type Component, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { tx } from "../i18n";

export default function Modal(props: {
  icon: Component<{ size?: number }>;
  /** cor do ícone (e do realce do topo) */
  tone?: string;
  title: string;
  sub?: JSX.Element;
  /** à direita do título: um número, um selo, um botão pequeno */
  aside?: JSX.Element;
  /** rodapé: nota à esquerda */
  note?: JSX.Element;
  /** rodapé: botões à direita */
  actions?: JSX.Element;
  onClose: () => void;
  children: JSX.Element;
}) {
  let card!: HTMLDivElement;
  let downOnBackdrop = false;
  const before = document.activeElement as HTMLElement | null;

  onMount(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // uma confirmação aberta por cima desta fecha primeiro
      if (document.querySelector(".palette-backdrop")) return;
      e.preventDefault();
      props.onClose();
    };
    window.addEventListener("keydown", key);
    requestAnimationFrame(() => card?.focus({ preventScroll: true }));
    onCleanup(() => {
      window.removeEventListener("keydown", key);
      before?.focus?.({ preventScroll: true });
    });
  });

  return (
    <div
      class="modal-backdrop"
      onMouseDown={(e) => (downOnBackdrop = e.target === e.currentTarget)}
      onMouseUp={(e) => downOnBackdrop && e.target === e.currentTarget && props.onClose()}
    >
      <div class="modal" ref={card} tabindex="-1" role="dialog" aria-modal="true" aria-label={props.title} style={{ "--tone": props.tone ?? "var(--accent)" }}>
        <header class="modal-head">
          <span class="modal-icon"><Dynamic component={props.icon} size={17} /></span>
          <div class="modal-titles">
            <h2>{props.title}</h2>
            <Show when={props.sub}><p>{props.sub}</p></Show>
          </div>
          <Show when={props.aside}><div class="modal-aside">{props.aside}</div></Show>
          <button class="icon-btn modal-x" title={tx("Fechar (Esc)")} onClick={props.onClose}><X size={15} /></button>
        </header>
        <div class="modal-body">{props.children}</div>
        <Show when={props.note || props.actions}>
          <footer class="modal-foot">
            <div class="modal-note">{props.note}</div>
            <div class="modal-actions">{props.actions}</div>
          </footer>
        </Show>
      </div>
    </div>
  );
}

/** Título de uma parte da janela (igual nas três). */
export function ModalSection(props: { title: string; info?: JSX.Element }) {
  return (
    <div class="modal-sec">
      <span>{props.title}</span>
      <Show when={props.info}><small>{props.info}</small></Show>
    </div>
  );
}
