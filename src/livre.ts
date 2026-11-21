// Chat livre: conversa sem projeto, para dúvidas rápidas. Conversa normalmente e olha o
// computador quando a pergunta pede. O Rust usa a mesma máquina dos chats de projeto com o id
// "livre" (src-tauri/src/livre.rs); aqui fica a conversa inteira, já que ela não aparece no
// espaço de trabalho de nenhum projeto.

import { invoke } from "@tauri-apps/api/core";
import { sendPrefs } from "./chatPrefs";
import { attLabel, attsOf, clearAtts, setAttsOf } from "./attachments";
import { rememberSent } from "./media";
import { createStore, produce } from "solid-js/store";
import { accountById, accts } from "./accounts";
import type { AgentEvent } from "./agentFeed";
import { isTauri } from "./api";
import type { Convo, PermissionAsk } from "./chat";
import { settings, updateSettings } from "./settings";
import { showToast } from "./store";
import { tx } from "./i18n";

export const LIVRE = "livre";

export type Item =
  | { key: string; t: "user"; text: string; at?: number }
  | { key: string; t: "say"; text: string; account: string }
  | { key: string; t: "work"; steps: AgentEvent[] }
  | { key: string; t: "done"; ok: boolean; detail: string | null; account: string; at: number }
  | { key: string; t: "note"; text: string };

interface Livre {
  items: Item[];
  draft: string;
  busy: boolean;
  perms: PermissionAsk[];
  error: string | null;
  input: string;
  conv: { kind: "claude" | "api"; id: string; title: string } | null;
  /** tokens que a conversa carrega (medidor de contexto) */
  context: number | null;
  /** última resposta (a medição do contexto fica velha depois dela) */
  lastAt: number | null;
  /** muda quando a lista de conversas anteriores pode ter mudado (o painel relê) */
  listVer: number;
  /** muda a cada troca de conversa (nova, aberta do histórico, outra conta): a medição do contexto
   *  usa sempre a chave "livre", então guarda este número para saber de qual conversa ela é */
  convVer: number;
}

export const [livre, setLivre] = createStore<Livre>({ items: [], draft: "", busy: false, perms: [], error: null, input: "", conv: null, context: null, lastAt: null, listVer: 0, convVer: 0 });
const relist = () => setLivre("listVer", (v) => v + 1);
const nextConv = () => setLivre("convVer", (v) => v + 1);

/** Conta do Chat livre: a escolhida ou, se não existe mais, a padrão (o primeiro Claude). */
export const freeAccountId = () => {
  const l = accts.list;
  if (l.some((a) => a.id === settings.freeAccount)) return settings.freeAccount;
  return (l.find((a) => a.provider === "claude") ?? l[0])?.id ?? "";
};
export const freeAccount = () => accountById(freeAccountId());

let seq = 0;
const key = (p: string) => `${p}-${Date.now().toString(36)}-${seq++}`;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const push = (it: Item) => setLivre("items", (l) => [...l, it]);

/** Passo de ferramenta: entra no bloco de passos aberto (ou abre um); resultado atualiza o passo. */
function step(e: AgentEvent) {
  if (e.kind === "result") {
    setLivre("items", (it) => it.t === "work" && it.steps.some((s) => s.id === e.id), produce((it) => {
      const w = it as Extract<Item, { t: "work" }>;
      const s = w.steps.find((x) => x.id === e.id)!;
      s.status = e.status === "error" ? "error" : "ok";
      if (e.detail && s.kind !== "plan") s.detail = e.detail;
      if (e.title === "create") s.kind = "create";
    }));
    return;
  }
  if (["user", "say", "think", "done"].includes(e.kind)) return;
  const last = livre.items[livre.items.length - 1];
  if (last?.t === "work") setLivre("items", livre.items.length - 1, produce((it) => (it as Extract<Item, { t: "work" }>).steps.push({ ...e })));
  else push({ key: key("w"), t: "work", steps: [{ ...e }] });
}

type Ev =
  | { kind: "session" }
  | { kind: "delta"; text: string }
  | { kind: "say"; key: string; text: string }
  | ({ kind: "permission" } & PermissionAsk)
  | { kind: "permissionGone"; requestId: string }
  | { kind: "done"; ok: boolean; detail: string | null }
  | { kind: "step"; event: AgentEvent }
  | { kind: "usage"; context: number }
  | { kind: "compact" }
  | { kind: "error"; message: string };

/** Eventos do Rust com projectId "livre" (chat.ts encaminha para cá). */
export function handleLivre(e: Ev) {
  switch (e.kind) {
    case "delta":
      setLivre("draft", (d) => d + e.text);
      return;
    case "say":
      setLivre("draft", "");
      push({ key: `s-${e.key}`, t: "say", text: e.text, account: freeAccountId() });
      return;
    case "permission":
      setLivre("perms", (l) => [...l, { requestId: e.requestId, tool: e.tool, title: e.title, detail: e.detail, path: e.path }]);
      return;
    case "permissionGone":
      setLivre("perms", (l) => l.filter((p) => p.requestId !== e.requestId));
      return;
    case "step":
      step(e.event);
      return;
    case "usage":
      setLivre("context", e.context);
      return;
    case "compact":
      push({ key: key("n"), t: "note", text: tx("Conversa compactada: ela continua daqui com um resumo do que veio antes.") });
      return;
    case "done":
      setLivre(produce((c) => {
        c.busy = false;
        c.draft = "";
        c.perms = [];
        // passo que ficou "rodando" (resposta interrompida) não roda mais
        for (const it of c.items) if (it.t === "work") for (const s of it.steps) if (s.status === "running") s.status = e.ok ? "ok" : "error";
      }));
      push({ key: key("d"), t: "done", ok: e.ok, detail: e.detail, account: freeAccountId(), at: Date.now() });
      setLivre("lastAt", Date.now());
      relist();
      return;
    case "error":
      setLivre(produce((c) => {
        c.busy = false;
        c.draft = "";
        c.perms = [];
        c.error = e.message;
      }));
      return;
  }
}

// ---------------------------------------------------------------- ações

export async function sendLivre(text?: string) {
  const files = text === undefined ? attsOf(LIVRE) : [];
  const t = (text ?? livre.input).trim() || (files.length ? tx("Veja os anexos.") : "");
  if (!t || livre.busy) return;
  if (!freeAccountId()) return showToast(tx("Adicione uma conta de IA em Contas para conversar"));
  setLivre(produce((c) => {
    c.busy = true;
    c.draft = "";
    c.error = null;
    c.input = "";
  }));
  clearAtts(LIVRE);
  const shown = [t, attLabel(files)].filter(Boolean).join("\n");
  rememberSent(shown, files.map((f) => f.thumb));
  push({ key: key("u"), t: "user", text: shown, at: Date.now() });
  if (!isTauri) return demoReply(t);
  try {
    await invoke("chat_send", { projectId: LIVRE, text: t, attach: null, files: files.map((f) => f.path), ...sendPrefs(LIVRE) });
  } catch (e) {
    setLivre(produce((c) => {
      c.busy = false;
      c.error = errMsg(e);
      c.input = t;
      c.items.pop(); // a mensagem não foi: volta para a caixa
    }));
    setAttsOf(LIVRE, files);
  }
}

export const stopLivre = () => (isTauri ? invoke("chat_stop", { projectId: LIVRE }).catch((e) => showToast(errMsg(e))) : handleLivre({ kind: "done", ok: false, detail: tx("interrompido") }));

export async function answerLivre(requestId: string, allow: boolean) {
  setLivre("perms", (p) => p.requestId === requestId, "answering", true);
  try {
    if (isTauri) await invoke("chat_permission", { projectId: LIVRE, requestId, allow });
  } catch (e) {
    showToast(errMsg(e));
  }
  setLivre("perms", (l) => l.filter((p) => p.requestId !== requestId));
}

export async function newLivre() {
  if (livre.busy) return showToast(tx("Espere a resposta terminar (ou pare) antes de começar outra"));
  if (isTauri) await invoke("chat_reset", { projectId: LIVRE }).catch(() => {});
  setLivre({ items: [], draft: "", busy: false, perms: [], error: null, conv: null, context: null, lastAt: null });
  nextConv();
  relist();
}

/** Conversa pesada: começa outra com um resumo desta já na caixa (o Claude não relê tudo). */
export async function continueLivre() {
  if (livre.busy) return showToast(tx("Espere a resposta terminar (ou pare) antes de começar outra"));
  const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const asks = livre.items.flatMap((it) => (it.t === "user" ? [cut(it.text.replace(/\s+/g, " ").trim(), 160)] : [])).filter(Boolean);
  const last = [...livre.items].reverse().find((it) => it.t === "say");
  const lines = [
    asks.length ? tx("Perguntas: {list}", { list: asks.slice(-5).join(" | ") }) : "",
    last && last.t === "say" ? tx("Última resposta: {v}", { v: cut(last.text, 500) }) : "",
  ].filter(Boolean);
  await newLivre();
  if (lines.length) setLivre("input", tx("Continuando uma conversa anterior. Resumo:\n{text}\n\nAgora: ", { text: lines.join("\n") }));
  requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".livre-composer textarea")?.focus());
}

/** Resume a conversa até aqui para liberar a janela do Claude (o mesmo /compact dos projetos). */
export async function compactLivre() {
  if (livre.busy || !livre.items.length) return;
  setLivre(produce((c) => ((c.busy = true), (c.draft = ""), (c.error = null))));
  if (!isTauri) return handleLivre({ kind: "compact" }), handleLivre({ kind: "done", ok: true, detail: null });
  try {
    await invoke("chat_send", { projectId: LIVRE, text: "/compact", attach: null, files: [], ...sendPrefs(LIVRE) });
  } catch (e) {
    setLivre(produce((c) => ((c.busy = false), (c.error = errMsg(e)))));
  }
}

/** Troca a conta: a próxima mensagem começa uma conversa nova com ela. */
export async function setFreeAccount(id: string) {
  if (id === freeAccountId() || livre.busy) return;
  await updateSettings({ freeAccount: id });
  if (livre.items.length) {
    if (isTauri) await invoke("chat_reset", { projectId: LIVRE }).catch(() => {});
    setLivre({ conv: null, context: null, lastAt: null });
    nextConv();
    push({ key: key("n"), t: "note", text: tx("Agora com {label}: a próxima mensagem começa uma conversa nova.", { label: accountById(id).label }) });
  }
}

/** O que a IA pode fazer no Chat livre (o selo de permissão). Vale a partir da próxima mensagem. */
export async function setFreeLevel(level: number) {
  if (level === settings.freeLevel || livre.busy) return;
  await updateSettings({ freeLevel: level });
  if (livre.items.length) push({ key: key("n"), t: "note", text: tx("Permissão agora: {level}. Vale a partir da próxima mensagem.", { level: freeLevels[level]?.name ?? "" }) });
}

/** Os níveis do Chat livre: os mesmos dos projetos, contados para quem está no computador todo. */
export const freeLevels = [
  { get name() { return tx("Leitura"); }, get description() { return tx("Conversa e, quando ajuda, lê arquivos e roda comandos de leitura (como ls). Não edita nem apaga nada."); }, color: "#60a5fa" },
  { get name() { return tx("Sugerir"); }, get description() { return tx("Pode editar e rodar comandos, mas pede sua aprovação a cada um."); }, color: "#a78bfa" },
  { get name() { return tx("Editar"); }, get description() { return tx("Edita arquivos quando você pede. Comandos pedem aprovação."); }, color: "#fbbf24" },
  { get name() { return tx("Total"); }, get description() { return tx("Edita e roda comandos sozinha quando você pede."); }, color: "#f87171" },
];

// conversas de exemplo no navegador (o app lê as de verdade do disco)
const DAY = 86_400_000;
const demoConvos = (): Convo[] =>
  [
    [tx("Diferença entre RAM e armazenamento"), 25 * 60_000],
    [tx("E-mail pedindo mais prazo"), 3 * 3_600_000],
    [tx("PDFs que baixei esta semana"), DAY + 2 * 3_600_000],
    [tx("Plano de estudos de Git"), 3 * DAY],
    [tx("Receita de pão de fermentação natural"), 9 * DAY],
    [tx("Como funciona o DNS"), 40 * DAY],
  ].map(([title, ago], i) => ({ id: `demo-${i}`, kind: "claude", account: freeAccountId(), title: title as string, lastPrompt: null, origin: null, updated: Date.now() - (ago as number), bytes: 0 }));

export async function listLivre() {
  if (!isTauri) {
    // a conversa em curso entra no histórico, como no app depois da primeira resposta
    const first = livre.items.find((it): it is Extract<Item, { t: "user" }> => it.t === "user");
    const now: Convo[] = !livre.conv && first ? [{ id: "agora", kind: "claude", account: freeAccountId(), title: first.text.split("\n")[0].slice(0, 70), lastPrompt: null, origin: null, updated: Date.now(), bytes: 0 }] : [];
    return { items: [...now, ...demoConvos()], current: livre.conv ? `${livre.conv.kind}:${livre.conv.id}` : now.length ? "claude:agora" : null };
  }
  const r = await invoke<{ items: Convo[]; current: [string, string] | null }>("chat_conversations", { projectId: LIVRE });
  return { items: r.items, current: r.current ? `${r.current[0]}:${r.current[1]}` : null };
}

/** Retoma uma conversa do Chat livre (troca para a conta dela, se precisar). */
export async function openLivre(c: Convo) {
  if (livre.busy) return showToast(tx("Espere a resposta terminar (ou pare) antes de trocar de conversa"));
  if (!isTauri) {
    setLivre({ items: [], draft: "", perms: [], error: null, conv: { kind: c.kind, id: c.id, title: c.title }, context: null });
    push({ key: key("u"), t: "user", text: c.title, at: c.updated });
    push({ key: key("s"), t: "say", text: tx("Esta é uma conversa de exemplo: no app, cada conversa guardada volta inteira, do jeito que ficou."), account: c.account });
    return relist();
  }
  try {
    if (c.account !== freeAccountId()) await updateSettings({ freeAccount: c.account });
    const evs = await invoke<AgentEvent[]>("chat_open", { projectId: LIVRE, kind: c.kind, id: c.id, account: c.account });
    // lastAt: quando ela parou (o aviso de "parada há…" mostra que a próxima mensagem relê tudo)
    setLivre({ items: [], draft: "", perms: [], error: null, conv: { kind: c.kind, id: c.id, title: c.title }, context: c.context ?? null, lastAt: c.updated || null });
    nextConv();
    for (const e of evs) {
      if (e.kind === "user") push({ key: `u-${e.id}`, t: "user", text: e.title, at: e.ts });
      else if (e.kind === "say") push({ key: `s-${e.id}`, t: "say", text: e.title, account: c.account });
      else if (e.kind === "done") push({ key: `d-${e.id}`, t: "done", ok: true, detail: null, account: c.account, at: e.ts });
      else step(e);
    }
    relist();
  } catch (e) {
    showToast(errMsg(e));
  }
}

// ---------------------------------------------------------------- navegador (demonstração)

function demoReply(text: string) {
  const ev = (id: string, kind: AgentEvent["kind"], title: string, status: AgentEvent["status"], detail: string | null = null): AgentEvent => ({
    id, session: "demo", account: freeAccountId(), sub: null, subLabel: null, kind, title, detail, path: null, status, output: [], ts: Date.now(), history: false,
  });
  const at = (ms: number, f: () => void) => setTimeout(() => livre.busy && f(), ms);
  const pc = /arquivo|pasta|pdf|download|desktop|documents|área de trabalho|file|folder/i.test(text);
  if (pc) {
    at(500, () => step(ev("d1", "search", tx("Procurando ~/Downloads/*.pdf"), "running")));
    at(1300, () => step(ev("d1", "result", "", "ok", tx("3 arquivos"))));
    at(1500, () => step(ev("d2", "read", tx("Lendo ~/Downloads/contrato-aluguel.pdf"), "running")));
    at(2300, () => step(ev("d2", "result", "", "ok", tx("4 páginas"))));
  }
  const answer = pc
    ? tx("Achei **3 PDFs** em `Downloads`. O mais recente é `contrato-aluguel.pdf`:\n\n- Prazo de **30 meses**, a partir de março\n- Reajuste anual pelo IPCA\n- Multa de 3 aluguéis se sair antes de 12 meses\n\nQuer que eu procure mais alguma coisa nele?")
    : tx("Boa pergunta! Em resumo:\n\n1. **{v}** depende do contexto.\n2. Um exemplo rápido:\n\n```js\nconsole.log(\"olá do Chat livre\");\n```\n\nQuer que eu detalhe alguma parte?", { v: text.slice(0, 40) });
  const start = pc ? 2500 : 600;
  let i = 0;
  const tick = () => {
    if (!livre.busy) return;
    i = Math.min(answer.length, i + 6);
    setLivre("draft", answer.slice(0, i));
    if (i < answer.length) setTimeout(tick, 18);
    else {
      handleLivre({ kind: "say", key: `demo-${Date.now()}`, text: answer });
      handleLivre({ kind: "done", ok: true, detail: pc ? tx("3 s · 2 passos") : "1 s" });
    }
  };
  at(start, tick);
}
