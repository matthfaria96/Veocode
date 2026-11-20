// Abas de conversa de cada projeto: várias conversas ao mesmo tempo, cada uma com o seu
// Claude. A primeira usa a chave do próprio projeto; as outras, "projeto~aba".
// Também cuida de concluir (resumo vai para a memória do projeto) e de recomeçar leve.
import { invoke } from "@tauri-apps/api/core";
import { createStore, produce } from "solid-js/store";
import { isTauri } from "./api";
import { ask } from "./dialogs";
import { chatOf, chats, forkInto, newChat, ofChat, onChatSession, openConversation, setChatMeta, setInput, stopChat, type Convo } from "./chat";
import { projects, setWs, showToast, ws } from "./store";
import { setMemoryText } from "./memoryStore";
import { histFind, loadHist } from "./convHist";
import { customName, setCustomName } from "./forks";
import { locale, tx } from "./i18n";

/** `at`: quando a aba nasceu (a lista ordena por isso enquanto ela não tem mensagens). */
export type ConvTab = { key: string; title: string; session?: string | null; account?: string; at?: number };
type ProjectTabs = { list: ConvTab[]; active: string };

const KEY = "veocode.convtabs";
/** Conversas trabalhando ao mesmo tempo num projeto (cada uma gasta do limite da conta). */
const MAX_RUNNING = 4;
const MAX_TABS = 8;

const load = (): Record<string, ProjectTabs> => {
  let all: Record<string, ProjectTabs> = {};
  try {
    all = JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
  // conversa que nunca mandou nada (um ramo não enviado, uma "nova" esquecida) não volta ao
  // reabrir o app, como no Claude; a aba principal do projeto fica sempre
  for (const [pid, pt] of Object.entries(all)) {
    if (!Array.isArray(pt?.list)) {
      delete all[pid];
      continue;
    }
    pt.list = pt.list.filter((t) => t.key === pid || t.session);
    if (!pt.list.length) pt.list = [{ key: pid, title: "Conversa" }];
    if (!pt.list.some((t) => t.key === pt.active)) pt.active = pt.list[0].key;
  }
  return all;
};
const [tabs, setTabs] = createStore<Record<string, ProjectTabs>>(load());
const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(tabs));
  } catch {
    /* sem armazenamento: só não lembra */
  }
};

const first = (pid: string): ProjectTabs => ({ list: [{ key: pid, title: "Conversa" }], active: pid });
const ensure = (pid: string) => {
  if (!tabs[pid]?.list?.length) setTabs(pid, first(pid));
};

export const tabsOf = (pid: string): ConvTab[] => tabs[pid]?.list ?? first(pid).list;
export const activeKey = (pid: string): string => {
  const t = tabs[pid];
  return t && t.list.some((x) => x.key === t.active) ? t.active : t?.list[0]?.key ?? pid;
};
const activeTab = (pid: string) => tabsOf(pid).find((t) => t.key === activeKey(pid)) ?? tabsOf(pid)[0];

// a sessão nasce no primeiro pedido: guarda na aba para reabrir depois de fechar o app
onChatSession((key, session) => {
  const pid = key.split("~")[0];
  if (!tabs[pid]) return;
  setTabs(pid, "list", (t) => t.key === key, produce((t: ConvTab) => {
    t.session = session;
  }));
  save();
});

/** Carrega a conversa de uma aba sem trocar a aba da frente (modo foco mostra todas). */
export const wakeTab = (pid: string, key: string) => void wake(pid, key);

export function selectTab(pid: string, key: string) {
  ensure(pid);
  setTabs(pid, "active", key);
  save();
  void wake(pid, key);
}

/**
 * Põe a conversa da aba na tela: ao reabrir o app (a sessão do Claude continua) e ao voltar para
 * o projeto (a tela do projeto recomeça vazia, mas a aba ainda sabe qual conversa é a dela).
 */
async function wake(pid: string, key: string) {
  const t = tabsOf(pid).find((x) => x.key === key);
  const p = projects.find((x) => x.id === pid);
  if (!isTauri || !t || !p || p.demo) return;
  const c = chatOf(key);
  // já está na tela, ou trabalhando agora (o que chega continua aparecendo)
  if (c.busy || ws.events.some((e) => e.tab === key)) return;
  // ramo que ainda não mandou nada: a original volta para a tela
  if (c.fork) {
    void forkInto(key, c.fork.parent, t.account ?? p.accountId, c.fork.at);
    return;
  }
  if (c.conv?.kind === "api") {
    await openConversation(key, { id: c.conv.id, kind: "api", account: t.account ?? p.accountId, title: c.conv.title, lastPrompt: null, origin: null, updated: 0, bytes: 0 }, true);
    return;
  }
  const session = c.session ?? t.session;
  if (!session) return;
  if (t.account && t.account !== p.accountId) return;
  const ok = await openConversation(key, { id: session, kind: "claude", account: p.accountId, title: t.title, lastPrompt: null, origin: null, updated: 0, bytes: 0 }, true);
  // a sessão sumiu (apagada pelo Terminal ou pela lista): a aba recomeça vazia
  if (!ok && !chatOf(key).busy) {
    setTabs(pid, "list", (x) => x.key === key, "session", null);
    save();
    return;
  }
  // tamanho e idade da conversa, para avisar antes da 1ª mensagem se ela vai sair cara
  await loadHist(pid, 60_000);
  const h = histFind(pid, session);
  if (h && chatOf(key).context == null) setChatMeta(key, h.context ?? null, h.updated || null);
}
/** Ao abrir o projeto: acorda a aba que estava na frente (depois da 1ª leitura do histórico). */
export const wakeActive = (pid: string) => void window.setTimeout(() => void wake(pid, activeKey(pid)), 1200);

const running = (pid: string) => tabsOf(pid).filter((t) => chatOf(t.key).busy).length;

/** Aba sem nada: sem sessão, sem mensagens na tela, sem texto na caixa e parada. */
export const isBlankTab = (key: string) => {
  const c = chatOf(key);
  return !c.session && !c.conv && !c.fork && !c.busy && !c.input.trim() && !ws.events.some((e) => ofChat(key, e));
};
/** Aba que pode receber outra conversa no lugar (como no Claude): parada e sem pergunta pendente. */
const idle = (key: string) => {
  const c = chatOf(key);
  return !c.busy && !c.perms.length && !c.input.trim();
};

/**
 * Abre uma aba nova. Cada aba é uma conversa carregada (pode trabalhar enquanto você olha outra).
 * No limite, a aba parada mais antiga sai (a conversa dela continua na lista).
 */
export function newTab(pid: string, title = "Nova conversa"): string | null {
  ensure(pid);
  if (tabsOf(pid).length >= MAX_TABS) {
    const old = tabsOf(pid).find((t) => t.key !== activeKey(pid) && idle(t.key) && !chatOf(t.key).fork);
    if (!old) {
      showToast(tx("Até {MAX_TABS} conversas trabalhando ou esperando você por projeto: termine ou pare uma", { MAX_TABS }));
      return null;
    }
    void newChat(old.key);
    setTabs(pid, "list", (l) => l.filter((t) => t.key !== old.key));
  }
  if (running(pid) >= MAX_RUNNING) showToast(tx("{MAX_RUNNING} conversas já estão trabalhando: cada uma gasta do limite da conta", { MAX_RUNNING }));
  const key = `${pid}~${Date.now().toString(36)}`;
  const account = projects.find((x) => x.id === pid)?.accountId;
  setTabs(pid, produce((t: ProjectTabs) => {
    t.list.push({ key, title, account, at: Date.now() });
    t.active = key;
  }));
  save();
  return key;
}

/** Conversa nova: se a da frente já está em branco, é ela mesma. */
export function startConversation(pid: string): string | null {
  ensure(pid);
  const cur = activeKey(pid);
  if (isBlankTab(cur)) {
    setTabs(pid, "list", (t) => t.key === cur, produce((t: ConvTab) => ((t.title = "Nova conversa"), (t.session = null), (t.at = Date.now()))));
    save();
    return cur;
  }
  // outra aba em branco esperando: vai para ela
  const blank = tabsOf(pid).find((t) => isBlankTab(t.key));
  if (blank) {
    selectTab(pid, blank.key);
    return blank.key;
  }
  return newTab(pid);
}

export function renameTab(pid: string, key: string, title: string) {
  const clean = title.replace(/\s+/g, " ").trim().slice(0, 60);
  if (!clean) return;
  setTabs(pid, "list", (t) => t.key === key, "title", clean);
  save();
  const s = chatOf(key).session ?? tabsOf(pid).find((t) => t.key === key)?.session;
  if (s) setCustomName(s, clean);
}

/** Renomear pela lista: a aba (se estiver aberta) e o nome guardado da conversa. */
export function renameConversation(pid: string, session: string | null, key: string | null, title: string) {
  if (key) renameTab(pid, key, title);
  else if (session) setCustomName(session, title);
}

/** O primeiro pedido dá nome à aba (enquanto ela tiver o nome padrão). */
export function nameFromPrompt(key: string, text: string) {
  const pid = key.split("~")[0];
  const t = tabsOf(pid).find((x) => x.key === key);
  if (!t || (t.title !== "Nova conversa" && t.title !== "Conversa")) return;
  const words = text.replace(/\s+/g, " ").trim();
  if (words) renameTab(pid, key, words.length > 42 ? `${words.slice(0, 40).trimEnd()}…` : words);
}

/** Tira a aba (a conversa continua no histórico do projeto). */
async function drop(pid: string, key: string) {
  await newChat(key); // fecha o Claude dela e limpa os passos da tela
  const list = tabsOf(pid).filter((t) => t.key !== key);
  setTabs(pid, list.length ? { list, active: activeKey(pid) === key ? list[Math.max(0, tabsOf(pid).findIndex((t) => t.key === key) - 1)].key : activeKey(pid) } : first(pid));
  save();
  void wake(pid, activeKey(pid));
}

export async function closeTab(pid: string, key: string) {
  if (chatOf(key).busy) {
    const r = await ask({
      title: tx("Esta conversa ainda está trabalhando"),
      body: tx("Fechar agora para o Claude no meio do que está fazendo. A conversa continua no histórico do projeto."),
      options: [
        { id: "back", label: tx("Deixar terminar"), tone: "ghost" },
        { id: "stop", label: tx("Parar e fechar"), tone: "danger" },
      ],
    });
    if (r?.id !== "stop") return;
    await stopChat(key);
  }
  await drop(pid, key);
}

/**
 * Retoma uma conversa do histórico (como no Claude: ela aparece no lugar da da frente).
 * Já carregada numa aba: vai até ela. A da frente parada: a conversa entra no lugar dela.
 * A da frente trabalhando ou esperando você: abre ao lado, sem atrapalhar.
 */
export async function openInTab(pid: string, c: Convo): Promise<boolean> {
  const open = tabsOf(pid).find((t) => chatOf(t.key).session === c.id || t.session === c.id || chatOf(t.key).conv?.id === c.id);
  if (open) {
    selectTab(pid, open.key);
    return true;
  }
  const cur = activeTab(pid);
  const reuse = cur && idle(cur.key) && !chatOf(cur.key).fork;
  const key = reuse ? cur.key : newTab(pid, c.title.slice(0, 42));
  if (!key) return false;
  const ok = await openConversation(key, c);
  if (!ok) {
    // não abriu: a aba nova some; a reaproveitada continua como estava
    if (!reuse) await drop(pid, key);
    return false;
  }
  setTabs(pid, "list", (t) => t.key === key, produce((t: ConvTab) => {
    t.title = (customName(c.id) ?? c.title).slice(0, 60);
    t.session = c.kind === "claude" ? c.id : null;
    t.account = c.account;
  }));
  save();
  return true;
}

/**
 * Bifurca uma conversa do Claude numa aba nova: inteira (`at` vazio) ou a partir de um pedido
 * (`at` = âncora dele; o texto dele volta para a caixa para você mudar). A original não muda.
 */
export async function forkConversation(pid: string, parent: { session: string; account: string; title: string }, at?: { anchor: string; text: string }) {
  // do primeiro pedido: é uma conversa nova com o texto na caixa
  if (at && at.anchor === "") {
    const k = startConversation(pid);
    if (k) setInput(k, at.text);
    return k;
  }
  const key = newTab(pid, tx("{v} (ramo)", { v: (customName(parent.session) ?? parent.title).slice(0, 44) }));
  if (!key) return null;
  const ok = await forkInto(key, parent.session, parent.account, at?.anchor ?? null);
  if (!ok) {
    await drop(pid, key);
    return null;
  }
  if (at) setInput(key, at.text);
  requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".chat-panel .composer textarea")?.focus());
  return key;
}

// ---------------------------------------------------------------- resumo (feito aqui, sem gastar tokens)

const cut = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

/** Resumo curto da conversa: pedidos, o que mudou e a última resposta. */
function summaryOf(key: string): { title: string; text: string; files: string[] } | null {
  const evs = ws.events.filter((e) => ofChat(key, e));
  const asks = evs.filter((e) => e.kind === "user").map((e) => cut(e.title.replace(/\n📎[^\n]*/g, ""), 160)).filter(Boolean);
  const last = [...evs].reverse().find((e) => e.kind === "say");
  const files = [...new Set(evs.filter((e) => (e.kind === "edit" || e.kind === "create" || e.kind === "delete") && e.path).map((e) => e.path!))];
  if (!asks.length && !last) return null;
  const pid = key.split("~")[0];
  const title = tabsOf(pid).find((t) => t.key === key)?.title ?? "Conversa";
  const lines = [
    asks.length ? `Pedidos: ${asks.slice(-5).join(" | ")}` : "",
    files.length ? tx("Arquivos mexidos: {list}", { list: files.slice(0, 15).join(", ") + (files.length > 15 ? tx(" e mais {v}", { v: files.length - 15 }) : "") }) : "",
    last ? tx("Fim da conversa: {v}", { v: cut(last.title, 500) }) : "",
  ].filter(Boolean);
  return { title, text: lines.join("\n"), files };
}

/** Concluir: o resumo vai para a memória do projeto e a aba fecha. */
export async function concludeTab(pid: string, key: string) {
  if (chatOf(key).busy) return showToast(tx("Espere a conversa terminar (ou pare) antes de concluir"));
  const s = summaryOf(key);
  if (s && isTauri) {
    const date = new Date().toLocaleDateString(locale(), { day: "2-digit", month: "short" });
    try {
      setMemoryText(pid, await invoke<string>("memory_add", { projectId: pid, entry: `## ${date} · ${s.title}\n${s.text}` }));
    } catch (e) {
      return showToast(tx("Não deu para guardar o resumo: {e}", { e }));
    }
  }
  await drop(pid, key);
  showToast(s ? tx("Conversa concluída: o resumo foi para a memória do projeto") : tx("Conversa concluída"));
}

/** Conversa pesada: abre uma nova com o resumo já na caixa (o Claude não relê tudo). */
export function continueFresh(pid: string, key: string) {
  const s = summaryOf(key);
  const k = newTab(pid, s ? tx("{v} (cont.)", { v: s.title.slice(0, 34) }) : "Nova conversa");
  if (!k) return;
  if (s) setInput(k, tx("Continuando uma conversa anterior. Resumo:\n{text}\n\nAgora: ", { text: s.text }));
  requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".center .composer textarea")?.focus());
}

// ---------------------------------------------------------------- medidor de contexto

/** No plano do Claude o cache da conversa dura 1 h parado: depois disso a próxima mensagem relê tudo sem desconto. */
export const CACHE_TTL = 60 * 60_000;
export const fmtTokens = (n: number) => (n >= 1000 ? tx("{n} mil", { n: Math.round(n / 1000) }) : String(n));
export type Weight = "leve" | "media" | "pesada";
export const weightOf = (n: number | null): Weight => (!n || n < 60_000 ? "leve" : n < 150_000 ? "media" : "pesada");

/** Liga ws.running ao estado das conversas ao trocar de projeto. */
export const syncRunning = (pid: string) => setWs("running", tabsOf(pid).some((t) => chats[t.key]?.busy));
