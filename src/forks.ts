// Bifurcações de conversa: de qual conversa cada ramo saiu (para a lista pendurar o ramo
// embaixo da original) e os nomes que você deu às conversas. Fica neste computador.
// O Claude também deixa pista no histórico (o ramo copia as mensagens com os mesmos ids), e a
// lista usa isso para ramos feitos fora do Veocode; aqui ficam os feitos por aqui.
import { createStore } from "solid-js/store";

const FORKS = "veocode.forks";
const NAMES = "veocode.convnames";

const read = (k: string): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? "{}") ?? {};
  } catch {
    return {};
  }
};
const write = (k: string, v: Record<string, string>) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* sem armazenamento: só não lembra */
  }
};

// ramo (sessão nova, ou a aba enquanto ela ainda não tem sessão) → sessão de onde saiu
const [forks, setForks] = createStore<Record<string, string>>(read(FORKS));
export const forkParentOf = (id: string | null | undefined): string | undefined => (id ? forks[id] : undefined);
export function setForkParent(child: string, parent: string) {
  if (!child || child === parent) return;
  setForks(child, parent);
  write(FORKS, { ...forks });
}

// sessão → nome dado por você (vale na lista, no topo da conversa e depois de reabrir)
const [names, setNames] = createStore<Record<string, string>>(read(NAMES));
export const customName = (session: string | null | undefined): string | undefined => (session ? names[session] : undefined);
export function setCustomName(session: string, title: string) {
  const t = title.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!session || !t) return;
  setNames(session, t);
  write(NAMES, { ...names });
}

// sessão de um ramo → quando ele nasceu: o histórico do ramo traz de novo as mensagens copiadas
// da original (com a data delas); o que for de antes disso já está na tela e não se repete
const since = new Map<string, number>();
export const markForkBorn = (session: string, at: number) => since.set(session, at);
export const copiedFromParent = (session: string | undefined, ts: number) => {
  const t = session ? since.get(session) : undefined;
  return t !== undefined && ts > 0 && ts < t;
};
