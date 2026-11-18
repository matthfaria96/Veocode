import { Activity, Bot, Box, ChevronDown, ChevronRight, Copy, Cpu, Database, FolderOpen, HardDrive, Info, Loader2, Package, Play, Power, Puzzle, RefreshCw, Search, Server, Square, Trash2, X, Zap, type LucideProps } from "lucide-solid";
import { createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { api, copyText, isTauri, prettyPath, type AgentGroup, type AiInstall, type Machine } from "../api";
import { accountById, fmtTokens } from "../accounts";
import { formatBytes } from "../data/mock";
import { absPathOf, projects, setView, showToast } from "../store";
import { kindLabel, sk, type Item, type PluginInfo } from "../skills";
import { agentColor, loadCaches, loadInstalls, loadMachines, toggleMachine, trashCaches, xray, type CacheRow } from "../xray";
import { inv, loadInventory, pluginAction, refreshRunning, removeMcp, trashItem, type McpRun } from "../inventory";
import { AccountChip, CountUp, PageHeader } from "../components/ui";
import { FolderIcon, ProjectIcon } from "../components/icons";
import ConfirmDialog from "../components/ConfirmDialog";

// ---------------------------------------------------------------- modelo

type Cat = "plugins" | "skills" | "mcp" | "programas" | "rodando" | "maquinas" | "caches";
type Tone = "on" | "off" | "run" | "warn" | "bad";

/** Onde a coisa vale: numa conta inteira, numa pasta, ou no computador todo. */
type Where = { kind: "conta"; accounts: string[] } | { kind: "projeto"; path: string } | { kind: "pc" };

interface Action {
  label: string;
  icon: (p: LucideProps) => JSX.Element;
  danger?: boolean;
  confirm?: { title: string; label: string; body: JSX.Element };
  run: () => void;
}

interface Row {
  key: string;
  cat: Cat;
  name: string;
  tag?: string;
  sub: string;
  accounts: string[];
  where: Where;
  status: { text: string; tone: Tone };
  weight: string | null;
  load?: { cpu: number; mem: number };
  details: [string, string][];
  /** linha extra quando não dá para tirar daqui (diz como tirar) */
  note?: string;
  actions: Action[];
}

const cats: { id: Cat; label: string; icon: (p: LucideProps) => JSX.Element; hint: string }[] = [
  { id: "rodando", label: "Rodando agora", icon: Activity, hint: "Agentes de IA abertos neste momento e o quanto pesam. Fechar o agente fecha o que ele abriu." },
  { id: "plugins", label: "Plugins", icon: Package, hint: "Pacotes do Claude Code que trazem várias skills e servidores MCP de uma vez. Desligar tira tudo o que eles trazem." },
  { id: "skills", label: "Skills, comandos e agentes", icon: Puzzle, hint: "Instruções extras que o Claude lê. O nome e a descrição entram em toda conversa (peso fixo); o resto só quando é usado." },
  { id: "mcp", label: "Servidores MCP", icon: Server, hint: "Programas que dão ferramentas ao Claude. Cada conversa aberta liga a sua cópia; com o Claude fechado, não rodam." },
  { id: "programas", label: "Programas instalados pela IA", icon: Box, hint: "Pacotes que o Claude Code instalou (brew, npm, pip…), lidos dos históricos. Remover é pelo comando, que o Veocode só copia." },
  { id: "maquinas", label: "VMs e containers", icon: HardDrive, hint: "Máquinas virtuais e containers deste computador. Valem para tudo, não para um projeto." },
  { id: "caches", label: "Caches", icon: Database, hint: "Pastas que as IAs e os gerenciadores de pacote enchem com o tempo. Limpar move para a Lixeira." },
];

const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
const pct = (n: number) => `${n < 10 ? n.toFixed(1).replace(".", ",") : Math.round(n)}%`;
const uptime = (s: number) => (s < 3600 ? `${Math.max(1, Math.round(s / 60))} min` : s < 86400 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} d`);
const scopeLabel: Record<string, string> = { user: "conta", local: "conta, só nesta pasta", project: "arquivo do projeto", plugin: "plugin" };

/** Mesma pasta ou dentro dela (barra de Windows ou de macOS). */
const inside = (path: string, root: string) => {
  const p = path.replace(/\\/g, "/").replace(/\/$/, "");
  const r = root.replace(/\\/g, "/").replace(/\/$/, "");
  return p === r || p.startsWith(r + "/");
};

/** Projetos reais do Veocode com o caminho de verdade. */
const realProjects = () => projects.filter((p) => !p.demo).map((p) => ({ ...p, abs: absPathOf(p.id) ?? p.path }));

// ---------------------------------------------------------------- linhas

function pluginRow(p: PluginInfo): Row {
  const items = sk.items.filter((i) => i.layer === "plugin" && i.plugin === p.name && i.accounts.includes(p.account));
  const key = `plugin:${p.id}`;
  return {
    key,
    cat: "plugins",
    name: p.name,
    tag: p.version ? `v${p.version}` : undefined,
    sub: p.description || "Sem descrição",
    accounts: [p.account],
    where: p.project ? { kind: "projeto", path: p.project } : { kind: "conta", accounts: [p.account] },
    status: p.enabled ? { text: "ligado", tone: "on" } : { text: "desligado", tone: "off" },
    weight: `${formatBytes(p.bytes)} · ~${fmtTokens(p.alwaysTokens)} tokens fixos`,
    details: [
      ["Id", p.pluginId],
      ["Instalado na", scopeLabel[p.scope] ?? p.scope],
      ["Traz", `${p.skills} skills · ${p.mcp} MCP`],
      ...(items.length ? ([["Itens", items.map((i) => i.name).slice(0, 14).join(", ") + (items.length > 14 ? `… (+${items.length - 14})` : "")]] as [string, string][]) : []),
      ["Pasta", prettyPath(p.path)],
    ],
    actions: [
      p.enabled
        ? { label: "Desligar", icon: Power, run: () => pluginAction(p, "disable") }
        : { label: "Ligar", icon: Play, run: () => pluginAction(p, "enable") },
      {
        label: "Remover",
        icon: Trash2,
        danger: true,
        confirm: {
          title: `Remover o plugin ${p.name}?`,
          label: "Remover",
          body: (
            <>
              <p>O Claude Code desinstala o plugin desta conta ({accountById(p.account).label}) e tudo o que ele traz: {p.skills} skills e {p.mcp} MCP.</p>
              <p class="muted">Dá para instalar de novo depois pelo <code>/plugin</code> do Claude. Se só quer parar de usar, "Desligar" é reversível na hora.</p>
            </>
          ),
        },
        run: () => pluginAction(p, "uninstall"),
      },
    ],
  };
}

function itemRow(i: Item): Row {
  const inRepo = i.layer === "projeto";
  const actions: Action[] = [];
  let note: string | undefined;
  if (i.manage === "trash" && i.path) {
    actions.push({
      label: "Remover",
      icon: Trash2,
      danger: true,
      confirm: {
        title: `Mover ${i.name} para a Lixeira?`,
        label: "Mover para a Lixeira",
        body: (
          <>
            <p>{kindLabel[i.kind]} em <code>{prettyPath(i.path)}</code> vai para a Lixeira{i.path.endsWith("SKILL.md") ? " (a pasta inteira da skill)" : ""}.</p>
            <Show when={inRepo}>
              <p class="warn-text">Fica dentro da pasta do projeto: se ela usa git, vai aparecer como arquivo apagado.</p>
            </Show>
            <p class="muted">Para voltar, é só tirar da Lixeira.</p>
          </>
        ),
      },
      run: () => trashItem(i),
    });
  } else if (i.manage === "synced") {
    note = "Veio do claude.ai (sincronizado com a conta): tire por lá, em Ajustes → Capacidades.";
  }
  return {
    key: `item:${i.id}`,
    cat: "skills",
    name: i.name,
    tag: kindLabel[i.kind],
    sub: i.description || "Sem descrição",
    accounts: i.accounts,
    where: inRepo && i.project ? { kind: "projeto", path: i.project } : { kind: "conta", accounts: i.accounts },
    status: i.enabled ? { text: "ativa", tone: "on" } : { text: "desligada", tone: "off" },
    weight: `~${fmtTokens(i.alwaysTokens)} fixos · ~${fmtTokens(i.invokeTokens)} ao usar`,
    details: [
      ["Arquivo", i.path ? prettyPath(i.path) : "—"],
      ...(i.origin ? ([["Origem", i.origin]] as [string, string][]) : []),
    ],
    note,
    actions,
  };
}

function mcpRow(i: Item, runs: McpRun[]): Row {
  const m = i.mcp!;
  const remote = m.transport !== "stdio";
  const cpu = runs.reduce((s, r) => s + r.cpu, 0);
  const mem = runs.reduce((s, r) => s + r.mem, 0);
  const status: Row["status"] = runs.length
    ? { text: runs.length > 1 ? `rodando ×${runs.length}` : "rodando", tone: "run" }
    : m.found === false
      ? { text: "falta programa", tone: "bad" }
      : !i.enabled
        ? { text: "desligado", tone: "off" }
        : remote
          ? { text: "remoto", tone: "on" }
          : { text: "parado", tone: "off" };
  const actions: Action[] = [];
  let note: string | undefined;
  if (m.scope === "plugin" || i.layer === "plugin") {
    note = `Vem do plugin ${i.plugin ?? ""}: desligue o plugin para tirar.`;
  } else if (i.manage === "cli") {
    actions.push({
      label: "Remover",
      icon: Trash2,
      danger: true,
      confirm: {
        title: `Remover o servidor ${i.name}?`,
        label: "Remover",
        body: (
          <>
            <p>O Veocode pede ao próprio Claude Code (<code>claude mcp remove</code>) para tirar este servidor{i.accounts.length > 1 ? ` das contas ${i.accounts.map((a) => accountById(a).label).join(", ")}` : ` da conta ${accountById(i.accounts[0]).label}`}.</p>
            <Show when={m.scope === "project"}>
              <p class="warn-text">Ele está no <code>.mcp.json</code> do projeto: o arquivo do projeto muda (e o git vai mostrar).</p>
            </Show>
            <p class="muted">As chaves e variáveis dele somem junto. Conversas já abertas seguem com ele até recomeçar.</p>
          </>
        ),
      },
      run: () => removeMcp(i),
    });
  }
  return {
    key: `item:${i.id}`,
    cat: "mcp",
    name: i.name,
    tag: m.transport,
    sub: i.description || (m.command ? [m.command, ...m.args].join(" ") : m.url ?? ""),
    accounts: i.accounts,
    where: i.project ? { kind: "projeto", path: i.project } : { kind: "conta", accounts: i.accounts },
    status,
    weight: runs.length ? `${pct(cpu)} CPU · ${formatBytes(mem)}` : remote ? "roda fora deste computador" : "só roda com o Claude aberto",
    load: runs.length ? { cpu, mem } : undefined,
    details: [
      ["Guardado como", scopeLabel[m.scope] ?? m.scope],
      [remote ? "Endereço" : "Comando", remote ? m.url ?? "—" : [m.command, ...m.args].filter(Boolean).join(" ")],
      ["Definido em", prettyPath(m.definedIn)],
      ...(m.envNames.length || m.headerNames.length ? ([["Segredos", [...m.envNames, ...m.headerNames].join(", ") + " (só os nomes)"]] as [string, string][]) : []),
      ...runs.map((r, n): [string, string] => [`Cópia ${n + 1}`, `pid ${r.pid} · ${r.agent} em ${r.cwd ? base(r.cwd) : "?"} · ${pct(r.cpu)} · ${formatBytes(r.mem)}`]),
    ],
    note,
    actions,
  };
}

function installRow(a: AiInstall, n: number): Row {
  return {
    key: `inst:${n}:${a.manager}:${a.package}`,
    cat: "programas",
    name: a.package,
    tag: a.manager,
    sub: a.command,
    accounts: [],
    where: { kind: "projeto", path: a.project },
    status: a.status === "instalado" ? { text: "instalado", tone: "on" } : a.status === "falhou" ? { text: "falhou", tone: "bad" } : { text: "não está mais", tone: "off" },
    weight: a.version ? `v${a.version}` : null,
    details: [
      ["Quando", new Date(a.when).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })],
      ["Quem", a.source],
      ["Tentativas", String(a.attempts)],
      ["Para remover", a.removeCmd],
    ],
    actions: a.status === "instalado" ? [{ label: "Copiar remoção", icon: Copy, run: () => copyText(a.removeCmd).then(() => showToast("Comando copiado: cole no Terminal se quiser rodar")) }] : [],
  };
}

function agentRow(g: AgentGroup): Row {
  const all = [g, ...g.children];
  const cpu = all.reduce((s, p) => s + p.cpu, 0);
  const mem = all.reduce((s, p) => s + p.mem, 0);
  const ports = [...new Set(all.flatMap((p) => p.ports))];
  return {
    key: `agent:${g.pid}`,
    cat: "rodando",
    name: g.agent,
    sub: g.cwd ? prettyPath(g.cwd) : "pasta desconhecida",
    accounts: [],
    where: g.cwd ? { kind: "projeto", path: g.cwd } : { kind: "pc" },
    status: { text: "rodando", tone: "run" },
    weight: `${pct(cpu)} CPU · ${formatBytes(mem)}`,
    load: { cpu, mem },
    details: [
      ["Aberto há", uptime(g.runSecs)],
      ["Processos", g.children.length ? g.children.map((c) => c.name).slice(0, 10).join(", ") + (g.children.length > 10 ? "…" : "") : "só ele"],
      ...(ports.length ? ([["Portas", ports.join(", ")]] as [string, string][]) : []),
      ["pid", String(g.pid)],
    ],
    actions: [{ label: "Ver no Raio-X", icon: Activity, run: () => setView("system") }],
  };
}

function machineRow(m: Machine): Row {
  const key = `m:${m.engine}:${m.id}`;
  return {
    key,
    cat: "maquinas",
    name: m.name,
    tag: m.engine,
    sub: m.detail ?? (m.kind === "vm" ? "Máquina virtual" : "Container"),
    accounts: [],
    where: { kind: "pc" },
    status: m.running ? { text: "rodando", tone: "run" } : { text: m.statusText || "parada", tone: "off" },
    weight: [m.cpu && `${m.cpu} CPU`, m.ram, m.disk].filter(Boolean).join(" · ") || null,
    details: [["Estado", m.statusText], ...(m.ports ? ([["Portas", m.ports]] as [string, string][]) : [])],
    actions: m.canToggle
      ? [m.running ? { label: "Parar", icon: Square, run: () => toggleMachine(m.engine, m.id, false) } : { label: "Iniciar", icon: Play, run: () => toggleMachine(m.engine, m.id, true) }]
      : [],
  };
}

function cacheRow(c: CacheRow): Row {
  return {
    key: `cache:${c.id}`,
    cat: "caches",
    name: c.label,
    tag: c.tool,
    sub: c.displayPaths.join(" · "),
    accounts: [],
    where: { kind: "pc" },
    status: c.size === null ? { text: "medindo", tone: "off" } : { text: c.size > 0 ? "ocupando" : "vazio", tone: c.size > 500 * 1024 ** 2 ? "warn" : "off" },
    weight: c.size === null ? "…" : formatBytes(c.size),
    details: c.warning ? [["Atenção", c.warning]] : [],
    actions:
      (c.size ?? 0) > 0
        ? [
            {
              label: "Limpar",
              icon: Trash2,
              danger: true,
              confirm: {
                title: `Limpar ${c.label}?`,
                label: "Mover para a Lixeira",
                body: (
                  <>
                    <p>{formatBytes(c.size ?? 0)} em <code>{c.displayPaths.join(", ")}</code> vão para a Lixeira.</p>
                    <Show when={c.warning}><p class="warn-text">{c.warning}</p></Show>
                    <p class="muted">O programa baixa de novo o que precisar.</p>
                  </>
                ),
              },
              run: () => trashCaches([c.id]),
            },
          ]
        : [],
  };
}

// ---------------------------------------------------------------- tela

export default function Inventory() {
  const [cat, setCat] = createSignal<Cat | "tudo">("tudo");
  const [proj, setProj] = createSignal("todos");
  const [q, setQ] = createSignal("");
  const [open, setOpen] = createSignal<Record<string, boolean>>({});
  const [confirm, setConfirm] = createSignal<Action | null>(null);

  onMount(() => {
    loadInventory();
    if (!xray.installs) loadInstalls();
    if (!xray.machines) loadMachines();
    if (!xray.cachesLoaded) loadCaches();
    const t = setInterval(refreshRunning, 3000);
    onCleanup(() => clearInterval(t));
  });
  const refreshAll = () => {
    loadInventory();
    loadInstalls();
    loadMachines();
    loadCaches();
  };

  const rows = createMemo<Row[]>(() => [
    ...inv.agents.map(agentRow),
    ...sk.plugins.map(pluginRow),
    ...sk.items.filter((i) => i.kind !== "mcp" && i.layer !== "plugin").map(itemRow),
    ...sk.items.filter((i) => i.kind === "mcp").map((i) => mcpRow(i, inv.mcp[i.id] ?? [])),
    ...(xray.installs?.aiInstalls ?? []).map(installRow),
    ...(xray.machines?.machines ?? []).map(machineRow),
    ...xray.caches.filter((c) => c.size === null || c.size > 0).map(cacheRow),
  ]);

  const selected = createMemo(() => realProjects().find((p) => p.id === proj()) ?? null);
  const inProject = (r: Row) => {
    const p = selected();
    if (!p) return true;
    if (r.where.kind === "pc") return false;
    if (r.where.kind === "conta") return r.where.accounts.includes(p.accountId);
    return inside(r.where.path, p.abs);
  };
  const matches = (r: Row) => {
    const s = q().trim().toLowerCase();
    return !s || r.name.toLowerCase().includes(s) || r.sub.toLowerCase().includes(s) || (r.tag ?? "").toLowerCase().includes(s);
  };
  const scoped = createMemo(() => rows().filter((r) => inProject(r) && matches(r)));
  const shown = (c: Cat) => scoped().filter((r) => r.cat === c);
  // as linhas são refeitas a cada leitura (3 s); a lista anda pela chave para não recriar nem repetir a animação
  const byKey = createMemo(() => new Map(rows().map((r) => [r.key, r])));
  const keys = (c: Cat) => shown(c).map((r) => r.key);
  const visibleCats = () => cats.filter((c) => (cat() === "tudo" || cat() === c.id) && !(selected() && (c.id === "maquinas" || c.id === "caches")));

  // ---- resumo
  const running = createMemo(() => scoped().filter((r) => r.load));
  const runCpu = () => running().reduce((s, r) => s + r.load!.cpu, 0);
  const runMem = () => running().reduce((s, r) => s + r.load!.mem, 0);
  const runningVms = () => (selected() ? 0 : (xray.machines?.machines.filter((m) => m.running).length ?? 0));
  const disk = createMemo(() => {
    const plugins = sk.plugins.filter((p) => inProject(pluginRow(p))).reduce((s, p) => s + p.bytes, 0);
    return plugins + (selected() ? 0 : xray.caches.reduce((s, c) => s + (c.size ?? 0), 0));
  });
  /** Tokens que entram em toda conversa do projeto escolhido (nome + descrição das skills ligadas). */
  const fixed = createMemo(() => {
    const p = selected();
    if (!p) return null;
    return sk.items
      .filter((i) => i.kind !== "mcp" && i.enabled && i.accounts.includes(p.accountId) && (i.layer !== "projeto" || (i.project && inside(i.project, p.abs))))
      .filter((i) => i.layer !== "plugin" || !sk.plugins.some((pl) => pl.name === i.plugin && pl.account === p.accountId && pl.project && !inside(pl.project, p.abs)))
      .reduce((s, i) => s + i.alwaysTokens, 0);
  });

  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const runAction = (a: Action) => (a.confirm ? setConfirm(a) : a.run());

  return (
    <div class="page">
      <PageHeader
        title="Inventário"
        subtitle={isTauri ? "Tudo o que as IAs instalaram ou usam neste computador, para qual projeto vale, se está rodando e quanto pesa." : "Modo navegador: exemplo. Abra pelo app para ver o seu computador."}
        actions={
          <button class="ghost-btn" onClick={refreshAll}>
            <RefreshCw size={14} classList={{ spinning: inv.loading || xray.installsLoading || xray.machinesLoading }} /> Atualizar
          </button>
        }
      />

      <div class="inv-bar">
        <ProjectPicker value={proj()} onChange={setProj} />
        <label class="search-box">
          <Search size={13} />
          <input placeholder="Buscar…" value={q()} onInput={(e) => setQ(e.currentTarget.value)} />
          <Show when={q()}><button class="icon-btn tiny visible" onClick={() => setQ("")}><X size={11} /></button></Show>
        </label>
      </div>

      <div class="inv-tiles">
        <Tile icon={<Package size={15} />} label="Itens" hint={selected() ? `que valem em ${selected()!.name}` : "skills, plugins, MCP, programas…"}>
          <CountUp value={scoped().filter((r) => r.cat !== "caches" && r.cat !== "rodando").length} />
        </Tile>
        <Tile icon={<Zap size={15} />} label="Rodando agora" hint={`${pct(runCpu())} CPU · ${formatBytes(runMem())}`} live={running().length > 0}>
          <CountUp value={running().length + runningVms()} />
        </Tile>
        <Tile icon={<HardDrive size={15} />} label="No disco" hint={selected() ? "plugins que valem aqui" : "plugins + caches"}>
          <CountUp value={disk()} format={formatBytes} />
        </Tile>
        <Tile icon={<Cpu size={15} />} label="Contexto fixo" hint={selected() ? "tokens em toda conversa, antes de você escrever" : "escolha um projeto para ver"}>
          <Show when={fixed() !== null} fallback={<span class="muted">—</span>}>
            ~<CountUp value={fixed()!} format={fmtTokens} />
          </Show>
        </Tile>
      </div>

      <div class="who-filter inv-cats">
        <button classList={{ active: cat() === "tudo" }} onClick={() => setCat("tudo")}>Tudo <small class="count">{scoped().length}</small></button>
        <For each={cats.filter((c) => !(selected() && (c.id === "maquinas" || c.id === "caches")))}>
          {(c) => (
            <button classList={{ active: cat() === c.id }} onClick={() => setCat(c.id)}>
              <c.icon size={12} /> {c.label} <small class="count">{shown(c.id).length}</small>
            </button>
          )}
        </For>
      </div>
      <Show when={selected()}>
        <p class="foot-note inv-scope-note"><Info size={12} /> Mostrando o que vale em <strong>{selected()!.name}</strong>: o da conta {accountById(selected()!.accountId).label} e o que está dentro da pasta. VMs e caches valem para o computador todo e ficam em "Todos os projetos".</p>
      </Show>

      <Show when={inv.loaded} fallback={<div class="loading-rows"><div /><div /><div /></div>}>
        <For each={visibleCats()}>
          {(c) => (
            <Show when={shown(c.id).length || cat() === c.id}>
              <section class="inv-section stagger">
                <div class="inv-section-head">
                  <span class="inv-cat-icon"><c.icon size={15} /></span>
                  <div>
                    <strong>{c.label} <small>{shown(c.id).length}</small></strong>
                    <small>{c.hint}</small>
                  </div>
                </div>
                <div class="inv-list">
                  <For each={keys(c.id)} fallback={<div class="scope-empty">Nada aqui{q() ? " com essa busca" : ""}</div>}>
                    {(k, n) => (
                      <Show when={byKey().get(k)}>
                        {(r) => <RowView r={r()} n={n()} open={!!open()[k]} onToggle={() => toggle(k)} onAction={runAction} />}
                      </Show>
                    )}
                  </For>
                </div>
              </section>
            </Show>
          )}
        </For>
      </Show>

      <Show when={confirm()}>
        {(a) => (
          <ConfirmDialog title={a().confirm!.title} confirmLabel={a().confirm!.label} danger={a().danger} onCancel={() => setConfirm(null)} onConfirm={() => { a().run(); setConfirm(null); }}>
            {a().confirm!.body}
          </ConfirmDialog>
        )}
      </Show>
    </div>
  );
}

/** Escolha do projeto: menu próprio (o select nativo destoa do tema escuro). */
function ProjectPicker(props: { value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = createSignal(false);
  const label = () => realProjects().find((p) => p.id === props.value)?.name ?? "Todos os projetos";
  const close = (e: MouseEvent) => !(e.target as HTMLElement).closest(".inv-picker") && setOpen(false);
  onMount(() => document.addEventListener("mousedown", close));
  onCleanup(() => document.removeEventListener("mousedown", close));
  const pick = (id: string) => {
    props.onChange(id);
    setOpen(false);
  };
  return (
    <div class="inv-picker">
      <button class="inv-select" classList={{ active: props.value !== "todos" }} onClick={() => setOpen(!open())}>
        <FolderOpen size={13} /> <span>{label()}</span> <ChevronDown size={12} />
      </button>
      <Show when={open()}>
        <div class="inv-menu">
          <button classList={{ on: props.value === "todos" }} onClick={() => pick("todos")}>Todos os projetos</button>
          <For each={realProjects()} fallback={<small class="inv-menu-empty">Nenhum projeto adicionado ainda</small>}>
            {(p) => (
              <button classList={{ on: props.value === p.id }} onClick={() => pick(p.id)}>
                <span class="account-dot" style={{ "--c": accountById(p.accountId).color }} /> {p.name}
                <small>{accountById(p.accountId).label}</small>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

function Tile(props: { icon: JSX.Element; label: string; hint: string; live?: boolean; children: JSX.Element }) {
  return (
    <div class="inv-tile" classList={{ live: props.live }}>
      <span class="inv-tile-label">{props.icon} {props.label}<Show when={props.live}><i class="pulse-dot" /></Show></span>
      <strong>{props.children}</strong>
      <small>{props.hint}</small>
    </div>
  );
}

/** "Vale em": conta inteira (com os projetos dela), uma pasta, ou o computador. */
function Linked(props: { where: Where }) {
  return (
    <span class="inv-where">
      {(() => {
        const w = props.where;
        if (w.kind === "pc") return <span class="inv-where-chip pc">computador todo</span>;
        if (w.kind === "projeto") {
          const p = realProjects().find((x) => inside(w.path, x.abs));
          return (
            <span class="inv-where-chip proj" title={prettyPath(w.path)}>
              {p ? <ProjectIcon id={p.id} name={p.name} stack={p.stack} size={10} /> : <FolderIcon name={base(w.path)} size={10} />} {p ? p.name : base(w.path)}
              <Show when={!p}><em> · fora do Veocode</em></Show>
            </span>
          );
        }
        const list = realProjects().filter((p) => w.accounts.includes(p.accountId));
        return (
          <span class="inv-where-chip conta" title={list.length ? `Projetos desta conta: ${list.map((p) => p.name).join(", ")}` : "Nenhum projeto do Veocode usa esta conta"}>
            todos os projetos da conta{list.length ? ` (${list.length})` : ""}
          </span>
        );
      })()}
    </span>
  );
}

function RowView(props: { r: Row; n: number; open: boolean; onToggle: () => void; onAction: (a: Action) => void }) {
  const r = () => props.r;
  const busy = () => !!inv.busy[r().key] || !!xray.busy[r().key] || (r().cat === "caches" && xray.caches.some((c) => `cache:${c.id}` === r().key && c.trashing));
  const color = () => (r().cat === "rodando" ? agentColor(r().name) : r().accounts[0] ? accountById(r().accounts[0]).color : "var(--text-3)");
  const Icon = () => {
    const c = cats.find((x) => x.id === r().cat)!;
    return r().cat === "rodando" ? <Bot size={15} /> : <c.icon size={15} />;
  };
  return (
    <div class="inv-row" classList={{ open: props.open, off: r().status.tone === "off" && r().cat !== "caches", running: r().status.tone === "run" }} style={{ "--c": color(), "animation-delay": `${Math.min(props.n, 12) * 30}ms` }}>
      <div class="inv-row-main" onClick={props.onToggle}>
        <span class="inv-row-icon"><Icon /></span>
        <div class="inv-row-text">
          <div class="inv-row-title">
            <strong>{r().name}</strong>
            <Show when={r().tag}><span class="inv-tag">{r().tag}</span></Show>
            <For each={r().accounts}>{(a) => <AccountChip id={a} />}</For>
          </div>
          <small class="inv-row-sub">{r().sub}</small>
          <Linked where={r().where} />
        </div>
        <span class="inv-status" classList={{ [r().status.tone]: true }}>
          <Show when={r().status.tone === "run"}><i class="pulse-dot" /></Show>
          {r().status.text}
        </span>
        <span class="inv-weight">{r().weight ?? ""}</span>
        <div class="inv-actions" onClick={(e) => e.stopPropagation()}>
          <Show when={busy()}><Loader2 size={13} class="spinning" /></Show>
          <Show when={r().note && !r().actions.length}><button class="inv-how" onClick={props.onToggle}>como tirar?</button></Show>
          <For each={r().actions}>
            {(a) => (
              <button class={a.danger ? "inv-btn danger" : "inv-btn"} disabled={busy()} onClick={() => props.onAction(a)} title={a.label}>
                <a.icon size={12} /> <span>{a.label}</span>
              </button>
            )}
          </For>
        </div>
        <span class="inv-chev">{props.open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
      </div>
      <Show when={props.open}>
        <div class="inv-details">
          <Show when={r().note}><p class="inv-note"><Info size={12} /> {r().note}</p></Show>
          <dl>
            <For each={r().details}>
              {([k, v]) => (
                <>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </>
              )}
            </For>
          </dl>
          <Show when={isTauri && (r().cat === "plugins" || r().cat === "skills")}>
            {(() => {
              const path = r().cat === "plugins" ? sk.plugins.find((p) => `plugin:${p.id}` === r().key)?.path : sk.items.find((i) => `item:${i.id}` === r().key)?.path;
              return (
                <Show when={path}>
                  <button class="ghost-btn small" onClick={() => api.reveal(path!).catch((e) => showToast(String(e)))}><FolderOpen size={12} /> Mostrar a pasta</button>
                </Show>
              );
            })()}
          </Show>
        </div>
      </Show>
    </div>
  );
}
