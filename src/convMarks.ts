// Marcas da lista de conversas (modo IA), como no Claude: fixadas (sobem para o topo do projeto),
// arquivadas (saem da lista sem apagar nada) e não lidas (a resposta chegou enquanto você
// olhava outra coisa). A chave é o id da linha na lista (a sessão, ou a aba enquanto não tem).
// Fica neste computador.
import { createStore } from "solid-js/store";

type Marks = Record<string, number>;

const read = (k: string): Marks => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? "{}") ?? {};
  } catch {
    return {};
  }
};
const write = (k: string, v: Marks) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* sem armazenamento: só não lembra */
  }
};

function marks(key: string) {
  const [m, setM] = createStore<Marks>(read(key));
  const has = (id: string | null | undefined) => !!id && !!m[id];
  const set = (id: string, on: boolean) => {
    if (!id || has(id) === on) return;
    setM(id, on ? Date.now() : undefined!);
    write(key, { ...m });
  };
  return [has, set] as const;
}

export const [isPinned, setPinned] = marks("veocode.conv.pinned");
export const [isArchived, setArchived] = marks("veocode.conv.archived");
export const [isUnread, setUnread] = marks("veocode.conv.unread");
