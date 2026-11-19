// Prévia de imagens: as que aparecem (ou mudam) nas pastas dos projetos enquanto o Claude
// trabalha viram uma faixa "Imagens novas" no chat; qualquer imagem abre no visualizador.
import { invoke } from "@tauri-apps/api/core";
import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { isTauri, type FsChange } from "./api";

const IMG = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i;
export const isImagePath = (p: string) => IMG.test(p);
// pastas de dependências e de build não contam como "gerado agora"
const SKIP = /(^|\/)(node_modules|\.git|target|\.next|\.svelte-kit|\.cache|Pods|DerivedData)(\/|$)/;

export type Media = { path: string; at: number; url?: string | null; error?: string };

const KEEP = 16;
const [media, setMedia] = createStore<Record<string, Media[]>>({});
export const mediaOf = (pid: string): Media[] => media[pid] ?? [];
export const clearMedia = (pid: string) => setMedia(pid, []);

// --- data URLs em cache (caminho + quando mudou), para não ler a mesma imagem duas vezes
const cache = new Map<string, string>();
const key = (pid: string, path: string, at = 0) => `${pid}\n${path}\n${at}`;

export async function imageUrl(pid: string, path: string, at = 0): Promise<string> {
  const k = key(pid, path, at);
  const hit = cache.get(k);
  if (hit) return hit;
  if (!isTauri) throw new Error("A prévia de imagens funciona no app");
  const url = await invoke<string>("image_preview", { projectId: pid, path });
  if (cache.size > 60) cache.delete(cache.keys().next().value!);
  cache.set(k, url);
  return url;
}

const timers = new Map<string, number>();

/** Mudou algo no disco: imagens criadas ou alteradas entram na faixa (a mais nova primeiro). */
export function trackMedia(e: FsChange) {
  for (const c of e.changes) {
    if (c.isDir || !isImagePath(c.path) || SKIP.test(c.path)) continue;
    const pid = e.projectId;
    if (!c.exists) {
      setMedia(pid, (l = []) => l.filter((m) => m.path !== c.path));
      continue;
    }
    // o arquivo pode ainda estar sendo escrito: espera assentar antes de ler
    const tk = `${pid}\n${c.path}`;
    clearTimeout(timers.get(tk));
    timers.set(
      tk,
      window.setTimeout(() => {
        timers.delete(tk);
        const at = Date.now();
        setMedia(pid, (l = []) => [{ path: c.path, at }, ...l.filter((m) => m.path !== c.path)].slice(0, KEEP));
        imageUrl(pid, c.path, at)
          .then((url) => setMedia(pid, (m) => m.path === c.path && m.at === at, "url", url))
          .catch((err) => setMedia(pid, (m) => m.path === c.path && m.at === at, { url: null, error: String(err) }));
      }, 450),
    );
  }
}

// --- visualizador (um só, por cima de tudo)
export type ViewerState = { pid: string; list: Media[]; index: number };
export const [viewer, setViewer] = createSignal<ViewerState | null>(null);
export const openViewer = (pid: string, path: string, list?: Media[]) => {
  const l = list?.length ? list : [{ path, at: 0 }];
  setViewer({ pid, list: l, index: Math.max(0, l.findIndex((m) => m.path === path)) });
};

// --- miniaturas das imagens que a pessoa mandou (mostradas no balão da mensagem)
const [sent, setSent] = createStore<Record<string, string[]>>({});
export const sentThumbs = (text: string): string[] => sent[text] ?? [];
export function rememberSent(text: string, thumbs: (string | null | undefined)[]) {
  const list = thumbs.filter((t): t is string => !!t);
  if (list.length) setSent(text, list);
}
