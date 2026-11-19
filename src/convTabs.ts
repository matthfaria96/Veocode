// Abas de conversa de cada projeto: várias conversas ao mesmo tempo, cada uma com o seu
// Claude. A primeira usa a chave do próprio projeto; as outras, "projeto~aba".
// Também cuida de concluir (resumo vai para a memória do projeto) e de recomeçar leve.
import { invoke } from "@tauri-apps/api/core";
import { createStore, produce } from "solid-js/store";
import { isTauri } from "./api";
import { ask } from "./dialogs";
import { chatOf, chats, listConversations, newChat, ofChat, onChatSession, openConversation, setChatMeta, setInput, stopChat, type Convo } from "./chat";
import { projects, setWs, showToast, ws } from "./store";
import { setMemoryText } from "./memoryStore";
import { locale, tx } from "./i18n";

export type ConvTab = { key: string; title: string; session?: string | null; account?: string };
type ProjectTabs = { list: ConvTab[]; active: string };

const KEY = "veocode.convtabs";
/** Conversas trabalhando ao mesmo tempo num projeto (cada uma gasta do limite da conta). */
const MAX_RUNNING = 4;
const MAX_TABS = 8;

const load = (): Record<string, ProjectTabs> => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
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

export function selectTab(pid: string, key: string) {
  ensure(pid);
  setTabs(pid, "active", key);
  save();
  void wake(pid, key);
}

/** Aba reaberta depois de fechar o app: a conversa dela volta (a sessão do Claude continua). */
async function wake(pid: string, key: string) {
  const t = tabsOf(pid).find((x) => x.key === key);
  const p = projects.find((x) => x.id === pid);
  if (!isTauri || !t?.session || !p || p.demo || chatOf(key).session) return;
  if (t.account && t.account !== p.accountId) return;
  const ok = await openConversation(key, { id: t.session, kind: "claude", account: p.accountId, title: t.title, lastPrompt: null, origin: null, updated: 0, bytes: 0 }, true);
  // a sessão sumiu (apagada pelo Terminal ou pela lista): a aba recomeça vazia
  if (!ok && !chatOf(key).busy) {
    setTabs(pid, "list", (x) => x.key === key, "session", null);
    save();
    return;
  }
  // tamanho e idade da conversa, para avisar antes da 1ª mensagem se ela vai sair cara
  const c = (await listConversations(pid).catch(() => null))?.items.find((x) => x.id === t.session);
  if (c && chatOf(key).context == null) setChatMeta(key, c.context ?? null, c.updated || null);
}
/** Ao abrir o projeto: acorda a aba que estava na frente (depois da 1ª leitura do histórico). */
export const wakeActive = (pid: string) => void window.setTimeout(() => void wake(pid, activeKey(pid)), 1200);

const running = (pid: string) => tabsOf(pid).filter((t) => chatOf(t.key).busy).length;

export function newTab(pid: string, title = "Nova conversa"): string | null {
  ensure(pid);
  if (tabsOf(pid).length >= MAX_TABS) {
    showToast(tx("Até {MAX_TABS} conversas abertas por projeto: conclua ou feche uma", { MAX_TABS }));
    return null;
  }
  if (running(pid) >= MAX_RUNNING) showToast(tx("{MAX_RUNNING} conversas já estão trabalhando: cada uma gasta do limite da conta", { MAX_RUNNING }));
  const key = `${pid}~${Date.now().toString(36)}`;
  const account = projects.find((x) => x.id === pid)?.accountId;
  setTabs(pid, produce((t: ProjectTabs) => {
    t.list.push({ key, title, account });
    t.active = key;
  }));
  save();
  return key;
}

export function renameTab(pid: string, key: string, title: string) {
  const clean = title.replace(/\s+/g, " ").trim().slice(0, 60);
  if (!clean) return;
  setTabs(pid, "list", (t) => t.key === key, "title", clean);
  save();
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

/** Retoma uma conversa do histórico numa aba (a que já está aberta, se tiver). */
export async function openInTab(pid: string, c: Convo) {
  const open = tabsOf(pid).find((t) => t.session === c.id || chatOf(t.key).conv?.id === c.id);
  if (open) return selectTab(pid, open.key);
  // aba vazia na frente: usa ela
  const cur = activeTab(pid);
  const empty = cur && !chatOf(cur.key).session && !chatOf(cur.key).conv && !chatOf(cur.key).busy && !ws.events.some((e) => ofChat(cur.key, e));
  const key = empty ? cur.key : newTab(pid, c.title.slice(0, 42));
  if (!key) return;
  renameTab(pid, key, c.title.slice(0, 42));
  await openConversation(key, c);
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
export const fmtTokens = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)} mil` : String(n));
export type Weight = "leve" | "media" | "pesada";
export const weightOf = (n: number | null): Weight => (!n || n < 60_000 ? "leve" : n < 150_000 ? "media" : "pesada");

/** Liga ws.running ao estado das conversas ao trocar de projeto. */
export const syncRunning = (pid: string) => setWs("running", tabsOf(pid).some((t) => chats[t.key]?.busy));
