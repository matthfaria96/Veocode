// Desenho dos terminais com xterm.js. Carrega só quando a aba Terminal aparece (o xterm é a
// maior biblioteca do app). Cada instância vive enquanto o terminal existir, mesmo trocando de
// projeto ou de tela: o elemento dela só é movido para dentro do painel quando ela aparece.

import { invoke } from "@tauri-apps/api/core";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { produce } from "solid-js/store";
import { api } from "./api";
import { showToast } from "./store";
import { errMsg, listTerms, openTermSized, setSink, setTerms, terms } from "./terminal";
import { tx } from "./i18n";

interface Live {
  id: string;
  xt: Terminal;
  fit: FitAddon;
  host: HTMLDivElement;
  opened: boolean;
}
const live = new Map<string, Live>();
/** saída de um terminal que ainda não tem desenho (aberto há pouco) */
const waiting = new Map<string, string[]>();

const theme = {
  background: "#0e1118",
  foreground: "#e7eaf3",
  cursor: "#6b9cff",
  cursorAccent: "#0e1118",
  selectionBackground: "#6b9cff55",
  black: "#1d2331",
  red: "#f87171",
  green: "#34d399",
  yellow: "#fbbf24",
  blue: "#60a5fa",
  magenta: "#a78bfa",
  cyan: "#22d3ee",
  white: "#a4acbf",
  brightBlack: "#6c7589",
  brightRed: "#fca5a5",
  brightGreen: "#6ee7b7",
  brightYellow: "#fde68a",
  brightBlue: "#93c5fd",
  brightMagenta: "#c4b5fd",
  brightCyan: "#67e8f9",
  brightWhite: "#e7eaf3",
};

/** Instância nova; `id` vazio até o Rust abrir o shell. */
function create(id = ""): Live {
  const mono = getComputedStyle(document.documentElement).getPropertyValue("--mono").trim() || tx("Menlo, monospace");
  const xt = new Terminal({ theme, fontFamily: mono, fontSize: 12.5, lineHeight: 1.2, cursorBlink: true, scrollback: 5000, macOptionIsMeta: true });
  const fit = new FitAddon();
  xt.loadAddon(fit);
  // links abrem no navegador (só http/https)
  xt.loadAddon(new WebLinksAddon((_e, url) => void api.openUrl(url).catch(() => {})));
  const host = document.createElement("div");
  host.className = "xterm-host";
  const l: Live = { id, xt, fit, host, opened: false };
  xt.onData((data) => l.id && void invoke("term_write", { id: l.id, data }).catch(() => {}));
  xt.onResize(({ cols, rows }) => l.id && void invoke("term_resize", { id: l.id, cols, rows }).catch(() => {}));
  if (id) live.set(id, l);
  return l;
}

function bind(l: Live, id: string) {
  l.id = id;
  live.set(id, l);
  const w = waiting.get(id);
  if (w) l.xt.write(w.join(""));
  waiting.delete(id);
}

function attach(l: Live, into: HTMLElement) {
  if (l.host.parentElement !== into) into.replaceChildren(l.host);
  if (!l.opened) {
    l.xt.open(l.host);
    l.opened = true;
  }
  try {
    l.fit.fit();
  } catch {
    /* painel escondido */
  }
}

setSink({
  write(id, data) {
    const l = live.get(id);
    if (l) return l.xt.write(data);
    // um serviço pode rodar horas sem ninguém olhar: fica só o fim
    const w = waiting.get(id) ?? [];
    w.push(data);
    waiting.set(id, w.length > 600 ? w.slice(-400) : w);
  },
  exit(id) {
    const service = Object.values(terms.byProject).some((l) => l.some((t) => t.id === id && t.service));
    live.get(id)?.xt.write(service ? tx("\r\n\u001b[90m[o serviço parou: reinicie pela aba Ambiente]\u001b[0m\r\n") : tx("\r\n\u001b[90m[o shell terminou: feche esta aba ou abra outra]\u001b[0m\r\n"));
  },
  dispose(id) {
    const l = live.get(id);
    l?.xt.dispose();
    l?.host.remove();
    live.delete(id);
    waiting.delete(id);
  },
});

/** Mede o terminal já dentro do painel e só então abre o shell, com esse tamanho. */
export async function openIn(pid: string, box: HTMLElement) {
  if (terms.opening) return;
  const l = create();
  attach(l, box);
  const t = await openTermSized(pid, l.xt.cols, l.xt.rows);
  if (!t) {
    l.xt.dispose();
    l.host.remove();
    return;
  }
  bind(l, t.id);
  l.xt.focus();
}

/** Terminais que já estão abertos no Rust (ao voltar para o projeto ou recarregar a tela). */
export async function loadExisting(pid: string) {
  try {
    const list = await listTerms(pid);
    for (const t of list) {
      if (live.has(t.id)) continue;
      const l = create(t.id);
      // o que o Rust guardou já inclui o que estava esperando aqui
      waiting.delete(t.id);
      l.xt.write(await invoke<string>("term_buffer", { id: t.id }).catch(() => ""));
    }
    setTerms(produce((s) => {
      s.byProject[pid] = list;
      s.loaded[pid] = true;
      if (!list.some((t) => t.id === s.active[pid])) s.active[pid] = list[0]?.id ?? "";
    }));
  } catch (e) {
    showToast(errMsg(e));
  }
}

/** Põe o terminal no painel, ajusta ao tamanho e redesenha (pode ter ficado fora da tela). */
export function mount(id: string, into: HTMLElement) {
  let l = live.get(id);
  if (!l) {
    // aberto fora do painel (um serviço): o que ele já mostrou estava esperando
    l = create(id);
    const w = waiting.get(id);
    if (w) l.xt.write(w.join(""));
    waiting.delete(id);
  }
  attach(l, into);
  l.xt.refresh(0, l.xt.rows - 1);
  l.xt.focus();
}

export function fitNow(id: string) {
  const l = live.get(id);
  if (!l?.opened || !l.host.isConnected || l.host.clientWidth < 40) return;
  try {
    l.fit.fit();
  } catch {
    /* painel escondido */
  }
}
