// Painel: tudo o que as IAs ocupam, rodam e instalaram neste computador, numa tela só.
// À esquerda, a lista no jeito dos Ajustes do macOS (Visão geral, No disco, Rodando agora e
// Extras do Claude); à direita, a parte escolhida. A Visão geral resume tudo em cartões.
import { Activity, AlertTriangle, Box, Brain, ChevronRight, Copy, Cpu, Download, FolderOpen, HardDrive, LayoutGrid, MemoryStick, Monitor, Package, Play, Plug, Power, Puzzle, RefreshCw, Server, Square, Trash2, type LucideProps } from "lucide-solid";
import { createMemo, createSignal, For, Match, onCleanup, onMount, Show, Switch, type JSX } from "solid-js";
import { api, copyText, isTauri, type AgentGroup, type Leftover, type Proc } from "../api";
import { formatBytes } from "../data/mock";
import { showToast } from "../store";
import { agentColor, diskPoints, killLeftover, killProc, loadCaches, loadInstalls, loadMachines, loadModels, refreshPorts, refreshProcs, setXray, toggleMachine, trashCaches, xray, type CacheRow } from "../xray";
import { inv, loadInventory, refreshRunning } from "../inventory";
import { panelSec, setPanelSec, type PanelSec } from "../panel";
import { ClaudeLogo, CountUp, Sparkline, Stagger } from "../components/ui";
import ConfirmDialog from "../components/ConfirmDialog";
import Explainer from "../components/Explainer";
import ClaudeSpace, { claudeSpaceTotal, loadClaudeSpace } from "../components/ClaudeSpace";
import { ExtrasPane, extrasCount, mcpRunning, pluginsDisk } from "./Inventory";
import { every } from "../every";
import { locale, tx, txn } from "../i18n";

const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

/** Disco do Docker ("8.19kB (virtual 95.6MB)"): o que o container escreveu e, à parte, com a imagem. */
function splitDisk(s?: string | null): { main: string; virt?: string } {
  const m = /^(.*?)\s*\((?:virtual\s+)?([^)]+)\)\s*$/.exec(s ?? "");
  return m ? { main: m[1], virt: m[2] } : { main: s || "—" };
}
/** Portas ("127.0.0.1:27019->27017/tcp, [::]:80->80/tcp"): ":27019 → 27017", sem repetir IPv4/IPv6. */
function portList(s?: string | null): { label: string; full: string }[] {
  const out = new Map<string, string>();
  for (const raw of (s ?? "").split(/,\s*/)) {
    const t = raw.trim();
    if (!t) continue;
    const m = /:(\d+(?:-\d+)?)->(\d+(?:-\d+)?)(?:\/(\w+))?$/.exec(t);
    const label = m ? `:${m[1]} → ${m[2]}${m[3] && m[3] !== "tcp" ? `/${m[3]}` : ""}` : t;
    if (!out.has(label)) out.set(label, t);
  }
  return [...out].map(([label, full]) => ({ label, full }));
}
const when = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString(locale(), { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};
const uptime = (s: number) => {
  return s < 3600 ? txn(Math.max(1, Math.round(s / 60)), "{n} minuto", "{n} minutos") : s < 86400 ? txn(Math.round(s / 3600), "{n} hora", "{n} horas") : txn(Math.round(s / 86400), "{n} dia", "{n} dias");
};

type Icon = (p: LucideProps) => JSX.Element;
interface Meta {
  id: PanelSec;
  label: string;
  hint: string;
  icon: Icon;
  /** cor do ícone (quadrado colorido, como nos Ajustes do Mac) */
  k: string;
}

const META: Meta[] = [
  { id: "overview", get label() { return tx("Visão geral"); }, get hint() { return tx("O que as IAs ocupam no disco, o que está aberto agora e os extras do Claude, num olhar."); }, icon: LayoutGrid, k: "#0a84ff" },
  { id: "claude", get label() { return tx("Claude no computador"); }, get hint() { return tx("Quanto o app do Claude, o Claude Code e o Veocode ocupam, com um conserto em cada item."); }, icon: (p: LucideProps) => <ClaudeLogo size={Number(p.size) || 14} />, k: "#d97757" },
  { id: "caches", get label() { return tx("Caches e restos"); }, get hint() { return tx("Históricos, pacotes baixados e restos de build. Marque o que não quer e mande para a Lixeira."); }, icon: HardDrive, k: "#8e8e93" },
  { id: "models", get label() { return tx("IAs locais"); }, get hint() { return tx("Modelos baixados para rodar no próprio computador (Ollama, LM Studio, Hugging Face). Valem para qualquer projeto."); }, icon: Brain, k: "#ff375f" },
  { id: "installed", get label() { return tx("Instalado pelas IAs"); }, get hint() { return tx("Programas que o Claude instalou enquanto trabalhava. Valem para o computador todo, não só para o projeto que pediu."); }, icon: Download, k: "#ff9f0a" },
  { id: "processes", get label() { return tx("IAs abertas"); }, get hint() { return tx("Cada IA aberta agora, onde está, o que ela abriu e quanta memória usa. Atualiza a cada 2 segundos."); }, icon: Activity, k: "#30d158" },
  { id: "ports", get label() { return tx("Servidores e portas"); }, get hint() { return tx("Servidores (como um site em localhost:3000) que ficaram rodando depois que a IA ou o terminal fechou."); }, icon: Plug, k: "#32ade6" },
  { id: "machines", get label() { return tx("Máquinas virtuais"); }, get hint() { return tx("Docker e afins: computadores de mentira que podem estar gastando memória."); }, icon: Box, k: "#5e5ce6" },
  { id: "skills", get label() { return tx("Receitas e atalhos"); }, get hint() { return tx("Instruções extras que o Claude lê (skills, atalhos / e ajudantes). Cada uma ocupa um pouco de toda conversa, mesmo sem uso."); }, icon: Puzzle, k: "#bf5af2" },
  { id: "mcp", get label() { return tx("Conexões (MCP)"); }, get hint() { return tx("Pontes para outros programas e sites (Figma, GitHub…). Cada conversa aberta liga a sua; com o Claude fechado, não rodam."); }, icon: Server, k: "#30b0c7" },
  { id: "plugins", get label() { return tx("Plugins"); }, get hint() { return tx("Conjuntos prontos que trazem várias receitas e conexões de uma vez. Desligar tira tudo o que eles trazem."); }, icon: Package, k: "#ac8e68" },
];
const meta = (id: PanelSec) => META.find((m) => m.id === id)!;
const GROUPS: { title: () => string; ids: PanelSec[] }[] = [
  { title: () => "", ids: ["overview"] },
  { title: () => tx("No disco"), ids: ["claude", "caches", "models", "installed"] },
  { title: () => tx("Rodando agora"), ids: ["processes", "ports", "machines"] },
  { title: () => tx("Extras do Claude"), ids: ["skills", "mcp", "plugins"] },
];

const KINDS = [
  { id: "ia", get label() { return tx("Históricos das IAs"); }, color: "#bf5af2" },
  { id: "pacotes", get label() { return tx("Pacotes baixados"); }, color: "#0a84ff" },
  { id: "build", get label() { return tx("Restos de build"); }, color: "#ff9f0a" },
  { id: "containers", get label() { return tx("Containers"); }, color: "#30d158" },
] as const;

/** Quadrado colorido com o ícone branco, como nos Ajustes do macOS. */
function Sq(props: { m: Meta; size?: number }) {
  const Ic = props.m.icon;
  return (
    <span class="dash-sq" style={{ "--k": props.m.k, "--s": `${props.size ?? 22}px` }}>
      <Ic size={Math.round((props.size ?? 22) * 0.6)} stroke-width={2.1} />
    </span>
  );
}

export default function System() {
  const [confirmTrash, setConfirmTrash] = createSignal<CacheRow[] | null>(null);
  const [confirmKill, setConfirmKill] = createSignal<Proc | null>(null);
  const [confirmLeftover, setConfirmLeftover] = createSignal<Leftover | null>(null);
  const [showAll, setShowAll] = createSignal(false);
  const [filter, setFilter] = createSignal("");
  const sec = panelSec;
  const go = (s: PanelSec) => {
    setPanelSec(s);
    main?.scrollTo({ top: 0 });
  };
  let main: HTMLDivElement | undefined;

  onMount(() => {
    if (!xray.cachesLoaded) loadCaches();
    if (!xray.installs) loadInstalls();
    if (!xray.machines) loadMachines();
    if (!xray.models) loadModels();
    if (!inv.loaded) void loadInventory();
    void loadClaudeSpace();
    refreshProcs();
    refreshPorts();
    // o que está aberto "respira": IAs a cada 2 s; portas e conexões só quando aparecem na tela
    onCleanup(every(() => {
      refreshProcs();
      if (sec() === "ports" || sec() === "overview") refreshPorts();
    }, 2000));
    onCleanup(every(() => (sec() === "mcp" || sec() === "overview") && void refreshRunning(), 3000));
  });

  const refreshAll = () => {
    void loadClaudeSpace();
    loadCaches();
    loadInstalls();
    loadMachines();
    loadModels();
    refreshProcs();
    refreshPorts();
    void loadInventory();
  };
  const refreshing = () => !xray.cachesLoaded || measuring() || xray.installsLoading || xray.machinesLoading || inv.loading;

  const total = createMemo(() => xray.caches.reduce((s, c) => s + (c.size ?? 0), 0));
  const measuring = createMemo(() => xray.caches.some((c) => c.size === null));
  const selected = createMemo(() => xray.caches.filter((c) => c.selected && (c.size ?? 0) > 0));
  const maxSize = createMemo(() => Math.max(1, ...xray.caches.map((c) => c.size ?? 0)));
  const running = createMemo(() => xray.machines?.machines.filter((m) => m.running).length ?? 0);
  const busyProcs = createMemo(() => xray.procs.filter((g) => g.children.length > 0));
  const procMem = createMemo(() => xray.procs.reduce((s, g) => s + g.mem + g.children.reduce((t, c) => t + c.mem, 0), 0));
  const parts = createMemo(() =>
    KINDS.map((k) => ({ ...k, bytes: xray.caches.filter((c) => c.kind === k.id).reduce((s, c) => s + (c.size ?? 0), 0) })).filter((k) => k.bytes > 0),
  );
  const modelsSize = () => xray.models?.models.reduce((s, m) => s + m.size, 0) ?? 0;
  const left = () => xray.ports?.leftovers.length ?? 0;

  /** O número cinza à direita de cada item da lista. */
  const value = (id: PanelSec): string => {
    switch (id) {
      case "claude": return claudeSpaceTotal() !== null ? formatBytes(claudeSpaceTotal()!) : "…";
      case "caches": return xray.cachesLoaded ? formatBytes(total()) : "…";
      case "models": return xray.models ? (xray.models.models.length ? formatBytes(modelsSize()) : "—") : "…";
      case "installed": return xray.installs ? String(xray.installs.aiInstalls.length) : "…";
      case "processes": return xray.procsLoaded ? String(xray.procs.length) : "…";
      case "ports": return !xray.ports ? "…" : left() ? txn(left(), "{n} sobrou", "{n} sobraram") : String(xray.ports.others.length);
      case "machines": return xray.machines ? (xray.machines.machines.length ? tx("{n} rodando", { n: running() }) : "—") : "…";
      case "skills":
      case "mcp":
      case "plugins": return inv.loaded ? String(extrasCount(id)) : "…";
      default: return "";
    }
  };
  /** Bolinha de aviso ao lado do número (servidor sobrando, conexão aberta…). */
  const dot = (id: PanelSec): "warn" | "live" | null =>
    id === "ports" && left() ? "warn" : id === "processes" && busyProcs().length ? "live" : id === "mcp" && mcpRunning().n ? "live" : id === "machines" && running() ? "live" : null;

  const systemFiltered = createMemo(() => {
    const q = filter().toLowerCase();
    return (xray.installs?.system ?? []).filter((p) => !q || p.name.toLowerCase().includes(q) || p.manager.includes(q));
  });

  /** Botões à direita do título de cada parte. */
  const headActions = (id: PanelSec) => (
    <Switch>
      <Match when={id === "caches"}>
        <button class="danger-btn" disabled={selected().length === 0} onClick={() => setConfirmTrash(selected())}>
          <Trash2 size={13} /> {tx("Mover para a Lixeira")}
          <Show when={selected().length}> ({formatBytes(selected().reduce((s, c) => s + (c.size ?? 0), 0))})</Show>
        </button>
      </Match>
    </Switch>
  );

  return (
    <div class="page dash">
      <nav class="dash-nav" aria-label={tx("Partes do Painel")}>
        <div class="dash-brand">
          <div>
            <h1>{tx("Painel")}</h1>
            <small>{isTauri ? tx("Este computador e as IAs") : tx("Dados de exemplo")}</small>
          </div>
          <button class="icon-btn" title={tx("Medir tudo de novo")} onClick={refreshAll}>
            <RefreshCw size={14} classList={{ spinning: refreshing() }} />
          </button>
        </div>
        <For each={GROUPS}>
          {(g) => (
            <div class="dash-group">
              <Show when={g.title()}><small class="dash-group-title">{g.title()}</small></Show>
              <For each={g.ids}>
                {(id) => (
                  <button class="dash-item" classList={{ on: sec() === id }} aria-current={sec() === id ? "page" : undefined} onClick={() => go(id)}>
                    <Sq m={meta(id)} />
                    <span class="dash-item-label">{meta(id).label}</span>
                    <Show when={dot(id)}>{(d) => <i class={`dash-dot ${d()}`} />}</Show>
                    <small class="dash-item-value">{value(id)}</small>
                  </button>
                )}
              </For>
            </div>
          )}
        </For>
      </nav>

      <div class="dash-main" ref={main}>
        <div class="dash-inner">
          <Show when={sec() !== "overview"}>
            <header class="dash-head">
              <Sq m={meta(sec())} size={40} />
              <div class="dash-head-text">
                <h2>{meta(sec()).label}</h2>
                <p>{meta(sec()).hint}</p>
              </div>
              <div class="dash-head-actions">{headActions(sec())}</div>
            </header>
          </Show>

          <Switch>
            {/* ------------------------------------------------ visão geral */}
            <Match when={sec() === "overview"}>
              <Overview go={go} total={total()} parts={parts()} measuring={!xray.cachesLoaded || measuring()} procMem={procMem()} busy={busyProcs().length} running={running()} modelsSize={modelsSize()} />
            </Match>

            <Match when={sec() === "claude"}>
              <ClaudeSpace />
            </Match>

            {/* ------------------------------------------------ caches */}
            <Match when={sec() === "caches"}>
              <Show when={xray.cachesLoaded} fallback={<div class="loading-rows"><div /><div /><div /></div>}>
                <div class="dash-cap-mini">
                  <div class="cap-bar" role="img" aria-label={tx("Divisão do espaço")}>
                    <For each={parts()}>{(k) => <span style={{ "--k": k.color, width: `${Math.max(0.8, (k.bytes / Math.max(1, total())) * 100)}%` }} title={`${k.label}: ${formatBytes(k.bytes)}`} />}</For>
                  </div>
                  <div class="cap-legend">
                    <For each={parts()}>{(k) => <span style={{ "--k": k.color }}><i /> {k.label} <b>{formatBytes(k.bytes)}</b></span>}</For>
                  </div>
                </div>
                <p class="dash-sel-line">{selected().length ? txn(selected().length, "{n} marcado", "{n} marcados") : tx("Marque as caixas para escolher o que liberar.")}</p>
                <div class="list">
                  <Stagger each={xray.caches}>
                    {(c) => (
                      <label class="cache-row" classList={{ clearing: c.trashing, empty: c.size === 0 }}>
                        <input type="checkbox" checked={c.selected} disabled={!c.size} onChange={(e) => setXray("caches", (x) => x.id === c.id, "selected", e.currentTarget.checked)} />
                        <div class="cache-info">
                          <strong>
                            {c.label}
                            <Show when={c.warning}>
                              <span class="warn-icon" title={c.warning!}><AlertTriangle size={12} /></span>
                            </Show>
                          </strong>
                          <code title={c.displayPaths.join("\n")}>{c.displayPaths.join(" · ")}</code>
                        </div>
                        <span class={`tool-chip ${c.kind}`}>{c.tool}</span>
                        <div class="bar"><span class={`bar-fill ${c.kind}`} style={{ width: `${((c.size ?? 0) / maxSize()) * 100}%` }} /></div>
                        <span class="size">
                          <Show when={c.size !== null} fallback={<span class="spinner inline" />}>
                            <CountUp value={c.size!} format={(n) => (n < 1 ? tx("vazio") : formatBytes(n))} ms={700} />
                          </Show>
                        </span>
                        <button class="icon-btn" title={tx("Mover para a Lixeira")} disabled={!c.size} onClick={(e) => (e.preventDefault(), setConfirmTrash([c]))}><Trash2 size={14} /></button>
                      </label>
                    )}
                  </Stagger>
                </div>
              </Show>
              <p class="foot-note">{tx("Limpar sempre move para a Lixeira — dá para recuperar enquanto você não esvaziar. Só aparecem pastas que existem nesta máquina.")}</p>
            </Match>

            {/* ------------------------------------------------ instalado */}
            <Match when={sec() === "installed"}>
              <Show when={xray.installs} fallback={<div class="loading-rows"><div /><div /><div /><span>{tx("Lendo os históricos do Claude Code e consultando brew, npm, pip, cargo…")}</span></div>}>
                {(r) => (
                  <>
                    <p class="foot-note top">
                      {tx("Lido de")} <b>{r().transcriptsRead}</b> {tx("históricos do Claude Code. Gerenciadores consultados: {v}.", { v: r().managersFound.join(", ") || tx("nenhum respondeu") })}
                    </p>
                    <Show when={r().aiInstalls.length > 0} fallback={<div class="empty-state">{tx("Nenhum comando de instalação encontrado nos históricos.")}</div>}>
                      <div class="list">
                        <Stagger each={r().aiInstalls}>
                          {(i) => (
                            <div class="inst-row">
                              <span class={`mgr mgr-${i.manager}`}>{i.manager}</span>
                              <div class="cache-info">
                                <strong>{i.package} <Show when={i.version}><small>{i.version}</small></Show></strong>
                                <code title={i.command}>{i.command}</code>
                              </div>
                              <span class="proj-chip" title={i.project}>{base(i.project)}</span>
                              <span class="when">{when(i.when)}</span>
                              <span class={`status-tag ${i.status}`} title={i.status === "ausente" ? tx("Não está instalado globalmente agora (removido, ou instalado num venv/projeto)") : i.status === "falhou" ? tx("O comando terminou com erro") : tx("Continua instalado")}>
                                {tx(i.status)}
                              </span>
                              <button
                                class="icon-btn"
                                title={tx("Copiar: {removeCmd}", { removeCmd: i.removeCmd })}
                                disabled={i.status !== "instalado"}
                                onClick={() => copyText(i.removeCmd).then(() => showToast(tx("Copiado: {removeCmd}", { removeCmd: i.removeCmd })))}
                              >
                                <Copy size={13} />
                              </button>
                            </div>
                          )}
                        </Stagger>
                      </div>
                    </Show>

                    <button class="ghost-btn show-all" onClick={() => setShowAll(!showAll())}>
                      {tx("{v} tudo que está instalado no sistema ({length})", { v: showAll() ? tx("Esconder") : tx("Ver"), length: r().system.length })}
                    </button>
                    <Show when={showAll()}>
                      <input class="filter-input" placeholder={tx("Filtrar pacotes…")} value={filter()} onInput={(e) => setFilter(e.currentTarget.value)} />
                      <div class="pkg-grid">
                        <For each={systemFiltered()}>
                          {(p) => (
                            <div class="pkg" classList={{ ai: p.byAi }}>
                              <span class={`mgr mgr-${p.manager}`}>{p.manager}</span>
                              <span class="pkg-name">{p.name}</span>
                              <small>{p.version}</small>
                              <Show when={p.byAi}><span class="ai-tag">IA</span></Show>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </>
                )}
              </Show>
            </Match>

            {/* ------------------------------------------------ IAs locais */}
            <Match when={sec() === "models"}>
              <Show when={xray.models} fallback={<div class="loading-rows"><div /><div /><span>{tx("Procurando modelos do Ollama, LM Studio e Hugging Face…")}</span></div>}>
                {(r) => (
                  <Show
                    when={r().models.length > 0}
                    fallback={
                      <div class="empty-state">
                        <Brain size={22} /> {tx("Nenhuma IA local baixada nesta máquina.")}
                        <small>{r().tools.length ? tx("Ferramentas encontradas: {v}.", { v: r().tools.join(", ") }) : tx("Ollama, LM Studio e Hugging Face não têm modelos aqui.")}</small>
                      </div>
                    }
                  >
                    <div class="list">
                      <Stagger each={r().models}>
                        {(m) => (
                          <div class="inst-row">
                            <span class="mgr mgr-model">{m.tool}</span>
                            <div class="cache-info">
                              <strong>{m.name}</strong>
                              <code title={m.path}>{m.path}</code>
                            </div>
                            <span class="proj-chip" classList={{ none: !m.project }} title={m.project ?? tx("Não achamos nos históricos quem pediu este download")}>
                              {m.project ? base(m.project) : tx("sem projeto")}
                            </span>
                            <span class="when">{m.when ? when(m.when) : "—"}</span>
                            <span class="size">{formatBytes(m.size)}</span>
                            <button class="icon-btn" title={tx("Mostrar no Finder")} onClick={() => api.reveal(m.path)}><FolderOpen size={13} /></button>
                            <button
                              class="icon-btn"
                              title={m.removeCmd ? tx("Copiar: {removeCmd}", { removeCmd: m.removeCmd }) : tx("Apague pela própria ferramenta (ou mande a pasta para a Lixeira)")}
                              disabled={!m.removeCmd}
                              onClick={() => copyText(m.removeCmd!).then(() => showToast(tx("Copiado: {removeCmd}", { removeCmd: m.removeCmd })))}
                            >
                              <Copy size={13} />
                            </button>
                          </div>
                        )}
                      </Stagger>
                    </div>
                    <p class="foot-note">{tx("Modelos baixados ficam numa pasta da ferramenta (não dentro do projeto) e servem para qualquer projeto. Quando a IA baixou um deles, mostramos de qual projeto veio o pedido.")}</p>
                  </Show>
                )}
              </Show>
            </Match>

            {/* ------------------------------------------------ máquinas */}
            <Match when={sec() === "machines"}>
              <Show when={xray.machines} fallback={<div class="loading-rows"><div /><div /></div>}>
                {(r) => (
                  <>
                    <div class="engine-row">
                      <For each={r().engines}>
                        {(e) => (
                          <span class="engine" classList={{ on: e.installed && !e.notResponding, warn: e.notResponding }}>
                            {e.name}: {!e.installed ? tx("não instalado") : e.notResponding ? tx("não respondeu (está aberto?)") : "ok"}
                          </span>
                        )}
                      </For>
                    </div>
                    <Show when={r().machines.length > 0} fallback={<div class="empty-state"><Box size={22} /> {tx("Nenhuma VM ou container nesta máquina.")}</div>}>
                      <div class="machine-grid">
                        <Stagger each={r().machines} step={70}>
                          {(m) => (
                            <div class="machine" classList={{ on: m.running }}>
                              <div class="machine-top">
                                <span class="machine-icon">{m.kind === "vm" ? <Monitor size={18} /> : <Box size={18} />}</span>
                                <div>
                                  <strong>{m.name}</strong>
                                  <small>{m.engine} · {m.kind === "vm" ? tx("máquina virtual") : "container"}{m.detail ? ` · ${m.detail}` : ""}</small>
                                  <Show when={m.project}>
                                    <span class="proj-chip" title={tx("Criado pelo projeto em {project}", { project: m.project })}>{base(m.project!)}</span>
                                  </Show>
                                </div>
                                <span class="status-pill" classList={{ live: m.running }}>{m.running ? tx("rodando") : tx("parada")}</span>
                              </div>
                              <div class="machine-stats">
                                <div title={m.cpu ?? undefined}><span><Cpu size={12} /> CPU</span><strong>{m.cpu ?? "—"}</strong></div>
                                <div title={m.ram ?? undefined}><span><MemoryStick size={12} /> RAM</span><strong>{m.ram ?? "—"}</strong></div>
                                <div title={m.disk ?? undefined}>
                                  <span><HardDrive size={12} /> {tx("Disco")}</span>
                                  <strong>{splitDisk(m.disk).main}</strong>
                                  <Show when={splitDisk(m.disk).virt}>{(v) => <small>{tx("{v} no total", { v: v() })}</small>}</Show>
                                </div>
                              </div>
                              <div class="machine-foot">
                                <small class="machine-up">{m.statusText}</small>
                                <Show when={portList(m.ports).length}>
                                  <span class="machine-ports">
                                    <For each={portList(m.ports)}>{(pt) => <code title={pt.full}>{pt.label}</code>}</For>
                                  </span>
                                </Show>
                                <Show when={m.canToggle}>
                                  <button class="icon-btn" title={m.running ? tx("Parar") : tx("Iniciar")} disabled={xray.busy[`m:${m.engine}:${m.id}`]} onClick={() => toggleMachine(m.engine, m.id, !m.running)}>
                                    <Show when={!xray.busy[`m:${m.engine}:${m.id}`]} fallback={<span class="spinner inline" />}>
                                      {m.running ? <Square size={13} /> : <Play size={13} />}
                                    </Show>
                                  </button>
                                </Show>
                              </div>
                            </div>
                          )}
                        </Stagger>
                      </div>
                    </Show>
                  </>
                )}
              </Show>
            </Match>

            {/* ------------------------------------------------ processos */}
            <Match when={sec() === "processes"}>
              <Show when={xray.procsLoaded} fallback={<div class="loading-rows"><div /><div /></div>}>
                <Show when={xray.procs.length > 0} fallback={<div class="empty-state"><Activity size={22} /> {tx("Nenhum agente de IA rodando agora.")}</div>}>
                  <p class="foot-note top">
                    {txn(xray.procs.length, "{n} IA aberta · {busy} rodando programas. Atualiza a cada 2 s.", "{n} IAs abertas · {busy} rodando programas. Atualiza a cada 2 s.", { busy: busyProcs().length })}
                  </p>
                  <div class="agent-list">
                    <For each={[...busyProcs(), ...xray.procs.filter((g) => g.children.length === 0)]}>
                      {(g) => <AgentCard g={g} onKill={setConfirmKill} />}
                    </For>
                  </div>
                </Show>
              </Show>
            </Match>

            {/* ------------------------------------------------ portas */}
            <Match when={sec() === "ports"}>
              <Show when={xray.ports} fallback={<div class="loading-rows"><div /><div /></div>}>
                {(r) => (
                  <>
                    <h4 class="ports-title">{tx("Sobraram de sessões fechadas")}</h4>
                    <Show
                      when={r().leftovers.length > 0}
                      fallback={<div class="empty-state"><Plug size={20} /> {tx("Nenhum servidor sobrando. Tudo que está aberto tem alguém cuidando.")}</div>}
                    >
                      <p class="foot-note top">
                        {tx("Servidores que continuam rodando depois que o agente ou o terminal que os abriu fechou. Eles seguram a porta e gastam memória até alguém fechar.")}
                      </p>
                      <div class="agent-card leftover-card" style={{ "--c": "#32ade6" }}>
                        <div class="proc-list">
                          <For each={r().leftovers}>
                            {(l) => (
                              <div class="proc-row">
                                <div class="cache-info">
                                  <strong class="mono" title={`${l.cmd}\n${tx("(processo {v})", { v: l.pid })}`}>{l.cmd}</strong>
                                  <small title={l.cwd}>{tx("aberto há {v}{v2}", { v: uptime(l.runSecs), v2: l.pids.length > 1 ? tx(" · {n} processos", { n: l.pids.length }) : "" })}</small>
                                </div>
                                <span class="proj-chip" classList={{ none: !l.project }} title={l.cwd}>{l.project ?? base(l.cwd)}</span>
                                <span class="size">{l.cpu.toFixed(0)}% · {formatBytes(l.mem)}</span>
                                <span class="port-links">
                                  <For each={l.ports}>
                                    {(port) => <button class="port-link" title={tx("Abrir http://localhost:{port}", { port })} onClick={() => void api.openUrl(`http://localhost:${port}`).catch(() => {})}>:{port}</button>}
                                  </For>
                                </span>
                                <button class="icon-btn" title={tx("Fechar este servidor")} disabled={xray.busy[`l:${l.pid}`]} onClick={() => setConfirmLeftover(l)}>
                                  <Show when={!xray.busy[`l:${l.pid}`]} fallback={<span class="spinner inline" />}><Power size={13} /></Show>
                                </button>
                              </div>
                            )}
                          </For>
                        </div>
                      </div>
                    </Show>

                    <Show when={r().others.length > 0}>
                      <h4 class="ports-title">{tx("Outras portas abertas")} <small>{tx("só para consulta")}</small></h4>
                      <div class="agent-card idle">
                        <div class="proc-list">
                          <For each={r().others}>
                            {(o) => (
                              <div class="proc-row">
                                <div class="cache-info">
                                  <strong title={`${o.cmd}\n${tx("(processo {v})", { v: o.pid })}`}>{o.name}</strong>
                                </div>
                                <Show when={o.agent}><span class="host-chip" title={tx("Aberto por um agente que ainda está rodando; feche em IAs abertas")}>{o.agent}</span></Show>
                                <span class="port-links">
                                  <For each={o.ports}>{(port) => <code class="port">:{port}</code>}</For>
                                </span>
                              </div>
                            )}
                          </For>
                        </div>
                      </div>
                    </Show>
                  </>
                )}
              </Show>
            </Match>

            {/* ------------------------------------------------ extras do Claude */}
            <Match when={sec() === "skills" || sec() === "mcp" || sec() === "plugins"}>
              <ExtrasPane cat={sec() as "skills" | "mcp" | "plugins"} />
            </Match>
          </Switch>
        </div>
      </div>

      <Show when={confirmTrash()}>
        {(items) => (
          <ConfirmDialog
            title={items().length === 1 ? tx("Mover “{label}” para a Lixeira?", { label: items()[0].label }) : tx("Mover {length} itens para a Lixeira?", { length: items().length })}
            confirmLabel={tx("Mover {v} para a Lixeira", { v: formatBytes(items().reduce((s, c) => s + (c.size ?? 0), 0)) })}
            danger
            onCancel={() => setConfirmTrash(null)}
            onConfirm={() => {
              trashCaches(items().map((c) => c.id));
              setConfirmTrash(null);
            }}
          >
            <For each={items()}>
              {(c) => (
                <div class="confirm-item">
                  <div>
                    <strong>{c.label}</strong> <small>{formatBytes(c.size ?? 0)}</small>
                  </div>
                  <For each={c.displayPaths}>{(p) => <code>{p}</code>}</For>
                  <Show when={c.warning}><p class="confirm-warn"><AlertTriangle size={12} /> {c.warning}</p></Show>
                </div>
              )}
            </For>
            <p class="foot-note">{tx("Os arquivos vão para a Lixeira; dá para recuperar enquanto você não esvaziar.")}</p>
          </ConfirmDialog>
        )}
      </Show>

      <Show when={confirmLeftover()}>
        {(l) => (
          <ConfirmDialog
            title={tx("Fechar o servidor na porta {v}?", { v: l().ports.map((p) => `:${p}`).join(", ") })}
            confirmLabel={tx("Fechar")}
            danger
            onCancel={() => setConfirmLeftover(null)}
            onConfirm={() => {
              killLeftover(l().pid);
              setConfirmLeftover(null);
            }}
          >
            <code class="confirm-cmd">{l().cmd}</code>
            <p class="foot-note">
              {tx("Roda na pasta")} <code>{l().cwd}</code>{tx("{v}. Nenhum arquivo é apagado; se precisar dele de novo, é só rodar o comando outra vez.", { v: l().pids.length > 1 ? txn(l().pids.length - 1, " e fecha junto {n} processo ligado a ele", " e fecha junto {n} processos ligados a ele") : "" })}
            </p>
          </ConfirmDialog>
        )}
      </Show>

      <Show when={confirmKill()}>
        {(p) => (
          <ConfirmDialog
            title={tx("Encerrar o processo {pid}?", { pid: p().pid })}
            confirmLabel={tx("Encerrar")}
            danger
            onCancel={() => setConfirmKill(null)}
            onConfirm={() => {
              killProc(p().pid);
              setConfirmKill(null);
            }}
          >
            <code class="confirm-cmd">{p().cmd}</code>
            <p class="foot-note">{tx("Ele foi iniciado por um agente de IA. Se o agente ainda precisar dele, pode dar erro na tarefa.")}</p>
          </ConfirmDialog>
        )}
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------- visão geral

function Overview(props: {
  go: (s: PanelSec) => void;
  total: number;
  parts: { id: string; label: string; color: string; bytes: number }[];
  measuring: boolean;
  procMem: number;
  busy: number;
  running: number;
  modelsSize: number;
}) {
  const card = (id: PanelSec, body: JSX.Element, foot?: JSX.Element) => (
    <section class="dash-card" style={{ "--k": meta(id).k }}>
      <button class="dash-card-head" onClick={() => props.go(id)}>
        <Sq m={meta(id)} size={26} />
        <strong>{meta(id).label}</strong>
        <ChevronRight size={14} class="dash-card-chev" />
      </button>
      <div class="dash-card-body">{body}</div>
      <Show when={foot}><div class="dash-card-foot">{foot}</div></Show>
    </section>
  );
  const leftovers = () => xray.ports?.leftovers ?? [];
  const machines = () => xray.machines?.machines ?? [];
  const models = () => [...(xray.models?.models ?? [])].sort((a, b) => b.size - a.size);
  const installs = () => xray.installs?.aiInstalls ?? [];
  const mcp = mcpRunning;

  return (
    <div class="dash-overview">
      <header class="dash-hello">
        <h2>{tx("Visão geral")}</h2>
        <p>{tx("O que as IAs ocupam no disco, o que está aberto agora e o que o Claude ganhou de extra. Clique num cartão para ver os detalhes.")}</p>
      </header>

      {/* espaço: a barra no jeito do Armazenamento do macOS */}
      <section class="dash-card dash-storage">
        <div class="dash-storage-main">
          <small class="dash-eyebrow">{tx("No disco")}</small>
          <div class="dash-storage-top">
            <div>
              <strong class="dash-big"><Show when={!props.measuring || props.total} fallback={<span class="spinner" />}><CountUp value={props.total} format={formatBytes} /></Show></strong>
              <span class="dash-big-sub">{props.measuring ? tx("medindo pasta por pasta…") : tx("em históricos, caches e restos deixados pelas IAs")}</span>
            </div>
            <button class="primary-btn" onClick={() => props.go("caches")}><Trash2 size={13} /> {tx("Liberar espaço")}</button>
          </div>
          <div class="cap-bar big" role="img" aria-label={tx("Divisão do espaço")}>
            <For each={props.parts}>{(k) => <span style={{ "--k": k.color, width: `${Math.max(0.8, (k.bytes / Math.max(1, props.total)) * 100)}%` }} title={`${k.label}: ${formatBytes(k.bytes)}`} />}</For>
          </div>
          <div class="cap-legend">
            <For each={props.parts}>{(k) => <span style={{ "--k": k.color }}><i /> {k.label} <b>{formatBytes(k.bytes)}</b></span>}</For>
          </div>
        </div>
        <div class="dash-storage-side">
          <For each={["claude", "models", "installed"] as PanelSec[]}>
            {(id) => (
              <button class="dash-link" onClick={() => props.go(id)}>
                <Sq m={meta(id)} size={24} />
                <span>
                  <strong>{meta(id).label}</strong>
                  <small>
                    {id === "claude"
                      ? claudeSpaceTotal() !== null ? formatBytes(claudeSpaceTotal()!) : "…"
                      : id === "models"
                        ? xray.models ? (models().length ? tx("{v} · {n} modelos", { v: formatBytes(props.modelsSize), n: models().length }) : tx("nenhum modelo")) : "…"
                        : xray.installs ? txn(installs().length, "{n} programa", "{n} programas") : "…"}
                  </small>
                </span>
                <ChevronRight size={14} />
              </button>
            )}
          </For>
          <DiskTrend />
        </div>
      </section>

      <div class="dash-grid">
        {card(
          "processes",
          <>
            <div class="dash-stat">
              <strong><CountUp value={xray.procs.length} /></strong>
              <span>{xray.procs.length === 1 ? tx("IA aberta") : tx("IAs abertas")}<small>{tx("usando {v}", { v: formatBytes(props.procMem) })}{props.busy ? tx(" · {n} rodando programas", { n: props.busy }) : ""}</small></span>
            </div>
            <div class="dash-rows">
              <For each={xray.procs.slice(0, 3)} fallback={<small class="dash-none">{tx("Nenhuma IA aberta agora.")}</small>}>
                {(g) => (
                  <div class="dash-row">
                    <Show when={g.agent.startsWith("Claude")} fallback={<i class="dash-row-dot" style={{ "--c": agentColor(g.agent) }} />}><ClaudeLogo size={12} /></Show>
                    <span class="dash-row-name">{g.agent}</span>
                    <small>{g.cwd ? base(g.cwd) : ""}</small>
                    <b>{formatBytes(g.mem)}</b>
                  </div>
                )}
              </For>
            </div>
          </>,
        )}
        {card(
          "ports",
          <>
            <div class="dash-stat" classList={{ warn: leftovers().length > 0 }}>
              <strong><CountUp value={leftovers().length} /></strong>
              <span>{leftovers().length === 1 ? tx("servidor sobrando") : tx("servidores sobrando")}<small>{xray.ports ? txn(xray.ports.others.length, "{n} outra porta aberta", "{n} outras portas abertas") : "…"}</small></span>
            </div>
            <div class="dash-rows">
              <For each={leftovers().slice(0, 3)} fallback={<small class="dash-none">{tx("Tudo que está aberto tem alguém cuidando.")}</small>}>
                {(l) => (
                  <div class="dash-row">
                    <i class="dash-row-dot warn" />
                    <span class="dash-row-name mono">{l.ports.map((p) => `:${p}`).join(" ")}</span>
                    <small>{l.project ?? base(l.cwd)}</small>
                    <b>{formatBytes(l.mem)}</b>
                  </div>
                )}
              </For>
            </div>
          </>,
        )}
        {card(
          "machines",
          <>
            <div class="dash-stat">
              <strong><CountUp value={props.running} /></strong>
              <span>{tx("rodando")}<small>{xray.machines ? txn(machines().length, "de {n} máquina ou container", "de {n} máquinas e containers") : "…"}</small></span>
            </div>
            <div class="dash-rows">
              <For each={machines().slice(0, 3)} fallback={<small class="dash-none">{tx("Nenhuma VM ou container nesta máquina.")}</small>}>
                {(m) => (
                  <div class="dash-row">
                    <i class="dash-row-dot" classList={{ live: m.running }} />
                    <span class="dash-row-name">{m.name}</span>
                    <small>{m.engine}</small>
                    <b>{m.running ? tx("rodando") : tx("parada")}</b>
                  </div>
                )}
              </For>
            </div>
          </>,
        )}
        <section class="dash-card dash-extras-card" style={{ "--k": meta("skills").k }}>
          <div class="dash-card-head static">
            <span class="dash-card-title">{tx("Extras do Claude")}</span>
          </div>
          <div class="dash-card-body">
            <For each={["skills", "mcp", "plugins"] as PanelSec[]}>
              {(id) => (
                <button class="dash-link" onClick={() => props.go(id)}>
                  <Sq m={meta(id)} size={24} />
                  <span>
                    <strong>{meta(id).label}</strong>
                    <small>
                      {!inv.loaded
                        ? "…"
                        : id === "mcp"
                          ? mcp().n ? tx("{n} instaladas · {open} abertas agora", { n: extrasCount("mcp"), open: mcp().n }) : txn(extrasCount("mcp"), "{n} instalada", "{n} instaladas")
                          : id === "plugins"
                            ? txn(extrasCount("plugins"), "{n} instalado · {v} no disco", "{n} instalados · {v} no disco", { v: formatBytes(pluginsDisk()) })
                            : txn(extrasCount("skills"), "{n} instalada", "{n} instaladas")}
                    </small>
                  </span>
                  <Show when={id === "mcp" && mcp().n}><i class="dash-dot live" /></Show>
                  <ChevronRight size={14} />
                </button>
              )}
            </For>
          </div>
        </section>
        {card(
          "models",
          <>
            <div class="dash-stat">
              <strong>{xray.models ? formatBytes(props.modelsSize) : "…"}</strong>
              <span>{tx("em modelos")}<small>{xray.models ? txn(models().length, "{n} modelo baixado", "{n} modelos baixados") : "…"}</small></span>
            </div>
            <div class="dash-rows">
              <For each={models().slice(0, 3)} fallback={<small class="dash-none">{tx("Nenhuma IA local baixada.")}</small>}>
                {(m) => (
                  <div class="dash-row">
                    <i class="dash-row-dot" style={{ "--c": meta("models").k }} />
                    <span class="dash-row-name">{m.name}</span>
                    <small>{m.tool}</small>
                    <b>{formatBytes(m.size)}</b>
                  </div>
                )}
              </For>
            </div>
          </>,
        )}
        {card(
          "installed",
          <>
            <div class="dash-stat">
              <strong><CountUp value={installs().length} /></strong>
              <span>{installs().length === 1 ? tx("programa instalado") : tx("programas instalados")}<small>{tx("valem para o computador todo")}</small></span>
            </div>
            <div class="dash-rows">
              <For each={installs().slice(0, 3)} fallback={<small class="dash-none">{xray.installs ? tx("Nada instalado pelas IAs.") : tx("Lendo os históricos…")}</small>}>
                {(i) => (
                  <div class="dash-row">
                    <span class={`mgr mgr-${i.manager}`}>{i.manager}</span>
                    <span class="dash-row-name">{i.package}</span>
                    <small>{base(i.project)}</small>
                  </div>
                )}
              </For>
            </div>
          </>,
        )}
      </div>

      <div class="dash-help">
        <Explainer
          id="xray"
          closed
          openLabel={tx("O que é o Painel?")}
          title={tx("O que é o Painel?")}
          intro={tx("Mostra o que as IAs estão fazendo no seu computador agora, o que deixaram para trás e os extras que o Claude ganhou. Na lista da esquerda:")}
          terms={[
            { word: tx("No disco"), means: tx("Arquivos temporários, históricos, modelos e programas que as IAs deixaram. Dá para mandar parte para a Lixeira.") },
            { word: tx("Rodando agora"), means: tx("Cada IA aberta, os servidores que ficaram ligados e as máquinas virtuais. Dá para fechar o que travou.") },
            { word: tx("Extras do Claude"), means: tx("Receitas (skills), atalhos /, conexões com outros programas (MCP) e plugins, com onde cada um vale.") },
          ]}
          calm={<>{tx("Nada é apagado sem você confirmar, e tudo vai para a")} <strong>{tx("Lixeira")}</strong>.</>}
        />
      </div>
    </div>
  );
}

function AgentCard(props: { g: AgentGroup; onKill: (p: Proc) => void }) {
  const color = () => agentColor(props.g.agent);
  return (
    <div class="agent-card stagger" classList={{ idle: props.g.children.length === 0 }} style={{ "--c": color() }}>
      <div class="agent-head">
        <Show when={props.g.agent.startsWith("Claude")} fallback={<span class="account-dot" />}><ClaudeLogo size={15} /></Show>
        <strong>{props.g.agent}</strong>
        <Show when={props.g.host}><span class="host-chip" title={tx("Onde esta IA está aberta")}>{tx(props.g.host!)}</span></Show>
        <span class="proj-chip" title={props.g.cwd ?? ""}>{props.g.cwd ? base(props.g.cwd) : "—"}</span>
        <small title={tx("Processo {pid}", { pid: props.g.pid })}>{tx("aberta há {v} · usa {v2} de memória", { v: uptime(props.g.runSecs), v2: formatBytes(props.g.mem) })}</small>
        <Sparkline data={xray.cpu[props.g.pid] ?? [0, 0]} color={color()} width={70} height={18} />
        <span class="agent-count">{props.g.children.length ? txn(props.g.children.length, "rodando {n} programa", "rodando {n} programas") : tx("parada")}</span>
      </div>
      <Show when={props.g.children.length > 0}>
        <div class="proc-list">
          <For each={props.g.children}>
            {(p) => (
              <div class="proc-row" style={{ "padding-left": `${10 + (p.depth - 1) * 16}px` }}>
                <div class="cache-info">
                  <strong class="mono" title={`${p.cmd}\n${tx("(processo {v})", { v: p.pid })}`}>{p.cmd}</strong>
                </div>
                <Sparkline data={xray.cpu[p.pid] ?? [0, 0]} color={color()} />
                <span class="size">{p.cpu.toFixed(0)}% · {formatBytes(p.mem)}</span>
                <span class="port" classList={{ none: !p.ports.length }}>{p.ports.length ? p.ports.map((x) => `:${x}`).join(" ") : "—"}</span>
                <button class="icon-btn" title={tx("Encerrar")} onClick={() => props.onKill(p)}><Power size={13} /></button>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

/** Como o espaço das IAs mudou nos últimos dias (um ponto por dia em que você abriu esta tela). */
function DiskTrend() {
  const pts = () => diskPoints().slice(-30);
  const max = () => Math.max(1, ...pts().map((p) => p.bytes));
  const says = () => {
    const p = pts();
    if (p.length < 2) return tx("O gráfico começa a aparecer a partir do segundo dia em que você abrir esta tela.");
    const first = p[0], last = p[p.length - 1];
    const diff = last.bytes - first.bytes;
    const since = new Date(first.day + "T12:00").toLocaleDateString(locale(), { day: "numeric", month: "short" });
    if (Math.abs(diff) < 50 * 1024 ** 2) return tx("Quase igual desde {since}.", { since });
    return diff > 0 ? tx("Cresceu {v} desde {since}.", { v: formatBytes(diff), since }) : tx("Diminuiu {v} desde {since}.", { v: formatBytes(-diff), since });
  };
  return (
    <Show when={isTauri}>
      <div class="disk-trend">
        <small class="dash-eyebrow">{tx("Nos últimos dias")}</small>
        <div class="disk-trend-bars" aria-hidden="true">
          <For each={pts()}>
            {(p, i) => (
              <span
                classList={{ last: i() === pts().length - 1 }}
                style={{ height: `${Math.max(4, (p.bytes / max()) * 100)}%` }}
                title={`${new Date(p.day + "T12:00").toLocaleDateString(locale(), { day: "numeric", month: "short" })}: ${formatBytes(p.bytes)}`}
              />
            )}
          </For>
        </div>
        <p>{says()}</p>
      </div>
    </Show>
  );
}
