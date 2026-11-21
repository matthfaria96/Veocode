// Navegador do painel da direita (modo IA): as abas de cada projeto, a ponte com a página
// aberta (src-tauri/src/bridge.js, que o WebKit põe em toda moldura do app), o console de cada
// página, as preferências do menu "⋯" e o que manda coisas para a conversa (elemento escolhido,
// captura riscada, logs). O desenho fica em components/Browser.tsx; o que a IA faz aqui, em
// browserTools.ts.

import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import bridgeSrc from "../src-tauri/src/bridge.js?raw";
import { api, isTauri } from "./api";
import type { Att } from "./attachments";
import { debugOpen, projMode, setDebugOpen, setDebugTab } from "./layoutMode";
import { currentProject, projects, showToast } from "./store";
import { tx } from "./i18n";

// ---------------------------------------------------------------- abas

/** Cada aba guarda o endereço que a moldura carrega e um contador de "recarregar". */
export type BrTab = { id: number; url: string; n: number };
export type BrState = { list: BrTab[]; at: number };
let nextTab = 1;
const [brs, setBrs] = createSignal<Record<string, BrState>>({});
// toda pasta começa com uma aba vazia (id 0; as novas contam a partir de 1)
const FIRST: BrState = { list: [{ id: 0, url: "", n: 0 }], at: 0 };

export const brOf = (pid: string): BrState => brs()[pid] ?? FIRST;
const put = (pid: string, next: BrState) => setBrs({ ...brs(), [pid]: next });
export const activeTab = (pid: string) => brOf(pid).list.find((t) => t.id === brOf(pid).at) ?? brOf(pid).list[0];

const [loading, setLoading] = createStore<Record<string, boolean>>({});
export const isLoading = (pid: string, id: number) => !!loading[`${pid}:${id}`];
export const setTabLoading = (pid: string, id: number, v: boolean) => setLoading(`${pid}:${id}`, v);

const patch = (pid: string, id: number, f: (t: BrTab) => BrTab) => put(pid, { ...brOf(pid), list: brOf(pid).list.map((t) => (t.id === id ? f(t) : t)) });

/** Carrega `url` na aba da frente (o mesmo endereço: recarrega). */
export function setTabUrl(pid: string, url: string) {
  const t = activeTab(pid);
  setTabLoading(pid, t.id, !!url);
  forgetPage(pid, t.id);
  setStuck(frameKey(pid, t.id), undefined);
  patch(pid, t.id, (x) => (x.url === url ? { ...x, n: x.n + 1 } : { ...x, url }));
}
/** Recarrega a página onde ela está (a ponte recarrega; sem ponte, a moldura volta ao endereço da aba). */
export function reloadTab(pid: string, id = activeTab(pid).id) {
  setTabLoading(pid, id, true);
  setStuck(frameKey(pid, id), undefined);
  if (pageOf(pid, id) && frames.has(frameKey(pid, id))) {
    navStarted(pid, id, pageOf(pid, id)!.url);
    return tell(pid, id, { t: "reload" });
  }
  patch(pid, id, (x) => ({ ...x, n: x.n + 1 }));
}
export const selectTab = (pid: string, id: number) => put(pid, { ...brOf(pid), at: id });
export function newTab(pid: string, url = "") {
  const t: BrTab = { id: nextTab++, url, n: 0 };
  if (url) setTabLoading(pid, t.id, true);
  put(pid, { list: [...brOf(pid).list, t], at: t.id });
  return t;
}
export function closeTab(pid: string, id: number) {
  const list = brOf(pid).list;
  const i = list.findIndex((t) => t.id === id);
  const rest = list.filter((t) => t.id !== id);
  forgetPage(pid, id);
  if (!rest.length) return put(pid, FIRST);
  put(pid, { list: rest, at: brOf(pid).at === id ? rest[Math.min(i, rest.length - 1)].id : brOf(pid).at });
}

/** Abre um endereço: vai para a aba que já mostra ele, usa a da frente se estiver vazia ou abre outra. */
export function openUrlHere(pid: string, url: string, show = true) {
  const st = brOf(pid);
  const same = st.list.find((t) => t.url === url || pageOf(pid, t.id)?.url === url);
  if (same) {
    selectTab(pid, same.id);
    reloadTab(pid, same.id);
  } else if (!activeTab(pid).url) setTabUrl(pid, url);
  else newTab(pid, url);
  if (show && projMode() === "ai") {
    setDebugTab("browser");
    if (!debugOpen()) setDebugOpen(true);
  }
}

// ---------------------------------------------------------------- endereços

/** ":5173/sobre" para localhost; "site.com/x" para o resto; o arquivo para um .html aberto. */
export const tabLabel = (u: string) => servedPath(u) ?? (u.replace(/^https?:\/\//, "").replace(/^(localhost|127\.0\.0\.1)(?=:)/, "").replace(/\/$/, "") || tx("Nova aba"));
export const portOf = (u: string) => (servedPath(u) ? 0 : Number(/^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::(\d+))/.exec(u)?.[1] ?? 0));
export const isLocalUrl = (u: string) => /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|[a-z0-9-]+\.localhost)(:\d+)?(\/|$|\?|#)/i.test(u);
const SERVED = /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\/(.*)$/;
/** Arquivo do projeto servido pelo Veocode (browser.rs): o caminho dele, para mostrar. */
export function servedPath(u: string): string | null {
  const m = SERVED.exec(u);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1].split(/[?#]/)[0]);
  } catch {
    return m[1];
  }
}

// ---------------------------------------------------------------- preferências (menu ⋯)

export type Viewport = "fit" | "phone" | "tablet" | "laptop";
export const viewports: { id: Viewport; label: () => string; w: number; h: number }[] = [
  { id: "fit", label: () => tx("Responsivo"), w: 0, h: 0 },
  { id: "phone", label: () => tx("Celular"), w: 390, h: 844 },
  { id: "tablet", label: () => tx("Tablet"), w: 820, h: 1180 },
  { id: "laptop", label: () => tx("Notebook"), w: 1280, h: 800 },
];
type Prefs = { linksHere: boolean; openHtml: boolean; reloadOnChange: boolean; viewport: Viewport; sessionOnly: boolean };
const PREFS = "veocode.browser.prefs";
const readPrefs = (): Prefs => {
  const base: Prefs = { linksHere: false, openHtml: true, reloadOnChange: true, viewport: "fit", sessionOnly: false };
  try {
    return { ...base, ...JSON.parse(localStorage.getItem(PREFS) ?? "{}") };
  } catch {
    return base;
  }
};
const [prefs, setPrefs] = createStore<Prefs>(readPrefs());
export { prefs as brPrefs };
export function setBrPref<K extends keyof Prefs>(k: K, v: Prefs[K]) {
  setPrefs(k, v);
  try {
    localStorage.setItem(PREFS, JSON.stringify(prefs));
  } catch {
    /* sem armazenamento: vale só agora */
  }
}

/** Tela cheia: o painel cobre a janela (Esc sai). */
export const [brFull, setBrFull] = createSignal(false);
/** Escolhendo um elemento na página (chave da moldura) e desenhando por cima. */
export const [picking, setPicking] = createSignal<string | null>(null);
export const [drawing, setDrawing] = createSignal(false);
/** Logs do servidor abertos embaixo do navegador (id do terminal do serviço). */
export const [logsOf, setLogsOf] = createSignal<string | null>(null);
/** Console da página aberto embaixo do navegador. */
export const [consoleOpen, setConsoleOpen] = createSignal(false);
/** A IA está usando o navegador deste projeto agora (quantas ferramentas rodando). */
const [aiUses, setAiUses] = createStore<Record<string, number>>({});
export const aiUsing = (pid: string) => (aiUses[pid] ?? 0) > 0;
export const markAi = (pid: string, d: 1 | -1) => setAiUses(pid, (n) => Math.max(0, (n ?? 0) + d));

// "dados dos sites só até fechar o Veocode": os cookies (até os HttpOnly) saem ao abrir o app, antes
// de qualquer página carregar; o resto (armazenamento, cache) a ponte limpa na 1ª página de cada site
let wiping: Promise<unknown> = Promise.resolve();
export const sitesReady = () => wiping;
if (isTauri && prefs.sessionOnly) wiping = Promise.race([invoke("browser_clear_cookies", { host: null }).catch(() => {}), new Promise((ok) => setTimeout(ok, 2000))]);

// ---------------------------------------------------------------- a ponte com a página

export type PageInfo = { url: string; title: string; hmr: boolean; doc: string };
export type Picked = {
  label: string;
  selector: string;
  text: string;
  html: string;
  rect: { x: number; y: number; w: number; h: number };
  vw: number;
  vh: number;
  styles: Record<string, string>;
  component: { name: string | null; file: string | null; lib: string } | null;
  url: string;
  title: string;
};
const [pages, setPages] = createStore<Record<string, PageInfo>>({});
export const pageOf = (pid: string, id: number): PageInfo | undefined => pages[`${pid}:${id}`];
const forgetPage = (pid: string, id: number) => setPages(`${pid}:${id}`, undefined!);

const frames = new Map<string, HTMLIFrameElement>();
export const frameKey = (pid: string, id: number) => `${pid}:${id}`;
export function registerFrame(pid: string, id: number, el: HTMLIFrameElement) {
  frames.set(frameKey(pid, id), el);
  return () => frames.get(frameKey(pid, id)) === el && frames.delete(frameKey(pid, id));
}
export const frameOf = (pid: string, id: number) => frames.get(frameKey(pid, id));

/** Pede algo à página (ela só ouve se a ponte estiver nela). */
export function tell(pid: string, id: number, msg: Record<string, unknown>) {
  frames.get(frameKey(pid, id))?.contentWindow?.postMessage({ ...msg, __veo: 1 }, "*");
}

/** Moldura da mesma origem (a página de exemplo): a ponte entra pela mão, sem o WebKit. */
export function injectBridge(el: HTMLIFrameElement) {
  try {
    const w = el.contentWindow as (Window & { eval?: (s: string) => unknown; __veoBridge?: number }) | null;
    if (w && !w.__veoBridge && w.document) w.eval?.(bridgeSrc);
  } catch {
    /* outra origem: no app quem põe é o WebKit */
  }
}

// ---------------------------------------------------------------- perguntas à página

let asked = 0;
const waiting = new Map<number, { ok: (v: unknown) => void; fail: (e: Error) => void; timer: number }>();
/** Pergunta algo à página e espera a resposta (ler, clicar, digitar, rolar). */
export function ask<T>(pid: string, id: number, msg: Record<string, unknown>, ms = 8000): Promise<T> {
  const w = frames.get(frameKey(pid, id))?.contentWindow;
  if (!w || !pageOf(pid, id)) return Promise.reject(new Error("The page isn't connected to Veocode (it didn't load, or the site refuses to be framed)."));
  const n = ++asked;
  return new Promise<T>((ok, fail) => {
    const timer = window.setTimeout(() => (waiting.delete(n), fail(new Error("The page didn't answer (it may be busy or navigating)."))), ms);
    waiting.set(n, { ok: ok as (v: unknown) => void, fail, timer });
    w.postMessage({ ...msg, id: n, __veo: 1 }, "*");
  });
}

// ---------------------------------------------------------------- console de cada página

export type LogLine = { l: "error" | "warn" | "info" | "log"; m: string; k: string; at: number; n: number };
const [consoles, setConsoles] = createStore<Record<string, { doc: string; list: LogLine[]; dropped: number }>>({});
let logSeq = 0;
export const consoleOf = (pid: string, id: number) => consoles[frameKey(pid, id)]?.list ?? [];
export const droppedOf = (pid: string, id: number) => consoles[frameKey(pid, id)]?.dropped ?? 0;
export const errorsOf = (pid: string, id: number) => consoleOf(pid, id).filter((x) => x.l === "error").length;
export const clearConsole = (pid: string, id: number) => setConsoles(frameKey(pid, id), (c) => (c ? { ...c, list: [], dropped: 0 } : c));
function addLog(key: string, doc: string, m: { l?: string; m?: string; k?: string; at?: number; drop?: number }) {
  const l = (["error", "warn", "info", "log"].includes(m.l ?? "") ? m.l : "log") as LogLine["l"];
  const line: LogLine = { l, m: String(m.m ?? ""), k: String(m.k ?? ""), at: Number(m.at) || Date.now(), n: ++logSeq };
  const c = consoles[key];
  // página nova: começa do zero
  if (!c || c.doc !== doc) return setConsoles(key, { doc, list: [line], dropped: m.drop ?? 0 });
  setConsoles(key, { doc, list: [...c.list.slice(-499), line], dropped: c.dropped + (m.drop ?? 0) });
}

// ---------------------------------------------------------------- página que não abriu

/** A moldura carregou mas a página não falou com o Veocode: o servidor não respondeu ("down")
 *  ou o site não deixa ser aberto dentro de outro app ("blocked"). */
const [stuck, setStuck] = createStore<Record<string, "down" | "blocked" | undefined>>({});
export const stuckOf = (pid: string, id: number) => stuck[frameKey(pid, id)];
const checks = new Map<string, number>();
export const loadedAt = new Map<string, number>();
/** A moldura terminou de carregar (o `load` dela). */
export function frameLoaded(pid: string, id: number, url: string) {
  setTabLoading(pid, id, false);
  const k = frameKey(pid, id);
  loadedAt.set(k, Date.now());
  clearTimeout(checks.get(k));
  // a ponte só existe no app; endereços que não são http não passam por ela
  if (!isTauri || currentProject().demo || !/^https?:/i.test(url)) return;
  checks.set(
    k,
    window.setTimeout(async () => {
      if (pages[k]) return;
      const up = await invoke<boolean | null>("browser_probe", { url }).catch(() => null);
      if (!pages[k]) setStuck(k, up === false ? "down" : "blocked");
    }, 2500),
  );
}

/** A moldura começou a carregar `url`. Com o servidor parado o WebKit nem dispara o `load` da
 *  moldura (ela fica carregando para sempre): sem resposta em 3 s, confere se há algo
 *  escutando no endereço e, se não há, mostra o aviso na hora. */
export function navStarted(pid: string, id: number, url: string) {
  const k = frameKey(pid, id);
  clearTimeout(checks.get(k));
  if (!isTauri || currentProject().demo || !/^https?:/i.test(url)) return;
  const since = Date.now();
  const fresh = () => (loadedAt.get(k) ?? 0) >= since;
  checks.set(
    k,
    window.setTimeout(async () => {
      if (!isLoading(pid, id) || fresh()) return;
      const up = await invoke<boolean | null>("browser_probe", { url }).catch(() => null);
      if (up !== false || !isLoading(pid, id) || fresh()) return;
      setStuck(k, "down");
      setTabLoading(pid, id, false);
    }, 3000),
  );
}

type Handlers = { pick?: (key: string, el: Picked) => void; escape?: () => void };
const handlers: Handlers = {};
export const onBridge = (h: Handlers) => Object.assign(handlers, h);

let listening = false;
export function listenBridge() {
  if (listening) return;
  listening = true;
  window.addEventListener("message", (ev) => {
    type Msg = { __veo?: number; t?: string; url?: string; title?: string; hmr?: boolean; el?: Picked; key?: string; doc?: string; id?: number; ok?: boolean; data?: unknown; error?: string; l?: string; m?: string; k?: string; at?: number; drop?: number };
    const m = ev.data as Msg | null;
    if (!m || m.__veo !== 1 || !m.t) return;
    const key = [...frames.entries()].find(([, f]) => f.contentWindow === ev.source)?.[0];
    if (!key) return;
    const doc = String(m.doc ?? "");
    if (m.t === "res" && m.id) {
      const w = waiting.get(m.id);
      if (!w) return;
      waiting.delete(m.id);
      clearTimeout(w.timer);
      return m.ok ? w.ok(m.data) : w.fail(new Error(m.error || "failed"));
    }
    if (m.t === "console") return addLog(key, doc, m);
    if ((m.t === "ready" || m.t === "nav") && m.url === "about:blank") return;
    const [kp, kid] = [key.slice(0, key.lastIndexOf(":")), Number(key.slice(key.lastIndexOf(":") + 1))];
    if (m.t === "ready" || m.t === "nav") {
      setPages(key, { url: String(m.url ?? ""), title: String(m.title ?? ""), hmr: !!m.hmr, doc });
      // a página nova falou: já carregou (o `load` da moldura pode chegar antes ou depois)
      if (m.t === "ready") setTabLoading(kp, kid, false);
      setStuck(key, undefined);
      // a página trocou por dentro (link, formulário): o console é da página nova
      if (consoles[key] && consoles[key].doc !== doc) setConsoles(key, { doc, list: [], dropped: 0 });
    } else if (m.t === "bye") {
      // saindo da página por dentro dela (link, formulário): mostra que está carregando. O
      // aviso de uma página que já foi trocada (chegou depois da nova) não conta.
      if (pages[key] && pages[key].doc !== doc) return;
      setTabLoading(kp, kid, true);
      navStarted(kp, kid, pages[key]?.url || "");
    } else if (m.t === "pick" && m.el) {
      setPicking(null);
      handlers.pick?.(key, m.el);
    } else if (m.t === "pick-cancel") setPicking(null);
    else if (m.t === "key" && m.key === "Escape") handlers.escape?.();
    else if (m.t === "cleared") showToast(tx("Dados do site apagados"));
  });
}

// ---------------------------------------------------------------- captura e conversa

const b64 = (s: string) => {
  const u = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(bin);
};
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "pagina";
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
const real = () => isTauri && !currentProject().demo;

/** PNG (base64) do retângulo da janela, como está na tela (página + o que foi riscado). */
export async function snapshot(r: { left: number; top: number; width: number; height: number }): Promise<string> {
  if (!isTauri) throw new Error(tx("A captura só funciona no app."));
  return invoke<string>("browser_snapshot", { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
}

/** Põe arquivos na caixa de mensagem da conversa aberta do projeto. */
async function attach(pid: string, files: { name: string; data: string }[]) {
  // na hora de usar: a conversa importa coisas que importam este arquivo
  const [{ addAtt }, { activeKey }] = await Promise.all([import("./attachments"), import("./convTabs")]);
  const k = activeKey(pid);
  for (const f of files) addAtt(k, await invoke<Att>("attach_stage", { name: f.name, data: f.data }));
  showToast(files.length > 1 ? tx("Anexados à conversa") : tx("Anexado à conversa"));
  if (!brFull()) requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".center .composer textarea")?.focus());
}

const sim = () => showToast(tx("Na simulação nada vai para a conversa: adicione uma pasta sua para usar de verdade."));

/** Captura da área (com os riscos) para a conversa. */
export async function attachShot(pid: string, r: DOMRect, url: string) {
  if (!real()) return sim();
  try {
    const png = await snapshot(r);
    await attach(pid, [{ name: `tela-${slug(tabLabel(url))}-${stamp()}.png`, data: png }]);
  } catch (e) {
    showToast(e instanceof Error ? e.message : String(e));
  }
}

/** Elemento escolhido: um .md com o que a IA precisa (seletor, componente, estilos, HTML) e a imagem dele. */
export async function attachPicked(pid: string, el: Picked, frame: DOMRect, scale: number) {
  if (!real()) return sim();
  const comp = el.component;
  const md = [
    `# ${tx("Elemento escolhido no navegador do Veocode")}`,
    "",
    `- ${tx("Página")}: ${el.url}${el.title ? ` (${el.title})` : ""}`,
    `- ${tx("Seletor")}: \`${el.selector}\``,
    comp ? `- ${tx("Componente")}: ${[comp.name, comp.file && `\`${comp.file}\``].filter(Boolean).join(" · ")} (${comp.lib})` : null,
    `- ${tx("Tamanho na tela")}: ${Math.round(el.rect.w)} × ${Math.round(el.rect.h)} px (${tx("janela de {w} × {h}", { w: el.vw, h: el.vh })})`,
    el.text ? `- ${tx("Texto")}: "${el.text}"` : null,
    "",
    `## ${tx("Estilos calculados")}`,
    ...(Object.keys(el.styles).length ? Object.entries(el.styles).map(([k, v]) => `- ${k}: ${v}`) : [`- ${tx("(nenhum fora do padrão)")}`]),
    "",
    "## HTML",
    "```html",
    el.html,
    "```",
    "",
  ]
    .filter((x): x is string => x !== null)
    .filter((x, i, a) => x !== "" || a[i - 1] !== "")
    .join("\n");
  const name = `elemento-${slug(el.label)}`;
  const files = [{ name: `${name}.md`, data: `data:text/markdown;base64,${b64(md)}` }];
  try {
    // um respiro em volta do elemento; só o que está dentro da moldura
    const pad = 8;
    const x0 = Math.max(frame.left, frame.left + (el.rect.x - pad) * scale);
    const y0 = Math.max(frame.top, frame.top + (el.rect.y - pad) * scale);
    const x1 = Math.min(frame.right, frame.left + (el.rect.x + el.rect.w + pad) * scale);
    const y1 = Math.min(frame.bottom, frame.top + (el.rect.y + el.rect.h + pad) * scale);
    if (x1 - x0 >= 4 && y1 - y0 >= 4) {
      await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
      files.push({ name: `${name}.png`, data: await snapshot({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }) });
    }
  } catch {
    /* sem imagem: vai só o texto */
  }
  try {
    await attach(pid, files);
  } catch (e) {
    showToast(e instanceof Error ? e.message : String(e));
  }
}

/** Salva a captura onde a pessoa escolher. */
export async function saveShot(r: DOMRect, url: string) {
  if (!isTauri) return showToast(tx("A captura só funciona no app."));
  try {
    const png = await snapshot(r);
    const home = await import("@tauri-apps/api/path").then((p) => p.downloadDir()).catch(() => "");
    const path = await save({ title: tx("Salvar captura de tela"), defaultPath: `${home ? `${home}/` : ""}Veocode ${slug(tabLabel(url))} ${stamp()}.png`, filters: [{ name: "PNG", extensions: ["png"] }] });
    if (!path) return;
    await invoke("browser_save_png", { path, data: png });
    showToast(tx("Captura salva"));
  } catch (e) {
    showToast(e instanceof Error ? e.message : String(e));
  }
}

/** Texto de um terminal (logs do servidor) para a conversa. */
export async function attachText(pid: string, name: string, text: string) {
  if (!real()) return sim();
  try {
    await attach(pid, [{ name, data: `data:text/plain;base64,${b64(text)}` }]);
  } catch (e) {
    showToast(e instanceof Error ? e.message : String(e));
  }
}

export async function copyLink(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    showToast(tx("Link copiado"));
  } catch {
    showToast(tx("Não deu para copiar o link"));
  }
}

export const openOutside = (url: string) => void api.openUrl(url).catch(() => {});

/** Apaga os dados do site aberto: armazenamento e cache pela página, cookies (até os HttpOnly) pelo app. */
export function clearSite(pid: string, id: number, url: string) {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    /* sem endereço */
  }
  if (isTauri && host) void invoke("browser_clear_cookies", { host }).catch(() => {});
  tell(pid, id, { t: "clear" });
}

// ---------------------------------------------------------------- arquivos HTML

/** Abre um .html no painel (com o CSS e o JS dele), servido só para o Veocode. */
export async function openHtmlFile(pid: string, file: string, show = true) {
  if (!isTauri) return showToast(tx("Abrir arquivos precisa do app."));
  const root = projects.find((p) => p.id === pid)?.path ?? null;
  try {
    const url = await invoke<string>("browser_serve", { file, root });
    openUrlHere(pid, url, show);
  } catch (e) {
    showToast(e instanceof Error ? e.message : String(e));
  }
}

export async function pickHtmlFile(pid: string) {
  if (!isTauri) return showToast(tx("Abrir arquivos precisa do app."));
  const root = projects.find((p) => p.id === pid)?.path;
  const f = await open({ multiple: false, directory: false, title: tx("Abrir arquivo HTML"), defaultPath: root, filters: [{ name: "HTML", extensions: ["html", "htm"] }] });
  if (typeof f === "string") await openHtmlFile(pid, f);
}

/** A IA gravou um .html: abre (ou recarrega) no painel, se a pessoa deixou ligado. */
export function agentWroteHtml(pid: string, rel: string) {
  const p = projects.find((x) => x.id === pid);
  if (!prefs.openHtml || !p || p.demo || !isTauri) return;
  const file = rel.startsWith("/") ? rel : `${p.path.replace(/\/$/, "")}/${rel}`;
  void openHtmlFile(pid, file, true);
}

// ---------------------------------------------------------------- recarregar quando muda

let fsTimer: number | undefined;
const ignored = /(^|\/)(node_modules|\.git|\.veocode|target|dist|build|\.next|\.svelte-kit|\.turbo|\.cache)\//;
/** Arquivos do projeto mudaram: recarrega a aba da frente (as que já têm recarga própria, não). */
export function noteFsChange(pid: string, paths: string[]) {
  if (!prefs.reloadOnChange || !paths.some((p) => !ignored.test(p))) return;
  clearTimeout(fsTimer);
  fsTimer = window.setTimeout(() => {
    const t = activeTab(pid);
    const page = pageOf(pid, t.id);
    if (t.url && page && !page.hmr) reloadTab(pid, t.id);
  }, 700);
}

// ---------------------------------------------------------------- logs

/** Tira as cores e os comandos de terminal do texto. */
export const plain = (s: string) =>
  s
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Za-z0-9]|\x1b[=>78]/g, "")
    .replace(/\r+\n/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[^\n]*\r(?!\n)/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
