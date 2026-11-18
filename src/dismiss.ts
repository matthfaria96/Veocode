import { onCleanup } from "solid-js";

/**
 * Menu suspenso que fecha sozinho: clique fora dele (e fora do botão que abriu) ou Esc.
 * Uso: `<div class="menu" ref={(el) => dismissable(el, () => setOpen(false))}>`.
 * `keep` = o que não conta como "fora" (por padrão, o elemento pai do menu, onde fica o botão).
 */
export function dismissable(el: HTMLElement, close: () => void, keep?: () => HTMLElement | null | undefined) {
  const down = (e: MouseEvent) => {
    const t = e.target as Node;
    const k = keep ? keep() : el.parentElement;
    if (el.contains(t) || k?.contains(t)) return;
    close();
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };
  // um quadro depois: o clique que abriu o menu não pode fechá-lo
  const t = setTimeout(() => {
    window.addEventListener("mousedown", down, true);
    window.addEventListener("keydown", key, true);
  });
  onCleanup(() => {
    clearTimeout(t);
    window.removeEventListener("mousedown", down, true);
    window.removeEventListener("keydown", key, true);
  });
}
