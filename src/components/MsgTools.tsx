// Botões que aparecem ao passar o mouse numa mensagem: copiar o texto e, nos seus pedidos,
// mandar de novo para a caixa de texto (para repetir ou ajustar antes de enviar).
import { Check, Copy, CornerDownLeft } from "lucide-solid";
import { createSignal, Show } from "solid-js";
import { copyText } from "../api";

export default function MsgTools(props: { text: string; onReuse?: () => void }) {
  const [ok, setOk] = createSignal(false);
  const copy = (e: MouseEvent) => {
    e.stopPropagation();
    void copyText(props.text).then(() => {
      setOk(true);
      setTimeout(() => setOk(false), 1400);
    });
  };
  return (
    <span class="msg-tools" classList={{ done: ok() }}>
      <button title={ok() ? "Copiado" : "Copiar"} onClick={copy}>{ok() ? <Check size={12} /> : <Copy size={12} />}</button>
      <Show when={props.onReuse}>
        <button title="Usar de novo: volta para a caixa de texto para você ajustar e enviar" onClick={(e) => (e.stopPropagation(), props.onReuse!())}>
          <CornerDownLeft size={12} />
        </button>
      </Show>
    </span>
  );
}

/** Põe o texto na caixa de pedido aberta e deixa o cursor no fim. */
export function focusComposer(root: Element | null) {
  requestAnimationFrame(() => {
    const t = (root ?? document).querySelector<HTMLTextAreaElement>("textarea");
    if (!t) return;
    t.focus();
    t.setSelectionRange(t.value.length, t.value.length);
  });
}
