import { Command, Search, Trash2 } from "lucide-solid";
import { createMemo, For, Show } from "solid-js";
import { setPaletteOpen, setView, showToast } from "../store";
import { agentColor, xray } from "../xray";
import AppMark from "./AppMark";

const isMac = navigator.userAgent.includes("Mac");

export default function TitleBar() {
  const label = createMemo(() => {
    if (!xray.procsLoaded) return "…";
    const n = xray.procs.length;
    const busy = xray.procs.filter((g) => g.children.length > 0).length;
    if (n === 0) return "nenhum agente";
    return busy ? `${n} ${n === 1 ? "agente" : "agentes"} · ${busy} trabalhando` : `${n} ${n === 1 ? "agente" : "agentes"}`;
  });
  return (
    <header class="titlebar" classList={{ mac: isMac }} data-tauri-drag-region>
      <div class="brand" data-tauri-drag-region>
        <AppMark size={22} />
        <span class="brand-name">Veocode</span>
      </div>

      <button class="title-search" onClick={() => setPaletteOpen(true)}>
        <Search size={14} />
        <span>Buscar projetos, arquivos, ações…</span>
        <kbd>
          <Command size={11} />K
        </kbd>
      </button>

      <div class="title-right" data-tauri-drag-region>
        <div class="live-agents" title="Agentes de IA abertos nesta máquina (pulsa = rodando comandos agora)" onClick={() => setView("system")}>
          <For each={xray.procs.slice(0, 8)}>
            {(g) => (
              <span
                class="live-dot"
                classList={{ active: g.children.length > 0 }}
                style={{ "--c": agentColor(g.agent) }}
                title={`${g.agent} · pid ${g.pid}${g.cwd ? " · " + g.cwd : ""}`}
              />
            )}
          </For>
          <Show when={xray.procsLoaded && xray.procs.length === 0}>
            <span class="live-dot" style={{ "--c": "var(--text-3)" }} />
          </Show>
          <span class="live-text">{label()}</span>
        </div>
        <button
          class="ghost-btn"
          title="Limpeza rápida de caches das IAs"
          onClick={() => {
            setView("system");
            showToast("Abrindo Raio-X → Caches");
          }}
        >
          <Trash2 size={14} />
          <span>Limpar</span>
        </button>
      </div>
    </header>
  );
}
