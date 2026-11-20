// Parar uma IA que roda fora do Veocode nesta pasta (Terminal, editor, app do Claude). O arquivo
// da conversa não diz qual programa a está rodando, então aparecem as IAs abertas na pasta (onde,
// há quanto tempo, se está gastando processador agora) e você escolhe. Parar interrompe e, se ela
// não fechar em 3 s, encerra junto tudo o que ela abriu. A conversa fica guardada.
import { Bot, Code2, Cpu, SquareTerminal, X } from "lucide-solid";
import { createResource, createSignal, For, Show, type JSX } from "solid-js";
import { outsideAgents, outsideStop } from "../outside";
import { showToast } from "../store";
import { tx } from "../i18n";
import type { AgentGroup } from "../api";

const hostIcon = (h?: string): JSX.Element =>
  h === "Terminal" ? <SquareTerminal size={15} /> : h === "VS Code" || h === "Cursor" ? <Code2 size={15} /> : h === "app do Claude" ? <Bot size={15} /> : <Cpu size={15} />;

const since = (s: number) => (s < 60 ? tx("agora há pouco") : s < 3600 ? tx("há {n} min", { n: Math.round(s / 60) }) : tx("há {n} h", { n: Math.round(s / 3600) }));

export default function StopOutside(props: { pid: string; onClose: () => void; onStopped: () => void }) {
  const [list] = createResource(
    () => props.pid,
    (pid) => outsideAgents(pid).then((l) => [...l].sort((a, b) => b.cpu - a.cpu)).catch((e) => (showToast(String(e)), [] as AgentGroup[])),
  );
  const [busy, setBusy] = createSignal<number | null>(null);
  const stop = async (g: AgentGroup) => {
    setBusy(g.pid);
    try {
      await outsideStop(props.pid, g.pid);
      showToast(tx("Parando a IA no {host}: o pedido é interrompido e o que ela abriu é fechado.", { host: tx(g.host ?? "outro") }));
      props.onStopped();
    } catch (e) {
      showToast(String(e instanceof Error ? e.message : e));
      setBusy(null);
    }
  };
  return (
    <div class="stop-out pop-in" role="dialog" aria-label={tx("Parar a IA de fora")} ref={(el) => requestAnimationFrame(() => el.scrollIntoView({ block: "nearest", behavior: "smooth" }))}>
      <div class="stop-out-head">
        <strong>{tx("Parar a IA de fora")}</strong>
        <button class="icon-btn small" title={tx("Fechar")} onClick={() => props.onClose()}><X size={13} /></button>
      </div>
      <p>{tx("Ela roda fora do Veocode. Parar interrompe o pedido e fecha esse Claude com tudo o que ele abriu (comandos, servidores, ajudantes). A conversa fica salva: dá para continuar depois.")}</p>
      <Show when={!list.loading} fallback={<div class="stop-out-empty"><span class="spinner inline" /> {tx("Procurando as IAs abertas nesta pasta…")}</div>}>
        <Show when={list()?.length} fallback={<div class="stop-out-empty">{tx("Não achei nenhuma IA aberta nesta pasta. Ela pode já ter terminado.")}</div>}>
          <Show when={(list()?.length ?? 0) > 1}>
            <small class="stop-out-hint">{tx("Há mais de uma aberta aqui. A que está trabalhando agora vem primeiro.")}</small>
          </Show>
          <div class="stop-out-list">
            <For each={list()}>
              {(g) => {
                const working = g.cpu >= 3;
                return (
                  <div class="stop-out-row" classList={{ working }}>
                    <span class="stop-out-icon">{hostIcon(g.host)}</span>
                    <span class="stop-out-text">
                      <b>{tx(g.host ?? "outro")}</b>
                      <small>{working ? tx("trabalhando agora") : tx("parada")} · {tx("aberta {when}", { when: since(g.runSecs) })}</small>
                    </span>
                    <button class="stop-out-btn" disabled={busy() !== null} onClick={() => void stop(g)}>
                      <Show when={busy() === g.pid} fallback={tx("Parar")}><span class="spinner inline" /></Show>
                    </button>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
}
