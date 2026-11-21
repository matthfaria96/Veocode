// Janelas por cima de tudo (com o fundo borrado) para o que se consulta da caixa de mensagem:
// nível de acesso, memória do projeto e contexto da conversa. Uma de cada vez; o desenho fica em
// components/Modal.tsx e quem abre cada uma, em components/ChatModals.tsx.
import { createSignal } from "solid-js";

export type ModalKind = "access" | "memory" | "context" | "map";
export interface ModalReq {
  kind: ModalKind;
  pid: string;
  /** conversa (aba) do contexto */
  k?: string;
}

export const [modal, setModal] = createSignal<ModalReq | null>(null);
export const closeModal = () => setModal(null);
export const isOpen = (kind: ModalKind, pid?: string) => modal()?.kind === kind && (!pid || modal()?.pid === pid);
export const openAccess = (pid: string) => setModal({ kind: "access", pid });
export const openMemory = (pid: string) => setModal({ kind: "memory", pid });
/** Fazer ou refazer o mapa do projeto (do código ou com a IA). */
export const openMapMaker = (pid: string) => setModal({ kind: "map", pid });
