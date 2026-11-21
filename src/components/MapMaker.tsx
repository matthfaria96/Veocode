// Janela para fazer (ou refazer) o mapa do projeto. Dois jeitos, ditos com clareza antes de
// começar: do código (grátis, no Mac, em segundos) ou com a IA da conta do projeto (qual conta,
// qual modelo, o que gasta e quanto do limite já foi usado). Os dois escrevem o mesmo arquivo.
import { Cpu, Sparkles, Waypoints } from "lucide-solid";
import { createSignal, For, Show } from "solid-js";
import Modal, { ModalSection } from "./Modal";
import { ProviderMark } from "./ui";
import { closeModal } from "../modals";
import { accountById, accountSub, accts, providers } from "../accounts";
import { claudeModels, prefsOf } from "../chatPrefs";
import { peak, whenText } from "../limits";
import { askAiForMap, MAP_FILE, MAP_NOTES, mapOf, scanMap } from "../projmap";
import { projects } from "../store";
import { tx } from "../i18n";

export default function MapMaker(props: { pid: string }) {
  const project = () => projects.find((x) => x.id === props.pid);
  const acc = () => accountById(project()?.accountId ?? "");
  const status = () => accts.status[acc().id];
  const kind = () => acc().provider;
  const had = () => mapOf(props.pid).data;
  const [how, setHow] = createSignal<"code" | "ai">(had()?.by && had()!.by !== "veocode" ? "ai" : "code");
  const [model, setModel] = createSignal<string | null>(prefsOf(props.pid).model ?? null);
  const ready = () => !status() || status()!.state === "pronta";
  const lim = () => (kind() === "claude" ? peak(acc().id) : null);

  const go = () => {
    closeModal();
    if (how() === "code") void scanMap(props.pid);
    else askAiForMap(props.pid, kind() === "claude" ? { model: model() } : undefined);
  };

  const cost = () => {
    const k = kind();
    if (k === "ollama") return tx("Roda no seu Mac pelo Ollama: não gasta créditos, mas pode demorar e o resultado depende do modelo.");
    if (k === "claude") {
      const plan = status()?.plan;
      return plan
        ? tx("Gasta do limite do plano {plan} desta conta, como uma tarefa grande: a IA lê boa parte do código.", { plan })
        : tx("Gasta do limite do plano desta conta, como uma tarefa grande: a IA lê boa parte do código.");
    }
    const bal = status()?.balance;
    return bal
      ? tx("Cobrado na chave de API desta conta (saldo {v}). O custo cresce com o tamanho do projeto.", { v: bal })
      : tx("Cobrado na chave de API desta conta. O custo cresce com o tamanho do projeto.");
  };

  return (
    <Modal
      icon={Waypoints}
      title={had() ? tx("Refazer o mapa") : tx("Fazer o mapa do projeto")}
      sub={tx("Escolha como. Os dois escrevem o mesmo arquivo e você pode trocar depois.")}
      onClose={closeModal}
      note={tx("Fica em {file}. Dele o Veocode gera {notes}, o resumo que a IA do projeto consulta para achar onde mexer.", { file: MAP_FILE, notes: MAP_NOTES })}
      actions={
        <>
          <button class="ghost-btn" onClick={closeModal}>{tx("Cancelar")}</button>
          <button class="primary-btn" disabled={how() === "ai" && !ready()} onClick={go}>
            <Show when={how() === "ai"} fallback={<><Cpu size={14} /> {tx("Desenhar do código")}</>}>
              <Sparkles size={14} /> {tx("Pedir à IA")}
            </Show>
          </button>
        </>
      }
    >
      <div class="mk-opts" role="radiogroup">
        <button class="mk-opt" role="radio" aria-checked={how() === "code"} classList={{ on: how() === "code" }} onClick={() => setHow("code")}>
          <span class="mk-ico"><Cpu size={17} /></span>
          <span class="mk-txt">
            <strong>{tx("Do código")}</strong>
            <span>{tx("O Veocode lê os imports e o comentário do topo de cada arquivo: áreas, arquivos e quem usa quem, com a explicação que o próprio código tiver.")}</span>
            <span class="mk-tags"><b class="free">{tx("Grátis")}</b><b>{tx("No seu Mac")}</b><b>{tx("Segundos")}</b><b class="dim">{tx("Sem fluxos")}</b></span>
          </span>
          <i class="mk-radio" />
        </button>
        <button class="mk-opt" role="radio" aria-checked={how() === "ai"} classList={{ on: how() === "ai" }} onClick={() => setHow("ai")}>
          <span class="mk-ico ai"><Sparkles size={17} /></span>
          <span class="mk-txt">
            <strong>{tx("Com a IA")}</strong>
            <span>{tx("A IA lê o projeto e escreve um mapa resumido: o que o projeto é, as áreas, o que cada peça faz e os fluxos principais explicados passo a passo.")}</span>
            <span class="mk-tags">
              <Show when={kind() === "ollama"} fallback={<b class="paid">{tx("Usa a sua conta")}</b>}><b class="free">{tx("Grátis")}</b></Show>
              <b>{tx("Alguns minutos")}</b>
              <b>{tx("Com fluxos")}</b>
            </span>
          </span>
          <i class="mk-radio" />
        </button>
      </div>

      <Show when={how() === "ai"}>
        <div class="mk-ai pop-in">
          <ModalSection title={tx("Quem faz")} />
          <div class="mk-acc">
            <ProviderMark id={acc().id} size={26} />
            <span class="mk-acc-name">
              <strong>{acc().label}</strong>
              <small>{[providers[kind()].name, status()?.plan, accountSub(acc()) !== status()?.plan ? accountSub(acc()) : null].filter(Boolean).join(" · ")}</small>
            </span>
            <Show when={lim()}>
              {(l) => (
                <span class="mk-lim" data-tone={l().pct >= 90 ? "hot" : l().pct >= 75 ? "warn" : "ok"} title={l().resetsAt ? tx("Zera {v}", { v: whenText(l().resetsAt) }) : ""}>
                  {l().win === "5h" ? tx("{pct}% do limite das 5 horas usado", { pct: Math.round(l().pct) }) : tx("{pct}% do limite da semana usado", { pct: Math.round(l().pct) })}
                </span>
              )}
            </Show>
          </div>
          <Show when={!ready()}>
            <p class="mk-warn">{tx("Esta conta não está pronta (sem login ou sem chave). Arrume em Contas e IAs ou troque a conta do projeto na caixa de mensagem.")}</p>
          </Show>

          <Show when={kind() === "claude"}>
            <ModalSection title={tx("Modelo")} info={tx("só para este mapa")} />
            <div class="agent-chips">
              <For each={claudeModels}>
                {(m) => (
                  <button class="agent-chip" classList={{ on: model() === m.id }} title={m.id ? `${m.label}: ${m.hint}` : tx("Usa o modelo da conta ({v})", { v: accountSub(acc()) })} onClick={() => setModel(m.id)}>
                    {m.label}
                  </button>
                )}
              </For>
            </div>
            <small class="mk-hint">{tx("Sonnet costuma bastar para o mapa e gasta menos que o Opus.")}</small>
          </Show>

          <ul class="mk-cost">
            <li>{cost()}</li>
            <li>{tx("Abre numa conversa nova no modo IA (a sua conversa atual fica como está) e dá para parar quando quiser.")}</li>
          </ul>
        </div>
      </Show>
    </Modal>
  );
}
