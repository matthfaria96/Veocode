// Painel do contexto da conversa: quanto da janela do Claude está ocupado, por quê, e o botão
// para compactar. Abre pelo medidor na barra das conversas (ou pela paleta de comandos).
import { ChevronDown, Gauge, RefreshCw, Shrink, Sparkles, X } from "lucide-solid";
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { chatOf, compactChat } from "../chat";
import { continueFresh } from "../convTabs";
import { ctxColor, ctxName, ctxOf, isBuffer, isDeferred, isFree, isStale, measure, setCtxPanel, type CtxGroup } from "../contextInfo";
import { niceModel } from "../chatPrefs";
import { dec, tx, txn } from "../i18n";

/** "141.3k" / "141,3 mil" — curto, com uma casa. */
export const kTok = (n: number) => (n >= 1_000_000 ? `${dec(n / 1_000_000)}M` : n >= 1000 ? `${dec(n / 1000)}k` : String(n));

export function ContextPanel(props: { pid: string; k: string }) {
  let el!: HTMLDivElement;
  const e = () => ctxOf(props.k);
  const d = () => e().data;
  const chat = () => chatOf(props.k);
  // a medição é da última vez; o tamanho da conversa (mensagens) atualiza a cada resposta
  const used = () => d()?.used ?? 0;
  const pct = () => (d() && d()!.total ? Math.min(100, (used() / d()!.total) * 100) : 0);
  const cats = createMemo(() => (d()?.categories ?? []).filter((c) => !isFree(c.name) && !isBuffer(c.name) && !isDeferred(c.name) && c.tokens > 0));
  const deferred = createMemo(() => (d()?.categories ?? []).filter((c) => isDeferred(c.name) && c.tokens > 0));
  const free = () => d()?.categories.find((c) => isFree(c.name));
  const buffer = () => d()?.categories.find((c) => isBuffer(c.name));
  const level = () => (pct() >= 80 ? "high" : pct() >= 55 ? "mid" : "low");
  const busy = () => chat().busy;

  const close = () => setCtxPanel(null);
  onMount(() => {
    const down = (ev: MouseEvent) => {
      const t = ev.target as HTMLElement;
      if (!el.contains(t) && !t.closest(".conv-ctx")) close();
    };
    const key = (ev: KeyboardEvent) => ev.key === "Escape" && close();
    setTimeout(() => window.addEventListener("mousedown", down), 0);
    window.addEventListener("keydown", key);
    onCleanup(() => (window.removeEventListener("mousedown", down), window.removeEventListener("keydown", key)));
  });

  return (
    <div class="ctx-panel pop-in" ref={el} role="dialog" aria-label={tx("Contexto da conversa")}>
      <div class="ctx-head">
        <Gauge size={14} />
        <b>{tx("Contexto")}</b>
        <Show when={d()?.model}><small class="ctx-model">{niceModel(d()!.model!)}</small></Show>
        <span class="ctx-sp" />
        <button class="icon-btn small" title={tx("Medir de novo")} disabled={e().loading} onClick={() => void measure(props.k)}>
          <RefreshCw size={12} class={e().loading ? "spin" : ""} />
        </button>
        <button class="icon-btn small" title={tx("Fechar")} onClick={close}><X size={12} /></button>
      </div>

      <Show when={d()} fallback={
        <div class="ctx-empty">
          <Show when={e().error} fallback={<><span class="spinner" /> {tx("Medindo a conversa… leva alguns segundos e não gasta tokens.")}</>}>
            <span class="ctx-err">{e().error}</span>
          </Show>
        </div>
      }>
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
          <div class="ctx-groups">
            <For each={d()!.groups}>{(g) => <CtxGroupRow g={g} />}</For>
          </div>
        </Show>
      </Show>

      <div class="ctx-actions">
        <p>{tx("Compactar resume a conversa até aqui e libera espaço. O Claude continua de onde parou, mas esquece os detalhes.")}</p>
        <div class="ctx-btns">
          <button class="primary-btn small" disabled={busy() || !chat().session} title={!chat().session ? tx("A conversa ainda não começou") : busy() ? tx("Espere o Claude terminar") : ""} onClick={() => (close(), void compactChat(props.k))}>
            <Shrink size={12} /> {tx("Compactar conversa")}
          </button>
          <button class="ghost-btn small" disabled={!chat().session} title={tx("Abre outra aba com um resumo desta já na caixa")} onClick={() => (close(), continueFresh(props.pid, props.k))}>
            <Sparkles size={12} /> {tx("Nova com resumo")}
          </button>
        </div>
      </div>
    </div>
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
