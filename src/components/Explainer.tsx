// Caixa "O que é isso?" no topo das telas técnicas: explica em palavras simples o que a tela
// mostra e se a pessoa precisa fazer algo. Aberta da primeira vez; quem já entendeu pode
// fechar, e ela vira só um botão (lembrado neste computador).
import { HelpCircle, X } from "lucide-solid";
import { createSignal, For, Show, type JSX } from "solid-js";
import { tx } from "../i18n";

export interface Term {
  word: string;
  means: JSX.Element;
}

const key = (id: string) => `veocode.explain.${id}`;
/** null: a pessoa nunca abriu nem fechou */
const saved = (id: string): boolean | null => {
  try {
    const v = localStorage.getItem(key(id));
    return v === null ? null : v === "1";
  } catch {
    return null;
  }
};

export default function Explainer(props: { id: string; title: string; intro: JSX.Element; terms?: Term[]; calm?: JSX.Element; openLabel?: string; closed?: boolean }) {
  const [open, setOpen] = createSignal(saved(props.id) ?? !props.closed);
  const set = (v: boolean) => {
    setOpen(v);
    try {
      localStorage.setItem(key(props.id), v ? "1" : "0");
    } catch {
      /* sem armazenamento: só não lembra */
    }
  };
  return (
    <Show
      when={open()}
      fallback={
        <button class="explain-open" onClick={() => set(true)}>
          <HelpCircle size={13} /> {props.openLabel ?? tx("O que é esta tela?")}
        </button>
      }
    >
      <div class="explain">
        <div class="explain-head">
          <HelpCircle size={16} />
          <strong>{props.title}</strong>
          <button class="icon-btn" title={tx("Esconder explicação")} onClick={() => set(false)}><X size={14} /></button>
        </div>
        <p class="explain-intro">{props.intro}</p>
        <Show when={props.terms?.length}>
          <dl class="explain-terms">
            <For each={props.terms}>
              {(t) => (
                <div>
                  <dt>{t.word}</dt>
                  <dd>{t.means}</dd>
                </div>
              )}
            </For>
          </dl>
        </Show>
        <Show when={props.calm}>
          <p class="explain-calm">{props.calm}</p>
        </Show>
        <button class="link-btn explain-ok" onClick={() => set(false)}>{tx("Entendi, esconder")}</button>
      </div>
    </Show>
  );
}
