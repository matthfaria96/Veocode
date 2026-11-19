import { Activity, AlertTriangle, Box, Brain, Copy, Cpu, FolderOpen, HardDrive, Monitor, Package, Play, Power, RefreshCw, Sparkles, Square, Trash2 } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, onCleanup, onMount, Show, Switch, type JSX } from "solid-js";
import { api, copyText, isTauri, type AgentGroup, type Proc } from "../api";
import { formatBytes } from "../data/mock";
import { showToast } from "../store";
import { agentColor, diskPoints, killProc, loadCaches, loadInstalls, loadMachines, loadModels, refreshProcs, setXray, toggleMachine, trashCaches, xray, type CacheRow } from "../xray";
import { CountUp, PageHeader, Sparkline, Stagger } from "../components/ui";
import ConfirmDialog from "../components/ConfirmDialog";
import Explainer from "../components/Explainer";
import ComputerTabs from "../components/ComputerTabs";
import ClaudeSpace, { claudeSpaceTotal, loadClaudeSpace } from "../components/ClaudeSpace";
import { every } from "../every";

type Tab = "claude" | "caches" | "installed" | "models" | "machines" | "processes";
const [tab, setTab] = createSignal<Tab>("claude");

const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
const when = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};
const uptime = (s: number) => {
  const n = (v: number, one: string, many: string) => `${v} ${v === 1 ? one : many}`;
  return s < 3600 ? n(Math.max(1, Math.round(s / 60)), "minuto", "minutos") : s < 86400 ? n(Math.round(s / 3600), "hora", "horas") : n(Math.round(s / 86400), "dia", "dias");
};

export default function System() {
  const [confirmTrash, setConfirmTrash] = createSignal<CacheRow[] | null>(null);
  const [confirmKill, setConfirmKill] = createSignal<Proc | null>(null);
  const [showAll, setShowAll] = createSignal(false);
  const [filter, setFilter] = createSignal("");

  onMount(() => {
    if (!xray.cachesLoaded) loadCaches();
    if (!xray.installs) loadInstalls();
    if (!xray.machines) loadMachines();
    if (!xray.models) loadModels();
    refreshProcs();
    // processos "respiram": atualiza a cada 2 s enquanto a tela está aberta
    onCleanup(every(refreshProcs, 2000));
  });

  const refreshAll = () => {
    void loadClaudeSpace();
    loadCaches();
    loadInstalls();
    loadMachines();
    loadModels();
    refreshProcs();
  };

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
  const biggest = createMemo(() => [...xray.caches].sort((a, b) => (b.size ?? 0) - (a.size ?? 0))[0]);
  const heroSays = () =>
    !xray.cachesLoaded || measuring()
      ? "Medindo pasta por pasta; cada número aparece assim que fica pronto."
      : !total()
        ? "Nada guardado pelas IAs por enquanto. Tudo limpo."
        : `O que mais ocupa é ${biggest()?.label ?? "—"} (${formatBytes(biggest()?.size ?? 0)}). Marque abaixo o que não quer e mande para a Lixeira.`;

  const tabs: { id: Tab; label: string; icon: (p: { size: number }) => JSX.Element; color: string; count: () => string }[] = [
    { id: "claude", label: "Claude no computador", icon: Sparkles, color: "#fb923c", count: () => (claudeSpaceTotal() !== null ? formatBytes(claudeSpaceTotal()!) : "…") },
    { id: "caches", label: "Outros caches", icon: HardDrive, color: "#8b7bff", count: () => (xray.cachesLoaded ? formatBytes(total()) + (measuring() ? "…" : "") : "…") },
    { id: "installed", label: "Instalado pelas IAs", icon: Package, color: "#38bdf8", count: () => (xray.installs ? String(xray.installs.aiInstalls.length) : "…") },
    { id: "models", label: "IAs locais", icon: Brain, color: "#f472b6", count: () => (xray.models ? (xray.models.models.length ? formatBytes(xray.models.models.reduce((s, m) => s + m.size, 0)) : "nenhuma") : "…") },
    { id: "machines", label: "Máquinas virtuais", icon: Box, color: "#34d399", count: () => (xray.machines ? (xray.machines.machines.length ? `${running()} rodando` : "nenhum") : "…") },
    { id: "processes", label: "IAs abertas agora", icon: Activity, color: "#fbbf24", count: () => (xray.procsLoaded ? String(xray.procs.length) : "…") },
  ];

  const systemFiltered = createMemo(() => {
    const q = filter().toLowerCase();
    return (xray.installs?.system ?? []).filter((p) => !q || p.name.toLowerCase().includes(q) || p.manager.includes(q));
  });

  return (
    <div class="page">
      <ComputerTabs />
      <PageHeader
        title="Espaço e memória"
        subtitle={isTauri ? "O que as IAs deixaram no disco e o que está aberto agora. Marque o que não quer e mande para a Lixeira." : "Modo navegador: dados fictícios. Abra pelo app para ver a máquina de verdade."}
        actions={
          <button class="ghost-btn" onClick={refreshAll}>
            <RefreshCw size={14} classList={{ spinning: measuring() || xray.installsLoading || xray.machinesLoading }} /> Atualizar
          </button>
        }
      />


      <section class="cx-hero">
        <span class="cx-orb a" />
        <span class="cx-orb b" />
        <Donut parts={parts()} total={total()} busy={!xray.cachesLoaded || measuring()} />
        <div class="cx-hero-main">
          <small class="cx-eyebrow"><Sparkles size={12} /> O que as IAs deixaram no disco</small>
          <strong class="cx-big"><CountUp value={total()} format={formatBytes} /></strong>
          <p>{heroSays()}</p>
          <div class="cx-legend">
            <For each={parts()}>
              {(k, i) => (
                <span style={{ "--k": k.color, "--i": i() }}>
                  <i /> {k.label} <b>{formatBytes(k.bytes)}</b>
                </span>
              )}
            </For>
          </div>
        </div>
        <div class="cx-hero-side">
          <div class="cx-live" classList={{ on: busyProcs().length > 0 }}>
            <i />
            <div>
              <strong><CountUp value={xray.procs.length} /> {xray.procs.length === 1 ? "IA aberta" : "IAs abertas"}</strong>
              <small>{busyProcs().length ? `${busyProcs().length} rodando programas · ` : ""}usando {formatBytes(procMem())}</small>
            </div>
          </div>
          <DiskTrend />
        </div>
      </section>

      <div class="xray-tabs">
        <For each={tabs}>
          {(t, i) => (
            <button class="xray-tab" classList={{ active: tab() === t.id }} style={{ "--k": t.color, "--i": i() }} onClick={() => setTab(t.id)}>
              <span class="xray-tab-icon"><t.icon size={16} /></span>
              <span class="xray-tab-text">
                <span>{t.label}</span>
                <strong>{t.count()}</strong>
              </span>
            </button>
          )}
        </For>
      </div>

      <Switch>
        <Match when={tab() === "claude"}>
          <div class="cx-pane">
            <ClaudeSpace />
          </div>
        </Match>
        {/* ------------------------------------------------ caches */}
        <Match when={tab() === "caches"}>
          <div class="cx-pane">
          <div class="cache-summary">
            <span class="cache-sel">{selected().length ? `${selected().length} ${selected().length === 1 ? "marcado" : "marcados"}` : "Marque as caixas para escolher o que liberar"}</span>
            <button class="danger-btn" disabled={selected().length === 0} onClick={() => setConfirmTrash(selected())}>
              <Trash2 size={14} /> Mover selecionados para a Lixeira
              <Show when={selected().length}> ({formatBytes(selected().reduce((s, c) => s + (c.size ?? 0), 0))})</Show>
            </button>
          </div>
          <Show when={xray.cachesLoaded} fallback={<div class="loading-rows"><div /><div /><div /></div>}>
            <div class="list">
              <Stagger each={xray.caches}>
                {(c) => (
                  <div class="cache-row" classList={{ clearing: c.trashing, empty: c.size === 0 }}>
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
                        <CountUp value={c.size!} format={(n) => (n < 1 ? "vazio" : formatBytes(n))} ms={700} />
                      </Show>
                    </span>
                    <button class="icon-btn" title="Mover para a Lixeira" disabled={!c.size} onClick={() => setConfirmTrash([c])}><Trash2 size={14} /></button>
                  </div>
                )}
              </Stagger>
            </div>
          </Show>
          <p class="foot-note">Limpar sempre move para a Lixeira — dá para recuperar enquanto você não esvaziar. Só aparecem pastas que existem nesta máquina.</p>
          </div>
        </Match>

        {/* ------------------------------------------------ instalado */}
        <Match when={tab() === "installed"}>
          <div class="cx-pane">
          <Show when={xray.installs} fallback={<div class="loading-rows"><div /><div /><div /><span>Lendo os históricos do Claude Code e consultando brew, npm, pip, cargo…</span></div>}>
            {(r) => (
              <>
                <p class="foot-note top">
                  Lido de <b>{r().transcriptsRead}</b> históricos do Claude Code. Gerenciadores consultados: {r().managersFound.join(", ") || "nenhum respondeu"}.
                </p>
                <Show when={r().aiInstalls.length > 0} fallback={<div class="empty-state">Nenhum comando de instalação encontrado nos históricos.</div>}>
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
                          <span class={`status-tag ${i.status}`} title={i.status === "ausente" ? "Não está instalado globalmente agora (removido, ou instalado num venv/projeto)" : i.status === "falhou" ? "O comando terminou com erro" : "Continua instalado"}>
                            {i.status}
                          </span>
                          <button
                            class="icon-btn"
                            title={`Copiar: ${i.removeCmd}`}
                            disabled={i.status !== "instalado"}
                            onClick={() => copyText(i.removeCmd).then(() => showToast(`Copiado: ${i.removeCmd}`))}
                          >
                            <Copy size={13} />
                          </button>
                        </div>
                      )}
                    </Stagger>
                  </div>
                </Show>

                <button class="ghost-btn show-all" onClick={() => setShowAll(!showAll())}>
                  {showAll() ? "Esconder" : "Ver"} tudo que está instalado no sistema ({r().system.length})
                </button>
                <Show when={showAll()}>
                  <input class="filter-input" placeholder="Filtrar pacotes…" value={filter()} onInput={(e) => setFilter(e.currentTarget.value)} />
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
          </div>
        </Match>

        {/* ------------------------------------------------ IAs locais */}
        <Match when={tab() === "models"}>
          <div class="cx-pane">
          <Show when={xray.models} fallback={<div class="loading-rows"><div /><div /><span>Procurando modelos do Ollama, LM Studio e Hugging Face…</span></div>}>
            {(r) => (
              <>
                <p class="foot-note top">
                  Modelos baixados ficam numa pasta da ferramenta (não dentro do projeto) e servem para qualquer projeto. Quando a IA baixou um deles, mostramos de qual projeto veio o pedido.
                </p>
                <Show
                  when={r().models.length > 0}
                  fallback={
                    <div class="empty-state">
                      <Brain size={22} /> Nenhuma IA local baixada nesta máquina.
                      <small>{r().tools.length ? `Ferramentas encontradas: ${r().tools.join(", ")}.` : "Ollama, LM Studio e Hugging Face não têm modelos aqui."}</small>
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
                          <span class="proj-chip" classList={{ none: !m.project }} title={m.project ?? "Não achamos nos históricos quem pediu este download"}>
                            {m.project ? base(m.project) : "sem projeto"}
                          </span>
                          <span class="when">{m.when ? when(m.when) : "—"}</span>
                          <span class="size">{formatBytes(m.size)}</span>
                          <button class="icon-btn" title="Mostrar no Finder" onClick={() => api.reveal(m.path)}><FolderOpen size={13} /></button>
                          <button
                            class="icon-btn"
                            title={m.removeCmd ? `Copiar: ${m.removeCmd}` : "Apague pela própria ferramenta (ou mande a pasta para a Lixeira)"}
                            disabled={!m.removeCmd}
                            onClick={() => copyText(m.removeCmd!).then(() => showToast(`Copiado: ${m.removeCmd}`))}
                          >
                            <Copy size={13} />
                          </button>
                        </div>
                      )}
                    </Stagger>
                  </div>
                </Show>
              </>
            )}
          </Show>
          </div>
        </Match>

        {/* ------------------------------------------------ máquinas */}
        <Match when={tab() === "machines"}>
          <div class="cx-pane">
          <Show when={xray.machines} fallback={<div class="loading-rows"><div /><div /></div>}>
            {(r) => (
              <>
                <div class="engine-row">
                  <For each={r().engines}>
                    {(e) => (
                      <span class="engine" classList={{ on: e.installed && !e.notResponding, warn: e.notResponding }}>
                        {e.name}: {!e.installed ? "não instalado" : e.notResponding ? "não respondeu (está aberto?)" : "ok"}
                      </span>
                    )}
                  </For>
                </div>
                <Show when={r().machines.length > 0} fallback={<div class="empty-state"><Box size={22} /> Nenhuma VM ou container nesta máquina.</div>}>
                  <div class="machine-grid">
                    <Stagger each={r().machines} step={70}>
                      {(m) => (
                        <div class="machine" classList={{ on: m.running }}>
                          <div class="machine-top">
                            <span class="machine-icon">{m.kind === "vm" ? <Monitor size={18} /> : <Box size={18} />}</span>
                            <div>
                              <strong>{m.name}</strong>
                              <small>{m.engine} · {m.kind === "vm" ? "máquina virtual" : "container"}{m.detail ? ` · ${m.detail}` : ""}</small>
                              <Show when={m.project}>
                                <span class="proj-chip" title={`Criado pelo projeto em ${m.project}`}>{base(m.project!)}</span>
                              </Show>
                            </div>
                            <span class="status-pill" classList={{ live: m.running }}>{m.running ? "rodando" : "parada"}</span>
                          </div>
                          <div class="machine-stats">
                            <div><Cpu size={12} /> CPU <strong>{m.cpu ?? "—"}</strong></div>
                            <div><HardDrive size={12} /> RAM <strong>{m.ram ?? "—"}</strong></div>
                            <div><HardDrive size={12} /> Disco <strong>{m.disk ?? "—"}</strong></div>
                          </div>
                          <div class="machine-foot">
                            <small>{m.statusText}</small>
                            <Show when={m.ports}><code>{m.ports}</code></Show>
                            <Show when={m.canToggle}>
                              <button class="icon-btn" title={m.running ? "Parar" : "Iniciar"} disabled={xray.busy[`m:${m.engine}:${m.id}`]} onClick={() => toggleMachine(m.engine, m.id, !m.running)}>
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
          </div>
        </Match>

        {/* ------------------------------------------------ processos */}
        <Match when={tab() === "processes"}>
          <div class="cx-pane">
          <Show when={xray.procsLoaded} fallback={<div class="loading-rows"><div /><div /></div>}>
            <Show when={xray.procs.length > 0} fallback={<div class="empty-state">Nenhum agente de IA rodando agora.</div>}>
              <p class="foot-note top">
                {xray.procs.length} {xray.procs.length === 1 ? "IA aberta" : "IAs abertas"} · {busyProcs().length} rodando programas. Atualiza a cada 2 s.
              </p>
              <div class="agent-list">
                <For each={[...busyProcs(), ...xray.procs.filter((g) => g.children.length === 0)]}>
                  {(g) => <AgentCard g={g} onKill={setConfirmKill} />}
                </For>
              </div>
            </Show>
          </Show>
          </div>
        </Match>
      </Switch>

      <div class="cx-explain">
      <Explainer
        id="xray"
        title="O que é esta tela?"
        intro="Mostra o que as IAs estão fazendo no seu computador agora e o que deixaram para trás. As abas:"
        terms={[
          { word: "Espaço ocupado", means: "Arquivos temporários e históricos que crescem com o tempo. Marque e mova para a Lixeira para liberar espaço." },
          { word: "Instalado pelas IAs", means: "Programas que o Claude instalou enquanto trabalhava. Valem para o computador todo, não só para o projeto que pediu." },
          { word: "IAs locais", means: "Modelos de IA baixados para rodar no próprio computador (Ollama, LM Studio, Hugging Face). Ficam soltos na máquina, fora dos projetos, e costumam ocupar vários GB." },
          { word: "Máquinas virtuais", means: "Computadores de mentira (Docker e afins) que podem estar gastando memória." },
          { word: "IAs abertas agora", means: "Cada janela de IA aberta e quanta memória usa. Dá para fechar uma travada daqui." },
        ]}
        calm={<>Nada é apagado sem você confirmar, e tudo vai para a <strong>Lixeira</strong>.</>}
      />
      </div>

      <Show when={confirmTrash()}>
        {(items) => (
          <ConfirmDialog
            title={items().length === 1 ? `Mover “${items()[0].label}” para a Lixeira?` : `Mover ${items().length} itens para a Lixeira?`}
            confirmLabel={`Mover ${formatBytes(items().reduce((s, c) => s + (c.size ?? 0), 0))} para a Lixeira`}
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
            <p class="foot-note">Os arquivos vão para a Lixeira; dá para recuperar enquanto você não esvaziar.</p>
          </ConfirmDialog>
        )}
      </Show>

      <Show when={confirmKill()}>
        {(p) => (
          <ConfirmDialog
            title={`Encerrar o processo ${p().pid}?`}
            confirmLabel="Encerrar"
            danger
            onCancel={() => setConfirmKill(null)}
            onConfirm={() => {
              killProc(p().pid);
              setConfirmKill(null);
            }}
          >
            <code class="confirm-cmd">{p().cmd}</code>
            <p class="foot-note">Ele foi iniciado por um agente de IA. Se o agente ainda precisar dele, pode dar erro na tarefa.</p>
          </ConfirmDialog>
        )}
      </Show>
    </div>
  );
}

function AgentCard(props: { g: AgentGroup; onKill: (p: Proc) => void }) {
  const color = () => agentColor(props.g.agent);
  return (
    <div class="agent-card stagger" classList={{ idle: props.g.children.length === 0 }} style={{ "--c": color() }}>
      <div class="agent-head">
        <span class="account-dot" />
        <strong>{props.g.agent}</strong>
        <Show when={props.g.host}><span class="host-chip" title="Onde esta IA está aberta">{props.g.host}</span></Show>
        <span class="proj-chip" title={props.g.cwd ?? ""}>{props.g.cwd ? base(props.g.cwd) : "—"}</span>
        <small title={`Processo ${props.g.pid}`}>aberta há {uptime(props.g.runSecs)} · usa {formatBytes(props.g.mem)} de memória</small>
        <Sparkline data={xray.cpu[props.g.pid] ?? [0, 0]} color={color()} width={70} height={18} />
        <span class="agent-count">{props.g.children.length ? `rodando ${props.g.children.length} ${props.g.children.length === 1 ? "programa" : "programas"}` : "parada"}</span>
      </div>
      <Show when={props.g.children.length > 0}>
        <div class="proc-list">
          <For each={props.g.children}>
            {(p) => (
              <div class="proc-row" style={{ "padding-left": `${10 + (p.depth - 1) * 16}px` }}>

                <div class="cache-info">
                  <strong class="mono" title={`${p.cmd}\n(processo ${p.pid})`}>{p.cmd}</strong>
                </div>
                <Sparkline data={xray.cpu[p.pid] ?? [0, 0]} color={color()} />
                <span class="size">{p.cpu.toFixed(0)}% · {formatBytes(p.mem)}</span>
                <span class="port" classList={{ none: !p.ports.length }}>{p.ports.length ? p.ports.map((x) => `:${x}`).join(" ") : "—"}</span>
                <button class="icon-btn" title="Encerrar" onClick={() => props.onKill(p)}><Power size={13} /></button>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

const KINDS = [
  { id: "ia", label: "Históricos das IAs", color: "#8b7bff" },
  { id: "pacotes", label: "Pacotes baixados", color: "#38bdf8" },
  { id: "build", label: "Restos de build", color: "#fbbf24" },
] as const;

/** Rosca do espaço: uma fatia por tipo, desenhando-se ao abrir e quando os números mudam. */
function Donut(props: { parts: { id: string; color: string; bytes: number; label: string }[]; total: number; busy: boolean }) {
  const size = 156;
  const stroke = 16;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const [k, setK] = createSignal(0);
  createEffect(on(() => props.total, () => requestAnimationFrame(() => setK(1))));
  const segs = () => {
    let acc = 0;
    const t = Math.max(1, props.total);
    return props.parts.map((p) => {
      const len = (p.bytes / t) * c;
      const seg = { ...p, len: Math.max(0, len - 3), off: acc };
      acc += len;
      return seg;
    });
  };
  return (
    <div class="cx-donut" classList={{ busy: props.busy }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <filter id="cx-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4" /></filter>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} class="cx-donut-track" stroke-width={stroke} fill="none" />
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <For each={segs()}>
            {(sg) => (
              <>
                <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={sg.color} stroke-width={stroke} opacity="0.35" filter="url(#cx-glow)"
                  stroke-dasharray={`${sg.len * k()} ${c}`} stroke-dashoffset={-sg.off * k()} class="cx-seg" />
                <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={sg.color} stroke-width={stroke} stroke-linecap="round"
                  stroke-dasharray={`${sg.len * k()} ${c}`} stroke-dashoffset={-sg.off * k()} class="cx-seg" />
              </>
            )}
          </For>
        </g>
      </svg>
      <div class="cx-donut-label">
        <Show when={!props.busy} fallback={<span class="spinner" />}>
          <HardDrive size={18} />
          <small>{props.parts.length} {props.parts.length === 1 ? "tipo" : "tipos"}</small>
        </Show>
      </div>
    </div>
  );
}

/** Como o espaço das IAs mudou nos últimos dias (um ponto por dia em que você abriu esta tela). */
function DiskTrend() {
  const pts = () => diskPoints().slice(-30);
  const max = () => Math.max(1, ...pts().map((p) => p.bytes));
  const says = () => {
    const p = pts();
    if (p.length < 2) return "O gráfico começa a aparecer a partir do segundo dia em que você abrir esta tela.";
    const first = p[0], last = p[p.length - 1];
    const diff = last.bytes - first.bytes;
    const since = new Date(first.day + "T12:00").toLocaleDateString("pt-BR", { day: "numeric", month: "short" });
    if (Math.abs(diff) < 50 * 1024 ** 2) return `Quase igual desde ${since}.`;
    return diff > 0 ? `Cresceu ${formatBytes(diff)} desde ${since}.` : `Diminuiu ${formatBytes(-diff)} desde ${since}.`;
  };
  return (
    <Show when={isTauri}>
      <div class="disk-trend">
        <small class="cx-eyebrow">Nos últimos dias</small>
        <div class="disk-trend-bars" aria-hidden="true">
          <For each={pts()}>
            {(p, i) => (
              <span
                classList={{ last: i() === pts().length - 1 }}
                style={{ height: `${Math.max(4, (p.bytes / max()) * 100)}%` }}
                title={`${new Date(p.day + "T12:00").toLocaleDateString("pt-BR", { day: "numeric", month: "short" })}: ${formatBytes(p.bytes)}`}
              />
            )}
          </For>
        </div>
        <p>{says()}</p>
      </div>
    </Show>
  );
}
