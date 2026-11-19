// As duas abas da área "Computador": o que o Claude ganhou de extra (com ligar, desligar e
// remover) e o que as IAs ocupam no disco e na memória. Antes eram três telas que repetiam
// as mesmas coisas (Inventário, Raio-X e Skills e MCP).
import { HardDrive, Puzzle } from "lucide-solid";
import { setView, view } from "../store";
import { tx } from "../i18n";

export default function ComputerTabs() {
  const tabs = [
    { id: "inventory" as const, label: tx("Extras do Claude"), hint: tx("receitas, atalhos e conexões"), icon: Puzzle },
    { id: "system" as const, label: tx("Espaço e memória"), hint: tx("o que ocupa disco e o que está aberto"), icon: HardDrive },
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
