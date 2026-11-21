// Botão da IA na barra da caixa de mensagem e o menu que ele abre (conta, modelo e força do raciocínio).
// Um componente só para Projetos e Chat livre: as duas caixas ficam sempre iguais. Nos projetos
// ele tem também o Code mode do `claude` do Terminal (o Chat livre não tem terminal).

import { Check, ChevronDown, SquareTerminal } from "lucide-solid";
import { For, onMount, Show } from "solid-js";
import { accountById, accountSub, accts } from "../accounts";
import { claudeModels, CODE_MODE_MIN, cliVersion, efforts, niceModel, prefsLabel, prefsOf, readCliVersion, setPref, versionAtLeast } from "../chatPrefs";
import { dismissable } from "../dismiss";
import { setProjMode, showTerm } from "../layoutMode";
import { runInNewTerm } from "../terminal";
import { LimitChip } from "./Limits";
import { ProviderMark, Toggle } from "./ui";
import { tx } from "../i18n";

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

/** Abre para cima, saindo da caixa de mensagem. `terminal`: o projeto tem Terminal (mostra o Code mode). */
export function AgentMenu(props: { prefKey: string; accountId: string; title: string; terminal?: boolean; onPick: (id: string) => void; onClose: () => void }) {
  const account = () => accountById(props.accountId);
  const prefs = () => prefsOf(props.prefKey);
  onMount(() => props.terminal && readCliVersion());
  const tooOld = () => {
    const v = cliVersion();
    return !!v && !versionAtLeast(v, CODE_MODE_MIN);
  };
  const update = () => {
    props.onClose();
    runInNewTerm(props.prefKey, "claude update");
    setProjMode("code");
    showTerm();
  };
  return (
    <div class="menu pop-in agent-menu" ref={(el) => dismissable(el, props.onClose)}>
      <small class="menu-title">{props.title}</small>
      <For each={accts.list} fallback={<small class="inv-menu-empty">{tx("Nenhuma conta ainda: adicione em Contas e IAs")}</small>}>
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
        <small class="menu-title">{tx("Modelo")}</small>
        <div class="agent-chips">
          <For each={claudeModels}>
            {(m) => (
              <button class="agent-chip" classList={{ on: (prefs().model ?? null) === m.id }} title={m.id ? `${m.label}: ${m.hint}` : tx("Usa o modelo da conta ({v})", { v: accountSub(account()) })} onClick={() => setPref(props.prefKey, { model: m.id })}>
                {m.label}
              </button>
            )}
          </For>
        </div>
        <small class="menu-title">{tx("Força do raciocínio")}</small>
        <div class="agent-chips effort">
          <For each={efforts}>
            {(e, i) => (
              <button class="agent-chip" classList={{ on: (prefs().effort ?? null) === e.id }} data-lvl={i()} title={e.id ? tx("Pensa {toLowerCase}: {v}", { toLowerCase: e.label.toLowerCase(), v: i() <= 2 ? tx("responde mais rápido e gasta menos") : tx("pensa mais antes de responder e gasta mais") }) : tx("Usa o padrão do Claude Code")} onClick={() => setPref(props.prefKey, { effort: e.id })}>
                <Show when={e.id}><i class="effort-bars"><b /><b /><b /><b /><b /></i></Show>
                {e.label}
              </button>
            )}
          </For>
        </div>
        <p class="agent-menu-note">{tx("Vale a partir da próxima mensagem; a conversa continua de onde parou.")}</p>
        <Show when={props.terminal}>
          <div class="menu-sep" />
          <div class="agent-cm">
            <div class="agent-cm-head">
              <span class="agent-cm-ico"><SquareTerminal size={14} /></span>
              <span class="agent-cm-name">
                <strong>{tx("Code mode")}</strong>
                <small>{tx("Experimental · só no Terminal")}</small>
              </span>
              <Toggle on={!!prefs().codeMode} onChange={(v) => setPref(props.prefKey, { codeMode: v })} />
            </div>
            <p>{tx("O claude que você abre no Terminal do projeto junta várias ações num pequeno script, em vez de fazer uma por vez: costuma ser mais rápido e gastar menos.")}</p>
            <Show
              when={tooOld()}
              fallback={<small class="agent-cm-note">{tx("Não muda este chat. Vale nos terminais abertos depois de ligar; na primeira vez o claude pede para confirmar.")}</small>}
            >
              <div class="agent-cm-warn">
                <span>{tx("Precisa do Claude Code {min} ou mais novo. O seu é o {v}.", { min: CODE_MODE_MIN, v: cliVersion() ?? "" })}</span>
                <button class="ghost-btn small" onClick={update}><SquareTerminal size={12} /> {tx("Atualizar no Terminal")}</button>
              </div>
            </Show>
          </div>
        </Show>
      </Show>
    </div>
  );
}
