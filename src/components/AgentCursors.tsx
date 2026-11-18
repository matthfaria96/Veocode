import { For } from "solid-js";
import { ws } from "../store";

/** Cursores dos agentes por cima da interface — mostra ONDE a IA está mexendo. */
export default function AgentCursors() {
  return (
    <div class="cursor-layer" aria-hidden="true">
      <For each={ws.cursors}>
        {(c) => (
          <div
            class="agent-cursor"
            classList={{ visible: c.visible, clicking: c.clicking, sub: !c.main }}
            style={{ transform: `translate(${c.x}px, ${c.y}px)`, "--c": c.color }}
          >
            <span class="cursor-ripple" />
            <svg width="18" height="20" viewBox="0 0 18 20">
              <path d="M2 1.5 L16 9.2 L9.4 10.6 L6.3 17.8 Z" fill="var(--c)" stroke="#0b0d12" stroke-width="1.4" stroke-linejoin="round" />
            </svg>
            <span class="cursor-label">{c.label}</span>
          </div>
        )}
      </For>
    </div>
  );
}
