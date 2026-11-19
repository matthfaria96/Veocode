import { Bell, BellRing, CircleCheck, Command, HardDrive, Search } from "lucide-solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import { needs, urgentCount } from "../attention";
import { dismissable } from "../dismiss";
import { setPaletteOpen, setView } from "../store";
import { agentColor, xray } from "../xray";
import AppMark from "./AppMark";
import { tx, txn } from "../i18n";

const isMac = navigator.userAgent.includes("Mac");

export default function TitleBar() {
  const label = createMemo(() => {
    if (!xray.procsLoaded) return "…";
    const n = xray.procs.length;
    const busy = xray.procs.filter((g) => g.children.length > 0).length;
    if (n === 0) return tx("nenhuma IA aberta");
    return busy ? txn(n, "{n} IA aberta · {busy} trabalhando", "{n} IAs abertas · {busy} trabalhando", { busy }) : txn(n, "{n} IA aberta", "{n} IAs abertas");
  });
  // onde estão: "6 no VS Code, 2 no app do Claude…"
  const where = createMemo(() => {
    const by = new Map<string, number>();
    for (const g of xray.procs) by.set(g.host ?? "outro", (by.get(g.host ?? "outro") ?? 0) + 1);
    const parts = [...by.entries()].sort((a, b) => b[1] - a[1]).map(([h, k]) => `${k} ${h === "outro" ? tx("em outro programa") : h === "Terminal" ? tx("no Terminal") : h === "Veocode" ? tx("no Veocode") : h === "app do Claude" ? tx("no app do Claude") : tx("no {h}", { h })}`);
    return parts.length ? tx("Programas de IA abertos neste computador agora (cada conversa aberta conta uma, mesmo parada): {v}. Aceso = rodando comandos agora. Clique para ver e fechar.", { v: parts.join(", ") }) : tx("Nenhum programa de IA aberto agora.");
  });
  return (
    <header class="titlebar" classList={{ mac: isMac }} data-tauri-drag-region>
      <div class="brand" data-tauri-drag-region>
        <AppMark size={22} />
        <span class="brand-name">Veocode</span>
      </div>

      <button class="title-search" onClick={() => setPaletteOpen(true)}>
        <Search size={14} />
        <span>{tx("Buscar projetos, arquivos, ações…")}</span>
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
                title={[g.agent, g.host ? tx("no {v}", { v: tx(g.host) }) : "", g.cwd ? tx("· pasta {v}", { v: g.cwd }) : ""].filter(Boolean).join(" ")}
              />
            )}
          </For>
          <Show when={xray.procsLoaded && xray.procs.length === 0}>
            <span class="live-dot" style={{ "--c": "var(--text-3)" }} />
          </Show>
          <span class="live-text">{label()}</span>
        </div>
        <NeedsButton />
        <button
          class="ghost-btn"
          title={tx("Ver o espaço que as IAs ocupam no disco e escolher o que apagar (nada é apagado sem você confirmar)")}
          onClick={() => setView("system")}
        >
          <HardDrive size={14} />
          <span>{tx("Liberar espaço")}</span>
        </button>
      </div>
    </header>
  );
}

/** Sininho "Precisa de você": tudo o que espera uma ação sua, em todos os projetos. */
function NeedsButton() {
  const [open, setOpen] = createSignal(false);
  const tone = () => (needs().some((n) => n.urgency === "agora") ? "now" : urgentCount() ? "soon" : needs().length ? "later" : "none");
  return (
    <div class="needs">
      <button
        class={`needs-btn ${tone()}`}
        onClick={() => setOpen(!open())}
        title={needs().length ? tx("O que está esperando você") : tx("Nada esperando você")}
        aria-label={tx("Precisa de você: {length}", { length: needs().length })}
      >
        {tone() === "now" ? <BellRing size={15} /> : <Bell size={15} />}
        <Show when={needs().length}><span class="needs-count">{needs().length}</span></Show>
      </button>
      <Show when={open()}>
        <div class="needs-menu pop-in" ref={(el) => dismissable(el, () => setOpen(false))}>
          <header>{tx("Precisa de você")}</header>
          <Show when={needs().length} fallback={<div class="needs-empty"><CircleCheck size={18} /> {tx("Tudo em dia. Nada esperando você agora.")}</div>}>
            <For each={needs()}>
              {(n) => (
                <button class={`needs-item ${n.urgency}`} onClick={() => { setOpen(false); n.go(); }}>
                  <i />
                  <span class="needs-text">
                    <strong>{n.title}</strong>
                    <small>{n.detail}</small>
                  </span>
                  <span class="needs-go">{n.action}</span>
                </button>
              )}
            </For>
          </Show>
        </div>
      </Show>
    </div>
  );
}
