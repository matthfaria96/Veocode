// Botões que aparecem ao passar o mouse numa mensagem: copiar o texto e, nos seus pedidos,
// mandar de novo para a caixa de texto (para repetir ou ajustar antes de enviar).
import { Check, Copy, CornerDownLeft, GitBranch, Pencil } from "lucide-solid";
import { createSignal, Show } from "solid-js";
import { copyText } from "../api";
import { tx } from "../i18n";

export default function MsgTools(props: { text: string; onReuse?: () => void; onEdit?: () => void; onFork?: () => void }) {
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
      <button title={ok() ? tx("Copiado") : tx("Copiar")} onClick={copy}>{ok() ? <Check size={12} /> : <Copy size={12} />}</button>
      <Show when={props.onEdit}>
        <button title={tx("Editar e mandar de novo: o Claude esquece esta versão e o que veio depois")} onClick={(e) => (e.stopPropagation(), props.onEdit!())}>
          <Pencil size={12} />
        </button>
      </Show>
      <Show when={props.onFork}>
        <button title={tx("Bifurcar daqui: uma conversa nova com tudo até antes deste pedido, e ele na caixa para você mudar. Esta continua igual.")} onClick={(e) => (e.stopPropagation(), props.onFork!())}>
          <GitBranch size={12} />
        </button>
      </Show>
      <Show when={props.onReuse}>
        <button title={tx("Usar de novo: volta para a caixa de texto para você ajustar e enviar")} onClick={(e) => (e.stopPropagation(), props.onReuse!())}>
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
