// A conversa de cada projeto, guardada separada, para o Painel mostrar vários ao mesmo tempo.
// A tela Projetos continua com a dela (store.ws, só do projeto aberto); aqui ficam os pedidos,
// as respostas e os passos de todos os projetos que o Painel está olhando.
//
// De onde vem:
// - Claude: o histórico que ele grava (agent_poll no canal "board", com a própria posição
//   no arquivo, sem tirar eventos da tela Projetos) e, para a resposta aparecer sem esperar o
//   histórico, o evento "say" do chat do Veocode;
// - DeepSeek/OpenAI/Ollama: os eventos do chat (pedido, passos, resposta) e, ao abrir, a
//   conversa guardada no Rust.

import { invoke } from "@tauri-apps/api/core";
import { createStore, produce } from "solid-js/store";
import { accountById } from "./accounts";
import type { AgentEvent } from "./agentFeed";
import { isTauri } from "./api";
import { projects } from "./store";

export interface FeedItem {
  id: string;
  kind: "user" | "say" | "step" | "done" | "error";
  /** tipo do passo (ler, editar, rodar…) */
  step?: AgentEvent["kind"];
  title: string;
  detail?: string | null;
  status: "running" | "ok" | "error";
  ts: number;
  /** subagente que fez o passo */
  sub?: string | null;
}

interface Feed {
  items: FeedItem[];
  loaded: boolean;
  /** último sinal de vida do agente (ms): passo, resposta ou pedido */
  activeAt: number;
}

const MAX = 300;
export const [feeds, setFeeds] = createStore<Record<string, Feed>>({});
export const feedOf = (pid: string): Feed => feeds[pid] ?? { items: [], loaded: false, activeAt: 0 };

const ensure = (pid: string) => {
  if (!feeds[pid]) setFeeds(pid, { items: [], loaded: false, activeAt: 0 });
};

const isClaude = (pid: string) => accountById(projects.find((p) => p.id === pid)?.accountId ?? "").provider === "claude";

// ---------------------------------------------------------------- não repetir

// a mesma fala chega pelo chat (na hora) e pelo histórico do Claude (logo depois)
const norm = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 120);
const recent = new Map<string, { text: string; at: number }[]>();
function seenBefore(pid: string, kind: string, text: string, mark: boolean): boolean {
  const k = `${pid}:${kind}`;
  const n = norm(text);
  const list = (recent.get(k) ?? []).filter((x) => Date.now() - x.at < 15 * 60_000);
  const i = list.findIndex((x) => x.text === n);
  if (i >= 0) {
    list.splice(i, 1);
    recent.set(k, list);
    return true;
  }
  if (mark) list.push({ text: n, at: Date.now() });
  recent.set(k, list);
  return false;
}

function push(pid: string, it: FeedItem) {
  ensure(pid);
  setFeeds(pid, produce((f) => {
    const i = f.items.findIndex((x) => x.id === it.id);
    if (i >= 0) f.items[i] = it;
    else {
      f.items.push(it);
      if (f.items.length > MAX) f.items.splice(0, f.items.length - MAX);
    }
    f.activeAt = Math.max(f.activeAt, it.ts || Date.now());
  }));
}

let seq = 0;
const localId = () => `v${++seq}`;

// ---------------------------------------------------------------- entradas

/** Passo lido do histórico do Claude (ou vindo do chat das APIs). */
function fromAgent(pid: string, e: AgentEvent) {
  const ts = e.ts ? (e.ts > 1e12 ? e.ts : e.ts * 1000) : Date.now();
  switch (e.kind) {
    case "think":
      return;
    case "user":
      if (seenBefore(pid, "user", e.title, false)) return;
      return push(pid, { id: e.id, kind: "user", title: e.title, status: "ok", ts });
    case "say":
      if (seenBefore(pid, "say", e.title, false)) return;
      return push(pid, { id: e.id, kind: "say", title: e.title, status: "ok", ts, sub: e.subLabel });
    case "result": {
      // o resultado de uma ferramenta tem o mesmo id do passo: só fecha o passo
      const i = feedOf(pid).items.findIndex((x) => x.id === e.id);
      if (i < 0) return;
      setFeeds(pid, "items", i, (old) => ({ ...old, status: e.status === "error" ? "error" : "ok", detail: e.detail ?? old.detail }));
      setFeeds(pid, "activeAt", (t) => Math.max(t, ts));
      return;
    }
    case "done":
      return push(pid, { id: e.id, kind: "done", title: e.title || "Terminou", detail: e.detail, status: e.status, ts });
    default:
      return push(pid, { id: e.id, kind: "step", step: e.kind, title: e.title, detail: e.detail, status: e.status, ts, sub: e.sub ? (e.subLabel ?? "subagente") : null });
  }
}

/** Chamado pelo chat.ts para cada evento do chat de um projeto. */
export function feedChat(pid: string, e: { kind: string; text?: string; event?: AgentEvent; ok?: boolean; detail?: string | null; message?: string }) {
  if (!feeds[pid]) return; // projeto que o Painel nunca abriu: carrega o histórico quando abrir
  const claude = isClaude(pid);
  switch (e.kind) {
    case "say":
      if (!e.text || seenBefore(pid, "say", e.text, false)) return;
      // o histórico do Claude vai trazer a mesma fala: marca para não repetir
      if (claude) seenBefore(pid, "say", e.text, true);
      return push(pid, { id: localId(), kind: "say", title: e.text, status: "ok", ts: Date.now() });
    case "step":
      if (e.event && !claude) fromAgent(pid, e.event);
      return;
    case "done":
      if (!claude || !e.ok) push(pid, { id: localId(), kind: "done", title: e.ok ? "Terminou" : "Parou", detail: e.detail, status: e.ok ? "ok" : "error", ts: Date.now() });
      return;
    case "error":
      return push(pid, { id: localId(), kind: "error", title: e.message ?? "Erro", status: "error", ts: Date.now() });
  }
}

/** O pedido que a pessoa mandou (aparece na hora; o do histórico do Claude não repete). */
export function feedUser(pid: string, text: string) {
  if (!feeds[pid]) return;
  if (isClaude(pid)) seenBefore(pid, "user", text, true);
  push(pid, { id: localId(), kind: "user", title: text, status: "ok", ts: Date.now() });
}

// ---------------------------------------------------------------- leitura contínua

/** Projetos olhados agora, por quem: a grade (rápido) e a lista (devagar). */
const watchers = new Map<string, { pids: string[]; every: number }>();
const lastPoll = new Map<string, number>();
const first = new Set<string>();
let timer: number | undefined;

/** Começa (ou troca) a leitura de um grupo de projetos; devolve a função que para. */
export function watchFeeds(who: string, pids: string[], every: number): () => void {
  watchers.set(who, { pids, every });
  for (const p of pids) void load(p);
  if (!timer) tick();
  return () => {
    watchers.delete(who);
  };
}

/** Primeira vez: o fim da conversa (Claude: últimos passos de 24 h; API: a conversa guardada). */
async function load(pid: string) {
  if (first.has(pid) || !isTauri) return;
  first.add(pid);
  ensure(pid);
  if (!isClaude(pid)) {
    try {
      const [msgs] = await invoke<[{ role: string; content: string }[], boolean]>("chat_history", { projectId: pid });
      for (const m of msgs) {
        const title = m.role === "user" ? m.content.replace(/\n\nArquivo `([^`]+)`[^\n]*:\n```[\s\S]*$/, "\n📎 $1") : m.content;
        push(pid, { id: localId(), kind: m.role === "user" ? "user" : "say", title, status: "ok", ts: 0 });
      }
    } catch {
      /* sem conversa guardada */
    }
  }
  setFeeds(pid, "loaded", true);
}

async function tick() {
  const now = Date.now();
  const due = new Map<string, number>();
  for (const w of watchers.values()) for (const p of w.pids) due.set(p, Math.min(due.get(p) ?? Infinity, w.every));
  if (!due.size) {
    timer = undefined;
    return;
  }
  const jobs: Promise<void>[] = [];
  for (const [pid, every] of due) {
    if (now - (lastPoll.get(pid) ?? 0) < every || !isClaude(pid) || !isTauri) continue;
    lastPoll.set(pid, now);
    const reset = !lastPoll.has(`${pid}#started`);
    lastPoll.set(`${pid}#started`, now);
    jobs.push(
      invoke<AgentEvent[]>("agent_poll", { projectId: pid, reset, channel: "board" })
        .then((evs) => {
          for (const e of evs) fromAgent(pid, e);
          if (reset) setFeeds(pid, "loaded", true);
        })
        .catch(() => {
          if (reset) setFeeds(pid, "loaded", true);
        }),
    );
  }
  await Promise.all(jobs);
  timer = window.setTimeout(tick, 450);
}

/** Projeto removido: esquece a conversa guardada aqui. */
export function forgetFeed(pid: string) {
  setFeeds(produce((f) => delete f[pid]));
  first.delete(pid);
  lastPoll.delete(pid);
  lastPoll.delete(`${pid}#started`);
}
