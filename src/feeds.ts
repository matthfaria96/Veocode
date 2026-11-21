// A conversa de cada projeto, guardada separada, para a tela Início mostrar vários ao mesmo tempo
// com o mesmo detalhe da tela do projeto. Cada evento diz de qual conversa é (a aba do Veocode,
// ou a sessão do Claude), então cada coluna mostra uma conversa por vez e as que rodam fora do
// Veocode (Terminal, editor, app do Claude) aparecem separadas.
// A tela Projetos continua com a dela (store.ws, só do projeto aberto, com cursores e marcas).
//
// De onde vem:
// - Claude: o histórico que ele grava (agent_poll no canal "board", com a própria posição
//   no arquivo, sem tirar eventos da tela Projetos) e, para a resposta aparecer sem esperar o
//   histórico, o evento "say" do chat do Veocode;
// - conversa aberta inteira (pela lista, ao acordar uma aba, num ramo): chat.ts manda para cá;
// - DeepSeek/OpenAI/Ollama: os eventos do chat (pedido, passos, resposta) e, ao abrir, a
//   conversa guardada no Rust.

import { invoke } from "@tauri-apps/api/core";
import { batch } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { accountById } from "./accounts";
import type { AgentEvent } from "./agentFeed";
import { isTauri } from "./api";
import { projects, type ActivityEvent } from "./store";
import { hidden } from "./every";
import { markStopped } from "./outside";
import { copiedFromParent } from "./forks";
import { locale, tx } from "./i18n";

interface Feed {
  items: ActivityEvent[];
  loaded: boolean;
  /** último sinal de vida do agente (ms): passo, resposta ou pedido */
  activeAt: number;
}

/** Conversas inteiras cabem (a tela Projetos guarda até 4000). */
const MAX = 4000;
export const [feeds, setFeeds] = createStore<Record<string, Feed>>({});
const EMPTY: Feed = { items: [], loaded: false, activeAt: 0 };
export const feedOf = (pid: string): Feed => feeds[pid] ?? EMPTY;

const ensure = (pid: string) => {
  if (!feeds[pid]) setFeeds(pid, { items: [], loaded: false, activeAt: 0 });
};

const baseOf = (key: string) => key.split("~")[0];
const projectOf = (pid: string) => projects.find((p) => p.id === pid);
const accountOf = (pid: string) => accountById(projectOf(pid)?.accountId ?? "");
const isClaude = (pid: string) => accountOf(pid).provider === "claude";

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
/** A mesma fala já está no fim do feed (chegou antes pelo outro caminho). */
const justSaid = (pid: string, text: string) => feedOf(pid).items.slice(-8).some((x) => x.kind === "say" && norm(x.title) === norm(text));

// ---------------------------------------------------------------- guardar

let seq = 1_000_000_000; // não cruza com os ids da tela Projetos
const clock = (ts: number) => new Date(ts).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", second: "2-digit" });

type NewEvent = Omit<ActivityEvent, "id" | "time" | "ts"> & { ts: number };
function push(pid: string, e: NewEvent): number {
  ensure(pid);
  const id = ++seq;
  const ev: ActivityEvent = { ...e, id, time: clock(e.ts) };
  setFeeds(pid, produce((f) => {
    f.items.push(ev);
    if (f.items.length > MAX) f.items.splice(0, f.items.length - MAX);
    f.activeAt = Math.max(f.activeAt, e.ts);
  }));
  return id;
}
const patchEvent = (pid: string, id: number, p: Partial<ActivityEvent>) => setFeeds(pid, "items", (x) => x.id === id, p);

/** id do passo no Claude → id aqui (o resultado chega depois com o mesmo id) */
const ids = new Map<string, number>();
/** Sessões abertas inteiras numa aba: o fim delas que o histórico traz já está aqui. */
const whole = new Set<string>();
export const loadedWhole = (session: string) => whole.has(session);

const kindOf: Partial<Record<AgentEvent["kind"], ActivityEvent["kind"]>> = {
  read: "read", search: "search", edit: "edit", create: "create", run: "run", web: "web", tool: "tool", swarm: "swarm", plan: "plan",
};

// ---------------------------------------------------------------- entradas

/** Um evento do histórico do Claude (ou do chat das APIs, já marcado com a aba). */
function fromAgent(pid: string, e: AgentEvent) {
  const ts = e.ts ? (e.ts > 1e12 ? e.ts : e.ts * 1000) : Date.now();
  // ramo novo: o leitor de fundo repete as mensagens copiadas da original
  if (!e.tab && copiedFromParent(e.session, e.ts)) return;
  // o fim de uma sessão que já foi aberta inteira numa aba
  if (!e.tab && e.history && e.session && whole.has(e.session)) return;
  const acc = accountById(e.account || projectOf(pid)?.accountId || "");
  const sub = e.sub ? (e.subLabel ?? tx("subagente")) : null;
  const who = sub ? `${acc.label} · ${sub}` : acc.label;
  const tag = { session: e.session || undefined, tab: e.tab, sub: e.sub ?? undefined, subLabel: sub ?? undefined };
  switch (e.kind) {
    case "think":
      return;
    case "stop":
      markStopped(e.session, e.ts);
      return;
    case "result": {
      const id = ids.get(`${pid}:${e.id}`);
      const old = id !== undefined ? feedOf(pid).items.find((x) => x.id === id) : undefined;
      if (!old) return;
      const created = e.title === "create";
      patchEvent(pid, old.id, {
        status: e.status === "error" ? "error" : "ok",
        // a lista de tarefas chega no pedido; o resultado dela não traz nada melhor
        detail: old.kind === "plan" ? old.detail : (e.detail ?? old.detail),
        kind: created ? "create" : old.kind,
        title: created ? old.title.replace(/^Escrevendo/, "Criando") : old.title,
      });
      setFeeds(pid, "activeAt", (t) => Math.max(t, ts));
      return;
    }
    case "compact": {
      // a compactação feita por aqui já está na tela (chegou pelo chat)
      if (!e.history && feedOf(pid).items.slice(-12).some((x) => x.kind === "compact" && x.tab && ts - (x.ts ?? 0) < 5 * 60_000)) return;
      push(pid, { ...tag, kind: "compact", title: e.title === "auto" ? tx("Compactada automaticamente") : tx("Conversa compactada"), detail: e.detail ?? undefined, agent: who, color: acc.color, status: "ok", ts });
      return;
    }
    case "user":
      if (!e.tab && seenBefore(pid, "user", e.title, false)) return;
      push(pid, { ...tag, kind: "user", title: e.title, agent: "Você", status: "ok", ts, anchor: e.anchor });
      return;
    case "say":
      if (!e.tab && (seenBefore(pid, "say", e.title, false) || justSaid(pid, e.title))) return;
      push(pid, { ...tag, kind: "say", title: e.title, agent: who, color: acc.color, status: "ok", ts });
      return;
    case "done":
      push(pid, { ...tag, kind: "done", title: tx("Terminou"), agent: who, color: acc.color, status: e.status === "error" ? "error" : "ok", ts });
      return;
    default: {
      const id = push(pid, { ...tag, kind: kindOf[e.kind] ?? "tool", title: e.title, detail: e.detail ?? undefined, agent: who, color: acc.color, status: e.status === "running" ? "running" : "ok", path: e.path ?? undefined, ts });
      ids.set(`${pid}:${e.id}`, id);
    }
  }
}

/** Chamado pelo chat.ts para cada evento do chat de uma conversa (`key`: "projeto" ou "projeto~aba"). */
export function feedChat(key: string, e: { kind: string; text?: string; event?: AgentEvent; ok?: boolean; detail?: string | null; state?: string }) {
  const pid = baseOf(key);
  if (!feeds[pid]) return; // projeto que o Início nunca abriu: carrega o histórico quando abrir
  const claude = isClaude(pid);
  const acc = accountOf(pid);
  switch (e.kind) {
    case "say":
      if (!e.text || seenBefore(pid, "say", e.text, false) || justSaid(pid, e.text)) return;
      // o histórico do Claude vai trazer a mesma fala: marca para não repetir
      if (claude) seenBefore(pid, "say", e.text, true);
      push(pid, { kind: "say", title: e.text, agent: acc.label, color: acc.color, status: "ok", tab: key, ts: Date.now() });
      return;
    case "step":
      if (e.event && !claude) fromAgent(pid, { ...e.event, tab: key });
      return;
    case "done":
      // o Claude registra o "Terminou" no histórico; para as APIs (e quando parou), aqui
      if (!claude || !e.ok) push(pid, { kind: "done", title: e.ok ? tx("Terminou") : tx("Parou"), detail: e.detail ?? undefined, agent: acc.label, color: acc.color, status: e.ok ? "ok" : "error", tab: key, ts: Date.now() });
      return;
    case "compact": {
      const last = [...feedOf(pid).items].reverse().find((x) => x.kind === "compact" && x.tab === key && x.status === "running");
      if (e.state === "running") {
        if (!last) push(pid, { kind: "compact", title: tx("Compactando a conversa…"), agent: acc.label, color: acc.color, status: "running", tab: key, ts: Date.now() });
        return;
      }
      const done = e.state === "done";
      const p = { status: done ? "ok" : "error", title: done ? tx("Conversa compactada") : tx("Não deu para compactar"), detail: e.detail ?? undefined } as const;
      if (last) patchEvent(pid, last.id, p);
      else push(pid, { kind: "compact", agent: acc.label, color: acc.color, tab: key, ts: Date.now(), ...p });
      return;
    }
  }
}

/** O pedido que a pessoa mandou (aparece na hora; o do histórico do Claude não repete). Devolve o id. */
export function feedUser(key: string, text: string): number {
  const pid = baseOf(key);
  if (!feeds[pid]) return 0;
  if (isClaude(pid)) seenBefore(pid, "user", text, true);
  return push(pid, { kind: "user", title: text, agent: "Você", status: "ok", tab: key, ts: Date.now() });
}

/** De onde o pedido recomeça se for editado (chega depois que o Claude recebe o pedido). */
export function feedAnchor(key: string, id: number, anchor: string) {
  if (id) patchEvent(baseOf(key), id, { anchor });
}

/**
 * Conversa aberta inteira numa aba (pela lista, ao acordar a aba, num ramo): o que estava aqui
 * dela (`mine`) dá lugar ao histórico completo, marcado com a aba.
 */
export function feedConv(key: string, evs: AgentEvent[], mine: (e: ActivityEvent) => boolean, session?: string) {
  const pid = baseOf(key);
  if (!feeds[pid]) return;
  batch(() => {
    setFeeds(pid, "items", (l) => l.filter((e) => !mine(e)));
    if (session) whole.add(session);
    for (const e of evs) fromAgent(pid, { ...e, tab: key });
  });
}

/** Tira do feed os eventos de uma conversa (nova conversa na aba, ou editar um pedido: `from` em diante). */
export function feedDrop(key: string, mine: (e: ActivityEvent) => boolean, from?: number) {
  const pid = baseOf(key);
  const f = feeds[pid];
  if (!f) return;
  const idx = from === undefined ? 0 : f.items.findIndex((x) => x.id === from);
  if (idx < 0) return;
  setFeeds(pid, "items", (l) => l.filter((e, i) => i < idx || !mine(e)));
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
      const acc = accountOf(pid);
      batch(() => {
        for (const m of msgs) {
          const user = m.role === "user";
          const title = user ? m.content.replace(/\n\nArquivo `([^`]+)`[^\n]*:\n```[\s\S]*$/, "\n📎 $1") : m.content;
          // a conversa guardada é a da aba principal do projeto
          push(pid, { kind: user ? "user" : "say", title, agent: user ? "Você" : acc.label, color: user ? undefined : acc.color, status: "ok", tab: pid, ts: 0 });
        }
      });
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
    if (!isTauri) {
      ensure(pid);
      if (!feeds[pid].loaded) setFeeds(pid, "loaded", true);
      continue;
    }
    if (now - (lastPoll.get(pid) ?? 0) < every || !isClaude(pid)) continue;
    lastPoll.set(pid, now);
    const reset = !lastPoll.has(`${pid}#started`);
    lastPoll.set(`${pid}#started`, now);
    jobs.push(
      invoke<AgentEvent[]>("agent_poll", { projectId: pid, reset, channel: "board" })
        .then((evs) => {
          batch(() => {
            for (const e of evs) fromAgent(pid, e);
          });
          if (reset) setFeeds(pid, "loaded", true);
        })
        .catch(() => {
          if (reset) setFeeds(pid, "loaded", true);
        }),
    );
  }
  await Promise.all(jobs);
  timer = window.setTimeout(tick, hidden() ? 2000 : 450);
}

/** Projeto removido: esquece a conversa guardada aqui. */
export function forgetFeed(pid: string) {
  setFeeds(produce((f) => delete f[pid]));
  first.delete(pid);
  lastPoll.delete(pid);
  lastPoll.delete(`${pid}#started`);
}
