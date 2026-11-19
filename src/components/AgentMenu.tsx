// Botão da IA na barra da caixa de mensagem e o menu que ele abre (conta, modelo e força do raciocínio).
// Um componente só para Projetos e Chat livre: as duas caixas ficam sempre iguais.

import { Check, ChevronDown } from "lucide-solid";
import { For, Show } from "solid-js";
import { accountById, accountSub, accts } from "../accounts";
import { claudeModels, efforts, niceModel, prefsLabel, prefsOf, setPref } from "../chatPrefs";
import { dismissable } from "../dismiss";
import { LimitChip } from "./Limits";
import { ProviderMark } from "./ui";

/** Conta, logo e modelo escolhido. `prefKey` é onde ficam o modelo e o raciocínio (projeto ou Chat livre). */
export function AgentChipButton(props: { prefKey: string; accountId: string; open: boolean; disabled?: boolean; title: string; onClick: () => void }) {
  const a = () => accountById(props.accountId);
  return (
    <button class="agent-chip-btn" classList={{ on: props.open }} disabled={props.disabled} title={props.title} onClick={props.onClick}>
      <ProviderMark id={a().id} size={18} />
      <span class="agent-chip-name">{a().label}</span>
      <small>{niceModel(a().provider === "claude" ? prefsLabel(props.prefKey) ?? accountSub(a()) : accountSub(a()))}</small>
      <ChevronDown size={12} />
    </button>
  );
}

/** Abre para cima, saindo da caixa de mensagem. */
export function AgentMenu(props: { prefKey: string; accountId: string; title: string; onPick: (id: string) => void; onClose: () => void }) {
  const account = () => accountById(props.accountId);
  const prefs = () => prefsOf(props.prefKey);
  return (
    <div class="menu pop-in agent-menu" ref={(el) => dismissable(el, props.onClose)}>
      <small class="menu-title">{props.title}</small>
      <For each={accts.list} fallback={<small class="inv-menu-empty">Nenhuma conta ainda: adicione em Contas e IAs</small>}>
        {(a) => (
          <button
            class="menu-item"
            classList={{ sel: a.id === account().id }}
            onClick={() => {
              if (a.id === account().id) return;
              props.onClose();
              props.onPick(a.id);
            }}
          >
            <ProviderMark id={a.id} size={20} />
            <span>{a.label}</span>
            <small>{accountSub(a)}</small>
            <LimitChip id={a.id} />
            <Show when={a.id === account().id}><Check size={14} class="menu-check" /></Show>
          </button>
        )}
      </For>
      <Show when={account().provider === "claude"}>
        <div class="menu-sep" />
        <small class="menu-title">Modelo</small>
        <div class="agent-chips">
          <For each={claudeModels}>
            {(m) => (
              <button class="agent-chip" classList={{ on: (prefs().model ?? null) === m.id }} title={m.id ? `${m.label}: ${m.hint}` : `Usa o modelo da conta (${accountSub(account())})`} onClick={() => setPref(props.prefKey, { model: m.id })}>
                {m.label}
              </button>
            )}
          </For>
        </div>
        <small class="menu-title">Força do raciocínio</small>
        <div class="agent-chips effort">
          <For each={efforts}>
            {(e, i) => (
              <button class="agent-chip" classList={{ on: (prefs().effort ?? null) === e.id }} data-lvl={i()} title={e.id ? `Pensa ${e.label.toLowerCase()}: ${i() <= 2 ? "responde mais rápido e gasta menos" : "pensa mais antes de responder e gasta mais"}` : "Usa o padrão do Claude Code"} onClick={() => setPref(props.prefKey, { effort: e.id })}>
                <Show when={e.id}><i class="effort-bars"><b /><b /><b /><b /><b /></i></Show>
                {e.label}
              </button>
            )}
          </For>
        </div>
        <p class="agent-menu-note">Vale a partir da próxima mensagem; a conversa continua de onde parou.</p>
      </Show>
    </div>
  );
}
