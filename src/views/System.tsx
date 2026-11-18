import { AlertTriangle, Box, Copy, Cpu, HardDrive, Monitor, Play, Power, RefreshCw, Square, Trash2 } from "lucide-solid";
import { createMemo, createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { copyText, isTauri, type AgentGroup, type Proc } from "../api";
import { formatBytes } from "../data/mock";
import { showToast } from "../store";
import { agentColor, killProc, loadCaches, loadInstalls, loadMachines, refreshProcs, setXray, toggleMachine, trashCaches, xray, type CacheRow } from "../xray";
import { CountUp, PageHeader, Sparkline, Stagger } from "../components/ui";
import ConfirmDialog from "../components/ConfirmDialog";

type Tab = "caches" | "installed" | "machines" | "processes";
const [tab, setTab] = createSignal<Tab>("caches");

const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
const when = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};
const uptime = (s: number) => (s < 3600 ? `${Math.max(1, Math.round(s / 60))} min` : s < 86400 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} d`);

export default function System() {
  const [confirmTrash, setConfirmTrash] = createSignal<CacheRow[] | null>(null);
  const [confirmKill, setConfirmKill] = createSignal<Proc | null>(null);
  const [showAll, setShowAll] = createSignal(false);
  const [filter, setFilter] = createSignal("");

  onMount(() => {
    if (!xray.cachesLoaded) loadCaches();
    if (!xray.installs) loadInstalls();
    if (!xray.machines) loadMachines();
    refreshProcs();
    // processos "respiram": atualiza a cada 2 s enquanto a tela está aberta
    const t = setInterval(refreshProcs, 2000);
    onCleanup(() => clearInterval(t));
  });

  const refreshAll = () => {
    loadCaches();
    loadInstalls();
    loadMachines();
    refreshProcs();
  };

  const total = createMemo(() => xray.caches.reduce((s, c) => s + (c.size ?? 0), 0));
  const measuring = createMemo(() => xray.caches.some((c) => c.size === null));
  const selected = createMemo(() => xray.caches.filter((c) => c.selected && (c.size ?? 0) > 0));
  const maxSize = createMemo(() => Math.max(1, ...xray.caches.map((c) => c.size ?? 0)));
  const running = createMemo(() => xray.machines?.machines.filter((m) => m.running).length ?? 0);
  const busyProcs = createMemo(() => xray.procs.filter((g) => g.children.length > 0));

  const tabs: { id: Tab; label: string; count: () => string }[] = [
    { id: "caches", label: "Caches e pastas grandes", count: () => (xray.cachesLoaded ? formatBytes(total()) + (measuring() ? "…" : "") : "…") },
    { id: "installed", label: "Instalado pelas IAs", count: () => (xray.installs ? String(xray.installs.aiInstalls.length) : "…") },
    { id: "machines", label: "VMs e containers", count: () => (xray.machines ? (xray.machines.machines.length ? `${running()} rodando` : "nenhum") : "…") },
    { id: "processes", label: "Agentes rodando", count: () => (xray.procsLoaded ? String(xray.procs.length) : "…") },
  ];

  const systemFiltered = createMemo(() => {
    const q = filter().toLowerCase();
    return (xray.installs?.system ?? []).filter((p) => !q || p.name.toLowerCase().includes(q) || p.manager.includes(q));
  });

  return (
    <div class="page">
      <PageHeader
        title="Raio-X"
        subtitle={isTauri ? "O que as IAs deixaram e estão rodando nesta máquina, lido agora." : "Modo navegador: dados fictícios. Abra pelo app para ver a máquina de verdade."}
        actions={
          <button class="ghost-btn" onClick={refreshAll}>
            <RefreshCw size={14} classList={{ spinning: measuring() || xray.installsLoading || xray.machinesLoading }} /> Atualizar
          </button>
        }
      />

      <div class="xray-tabs">
        <For each={tabs}>
          {(t) => (
            <button class="xray-tab" classList={{ active: tab() === t.id }} onClick={() => setTab(t.id)}>
              <span>{t.label}</span>
              <strong>{t.count()}</strong>
            </button>
          )}
        </For>
      </div>

      <Switch>
        {/* ------------------------------------------------ caches */}
        <Match when={tab() === "caches"}>
          <div class="cache-summary">
            <div class="disk-big">
              <HardDrive size={18} />
              <strong><CountUp value={total()} format={formatBytes} /></strong>
              <span>{measuring() ? "medindo…" : "no total"}</span>
            </div>
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
        </Match>

        {/* ------------------------------------------------ instalado */}
        <Match when={tab() === "installed"}>
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
        </Match>

        {/* ------------------------------------------------ máquinas */}
        <Match when={tab() === "machines"}>
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
        </Match>

        {/* ------------------------------------------------ processos */}
        <Match when={tab() === "processes"}>
          <Show when={xray.procsLoaded} fallback={<div class="loading-rows"><div /><div /></div>}>
            <Show when={xray.procs.length > 0} fallback={<div class="empty-state">Nenhum agente de IA rodando agora.</div>}>
              <p class="foot-note top">
                {xray.procs.length} {xray.procs.length === 1 ? "agente" : "agentes"} · {busyProcs().length} com processos filhos. Atualiza a cada 2 s.
              </p>
              <div class="agent-list">
                <For each={[...busyProcs(), ...xray.procs.filter((g) => g.children.length === 0)]}>
                  {(g) => <AgentCard g={g} onKill={setConfirmKill} />}
                </For>
              </div>
            </Show>
          </Show>
        </Match>
      </Switch>

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
        <span class="proj-chip" title={props.g.cwd ?? ""}>{props.g.cwd ? base(props.g.cwd) : "—"}</span>
        <small>pid {props.g.pid} · há {uptime(props.g.runSecs)} · {formatBytes(props.g.mem)}</small>
        <Sparkline data={xray.cpu[props.g.pid] ?? [0, 0]} color={color()} width={70} height={18} />
        <span class="agent-count">{props.g.children.length ? `${props.g.children.length} processos` : "ocioso"}</span>
      </div>
      <Show when={props.g.children.length > 0}>
        <div class="proc-list">
          <For each={props.g.children}>
            {(p) => (
              <div class="proc-row" style={{ "padding-left": `${10 + (p.depth - 1) * 16}px` }}>
                <code class="pid">{p.pid}</code>
                <div class="cache-info">
                  <strong class="mono" title={p.cmd}>{p.cmd}</strong>
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
