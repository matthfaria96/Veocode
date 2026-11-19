// Botão de falar da caixa de mensagem: microfone parado; ouvindo, vira uma pílula com
// ondas que seguem a sua voz e um quadrado para parar.
import { Mic, Square } from "lucide-solid";
import { For, Show } from "solid-js";
import { isTauri } from "../api";
import { listeningTo, toggleVoice, voice } from "../voice";
import { tx } from "../i18n";

const SHAPE = [0.45, 0.75, 1, 0.8, 0.55];

export function MicButton(props: { target: string; compact?: boolean; disabled?: boolean }) {
  const on = () => listeningTo(props.target);
  const v = () => (on() ? voice() : null);
  const lvl = () => v()?.level ?? 0;
  return (
    <Show when={isTauri}>
      <Show
        when={on()}
        fallback={
          <button class="mic-btn" classList={{ compact: props.compact }} disabled={props.disabled} title={tx("Falar em vez de digitar (⌥ Espaço)")} onClick={() => void toggleVoice(props.target)}>
            <Mic size={props.compact ? 14 : 15} />
          </button>
        }
      >
        <button
          class="mic-live"
          classList={{ compact: props.compact, starting: v()?.phase === "starting", finishing: v()?.phase === "finishing" }}
          style={{ "--lvl": lvl() }}
          title={tx("Parar e deixar o texto (Enter) · Esc cancela")}
          onClick={() => void toggleVoice(props.target)}
        >
          <span class="mic-ring" />
          <span class="mic-bars" aria-hidden="true">
            <For each={SHAPE}>{(k, i) => <i style={{ "--k": k, "--d": `${i() * 90}ms` }} />}</For>
          </span>
          <Show when={!props.compact}>
            <span class="mic-label">{v()?.phase === "starting" ? tx("Abrindo…") : v()?.phase === "finishing" ? tx("Escrevendo…") : tx("Ouvindo")}</span>
          </Show>
          <span class="mic-stop"><Square size={9} fill="currentColor" /></span>
        </button>
      </Show>
    </Show>
  );
}
