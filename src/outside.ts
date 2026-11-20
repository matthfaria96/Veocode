// Conversas do Claude rodando por fora do Veocode (Terminal, editor, app do Claude). O arquivo da
// conversa só conta o que já aconteceu, então "está trabalhando" é deduzido dele: o último pedido
// ainda não terminou (nem "Terminou", nem parado) e há um passo rodando ou algo novo há pouco.
// Assim a linha viva, o cronômetro e o botão Parar aparecem também nessas conversas.
import { createMemo, createRoot, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import { isTauri, type AgentGroup } from "./api";
import { ws, type ActivityEvent } from "./store";

// pedidos parados no meio ("[Request interrupted…]"): sessão → quando
const [stops, setStops] = createStore<Record<string, number>>({});
export const markStopped = (session: string | null | undefined, ts: number) => {
  if (session && ts > (stops[session] ?? 0)) setStops(session, ts);
};

/** Sem nada novo por 4 min e sem passo rodando: ela parou de trabalhar (ou foi fechada). */
const QUIET = 4 * 60_000;
/** Um comando pode rodar bastante; passado disso, ninguém está esperando por ele. */
const LONG = 30 * 60_000;

/** O pedido em curso, se a conversa parece estar trabalhando agora. */
export function outsideTurn(events: ActivityEvent[], now: number): { since: number; step: ActivityEvent | null; session?: string } | null {
  let i = events.length - 1;
  let step: ActivityEvent | null = null;
  let last = 0;
  for (; i >= 0; i--) {
    const e = events[i];
    if (e.kind === "done") return null;
    if (e.kind === "user") break;
    last = Math.max(last, e.ts ?? 0);
    if (!step && e.status === "running" && e.kind !== "say" && e.kind !== "think" && e.kind !== "compact") step = e;
  }
  if (i < 0) return null;
  const user = events[i];
  const since = user.ts ?? 0;
  // parada depois do pedido (e nada novo depois disso: se parou a errada, a certa continua aparecendo)
  const stop = user.session ? (stops[user.session] ?? 0) : 0;
  if (!since || (stop >= since && last <= stop)) return null;
  const age = now - Math.max(last, since);
  return age < (step ? LONG : QUIET) ? { since, step, session: user.session } : null;
}

// relógio de 5 s para a lista de conversas (a linha viva tem o dela, de 1 s)
const [tick, setTick] = createSignal(Date.now());
setInterval(() => setTick(Date.now()), 5000);

/** Sessões do projeto da frente trabalhando por fora agora (para a bolinha girando na lista). */
export const outsideBusy = createRoot(() =>
  createMemo(() => {
    const now = tick();
    const by = new Map<string, ActivityEvent[]>();
    for (const e of ws.events) {
      if (!e.session || e.tab || e.sub) continue;
      const l = by.get(e.session);
      if (l) l.push(e);
      else by.set(e.session, [e]);
    }
    const out = new Set<string>();
    for (const [s, l] of by) if (outsideTurn(l, now)) out.add(s);
    return out;
  }),
);

// ---------------------------------------------------------------- parar

const demoAgents = (): AgentGroup[] => [
  { pid: 4242, agent: "claude", cwd: "~/projetos/demo", cpu: 14, mem: 380 * 2 ** 20, runSecs: 47 * 60, ports: [], children: [], host: "Terminal" },
];

/** As IAs abertas na pasta do projeto por fora do Veocode. */
export const outsideAgents = (pid: string): Promise<AgentGroup[]> => (isTauri ? invoke<AgentGroup[]>("outside_agents", { projectId: pid }) : Promise.resolve(demoAgents()));

/** Interrompe a IA e, se ela não fechar em 3 s, encerra com tudo o que ela abriu. */
export const outsideStop = (pid: string, agent: number): Promise<void> => (isTauri ? invoke("outside_stop", { projectId: pid, pid: agent }) : Promise.resolve());
