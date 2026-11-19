// Ditado: falar em vez de digitar. O ajudante do app usa o motor de fala da Apple que roda no próprio
// Mac (macOS 26+, sem depender da Siri) e vai escrevendo na caixa da conversa enquanto você fala.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { createSignal } from "solid-js";
import { isTauri } from "./api";
import { chatOf, setInput } from "./chat";
import { LIVRE, livre, setLivre } from "./livre";
import { showToast } from "./store";
import { locale, tx } from "./i18n";

type Ev = { t: "ready" | "level" | "text" | "note" | "done" | "error" | "end"; v?: unknown; id: number };
export type VoiceState = { key: string; phase: "starting" | "listening" | "finishing"; level: number; id: number };

const [voice, setVoice] = createSignal<VoiceState | null>(null);
export { voice };
/** Esta conversa está ouvindo agora? */
export const listeningTo = (key: string) => voice()?.key === key;

let base = ""; // o que já estava escrito antes de começar a falar
let off: UnlistenFn | undefined;
let guard: number | undefined;

// o ditado entende o idioma da tela (Ajustes → Idioma)
const lang = () => locale();

// o Chat livre guarda o texto da caixa no próprio store; os projetos, no chat de cada aba
const inputOf = (key: string) => (key === LIVRE ? livre.input : chatOf(key).input);
const putInput = (key: string, v: string) => (key === LIVRE ? setLivre("input", v) : setInput(key, v));

function write(key: string, text: string) {
  const sep = base && text && !/\s$/.test(base) ? " " : "";
  putInput(key, base + sep + text);
}

function end() {
  window.clearTimeout(guard);
  setVoice(null);
}

function handle(e: Ev) {
  const v = voice();
  if (!v) return;
  if (v.id !== -1 && e.id !== v.id) return;
  const cur: VoiceState = v.id === -1 ? { ...v, id: e.id } : v;
  switch (e.t) {
    case "ready":
      return setVoice({ ...cur, phase: "listening" });
    case "level":
      return setVoice({ ...cur, phase: cur.phase === "starting" ? "listening" : cur.phase, level: Number(e.v) || 0 });
    case "text":
      write(cur.key, String(e.v ?? ""));
      return setVoice(cur);
    case "done":
      write(cur.key, String(e.v ?? ""));
      end();
      return focusBox(cur.key);
    case "note":
      showToast(String(e.v ?? ""));
      return;
    case "error":
      showToast(String(e.v ?? tx("O ditado parou")));
      return end();
    case "end":
      return end();
  }
}

function focusBox(key: string) {
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLTextAreaElement>(`[data-attach-pid="${CSS.escape(key)}"] textarea`);
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  });
}

/** Começa a ouvir nesta conversa; se já estiver ouvindo nela, para e deixa o texto. */
export async function toggleVoice(key: string) {
  const v = voice();
  if (v?.key === key) return stopVoice();
  if (v) await cancelVoice(false);
  if (!isTauri) return showToast(tx("O ditado funciona no app"));
  off ??= await listen<Ev>("voice", (e) => handle(e.payload));
  base = inputOf(key);
  setVoice({ key, phase: "starting", level: 0, id: -1 });
  try {
    const id = await invoke<number>("voice_start", { locale: lang() });
    const cur = voice();
    if (cur?.key === key && cur.id === -1) setVoice({ ...cur, id });
  } catch (e) {
    end();
    showToast(String(e));
  }
}

/** Para de ouvir; o texto final chega logo em seguida. */
async function stopVoice() {
  const v = voice();
  if (!v || v.phase === "finishing") return;
  setVoice({ ...v, phase: "finishing" });
  guard = window.setTimeout(() => void cancelVoice(false), 5000);
  await invoke("voice_stop").catch(() => void 0);
}

/** Cancela. `undo` tira da caixa o que foi ditado agora. */
async function cancelVoice(undo = true) {
  const v = voice();
  if (!v) return;
  if (undo) putInput(v.key, base);
  end();
  await invoke("voice_cancel").catch(() => void 0);
}

/** Teclas da caixa de mensagem: ⌥ Espaço liga/desliga, Esc cancela. Devolve true se usou a tecla. */
export function voiceKey(key: string, e: KeyboardEvent): boolean {
  if (e.altKey && e.code === "Space") {
    e.preventDefault();
    void toggleVoice(key);
    return true;
  }
  if (e.key === "Escape" && listeningTo(key)) {
    e.preventDefault();
    void cancelVoice();
    return true;
  }
  if (e.key === "Enter" && !e.shiftKey && listeningTo(key)) {
    e.preventDefault();
    void stopVoice();
    return true;
  }
  return false;
}
