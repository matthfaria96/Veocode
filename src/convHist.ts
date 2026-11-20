// Conversas anteriores de cada projeto (sessões do Claude e conversas com APIs), lidas do disco
// pelo Rust. Guardadas aqui para a lista, o topo da conversa e as abas usarem a mesma leitura.
// Ler não trava a tela: nada de Suspense, a lista anterior fica enquanto a nova chega.
import { createStore, produce } from "solid-js/store";
import { isTauri } from "./api";
import { listConversations, type Convo } from "./chat";
import { projects } from "./store";

type Hist = { items: Convo[]; loading: boolean; at: number; error: string | null };
const [hist, setHist] = createStore<Record<string, Hist>>({});
const inflight = new Map<string, Promise<void>>();

/** Lista já lida (vazia enquanto a primeira leitura não chega). */
export const histOf = (pid: string): Convo[] => hist[pid]?.items ?? [];
export const histLoading = (pid: string) => !!hist[pid]?.loading;
export const histLoaded = (pid: string) => (hist[pid]?.at ?? 0) > 0;
export const histFind = (pid: string, id: string | null | undefined) => (id ? histOf(pid).find((c) => c.id === id) : undefined);

/** Lê de novo (se a última leitura tiver mais de `maxAge` ms). Leituras ao mesmo tempo viram uma. */
export function loadHist(pid: string, maxAge = 10_000): Promise<void> {
  const p = projects.find((x) => x.id === pid);
  if (!isTauri || !p || p.demo) return Promise.resolve();
  const h = hist[pid];
  if (h && h.at && Date.now() - h.at < maxAge) return Promise.resolve();
  const running = inflight.get(pid);
  if (running) return running;
  if (!h) setHist(pid, { items: [], loading: true, at: 0, error: null });
  else setHist(pid, "loading", true);
  const job = listConversations(pid)
    .then((r) => setHist(pid, { items: r.items, loading: false, at: Date.now(), error: null }))
    .catch((e) => setHist(pid, produce((x) => ((x.loading = false), (x.at = Date.now()), (x.error = String(e))))))
    .finally(() => inflight.delete(pid));
  inflight.set(pid, job);
  return job;
}

/** Conversa apagada ou renomeada por aqui: a lista muda já, sem esperar a próxima leitura. */
export const dropFromHist = (pid: string, ids: string[]) => hist[pid] && setHist(pid, "items", (l) => l.filter((c) => !ids.includes(c.id)));

/** Modo navegador (capturas de tela e testes): uma lista de conversas de exemplo. */
export const seedHist = (pid: string, items: Convo[]) => setHist(pid, { items, loading: false, at: Date.now(), error: null });
