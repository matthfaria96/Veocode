import { Bot, LayoutDashboard, MessagesSquare, CircleHelp, FolderOpen, Monitor, Settings } from "lucide-solid";
import { For, type JSX } from "solid-js";
import { helpOpen, setHelpOpen, setView, view, type View } from "../store";
import { tx } from "../i18n";

// "also": telas que acendem o mesmo ícone (abas da mesma área)
const items: { id: View; label: string; icon: () => JSX.Element; also?: View[] }[] = [
  { id: "board", get label() { return tx("Início: visão geral dos projetos"); }, icon: () => <LayoutDashboard size={19} /> },
  { id: "workspace", get label() { return tx("Projetos"); }, icon: () => <FolderOpen size={19} /> },
  { id: "livre", get label() { return tx("Chat livre"); }, icon: () => <MessagesSquare size={19} /> },
  { id: "accounts", get label() { return tx("Contas e IAs"); }, icon: () => <Bot size={19} /> },
  { id: "inventory", get label() { return tx("Computador: extras do Claude, espaço e memória"); }, icon: () => <Monitor size={19} />, also: ["system"] },
];

export default function Rail() {
  const on = (i: (typeof items)[number]) => i.id === view() || !!i.also?.includes(view());
  const index = () => items.findIndex(on);
  return (
    <nav class="rail">
      <div class="rail-items">
        <span class="rail-indicator" style={{ transform: `translateY(${Math.max(0, index()) * 52}px)`, opacity: index() < 0 ? 0 : 1 }} />
        <For each={items}>
          {(item, i) => (
            <button class="rail-btn" classList={{ active: on(item) }} onClick={() => setView(item.id)}>
              {item.icon()}
              <span class="rail-tip">{item.label} <kbd>⌘{i() + 1}</kbd></span>
            </button>
          )}
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
