import { Command, HardDrive, Search } from "lucide-solid";
import { createMemo, For, Show } from "solid-js";
import { setPaletteOpen, setView } from "../store";
import { agentColor, xray } from "../xray";
import AppMark from "./AppMark";

const isMac = navigator.userAgent.includes("Mac");

export default function TitleBar() {
  const label = createMemo(() => {
    if (!xray.procsLoaded) return "…";
    const n = xray.procs.length;
    const busy = xray.procs.filter((g) => g.children.length > 0).length;
    if (n === 0) return "nenhuma IA aberta";
    return busy ? `${n} ${n === 1 ? "IA aberta" : "IAs abertas"} · ${busy} trabalhando` : `${n} ${n === 1 ? "IA aberta" : "IAs abertas"}`;
  });
  // onde estão: "6 no VS Code, 2 no app do Claude…"
  const where = createMemo(() => {
    const by = new Map<string, number>();
    for (const g of xray.procs) by.set(g.host ?? "outro", (by.get(g.host ?? "outro") ?? 0) + 1);
    const parts = [...by.entries()].sort((a, b) => b[1] - a[1]).map(([h, k]) => `${k} ${h === "outro" ? "em outro programa" : h === "Terminal" ? "no Terminal" : h === "Veocode" ? "no Veocode" : h === "app do Claude" ? "no app do Claude" : `no ${h}`}`);
    return parts.length ? `Programas de IA abertos neste computador agora (cada conversa aberta conta uma, mesmo parada): ${parts.join(", ")}. Aceso = rodando comandos agora. Clique para ver e fechar.` : "Nenhum programa de IA aberto agora.";
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
        <div class="live-agents" title={where()} onClick={() => setView("system")}>
          <For each={xray.procs.slice(0, 8)}>
            {(g) => (
              <span
                class="live-dot"
                classList={{ active: g.children.length > 0 }}
                style={{ "--c": agentColor(g.agent) }}
                title={`${g.agent}${g.host ? " no " + g.host : ""}${g.cwd ? " · pasta " + g.cwd : ""}`}
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
          title="Ver o espaço que as IAs ocupam no disco e escolher o que apagar (nada é apagado sem você confirmar)"
          onClick={() => setView("system")}
        >
          <HardDrive size={14} />
          <span>Liberar espaço</span>
        </button>
      </div>
    </header>
  );
}
