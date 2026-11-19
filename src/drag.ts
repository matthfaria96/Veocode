// Arrastar na Visão geral: um painel para outro lugar (troca os dois) ou um projeto da lista
// para cima de um painel (entra no lugar dele). Feito com o ponteiro, não com o arrastar do
// navegador, para funcionar igual no app e ter a "fantasia" seguindo o mouse.

import { createSignal } from "solid-js";

export type DragKind = "pane" | "project";
export interface Drag {
  id: string;
  kind: DragKind;
  label: string;
  x: number;
  y: number;
}

export const [drag, setDrag] = createSignal<Drag | null>(null);
/** pid do painel embaixo do ponteiro */
export const [dropOver, setDropOver] = createSignal<string | null>(null);

/** Começa a arrastar depois de mexer alguns pixels (um clique simples continua sendo clique). */
export function startDrag(e: PointerEvent, id: string, kind: DragKind, label: string, onDrop: (target: string) => void) {
  if (e.button !== 0) return;
  // sem isso o navegador começa a selecionar texto ou a arrastar a imagem do ícone
  e.preventDefault();
  const x0 = e.clientX;
  const y0 = e.clientY;
  let started = false;
  const move = (ev: PointerEvent) => {
    if (!started && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
    if (!started) {
      started = true;
      document.body.classList.add("dragging-pane");
    }
    setDrag({ id, kind, label, x: ev.clientX, y: ev.clientY });
    const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-drop-pane]");
    const t = el?.dataset.dropPane ?? null;
    setDropOver(t && !(kind === "pane" && t === id) ? t : null);
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    window.removeEventListener("keydown", esc);
    document.body.classList.remove("dragging-pane");
    const t = dropOver();
    setDrag(null);
    setDropOver(null);
    if (started && t) onDrop(t);
    if (started) {
      // o clique que vem depois de soltar não deve abrir nada
      const stop = (ev: MouseEvent) => (ev.stopPropagation(), ev.preventDefault());
      window.addEventListener("click", stop, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", stop, { capture: true }), 50);
    }
  };
  const esc = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape") return;
    setDropOver(null);
    up();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
  window.addEventListener("keydown", esc);
}
