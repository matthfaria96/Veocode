// Limites do plano do Claude (janela de 5 horas e semana), lidos da Anthropic pelo app sem gastar
// tokens. Também avisa quando a conta em uso passa de 75%, 90% e quando bate o limite.
import { invoke } from "@tauri-apps/api/core";
import { createStore } from "solid-js/store";
import { accountById, accts } from "./accounts";
import { isTauri } from "./api";
import { every } from "./every";
import { projects, showToast } from "./store";
import { settings } from "./settings";
import { locale, tx } from "./i18n";

export type Win = { pct: number; resetsAt: string | null };
export type Limits = { fiveHour: Win | null; week: Win | null; models: [string, Win][]; at: number; error: string | null; note?: string | null; source?: string };

// a última leitura boa de cada conta fica guardada: abrir o app já mostra o número de antes
const STORE_KEY = "veocode.limits.last";
const saved = (): Record<string, Limits> => {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}");
  } catch {
    return {};
  }
};
const [limits, setLimits] = createStore<Record<string, Limits>>(saved());
export { limits };
const loading = new Set<string>();
const hasNumbers = (l?: Limits) => !!l && !l.error && (!!l.fiveHour || !!l.week);
function save(id: string, l: Limits) {
  setLimits(id, l);
  if (!hasNumbers(l)) return;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ ...saved(), [id]: l }));
  } catch {
    /* sem armazenamento: só não lembra ao reabrir */
  }
}

/** Chegou do próprio Claude Code, junto com uma resposta (o mais confiável e não custa nada). */
export function applyLimits(id: string, l: Limits) {
  save(id, l);
  alertFor(id, l);
}

const mock = (id: string): Limits => {
  const h = (n: number) => new Date(Date.now() + n * 3600_000).toISOString();
  const i = accts.list.findIndex((a) => a.id === id);
  return { fiveHour: { pct: [12, 64, 0][i % 3], resetsAt: h(3) }, week: { pct: [48, 91, 100][i % 3], resetsAt: h(30) }, models: [], at: Date.now() / 1000 - 140, error: null, source: "claude" };
};

export async function loadLimits(id: string, force = false) {
  const a = accts.list.find((x) => x.id === id);
  if (!a || a.provider !== "claude" || loading.has(id)) return;
  loading.add(id);
  try {
    const l = isTauri ? await invoke<Limits>("account_limits", { id, force }) : mock(id);
    const before = limits[id];
    // falhou agora, mas já tinha número (de antes de abrir o app): mantém o número e avisa
    if (!hasNumbers(l) && hasNumbers(before)) setLimits(id, { ...before, note: l.error ?? l.note ?? null });
    else save(id, l);
    if (hasNumbers(l)) alertFor(id, l);
  } catch (e) {
    if (hasNumbers(limits[id])) setLimits(id, "note", String(e));
    else setLimits(id, { fiveHour: null, week: null, models: [], at: Date.now() / 1000, error: String(e) });
  } finally {
    loading.delete(id);
  }
}

export const refreshLimits = (force = false) => Promise.all(accts.list.filter((a) => a.provider === "claude").map((a) => loadLimits(a.id, force)));

/** O maior dos dois (5 h ou semana): é ele que segura a conta. */
export function peak(id: string): { pct: number; win: "5h" | "semana"; resetsAt: string | null } | null {
  const l = limits[id];
  if (!l || l.error) return null;
  const f = l.fiveHour?.pct ?? -1;
  const w = l.week?.pct ?? -1;
  if (f < 0 && w < 0) return null;
  return w >= f ? { pct: w, win: "semana", resetsAt: l.week!.resetsAt } : { pct: f, win: "5h", resetsAt: l.fiveHour!.resetsAt };
}

export type Tone = "ok" | "warn" | "hot" | "full";
export const toneOf = (pct: number): Tone => (pct >= 100 ? "full" : pct >= 90 ? "hot" : pct >= 75 ? "warn" : "ok");

const hm = (d: Date) => d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
/** "em 40 min", "em 3 h", "amanhã às 22:00", "sex, 20/11 às 22:00" */
export function whenText(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return tx("agora");
  if (ms < 3600_000) return tx("em {v} min", { v: Math.max(1, Math.round(ms / 60_000)) });
  if (ms < 6 * 3600_000) return tx("em {v} h", { v: Math.round(ms / 3600_000) });
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === new Date().toDateString()) return tx("hoje às {v}", { v: hm(d) });
  if (d.toDateString() === tomorrow.toDateString()) return tx("amanhã às {v}", { v: hm(d) });
  const day = d.toLocaleDateString(locale(), { weekday: "short", day: "2-digit", month: "2-digit" }).replace(/\./g, "");
  return tx("{day} às {time}", { day, time: hm(d) });
}

// ---------------------------------------------------------------- avisos

const SEEN_KEY = "veocode.limits.seen";
const seen = (() => {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]"));
  } catch {
    return new Set<string>();
  }
})();
const remember = (k: string) => {
  seen.add(k);
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-80)));
  } catch {
    /* sem armazenamento: pode repetir o aviso */
  }
};

/** Conta em uso: algum projeto ou o Chat livre usa ela. */
const inUse = (id: string) => projects.some((p) => !p.demo && p.accountId === id) || settings.freeAccount === id;

function alertFor(id: string, l: Limits) {
  if (!inUse(id) || l.error) return;
  const name = accountById(id).label;
  for (const [win, w, label] of [["5h", l.fiveHour, tx("das 5 horas")], ["semana", l.week, tx("semanal")]] as const) {
    if (!w) continue;
    // um aviso por faixa e por ciclo (o ciclo muda quando muda a hora de zerar)
    const cycle = w.resetsAt?.slice(0, 13) ?? "";
    const step = w.pct >= 100 ? 100 : w.pct >= 90 ? 90 : w.pct >= 75 ? 75 : 0;
    if (!step) continue;
    const k = `${id}:${win}:${cycle}:${step}`;
    if (seen.has(k)) continue;
    remember(k);
    // passou direto de faixa? marca as de baixo também, para não avisar 75% depois de 100%
    for (const s of [75, 90]) if (s < step) remember(`${id}:${win}:${cycle}:${s}`);
    const when = whenText(w.resetsAt);
    showToast(
      step === 100
        ? tx("{name} bateu o limite {label}{v}. Troque de conta no chat para continuar.", { name, label, v: when ? ` · volta ${when}` : "" })
        : tx("{name} já usou {v}% do limite {label}{v2}", { name, v: Math.round(w.pct), label, v2: when ? ` · ${tx("zera {v}", { v: when })}` : "" }),
    );
  }
}

/** Lê os limites de tempos em tempos (5 min) e logo ao abrir. */
export function startLimitWatch(): () => void {
  void refreshLimits();
  return every(() => void refreshLimits(), 300_000);
}

/** "agora", "há 3 min", "há 2 h" */
export function agoText(secs: number): string {
  const s = Math.max(0, Date.now() / 1000 - secs);
  if (s < 50) return tx("agora");
  if (s < 3600) return tx("há {v} min", { v: Math.round(s / 60) });
  if (s < 86400) return tx("há {v} h", { v: Math.round(s / 3600) });
  return tx("há {v} dia(s)", { v: Math.round(s / 86400) });
}

// ---------------------------------------------------------------- aviso de limite no chat

/** "You've hit your weekly limit · resets Nov 20 at 10pm (America/Sao_Paulo)" → tipo de limite. */
export function limitHit(text: string): { win: "semana" | "5h" | "outro"; raw: string } | null {
  const m = /hit your ([\w -]*?)\s*limit/i.exec(text) ?? /usage limit reached/i.exec(text);
  if (!m || text.length > 400) return null;
  const k = (m[1] ?? "").toLowerCase();
  return { win: k.includes("week") ? "semana" : k.includes("session") || k.includes("5") || k.includes("hour") ? "5h" : "outro", raw: text };
}
