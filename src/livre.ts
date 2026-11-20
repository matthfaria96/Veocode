// Chat livre: conversa sem projeto. O Rust usa a mesma máquina dos chats de projeto com o id
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
  | { key: string; t: "user"; text: string }
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
}

export const [livre, setLivre] = createStore<Livre>({ items: [], draft: "", busy: false, perms: [], error: null, input: "", conv: null });

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
      if (e.detail) s.detail = e.detail;
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
    case "done":
      setLivre(produce((c) => {
        c.busy = false;
        c.draft = "";
        c.perms = [];
        // passo que ficou "rodando" (resposta interrompida) não roda mais
        for (const it of c.items) if (it.t === "work") for (const s of it.steps) if (s.status === "running") s.status = e.ok ? "ok" : "error";
      }));
      push({ key: key("d"), t: "done", ok: e.ok, detail: e.detail, account: freeAccountId(), at: Date.now() });
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
  push({ key: key("u"), t: "user", text: shown });
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
  if (isTauri) await invoke("chat_reset", { projectId: LIVRE }).catch(() => {});
  setLivre({ items: [], draft: "", busy: false, perms: [], error: null, conv: null });
}

/** Troca a conta: a próxima mensagem começa uma conversa nova com ela. */
export async function setFreeAccount(id: string) {
  if (id === freeAccountId() || livre.busy) return;
  await updateSettings({ freeAccount: id });
  if (livre.items.length) {
    if (isTauri) await invoke("chat_reset", { projectId: LIVRE }).catch(() => {});
    setLivre("conv", null);
    push({ key: key("n"), t: "note", text: tx("Agora com {label}: a próxima mensagem começa uma conversa nova.", { label: accountById(id).label }) });
  }
}

/** Liga ou desliga o "olhar o computador". A conversa continua. */
export async function setFreePc(on: boolean) {
  if (on === settings.freePc || livre.busy) return;
  await updateSettings({ freePc: on });
  if (livre.items.length) push({ key: key("n"), t: "note", text: on ? tx("Agora pode olhar o computador (só leitura).") : tx("Agora só conversa: sem olhar os arquivos.") });
}

export async function listLivre() {
  if (!isTauri) return { items: [] as Convo[], current: null as string | null };
  const r = await invoke<{ items: Convo[]; current: [string, string] | null }>("chat_conversations", { projectId: LIVRE });
  return { items: r.items, current: r.current ? `${r.current[0]}:${r.current[1]}` : null };
}

/** Retoma uma conversa do Chat livre (troca para a conta dela, se precisar). */
export async function openLivre(c: Convo) {
  if (livre.busy) return showToast(tx("Espere a resposta terminar (ou pare) antes de trocar de conversa"));
  try {
    if (c.account !== freeAccountId()) await updateSettings({ freeAccount: c.account });
    const evs = await invoke<AgentEvent[]>("chat_open", { projectId: LIVRE, kind: c.kind, id: c.id, account: c.account });
    setLivre({ items: [], draft: "", perms: [], error: null, conv: { kind: c.kind, id: c.id, title: c.title } });
    for (const e of evs) {
      if (e.kind === "user") push({ key: `u-${e.id}`, t: "user", text: e.title });
      else if (e.kind === "say") push({ key: `s-${e.id}`, t: "say", text: e.title, account: c.account });
      else if (e.kind === "done") push({ key: `d-${e.id}`, t: "done", ok: true, detail: null, account: c.account, at: e.ts });
      else step(e);
    }
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
  if (settings.freePc) {
    at(500, () => step(ev("d1", "search", tx("Procurando ~/Downloads/*.pdf"), "running")));
    at(1300, () => step(ev("d1", "result", "", "ok", tx("3 arquivos"))));
    at(1500, () => step(ev("d2", "read", tx("Lendo ~/Downloads/contrato-aluguel.pdf"), "running")));
    at(2300, () => step(ev("d2", "result", "", "ok", tx("4 páginas"))));
  }
  const answer = settings.freePc
    ? tx("Achei **3 PDFs** em `Downloads`. O mais recente é `contrato-aluguel.pdf`:\n\n- Prazo de **30 meses**, a partir de março\n- Reajuste anual pelo IPCA\n- Multa de 3 aluguéis se sair antes de 12 meses\n\nQuer que eu procure mais alguma coisa nele?")
    : tx("Boa pergunta! Em resumo:\n\n1. **{v}** depende do contexto.\n2. Um exemplo rápido:\n\n```js\nconsole.log(\"olá do Chat livre\");\n```\n\nQuer que eu detalhe alguma parte?", { v: text.slice(0, 40) });
  const start = settings.freePc ? 2500 : 600;
  let i = 0;
  const tick = () => {
    if (!livre.busy) return;
    i = Math.min(answer.length, i + 6);
    setLivre("draft", answer.slice(0, i));
    if (i < answer.length) setTimeout(tick, 18);
    else {
      handleLivre({ kind: "say", key: `demo-${Date.now()}`, text: answer });
      handleLivre({ kind: "done", ok: true, detail: settings.freePc ? tx("3 s · 2 passos") : "1 s" });
    }
  };
  at(start, tick);
}
