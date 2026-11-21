// Eventos reais dos agentes: o Rust lê os históricos do Claude Code (src-tauri/src/agent.rs)
// e aqui cada passo vira a mesma animação da demo: cursor da conta indo até o arquivo,
// marca na árvore, linha na Atividade, comando no Terminal e conversa no painel do agente.

import { copiedFromParent } from "./forks";
import { invoke } from "@tauri-apps/api/core";
import { createSignal } from "solid-js";
import { accountById } from "./accounts";
import { alreadyShown, compactShown, openedWhole } from "./chat";
import { isTauri } from "./api";
import { loadDir, openRealFile } from "./realProject";
import { projectId, pushEvent, setWs, ws, type ActivityEvent, type Cursor, type FileMark } from "./store";
import { tx } from "./i18n";
import { agentWroteHtml } from "./browser";
import { markStopped } from "./outside";

export interface AgentEvent {
  id: string;
  session: string;
  account: string;
  sub: string | null;
  subLabel: string | null;
  kind: "user" | "say" | "think" | "read" | "search" | "edit" | "create" | "run" | "web" | "tool" | "swarm" | "plan" | "done" | "stop" | "result" | "compact";
  title: string;
  detail: string | null;
  path: string | null;
  status: "running" | "ok" | "error";
  output: string[];
  ts: number;
  history: boolean;
  /** aba do chat que fez (passos das contas por API, que não têm sessão do Claude) */
  tab?: string;
  /** pedido: de onde recomeçar se for editado */
  anchor?: string;
}

const POLL_MS = 900;
/** Abre o arquivo que o agente está editando e expande a árvore até ele. Desligado por padrão:
 *  a tela só muda de lugar se a pessoa pedir. */
const FOLLOW_KEY = "veocode.follow";
const [follow, setFollowRaw] = createSignal((() => {
  try {
    return localStorage.getItem(FOLLOW_KEY) === "1";
  } catch {
    return false;
  }
})());
export { follow };
export const setFollow = (on: boolean) => {
  setFollowRaw(on);
  try {
    localStorage.setItem(FOLLOW_KEY, on ? "1" : "0");
  } catch {
    /* sem armazenamento */
  }
};

// caminho → quando o agente mexeu (para o observador de disco não repetir a mesma linha)
const touched = new Map<string, number>();
export const touchedByAgent = (path: string) => {
  const now = Date.now();
  if (now - (touched.get(path) ?? 0) < 4000) return true;
  // pasta criada junto com o arquivo que o agente escreveu
  for (const [p, t] of touched) if (now - t < 4000 && p.startsWith(`${path}/`)) return true;
  return false;
};

/** Para a conversa: o Veocode viu alguma sessão do Claude nesta pasta? */
export const [seenAgent, setSeenAgent] = createSignal(false);

// passos que não vêm do histórico do Claude (contas por API, via chat.ts) entram por aqui
let external: ((e: AgentEvent) => void) | null = null;
/** Mostra um passo vindo de fora (chat das contas por API) com a mesma animação. */
export function feedAgentEvent(e: AgentEvent) {
  external?.(e);
}

export function startAgentFeed(root: HTMLElement): () => void {
  if (!isTauri) return () => {};
  const pid = projectId();
  const ids = new Map<string, number>(); // id do evento do Claude → id na Atividade
  const cursorOf = new Map<string, string>(); // id do passo → cursor que fez
  const lastSeen = new Map<string, number>(); // cursor → último passo
  let stopped = false;
  let first = true;
  let timer: number | undefined;
  setSeenAgent(false);

  // ------------------------------------------------ cursores

  const cursorKey = (e: AgentEvent) => `${e.session}:${e.sub ?? "main"}`;
  const label = (e: AgentEvent) => (e.sub ? (e.subLabel ? cut(e.subLabel, 22) : "subagente") : accountById(e.account).label);

  const point = (target: string) => {
    const el = root.querySelector<HTMLElement>(`[data-target="${CSS.escape(target)}"]`);
    if (!el) return null;
    // seguindo: rola até o alvo; senão, o cursor fica na borda da área visível
    if (follow()) el.scrollIntoView({ block: "nearest" });
    const r = el.getBoundingClientRect();
    const rr = root.getBoundingClientRect();
    if (r.height === 0) return null;
    const y = Math.min(Math.max(r.top - rr.top + r.height / 2, 8), rr.height - 24);
    return { x: r.left - rr.left + Math.min(r.width * 0.4, 70), y };
  };

  /** Alvo mais próximo que está na tela: o arquivo, senão a pasta-mãe aberta mais funda. */
  const pointForPath = (path: string) => {
    let p: string | null = path;
    while (p) {
      const hit = point(`file:${p}`);
      if (hit) return hit;
      p = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : null;
    }
    return point("chat");
  };

  const ensureCursor = (e: AgentEvent) => {
    const id = cursorKey(e);
    if (!ws.cursors.some((c) => c.id === id)) {
      // subagente nasce em cima do cursor principal da mesma sessão
      const parent = ws.cursors.find((c) => c.id === `${e.session}:main`);
      const start = parent ?? point("chat") ?? { x: 40, y: 40 };
      const c: Cursor = { id, label: label(e), color: accountById(e.account).color, x: start.x, y: start.y, visible: false, clicking: false, main: !e.sub };
      setWs("cursors", (l) => [...l, c]);
    }
    lastSeen.set(id, Date.now());
    return id;
  };

  const moveTo = (id: string, p: { x: number; y: number } | null, click = true) => {
    if (!p) return;
    // um quadro depois de nascer, para a transição acontecer
    requestAnimationFrame(() => {
      setWs("cursors", (c) => c.id === id, { x: p.x, y: p.y, visible: true });
      if (click) {
        setTimeout(() => setWs("cursors", (c) => c.id === id, "clicking", true), 650);
        setTimeout(() => setWs("cursors", (c) => c.id === id, "clicking", false), 900);
      }
    });
  };

  /** Abre as pastas até o arquivo (carregando o que faltar). */
  const revealPath = async (path: string) => {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      if (!ws.expanded[dir]) setWs("expanded", dir, true);
      if (!ws.tree[dir]) await loadDir(dir);
      if (stopped) return;
    }
    await new Promise((r) => requestAnimationFrame(r));
    root.querySelector(`[data-target="${CSS.escape(`file:${path}`)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  // ------------------------------------------------ eventos → tela

  const kindOf: Partial<Record<AgentEvent["kind"], ActivityEvent["kind"]>> = {
    read: "read", search: "search", edit: "edit", create: "create", run: "run", web: "web", tool: "tool", swarm: "swarm", plan: "plan",
  };
  const markOf: Partial<Record<AgentEvent["kind"], FileMark>> = { read: "read", search: "search", edit: "edit", create: "new" };

  const mark = (path: string, m: FileMark) => {
    const prev = ws.marks[path];
    // não rebaixa: arquivo editado continua "M" mesmo se for lido depois
    if (prev === "edit" || prev === "new") {
      if (m === "read" || m === "search") return;
    }
    setWs("marks", path, m);
  };

  const term = (text: string, tone?: "cmd" | "ok" | "dim") => setWs("terminal", (t) => [...t, { text, tone }].slice(-200));

  const apply = async (e: AgentEvent) => {
    // ramo novo: o leitor de fundo repete as mensagens copiadas da original, que já estão na tela
    // (o histórico aberto pela lista vem com a aba e entra inteiro)
    if (!e.tab && copiedFromParent(e.session, e.ts)) return;
    // o fim de uma sessão que já foi aberta inteira numa aba (o leitor de fundo chegou depois)
    if (!e.tab && e.history && e.session && openedWhole(e.session)) return;
    // de qual conversa é (a aba do chat filtra por isso)
    const tag = { session: e.session || undefined, tab: e.tab, sub: e.sub ?? undefined, subLabel: e.sub ? (e.subLabel ?? undefined) : undefined };
    const live = !e.history;
    const who = e.sub ? `${accountById(e.account).label} · ${label(e)}` : accountById(e.account).label;
    const color = accountById(e.account).color;
    setSeenAgent(true);

    if (e.kind === "result") {
      const aid = ids.get(e.id);
      if (aid === undefined) return;
      setWs("events", (x) => x.id === aid, (old): ActivityEvent => {
        const created = e.title === "create";
        return {
          ...old,
          status: e.status === "error" ? "error" : "ok",
          // a lista de tarefas chega no pedido; o resultado dela não traz nada melhor
          detail: old.kind === "plan" ? old.detail : e.detail ?? old.detail,
          kind: created ? "create" : old.kind,
          title: created ? old.title.replace(/^Escrevendo/, "Criando") : old.title,
        };
      });
      const ev = ws.events.find((x) => x.id === aid);
      if (ev?.path && e.status !== "error") {
        if (e.title === "create" || ev.kind === "create") mark(ev.path, "new");
        else if (ev.kind === "edit") mark(ev.path, "edit");
      }
      if (ev?.path && (ev.kind === "edit" || ev.kind === "create")) {
        touched.set(ev.path, Date.now());
        // o arquivo só existe depois do resultado (pode ter esperado a permissão): abre agora
        const cid = cursorOf.get(e.id);
        if (!e.history && e.status !== "error" && cid) showEdit(cid, ev.path, aid);
        if (!e.history && e.status !== "error" && /\.html?$/i.test(ev.path)) agentWroteHtml(pid, ev.path);
      }
      if (ev?.kind === "run") {
        e.output.forEach((l) => term(l, "dim"));
        term(e.status === "error" ? "✗ falhou" : "✓ ok", e.status === "error" ? undefined : "ok");
      }
      return;
    }

    // parado no meio (no Terminal, no editor, no app do Claude): o pedido acabou
    if (e.kind === "stop") {
      markStopped(e.session, e.ts);
      return;
    }

    // pensar e responder não mexem o cursor: ele só aparece onde algo acontece (arquivo, terminal)
    if (e.kind === "think") {
      if (live) setWs("running", true);
      return;
    }

    // conversa compactada: uma linha "antes → depois" (a ao vivo já está na tela)
    if (e.kind === "compact") {
      if (live && compactShown()) return;
      pushEvent({ ...tag, kind: "compact", title: e.title === "auto" ? tx("Compactada automaticamente") : tx("Conversa compactada"), detail: e.detail ?? undefined, agent: who, color, status: "ok", at: e.ts });
      return;
    }

    // o que foi enviado/recebido pelo chat do Veocode já está na tela
    if ((e.kind === "user" || e.kind === "say") && live && alreadyShown(e.kind, e.id, e.title)) return;
    if (e.kind === "user") {
      pushEvent({ ...tag,  kind: "user", title: e.title, agent: "Você", status: "ok", at: e.ts, anchor: e.anchor });
      if (live) setWs("running", true);
      return;
    }
    if (e.kind === "say") {
      pushEvent({ ...tag,  kind: "say", title: e.title, agent: who, color, status: "ok", at: e.ts });
      return;
    }
    if (e.kind === "done") {
      pushEvent({ ...tag,  kind: "done", title: tx("Terminou"), agent: who, color, status: "ok", at: e.ts });
      if (live) {
        setWs("running", false);
        // terminou: os cursores desta sessão somem
        setWs("cursors", (c) => c.id.startsWith(`${e.session}:`), "visible", false);
      }
      return;
    }

    // passos de ferramenta
    const kind = kindOf[e.kind] ?? "tool";
    // o observador de disco pode ter chegado antes com "Alterado: …": a linha do agente substitui
    if (e.path && (e.kind === "edit" || e.kind === "create")) {
      const recent = new Set(ws.events.slice(-10).filter((x) => x.agent === "disco" && x.path === e.path).map((x) => x.id));
      if (recent.size) setWs("events", (l) => l.filter((x) => !recent.has(x.id)));
    }
    const aid = pushEvent({ ...tag,  kind, title: e.title, detail: e.detail ?? undefined, agent: who, color, status: e.status === "running" ? "running" : "ok", path: e.path ?? undefined, at: e.ts });
    ids.set(e.id, aid);
    if (e.path) {
      // edição só marca quando o resultado confirmar (pode esperar permissão ou ser recusada)
      const m = e.kind === "edit" || e.kind === "create" ? undefined : markOf[e.kind];
      if (m) mark(e.path, m);
      if (e.kind === "edit" || e.kind === "create") touched.set(e.path, Date.now());
    }
    if (e.kind === "run" && e.detail) term(`$ ${e.detail}`, "cmd");
    if (!live) return;

    setWs("running", true);
    const cid = ensureCursor(e);
    if (e.kind === "run") return moveTo(cid, point("terminal"));
    if (!e.path) return; // ferramenta sem arquivo (busca na web, MCP…): fica só na Atividade

    cursorOf.set(e.id, cid);
    // edição: a árvore e o editor abrem quando o resultado chegar (o arquivo pode nem existir ainda)
    if (follow() && e.kind === "read") await revealPath(e.path);
    if (stopped) return;
    moveTo(cid, pointForPath(e.path));
  };

  /** Mostra a edição feita: abre as pastas, o arquivo e aponta a 1ª linha alterada. */
  const showEdit = async (cid: string, path: string, aid: number) => {
    if (!follow()) return moveTo(cid, pointForPath(path));
    await revealPath(path);
    if (stopped || projectId() !== pid) return;
    moveTo(cid, pointForPath(path));
    setTimeout(() => {
      if (stopped || projectId() !== pid) return;
      openRealFile(path);
      // depois que o disco avisar da mudança, aponta a primeira linha alterada (ou a 1ª, se é novo)
      setTimeout(() => {
        if (stopped || ws.activeFile !== path) return;
        const ev = ws.events.find((x) => x.id === aid);
        const first = ev?.kind === "create" ? 1 : ws.changedLines[path]?.[0];
        if (first) moveTo(cid, point(`line:${first}`));
      }, 1200);
    }, 500);
  };

  // ------------------------------------------------ laço

  const tick = async () => {
    if (stopped) return;
    try {
      // a 1ª leitura recomeça do zero no Rust: reabrir o projeto mostra o histórico de novo
      const evs = await invoke<AgentEvent[]>("agent_poll", { projectId: pid, reset: first });
      first = false;
      if (stopped || projectId() !== pid) return;
      for (const e of evs) await apply(e);
    } catch {
      /* pasta sumiu ou conta sem histórico: tenta de novo no próximo ciclo */
    }
    // cursores parados somem: subagente em 6 s, principal em 12 s
    const now = Date.now();
    for (const c of ws.cursors) {
      const idle = now - (lastSeen.get(c.id) ?? 0);
      if (c.visible && idle > (c.main ? 12000 : 6000)) setWs("cursors", (x) => x.id === c.id, "visible", false);
      if (!c.main && idle > 9000) setWs("cursors", (l) => l.filter((x) => x.id !== c.id));
    }
    if (ws.running && [...lastSeen.values()].every((t) => now - t > 60000)) setWs("running", false);
    timer = window.setTimeout(tick, POLL_MS);
  };
  tick();

  // fila: um passo de cada vez, como no laço acima
  let queue = Promise.resolve();
  const mine = (e: AgentEvent) => {
    queue = queue.then(() => (stopped ? undefined : apply(e))).catch(() => {});
  };
  external = mine;

  return () => {
    stopped = true;
    if (external === mine) external = null;
    clearTimeout(timer);
    setWs("cursors", []);
  };
}

function cut(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
