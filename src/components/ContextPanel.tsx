// Contexto da conversa: quanto da janela do Claude está ocupado, por quê, e o botão para
// compactar. Abre numa janela por cima de tudo, pelo selo na caixa de mensagem (ou pela paleta).
import { ChevronDown, Gauge, RefreshCw, Shrink, Sparkles } from "lucide-solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import { chatOf, compactChat } from "../chat";
import { compactLivre, LIVRE, livre } from "../livre";
import { continueFresh, fmtTokens, weightOf } from "../convTabs";
import { ctxColor, ctxName, ctxOf, ctxPanel, isBuffer, isDeferred, isFree, isStale, measure, toggleCtx, windowOf, type CtxGroup } from "../contextInfo";
import { niceModel } from "../chatPrefs";
import { closeModal } from "../modals";
import Modal, { ModalSection } from "./Modal";
import { dec, tx, txn } from "../i18n";
/** "141.3k" / "141,3 mil" — curto, com uma casa. */
export const kTok = (n: number) => (n >= 1_000_000 ? `${dec(n / 1_000_000)}M` : n >= 1000 ? `${dec(n / 1000)}k` : String(n));

/** Selo na caixa de mensagem: quanto a conversa carrega. Abre a janela do contexto. */
export function ContextChip(props: { k: string }) {
  // tamanho ao vivo (cada resposta) ou, antes da primeira, o da última medição
  const ctx = () => (props.k === LIVRE ? livre.context : chatOf(props.k).context) ?? ctxOf(props.k).data?.used ?? null;
  return (
    <button
      class={`composer-chip ctx-chip ${weightOf(ctx())}`}
      classList={{ on: ctxPanel() === props.k, bare: !ctx() }}
      aria-haspopup="dialog"
      title={ctx() ? tx("Contexto: esta conversa carrega {v} tokens. Cada mensagem manda tudo de novo para o Claude (com desconto de cache enquanto você está ativo). Clique para ver o que ocupa a janela e compactar.", { v: fmtTokens(ctx()!) }) : tx("Contexto da conversa: o que ocupa a janela do Claude")}
      onClick={() => toggleCtx(props.k)}
    >
      <Gauge size={13} />
      <Show when={ctx()}>
        <Show when={windowOf(props.k)} fallback={<span>{fmtTokens(ctx()!)}</span>}>{(w) => <span>{Math.min(100, Math.round((ctx()! / w()) * 100))}%</span>}</Show>
      </Show>
    </button>
  );
}

export function ContextPanel(props: { pid: string; k: string }) {
  const e = () => ctxOf(props.k);
  const d = () => e().data;
  const chat = () => chatOf(props.k);
  // o Chat livre guarda a conversa dele à parte (livre.ts)
  const isLivre = props.k === LIVRE;
  const started = () => (isLivre ? !!(livre.conv || livre.items.length) : !!chat().session);
  // a medição é da última vez; o tamanho da conversa (mensagens) atualiza a cada resposta
  const used = () => d()?.used ?? 0;
  const pct = () => (d() && d()!.total ? Math.min(100, (used() / d()!.total) * 100) : 0);
  const cats = createMemo(() => (d()?.categories ?? []).filter((c) => !isFree(c.name) && !isBuffer(c.name) && !isDeferred(c.name) && c.tokens > 0));
  const deferred = createMemo(() => (d()?.categories ?? []).filter((c) => isDeferred(c.name) && c.tokens > 0));
  const free = () => d()?.categories.find((c) => isFree(c.name));
  const buffer = () => d()?.categories.find((c) => isBuffer(c.name));
  const level = () => (pct() >= 80 ? "high" : pct() >= 55 ? "mid" : "low");
  const tone = () => (level() === "high" ? "var(--err)" : level() === "mid" ? "var(--warn)" : "var(--ok)");
  const busy = () => (isLivre ? livre.busy : chat().busy);

  return (
    <Modal
      icon={Gauge}
      tone={tone()}
      title={tx("Contexto da conversa")}
      sub={tx("Quanto da janela do Claude esta conversa ocupa. Cada mensagem manda tudo isso de novo.")}
      onClose={closeModal}
      aside={
        <>
          <Show when={d()?.model}><span class="modal-pill">{niceModel(d()!.model!)}</span></Show>
          <button class="icon-btn small" title={tx("Medir de novo")} disabled={e().loading} onClick={() => void measure(props.k)}>
            <RefreshCw size={13} class={e().loading ? "spin" : ""} />
          </button>
        </>
      }
      note={tx("Compactar resume a conversa até aqui e libera espaço. O Claude continua de onde parou, mas esquece os detalhes.")}
      actions={
        <>
          <Show when={!isLivre}>
            <button class="ghost-btn small" disabled={!started()} title={tx("Abre outra aba com um resumo desta já na caixa")} onClick={() => (closeModal(), continueFresh(props.pid, props.k))}>
              <Sparkles size={12} /> {tx("Nova com resumo")}
            </button>
          </Show>
          <button class="primary-btn small" disabled={busy() || !started()} title={!started() ? tx("A conversa ainda não começou") : busy() ? tx("Espere o Claude terminar") : ""} onClick={() => (closeModal(), void (isLivre ? compactLivre() : compactChat(props.k)))}>
            <Shrink size={12} /> {tx("Compactar conversa")}
          </button>
        </>
      }
    >
      <Show when={d()} fallback={
        <div class="modal-hero ctx-empty">
          <Show when={e().error} fallback={<><span class="spinner" /> {tx("Medindo a conversa… leva alguns segundos e não gasta tokens.")}</>}>
            <span class="ctx-err">{e().error}</span>
          </Show>
        </div>
      }>
        <div class="modal-hero ctx-hero">
          <div class="ctx-top">
            <span class={`ctx-pct ${level()}`}>{tx("{v}% usado", { v: Math.round(pct()) })}</span>
            <small>{kTok(used())} / {kTok(d()!.total)}</small>
            <Show when={e().loading}><span class="spinner" /></Show>
            <Show when={!e().loading && isStale(props.k)}><small class="ctx-old" title={tx("A conversa mudou depois da medição")}>{tx("desatualizado")}</small></Show>
          </div>
          <div class="ctx-bar" role="img" aria-label={tx("{v}% usado", { v: Math.round(pct()) })}>
            <For each={cats()}>{(c) => <i style={{ width: `${(c.tokens / d()!.total) * 100}%`, background: ctxColor(c.name) }} title={`${ctxName(c.name)} · ${kTok(c.tokens)}`} />}</For>
            <span class="ctx-bar-free" />
            <Show when={buffer()}>{(b) => <i class="ctx-bar-buf" style={{ width: `${(b().tokens / d()!.total) * 100}%` }} title={`${ctxName(b().name)} · ${kTok(b().tokens)}`} />}</Show>
          </div>
        </div>

        <ModalSection title={tx("O que ocupa a janela")} />
        <div class="ctx-cats">
          <For each={cats()}>
            {(c) => (
              <div class="ctx-cat">
                <i style={{ background: ctxColor(c.name) }} />
                <span>{ctxName(c.name)}</span>
                <b>{kTok(c.tokens)}</b>
                <small>{dec(c.pct)}%</small>
              </div>
            )}
          </For>
          <Show when={free()}>
            {(f) => (
              <div class="ctx-cat muted">
                <i class="ring" />
                <span>{ctxName(f().name)}</span>
                <b>{kTok(f().tokens)}</b>
                <small>{dec(f().pct)}%</small>
              </div>
            )}
          </Show>
          <Show when={buffer()}>
            {(b) => (
              <div class="ctx-cat muted" title={tx("Espaço que o Claude guarda para resumir a conversa sozinho quando ela encher.")}>
                <i class="hatch" />
                <span>{ctxName(b().name)}</span>
                <b>{kTok(b().tokens)}</b>
                <small>{dec(b().pct)}%</small>
              </div>
            )}
          </Show>
          <For each={deferred()}>
            {(c) => (
              <div class="ctx-cat muted" title={tx("Carregadas só quando o Claude usa: não ocupam a janela agora.")}>
                <i class="ring" />
                <span>{ctxName(c.name)}</span>
                <b>{kTok(c.tokens)}</b>
                <small>—</small>
              </div>
            )}
          </For>
        </div>

        <Show when={(d()?.groups.length ?? 0) > 0}>
          <ModalSection title={tx("Por dentro")} info={tx("clique para abrir")} />
          <div class="ctx-groups">
            <For each={d()!.groups}>{(g) => <CtxGroupRow g={g} />}</For>
          </div>
        </Show>
      </Show>
    </Modal>
  );
}

function CtxGroupRow(props: { g: CtxGroup }) {
  const [open, setOpen] = createSignal(false);
  const sum = () => props.g.items.reduce((n, i) => n + i.tokens, 0);
  const items = () => [...props.g.items].sort((a, b) => b.tokens - a.tokens);
  return (
    <div class="ctx-group" classList={{ open: open() }}>
      <button class="ctx-group-head" aria-expanded={open()} onClick={() => setOpen(!open())}>
        <ChevronDown size={12} class="ctx-chev" />
        <span>{ctxName(props.g.title)}</span>
        <small>{txn(props.g.items.length, "{n} item", "{n} itens")}</small>
        <b>{kTok(sum())}</b>
      </button>
      <Show when={open()}>
        <div class="ctx-items">
          <For each={items()}>
            {(i) => (
              <div class="ctx-item" title={i.name}>
                <span>{i.name.replace(/^mcp__/, "")}</span>
                <Show when={i.source}><small>{i.source}</small></Show>
                <b>{i.label}</b>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
