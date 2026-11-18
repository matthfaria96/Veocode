// As duas abas da área "Computador": o que o Claude ganhou de extra (com ligar, desligar e
// remover) e o que as IAs ocupam no disco e na memória. Antes eram três telas que repetiam
// as mesmas coisas (Inventário, Raio-X e Skills e MCP).
import { HardDrive, Puzzle } from "lucide-solid";
import { setView, view } from "../store";

export default function ComputerTabs() {
  const tabs = [
    { id: "inventory" as const, label: "Extras do Claude", hint: "receitas, atalhos e conexões", icon: Puzzle },
    { id: "system" as const, label: "Espaço e memória", hint: "o que ocupa disco e o que está aberto", icon: HardDrive },
  ];
  return (
    <div class="computer-tabs" role="tablist">
      <span class="computer-tabs-thumb" style={{ transform: `translateX(${view() === "system" ? 100 : 0}%)` }} />
      {tabs.map((t) => (
        <button role="tab" aria-selected={view() === t.id} classList={{ active: view() === t.id }} onClick={() => setView(t.id)}>
          <t.icon size={15} />
          <span>
            <strong>{t.label}</strong>
            <small>{t.hint}</small>
          </span>
        </button>
      ))}
    </div>
  );
}
