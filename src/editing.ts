// Edição de arquivos dos projetos reais, com salvamento automático (como no celular: escreveu,
// está salvo). Guarda o rascunho por projeto+arquivo fora do `ws`, então trocar de projeto ou
// fechar a aba no meio do caminho não perde nada: o que falta gravar é gravado antes.

import { createStore } from "solid-js/store";
import { api } from "./api";
import { projectId, setWs, showToast, ws } from "./store";
import { tx } from "./i18n";

const AUTOSAVE_MS = 700;

type Status = "editing" | "saving" | "saved" | "error";
interface Draft {
  text: string;
  status: Status;
  error?: string;
  savedAt?: number;
}

const key = (pid: string, path: string) => `${pid}\u0000${path}`;
export const [drafts, setDrafts] = createStore<Record<string, Draft>>({});
const timers = new Map<string, number>();
/** arquivos que a própria pessoa acabou de gravar (o observador de disco não conta como "outro programa") */
const ownWrites = new Map<string, number>();

export const draftOf = (path: string, pid = projectId()) => drafts[key(pid, path)];
/** Tem mudança ainda não gravada no disco. */
export const isUnsaved = (path: string, pid = projectId()) => {
  const d = draftOf(path, pid);
  return !!d && (d.status === "editing" || d.status === "saving" || d.status === "error");
};
export const savedByMe = (pid: string, path: string) => {
  const now = Date.now();
  if (now - (ownWrites.get(key(pid, path)) ?? 0) < 3000) return true;
  // dentro de uma pasta que a pessoa acabou de criar/renomear/apagar
  for (const [k, t] of ownWrites) {
    const [p, base] = k.split("\u0000");
    if (p === pid && now - t < 3000 && path.startsWith(`${base}/`)) return true;
  }
  return false;
};
/** A pessoa mexeu neste caminho pelo Veocode (criar, renomear, apagar): não é "outro programa". */
export const markOwn = (pid: string, ...paths: string[]) => paths.forEach((p) => ownWrites.set(key(pid, p), Date.now()));

/** A pessoa digitou: guarda e agenda a gravação. */
export function edit(path: string, text: string) {
  const pid = projectId();
  const k = key(pid, path);
  setDrafts(k, { text, status: "editing" });
  clearTimeout(timers.get(k));
  timers.set(k, window.setTimeout(() => void save(pid, path), AUTOSAVE_MS));
}

/** Grava agora (⌘S, fechar a aba, trocar de projeto). */
async function save(pid: string, path: string): Promise<boolean> {
  const k = key(pid, path);
  clearTimeout(timers.get(k));
  timers.delete(k);
  const d = drafts[k];
  if (!d || d.status === "saved") return true;
  const text = d.text;
  setDrafts(k, "status", "saving");
  try {
    ownWrites.set(k, Date.now());
    await api.writeFile(pid, path, text);
    ownWrites.set(k, Date.now());
    // digitou de novo enquanto gravava: a próxima gravação já está agendada
    if (drafts[k]?.text === text) setDrafts(k, { text, status: "saved", savedAt: Date.now() });
    if (pid === projectId()) setWs("contents", path, { kind: "text", text, size: new TextEncoder().encode(text).length });
    return true;
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    setDrafts(k, { ...drafts[k], status: "error", error: msg });
    showToast(tx("Não salvou {pop}: {msg}", { pop: path.split("/").pop(), msg }));
    return false;
  }
}

export const saveNow = (path: string) => save(projectId(), path);

/** Grava tudo o que está pendente (de todos os projetos). */
export async function saveAll(): Promise<boolean> {
  const pending = Object.entries(drafts).filter(([, d]) => d.status === "editing" || d.status === "error");
  const res = await Promise.all(pending.map(([k]) => {
    const [pid, path] = k.split("\u0000");
    return save(pid, path);
  }));
  return res.every(Boolean);
}

/** Esquece o rascunho (depois de gravado ou ao recarregar do disco). */
export function dropDraft(path: string, pid = projectId()) {
  const k = key(pid, path);
  clearTimeout(timers.get(k));
  timers.delete(k);
  setDrafts(k, undefined!);
}

/** Arquivo renomeado: o rascunho acompanha. */
export function moveDraft(from: string, to: string, pid = projectId()) {
  const d = drafts[key(pid, from)];
  if (!d) return;
  dropDraft(from, pid);
  setDrafts(key(pid, to), d);
  if (d.status !== "saved") edit(to, d.text);
}

/** O que o editor mostra: o rascunho, senão o texto do disco. */
export function textOf(path: string): string | null {
  const d = draftOf(path);
  if (d) return d.text;
  const v = ws.contents[path];
  return v?.kind === "text" ? v.text : null;
}

// se a janela perder o foco, grava na hora (fechar o app logo depois não perde nada)
if (typeof window !== "undefined") {
  window.addEventListener("blur", () => void saveAll());
  document.addEventListener("visibilitychange", () => document.hidden && void saveAll());
}
