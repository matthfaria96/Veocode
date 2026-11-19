// Perguntas na tela (confirmar, escolher entre opções, digitar um nome) que qualquer parte do
// app pode fazer e esperar a resposta: `await ask(...)`. A janela fica em components/Dialogs.tsx.

import { createSignal } from "solid-js";
import { tx } from "./i18n";

export interface AskOption {
  id: string;
  label: string;
  tone?: "primary" | "danger" | "ghost";
}

export interface AskRequest {
  title: string;
  body?: string;
  options: AskOption[];
  /** pede um texto (ex.: nome do arquivo) */
  input?: { value: string; placeholder?: string; select?: [number, number] };
  resolve: (r: { id: string; text: string } | null) => void;
}

export const [asking, setAsking] = createSignal<AskRequest | null>(null);

/** Pergunta e espera. null = fechou (Esc, clique fora, Cancelar). */
export function ask(req: Omit<AskRequest, "resolve">): Promise<{ id: string; text: string } | null> {
  asking()?.resolve(null);
  return new Promise((resolve) => setAsking({ ...req, resolve }));
}

/** Sim/não para uma ação com consequência. */
export async function confirmAction(title: string, body: string, label: string, danger = false): Promise<boolean> {
  const r = await ask({ title, body, options: [{ id: "cancel", label: tx("Cancelar"), tone: "ghost" }, { id: "ok", label, tone: danger ? "danger" : "primary" }] });
  return r?.id === "ok";
}

/** Pede um nome. null = desistiu. */
export async function askName(title: string, label: string, value = "", body?: string): Promise<string | null> {
  const dot = value.lastIndexOf(".");
  const r = await ask({
    title,
    body,
    input: { value, select: [0, dot > 0 ? dot : value.length] },
    options: [{ id: "cancel", label: tx("Cancelar"), tone: "ghost" }, { id: "ok", label, tone: "primary" }],
  });
  return r?.id === "ok" && r.text.trim() ? r.text.trim() : null;
}
