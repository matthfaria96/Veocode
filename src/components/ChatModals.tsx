// Quem desenha a janela aberta (nível de acesso, memória ou contexto). Fica no topo do app para
// o fundo borrado cobrir a tela toda.
import { Match, Switch } from "solid-js";
import { modal } from "../modals";
import { projects } from "../store";
import AccessLevel from "./AccessLevel";
import { ContextPanel } from "./ContextPanel";
import { MemoryPanel } from "./Memory";

export default function ChatModals() {
  // o projeto pode ter sido removido com a janela aberta
  const m = () => {
    const x = modal();
    return x && projects.some((p) => p.id === x.pid) ? x : null;
  };
  return (
    <Switch>
      <Match when={m()?.kind === "access" && m()}>{(x) => <AccessLevel projectId={x().pid} />}</Match>
      <Match when={m()?.kind === "memory" && m()}>{(x) => <MemoryPanel pid={x().pid} />}</Match>
      <Match when={m()?.kind === "context" && m()?.k ? m() : null}>{(x) => <ContextPanel pid={x().pid} k={x().k!} />}</Match>
    </Switch>
  );
}
