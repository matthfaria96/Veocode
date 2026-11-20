// Como a tela Projetos fica: modo Código ou IA, painéis abertos e tamanhos. Lembrado neste computador.
import { createSignal } from "solid-js";

const remember = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* sem armazenamento: só não lembra */
  }
};
const recall = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------- janela estreita
// Sem espaço para três colunas, os painéis laterais viram gavetas por cima da conversa: abrem
// pelo mesmo botão de sempre, fecham ao clicar fora e não mudam o que fica lembrado para a
// janela larga.
const media = (q: string) => {
  const m = typeof window !== "undefined" && window.matchMedia ? window.matchMedia(q) : null;
  const [v, set] = createSignal(!!m?.matches);
  m?.addEventListener("change", (e) => set(e.matches));
  return v;
};
/** O painel da direita (depuração ou Git e conversa) abre por cima, não ao lado. */
export const narrowRight = media("(max-width: 1100px)");
/** A lateral (conversas ou arquivos) também. */
export const narrowLeft = media("(max-width: 760px)");
const [leftSheet, setLeftSheet] = createSignal(false);
const [debugSheet, setDebugSheet] = createSignal(false);
const [codeSheet, setCodeSheet] = createSignal(false);
export { leftSheet, setLeftSheet };
/** Alguma gaveta aberta agora (o fundo escurece e um clique fora fecha). */
export const sheetOpen = () => (narrowLeft() && leftSheet()) || (narrowRight() && (projMode() === "code" ? codeSheet() : debugSheet()));
export const closeSheets = () => (setLeftSheet(false), setDebugSheet(false), setCodeSheet(false));

/** Atividade, comandos do agente e terminal: fechado, na faixa de baixo ou numa aba fixa no lugar da conversa. */
export type PanelAt = "none" | "bottom" | "tab";
// começa fechado; Ajustes → "Painel de baixo" escolhe se já abre aberto (settings.ts aplica ao carregar)
const [panelAt, setPanelAt] = createSignal<PanelAt>("none");
export { panelAt, setPanelAt };
export const bottomOpen = () => panelAt() === "bottom";
export const setBottomOpen = (v: boolean) => setPanelAt(v ? "bottom" : "none");

/** Painel de arquivos ao lado do chat: largura arrastável e "maximizado". */
const FILES_W = 520;
const savedW = Number(recall("veocode.files.width"));
const [filesW, setFilesWRaw] = createSignal(savedW >= 340 && savedW <= 1400 ? savedW : FILES_W);
export { filesW };
export const setFilesW = (w: number, save = false) => {
  setFilesWRaw(w);
  if (save) remember("veocode.files.width", String(w));
};
export const resetFilesW = () => setFilesW(FILES_W, true);
export const [filesMax, setFilesMax] = createSignal(false);

/** Modo foco (tela Projetos): todas as conversas do projeto lado a lado, numa grade. Lembrado neste computador. */
const [focusMode, setFocusRaw] = createSignal(recall("veocode.ws.focus") === "1");
export { focusMode };
export function setFocusMode(v: boolean) {
  setFocusRaw(v);
  remember("veocode.ws.focus", v ? "1" : "0");
}

/** Tela Projetos em dois modos: "code" (como um editor: árvore, arquivos, git, terminal) ou
 *  "ai" (conversas à esquerda, a conversa no meio e o painel de depuração à direita). */
export type ProjMode = "code" | "ai";
const [projMode, setProjModeRaw] = createSignal<ProjMode>(recall("veocode.ws.view") === "code" ? "code" : "ai");
export { projMode };
export function setProjMode(m: ProjMode) {
  setProjModeRaw(m);
  remember("veocode.ws.view", m);
}

const size = (k: string, d: number, lo: number, hi: number) => {
  const n = Number(recall(k));
  return n >= lo && n <= hi ? n : d;
};

/** Painel de depuração do modo IA (à direita): aberto, largura e a aba da frente. */
export type DebugTab = "browser" | "procs" | "subs" | "activity" | "trail" | "file";
const [debugPref, setDebugPref] = createSignal(recall("veocode.ai.debug") !== "0");
export const debugOpen = () => (narrowRight() ? debugSheet() : debugPref());
export const setDebugOpen = (v: boolean) => (narrowRight() ? setDebugSheet(v) : (setDebugPref(v), remember("veocode.ai.debug", v ? "1" : "0")));
const [debugW, setDebugWRaw] = createSignal(size("veocode.ai.debugW", 440, 320, 1400));
export { debugW };
export const setDebugW = (v: number, save = false) => (setDebugWRaw(v), save && remember("veocode.ai.debugW", String(v)));
const savedTab = recall("veocode.ai.debugTab");
const [debugTab, setDebugTabRaw] = createSignal<DebugTab>(savedTab === "procs" || savedTab === "subs" || savedTab === "activity" || savedTab === "trail" ? savedTab : "browser");
export { debugTab };
export const setDebugTab = (v: DebugTab) => (setDebugTabRaw(v), v !== "file" && remember("veocode.ai.debugTab", v));

/** Painel da direita do modo Código (⌥⌘B): o Git, o terminal da pasta e o Ambiente. Aberto,
 *  largura e aba lembrados. O resto (comandos, atividade, rastro) é do modo IA; a conversa com a
 *  IA mora no modo IA (⌘E). */
export type CodeSideTab = "git" | "term" | "env";
const [codeSidePref, setCodeSidePref] = createSignal(recall("veocode.code.side") === "1");
export const codeSideOpen = () => (narrowRight() ? codeSheet() : codeSidePref());
export const setCodeSideOpen = (v: boolean) => (narrowRight() ? setCodeSheet(v) : (setCodeSidePref(v), remember("veocode.code.side", v ? "1" : "0")));
const [codeSideW, setCodeSideWRaw] = createSignal(size("veocode.code.sideW", 400, 300, 1200));
export { codeSideW };
export const setCodeSideW = (v: number, save = false) => (setCodeSideWRaw(v), save && remember("veocode.code.sideW", String(v)));
const savedSide = recall("veocode.code.sideTab");
const [codeSideTab, setCodeSideTabRaw] = createSignal<CodeSideTab>(savedSide === "term" || savedSide === "env" ? savedSide : "git");
export { codeSideTab };
export const setCodeSideTab = (v: CodeSideTab) => (setCodeSideTabRaw(v), remember("veocode.code.sideTab", v));

/** O terminal está na tela agora (a aba dele no painel da direita). */
export const termShown = () => codeSideOpen() && codeSideTab() === "term";
/** Abre o painel da direita na aba Terminal. */
export function showTerm() {
  setCodeSideTab("term");
  if (!codeSideOpen()) setCodeSideOpen(true);
}
/** ⌘J: mostra o terminal (no painel da direita) ou, se ele já está na frente, esconde o painel. */
export function toggleTerm() {
  if (termShown()) return setCodeSideOpen(false);
  showTerm();
}

/** Comparação ampliada: o diff ou o commit ocupa a tela toda (as laterais saem até Esc). */
export const [reviewWide, setReviewWide] = createSignal(false);
