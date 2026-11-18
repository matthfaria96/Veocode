// Chat dentro do Veocode. O Rust (src-tauri/src/chat.rs) roda o Claude Code sem terminal
// (ou conversa com DeepSeek / OpenAI-compatível / Ollama) e manda os pedaços por "chat-event".
// Os passos do Claude (ler, editar, comandos) chegam pelo histórico dele (agentFeed.ts);
// aqui ficam o texto sendo escrito, os pedidos de permissão e o estado da conversa.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createStore, produce } from "solid-js/store";
import { accountById } from "./accounts";
import { isTauri } from "./api";
import { feedAgentEvent, setSeenAgent, type AgentEvent } from "./agentFeed";
import { absPathOf, projectId, projects, pushEvent, setWs, showToast, ws } from "./store";
import { handleLivre, LIVRE } from "./livre";
import { feedChat, feedUser } from "./feeds";

export interface PermissionAsk {
  requestId: string;
  tool: string;
  title: string;
  detail: string | null;
  path: string | null;
  answering?: boolean;
}

interface ProjectChat {
  busy: boolean;
  /** texto chegando aos poucos */
  draft: string;
  perms: PermissionAsk[];
  error: string | null;
  /** o que está escrito na caixa (sobrevive à troca de projeto) */
  input: string;
  /** anexar o arquivo aberto */
  attach: boolean;
  /** conversa retomada pela lista (null: a que começou neste chat, ou nenhuma) */
  conv: { kind: "claude" | "api"; id: string; title: string } | null;
}

/** Conversa anterior do projeto (sessão do Claude ou conversa com API guardada pelo Veocode). */
export interface Convo {
  id: string;
  kind: "claude" | "api";
  account: string;
  title: string;
  lastPrompt: string | null;
  origin: string | null;
  updated: number;
  bytes: number;
}

type ChatEvent =
  | { kind: "session"; sessionId: string }
  | { kind: "delta"; text: string }
  | { kind: "say"; key: string; text: string }
  | ({ kind: "permission" } & PermissionAsk)
  | { kind: "permissionGone"; requestId: string }
  | { kind: "done"; ok: boolean; detail: string | null }
  | { kind: "step"; event: AgentEvent }
  | { kind: "error"; message: string };

const blank = (): ProjectChat => ({ busy: false, draft: "", perms: [], error: null, input: "", attach: false, conv: null });
export const [chats, setChats] = createStore<Record<string, ProjectChat>>({});

export const chatOf = (pid: string): ProjectChat => chats[pid] ?? blank();
const ensure = (pid: string) => {
  if (!chats[pid]) setChats(pid, blank());
};

const projectOf = (pid: string) => projects.find((p) => p.id === pid);
const accountOf = (pid: string) => accountById(projectOf(pid)?.accountId ?? "");
export const isClaudeChat = (pid: string) => accountOf(pid).provider === "claude";

// ---------------------------------------------------------------- não repetir o que o histórico traz de novo

// o Claude grava no histórico o mesmo pedido e as mesmas respostas que já mostramos daqui
const echoes: { text: string; at: number }[] = [];
const sayKeys = new Set<string>();
const norm = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 80);

/** Para o agentFeed: esse pedido/resposta já está na tela? (consome a marca) */
export function alreadyShown(kind: "user" | "say", id: string, text: string) {
  if (kind === "say" && sayKeys.delete(id)) return true;
  const n = norm(text);
  const i = echoes.findIndex((e) => Date.now() - e.at < 10 * 60_000 && e.text.length > 0 && n.startsWith(e.text));
  if (i < 0) return false;
  echoes.splice(i, 1);
  return true;
}

// ---------------------------------------------------------------- eventos do Rust

let listening = false;
export function startChatEvents() {
  if (!isTauri || listening) return;
  listening = true;
  listen<{ projectId: string } & ChatEvent>("chat-event", ({ payload: e }) => (e.projectId === LIVRE ? handleLivre(e) : handle(e.projectId, e)));
}

function handle(pid: string, e: ChatEvent) {
  ensure(pid);
  feedChat(pid, e as Parameters<typeof feedChat>[1]); // conversa guardada para o Painel
  const here = projectId() === pid;
  const acc = accountOf(pid);
  switch (e.kind) {
    case "session":
      return;
    case "delta":
      setChats(pid, "draft", (d) => d + e.text);
      return;
    case "say":
      setChats(pid, "draft", "");
      sayKeys.add(e.key);
      echoes.push({ text: norm(e.text), at: Date.now() });
      // o histórico pode ter chegado antes com o mesmo texto
      if (here && !ws.events.slice(-6).some((x) => x.kind === "say" && norm(x.title) === norm(e.text))) {
        pushEvent({ kind: "say", title: e.text, agent: acc.label, color: acc.color, status: "ok" });
      }
      return;
    case "permission": {
      // caminhos dentro do projeto aparecem relativos
      // (no Windows o caminho vem com "\": compara tudo com "/")
      const slash = (s: string) => s.replace(/\\/g, "/");
      const root = absPathOf(pid) && slash(absPathOf(pid)!);
      const rel = (s: string) => (root ? slash(s).split(`${root}/`).join("") : s);
      setChats(pid, "perms", (l) => [...l, { requestId: e.requestId, tool: e.tool, title: rel(e.title), detail: e.detail && rel(e.detail), path: e.path && rel(e.path) }]);
      return;
    }
    case "step":
      // passos das contas por API: mesma animação dos passos do Claude
      if (here) feedAgentEvent(e.event);
      return;
    case "permissionGone":
      setChats(pid, "perms", (l) => l.filter((p) => p.requestId !== e.requestId));
      return;
    case "done":
      setChats(pid, produce((c) => {
        c.busy = false;
        c.draft = "";
        c.perms = [];
      }));
      if (here) {
        setWs("running", false);
        // o Claude registra o "Terminou" no histórico; para as APIs, registramos aqui
        if (!isClaudeChat(pid) || !e.ok) {
          pushEvent({ kind: "done", title: e.ok ? "Terminou" : "Parou", detail: e.detail ?? undefined, agent: acc.label, color: acc.color, status: e.ok ? "ok" : "error" });
        }
      }
      return;
    case "error":
      setChats(pid, produce((c) => {
        c.busy = false;
        c.draft = "";
        c.perms = [];
        c.error = e.message;
      }));
      if (here) setWs("running", false);
      return;
  }
}

// ---------------------------------------------------------------- ações

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const setInput = (pid: string, text: string) => (ensure(pid), setChats(pid, "input", text));
export const setAttach = (pid: string, on: boolean) => (ensure(pid), setChats(pid, "attach", on));
export const clearError = (pid: string) => chats[pid] && setChats(pid, "error", null);

export async function sendChat(pid: string) {
  ensure(pid);
  const c = chats[pid];
  const text = c.input.trim();
  if (!text || c.busy) return;
  // pode vir do Painel, de um projeto que não é o aberto na tela Projetos
  const here = projectId() === pid;
  const attach = here && c.attach && ws.activeFile ? ws.activeFile : null;
  setChats(pid, produce((x) => {
    x.busy = true;
    x.draft = "";
    x.error = null;
    x.input = "";
  }));
  echoes.push({ text: norm(text), at: Date.now() });
  feedUser(pid, attach ? `${text}\n📎 ${attach}` : text);
  if (here) {
    pushEvent({ kind: "user", title: attach ? `${text}\n📎 ${attach}` : text, agent: "Você", status: "ok" });
    setSeenAgent(true);
    setWs("running", true);
  }
  try {
    await invoke("chat_send", { projectId: pid, text, attach });
  } catch (e) {
    setChats(pid, produce((x) => {
      x.busy = false;
      x.error = errMsg(e);
      x.input = text; // devolve o texto para tentar de novo
    }));
    if (projectId() === pid) setWs("running", false);
  }
}

export async function stopChat(pid: string) {
  try {
    await invoke("chat_stop", { projectId: pid });
  } catch (e) {
    showToast(errMsg(e));
  }
}

export async function answerPermission(pid: string, requestId: string, allow: boolean) {
  setChats(pid, "perms", (p) => p.requestId === requestId, "answering", true);
  try {
    await invoke("chat_permission", { projectId: pid, requestId, allow });
    setChats(pid, "perms", (l) => l.filter((p) => p.requestId !== requestId));
  } catch (e) {
    showToast(errMsg(e));
    setChats(pid, "perms", (l) => l.filter((p) => p.requestId !== requestId));
  }
}

/** Nova conversa: o Claude começa uma sessão nova; a API esquece o histórico. */
export async function newChat(pid: string) {
  await invoke("chat_reset", { projectId: pid }).catch(() => {});
  setChats(pid, produce((c) => {
    c.busy = false;
    c.draft = "";
    c.perms = [];
    c.error = null;
    c.conv = null;
  }));
  if (projectId() === pid) {
    setWs("events", (l) => l.filter((e) => e.agent === "disco"));
    setWs("running", false);
  }
}

/** Conversas anteriores do projeto e qual está aberta agora no chat. */
export async function listConversations(pid: string) {
  const r = await invoke<{ items: Convo[]; current: [string, string] | null }>("chat_conversations", { projectId: pid });
  return { items: r.items, current: r.current ? `${r.current[0]}:${r.current[1]}` : null };
}

/** Retoma uma conversa: o fim dela aparece no painel e o próximo pedido continua dela. */
export async function openConversation(pid: string, c: Convo) {
  ensure(pid);
  if (chats[pid].busy) return showToast("Espere o agente terminar (ou pare a resposta) antes de trocar de conversa");
  try {
    const evs = await invoke<AgentEvent[]>("chat_open", { projectId: pid, kind: c.kind, id: c.id, account: c.account });
    setChats(pid, produce((x) => {
      x.draft = "";
      x.perms = [];
      x.error = null;
      x.conv = { kind: c.kind, id: c.id, title: c.title };
    }));
    if (projectId() !== pid) return;
    // a conversa que estava na tela sai; as mudanças no disco ficam
    setWs("events", (l) => l.filter((e) => e.agent === "disco"));
    setWs("running", false);
    setSeenAgent(true);
    for (const e of evs) feedAgentEvent(e);
  } catch (e) {
    showToast(errMsg(e));
  }
}

/** Ao abrir um projeto com conta de API: a conversa guardada no Rust volta para a tela. */
export async function restoreChat(pid: string) {
  if (!isTauri || isClaudeChat(pid)) return;
  try {
    const [msgs, busy] = await invoke<[{ role: string; content: string }[], boolean]>("chat_history", { projectId: pid });
    if (projectId() !== pid || !msgs.length) return;
    const acc = accountOf(pid);
    for (const m of msgs) {
      if (m.role === "user") pushEvent({ kind: "user", title: m.content.replace(/\n\nArquivo `([^`]+)`[^\n]*:\n```[\s\S]*$/, "\n📎 $1"), agent: "Você", status: "ok" });
      else pushEvent({ kind: "say", title: m.content, agent: acc.label, color: acc.color, status: "ok" });
    }
    ensure(pid);
    setChats(pid, "busy", busy);
    setSeenAgent(true);
  } catch {
    /* sem conversa guardada */
  }
}
