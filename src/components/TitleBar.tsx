import { Bell, BellRing, CircleCheck, Command, HardDrive, Search } from "lucide-solid";
import { createSignal, For, Show } from "solid-js";
import { needs, urgentCount } from "../attention";
import { dismissable } from "../dismiss";
import { setPaletteOpen } from "../store";
import AppMark from "./AppMark";
import { tx } from "../i18n";
import { openPanel } from "../panel";

const isMac = navigator.userAgent.includes("Mac");

export default function TitleBar() {
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
        <NeedsButton />
        <button
          class="ghost-btn"
          title={tx("Ver o espaço que as IAs ocupam no disco e escolher o que apagar (nada é apagado sem você confirmar)")}
          onClick={() => openPanel("overview")}
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
