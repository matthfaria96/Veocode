// Chat dentro do Veocode. O Rust (src-tauri/src/chat.rs) roda o Claude Code sem terminal
// (ou conversa com DeepSeek / OpenAI-compatível / Ollama) e manda os pedaços por "chat-event".
// Os passos do Claude (ler, editar, comandos) chegam pelo histórico dele (agentFeed.ts);
// aqui ficam o texto sendo escrito, os pedidos de permissão e o estado da conversa.

import { applyLimits, type Limits } from "./limits";
import { invoke } from "@tauri-apps/api/core";
import { sendPrefs } from "./chatPrefs";
import { attLabel, attsOf, clearAtts, setAttsOf } from "./attachments";
import { rememberSent } from "./media";
import { listen } from "@tauri-apps/api/event";
import { createStore, produce } from "solid-js/store";
import { accountById } from "./accounts";
import { isTauri } from "./api";
import { feedAgentEvent, setSeenAgent, type AgentEvent } from "./agentFeed";
import { absPathOf, isDiffTab, projectId, projects, pushEvent, setWs, showToast, ws, type ActivityEvent } from "./store";
import { handleLivre, LIVRE, newLivre } from "./livre";
import { confirmAction } from "./dialogs";
import { feedChat, feedUser } from "./feeds";
import { tx } from "./i18n";

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
  /** sessão do Claude desta conversa (os passos lidos do histórico são filtrados por ela) */
  session: string | null;
  /** tokens que a conversa carrega (relidos a cada mensagem) e quando ela mexeu por último */
  context: number | null;
  lastAt: number | null;
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
  /** tokens que a conversa carrega (o Claude relê isso a cada mensagem) */
  context?: number | null;
}

type ChatEvent =
  | { kind: "session"; sessionId: string }
  | { kind: "delta"; text: string }
  | { kind: "say"; key: string; text: string }
  | ({ kind: "permission" } & PermissionAsk)
  | { kind: "permissionGone"; requestId: string }
  | { kind: "done"; ok: boolean; detail: string | null }
  | { kind: "step"; event: AgentEvent }
  | { kind: "usage"; context: number }
  | { kind: "compact"; state: "running" | "done" | "failed"; before: number | null; after: number | null; detail: string | null }
  | { kind: "limits"; account: string; limits: Limits }
  | { kind: "error"; message: string };

const blank = (): ProjectChat => ({ busy: false, draft: "", perms: [], error: null, input: "", attach: false, conv: null, session: null, context: null, lastAt: null });

/** Projeto de uma chave de conversa ("projeto" ou "projeto~aba"). */
const baseOf = (key: string) => key.split("~")[0];
/** Chaves de conversa abertas de um projeto. */
const keysOf = (pid: string) => Object.keys(chats).filter((k) => baseOf(k) === pid);
/** Situação somada das conversas de um projeto (para a tela inicial e os avisos). */
export const projectChat = (pid: string): ProjectChat => {
  const list = keysOf(pid).map((k) => chats[k]);
  if (list.length <= 1) return list[0] ?? blank();
  const busy = list.find((c) => c.busy);
  return { ...blank(), busy: !!busy, draft: busy?.draft ?? "", perms: list.flatMap((c) => c.perms), error: list.find((c) => c.error)?.error ?? null };
};
/** Algum Claude deste projeto está trabalhando? */
export const anyBusy = (pid: string) => keysOf(pid).some((k) => chats[k].busy);
/** Eventos que pertencem a esta conversa. */
export const ofChat = (key: string, e: { tab?: string; session?: string; agent: string }) =>
  e.agent !== "disco" && (e.tab === key || (!!e.session && e.session === chats[key]?.session));

// a aba guarda a sessão para reabrir depois (convTabs.ts registra aqui, sem import circular)
let sessionHook: ((key: string, session: string) => void) | null = null;
export const onChatSession = (f: (key: string, session: string) => void) => (sessionHook = f);
export const [chats, setChats] = createStore<Record<string, ProjectChat>>({});

export const chatOf = (pid: string): ProjectChat => chats[pid] ?? blank();
const ensure = (pid: string) => {
  if (!chats[pid]) setChats(pid, blank());
};

const projectOf = (pid: string) => projects.find((p) => p.id === baseOf(pid));
const accountOf = (pid: string) => accountById(projectOf(pid)?.accountId ?? "");
const isClaudeChat = (pid: string) => accountOf(pid).provider === "claude";

// ---------------------------------------------------------------- não repetir o que o histórico traz de novo

// o Claude grava no histórico o mesmo pedido e as mesmas respostas que já mostramos daqui
const echoes: { text: string; at: number }[] = [];
const sayKeys = new Set<string>();
const norm = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 80);

// compactações mostradas ao vivo: a linha que o histórico traz depois é a mesma
let compactEchoes = 0;
/** Para o agentFeed: essa compactação já está na tela? (consome a marca) */
export const compactShown = () => (compactEchoes > 0 ? (compactEchoes--, true) : false);

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
  listen<{ projectId: string } & ChatEvent>("chat-event", ({ payload: e }) => {
    // uso do plano que o Claude Code manda junto com a resposta: vale para a conta, não para a conversa
    if (e.kind === "limits") return applyLimits(e.account, e.limits);
    return e.projectId === LIVRE ? handleLivre(e) : handle(e.projectId, e);
  });
}

function handle(pid: string, e: ChatEvent) {
  ensure(pid);
  feedChat(baseOf(pid), e as Parameters<typeof feedChat>[1]); // conversa guardada para o Painel
  const here = projectId() === baseOf(pid);
  const acc = accountOf(pid);
  switch (e.kind) {
    case "session":
      setChats(pid, produce((c) => {
        c.session = e.sessionId;
        c.lastAt = Date.now();
      }));
      sessionHook?.(pid, e.sessionId);
      return;
    case "usage":
      setChats(pid, produce((c) => {
        c.context = e.context;
        c.lastAt = Date.now();
      }));
      return;
    case "compact": {
      if (!here) return;
      const last = [...ws.events].reverse().find((x) => x.kind === "compact" && x.tab === pid && x.status === "running");
      if (e.state === "running") {
        if (!last) pushEvent({ kind: "compact", title: tx("Compactando a conversa…"), agent: acc.label, color: acc.color, status: "running", tab: pid });
        return;
      }
      const done = e.state === "done";
      if (done) compactEchoes++;
      const patch = { status: done ? "ok" : "error", title: done ? tx("Conversa compactada") : tx("Não deu para compactar"), detail: e.detail ?? undefined } as const;
      if (last) setWs("events", (x) => x.id === last.id, patch);
      else pushEvent({ kind: "compact", agent: acc.label, color: acc.color, tab: pid, ...patch });
      return;
    }
    case "delta":
      setChats(pid, "draft", (d) => d + e.text);
      return;
    case "say":
      setChats(pid, "draft", "");
      sayKeys.add(e.key);
      echoes.push({ text: norm(e.text), at: Date.now() });
      // o histórico pode ter chegado antes com o mesmo texto
      if (here && !ws.events.slice(-6).some((x) => x.kind === "say" && norm(x.title) === norm(e.text))) {
        pushEvent({ kind: "say", title: e.text, agent: acc.label, color: acc.color, status: "ok", tab: pid });
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
      if (here) feedAgentEvent({ ...e.event, tab: pid });
      return;
    case "permissionGone":
      setChats(pid, "perms", (l) => l.filter((p) => p.requestId !== e.requestId));
      return;
    case "done":
      setChats(pid, produce((c) => {
        c.busy = false;
        c.draft = "";
        c.perms = [];
        c.lastAt = Date.now();
      }));
      if (here) {
        setWs("running", anyBusy(baseOf(pid)));
        // o Claude registra o "Terminou" no histórico; para as APIs, registramos aqui
        if (!isClaudeChat(pid) || !e.ok) {
          pushEvent({ kind: "done", title: e.ok ? tx("Terminou") : tx("Parou"), detail: e.detail ?? undefined, agent: acc.label, color: acc.color, status: e.ok ? "ok" : "error", tab: pid });
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
      if (here) setWs("running", anyBusy(baseOf(pid)));
      return;
  }
}

// ---------------------------------------------------------------- ações

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Tamanho e última atividade conhecidos de uma conversa (medidor de contexto). */
export const setChatMeta = (key: string, context: number | null, lastAt: number | null) => (ensure(key), setChats(key, produce((c) => ((c.context = context), (c.lastAt = lastAt)))));
export const setInput = (pid: string, text: string) => (ensure(pid), setChats(pid, "input", text));
export const setAttach = (pid: string, on: boolean) => (ensure(pid), setChats(pid, "attach", on));
export const clearError = (pid: string) => chats[pid] && setChats(pid, "error", null);

export async function sendChat(pid: string, rewind?: string) {
  ensure(pid);
  const c = chats[pid];
  const files = attsOf(pid);
  const text = c.input.trim() || (files.length ? tx("Veja os anexos.") : "");
  if (!text || c.busy) return;
  // pode vir do Painel, de um projeto que não é o aberto na tela Projetos
  const here = projectId() === baseOf(pid);
  const attach = here && c.attach && ws.activeFile && !isDiffTab(ws.activeFile) ? ws.activeFile : null;
  setChats(pid, produce((x) => {
    x.busy = true;
    x.draft = "";
    x.error = null;
    x.input = "";
  }));
  clearAtts(pid);
  echoes.push({ text: norm(text), at: Date.now() });
  const shown = [text, attach ? `📎 ${attach}` : "", attLabel(files)].filter(Boolean).join("\n");
  rememberSent(shown, files.map((f) => f.thumb));
  feedUser(baseOf(pid), shown);
  let evId = 0;
  if (here) {
    evId = pushEvent({ kind: "user", title: shown, agent: "Você", status: "ok", tab: pid });
    setSeenAgent(true);
    setWs("running", true);
  }
  try {
    const anchor = await invoke<string | null>("chat_send", { projectId: pid, text, attach, files: files.map((f) => f.path), rewind: rewind ?? null, ...sendPrefs(baseOf(pid)) });
    // guarda de onde este pedido saiu: dá para editá-lo depois e recomeçar dali
    if (evId && anchor != null) setWs("events", (x) => x.id === evId, "anchor", anchor);
  } catch (e) {
    setChats(pid, produce((x) => {
      x.busy = false;
      x.error = errMsg(e);
      x.input = text; // devolve o texto para tentar de novo
    }));
    setAttsOf(pid, files);
    if (projectId() === baseOf(pid)) setWs("running", anyBusy(baseOf(pid)));
  }
}

/** Compacta a conversa (`/compact` do Claude): ele resume o que veio antes e libera a janela. */
export async function compactChat(pid: string) {
  ensure(pid);
  if (chats[pid].busy || !isClaudeChat(pid)) return;
  const here = projectId() === baseOf(pid);
  const acc = accountOf(pid);
  setChats(pid, produce((x) => ((x.busy = true), (x.draft = ""), (x.error = null))));
  if (here) {
    pushEvent({ kind: "compact", title: tx("Compactando a conversa…"), agent: acc.label, color: acc.color, status: "running", tab: pid });
    setWs("running", true);
  }
  try {
    await invoke("chat_send", { projectId: pid, text: "/compact", attach: null, files: [], rewind: null, ...sendPrefs(baseOf(pid)) });
  } catch (e) {
    setChats(pid, produce((x) => ((x.busy = false), (x.error = errMsg(e)))));
    if (here) {
      setWs("events", (x) => x.kind === "compact" && x.tab === pid && x.status === "running", { status: "error", title: tx("Não deu para compactar") });
      setWs("running", anyBusy(baseOf(pid)));
    }
  }
}

/**
 * Editar um pedido já mandado (como no Claude): para o que estiver rodando, tira da tela esse
 * pedido e tudo depois dele, e manda o texto novo. O Claude esquece a versão antiga.
 */
export async function resendEdited(pid: string, ev: ActivityEvent, text: string) {
  if (ev.anchor === undefined || !text.trim()) return;
  if (chatOf(pid).busy) {
    await stopChat(pid);
    for (let i = 0; i < 60 && chatOf(pid).busy; i++) await new Promise((r) => setTimeout(r, 100));
    if (chatOf(pid).busy) return showToast(tx("Não deu para parar a resposta. Tente de novo."));
  }
  const idx = ws.events.findIndex((x) => x.id === ev.id);
  if (idx >= 0) setWs("events", (list) => list.filter((x, i) => i < idx || !ofChat(pid, x)));
  setChats(pid, produce((c) => ((c.error = null), (c.draft = ""))));
  setInput(pid, text);
  await sendChat(pid, ev.anchor);
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
  if (projectId() === baseOf(pid)) {
    // só os passos desta conversa saem da tela (as outras abas continuam)
    const mine = new Set(ws.events.filter((e) => ofChat(pid, e)).map((e) => e.id));
    setWs("events", (l) => l.filter((e) => !mine.has(e.id)));
    setWs("running", anyBusy(baseOf(pid)));
  }
  setChats(pid, produce((c) => {
    c.session = null;
    c.context = null;
    c.lastAt = null;
  }));
}

/** Conversas anteriores do projeto e qual está aberta agora no chat. */
export async function listConversations(pid: string) {
  const r = await invoke<{ items: Convo[]; current: [string, string] | null }>("chat_conversations", { projectId: pid });
  return { items: r.items, current: r.current ? `${r.current[0]}:${r.current[1]}` : null };
}

/**
 * Apaga conversas anteriores (uma ou várias): os arquivos vão para a Lixeira, então dá para
 * recuperar. Pergunta antes. Se a aberta agora estiver entre elas, o chat começa uma nova.
 * Devolve quantas foram apagadas.
 */
export async function deleteConvos(pid: string, list: Convo[], current: string | null): Promise<number> {
  if (!list.length) return 0;
  const one = list.length === 1;
  const claude = list.some((c) => c.kind === "claude");
  const ok = await confirmAction(
    one ? tx("Apagar “{v}”?", { v: list[0].title.slice(0, 60) }) : tx("Apagar {length} conversas?", { length: list.length }),
    tx("{v} para a Lixeira do computador: dá para recuperar lá enquanto você não esvaziar.{v2}", { v: one ? tx("A conversa vai") : tx("As conversas vão"), v2: claude ? tx(" Sessões do Claude apagadas também somem do “claude --resume” no Terminal e do editor.") : "" }),
    one ? tx("Apagar conversa") : tx("Apagar {length} conversas", { length: list.length }),
    true,
  );
  if (!ok) return 0;
  let done = 0;
  let failed = "";
  for (const c of list) {
    try {
      await invoke("chat_delete", { projectId: pid, kind: c.kind, id: c.id, account: c.account });
      done++;
    } catch (e) {
      failed = errMsg(e);
    }
  }
  if (current && list.some((c) => `${c.kind}:${c.id}` === current)) {
    if (pid === LIVRE) await newLivre();
    else await newChat(pid);
  }
  showToast(failed ? tx("{done} apagada(s). Uma não deu: {failed}", { done, failed }) : one ? tx("Pronto, a conversa foi para a Lixeira.") : tx("Pronto, {done} conversas foram para a Lixeira.", { done }));
  return done;
}

/** Retoma uma conversa: o fim dela aparece no painel e o próximo pedido continua dela. */
export async function openConversation(pid: string, c: Convo, quiet = false): Promise<boolean> {
  ensure(pid);
  if (chats[pid].busy) {
    if (!quiet) showToast(tx("Espere a IA terminar (ou pare a resposta) antes de trocar de conversa"));
    return false;
  }
  try {
    const evs = await invoke<AgentEvent[]>("chat_open", { projectId: pid, kind: c.kind, id: c.id, account: c.account });
    setChats(pid, produce((x) => {
      x.draft = "";
      x.perms = [];
      x.error = null;
      x.conv = { kind: c.kind, id: c.id, title: c.title };
    }));
    // a conversa que estava nesta aba sai da tela; as outras abas e o disco ficam
    const mine = new Set(ws.events.filter((e) => ofChat(pid, e)).map((e) => e.id));
    setChats(pid, produce((x) => {
      x.session = c.kind === "claude" ? c.id : null;
      x.context = c.context ?? null;
      x.lastAt = c.updated || null;
    }));
    if (c.kind === "claude") sessionHook?.(pid, c.id);
    if (projectId() !== baseOf(pid)) return true;
    // reabrindo a aba ao abrir o projeto: se o histórico já trouxe os passos, não repete
    if (quiet && c.kind === "claude" && ws.events.some((e) => e.session === c.id)) return true;
    setWs("events", (l) => l.filter((e) => !mine.has(e.id)));
    setWs("running", anyBusy(baseOf(pid)));
    setSeenAgent(true);
    for (const e of evs) feedAgentEvent({ ...e, tab: pid });
    return true;
  } catch (e) {
    if (!quiet) showToast(errMsg(e));
    return false;
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
