import { Activity, AlertTriangle, Box, Brain, Copy, Cpu, FolderOpen, HardDrive, Monitor, Package, Play, Plug, Power, RefreshCw, Sparkles, Square, Trash2 } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, onCleanup, onMount, Show, Switch, type JSX } from "solid-js";
import { api, copyText, isTauri, type AgentGroup, type Leftover, type Proc } from "../api";
import { formatBytes } from "../data/mock";
import { showToast } from "../store";
import { agentColor, diskPoints, killLeftover, killProc, loadCaches, loadInstalls, loadMachines, loadModels, refreshPorts, refreshProcs, setXray, toggleMachine, trashCaches, xray, type CacheRow } from "../xray";
import { CountUp, PageHeader, Sparkline, Stagger } from "../components/ui";
import ConfirmDialog from "../components/ConfirmDialog";
import Explainer from "../components/Explainer";
import ComputerTabs from "../components/ComputerTabs";
import ClaudeSpace, { claudeSpaceTotal, loadClaudeSpace } from "../components/ClaudeSpace";
import { every } from "../every";
import { locale, tx, txn } from "../i18n";

type Tab = "claude" | "caches" | "installed" | "models" | "machines" | "processes" | "ports";
const [tab, setTab] = createSignal<Tab>("claude");

const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
const when = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString(locale(), { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};
const uptime = (s: number) => {
  return s < 3600 ? txn(Math.max(1, Math.round(s / 60)), "{n} minuto", "{n} minutos") : s < 86400 ? txn(Math.round(s / 3600), "{n} hora", "{n} horas") : txn(Math.round(s / 86400), "{n} dia", "{n} dias");
};

export default function System() {
  const [confirmTrash, setConfirmTrash] = createSignal<CacheRow[] | null>(null);
  const [confirmKill, setConfirmKill] = createSignal<Proc | null>(null);
  const [confirmLeftover, setConfirmLeftover] = createSignal<Leftover | null>(null);
  const [showAll, setShowAll] = createSignal(false);
  const [filter, setFilter] = createSignal("");

  onMount(() => {
    if (!xray.cachesLoaded) loadCaches();
    if (!xray.installs) loadInstalls();
    if (!xray.machines) loadMachines();
    if (!xray.models) loadModels();
    refreshProcs();
    refreshPorts();
    // processos "respiram": atualiza a cada 2 s enquanto a tela está aberta (as portas só com a aba delas aberta)
    onCleanup(every(() => {
      refreshProcs();
      if (tab() === "ports") refreshPorts();
    }, 2000));
  });

  const refreshAll = () => {
    void loadClaudeSpace();
    loadCaches();
    loadInstalls();
    loadMachines();
    loadModels();
    refreshProcs();
    refreshPorts();
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
      ? tx("Medindo pasta por pasta; cada número aparece assim que fica pronto.")
      : !total()
        ? tx("Nada guardado pelas IAs por enquanto. Tudo limpo.")
        : tx("O que mais ocupa é {v} ({v2}). Marque abaixo o que não quer e mande para a Lixeira.", { v: biggest()?.label ?? "—", v2: formatBytes(biggest()?.size ?? 0) });

  const tabs: { id: Tab; label: string; icon: (p: { size: number }) => JSX.Element; color: string; count: () => string }[] = [
    { id: "claude", label: tx("Claude no computador"), icon: Sparkles, color: "#fb923c", count: () => (claudeSpaceTotal() !== null ? formatBytes(claudeSpaceTotal()!) : "…") },
    { id: "caches", label: tx("Outros caches"), icon: HardDrive, color: "#8b7bff", count: () => (xray.cachesLoaded ? formatBytes(total()) + (measuring() ? "…" : "") : "…") },
    { id: "installed", label: tx("Instalado pelas IAs"), icon: Package, color: "#38bdf8", count: () => (xray.installs ? String(xray.installs.aiInstalls.length) : "…") },
    { id: "models", label: tx("IAs locais"), icon: Brain, color: "#f472b6", count: () => (xray.models ? (xray.models.models.length ? formatBytes(xray.models.models.reduce((s, m) => s + m.size, 0)) : tx("nenhuma")) : "…") },
    { id: "machines", label: tx("Máquinas virtuais"), icon: Box, color: "#34d399", count: () => (xray.machines ? (xray.machines.machines.length ? tx("{n} rodando", { n: running() }) : tx("nenhuma")) : "…") },
    { id: "processes", label: tx("IAs abertas agora"), icon: Activity, color: "#fbbf24", count: () => (xray.procsLoaded ? String(xray.procs.length) : "…") },
    { id: "ports", label: tx("Portas abertas"), icon: Plug, color: "#60a5fa", count: () => (!xray.ports ? "…" : xray.ports.leftovers.length ? txn(xray.ports.leftovers.length, "{n} sobrou", "{n} sobraram") : String(xray.ports.others.length)) },
  ];

  const systemFiltered = createMemo(() => {
    const q = filter().toLowerCase();
    return (xray.installs?.system ?? []).filter((p) => !q || p.name.toLowerCase().includes(q) || p.manager.includes(q));
  });

  return (
    <div class="page">
      <ComputerTabs />
      <PageHeader
        title={tx("Espaço e memória")}
        subtitle={isTauri ? tx("O que as IAs deixaram no disco e o que está aberto agora. Marque o que não quer e mande para a Lixeira.") : tx("Modo navegador: dados fictícios. Abra pelo app para ver a máquina de verdade.")}
        actions={
          <button class="ghost-btn" onClick={refreshAll}>
            <RefreshCw size={14} classList={{ spinning: measuring() || xray.installsLoading || xray.machinesLoading }} /> {tx("Atualizar")}
          </button>
        }
      />


      <section class="cx-hero">
        <span class="cx-orb a" />
        <span class="cx-orb b" />
        <Donut parts={parts()} total={total()} busy={!xray.cachesLoaded || measuring()} />
        <div class="cx-hero-main">
          <small class="cx-eyebrow"><Sparkles size={12} /> {tx("O que as IAs deixaram no disco")}</small>
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
              <strong><CountUp value={xray.procs.length} /> {xray.procs.length === 1 ? tx("IA aberta") : tx("IAs abertas")}</strong>
              <small>{(busyProcs().length ? tx("{n} rodando programas · ", { n: busyProcs().length }) : "") + tx("usando {v}", { v: formatBytes(procMem()) })}</small>
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
            <span class="cache-sel">{selected().length ? txn(selected().length, "{n} marcado", "{n} marcados") : tx("Marque as caixas para escolher o que liberar")}</span>
            <button class="danger-btn" disabled={selected().length === 0} onClick={() => setConfirmTrash(selected())}>
              <Trash2 size={14} /> {tx("Mover selecionados para a Lixeira")}
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
                    <button class="icon-btn" title={tx("Mover para a Lixeira")} disabled={!c.size} onClick={() => setConfirmTrash([c])}><Trash2 size={14} /></button>
                  </div>
                )}
              </Stagger>
            </div>
          </Show>
          <p class="foot-note">{tx("Limpar sempre move para a Lixeira — dá para recuperar enquanto você não esvaziar. Só aparecem pastas que existem nesta máquina.")}</p>
          </div>
        </Match>

        {/* ------------------------------------------------ instalado */}
        <Match when={tab() === "installed"}>
          <div class="cx-pane">
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
          </div>
        </Match>

        {/* ------------------------------------------------ IAs locais */}
        <Match when={tab() === "models"}>
          <div class="cx-pane">
          <Show when={xray.models} fallback={<div class="loading-rows"><div /><div /><span>{tx("Procurando modelos do Ollama, LM Studio e Hugging Face…")}</span></div>}>
            {(r) => (
              <>
                <p class="foot-note top">
                  {tx("Modelos baixados ficam numa pasta da ferramenta (não dentro do projeto) e servem para qualquer projeto. Quando a IA baixou um deles, mostramos de qual projeto veio o pedido.")}
                </p>
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
                            <div><Cpu size={12} /> CPU <strong>{m.cpu ?? "—"}</strong></div>
                            <div><HardDrive size={12} /> RAM <strong>{m.ram ?? "—"}</strong></div>
                            <div><HardDrive size={12} /> {tx("Disco")} <strong>{m.disk ?? "—"}</strong></div>
                          </div>
                          <div class="machine-foot">
                            <small>{m.statusText}</small>
                            <Show when={m.ports}><code>{m.ports}</code></Show>
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
          </div>
        </Match>

        {/* ------------------------------------------------ processos */}
        <Match when={tab() === "processes"}>
          <div class="cx-pane">
          <Show when={xray.procsLoaded} fallback={<div class="loading-rows"><div /><div /></div>}>
            <Show when={xray.procs.length > 0} fallback={<div class="empty-state">{tx("Nenhum agente de IA rodando agora.")}</div>}>
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
          </div>
        </Match>

        {/* ------------------------------------------------ portas */}
        <Match when={tab() === "ports"}>
          <div class="cx-pane">
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
                  <div class="agent-card leftover-card" style={{ "--c": "#60a5fa" }}>
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
                            <Show when={o.agent}><span class="host-chip" title={tx("Aberto por um agente que ainda está rodando; feche pela aba IAs abertas agora")}>{o.agent}</span></Show>
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
          </div>
        </Match>
      </Switch>

      <div class="cx-explain">
      <Explainer
        id="xray"
        title={tx("O que é esta tela?")}
        intro={tx("Mostra o que as IAs estão fazendo no seu computador agora e o que deixaram para trás. As abas:")}
        terms={[
          { word: tx("Espaço ocupado"), means: tx("Arquivos temporários e históricos que crescem com o tempo. Marque e mova para a Lixeira para liberar espaço.") },
          { word: tx("Instalado pelas IAs"), means: tx("Programas que o Claude instalou enquanto trabalhava. Valem para o computador todo, não só para o projeto que pediu.") },
          { word: tx("IAs locais"), means: tx("Modelos de IA baixados para rodar no próprio computador (Ollama, LM Studio, Hugging Face). Ficam soltos na máquina, fora dos projetos, e costumam ocupar vários GB.") },
          { word: tx("Máquinas virtuais"), means: tx("Computadores de mentira (Docker e afins) que podem estar gastando memória.") },
          { word: tx("IAs abertas agora"), means: tx("Cada janela de IA aberta e quanta memória usa. Dá para fechar uma travada daqui.") },
          { word: tx("Portas abertas"), means: tx("Servidores (como um site em localhost:3000) que ficaram rodando depois que a IA ou o terminal fechou. Dá para abrir no navegador ou fechar.") },
        ]}
        calm={<>{tx("Nada é apagado sem você confirmar, e tudo vai para a")} <strong>{tx("Lixeira")}</strong>.</>}
      />
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

function AgentCard(props: { g: AgentGroup; onKill: (p: Proc) => void }) {
  const color = () => agentColor(props.g.agent);
  return (
    <div class="agent-card stagger" classList={{ idle: props.g.children.length === 0 }} style={{ "--c": color() }}>
      <div class="agent-head">
        <span class="account-dot" />
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

const KINDS = [
  { id: "ia", get label() { return tx("Históricos das IAs"); }, color: "#8b7bff" },
  { id: "pacotes", get label() { return tx("Pacotes baixados"); }, color: "#38bdf8" },
  { id: "build", get label() { return tx("Restos de build"); }, color: "#fbbf24" },
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
          <small>{txn(props.parts.length, "{n} tipo", "{n} tipos")}</small>
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
        <small class="cx-eyebrow">{tx("Nos últimos dias")}</small>
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
