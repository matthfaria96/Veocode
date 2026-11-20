// Modo IA, à direita: o que a IA está fazendo por baixo da conversa. O app rodando no navegador
// (ou num tamanho de celular), os comandos e servidores do projeto, os subagentes e a atividade.
import { Activity, Bot, ChevronRight, Crosshair, ExternalLink, FileText, Globe, Monitor, RotateCw, Smartphone, Square, SquareTerminal, X } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, onCleanup, Show, Switch } from "solid-js";
import { api, formatSize } from "../api";
import { follow, setFollow } from "../agentFeed";
import { debugTab, setDebugOpen, setDebugTab, type DebugTab } from "../layoutMode";
import { portsOf, procsLoaded, procsOf, stopProc, watchProcs, type ProjProc } from "../projProcs";
import { currentProject, ws, type ActivityEvent } from "../store";
import ActivityIcon, { kindColor } from "./ActivityIcon";
import { ActivityTimeline } from "./BottomPanel";
import Editor from "./Editor";
import { tx, txn } from "../i18n";

const dur = (s: number) => (s < 60 ? `${Math.max(1, Math.round(s))} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`);

// ------------------------------------------------------------------ subagentes

type Sub = { id: string; label: string; color?: string; steps: ActivityEvent[]; running: boolean; first: string; last: string };

/** Subagentes a partir dos passos: cada um com o que fez e se ainda está trabalhando. */
function subsOf(events: ActivityEvent[]): Sub[] {
  const map = new Map<string, Sub>();
  for (const e of events) {
    if (!e.sub) continue;
    let s = map.get(e.sub);
    if (!s) map.set(e.sub, (s = { id: e.sub, label: e.subLabel || tx("subagente"), color: e.color, steps: [], running: false, first: e.time, last: e.time }));
    s.steps.push(e);
    s.last = e.time;
  }
  // quem abriu o subagente ("Subagente: …") fica rodando até ele devolver o resultado
  const spawns = events.filter((e) => e.kind === "swarm");
  for (const s of map.values()) {
    const spawn = spawns.find((x) => x.title.includes(s.label.slice(0, 40)));
    s.running = spawn ? spawn.status === "running" : s.steps.some((x) => x.status === "running");
  }
  return [...map.values()].sort((a, b) => Number(b.running) - Number(a.running));
}

function Subagents() {
  const subs = createMemo(() => subsOf(ws.events));
  // delegações que ainda não deram nenhum passo
  const waiting = createMemo(() => ws.events.filter((e) => e.kind === "swarm" && e.status === "running" && !subs().some((s) => e.title.includes(s.label.slice(0, 40)))));
  const [open, setOpen] = createSignal<Record<string, boolean>>({});
  return (
    <div class="dbg-scroll">
      <Show
        when={subs().length || waiting().length}
        fallback={
          <div class="dbg-empty">
            <Bot size={20} />
            <strong>{tx("Nenhum subagente ainda")}</strong>
            <span>{tx("Quando a IA dividir o trabalho (procurar em várias pastas, revisar, testar), cada ajudante aparece aqui com o que está fazendo.")}</span>
          </div>
        }
      >
        <div class="dbg-sum">
          {txn(subs().length, "{n} subagente", "{n} subagentes")}
          <Show when={subs().filter((s) => s.running).length + waiting().length}>{(n) => <b class="live">· {txn(n(), "{n} trabalhando", "{n} trabalhando")}</b>}</Show>
        </div>
        <For each={waiting()}>
          {(e) => (
            <div class="sub-card running">
              <div class="sub-head">
                <i class="sub-dot" />
                <strong>{e.title.replace(/^Subagente:\s*/, "")}</strong>
                <small>{tx("começando…")}</small>
              </div>
            </div>
          )}
        </For>
        <For each={subs()}>
          {(s) => {
            const now = () => [...s.steps].reverse().find((x) => x.status === "running") ?? s.steps[s.steps.length - 1];
            const isOpen = () => open()[s.id] ?? s.running;
            return (
              <div class="sub-card" classList={{ running: s.running, open: isOpen() }} style={{ "--c": s.color ?? "var(--accent)" }}>
                <button class="sub-head" onClick={() => setOpen({ ...open(), [s.id]: !isOpen() })} aria-expanded={isOpen()}>
                  <i class="sub-dot" />
                  <strong>{s.label}</strong>
                  <small>{s.running ? tx("trabalhando") : tx("terminou")} · {txn(s.steps.length, "{n} passo", "{n} passos")}</small>
                  <ChevronRight size={13} class="sub-chev" />
                </button>
                <Show when={!isOpen() && now()}>
                  {(x) => (
                    <div class="sub-now">
                      <span style={{ color: kindColor[x().kind] }}><ActivityIcon kind={x().kind} size={12} /></span>
                      <span>{x().title}</span>
                      <Show when={x().status === "running"}><span class="spinner inline" /></Show>
                    </div>
                  )}
                </Show>
                <Show when={isOpen()}>
                  <div class="sub-steps">
                    <For each={s.steps.slice(-30)}>
                      {(x) => (
                        <div class="sub-step" classList={{ running: x.status === "running", error: x.status === "error" }} title={x.detail ?? x.title}>
                          <span class="sub-step-icon" style={{ color: kindColor[x.kind] }}><ActivityIcon kind={x.kind} size={12} /></span>
                          <span class="sub-step-title">{x.title}</span>
                          <Show when={x.status === "running"} fallback={<small>{x.status === "error" ? tx("falhou") : x.time.slice(0, 5)}</small>}><span class="spinner inline" /></Show>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            );
          }}
        </For>
      </Show>
    </div>
  );
}

// ------------------------------------------------------------------ comandos

function Commands(props: { onOpenPort: (port: number) => void }) {
  const pid = () => currentProject().id;
  const runs = createMemo(() => ws.events.filter((e) => e.kind === "run").slice(-40));
  const [showOut, setShowOut] = createSignal(false);
  let outEl!: HTMLDivElement;
  createEffect(on(() => [ws.terminal.length, showOut()], () => showOut() && requestAnimationFrame(() => outEl?.scrollTo({ top: outEl.scrollHeight }))));
  return (
    <div class="dbg-scroll">
      <section class="dbg-sec">
        <header>
          <span>{tx("Rodando agora nesta pasta")}</span>
          <Show when={procsOf(pid()).length}><small class="count">{procsOf(pid()).length}</small></Show>
        </header>
        <Show when={procsLoaded(pid())} fallback={<div class="dbg-hint"><span class="spinner inline" /> {tx("Lendo os processos…")}</div>}>
          <Show when={procsOf(pid()).length} fallback={<div class="dbg-hint">{tx("Nada rodando aqui agora. Servidores de dev, builds e testes que a IA (ou você) abrir nesta pasta aparecem aqui.")}</div>}>
            <For each={procsOf(pid())}>{(p) => <ProcRow p={p} onOpenPort={props.onOpenPort} />}</For>
          </Show>
        </Show>
      </section>

      <section class="dbg-sec">
        <header>
          <span>{tx("Comandos da IA")}</span>
          <Show when={runs().length}><small class="count">{runs().length}</small></Show>
          <span class="dbg-sec-right">
            <Show when={ws.terminal.length > 1}>
              <button class="link-btn" onClick={() => setShowOut(!showOut())}>{showOut() ? tx("Esconder a saída") : tx("Ver a saída")}</button>
            </Show>
          </span>
        </header>
        <Show when={runs().length} fallback={<div class="dbg-hint">{tx("Cada comando que a IA rodar aparece aqui, com o resultado.")}</div>}>
          <div class="cmd-list">
            <For each={runs()}>
              {(e) => (
                <div class="cmd-row" classList={{ running: e.status === "running", error: e.status === "error" }} title={e.detail ?? e.title}>
                  <span class="cmd-state">
                    <Show when={e.status === "running"} fallback={<i>{e.status === "error" ? "✗" : "✓"}</i>}><span class="spinner inline" /></Show>
                  </span>
                  <span class="cmd-main">
                    <span class="cmd-title">{e.title}</span>
                    <Show when={e.detail && e.detail !== e.title}><code>{e.detail}</code></Show>
                  </span>
                  <small class="cmd-meta">
                    {e.time.slice(0, 5)}
                    <Show when={e.subLabel}><span> · {e.subLabel}</span></Show>
                  </small>
                </div>
              )}
            </For>
          </div>
        </Show>
        <Show when={showOut()}>
          <div class="terminal dbg-out" ref={outEl}>
            <For each={ws.terminal}>{(l) => <div class={`term-line ${l.tone ?? ""}`}>{l.text}</div>}</For>
          </div>
        </Show>
      </section>
    </div>
  );
}

function ProcRow(props: { p: ProjProc; onOpenPort: (port: number) => void }) {
  const [stopping, setStopping] = createSignal(false);
  return (
    <div class="proc-row" classList={{ server: props.p.ports.length > 0 }}>
      <i class="proc-dot" />
      <span class="proc-main">
        <code title={props.p.cmd}>{props.p.cmd}</code>
        <small>
          <For each={props.p.ports}>{(port) => <button class="port-chip" title={tx("Abrir no navegador do painel")} onClick={() => props.onOpenPort(port)}>:{port}</button>}</For>
          <span>{dur(props.p.runSecs)}</span>
          <span>· {formatSize(props.p.mem)}</span>
          <Show when={props.p.agent}><span>· {tx("aberto por {agent}", { agent: props.p.agent })}</span></Show>
        </small>
      </span>
      <button class="icon-btn small" title={tx("Encerrar")} disabled={stopping()} onClick={async () => (setStopping(true), await stopProc(currentProject().id, props.p), setStopping(false))}>
        <Square size={11} />
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ navegador

// endereço escolhido em cada projeto (some ao fechar o app)
const [urls, setUrls] = createSignal<Record<string, string>>({});
const [device, setDevice] = createSignal<"desktop" | "phone">("desktop");

const demoPage = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font:14px/1.5 -apple-system,system-ui,sans-serif;background:#0d1017;color:#e7eaf3}
header{display:flex;align-items:center;gap:10px;padding:16px 22px;border-bottom:1px solid #222938}
header b{font-size:15px}header span{margin-left:auto;font-size:12px;color:#8d96ab}
main{padding:22px;display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(180px,1fr))}
.c{padding:14px 16px;border:1px solid #222938;border-radius:12px;background:#12161f}
.c small{color:#8d96ab;font-size:12px}.c strong{display:block;font-size:22px;font-weight:600;margin-top:2px}
.bar{height:6px;border-radius:4px;background:#222938;margin-top:10px;overflow:hidden}.bar i{display:block;height:100%;background:#6b9cff}
</style></head><body><header><b>Raio-X</b><span>localhost:5173</span></header><main>
<div class="c"><small>Caches</small><strong>2,4 GB</strong><div class="bar"><i style="width:62%"></i></div></div>
<div class="c"><small>node_modules</small><strong>1,1 GB</strong><div class="bar"><i style="width:38%"></i></div></div>
<div class="c"><small>Modelos</small><strong>8,7 GB</strong><div class="bar"><i style="width:84%"></i></div></div>
</main></body></html>`;

function Browser(props: { focusPort: number | null }) {
  const p = currentProject;
  const pid = () => p().id;
  const ports = () => portsOf(pid());
  const url = () => urls()[pid()] ?? "";
  const setUrl = (u: string) => setUrls({ ...urls(), [pid()]: u });
  const [draft, setDraft] = createSignal("");
  const [n, setN] = createSignal(0); // recarregar
  const [loading, setLoading] = createSignal(false);

  // servidor novo no projeto: abre sozinho se nada estiver aberto (ou se o aberto parou)
  createEffect(on(() => ports().join(","), () => {
    const u = url();
    const port = Number(/:(\d+)/.exec(u)?.[1] ?? 0);
    if (ports().length && (!u || (port && !ports().includes(port)))) setUrl(`http://localhost:${ports()[0]}`);
  }));
  createEffect(on(() => props.focusPort, (port) => port && setUrl(`http://localhost:${port}`), { defer: true }));
  createEffect(on(url, (u) => (setDraft(u.replace(/^https?:\/\//, "")), setLoading(!!u))));

  const go = () => {
    let u = draft().trim();
    if (!u) return;
    if (/^\d+$/.test(u)) u = `localhost:${u}`;
    if (!/^https?:\/\//.test(u)) u = `http://${u}`;
    if (u === url()) setN(n() + 1);
    else setUrl(u);
  };
  const external = () => url() && void api.openUrl(url()).catch(() => {});

  return (
    <div class="dbg-browser">
      <div class="br-bar">
        <button class="icon-btn small" title={tx("Recarregar")} disabled={!url()} onClick={() => (setLoading(true), setN(n() + 1))}><span class="br-reload" classList={{ spin: loading() }}><RotateCw size={12} /></span></button>
        <form class="br-url" onSubmit={(e) => (e.preventDefault(), go())}>
          <Globe size={11} />
          <input value={draft()} placeholder={tx("localhost:3000")} spellcheck={false} onInput={(e) => setDraft(e.currentTarget.value)} onFocus={(e) => e.currentTarget.select()} aria-label={tx("Endereço")} />
        </form>
        <div class="df-seg" role="radiogroup" aria-label={tx("Tamanho da tela")}>
          <button role="radio" aria-checked={device() === "desktop"} classList={{ on: device() === "desktop" }} title={tx("Tela de computador")} onClick={() => setDevice("desktop")}><Monitor size={12} /></button>
          <button role="radio" aria-checked={device() === "phone"} classList={{ on: device() === "phone" }} title={tx("Tela de celular (390 × 844)")} onClick={() => setDevice("phone")}><Smartphone size={12} /></button>
        </div>
        <button class="icon-btn small" title={tx("Abrir no seu navegador")} disabled={!url()} onClick={external}><ExternalLink size={12} /></button>
      </div>
      <Show when={ports().length > 1}>
        <div class="br-ports">
          <For each={procsOf(pid()).filter((x) => x.ports.length)}>
            {(x) => (
              <For each={x.ports}>
                {(port) => (
                  <button class="port-chip" classList={{ on: url().includes(`:${port}`) }} title={x.cmd} onClick={() => setUrl(`http://localhost:${port}`)}>
                    :{port} <span>{x.cmd.split(" ")[0]}</span>
                  </button>
                )}
              </For>
            )}
          </For>
        </div>
      </Show>
      <div class="br-stage" classList={{ phone: device() === "phone" }}>
        <Show
          when={url()}
          fallback={
            <div class="dbg-empty">
              <Globe size={20} />
              <strong>{tx("Nenhum servidor rodando")}</strong>
              <span>{tx("Quando a IA (ou você) subir o app desta pasta, como um npm run dev, ele aparece aqui sozinho. Ou digite um endereço lá em cima.")}</span>
            </div>
          }
        >
          <div class="br-frame">
            <Show
              when={p().demo}
              fallback={<For each={[`${n()} ${url()}`]}>{(k) => <iframe title={tx("App rodando")} src={k.slice(k.indexOf(" ") + 1)} onLoad={() => setLoading(false)} />}</For>}
            >
              <iframe title={tx("App rodando")} srcdoc={demoPage} onLoad={() => setLoading(false)} />
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ o painel

export default function DebugPane() {
  const pid = () => currentProject().id;
  createEffect(on(pid, (id) => onCleanup(watchProcs(id, 3000))));
  const [focusPort, setFocusPort] = createSignal<number | null>(null);
  const openPort = (port: number) => (setFocusPort(null), setFocusPort(port), setDebugTab("browser"));

  const runningSubs = createMemo(() => subsOf(ws.events).filter((s) => s.running).length);
  const runningCmds = () => ws.events.filter((e) => e.kind === "run" && e.status === "running").length;
  // arquivo aberto pela IA ("seguir") ou por você: ganha uma aba aqui
  const hasFile = () => ws.openTabs.length > 0;
  createEffect(on(hasFile, (h) => !h && debugTab() === "file" && setDebugTab("browser")));

  const tabs: { id: DebugTab; label: () => string; icon: typeof Globe }[] = [
    { id: "browser", label: () => tx("Navegador"), icon: Globe },
    { id: "procs", label: () => tx("Comandos"), icon: SquareTerminal },
    { id: "subs", label: () => tx("Subagentes"), icon: Bot },
    { id: "activity", label: () => tx("Atividade"), icon: Activity },
  ];
  const badge = (id: DebugTab) => (id === "procs" ? runningCmds() || procsOf(pid()).filter((p) => p.ports.length).length : id === "subs" ? runningSubs() : 0);

  return (
    <aside class="debug-pane">
      <div class="dbg-tabs" role="tablist">
        {tabs.map((t) => (
          <button role="tab" aria-selected={debugTab() === t.id} classList={{ on: debugTab() === t.id }} onClick={() => setDebugTab(t.id)} title={t.label()}>
            <t.icon size={13} />
            <span>{t.label()}</span>
            <Show when={badge(t.id)}><i class="dbg-badge" classList={{ live: t.id === "subs" || runningCmds() > 0 }}>{badge(t.id)}</i></Show>
          </button>
        ))}
        <Show when={hasFile()}>
          <button role="tab" aria-selected={debugTab() === "file"} classList={{ on: debugTab() === "file" }} onClick={() => setDebugTab("file")} title={tx("Arquivos abertos")}>
            <FileText size={13} />
            <span>{tx("Arquivo")}</span>
          </button>
        </Show>
        <span class="dbg-spacer" />
        <Show when={debugTab() === "activity" && !currentProject().demo}>
          <button class="dbg-follow" classList={{ on: follow() }} onClick={() => setFollow(!follow())} title={tx("Abrir a árvore e o arquivo que o agente está mexendo")}>
            <Crosshair size={12} />
          </button>
        </Show>
        <button class="icon-btn small" title={tx("Esconder o painel")} onClick={() => setDebugOpen(false)}><X size={13} /></button>
      </div>
      <div class="dbg-body">
        <Switch>
          <Match when={debugTab() === "browser"}><Browser focusPort={focusPort()} /></Match>
          <Match when={debugTab() === "procs"}><Commands onOpenPort={openPort} /></Match>
          <Match when={debugTab() === "subs"}><Subagents /></Match>
          <Match when={debugTab() === "activity"}><ActivityTimeline /></Match>
          <Match when={debugTab() === "file" && hasFile()}><Editor /></Match>
        </Switch>
      </div>
    </aside>
  );
}
