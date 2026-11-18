import { createEffect, For, onCleanup, Show } from "solid-js";
import { asking, setAsking } from "../dialogs";

/** A janela das perguntas de dialogs.ts. Esc ou clique fora = cancelar; Enter = a opção principal. */
export default function Dialogs() {
  let input: HTMLInputElement | undefined;
  let first: HTMLButtonElement | undefined;
  const close = (id: string | null) => {
    const a = asking();
    if (!a) return;
    setAsking(null);
    a.resolve(id === null || id === "cancel" ? null : { id, text: input?.value ?? "" });
  };
  const main = () => asking()?.options.find((o) => o.tone === "primary" || o.tone === "danger")?.id ?? null;

  createEffect(() => {
    const a = asking();
    if (!a) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(null);
      }
    };
    window.addEventListener("keydown", key, true);
    onCleanup(() => window.removeEventListener("keydown", key, true));
    queueMicrotask(() => {
      if (a.input && input) {
        input.focus();
        const [s, e] = a.input.select ?? [0, a.input.value.length];
        input.setSelectionRange(s, e);
      } else first?.focus();
    });
  });

  return (
    <Show when={asking()}>
      {(a) => (
        <div class="palette-backdrop" onClick={() => close(null)}>
          <form
            class="dialog"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              const m = main();
              if (m) close(m);
            }}
          >
            <h3>{a().title}</h3>
            <Show when={a().body}><div class="dialog-body"><p>{a().body}</p></div></Show>
            <Show when={a().input}>
              {(i) => <input ref={input} class="dialog-input" value={i().value} placeholder={i().placeholder} spellcheck={false} autocomplete="off" />}
            </Show>
            <div class="dialog-actions">
              <For each={a().options}>
                {(o, idx) => (
                  <button
                    ref={(el) => idx() === 0 && (first = el)}
                    type={o.id === main() ? "submit" : "button"}
                    class={o.tone === "danger" ? "danger-btn" : o.tone === "primary" ? "primary-btn" : "ghost-btn"}
                    onClick={() => o.id !== main() && close(o.id)}
                  >
                    {o.label}
                  </button>
                )}
              </For>
            </div>
          </form>
        </div>
      )}
    </Show>
  );
}
