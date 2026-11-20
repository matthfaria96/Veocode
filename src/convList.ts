// A lista de conversas de um projeto, como no Claude: uma lista só, da mais recente para a mais
// antiga, com as que estão carregadas agora (trabalhando, esperando você, em branco) e as do
// histórico. Os ramos (bifurcações) ficam pendurados na conversa de onde saíram.
import { chatOf, type Convo } from "./chat";
import { activeKey, tabsOf, type ConvTab } from "./convTabs";
import { histOf } from "./convHist";
import { customName, forkParentOf } from "./forks";
import { projectId, projects } from "./store";

export interface ConvItem {
  /** chave na lista: a sessão (ou a conversa da API); a aba enquanto ela não tem sessão */
  id: string;
  pid: string;
  title: string;
  /** última atividade (ms) */
  updated: number;
  /** carregada numa aba agora */
  tab?: ConvTab;
  /** do histórico */
  convo?: Convo;
  session: string | null;
  /** é a da frente do projeto */
  active: boolean;
  busy: boolean;
  ask: boolean;
  err: boolean;
  /** de outra conta (a do projeto mudou): só dá para ver na lista */
  locked: boolean;
  /** ramos desta conversa */
  forks: ConvItem[];
  /** ramo: de qual conversa saiu (id na lista) */
  forkOf?: string;
  /** ramo esperando o 1º pedido */
  pendingFork: boolean;
  blank: boolean;
}

const tabTime = (t: ConvTab) => t.at ?? (t.key.includes("~") ? parseInt(t.key.split("~")[1], 36) || 0 : 0);

/** Conversas do projeto, mais recentes primeiro, com os ramos dentro da conversa de origem. */
export function convItems(pid: string): ConvItem[] {
  const proj = projects.find((p) => p.id === pid);
  const hist = histOf(pid);
  const byId = new Map<string, ConvItem>();
  const list: ConvItem[] = [];
  const front = activeKey(pid);

  for (const t of tabsOf(pid)) {
    const c = chatOf(t.key);
    const session = c.session ?? c.conv?.id ?? t.session ?? null;
    if (session && byId.has(session)) continue; // a mesma conversa em duas abas: mostra uma
    const h = session ? hist.find((x) => x.id === session) : undefined;
    const blank = !session && !c.fork && !c.busy && !c.lastAt;
    // conversa vazia só aparece na lista quando é a que está na tela (acabou de ser criada)
    if (blank && !(t.key === front && pid === projectId())) continue;
    const it: ConvItem = {
      id: session ?? t.key,
      pid,
      title: (session && customName(session)) || t.title || h?.title || "Conversa",
      // a hora em que a aba abriu só conta para conversa sem sessão ainda (abrir não é mexer)
      updated: session ? Math.max(c.lastAt ?? 0, h?.updated ?? 0) || tabTime(t) : Math.max(c.lastAt ?? 0, tabTime(t)),
      tab: t,
      convo: h,
      session,
      active: t.key === front,
      busy: c.busy,
      ask: c.perms.length > 0,
      err: !!c.error,
      locked: false,
      forks: [],
      pendingFork: !!c.fork,
      blank,
    };
    byId.set(it.id, it);
    list.push(it);
  }
  for (const h of hist) {
    if (byId.has(h.id)) continue;
    const it: ConvItem = {
      id: h.id,
      pid,
      title: customName(h.id) || h.title,
      updated: h.updated,
      convo: h,
      session: h.kind === "claude" ? h.id : null,
      active: false,
      busy: false,
      ask: false,
      err: false,
      locked: !!proj && h.account !== proj.accountId,
      forks: [],
      pendingFork: false,
      blank: false,
    };
    byId.set(it.id, it);
    list.push(it);
  }

  // de onde cada ramo saiu: o que o Veocode lembra (ramos feitos aqui) ou, no histórico do
  // Claude, a mesma primeira mensagem (o ramo copia os ids): a conversa mais antiga é a original
  const parentOf = new Map<string, string>();
  const byRoot = new Map<string, ConvItem[]>();
  for (const it of list) {
    const r = it.convo?.root;
    if (r) byRoot.set(r, [...(byRoot.get(r) ?? []), it]);
  }
  for (const group of byRoot.values()) {
    if (group.length < 2) continue;
    const born = (x: ConvItem) => x.convo?.created || x.updated;
    const first = group.reduce((a, b) => (born(b) < born(a) ? b : a));
    for (const it of group) if (it !== first) parentOf.set(it.id, first.id);
  }
  for (const it of list) {
    const p = forkParentOf(it.session) ?? (it.tab ? forkParentOf(it.tab.key) : undefined);
    if (p && byId.has(p) && p !== it.id) parentOf.set(it.id, p);
  }
  // um ramo de ramo fica na mesma conversa de origem (um nível só, como uma lista de respostas)
  const top = (id: string, seen = new Set<string>()): string => {
    const p = parentOf.get(id);
    return p && !seen.has(p) ? (seen.add(id), top(p, seen)) : id;
  };

  const byTime = (a: ConvItem, b: ConvItem) => (a.blank !== b.blank ? (a.blank ? -1 : 1) : b.updated - a.updated);
  const roots: ConvItem[] = [];
  for (const it of list) {
    const p = parentOf.has(it.id) ? top(it.id) : null;
    if (p && p !== it.id) {
      it.forkOf = p;
      byId.get(p)!.forks.push(it);
    } else roots.push(it);
  }
  for (const r of roots) r.forks.sort(byTime);
  // a conversa sobe na lista quando um ramo dela mexe
  const last = (r: ConvItem) => Math.max(r.updated, ...r.forks.map((f) => f.updated));
  return roots.sort((a, b) => (a.blank !== b.blank ? (a.blank ? -1 : 1) : last(b) - last(a)));
}

/** Quantas conversas do projeto estão trabalhando / esperando você agora. */
export function projectLive(pid: string) {
  let busy = 0;
  let ask = 0;
  for (const t of tabsOf(pid)) {
    const c = chatOf(t.key);
    if (c.perms.length) ask++;
    else if (c.busy) busy++;
  }
  return { busy, ask };
}

/** "agora", "5 min", "3 h", "2 d", "12 nov". */
export function shortAgo(ms: number, now = Date.now(), lang: "pt" | "en" = "pt") {
  if (!ms) return "";
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return lang === "en" ? "now" : "agora";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d`;
  return new Date(ms).toLocaleDateString(lang === "en" ? "en-US" : "pt-BR", { day: "numeric", month: "short" }).replace(".", "");
}
