// Uma linha da lista de conversas anteriores, com o botão de apagar que aparece ao passar o mouse.
// Usada no painel do projeto e no Chat livre.

import { Lock, Trash2 } from "lucide-solid";
import { Show, type JSX } from "solid-js";
import { accountById, fmtAgo } from "../accounts";
import type { Convo } from "../chat";
import { ProviderMark } from "./ui";

export default function ConvoRow(props: {
  c: Convo;
  i: number;
  current: boolean;
  locked: boolean;
  opening: boolean;
  disabled: boolean;
  title: string;
  extra?: JSX.Element;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const a = () => accountById(props.c.account);
  const ago = (ms: number) => fmtAgo(Math.max(0, (Date.now() - ms) / 1000));
  return (
    <div class="convo-row slide-in" style={{ "animation-delay": `${Math.min(props.i, 12) * 30}ms` }}>
      <button
        class="convo"
        classList={{ current: props.current, locked: props.locked, opening: props.opening }}
        style={{ "--c": a().color }}
        title={props.title}
        disabled={props.disabled}
        onClick={props.onOpen}
      >
        <span class="convo-bar" />
        <span class="convo-main">
          <span class="convo-title">{props.c.title}</span>
          <Show when={props.c.lastPrompt}><span class="convo-last">↳ {props.c.lastPrompt}</span></Show>
          <span class="convo-meta">
            <ProviderMark id={props.c.account} size={14} />
            <span>{a().label}</span>
            {props.extra}
            <span>· {ago(props.c.updated)}</span>
          </span>
        </span>
        <Show when={props.opening} fallback={<Show when={props.current} fallback={<Show when={props.locked}><Lock size={12} class="convo-lock" /></Show>}><span class="convo-badge">aberta</span></Show>}>
          <span class="spinner" />
        </Show>
      </button>
      <button class="convo-del" title="Apagar esta conversa (vai para a Lixeira)" aria-label="Apagar esta conversa" onClick={props.onDelete}>
        <Trash2 size={13} />
      </button>
    </div>
  );
}
