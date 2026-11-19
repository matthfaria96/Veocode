// Anexos do chat (projeto e Chat livre): colar imagem (⌘V), escolher arquivos no clipe e
// arrastar do Finder. O Rust guarda o que foi colado e confere os caminhos; aqui fica a lista
// de cada conversa até ser enviada.
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { isTauri } from "./api";
import { showToast } from "./store";
import { tx } from "./i18n";

export type Att = { path: string; name: string; kind: "image" | "pdf" | "text" | "other"; bytes: number; thumb?: string | null };

const MAX = 20;
const [atts, setAtts] = createStore<Record<string, Att[]>>({});
export const attsOf = (pid: string): Att[] => atts[pid] ?? [];
export const clearAtts = (pid: string) => setAtts(pid, []);
export const setAttsOf = (pid: string, list: Att[]) => setAtts(pid, list);
export const removeAtt = (pid: string, path: string) => setAtts(pid, attsOf(pid).filter((a) => a.path !== path));

/** Composer debaixo do arquivo arrastado agora (para acender a borda). */
export const [dropPid, setDropPid] = createSignal<string | null>(null);

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function addAtts(pid: string, list: Att[]) {
  const cur = attsOf(pid);
  const fresh = list.filter((a) => !cur.some((c) => c.path === a.path));
  const room = MAX - cur.length;
  if (fresh.length > room) showToast(tx("Até {MAX} anexos por mensagem", { MAX }));
  if (fresh.length) setAtts(pid, [...cur, ...fresh.slice(0, Math.max(0, room))]);
}

/** Caminhos vindos do Finder (clipe ou arrastar). */
export async function addPaths(pid: string, paths: string[]) {
  if (!paths.length) return;
  try {
    addAtts(pid, await invoke<Att[]>("attach_info", { paths }));
  } catch (e) {
    showToast(errMsg(e));
  }
}

/** Clipe: abre o seletor do sistema (vários arquivos, de qualquer pasta). */
export async function pickFiles(pid: string) {
  if (!isTauri) return showToast(tx("No navegador não dá para escolher arquivos: abra pelo app"));
  const picked = await open({ multiple: true, directory: false, title: tx("Anexar à conversa") });
  const list = Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
  await addPaths(pid, list);
}

const readAsDataUrl = (f: Blob) =>
  new Promise<string>((ok, bad) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => bad(r.error);
    r.readAsDataURL(f);
  });

const extOf = (type: string) => (type.split("/")[1] ?? "bin").replace("jpeg", "jpg").replace("svg+xml", "svg").replace(/[^a-z0-9]/g, "");

/** ⌘V: se a área de transferência tem arquivo ou imagem, anexa e devolve true. */
export async function pasteFiles(pid: string, e: ClipboardEvent): Promise<boolean> {
  const files = [...(e.clipboardData?.items ?? [])].filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter((f): f is File => !!f);
  if (!files.length) return false;
  e.preventDefault();
  for (const f of files) {
    const name = f.name && f.name !== "image.png" ? f.name : `imagem-colada.${extOf(f.type || "image/png")}`;
    try {
      const data = await readAsDataUrl(f);
      if (!isTauri) {
        addAtts(pid, [{ path: `colado:${Date.now()}:${name}`, name, kind: f.type.startsWith("image/") ? "image" : "other", bytes: f.size, thumb: f.type.startsWith("image/") ? data : null }]);
        continue;
      }
      addAtts(pid, [await invoke<Att>("attach_stage", { name, data })]);
    } catch (err) {
      showToast(errMsg(err));
    }
  }
  return true;
}

/** Arrastar do Finder: o Tauri entrega os caminhos; o composer debaixo do mouse recebe. */
export async function watchDrops(): Promise<() => void> {
  if (!isTauri) return () => {};
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  const target = (pos: { x: number; y: number }) => {
    const r = window.devicePixelRatio || 1;
    const el = document.elementFromPoint(pos.x / r, pos.y / r)?.closest<HTMLElement>("[data-attach-pid]");
    return el?.dataset.attachPid ?? null;
  };
  return getCurrentWebview().onDragDropEvent((ev) => {
    const p = ev.payload;
    if (p.type === "over") setDropPid(target(p.position));
    else if (p.type === "drop") {
      const pid = target(p.position);
      setDropPid(null);
      if (pid) void addPaths(pid, p.paths);
      else if (p.paths.length) showToast(tx("Solte os arquivos em cima da caixa de mensagem para anexar"));
    } else setDropPid(null);
  });
}

export const attLabel = (list: Att[]) => (list.length ? `📎 ${list.map((a) => a.name).join(", ")}` : "");
