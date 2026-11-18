// Markdown simples para as respostas das IAs: parágrafos, títulos, listas, citações, blocos de
// código e, no meio do texto, `código`, **negrito**, *itálico* e [links](url). Monta os
// elementos direto (sem innerHTML): nada do texto vira HTML de verdade.

import { For, Match, Switch, type JSX } from "solid-js";
import { api } from "../api";

type Block =
  | { t: "p"; text: string }
  | { t: "h"; level: number; text: string }
  | { t: "ul" | "ol"; items: string[]; start: number }
  | { t: "code"; lang: string; text: string }
  | { t: "quote"; text: string }
  | { t: "hr" };

export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ t: "p", text: para.join("\n") });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const fence = l.match(/^\s*```\s*([\w+-]*)/);
    if (fence) {
      flush();
      const body: string[] = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i]);
      out.push({ t: "code", lang: fence[1], text: body.join("\n") });
      continue;
    }
    if (!l.trim()) {
      flush();
      continue;
    }
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flush();
      out.push({ t: "h", level: h[1].length, text: h[2] });
      continue;
    }
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(l)) {
      flush();
      out.push({ t: "hr" });
      continue;
    }
    const li = l.match(/^\s*([-*+]|(\d+)[.)])\s+(.*)$/);
    if (li) {
      flush();
      const t = li[2] ? "ol" : "ul";
      const last = out[out.length - 1];
      if (last && last.t === t) last.items.push(li[3]);
      else out.push({ t, items: [li[3]], start: li[2] ? Number(li[2]) : 1 });
      continue;
    }
    const q = l.match(/^\s*>\s?(.*)$/);
    if (q) {
      flush();
      const last = out[out.length - 1];
      if (last?.t === "quote") last.text += `\n${q[1]}`;
      else out.push({ t: "quote", text: q[1] });
      continue;
    }
    // linha recuada logo depois de um item de lista: continuação do item
    const last = out[out.length - 1];
    if (!para.length && /^\s{2,}\S/.test(l) && last && (last.t === "ul" || last.t === "ol")) {
      last.items[last.items.length - 1] += ` ${l.trim()}`;
      continue;
    }
    para.push(l);
  }
  flush();
  return out;
}

const openLink = (e: MouseEvent, url: string) => {
  e.preventDefault();
  if (/^https?:\/\//i.test(url)) api.openUrl(url).catch(() => {});
};

/** Trechos de uma linha: código, negrito, itálico e links. */
export function Inline(props: { text: string }): JSX.Element {
  const parts = () => {
    const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[[^\]\n]+\]\([^)\s]+\))|(\*[^*\s][^*\n]*\*)/g;
    const out: JSX.Element[] = [];
    let at = 0;
    for (const m of props.text.matchAll(re)) {
      if (m.index! > at) out.push(props.text.slice(at, m.index));
      const s = m[0];
      if (m[1]) out.push(<code>{s.slice(1, -1)}</code>);
      else if (m[2]) out.push(<strong>{s.slice(2, -2)}</strong>);
      else if (m[3]) {
        const [, label, url] = s.match(/^\[([^\]]+)\]\(([^)]+)\)$/)!;
        out.push(<a href={url} title={url} onClick={(e) => openLink(e, url)}>{label}</a>);
      } else out.push(<em>{s.slice(1, -1)}</em>);
      at = m.index! + s.length;
    }
    if (at < props.text.length) out.push(props.text.slice(at));
    return out;
  };
  return <>{parts()}</>;
}

export default function Markdown(props: { text: string }) {
  const blocks = () => parseBlocks(props.text);
  return (
    <div class="md">
      <For each={blocks()}>
        {(b) => (
          <Switch>
            <Match when={b.t === "p" && b}>{(p) => <p><Inline text={p().text} /></p>}</Match>
            <Match when={b.t === "h" && b}>{(h) => <p class={`md-h md-h${h().level}`}><Inline text={h().text} /></p>}</Match>
            <Match when={b.t === "ul" && b}>{(l) => <ul><For each={l().items}>{(it) => <li><Inline text={it} /></li>}</For></ul>}</Match>
            <Match when={b.t === "ol" && b}>{(l) => <ol start={l().start}><For each={l().items}>{(it) => <li><Inline text={it} /></li>}</For></ol>}</Match>
            <Match when={b.t === "quote" && b}>{(q) => <blockquote><Inline text={q().text} /></blockquote>}</Match>
            <Match when={b.t === "code" && b}>
              {(c) => (
                <div class="md-code">
                  <span class="md-lang">{c().lang || "código"}</span>
                  <pre>{c().text}</pre>
                </div>
              )}
            </Match>
            <Match when={b.t === "hr"}><hr /></Match>
          </Switch>
        )}
      </For>
    </div>
  );
}
