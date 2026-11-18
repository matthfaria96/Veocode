import { Bot, Boxes, LayoutDashboard, MessagesSquare, CircleHelp, FolderOpen, Network, Puzzle, Radar, Settings } from "lucide-solid";
import { For, type JSX } from "solid-js";
import { helpOpen, setHelpOpen, setView, view, type View } from "../store";

const items: { id: View; label: string; icon: () => JSX.Element }[] = [
  { id: "home", label: "Mapa", icon: () => <Network size={19} /> },
  { id: "board", label: "Painel (todos os projetos)", icon: () => <LayoutDashboard size={19} /> },
  { id: "workspace", label: "Projetos", icon: () => <FolderOpen size={19} /> },
  { id: "livre", label: "Chat livre", icon: () => <MessagesSquare size={19} /> },
  { id: "accounts", label: "Contas e IAs", icon: () => <Bot size={19} /> },
  { id: "inventory", label: "Inventário", icon: () => <Boxes size={19} /> },
  { id: "system", label: "Raio-X", icon: () => <Radar size={19} /> },
  { id: "skills", label: "Skills e MCP", icon: () => <Puzzle size={19} /> },
];

export default function Rail() {
  const index = () => items.findIndex((i) => i.id === view());
  return (
    <nav class="rail">
      <div class="rail-items">
        <span class="rail-indicator" style={{ transform: `translateY(${Math.max(0, index()) * 52}px)`, opacity: index() < 0 ? 0 : 1 }} />
        <For each={items}>
          {(item) => (
            <button class="rail-btn" classList={{ active: view() === item.id }} onClick={() => setView(item.id)}>
              {item.icon()}
              <span class="rail-tip">{item.label}</span>
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
