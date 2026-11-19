import { Bot, LayoutDashboard, MessagesSquare, CircleHelp, FolderOpen, Monitor, Settings } from "lucide-solid";
import { For, type JSX } from "solid-js";
import { helpOpen, setHelpOpen, setView, view, type View } from "../store";

// "also": telas que acendem o mesmo ícone (abas da mesma área)
const items: { id: View; label: string; icon: () => JSX.Element; also?: View[] }[] = [
  { id: "board", label: "Início: visão geral dos projetos", icon: () => <LayoutDashboard size={19} /> },
  { id: "workspace", label: "Projetos", icon: () => <FolderOpen size={19} /> },
  { id: "livre", label: "Chat livre", icon: () => <MessagesSquare size={19} /> },
  { id: "accounts", label: "Contas e IAs", icon: () => <Bot size={19} /> },
  { id: "inventory", label: "Computador: extras do Claude, espaço e memória", icon: () => <Monitor size={19} />, also: ["system"] },
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
          <span class="rail-tip">Ajuda (F1)</span>
        </button>
        <button class="rail-btn" classList={{ active: view() === "settings" }} onClick={() => setView("settings")}>
          <Settings size={19} />
          <span class="rail-tip">Ajustes</span>
        </button>
      </div>
    </nav>
  );
}
