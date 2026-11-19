// Imagens na tela: faixa "Imagens novas" no chat, visualizador em tela cheia, prévia no
// editor e miniaturas nas mensagens enviadas.
import { ChevronLeft, ChevronRight, ExternalLink, FileCode2, FolderOpen, ImageIcon, Paperclip, X } from "lucide-solid";
import { createEffect, createResource, createSignal, For, on, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { api, formatSize } from "../api";
import { addPaths } from "../attachments";
import { clearMedia, imageUrl, mediaOf, openViewer, sentThumbs, setViewer, viewer, type Media } from "../media";
import { openRealFile } from "../realProject";
import { absPathOf, projectId, setProjectId, setView, showToast, view } from "../store";
import { tx } from "../i18n";

const nameOf = (p: string) => p.split("/").pop() ?? p;
const ago = (at: number) => {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  return s < 60 ? tx("agora") : s < 3600 ? tx("há {v} min", { v: Math.round(s / 60) }) : tx("há {v} h", { v: Math.round(s / 3600) });
};
const err = (e: unknown) => showToast(String(e instanceof Error ? e.message : e));

/** Faixa de miniaturas das imagens que apareceram no projeto (some quando não há nenhuma). */
export function MediaStrip(props: { pid: string; compact?: boolean }) {
  const list = () => mediaOf(props.pid);
  return (
    <Show when={list().length}>
      <div class="media-strip" classList={{ compact: props.compact }}>
        <div class="media-strip-head">
          <span><ImageIcon size={12} /> {list().length === 1 ? tx("Imagem nova") : tx("{n} imagens novas", { n: list().length })}</span>
          <button class="media-strip-x" title={tx("Limpar a faixa (as imagens continuam na pasta)")} onClick={() => clearMedia(props.pid)}><X size={11} /></button>
        </div>
        <div class="media-strip-row">
          <For each={list()}>
            {(m) => (
              <button class="media-thumb pop-in" title={`${m.path}\n${ago(m.at)}`} onClick={() => openViewer(props.pid, m.path, list())}>
                <Show when={m.url} fallback={<span class="media-thumb-wait">{m.url === null ? <ImageIcon size={14} /> : <span class="spinner inline" />}</span>}>
                  <img src={m.url!} alt={nameOf(m.path)} />
                </Show>
                <small>{nameOf(m.path)}</small>
              </button>
            )}
          </For>
        </div>
      </div>
    </Show>
  );
}

/** Miniaturas das imagens anexadas numa mensagem já enviada. */
export function SentThumbs(props: { text: string }) {
  const [big, setBig] = createSignal<string | null>(null);
  return (
    <Show when={sentThumbs(props.text).length}>
      <div class="sent-thumbs">
        <For each={sentThumbs(props.text)}>{(u) => <button onClick={() => setBig(u)} title={tx("Ver maior")}><img src={u} alt={tx("anexo")} /></button>}</For>
      </div>
      <Show when={big()}>
        <Portal>
          <div class="viewer" onClick={() => setBig(null)}>
            <img class="viewer-img" src={big()!} alt={tx("anexo")} />
          </div>
        </Portal>
      </Show>
    </Show>
  );
}

/** Visualizador em tela cheia (← → passa, Esc fecha). Montado uma vez no App. */
export function MediaViewer() {
  const cur = () => {
    const v = viewer();
    return v ? { pid: v.pid, m: v.list[v.index] as Media, i: v.index, n: v.list.length } : null;
  };
  const [url] = createResource(
    () => cur() && { pid: cur()!.pid, path: cur()!.m.path, at: cur()!.m.at },
    (k) => (cur()?.m.url ? Promise.resolve(cur()!.m.url!) : imageUrl(k.pid, k.path, k.at)),
  );
  const [dims, setDims] = createSignal("");
  createEffect(on(() => cur()?.m.path, () => setDims("")));
  const step = (d: number) => {
    const v = viewer();
    if (v && v.list.length > 1) setViewer({ ...v, index: (v.index + d + v.list.length) % v.list.length });
  };
  const close = () => setViewer(null);

  createEffect(() => {
    if (!viewer()) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", key, true);
    onCleanup(() => window.removeEventListener("keydown", key, true));
  });

  const abs = () => {
    const c = cur();
    const root = c && absPathOf(c.pid);
    return root && c ? `${root.replace(/\/$/, "")}/${c.m.path}` : null;
  };
  const inEditor = () => {
    const c = cur()!;
    close();
    if (projectId() !== c.pid) setProjectId(c.pid);
    if (view() !== "workspace") setView("workspace");
    window.setTimeout(() => openRealFile(c.m.path), 80);
  };

  return (
    <Show when={cur()}>
      {(c) => (
        <Portal>
          <div class="viewer" onClick={(e) => e.target === e.currentTarget && close()}>
            <div class="viewer-top">
              <div class="viewer-name">
                <strong>{nameOf(c().m.path)}</strong>
                <small>{c().m.path}{dims() ? ` · ${dims()}` : ""}{c().n > 1 ? tx(" · {v} de {n}", { v: c().i + 1, n: c().n }) : ""}</small>
              </div>
              <div class="viewer-tools">
                <button class="ghost-btn small" onClick={inEditor} title={tx("Abrir na aba do editor")}><FileCode2 size={13} /> {tx("No editor")}</button>
                <button class="ghost-btn small" onClick={() => { const a = abs(); if (a) void addPaths(c().pid, [a]).then(() => showToast(tx("Anexada à conversa do projeto"))); }} title={tx("Usar como base na próxima mensagem")}><Paperclip size={13} /> {tx("Anexar")}</button>
                <button class="ghost-btn small" onClick={() => api.openEntry(c().pid, c().m.path).catch(err)}><ExternalLink size={13} /> {tx("Abrir")}</button>
                <button class="ghost-btn small" onClick={() => { const a = abs(); if (a) Promise.resolve(api.reveal(a)).catch(err); }}><FolderOpen size={13} /> {tx("Finder")}</button>
                <button class="viewer-close" onClick={close} title={tx("Fechar (Esc)")}><X size={16} /></button>
              </div>
            </div>
            <Show when={c().n > 1}>
              <button class="viewer-nav prev" onClick={() => step(-1)} title={tx("Anterior (←)")}><ChevronLeft size={22} /></button>
              <button class="viewer-nav next" onClick={() => step(1)} title={tx("Próxima (→)")}><ChevronRight size={22} /></button>
            </Show>
            <Show when={!url.error} fallback={<div class="viewer-msg">{String(url.error?.message ?? url.error)}</div>}>
              <Show when={url()} fallback={<span class="spinner" />}>
                <img class="viewer-img checker" src={url()!} alt={nameOf(c().m.path)} onLoad={(e) => setDims(`${e.currentTarget.naturalWidth}×${e.currentTarget.naturalHeight}`)} />
              </Show>
            </Show>
          </div>
        </Portal>
      )}
    </Show>
  );
}

/** Prévia de imagem dentro do editor, no lugar de "este arquivo não é texto". */
export function ImageView(props: { pid: string; path: string; size: number }) {
  const [url] = createResource(() => ({ pid: props.pid, path: props.path, size: props.size }), (k) => imageUrl(k.pid, k.path, k.size));
  const [dims, setDims] = createSignal("");
  const [fit, setFit] = createSignal(true);
  return (
    <div class="img-view">
      <div class="img-view-bar">
        <span>{dims() ? `${dims()} · ` : ""}{formatSize(props.size)}</span>
        <button class="link-btn" onClick={() => setFit(!fit())}>{fit() ? tx("Tamanho real") : tx("Caber na tela")}</button>
        <button class="link-btn" onClick={() => openViewer(props.pid, props.path)}>{tx("Tela cheia")}</button>
        <button class="link-btn" onClick={() => api.openEntry(props.pid, props.path).catch(err)}><ExternalLink size={12} /> {tx("Abrir com o programa padrão")}</button>
      </div>
      <div class="img-view-stage" classList={{ fit: fit() }}>
        <Show when={!url.error} fallback={<div class="viewer-msg">{String(url.error?.message ?? url.error)}</div>}>
          <Show when={url()} fallback={<span class="spinner" />}>
            <img class="checker" src={url()!} alt={props.path} onLoad={(e) => setDims(`${e.currentTarget.naturalWidth}×${e.currentTarget.naturalHeight}`)} onDblClick={() => openViewer(props.pid, props.path)} />
          </Show>
        </Show>
      </div>
    </div>
  );
}
