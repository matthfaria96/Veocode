import { Bot, ChartPie, LayoutDashboard, MessagesSquare, CircleHelp, FolderOpen, Settings } from "lucide-solid";
import { createMemo, For, Show, type JSX } from "solid-js";
import { helpOpen, setHelpOpen, setView, view, type View } from "../store";
import { railStatus } from "../railStatus";
import { tx } from "../i18n";

// "also": telas que acendem o mesmo ícone (abas da mesma área)
const items: { id: View; label: string; icon: () => JSX.Element; also?: View[] }[] = [
  { id: "board", get label() { return tx("Início: visão geral dos projetos"); }, icon: () => <LayoutDashboard size={19} /> },
  { id: "workspace", get label() { return tx("Projetos"); }, icon: () => <FolderOpen size={19} /> },
  { id: "livre", get label() { return tx("Chat livre"); }, icon: () => <MessagesSquare size={19} /> },
  { id: "accounts", get label() { return tx("Contas e IAs"); }, icon: () => <Bot size={19} /> },
  { id: "system", get label() { return tx("Painel: espaço, IAs abertas e extras do Claude"); }, icon: () => <ChartPie size={19} />, also: ["inventory"] },
];

export default function Rail() {
  const on = (i: (typeof items)[number]) => i.id === view() || !!i.also?.includes(view());
  const index = () => items.findIndex(on);
  return (
    <nav class="rail">
      <div class="rail-items">
        <span class="rail-indicator" style={{ transform: `translateY(${Math.max(0, index()) * 52}px)`, opacity: index() < 0 ? 0 : 1 }} />
        <For each={items}>
          {(item, i) => {
            // bolinha discreta quando algo acontece ali; o resumo vem na dica
            const st = createMemo(() => railStatus(item.id));
            return (
              <button class="rail-btn" classList={{ active: on(item) }} onClick={() => setView(item.id)}>
                {item.icon()}
                <Show when={st()?.tone}>{(t) => <i class={`rail-dot ${t()}`} aria-hidden="true" />}</Show>
                <span class="rail-tip">
                  <span class="rail-tip-head">{item.label} <kbd>⌘{i() + 1}</kbd></span>
                  <Show when={st()}>
                    {(s) => (
                      <span class={`rail-tip-sum ${s().tone ?? "idle"}`}>
                        <For each={s().lines}>{(l) => <span>{l}</span>}</For>
                      </span>
                    )}
                  </Show>
                </span>
              </button>
            );
          }}
        </For>
      </div>
      <div class="rail-foot">
        <button class="rail-btn rail-help" classList={{ active: helpOpen() }} onClick={() => setHelpOpen(!helpOpen())}>
          <CircleHelp size={19} />
          <span class="rail-tip">{tx("Ajuda (F1)")}</span>
        </button>
        <button class="rail-btn" classList={{ active: view() === "settings" }} onClick={() => setView("settings")}>
          <Settings size={19} />
          <span class="rail-tip">{tx("Ajustes")}</span>
        </button>
      </div>
    </nav>
  );
}
