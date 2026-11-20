// Sessões do Claude Code na nuvem (claude.ai/code): rodam nos servidores da Anthropic e continuam
// com o computador desligado. O Claude Code ainda não tem um jeito de listar todas daqui, então o
// Veocode faz o que dá de verdade: começa uma (claude --cloud), acompanha uma pelo link, traz uma
// para este computador (claude --teleport) e lembra as que passaram por aqui.
import { createStore } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./api";
import { showToast } from "./store";
import { tx } from "./i18n";

export interface CloudSession {
  /** id da sessão na nuvem, quando se sabe (aberta pelo link) */
  sid?: string;
  title: string;
  at: number;
}

const KEY = "veocode.cloud";
const read = (): Record<string, CloudSession[]> => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
};
const [st, setSt] = createStore<Record<string, CloudSession[]>>(read());
const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(st));
  } catch {
    /* só não lembra */
  }
};

export const CLOUD_URL = "https://claude.ai/code";
export const cloudOf = (pid: string): CloudSession[] => st[pid] ?? [];
export const sessionUrl = (sid: string) => `${CLOUD_URL}/${sid}`;

/** O id de uma sessão a partir do link (claude.ai/code/…) ou do próprio id. */
export function parseSession(raw: string): string | null {
  const t = raw.trim().replace(/[?#].*$/, "").replace(/\/+$/, "");
  const last = t.split("/").pop() ?? "";
  return /^[A-Za-z0-9_-]{6,120}$/.test(last) ? last : null;
}

function remember(pid: string, s: CloudSession) {
  setSt(pid, (l) => [s, ...(l ?? []).filter((x) => !(s.sid ? x.sid === s.sid : !x.sid && x.title === s.title))].slice(0, 30));
  save();
}
export function forgetCloud(pid: string, s: CloudSession) {
  setSt(pid, (l) => (l ?? []).filter((x) => x !== s));
  save();
}

async function launch(pid: string, args: { cloud?: string; teleport?: string }) {
  if (!isTauri) return void showToast(tx("No navegador isto só mostra como fica: no app, abre o Terminal com o Claude."));
  await invoke("open_claude", { projectId: pid, resume: null, cloud: args.cloud ?? null, teleport: args.teleport ?? null });
}

/** Começa uma sessão na nuvem com este pedido (abre o Terminal com claude --cloud). */
export async function startCloud(pid: string, task: string) {
  const t = task.trim();
  if (!t) return;
  try {
    await launch(pid, { cloud: t });
    remember(pid, { title: t.slice(0, 160), at: Date.now() });
    showToast(tx("Abrindo o Terminal para começar a sessão na nuvem…"));
  } catch (e) {
    showToast(String(e instanceof Error ? e.message : e));
  }
}

/** Acompanha uma sessão da nuvem no Terminal (ela continua rodando lá). */
export async function attachCloud(pid: string, sid: string, title?: string) {
  try {
    await launch(pid, { cloud: sid });
    remember(pid, { sid, title: title ?? sid, at: Date.now() });
    showToast(tx("Abrindo a sessão da nuvem no Terminal…"));
  } catch (e) {
    showToast(String(e instanceof Error ? e.message : e));
  }
}

/** Traz a sessão para este computador: ela passa a rodar aqui e aparece em Local. */
export async function teleportCloud(pid: string, sid: string, title?: string) {
  try {
    await launch(pid, { teleport: sid });
    remember(pid, { sid, title: title ?? sid, at: Date.now() });
    showToast(tx("Trazendo a sessão para este computador no Terminal…"));
  } catch (e) {
    showToast(String(e instanceof Error ? e.message : e));
  }
}
