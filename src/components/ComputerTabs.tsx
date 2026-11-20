// Topo da área "Computador": o seletor entre as duas visões faz de título, com os botões
// à direita. Primeiro o uso da máquina (disco, IAs abertas, portas), depois o que o Claude
// ganhou de extra (skills, atalhos, ajudantes, MCP e plugins).
import { HardDrive, Puzzle } from "lucide-solid";
import { Show, type JSX } from "solid-js";
import { isTauri } from "../api";
import { setView, view } from "../store";
import { tx } from "../i18n";

export default function ComputerTabs(props: { actions?: JSX.Element }) {
  const tabs = [
    { id: "system" as const, label: tx("Uso da máquina"), hint: tx("O que as IAs deixaram no disco e o que está aberto agora"), icon: HardDrive },
    { id: "inventory" as const, label: tx("Extras do Claude"), hint: tx("Skills, atalhos, ajudantes, conexões (MCP) e plugins"), icon: Puzzle },
  ];
  const at = () => (view() === "inventory" ? 1 : 0);
  return (
    <header class="cx-top">
      <h1 class="sr-only">{tabs[at()].label}</h1>
      <div class="computer-tabs" role="tablist" aria-label={tx("Computador")}>
        <span class="computer-tabs-thumb" style={{ transform: `translateX(${at() * 100}%)` }} />
        {tabs.map((t) => (
          <button role="tab" aria-selected={view() === t.id} classList={{ active: view() === t.id }} title={t.hint} onClick={() => setView(t.id)}>
            <t.icon size={15} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <div class="cx-top-actions">
        <Show when={!isTauri}><span class="cx-demo" title={tx("Abra pelo app para ver a máquina de verdade.")}>{tx("Dados de exemplo")}</span></Show>
        {props.actions}
      </div>
    </header>
  );
}
