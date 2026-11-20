// Grupos de conversas no modo IA, como as pastas do gerenciador de sessões do Claude: dentro de
// cada projeto, um nome para juntar as conversas de um mesmo assunto ("Login novo", "Bugs do
// checkout"). A conversa entra pelo menu dela (Mover para o grupo). Fica neste computador.
import { createSignal } from "solid-js";
import { createStore, produce } from "solid-js/store";

export interface ConvGroup {
  id: string;
  name: string;
  open: boolean;
}
type State = { groups: Record<string, ConvGroup[]>; of: Record<string, string> };

const KEY = "veocode.conv.groups";
const read = (): State => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (v && typeof v === "object" && v.groups && v.of) return v;
  } catch {
    /* sem armazenamento */
  }
  return { groups: {}, of: {} };
};
const [st, setSt] = createStore<State>(read());
const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(st));
  } catch {
    /* só não lembra */
  }
};

/** Grupo que acabou de nascer: o nome dele abre para escrever. */
export const [namingGroup, setNamingGroup] = createSignal<string | null>(null);

export const groupsOf = (pid: string): ConvGroup[] => st.groups[pid] ?? [];

/** O grupo da conversa, se ele ainda existe no projeto. */
export const groupOf = (pid: string, conv: string): string | null => {
  const g = st.of[conv];
  return g && groupsOf(pid).some((x) => x.id === g) ? g : null;
};

export function addGroup(pid: string, name = ""): string {
  const id = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  setSt("groups", pid, (l) => [...(l ?? []), { id, name: name.trim(), open: true }]);
  save();
  setNamingGroup(id);
  return id;
}

export function renameGroup(pid: string, id: string, name: string) {
  const n = name.trim().slice(0, 60);
  setSt("groups", pid, (g) => g.id === id, "name", n);
  save();
}

export function toggleGroup(pid: string, id: string, open?: boolean) {
  setSt("groups", pid, (g) => g.id === id, "open", (o) => open ?? !o);
  save();
}

/** Desfaz o grupo: as conversas voltam para a lista do projeto (nada é apagado). */
export function removeGroup(pid: string, id: string) {
  setSt(produce((s) => {
    s.groups[pid] = (s.groups[pid] ?? []).filter((g) => g.id !== id);
    for (const k of Object.keys(s.of)) if (s.of[k] === id) delete s.of[k];
  }));
  save();
}

export function moveToGroup(conv: string, group: string | null) {
  setSt(produce((s) => {
    if (group) s.of[conv] = group;
    else delete s.of[conv];
  }));
  save();
}
