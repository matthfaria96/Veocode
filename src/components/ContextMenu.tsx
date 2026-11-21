import { Check, ChevronRight } from "lucide-solid";
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { contextMenu, setContextMenu, type MenuEntry, type MenuItem } from "../fileActions";

const isItem = (e: MenuEntry): e is MenuItem => typeof e === "object" && "label" in e;

/** Todos os itens com atalho, do menu e dos submenus (a tecla funciona sem abrir o submenu). */
const withKeys = (list: MenuEntry[]): MenuItem[] => list.filter(isItem).flatMap((x) => [...(x.key && x.run ? [x] : []), ...(x.sub ? withKeys(x.sub) : [])]);

/** Menu que abre no clique direito ou no botão "⋯". Fecha com Esc, clique fora ou rolagem.
 *  Com ele aberto, a letra de cada item (à direita) roda o item. */
export default function ContextMenu() {
  let el: HTMLDivElement | undefined;
  const [sub, setSub] = createSignal<number | null>(null);
  const run = (it: MenuItem) => {
    setContextMenu(null);
    it.run?.();
  };
  createEffect(() => {
    const m = contextMenu();
    setSub(null);
    if (!m) return;
    const close = () => setContextMenu(null);
    const down = (e: MouseEvent) => !el?.contains(e.target as Node) && close();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") return sub() !== null ? setSub(null) : close();
      if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) return;
      // escrevendo num campo (renomear): a letra é texto
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const hit = withKeys(m.items).find((x) => x.key!.toLowerCase() === e.key.toLowerCase());
      if (!hit) return;
      e.preventDefault();
      e.stopPropagation();
      run(hit);
    };
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
    const h = m.items.reduce((n, x) => n + (x === "sep" ? 11 : isItem(x) && x.hint ? 46 : 31), 12);
    return { left: `${Math.max(8, Math.min(m.x, window.innerWidth - 240))}px`, top: `${Math.max(8, Math.min(m.y, window.innerHeight - h - 8))}px` };
  };

  function List(props: { items: MenuEntry[]; nested?: boolean }) {
    return (
      <For each={props.items}>
        {(it, i) => {
          if (it === "sep") return <div class="menu-sep" />;
          if (!isItem(it)) return <small class="menu-head">{it.head}</small>;
          const open = () => !props.nested && sub() === i();
          const body = (
            <>
              {it.icon?.()}
              <span class="menu-label">
                {it.label}
                <Show when={it.hint}><small>{it.hint}</small></Show>
              </span>
              <Show when={it.value}><small class="menu-value">{it.value}</small></Show>
              <Show when={it.sub} fallback={<Show when={it.checked !== undefined} fallback={<Show when={it.key}><kbd class="menu-key">{it.key}</kbd></Show>}><Check size={14} class="menu-tick" classList={{ off: !it.checked }} /></Show>}>
                <ChevronRight size={13} class="menu-chev" />
              </Show>
            </>
          );
          return (
            <Show
              when={it.sub}
              fallback={
                <button class="menu-item" classList={{ danger: !!it.danger }} role={it.checked !== undefined ? "menuitemcheckbox" : "menuitem"} aria-checked={it.checked} disabled={it.disabled} onPointerEnter={() => !props.nested && setSub(null)} onClick={() => run(it)}>
                  {body}
                </button>
              }
            >
              <div class="menu-subwrap">
                <button class="menu-item" classList={{ sel: open() }} role="menuitem" aria-haspopup="menu" aria-expanded={open()} onPointerEnter={() => setSub(i())} onClick={() => setSub(i())}>
                  {body}
                </button>
                <Show when={open()}>
                  <div
                    class="menu ctx-sub pop-in"
                    role="menu"
                    ref={(s) =>
                      requestAnimationFrame(() => {
                        // sem espaço à direita: abre para a esquerda; embaixo: sobe
                        const r = s.getBoundingClientRect();
                        if (r.right > window.innerWidth - 8) s.classList.add("flip");
                        if (r.bottom > window.innerHeight - 8) s.style.top = `${Math.round(window.innerHeight - 8 - r.bottom - 6)}px`;
                      })
                    }
                  >
                    <List items={it.sub!} nested />
                  </div>
                </Show>
              </div>
            </Show>
          );
        }}
      </For>
    );
  }

  return (
    <Show when={contextMenu()}>
      {(m) => (
        <div
          ref={(e) => {
            el = e;
            // mais largo que o previsto: encosta na borda da janela em vez de passar dela
            requestAnimationFrame(() => {
              // tamanho de layout (a animação de entrada ainda está encolhendo o menu)
              const w = e.offsetWidth;
              const h = e.offsetHeight;
              if (e.offsetLeft + w > window.innerWidth - 8) e.style.left = `${Math.max(8, window.innerWidth - 8 - w)}px`;
              if (e.offsetTop + h > window.innerHeight - 8) e.style.top = `${Math.max(8, window.innerHeight - 8 - h)}px`;
            });
          }}
          class="menu pop-in ctx-menu"
          style={pos()}
          role="menu"
        >
          <List items={m().items} />
        </div>
      )}
    </Show>
  );
}
