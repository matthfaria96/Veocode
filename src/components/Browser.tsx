// Navegador do painel da direita (modo IA), no jeito de um navegador de verdade:
// - abas (com + e tela cheia) e a barra: voltar, avançar, recarregar, endereço;
// - escolher um elemento na página: vai para a conversa com seletor, componente, estilos,
//   HTML e a imagem dele;
// - riscar a página (lápis, retângulo, texto, cor, espessura, desfazer) e mandar a captura;
// - servidores do projeto: rodar, parar, ver os logs e adicionar um novo;
// - menu ⋯: abrir fora, copiar link, salvar captura, abrir um .html, tamanho da tela, logs,
//   console, preferências (links do chat, HTML da IA, recarregar), dados só até fechar o app e
//   apagar os dados do site;
// - console da página (erros, avisos, rede que falhou) com o número de erros na barra;
// - página que não abriu: diz se o servidor não respondeu ou se o site não deixa abrir aqui;
// - a IA usa este mesmo navegador (browserTools.ts): um aviso mostra quando ela está mexendo.
// Estado e a ponte com a página: src/browser.ts. A ponte em si: src-tauri/src/bridge.js.

import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowLeft, ArrowRight, Camera, Cookie, Ellipsis, ExternalLink, FileCode, Globe, Link, Maximize2, MessagesSquare, Minimize2, Monitor, MousePointer2, Paperclip, PenLine,
  Pencil, Play, Plus, Redo2, RefreshCw, RotateCw, ScrollText, Server, ServerOff, ShieldAlert, Sparkles, Square, SquareMousePointer, SquareTerminal, Terminal, Trash2,
  TriangleAlert, Type, Undo2, X,
} from "lucide-solid";
import { batch, createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { isTauri } from "../api";
import {
  activeTab, aiUsing, attachPicked, attachShot, attachText, brFull, brOf, brPrefs, clearConsole, clearSite, closeTab, consoleOf, consoleOpen, copyLink, drawing,
  droppedOf, errorsOf, frameKey, frameLoaded, frameOf, injectBridge, navStarted, isLoading, listenBridge, logsOf, newTab, onBridge, openOutside, pageOf, picking, pickHtmlFile,
  plain, portOf, registerFrame, reloadTab, saveShot, selectTab, servedPath, setBrFull, setBrPref, setConsoleOpen, setDrawing, setLogsOf, setPicking, setTabUrl,
  sitesReady, stuckOf, tabLabel, tell, viewports, type LogLine,
} from "../browser";
import { envs, loadPorts, loadServices, portsOfTerm, restartService, saveServices, servicesOf, startService, stopService, termOfService, type Service } from "../envs";
import { setContextMenu, type MenuEntry } from "../fileActions";
import { dismissable } from "../dismiss";
import { setProjMode, showTerm } from "../layoutMode";
import { portsOf, procsOf, stopProc } from "../projProcs";
import { currentProject } from "../store";
import { setActiveTerm, syncTermList, terms } from "../terminal";
import { dec, tx, txn } from "../i18n";
import { ServiceForm } from "./EnvPanel";

const demoPage = () => `<!doctype html><html><head><meta charset="utf-8"><title>${tx("Raio-X")}</title><style>
body{margin:0;font:14px/1.5 -apple-system,system-ui,sans-serif;background:#0d1017;color:#e7eaf3}
header{display:flex;align-items:center;gap:10px;padding:16px 22px;border-bottom:1px solid #222938}
header b{font-size:15px}header span{margin-left:auto;font-size:12px;color:#8d96ab}
main{padding:22px;display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(180px,1fr))}
.c{padding:14px 16px;border:1px solid #222938;border-radius:12px;background:#12161f}
.c small{color:#8d96ab;font-size:12px}.c strong{display:block;font-size:22px;font-weight:600;margin-top:2px}
.bar{height:6px;border-radius:4px;background:#222938;margin-top:10px;overflow:hidden}.bar i{display:block;height:100%;background:#6b9cff}
</style></head><body><header class="titlebar"><b>${tx("Raio-X")}</b><span>localhost:5173</span></header><main>
<div class="c"><small>Caches</small><strong>${dec(2.4)} GB</strong><div class="bar"><i style="width:62%"></i></div></div>
<div class="c"><small>node_modules</small><strong>${dec(1.1)} GB</strong><div class="bar"><i style="width:38%"></i></div></div>
<div class="c"><small>${tx("Modelos")}</small><strong>${dec(8.7)} GB</strong><div class="bar"><i style="width:84%"></i></div></div>
</main></body></html>`;

/** O que aparece na barra: o arquivo servido, ou o endereço sem o http://. */
const display = (u: string) => servedPath(u) ?? u.replace(/^https?:\/\//, "");

export default function Browser(props: { focusPort: number | null }) {
  const p = currentProject;
  const pid = () => p().id;
  const ports = () => portsOf(pid());
  const st = () => brOf(pid());
  const active = () => activeTab(pid());
  const url = () => active().url;
  const page = () => pageOf(pid(), active().id);
  /** endereço de agora: o que a página contou (apps de uma página só mudam sem recarregar) */
  const shown = () => {
    const u = page()?.url;
    return u && /^https?:/.test(u) ? u : url();
  };
  const [draft, setDraft] = createSignal("");
  const [srv, setSrv] = createSignal(false);
  let input: HTMLInputElement | undefined;
  let stage!: HTMLDivElement;
  let moreBtn!: HTMLButtonElement;

  onMount(listenBridge);
  onCleanup(() => {
    onBridge({ pick: undefined, escape: undefined });
    batch(() => (setBrFull(false), setDrawing(false), setPicking(null), setLogsOf(null), setConsoleOpen(false)));
  });
  // "dados só até fechar": as páginas esperam os cookies saírem (uma vez por abertura do app)
  const [sitesOk, setSitesOk] = createSignal(false);
  onMount(() => void sitesReady().then(() => setSitesOk(true)));
  const errs = () => errorsOf(pid(), active().id);
  const showLogs = (id: string | null) => batch(() => (setConsoleOpen(false), setLogsOf(id)));
  const showConsole = (v: boolean) => batch(() => (setLogsOf(null), setConsoleOpen(v)));

  // ------------------------------------------------ tamanho da tela
  const [avail, setAvail] = createSignal({ w: 0, h: 0 });
  onMount(() => {
    const ro = new ResizeObserver(() => {
      const cs = getComputedStyle(stage);
      const px = (k: string) => parseFloat(cs.getPropertyValue(k)) || 0;
      setAvail({ w: stage.clientWidth - px("padding-left") - px("padding-right"), h: stage.clientHeight - px("padding-top") - px("padding-bottom") });
    });
    ro.observe(stage);
    onCleanup(() => ro.disconnect());
  });
  const vp = () => viewports.find((v) => v.id === brPrefs.viewport) ?? viewports[0];
  const scale = () => (vp().w ? Math.min(1, avail().w / vp().w, avail().h / vp().h) : 1);

  // ------------------------------------------------ endereço
  // servidor novo no projeto: abre sozinho se a aba da frente estiver vazia, ou se o servidor
  // que ela mostrava parou (um endereço que a pessoa digitou fica onde está)
  createEffect(on(() => ports().join(","), (_, prev) => {
    const now = ports();
    if (!now.length) return;
    const before = prev ? prev.split(",").filter(Boolean).map(Number) : [];
    const port = portOf(url());
    const fresh = now.find((x) => !before.includes(x)) ?? now[0];
    if (!url() || (port && before.includes(port) && !now.includes(port))) setTabUrl(pid(), `http://localhost:${fresh}`);
  }));
  /** Mostra um servidor: a aba que já está nele, a da frente se estiver vazia, ou uma nova. */
  const openPort = (port: number) => {
    const has = st().list.find((t) => portOf(t.url) === port || portOf(pageOf(pid(), t.id)?.url ?? "") === port);
    if (has) return selectTab(pid(), has.id);
    if (!url()) setTabUrl(pid(), `http://localhost:${port}`);
    else newTab(pid(), `http://localhost:${port}`);
  };
  // rodou um servidor pelo botão: quando a porta dele aparecer, abre aqui (desiste em 2 min)
  const [awaiting, setAwaiting] = createSignal<string | null>(null);
  createEffect(on(awaiting, (k) => {
    if (!k) return;
    const id = window.setInterval(() => void loadPorts(pid()), 2000);
    const stop = window.setTimeout(() => setAwaiting(null), 120_000);
    onCleanup(() => (clearInterval(id), clearTimeout(stop)));
  }));
  createEffect(() => {
    const k = awaiting();
    if (!k) return;
    const t = termOfService(pid(), k);
    const ps = t?.alive ? portsOfTerm(pid(), t.id) : [];
    if (ps.length) {
      setAwaiting(null);
      openPort(ps[0]);
    }
  });
  createEffect(on(pid, () => setAwaiting(null), { defer: true }));
  createEffect(on(() => props.focusPort, (port) => port && openPort(port), { defer: true }));
  createEffect(on(() => `${active().id} ${shown()}`, () => setDraft(display(shown()))));

  const go = () => {
    let u = draft().trim();
    if (!u) return;
    if (u === display(shown())) return reloadTab(pid());
    if (/^\d+$/.test(u)) u = `localhost:${u}`;
    if (!/^https?:\/\//.test(u)) u = `http://${u}`;
    setTabUrl(pid(), u);
  };
  const addTab = () => {
    newTab(pid());
    queueMicrotask(() => input?.focus());
  };

  // ------------------------------------------------ escolher um elemento
  const key = () => frameKey(pid(), active().id);
  const stopPick = () => {
    const k = picking();
    if (!k) return;
    const [kp, kid] = [k.slice(0, k.lastIndexOf(":")), Number(k.slice(k.lastIndexOf(":") + 1))];
    tell(kp, kid, { t: "pick", on: false });
    setPicking(null);
  };
  const togglePick = () => {
    if (picking()) return stopPick();
    setDrawing(false);
    setPicking(key());
    tell(pid(), active().id, { t: "pick", on: true });
  };
  createEffect(on(key, () => stopPick(), { defer: true }));
  onBridge({
    pick: (k, el) => {
      const id = Number(k.slice(k.lastIndexOf(":") + 1));
      const f = frameOf(pid(), id);
      if (!f || k !== key()) return;
      void attachPicked(pid(), el, f.getBoundingClientRect(), scale());
    },
    escape: () => {
      if (picking()) stopPick();
      else if (drawing()) setDrawing(false);
      else if (brFull()) setBrFull(false);
    },
  });
  onMount(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (picking()) stopPick();
      else if (brFull() && !drawing()) setBrFull(false);
    };
    window.addEventListener("keydown", esc);
    onCleanup(() => window.removeEventListener("keydown", esc));
  });

  // ------------------------------------------------ servidores e logs
  /** O serviço (aba Ambiente) que serve a página da frente, para os logs. */
  const serverOfPage = createMemo(() => {
    const port = portOf(shown());
    const running = servicesOf(pid())
      .map((s) => ({ s, t: termOfService(pid(), s.key) }))
      .filter((x): x is { s: Service; t: NonNullable<typeof x.t> } => !!x.t?.alive);
    return running.find((x) => port && portsOfTerm(pid(), x.t.id).includes(port)) ?? (running.length === 1 ? running[0] : null);
  });
  /** quantos servidores estão de pé (portas abertas na pasta, de quem quer que seja) */
  const runningServers = () => ports().length;

  // ------------------------------------------------ menu ⋯
  /** só a página (sem a borda da moldura); em tamanho de celular etc., já com a escala aplicada */
  const frameRect = () => (frameOf(pid(), active().id) ?? stage).getBoundingClientRect();
  const more = () => {
    const u = shown();
    const has = !!url();
    const svc = serverOfPage();
    let site = "";
    try {
      site = new URL(u).host;
    } catch {
      /* sem endereço */
    }
    const items: MenuEntry[] = [
      { label: tx("Abrir no seu navegador"), icon: () => <ExternalLink size={14} />, disabled: !has, run: () => openOutside(u) },
      { label: tx("Copiar link"), icon: () => <Link size={14} />, disabled: !has, run: () => void copyLink(u) },
      { label: tx("Salvar captura de tela"), icon: () => <Camera size={14} />, disabled: !has, run: () => void saveShot(frameRect(), u) },
      { label: tx("Abrir arquivo HTML…"), icon: () => <FileCode size={14} />, run: () => void pickHtmlFile(pid()) },
      "sep",
      {
        label: tx("Tamanho da tela"),
        icon: () => <Monitor size={14} />,
        value: vp().label(),
        sub: viewports.map((v) => ({ label: v.label(), hint: v.w ? `${v.w} × ${v.h}` : tx("Ocupa o painel todo"), checked: brPrefs.viewport === v.id, run: () => setBrPref("viewport", v.id) })),
      },
      { label: tx("Mostrar logs do servidor"), icon: () => <ScrollText size={14} />, disabled: !svc, hint: svc ? svc.s.name : tx("Para os servidores que o Veocode roda"), run: () => svc && showLogs(svc.t.id) },
      { label: tx("Console da página"), icon: () => <Terminal size={14} />, disabled: !page(), value: errs() ? txn(errs(), "{n} erro", "{n} erros") : undefined, run: () => showConsole(true) },
      "sep",
      { label: tx("Abrir links do chat aqui"), icon: () => <MessagesSquare size={14} />, hint: tx("Endereços locais, como localhost"), checked: brPrefs.linksHere, run: () => setBrPref("linksHere", !brPrefs.linksHere) },
      { label: tx("Abrir os HTML que a IA gravar"), icon: () => <Sparkles size={14} />, checked: brPrefs.openHtml, run: () => setBrPref("openHtml", !brPrefs.openHtml) },
      { label: tx("Recarregar quando os arquivos mudarem"), icon: () => <RefreshCw size={14} />, hint: tx("Vite e Next já se atualizam sozinhos"), checked: brPrefs.reloadOnChange, run: () => setBrPref("reloadOnChange", !brPrefs.reloadOnChange) },
      "sep",
      { head: tx("Dados dos sites") },
      { label: tx("Manter cookies só até fechar o Veocode"), icon: () => <Cookie size={14} />, hint: tx("Ao abrir de novo, os sites começam sem login nem dados"), checked: brPrefs.sessionOnly, run: () => setBrPref("sessionOnly", !brPrefs.sessionOnly) },
      { label: tx("Apagar dados deste site"), icon: () => <Trash2 size={14} />, danger: true, disabled: !page(), hint: site ? tx("Cookies, armazenamento e cache de {site}", { site }) : undefined, run: () => clearSite(pid(), active().id, u) },
    ];
    const r = moreBtn.getBoundingClientRect();
    setContextMenu({ x: r.right - 260, y: r.bottom + 6, items });
  };

  return (
    <div class="dbg-browser" classList={{ drawing: drawing(), picking: !!picking() }}>
      <div class="br-tabs" role="tablist" aria-label={tx("Abas do navegador")}>
        <For each={st().list}>
          {(t) => {
            const pg = () => pageOf(pid(), t.id);
            const name = () => pg()?.title || tabLabel(pg()?.url && /^https?:/.test(pg()!.url) ? pg()!.url : t.url);
            return (
              <div
                class="br-tab"
                classList={{ on: t.id === active().id }}
                role="tab"
                aria-selected={t.id === active().id}
                tabindex="0"
                title={t.url ? `${name()}\n${display(pg()?.url || t.url)}` : tx("Nova aba")}
                onClick={() => selectTab(pid(), t.id)}
                onAuxClick={(e) => e.button === 1 && (e.preventDefault(), closeTab(pid(), t.id))}
                onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && selectTab(pid(), t.id)}
              >
                <Show when={isLoading(pid(), t.id)} fallback={servedPath(t.url) ? <FileCode size={11} /> : <Globe size={11} />}><span class="br-tab-spin" /></Show>
                <span class="br-tab-name">{t.url ? name() : tx("Nova aba")}</span>
                <Show when={st().list.length > 1 || t.url}>
                  <button class="br-tab-x" title={tx("Fechar a aba")} onClick={(e) => (e.stopPropagation(), closeTab(pid(), t.id))}><X size={11} /></button>
                </Show>
              </div>
            );
          }}
        </For>
        <button class="icon-btn small br-tab-new" title={tx("Nova aba")} onClick={addTab}><Plus size={13} /></button>
        <span class="dbg-spacer" />
        <Show when={aiUsing(pid())}>
          <span class="br-ai" title={tx("A IA está usando este navegador: abrindo páginas, olhando, clicando ou digitando")}><Sparkles size={11} /> {tx("IA usando")}</span>
        </Show>
        <button class="icon-btn small" classList={{ on: brFull() }} title={brFull() ? tx("Sair da tela cheia (Esc)") : tx("Tela cheia: o navegador ocupa a janela")} onClick={() => setBrFull(!brFull())}>
          <Show when={brFull()} fallback={<Maximize2 size={13} />}><Minimize2 size={13} /></Show>
        </button>
      </div>

      <div class="br-bar">
        <button class="icon-btn small br-nav" title={tx("Voltar")} disabled={!page()} onClick={() => tell(pid(), active().id, { t: "back" })}><ArrowLeft size={14} /></button>
        <button class="icon-btn small br-nav" title={tx("Avançar")} disabled={!page()} onClick={() => tell(pid(), active().id, { t: "forward" })}><ArrowRight size={14} /></button>
        <button class="icon-btn small" title={tx("Recarregar")} disabled={!url()} onClick={() => reloadTab(pid())}><span class="br-reload" classList={{ spin: isLoading(pid(), active().id) }}><RotateCw size={13} /></span></button>
        <form class="br-url" onSubmit={(e) => (e.preventDefault(), go())}>
          <Show when={servedPath(shown())} fallback={<Globe size={11} />}><FileCode size={11} /></Show>
          <input ref={input} value={draft()} placeholder={tx("localhost:3000")} spellcheck={false} onInput={(e) => setDraft(e.currentTarget.value)} onFocus={(e) => e.currentTarget.select()} aria-label={tx("Endereço")} />
        </form>
        <Show when={errs()}>
          <button class="br-errs" classList={{ on: consoleOpen() }} title={tx("Erros no console da página: ver")} onClick={() => showConsole(!consoleOpen())}>
            <TriangleAlert size={12} />
            {errs()}
          </button>
        </Show>
        <button class="icon-btn small br-tool" classList={{ on: !!picking() }} aria-pressed={!!picking()} disabled={!page()} title={page() ? tx("Escolher um elemento da página para a conversa (Esc cancela)") : tx("Abra uma página para escolher um elemento")} onClick={togglePick}>
          <SquareMousePointer size={14} />
        </button>
        <button class="icon-btn small br-tool" classList={{ on: drawing() }} aria-pressed={drawing()} disabled={!url()} title={tx("Riscar a página e mandar a captura para a conversa")} onClick={() => (stopPick(), setDrawing(!drawing()))}>
          <PenLine size={14} />
        </button>
        <div class="br-pop-wrap">
          <button class="icon-btn small br-tool" classList={{ on: srv() }} aria-expanded={srv()} title={tx("Servidores do projeto: rodar, parar, logs e adicionar")} onClick={() => setSrv(!srv())}>
            <Server size={14} />
            <Show when={runningServers()}><i class="br-count">{runningServers()}</i></Show>
          </button>
          <Show when={srv()}>
            <Servers pid={pid()} onStart={(k) => !p().demo && setAwaiting(k)} onOpen={(port) => (setSrv(false), openPort(port))} onLogs={(id) => (setSrv(false), showLogs(id))} onClose={() => setSrv(false)} />
          </Show>
        </div>
        <button ref={moreBtn} class="icon-btn small br-tool" title={tx("Mais")} onClick={more}><Ellipsis size={14} /></button>
      </div>

      <div class="br-stage" ref={stage} classList={{ sized: !!vp().w }}>
        <Show when={!url()}>
          <div class="dbg-empty">
            <Globe size={20} />
            <Show
              when={st().list.length > 1 || ports().length}
              fallback={
                <>
                  <strong>{tx("Nenhum servidor rodando")}</strong>
                  <span>{tx("Rode um pelo botão de servidores, lá em cima, ou peça à IA (npm run dev, por exemplo): ele aparece aqui sozinho. Ou digite um endereço.")}</span>
                  <button class="ghost-btn small" onClick={() => setSrv(true)}><Server size={12} /> {tx("Ver os servidores")}</button>
                </>
              }
            >
              <strong>{tx("Aba vazia")}</strong>
              <span>{tx("Digite um endereço lá em cima, como localhost:3000.")}</span>
            </Show>
          </div>
        </Show>
        <Show when={vp().w && url()}>
          <span class="br-size">{vp().w} × {vp().h}{scale() < 1 ? ` · ${Math.round(scale() * 100)}%` : ""}</span>
        </Show>
        {/* uma moldura por aba com endereço; só a da frente aparece, as outras seguem carregadas */}
        <For each={sitesOk() ? st().list.filter((t) => t.url) : []}>
          {(t) => {
            const on = () => t.id === active().id;
            const sized = () => (vp().w ? { width: `${vp().w * scale()}px`, height: `${vp().h * scale()}px` } : undefined);
            const inner = () => (vp().w ? { width: `${vp().w}px`, height: `${vp().h}px`, transform: `scale(${scale()})` } : undefined);
            const loaded = (el: HTMLIFrameElement) => {
              frameLoaded(pid(), t.id, t.url);
              if (p().demo || !isTauri) injectBridge(el);
              tell(pid(), t.id, { t: "ping" });
            };
            return (
              <div class="br-frame" classList={{ hide: !on(), [brPrefs.viewport]: !!vp().w }} style={sized()}>
                <Show
                  when={p().demo}
                  fallback={<iframe ref={(el) => { onCleanup(registerFrame(pid(), t.id, el)); navStarted(pid(), t.id, t.url); }} name={brPrefs.sessionOnly ? "veo-session" : undefined} title={tx("App rodando")} src={t.url} style={inner()} onLoad={(e) => loaded(e.currentTarget)} />}
                >
                  <iframe ref={(el) => onCleanup(registerFrame(pid(), t.id, el))} title={tx("App rodando")} srcdoc={demoPage()} style={inner()} onLoad={(e) => loaded(e.currentTarget)} />
                </Show>
                <Show when={drawing() && on()}>
                  <DrawLayer />
                </Show>
                <Show when={stuckOf(pid(), t.id)}>
                  {(why) => <Stuck why={why()} url={t.url} onRetry={() => reloadTab(pid(), t.id)} onServers={() => setSrv(true)} />}
                </Show>
              </div>
            );
          }}
        </For>
      </div>

      <Show when={drawing() && url()}>
        <DrawBar onSend={(r) => void attachShot(pid(), r, shown()).then(() => setDrawing(false))} />
      </Show>
      <Show when={logsOf()}>{(id) => <Logs pid={pid()} id={id()} onClose={() => setLogsOf(null)} />}</Show>
      <Show when={consoleOpen() && url()}>
        <Console pid={pid()} id={active().id} url={shown()} onClose={() => setConsoleOpen(false)} />
      </Show>
    </div>
  );
}

// ------------------------------------------------------------------ página que não abriu

function Stuck(props: { why: "down" | "blocked"; url: string; onRetry: () => void; onServers: () => void }) {
  const where = () => display(props.url).replace(/\/$/, "");
  const host = () => {
    try {
      return new URL(props.url).host;
    } catch {
      return props.url;
    }
  };
  return (
    <div class="br-stuck pop-in">
      <Show when={props.why === "down"} fallback={<ShieldAlert size={22} />}>
        <ServerOff size={22} />
      </Show>
      <Show
        when={props.why === "down"}
        fallback={
          <>
            <strong>{tx("Esta página não abre aqui")}</strong>
            <span>{tx("{site} não deixa ser aberto dentro de outro app (muitos sites grandes fazem isso), ou não respondeu.", { site: host() })}</span>
            <div class="br-stuck-btns">
              <button class="primary-btn small" onClick={() => openOutside(props.url)}><ExternalLink size={12} /> {tx("Abrir no seu navegador")}</button>
              <button class="ghost-btn small" onClick={props.onRetry}><RotateCw size={12} /> {tx("Tentar de novo")}</button>
            </div>
          </>
        }
      >
        <strong>{tx("Nada respondendo em {url}", { url: where() })}</strong>
        <span>{tx("O servidor parou ou ainda está subindo. Rode ele pelos servidores e a página abre sozinha.")}</span>
        <div class="br-stuck-btns">
          <button class="primary-btn small" onClick={props.onServers}><Server size={12} /> {tx("Ver os servidores")}</button>
          <button class="ghost-btn small" onClick={props.onRetry}><RotateCw size={12} /> {tx("Tentar de novo")}</button>
        </div>
      </Show>
    </div>
  );
}

// ------------------------------------------------------------------ console da página

function Console(props: { pid: string; id: number; url: string; onClose: () => void }) {
  const [only, setOnly] = createSignal(false);
  const list = () => consoleOf(props.pid, props.id).filter((x) => !only() || x.l === "error" || x.l === "warn");
  const dropped = () => droppedOf(props.pid, props.id);
  let box!: HTMLDivElement;
  let stick = true;
  createEffect(on(() => list().length, () => stick && requestAnimationFrame(() => box && (box.scrollTop = box.scrollHeight))));
  // pilhas de erro longas ficam em 3 linhas até um clique
  const [opened, setOpened] = createSignal(new Set<number>());
  const long = (x: LogLine) => x.m.length > 240 || x.m.split("\n").length > 3;
  const flip = (n: number) => setOpened((o) => { const s = new Set(o); if (!s.delete(n)) s.add(n); return s; });
  const kind = (x: LogLine) => (x.k === "network" ? tx("rede") : x.k === "exception" ? tx("não tratado") : x.k === "resource" ? tx("arquivo") : "");
  const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const asText = () =>
    [
      `# ${tx("Console da página")} ${props.url}`,
      "",
      ...consoleOf(props.pid, props.id).map((x) => `[${time(x.at)}] ${x.l.toUpperCase()}${x.k && x.k !== "console" ? ` (${x.k})` : ""}: ${x.m}`),
    ].join("\n");
  return (
    <section class="br-logs br-console pop-in">
      <header>
        <Terminal size={13} />
        <strong>{tx("Console")}</strong>
        <span>{txn(errorsOf(props.pid, props.id), "{n} erro", "{n} erros")}</span>
        <span class="dbg-spacer" />
        <button class="ghost-btn small" classList={{ on: only() }} aria-pressed={only()} onClick={() => setOnly(!only())}>{tx("Só erros e avisos")}</button>
        <button class="icon-btn small" title={tx("Anexar o console à conversa")} disabled={!consoleOf(props.pid, props.id).length} onClick={() => void attachText(props.pid, "console.log", asText())}><Paperclip size={13} /></button>
        <button class="icon-btn small" title={tx("Limpar")} disabled={!consoleOf(props.pid, props.id).length} onClick={() => clearConsole(props.pid, props.id)}><Trash2 size={13} /></button>
        <button class="icon-btn small" title={tx("Fechar o console")} onClick={props.onClose}><X size={13} /></button>
      </header>
      <div class="br-con" ref={box} onScroll={() => (stick = box.scrollHeight - box.scrollTop - box.clientHeight < 24)}>
        <For each={list()} fallback={<p class="br-con-empty">{isTauri ? tx("Nada no console desde que a página abriu.") : tx("O console das páginas aparece no app.")}</p>}>
          {(x) => (
            <div
              class={`br-con-row ${x.l}`}
              classList={{ long: long(x), open: opened().has(x.n) }}
              title={long(x) && !opened().has(x.n) ? tx("Clique para ver a mensagem inteira") : undefined}
              onClick={() => long(x) && !getSelection()?.toString() && flip(x.n)}
            >
              <Show when={x.l === "error"} fallback={<span class="br-con-dot" />}><TriangleAlert size={11} /></Show>
              <pre>{x.m}</pre>
              <Show when={kind(x)}><em>{kind(x)}</em></Show>
              <time>{time(x.at)}</time>
            </div>
          )}
        </For>
        <Show when={dropped()}><p class="br-con-empty">{tx("{n} mensagens a mais não aparecem: a página escreve demais.", { n: dropped() })}</p></Show>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ servidores

function Servers(props: { pid: string; onStart: (key: string) => void; onOpen: (port: number) => void; onLogs: (termId: string) => void; onClose: () => void }) {
  const [adding, setAdding] = createSignal(false);
  const [editing, setEditing] = createSignal<string | null>(null);
  onMount(() => {
    if (!envs.detected[props.pid]) void loadServices(props.pid);
    void syncTermList(props.pid).then(() => loadPorts(props.pid));
  });
  const list = () => servicesOf(props.pid);
  const svcPorts = () => new Set(list().flatMap((s) => {
    const t = termOfService(props.pid, s.key);
    return t?.alive ? portsOfTerm(props.pid, t.id) : [];
  }));
  const others = () => procsOf(props.pid).filter((x) => x.ports.length && !x.ports.some((port) => svcPorts().has(port)));
  return (
    <div class="menu pop-in br-pop" ref={(el) => dismissable(el, props.onClose)}>
      <small class="menu-title">{tx("Servidores")}</small>
      <For each={list()} fallback={<p class="br-pop-empty">{tx("Nenhum servidor achado nesta pasta. Adicione o comando que sobe o app (npm run dev, por exemplo).")}</p>}>
        {(s) => {
          const t = () => termOfService(props.pid, s.key);
          const on = () => !!t()?.alive;
          const dead = () => !!t() && !t()!.alive;
          const busy = () => !!envs.busy[s.key];
          const ports = () => (t()?.alive ? portsOfTerm(props.pid, t()!.id) : []);
          return (
            <Show when={editing() !== s.key} fallback={<div class="br-add"><ServiceForm pid={props.pid} init={s} onDone={() => setEditing(null)} /></div>}>
            <div class="br-srv" classList={{ on: on(), dead: dead() }} title={`${s.cmd}${s.dir ? `  ·  ${s.dir}/` : ""}`}>
              <span class="br-srv-dot" />
              <span class="br-srv-name">
                <strong>{s.name}</strong>
                <small>{busy() ? tx("trabalhando…") : on() ? (ports().length ? "" : tx("rodando")) : dead() ? tx("parou") : s.cmd}</small>
              </span>
              <For each={ports()}>{(port) => <button class="br-port" title={tx("Abrir localhost:{p} aqui", { p: port })} onClick={() => props.onOpen(port)}>:{port}</button>}</For>
              <Show when={t()}>
                <button class="icon-btn small" title={tx("Logs")} onClick={() => props.onLogs(t()!.id)}><ScrollText size={13} /></button>
              </Show>
              <Show when={!on() && !busy()}>
                <span class="br-srv-more">
                  <button class="icon-btn small" title={tx("Editar")} onClick={() => (setAdding(false), setEditing(s.key))}><Pencil size={12} /></button>
                  <button class="icon-btn small" title={tx("Tirar da lista")} onClick={() => saveServices(props.pid, servicesOf(props.pid).filter((x) => x.key !== s.key))}><Trash2 size={12} /></button>
                </span>
              </Show>
              <Show
                when={on()}
                fallback={<button class="icon-btn small br-play" disabled={busy()} title={dead() ? tx("Rodar de novo") : tx("Rodar")} onClick={() => (props.onStart(s.key), void startService(props.pid, s))}><Play size={13} /></button>}
              >
                <button class="icon-btn small" disabled={busy()} title={tx("Reiniciar")} onClick={() => void restartService(props.pid, s)}><RotateCw size={12} /></button>
                <button class="icon-btn small br-stop" disabled={busy()} title={tx("Parar")} onClick={() => void stopService(props.pid, s)}><Square size={11} /></button>
              </Show>
            </div>
            </Show>
          );
        }}
      </For>
      <Show when={others().length}>
        <div class="menu-sep" />
        <small class="menu-title">{tx("Rodando por fora")}</small>
        <For each={others()}>
          {(x) => (
            <div class="br-srv on" title={x.cmd}>
              <span class="br-srv-dot" />
              <span class="br-srv-name">
                <strong>{x.cmd.split(" ").slice(0, 3).join(" ")}</strong>
                <small>{x.agent ? tx("iniciado pela IA ({v})", { v: x.agent }) : tx("iniciado no terminal")}</small>
              </span>
              <For each={x.ports}>{(port) => <button class="br-port" title={tx("Abrir localhost:{p} aqui", { p: port })} onClick={() => props.onOpen(port)}>:{port}</button>}</For>
              <button class="icon-btn small br-stop" title={tx("Parar")} onClick={() => void stopProc(props.pid, x)}><Square size={11} /></button>
            </div>
          )}
        </For>
      </Show>
      <div class="menu-sep" />
      <Show
        when={adding()}
        fallback={
          <button class="menu-item" onClick={() => (setEditing(null), setAdding(true))}>
            <Plus size={14} />
            <span>{tx("Adicionar servidor")}</span>
          </button>
        }
      >
        <div class="br-add">
          <ServiceForm pid={props.pid} onDone={() => setAdding(false)} />
        </div>
      </Show>
    </div>
  );
}

// ------------------------------------------------------------------ logs

function Logs(props: { pid: string; id: string; onClose: () => void }) {
  const [text, setText] = createSignal("");
  let pre!: HTMLPreElement;
  let stick = true;
  const term = () => (terms.byProject[props.pid] ?? []).find((t) => t.id === props.id);
  // o terminal some da lista ao parar o serviço: guarda o nome para o cabeçalho e o anexo
  const [name, setName] = createSignal("");
  createEffect(() => term() && setName(term()!.name));
  const stopped = () => !term()?.alive;
  let un: (() => void) | undefined;
  onCleanup(() => un?.());
  createEffect(on(() => props.id, async (id) => {
    un?.();
    setText("");
    if (!isTauri) return;
    try {
      setText(plain(await invoke<string>("term_buffer", { id })));
    } catch {
      /* terminal fechado */
    }
    const off = await listen<{ id: string; data: string }>("term-output", ({ payload }) => payload.id === id && setText((t) => (t + plain(payload.data)).slice(-200_000)));
    if (props.id === id) un = off;
    else off();
  }));
  createEffect(on(text, () => stick && requestAnimationFrame(() => pre && (pre.scrollTop = pre.scrollHeight))));
  const toTerminal = () => {
    setActiveTerm(props.pid, props.id);
    setProjMode("code");
    showTerm();
  };
  return (
    <section class="br-logs pop-in">
      <header>
        <ScrollText size={13} />
        <strong>{tx("Logs")}</strong>
        <span>{name()}</span>
        <Show when={stopped() && isTauri}><em>{tx("parou")}</em></Show>
        <span class="dbg-spacer" />
        <button class="icon-btn small" title={tx("Anexar os logs à conversa")} disabled={!text().trim()} onClick={() => void attachText(props.pid, `logs-${(name() || "servidor").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.log`, text().slice(-60_000))}><Paperclip size={13} /></button>
        <Show when={!stopped()}>
          <button class="icon-btn small" title={tx("Ver no terminal (modo Código)")} onClick={toTerminal}><SquareTerminal size={13} /></button>
        </Show>
        <button class="icon-btn small" title={tx("Fechar os logs")} onClick={props.onClose}><X size={13} /></button>
      </header>
      <pre ref={pre} onScroll={() => (stick = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 24)}>{text() || tx("Nada ainda: o que o servidor escrever aparece aqui.")}</pre>
    </section>
  );
}

// ------------------------------------------------------------------ riscar a página

type Pt = [number, number];
type Shape =
  | { k: "pen"; pts: Pt[]; c: string; w: number }
  | { k: "rect"; x: number; y: number; w2: number; h2: number; c: string; w: number }
  | { k: "text"; x: number; y: number; s: string; c: string; w: number };
type Tool = "select" | "pen" | "rect" | "text";

const COLORS = ["#ff6a3d", "#ff3b30", "#ffcc00", "#34c759", "#0a84ff", "#bf5af2", "#ffffff", "#111111"];
const WIDTHS = [2, 4, 7];
const fontOf = (w: number) => (w <= 2 ? 15 : w <= 4 ? 19 : 25);

// um desenho por vez (é o da aba da frente); some ao sair do modo
const [tool, setTool] = createSignal<Tool>("pen");
const [color, setColor] = createSignal(COLORS[0]);
const [width, setWidth] = createSignal(WIDTHS[1]);
const [shapes, setShapes] = createSignal<Shape[]>([]);
const [past, setPast] = createSignal<Shape[][]>([]);
const [future, setFuture] = createSignal<Shape[][]>([]);
const [sel, setSel] = createSignal<number | null>(null);
const [typing, setTyping] = createSignal<{ x: number; y: number; s: string } | null>(null);
let layer: SVGSVGElement | undefined;

const commit = (next: Shape[]) => batch(() => (setPast([...past(), shapes()]), setFuture([]), setShapes(next)));
const undo = () => {
  const p = past();
  if (!p.length) return;
  batch(() => (setFuture([shapes(), ...future()]), setShapes(p[p.length - 1]), setPast(p.slice(0, -1)), setSel(null)));
};
const redo = () => {
  const f = future();
  if (!f.length) return;
  batch(() => (setPast([...past(), shapes()]), setShapes(f[0]), setFuture(f.slice(1)), setSel(null)));
};
const finishText = () => {
  const t = typing();
  if (!t) return;
  setTyping(null);
  if (t.s.trim()) commit([...shapes(), { k: "text", x: t.x, y: t.y, s: t.s, c: color(), w: width() }]);
};
const resetDraw = () => batch(() => (setShapes([]), setPast([]), setFuture([]), setSel(null), setTyping(null)));

const box = (s: Shape) => {
  if (s.k === "rect") return { x: Math.min(s.x, s.x + s.w2), y: Math.min(s.y, s.y + s.h2), w: Math.abs(s.w2), h: Math.abs(s.h2) };
  if (s.k === "text") return { x: s.x, y: s.y - fontOf(s.w), w: Math.max(12, s.s.length * fontOf(s.w) * 0.58), h: fontOf(s.w) * 1.3 };
  const xs = s.pts.map((p) => p[0]);
  const ys = s.pts.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};
const moved = (s: Shape, dx: number, dy: number): Shape =>
  s.k === "pen" ? { ...s, pts: s.pts.map(([x, y]) => [x + dx, y + dy] as Pt) } : { ...s, x: s.x + dx, y: s.y + dy };

function DrawLayer() {
  onCleanup(resetDraw);
  let draft: Shape | null = null;
  const [live, setLive] = createSignal<Shape | null>(null);
  let drag: { i: number; x: number; y: number; base: Shape[] } | null = null;
  const at = (e: PointerEvent): Pt => {
    const r = layer!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const down = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const [x, y] = at(e);
    if (typing()) return finishText();
    if (tool() === "text") return setTyping({ x, y, s: "" });
    if (tool() === "select") return setSel(null);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    draft = tool() === "pen" ? { k: "pen", pts: [[x, y]], c: color(), w: width() } : { k: "rect", x, y, w2: 0, h2: 0, c: color(), w: width() };
    setLive(draft);
  };
  const move = (e: PointerEvent) => {
    const [x, y] = at(e);
    if (drag) {
      const d = drag;
      setShapes(d.base.map((s, i) => (i === d.i ? moved(s, x - d.x, y - d.y) : s)));
      return;
    }
    if (!draft) return;
    draft = draft.k === "pen" ? { ...draft, pts: [...draft.pts, [x, y]] } : draft.k === "rect" ? { ...draft, w2: x - draft.x, h2: y - draft.y } : draft;
    setLive(draft);
  };
  const up = () => {
    if (drag) {
      const d = drag;
      drag = null;
      batch(() => (setPast([...past(), d.base]), setFuture([])));
      return;
    }
    const d = draft;
    draft = null;
    setLive(null);
    if (!d) return;
    const b = box(d);
    if (d.k === "pen" ? d.pts.length > 1 : b.w > 3 && b.h > 3) commit([...shapes(), d]);
  };
  const grab = (i: number, e: PointerEvent) => {
    if (tool() !== "select") return;
    e.stopPropagation();
    (layer as Element).setPointerCapture(e.pointerId);
    const [x, y] = at(e);
    setSel(i);
    drag = { i, x, y, base: shapes() };
  };
  const draw = (s: Shape, i?: number) => {
    const hit = i !== undefined && tool() === "select";
    if (s.k === "pen") return <polyline points={s.pts.map((p) => p.join(",")).join(" ")} fill="none" stroke={s.c} stroke-width={s.w} stroke-linecap="round" stroke-linejoin="round" pointer-events={hit ? "stroke" : "none"} onPointerDown={(e) => i !== undefined && grab(i, e)} />;
    if (s.k === "rect") {
      const b = box(s);
      return <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={3} fill="none" stroke={s.c} stroke-width={s.w} pointer-events={hit ? "stroke" : "none"} onPointerDown={(e) => i !== undefined && grab(i, e)} />;
    }
    return (
      <text x={s.x} y={s.y} fill={s.c} font-size={`${fontOf(s.w)}`} font-weight="600" font-family="-apple-system, BlinkMacSystemFont, system-ui, sans-serif" paint-order="stroke" stroke={s.c === "#111111" ? "#fff" : "rgba(0,0,0,.35)"} stroke-width={s.c === "#111111" ? 3 : 2} pointer-events={hit ? "all" : "none"} onPointerDown={(e) => i !== undefined && grab(i, e)}>
        {s.s}
      </text>
    );
  };
  onMount(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") (e.preventDefault(), e.shiftKey ? redo() : undo());
      else if ((e.key === "Backspace" || e.key === "Delete") && sel() !== null) (e.preventDefault(), commit(shapes().filter((_, i) => i !== sel())), setSel(null));
      else if (e.key === "Escape") (e.preventDefault(), sel() !== null ? setSel(null) : setDrawing(false));
    };
    window.addEventListener("keydown", key);
    onCleanup(() => window.removeEventListener("keydown", key));
  });
  return (
    <div class="br-draw" classList={{ [`t-${tool()}`]: true }}>
      <svg ref={layer} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <For each={shapes()}>{(s, i) => draw(s, i())}</For>
        <Show when={live()}>{(s) => draw(s())}</Show>
        <Show when={sel() !== null && shapes()[sel()!]}>
          {(s) => {
            const b = () => box(s());
            return <rect class="br-draw-sel" x={b().x - 5} y={b().y - 5} width={b().w + 10} height={b().h + 10} rx={4} />;
          }}
        </Show>
      </svg>
      <Show when={typing()}>
        {(t) => (
          <input
            class="br-draw-text"
            ref={(el) => requestAnimationFrame(() => el.focus())}
            style={{ left: `${t().x}px`, top: `${t().y - fontOf(width())}px`, color: color(), "font-size": `${fontOf(width())}px` }}
            value={t().s}
            placeholder={tx("Escreva…")}
            onInput={(e) => setTyping({ ...t(), s: e.currentTarget.value })}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") finishText();
              else if (e.key === "Escape") setTyping(null);
            }}
            onBlur={finishText}
          />
        )}
      </Show>
    </div>
  );
}

function DrawBar(props: { onSend: (r: DOMRect) => void }) {
  const [pop, setPop] = createSignal<"color" | "width" | null>(null);
  const [sending, setSending] = createSignal(false);
  const tools: { id: Tool; icon: typeof Pencil; label: () => string }[] = [
    { id: "select", icon: MousePointer2, label: () => tx("Selecionar e mover") },
    { id: "pen", icon: Pencil, label: () => tx("Lápis") },
    { id: "rect", icon: Square, label: () => tx("Retângulo") },
    { id: "text", icon: Type, label: () => tx("Texto") },
  ];
  const send = async () => {
    if (!layer) return;
    finishText();
    setSel(null);
    setPop(null);
    setSending(true);
    // um quadro para a seleção e o campo de texto saírem da tela antes da captura
    await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
    props.onSend(layer.getBoundingClientRect());
    setSending(false);
  };
  const trash = () => {
    if (sel() !== null) {
      commit(shapes().filter((_, i) => i !== sel()));
      setSel(null);
    } else if (shapes().length) commit([]);
  };
  return (
    <div class="br-drawbar pop-in" role="toolbar" aria-label={tx("Riscar a página")}>
      <For each={tools}>
        {(t) => (
          <button class="icon-btn small" classList={{ on: tool() === t.id }} aria-pressed={tool() === t.id} title={t.label()} onClick={() => (finishText(), setTool(t.id))}>
            <t.icon size={14} />
          </button>
        )}
      </For>
      <span class="br-drawbar-sep" />
      <div class="br-pop-wrap">
        <button class="icon-btn small" title={tx("Cor")} onClick={() => setPop(pop() === "color" ? null : "color")}><i class="br-swatch" style={{ background: color() }} /></button>
        <Show when={pop() === "color"}>
          <div class="menu pop-in br-mini up" ref={(el) => dismissable(el, () => setPop(null))}>
            <For each={COLORS}>{(c) => <button class="br-swatch big" classList={{ on: c === color() }} style={{ background: c }} title={c} onClick={() => (setColor(c), setPop(null))} />}</For>
          </div>
        </Show>
      </div>
      <div class="br-pop-wrap">
        <button class="icon-btn small" title={tx("Espessura")} onClick={() => setPop(pop() === "width" ? null : "width")}><i class="br-line" style={{ height: `${width()}px` }} /></button>
        <Show when={pop() === "width"}>
          <div class="menu pop-in br-mini up col" ref={(el) => dismissable(el, () => setPop(null))}>
            <For each={WIDTHS}>{(w) => <button class="br-widthopt" classList={{ on: w === width() }} onClick={() => (setWidth(w), setPop(null))}><i class="br-line" style={{ height: `${w}px` }} /></button>}</For>
          </div>
        </Show>
      </div>
      <span class="br-drawbar-sep" />
      <button class="icon-btn small" title={tx("Desfazer (⌘Z)")} disabled={!past().length} onClick={undo}><Undo2 size={14} /></button>
      <button class="icon-btn small" title={tx("Refazer (⇧⌘Z)")} disabled={!future().length} onClick={redo}><Redo2 size={14} /></button>
      <button class="icon-btn small" title={sel() !== null ? tx("Apagar o selecionado") : tx("Apagar tudo")} disabled={!shapes().length} onClick={trash}><Trash2 size={14} /></button>
      <span class="dbg-spacer" />
      <button class="primary-btn small" disabled={sending()} title={tx("Adicionar à conversa")} onClick={() => void send()}>
        <Show when={sending()} fallback={<Paperclip size={12} />}><span class="spinner tiny" /></Show>
        <span class="lbl">{tx("Adicionar à conversa")}</span>
      </button>
      <button class="icon-btn small" title={tx("Sair sem mandar (Esc)")} onClick={() => setDrawing(false)}><X size={14} /></button>
    </div>
  );
}
