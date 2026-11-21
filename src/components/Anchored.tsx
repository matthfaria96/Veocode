// Menu que abre colado no botão que o abriu, como o do uso do plano: em cima dele (ou embaixo,
// se não houver espaço), alinhado à borda do botão e sempre dentro da janela. Fica por cima de
// tudo, então colunas estreitas (tela Início) não cortam o menu.
import { createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { dismissable } from "../dismiss";

export function AnchoredMenu(props: {
  anchor: HTMLElement | undefined;
  onClose: () => void;
  class?: string;
  /** largura preferida (encolhe em janelas estreitas) */
  width?: number;
  /** "start": a borda esquerda do menu na do botão; "end": a direita na direita */
  align?: "start" | "end";
  label?: string;
  children: JSX.Element;
}) {
  const [pos, setPos] = createSignal<{ left: number; top?: number; bottom?: number; width: number; max: number; up: boolean } | null>(null);
  const GAP = 8;
  const place = () => {
    const a = props.anchor;
    if (!a || !a.isConnected) return props.onClose();
    const r = a.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(props.width ?? 380, vw - 16);
    const want = props.align === "end" ? r.right - width : r.left;
    const left = Math.max(8, Math.min(want, vw - width - 8));
    const above = r.top - GAP - 8;
    const below = vh - r.bottom - GAP - 8;
    // a caixa de mensagem fica embaixo: o normal é abrir para cima
    const up = above >= 260 || above >= below;
    setPos(up ? { left, bottom: vh - r.top + GAP, width, max: Math.min(above, 560), up } : { left, top: r.bottom + GAP, width, max: Math.min(below, 560), up });
  };
  onMount(() => {
    place();
    const again = () => requestAnimationFrame(place);
    window.addEventListener("resize", again);
    // a conversa rolando não mexe no botão; a página toda (ou a coluna) sim
    document.addEventListener("scroll", again, true);
    onCleanup(() => (window.removeEventListener("resize", again), document.removeEventListener("scroll", again, true)));
  });
  return (
    <Portal>
      <div
        class={`menu anchored ${props.class ?? ""}`}
        classList={{ up: !!pos()?.up, down: !!pos() && !pos()!.up }}
        role="menu"
        aria-label={props.label}
        ref={(el) => dismissable(el, props.onClose, () => props.anchor)}
        style={{
          left: `${pos()?.left ?? -9999}px`,
          top: pos()?.top != null ? `${pos()!.top}px` : "auto",
          bottom: pos()?.bottom != null ? `${pos()!.bottom}px` : "auto",
          width: `${pos()?.width ?? props.width ?? 380}px`,
          "max-height": `${pos()?.max ?? 520}px`,
          visibility: pos() ? "visible" : "hidden",
        }}
      >
        {props.children}
      </div>
    </Portal>
  );
}
