// O que a IA faz no navegador do painel. O Claude recebe do Veocode as ferramentas
// mcp__veocode__browser_* (src-tauri/src/browser.rs, pela própria conexão do chat) e as contas
// por API recebem as mesmas, menos a captura (apiagent.rs); cada uso chega aqui como evento
// "tool" do chat, roda no navegador que a pessoa está vendo e a
// resposta volta com `chat_tool_reply`. As respostas são para a IA (em inglês, curtas); a pessoa
// vê os passos na conversa, o navegador se mexendo e um aviso de que a IA está usando ele.

import { invoke } from "@tauri-apps/api/core";
import {
  activeTab, ask, brOf, brPrefs, consoleOf, clearConsole, droppedOf, errorsOf, frameKey, frameOf, isLoading, loadedAt, markAi, newTab, openHtmlFile,
  pageOf, plain, reloadTab, selectTab, setBrPref, setTabUrl, snapshot, stuckOf, tell, viewports, type Viewport,
} from "./browser";
import { portsOfTerm, servicesOf, termOfService } from "./envs";
import { chatFull, debugOpen, projMode, setDebugOpen, setDebugTab } from "./layoutMode";
import { currentProject, projects, view } from "./store";

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
type Result = { content: Content[]; isError?: boolean };
type Args = Record<string, unknown>;
export type ToolEvent = { projectId: string; requestId: string; name: string; input: Args };

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const text = (t: string): Result => ({ content: [{ type: "text", text: t }] });
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
class Refusal extends Error {}

/** Um uso de ferramenta: faz e responde (nunca deixa o Claude esperando). */
export async function runTool(e: ToolEvent) {
  const pid = e.projectId.split("~")[0];
  let res: Result;
  markAi(pid, 1);
  try {
    res = await exec(pid, e.name, e.input ?? {});
  } catch (err) {
    res = { content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }], isError: true };
  } finally {
    markAi(pid, -1);
  }
  await invoke("chat_tool_reply", { projectId: e.projectId, requestId: e.requestId, result: res }).catch(() => {});
}

// ---------------------------------------------------------------- o painel na tela

/** O navegador deste projeto está (ou pode ficar) na tela? Abre o painel na aba Navegador. */
function needPanel(pid: string) {
  const p = projects.find((x) => x.id === pid);
  if (!p) throw new Refusal("This project isn't open in Veocode anymore.");
  if (view() !== "workspace" || currentProject().id !== pid)
    throw new Refusal(`The person is looking at another screen of Veocode, so the browser of "${p.name}" isn't on screen. Ask them to open this project (in AI mode) and try again.`);
  if (projMode() !== "ai") throw new Refusal("Veocode is in Code mode, where the browser panel isn't shown. Ask the person to switch to AI mode (the browser lives in its right panel) and try again.");
  setDebugTab("browser");
  if (!debugOpen()) setDebugOpen(true);
}

/** Espera a moldura da aba existir (o painel acabou de abrir, a aba acabou de nascer). */
async function waitFrame(pid: string, id: number, ms = 4000) {
  const end = Date.now() + ms;
  while (!frameOf(pid, id)) {
    if (Date.now() > end) throw new Error("The browser panel didn't open.");
    await sleep(60);
  }
}

/** Espera a página da aba carregar e falar com o Veocode. `prev`: o documento de antes (para
 *  saber que trocou). Diz por que não abriu: servidor parado, site que não deixa, demora. */
async function waitPage(pid: string, id: number, prev?: string, ms = 25_000) {
  const k = frameKey(pid, id);
  const end = Date.now() + ms;
  for (;;) {
    const pg = pageOf(pid, id);
    if (pg && pg.doc !== prev && !isLoading(pid, id)) return pg;
    const s = stuckOf(pid, id);
    const url = activeUrl(pid, id);
    if (s === "down") throw new Error(`Nothing is answering at ${url}. Start the dev server first (and wait for it to be ready), then open it again.`);
    if (s === "blocked") throw new Error(`${url} loaded, but it can't be used inside Veocode's panel: the site refuses to be framed by other apps, or failed to load. Use web fetch for public sites.`);
    // carregou sem falar (fora do app ou endereço que não é http): não dá para esperar mais
    if (!isLoading(pid, id) && !pg && (loadedAt.get(k) ?? 0) && Date.now() - (loadedAt.get(k) ?? 0) > 4000) throw new Error(`${url} didn't connect to Veocode.`);
    if (Date.now() > end) throw new Error(`${url} took too long to load.`);
    await sleep(100);
  }
}

const activeUrl = (pid: string, id: number) => pageOf(pid, id)?.url || brOf(pid).list.find((t) => t.id === id)?.url || "the page";

/** A aba da frente, já com a página pronta (para ler, clicar, olhar). */
async function readyTab(pid: string) {
  needPanel(pid);
  const t = activeTab(pid);
  if (!t.url) throw new Refusal("No page is open in the browser panel. Use browser_open first (for example with the dev server's port).");
  await waitFrame(pid, t.id);
  if (!pageOf(pid, t.id) || isLoading(pid, t.id)) await waitPage(pid, t.id, undefined, 15_000);
  return t;
}

const consoleNote = (pid: string, id: number) => {
  const n = errorsOf(pid, id);
  return n ? `\nConsole: ${n} error${n > 1 ? "s" : ""} (see browser_console).` : "\nConsole: no errors.";
};

// ---------------------------------------------------------------- as ferramentas

async function exec(pid: string, name: string, a: Args): Promise<Result> {
  switch (name) {
    case "browser_open":
      return open(pid, str(a.url).trim(), a.new_tab === true);
    case "browser_screenshot":
      return screenshot(pid);
    case "browser_read":
      return read(pid, Number(a.max_chars) || 12000);
    case "browser_click":
      return act(pid, "click", { ref: a.ref, selector: a.selector, text: a.text });
    case "browser_type":
      return act(pid, "type", { ref: a.ref, selector: a.selector, text: a.text, value: str(a.value), append: a.append === true, submit: a.submit === true });
    case "browser_scroll":
      return scroll(pid, a);
    case "browser_console":
      return consoleTool(pid, a.errors_only === true, a.clear === true);
    case "browser_server_logs":
      return serverLogs(pid, Math.min(400, Math.max(5, Number(a.lines) || 80)));
    case "browser_viewport":
      return viewport(pid, str(a.size) as Viewport);
    default:
      throw new Refusal(`Unknown tool ${name}.`);
  }
}

/** Endereço, porta, arquivo .html do projeto ou back / forward / reload. */
async function open(pid: string, raw: string, fresh: boolean): Promise<Result> {
  if (!raw) throw new Refusal("Give a url.");
  needPanel(pid);
  const p = projects.find((x) => x.id === pid)!;
  const t0 = activeTab(pid);
  const cmd = raw.toLowerCase();
  if (cmd === "back" || cmd === "forward" || cmd === "reload") {
    if (!t0.url) throw new Refusal("No page is open in the browser panel.");
    await waitFrame(pid, t0.id);
    const prev = pageOf(pid, t0.id)?.doc;
    if (cmd === "reload") reloadTab(pid, t0.id);
    else tell(pid, t0.id, { t: cmd });
    await sleep(350);
    const pg = await waitPage(pid, t0.id, cmd === "reload" ? prev : undefined);
    return text(`${cmd === "reload" ? "Reloaded" : cmd === "back" ? "Went back to" : "Went forward to"} ${pg.url}\nTitle: ${pg.title || "(none)"}${consoleNote(pid, t0.id)}`);
  }
  // arquivo do projeto (index.html, ./docs/a.html, /caminho/absoluto.html)
  // "index.html", "docs/a.html", "./a.html", "/caminho/a.html" são arquivos; "site.com/a.html" e "localhost:3000/a.html", endereços
  const first = raw.split("/")[0];
  const isFile = !/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && /\.html?([?#].*)?$/i.test(raw) && !/:\d/.test(first) && (!raw.includes("/") || /^(\/|\.\.?\/)/.test(raw) || !first.includes("."));
  if (isFile) {
    if (p.demo) throw new Refusal("This is Veocode's sample project: there are no real files to open.");
    const file = raw.startsWith("/") ? raw : `${p.path.replace(/\/$/, "")}/${raw.replace(/^\.\//, "")}`;
    const before = activeTab(pid);
    const prev = pageOf(pid, before.id)?.doc;
    await openHtmlFile(pid, file.replace(/[?#].*$/, ""), true);
    const t = activeTab(pid);
    await waitFrame(pid, t.id);
    const pg = await waitPage(pid, t.id, t.id === before.id ? prev : undefined);
    return text(`Opened the file ${raw} at ${pg.url}\nTitle: ${pg.title || "(none)"}${consoleNote(pid, t.id)}`);
  }
  let url = raw;
  if (/^\d{2,5}$/.test(url)) url = `localhost:${url}`;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `http://${url}`;
  if (!/^https?:\/\//i.test(url)) throw new Refusal("Only http and https addresses (or .html files of the project) open in the panel.");
  // a aba que já mostra esse endereço; senão a da frente (ou uma nova, se pedido ou se ela estiver vazia… então usa ela)
  const st = brOf(pid);
  const same = st.list.find((t) => t.url === url || pageOf(pid, t.id)?.url === url);
  let id: number;
  let prev: string | undefined;
  if (same && !fresh) {
    selectTab(pid, same.id);
    id = same.id;
    await waitFrame(pid, id);
    prev = pageOf(pid, id)?.doc;
    reloadTab(pid, id);
  } else if (fresh && t0.url) {
    id = newTab(pid, url).id;
  } else {
    id = t0.id;
    setTabUrl(pid, url);
  }
  await waitFrame(pid, id);
  const pg = await waitPage(pid, id, prev);
  return text(`Opened ${pg.url}\nTitle: ${pg.title || "(none)"}${consoleNote(pid, id)}`);
}

/** Imagem da página como a pessoa vê (no tamanho de tela escolhido). JPEG em 1x: leve para a IA. */
async function screenshot(pid: string): Promise<Result> {
  const t = await readyTab(pid);
  if (chatFull()) throw new Refusal("The browser panel is hidden because the conversation is in full screen in Veocode. Ask the person to leave full screen (Esc) to take a screenshot.");
  const f = frameOf(pid, t.id)!;
  await sleep(150);
  const r = f.getBoundingClientRect();
  if (r.width < 20 || r.height < 20) throw new Refusal("The browser panel is too small to see right now.");
  const png = await snapshot(r);
  const img = await shrink(png, r.width, r.height);
  const pg = pageOf(pid, t.id);
  const vp = viewports.find((v) => v.id === brPrefs.viewport);
  const size = vp?.w ? `${vp.label()} ${vp.w}×${vp.h}` : `${Math.round(r.width)}×${Math.round(r.height)}`;
  return { content: [img, { type: "text", text: `${pg?.url ?? t.url} · ${size}${consoleNote(pid, t.id)}` }] };
}

/** PNG da tela (2x) → JPEG com no máximo 1568 px no lado maior. */
async function shrink(pngB64: string, w: number, h: number): Promise<Content> {
  try {
    const img = new Image();
    img.src = `data:image/png;base64,${pngB64}`;
    await img.decode();
    const k = Math.min(1, 1568 / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.round(w * k);
    c.height = Math.round(h * k);
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    return { type: "image", data: c.toDataURL("image/jpeg", 0.85).split(",")[1], mimeType: "image/jpeg" };
  } catch {
    return { type: "image", data: pngB64, mimeType: "image/png" };
  }
}

type Read = {
  url: string;
  title: string;
  text: string;
  chars: number;
  elements: { ref: string; role: string; name: string; value?: string; checked?: boolean; disabled?: boolean; href?: string; offscreen?: boolean }[];
  scroll: { y: number; max: number };
  vw: number;
  vh: number;
};

async function read(pid: string, max: number): Promise<Result> {
  const t = await readyTab(pid);
  const r = await ask<Read>(pid, t.id, { t: "read", max });
  const els = r.elements.map((e) => {
    const bits = [`[${e.ref}]`, e.role, e.name ? JSON.stringify(e.name) : ""];
    if (e.value !== undefined && e.value !== "") bits.push(`value=${JSON.stringify(e.value)}`);
    if (e.checked !== undefined) bits.push(e.checked ? "checked" : "unchecked");
    if (e.disabled) bits.push("disabled");
    if (e.href) bits.push(`→ ${e.href}`);
    if (e.offscreen) bits.push("(scroll to see)");
    return bits.filter(Boolean).join(" ");
  });
  const out = [
    `URL: ${r.url}`,
    `Title: ${r.title || "(none)"}`,
    `Viewport: ${r.vw}×${r.vh} · scrolled ${r.scroll.y} of ${r.scroll.max}px`,
    consoleNote(pid, t.id).trim(),
    "",
    `## Text${r.chars > r.text.length ? ` (first ${r.text.length} of ${r.chars} characters)` : ""}`,
    r.text || "(no text)",
    "",
    `## Interactive elements (${els.length})`,
    ...(els.length ? els : ["(none)"]),
  ];
  return text(out.join("\n"));
}

/** Clicar ou digitar; espera a navegação que isso causar. */
async function act(pid: string, t: "click" | "type", m: Args): Promise<Result> {
  const tab = await readyTab(pid);
  const before = pageOf(pid, tab.id);
  const r = await ask<{ clicked?: string; typed?: string }>(pid, tab.id, { t, ...m });
  // deu tempo de a página reagir (ou começar a sair)
  await sleep(400);
  const left = isLoading(pid, tab.id) || pageOf(pid, tab.id)?.doc !== before?.doc;
  let where = pageOf(pid, tab.id);
  if (left) {
    try {
      where = await waitPage(pid, tab.id, before?.doc, 20_000);
    } catch (e) {
      return text(`${t === "click" ? `Clicked ${r.clicked}` : `Typed into ${r.typed}`}, then the page navigated but: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const moved = where && before && where.url !== before.url ? `\nNow at ${where.url} (${where.title || "no title"})` : "";
  const done = t === "click" ? `Clicked ${r.clicked}.` : `Typed into ${r.typed}${m.submit ? " and submitted" : ""}.`;
  return text(`${done}${moved}${consoleNote(pid, tab.id)}`);
}

async function scroll(pid: string, a: Args): Promise<Result> {
  const t = await readyTab(pid);
  const r = await ask<{ y: number; max: number }>(pid, t.id, { t: "scroll", to: str(a.to) || "down", ref: a.ref, selector: a.selector, text: a.text });
  return text(`Scrolled: ${r.y} of ${r.max}px.`);
}

function consoleTool(pid: string, errorsOnly: boolean, clear: boolean): Result {
  needPanel(pid);
  const t = activeTab(pid);
  if (!t.url) throw new Refusal("No page is open in the browser panel.");
  const all = consoleOf(pid, t.id);
  const list = errorsOnly ? all.filter((x) => x.l === "error") : all;
  const dropped = droppedOf(pid, t.id);
  if (clear) clearConsole(pid, t.id);
  const page = pageOf(pid, t.id)?.url ?? t.url;
  if (!list.length) return text(`${page}: no ${errorsOnly ? "errors" : "console messages"} since the page loaded.`);
  const shown = list.slice(-150);
  const lines = shown.map((x) => `[${x.k === "network" ? "network" : x.k === "exception" ? "uncaught" : x.l}] ${x.m}`);
  return text(
    [
      `${page}: ${list.length} message${list.length > 1 ? "s" : ""}${shown.length < list.length ? ` (last ${shown.length})` : ""}${dropped ? `, ${dropped} more dropped (the page logs a lot)` : ""}.`,
      ...lines,
    ].join("\n"),
  );
}

async function serverLogs(pid: string, lines: number): Promise<Result> {
  needPanel(pid);
  const t = activeTab(pid);
  const url = pageOf(pid, t.id)?.url ?? t.url;
  const port = Number(/^https?:\/\/[^/:]+:(\d+)/.exec(url)?.[1] ?? 0);
  const running = servicesOf(pid)
    .map((s) => ({ s, term: termOfService(pid, s.key) }))
    .filter((x) => x.term?.alive);
  const hit = running.find((x) => port && portsOfTerm(pid, x.term!.id).includes(port)) ?? (running.length === 1 ? running[0] : null);
  if (!hit) {
    return text(
      running.length
        ? `None of the servers Veocode runs serves ${url}. Running: ${running.map((x) => `${x.s.name} (${x.s.cmd})`).join(", ")}.`
        : "No server started from Veocode's server list is running. If you started the dev server yourself in the background, read its output there.",
    );
  }
  const raw = plain(await invoke<string>("term_buffer", { id: hit.term!.id }).catch(() => ""));
  const tail = raw.split("\n").slice(-lines).join("\n").trim();
  return text(`${hit.s.name} (${hit.s.cmd}) — last ${lines} lines:\n${tail || "(no output yet)"}`);
}

async function viewport(pid: string, size: Viewport): Promise<Result> {
  const v = viewports.find((x) => x.id === size);
  if (!v) throw new Refusal("size must be fit, phone, tablet or laptop.");
  needPanel(pid);
  setBrPref("viewport", v.id);
  await sleep(300);
  return text(v.w ? `The panel browser now shows the page at ${v.w}×${v.h} (${v.label()}), scaled down to fit if needed.` : "The panel browser now fills the whole panel.");
}
