import { createEffect, For, onCleanup, Show } from "solid-js";
import { contextMenu, setContextMenu } from "../fileActions";

/** Menu que abre no clique direito ou no botão "⋯". Fecha com Esc, clique fora ou rolagem. */
export default function ContextMenu() {
  let el: HTMLDivElement | undefined;
  createEffect(() => {
    if (!contextMenu()) return;
    const close = () => setContextMenu(null);
    const down = (e: MouseEvent) => !el?.contains(e.target as Node) && close();
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", down, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("resize", close);
    window.addEventListener("wheel", close, { passive: true });
    onCleanup(() => {
      window.removeEventListener("mousedown", down, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("wheel", close);
    });
  });
  // não deixa sair da janela
  const pos = () => {
    const m = contextMenu()!;
    const h = m.items.length * 30 + 12;
    return { left: `${Math.min(m.x, window.innerWidth - 230)}px`, top: `${Math.min(m.y, window.innerHeight - h - 8)}px` };
  };
  return (
    <Show when={contextMenu()}>
      {(m) => (
        <div ref={el} class="menu pop-in ctx-menu" style={pos()} role="menu">
          <For each={m().items}>
            {(it) =>
              it === "sep" ? (
                <div class="menu-sep" />
              ) : (
                <button
                  class="menu-item"
                  classList={{ danger: !!it.danger }}
                  role="menuitem"
                  onClick={() => {
                    setContextMenu(null);
                    it.run();
                  }}
                >
                  {it.icon?.()}
                  <span>{it.label}</span>
                </button>
              )
            }
          </For>
        </div>
      )}
    </Show>
  );
}
