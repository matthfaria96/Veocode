import { dismissable } from "../dismiss";
import { BookOpen, ChevronDown, ChevronRight, Cpu, FolderOpen, HardDrive, Info, Loader2, Package, Play, Power, Puzzle, RefreshCw, Search, Server, Trash2, X, Zap, type LucideProps } from "lucide-solid";
import { createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { api, isTauri, prettyPath } from "../api";
import { accountById, fmtTokens } from "../accounts";
import { formatBytes } from "../data/mock";
import { absPathOf, projects, showToast } from "../store";
import { kindLabel, sk, type Item, type PluginInfo } from "../skills";
import { xray } from "../xray";
import { inv, loadInventory, pluginAction, refreshRunning, removeMcp, trashItem, type McpRun } from "../inventory";
import { AccountChip, CountUp, PageHeader } from "../components/ui";
import { FolderIcon, ProjectIcon } from "../components/icons";
import ConfirmDialog from "../components/ConfirmDialog";
import Explainer from "../components/Explainer";
import ComputerTabs from "../components/ComputerTabs";
import { SkillDetail } from "./SkillDetail";
import { every } from "../every";

// ---------------------------------------------------------------- modelo

type Cat = "plugins" | "skills" | "mcp";
type Tone = "on" | "off" | "run" | "warn" | "bad";

/** Onde a coisa vale: numa conta inteira, numa pasta, ou no computador todo. */
type Where = { kind: "conta"; accounts: string[] } | { kind: "projeto"; path: string } | { kind: "pc" };
type Stored = { kind: "projeto" | "pc" | "nuvem"; text: string; tip: string };

const storedPc = (what: string): Stored => ({ kind: "pc", text: "no computador", tip: `${what} Os arquivos ficam na pasta da conta do Claude neste computador, não dentro do projeto: não vão junto no git.` });
const storedProject: Stored = { kind: "projeto", text: "dentro do projeto", tip: "Os arquivos estão dentro da pasta do projeto (em .claude/ ou .mcp.json). Vão junto no git: quem clonar o repositório também recebe." };

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
  /** onde os arquivos ficam guardados: dentro da pasta do projeto (vão junto no git) ou no computador */
  stored: Stored;
  status: { text: string; tone: Tone };
  weight: string | null;
  load?: { cpu: number; mem: number };
  details: [string, string][];
  /** linha extra quando não dá para tirar daqui (diz como tirar) */
  note?: string;
  actions: Action[];
}

const cats: { id: Cat; label: string; icon: (p: LucideProps) => JSX.Element; hint: string }[] = [
  { id: "skills", label: "Receitas, atalhos e ajudantes", icon: Puzzle, hint: "Instruções extras que o Claude lê. Cada uma ocupa um pouco de toda conversa, mesmo sem uso: apagar as que você não usa deixa o Claude mais leve." },
  { id: "mcp", label: "Conexões (MCP)", icon: Server, hint: "Pontes para outros programas e sites (Figma, GitHub…). Cada conversa aberta liga a sua; com o Claude fechado, não rodam." },
  { id: "plugins", label: "Pacotes (plugins)", icon: Package, hint: "Conjuntos prontos que trazem várias receitas e conexões de uma vez. Desligar tira tudo o que eles trazem." },
];

const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
const pct = (n: number) => `${n < 10 ? n.toFixed(1).replace(".", ",") : Math.round(n)}%`;
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
    stored: storedPc(p.project ? "Foi baixado para o computador, mas só está ligado neste projeto." : "Baixado e ligado para todos os projetos desta conta."),
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
    stored: inRepo ? storedProject : i.manage === "synced" ? { kind: "nuvem", text: "na conta claude.ai", tip: "Veio da sua conta no claude.ai e é sincronizado sozinho. Para tirar, use o site." } : storedPc("Vale em todos os projetos desta conta."),
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
    stored: i.mcp?.scope === "project" ? storedProject : storedPc(i.project ? "A configuração fica guardada no computador, ligada só a esta pasta." : "Vale em todos os projetos desta conta."),
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

// ---------------------------------------------------------------- tela

export default function Inventory() {
  const [cat, setCat] = createSignal<Cat | "tudo">("tudo");
  const [proj, setProj] = createSignal("todos");
  const [q, setQ] = createSignal("");
  const [open, setOpen] = createSignal<Record<string, boolean>>({});
  const [confirm, setConfirm] = createSignal<Action | null>(null);
  const [reading, setReading] = createSignal<Item | null>(null);

  onMount(() => {
    loadInventory();
    onCleanup(every(refreshRunning, 3000));
  });

  const rows = createMemo<Row[]>(() => [
    ...sk.plugins.map(pluginRow),
    ...sk.items.filter((i) => i.kind !== "mcp" && i.layer !== "plugin").map(itemRow),
    ...sk.items.filter((i) => i.kind === "mcp").map((i) => mcpRow(i, inv.mcp[i.id] ?? [])),
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
  const visibleCats = () => cats.filter((c) => cat() === "tudo" || cat() === c.id);

  // ---- resumo
  const running = createMemo(() => scoped().filter((r) => r.load));
  const runCpu = () => running().reduce((s, r) => s + r.load!.cpu, 0);
  const runMem = () => running().reduce((s, r) => s + r.load!.mem, 0);
  const disk = createMemo(() => sk.plugins.filter((p) => inProject(pluginRow(p))).reduce((s, p) => s + p.bytes, 0));
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
  // receitas agrupadas por de onde vieram; com busca, os grupos abrem sozinhos
  const skillFamilies = createMemo(() =>
    families(keys("skills").map((key) => ({ key, item: sk.items.find((i) => `item:${i.id}` === key)! })).filter((x) => x.item)),
  );
  const famOpen = (f: Family) => !!open()[`fam:${f.id}`] || q().trim().length > 0 || skillFamilies().length === 1;
  const runAction = (a: Action) => (a.confirm ? setConfirm(a) : a.run());

  return (
    <div class="page">
      <ComputerTabs />
      <PageHeader
        title="Extras do Claude"
        subtitle={isTauri ? "Habilidades a mais que o Claude ganhou, onde cada uma vale e quanto pesa. Daqui dá para desligar ou tirar." : "Modo navegador: exemplo. Abra pelo app para ver os seus."}
        actions={
          <button class="ghost-btn" onClick={loadInventory}>
            <RefreshCw size={14} classList={{ spinning: inv.loading }} /> Atualizar
          </button>
        }
      />

      <Explainer
        id="skills"
        title="O que é esta tela?"
        intro="O Claude já sabe programar sozinho. Aqui aparecem os extras que alguém instalou para ele. São quatro tipos:"
        terms={[
          { word: "Receitas (skills)", means: "Instruções prontas para um tipo de tarefa, como “fazer um PDF” ou “revisar código”. O Claude usa sozinho quando o pedido combina." },
          { word: "Atalhos /", means: "Comandos que você digita no chat começando com barra, como /revisar. Cada um manda um pedido pronto." },
          { word: "Ajudantes", means: "Mini-Claudes especializados que o Claude principal chama para uma parte do trabalho (pesquisar, testar…)." },
          { word: "Conexões (MCP)", means: "Pontes para outros programas e sites, como Figma, GitHub ou um navegador. Deixam o Claude ler e mexer neles." },
        ]}
        calm={<>Você <strong>não precisa mexer em nada aqui</strong>. Clique numa linha para ver os detalhes. Antes de tirar algo, o Veocode pergunta, e o que sai vai para a <strong>Lixeira</strong>. Use o seletor de projeto para ver só o que vale numa pasta.</>}
      />

      <Explainer
        id="onde-fica"
        closed
        openLabel="Instalei uma skill ou plugin (do GitHub, por exemplo): fica só no projeto ou no computador?"
        title="Fica só no projeto ou no computador todo?"
        intro={<>Depende de <strong>como</strong> foi instalado. São duas perguntas diferentes: <strong>onde os arquivos ficam guardados</strong> e <strong>em quais projetos valem</strong>. Cada linha da lista abaixo responde as duas (“vale em” e “guardado”).</>}
        terms={[
          { word: "Skill dentro do projeto", means: <>Pasta <code>.claude/skills</code> dentro do projeto, comum quando você baixa um repositório do GitHub que já vem com ela. <strong>Só vale naquele projeto</strong> e vai junto no git.</> },
          { word: "Skill na conta", means: <>Pasta <code>~/.claude/skills</code>, fora dos projetos. <strong>Vale em todos os projetos</strong> daquela conta neste computador.</> },
          { word: "Plugin (/plugin, do GitHub)", means: <><strong>Sempre é baixado para o computador</strong> (<code>~/.claude/plugins</code>). Na instalação você escolhe onde ele liga: <em>user</em> = todos os projetos; <em>project</em> ou <em>local</em> = só no projeto onde instalou.</> },
          { word: "Conexão (claude mcp add)", means: <>Sem nada a mais, <strong>vale só na pasta</strong> onde você rodou o comando (guardada no computador). Com <code>--scope project</code> vai para <code>.mcp.json</code> no projeto; com <code>--scope user</code>, vale em todos.</> },
          { word: "Programas que a skill instala", means: <>Coisas instaladas com npm, pip ou brew ficam <strong>no computador todo</strong>, para qualquer projeto. Veja em <em>Espaço e memória → Instalado pelas IAs</em>.</> },
        ]}
        calm={<>No Veocode, cada conta do Claude tem a sua pasta: o que foi instalado “no computador” por uma conta <strong>não aparece</strong> para outra. Quer ver só o que vale num projeto? Escolha ele no seletor logo abaixo.</>}
      />

      <div class="inv-bar">
        <ProjectPicker value={proj()} onChange={setProj} />
        <label class="search-box">
          <Search size={13} />
          <input placeholder="Buscar…" value={q()} onInput={(e) => setQ(e.currentTarget.value)} />
          <Show when={q()}><button class="icon-btn tiny visible" title="Limpar a busca" onClick={() => setQ("")}><X size={11} /></button></Show>
        </label>
      </div>

      <div class="inv-tiles">
        <Tile icon={<Package size={15} />} label="Extras" hint={selected() ? `que valem em ${selected()!.name}` : "em todos os projetos"}>
          <CountUp value={scoped().length} />
        </Tile>
        <Tile icon={<Zap size={15} />} label="Conexões abertas" hint={`${pct(runCpu())} CPU · ${formatBytes(runMem())}`} live={running().length > 0}>
          <CountUp value={running().length} />
        </Tile>
        <Tile icon={<HardDrive size={15} />} label="No disco" hint="pacotes instalados">
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
        <For each={cats}>
          {(c) => (
            <button classList={{ active: cat() === c.id }} onClick={() => setCat(c.id)}>
              <c.icon size={12} /> {c.label} <small class="count">{shown(c.id).length}</small>
            </button>
          )}
        </For>
      </div>
      <Show when={selected()}>
        <p class="foot-note inv-scope-note"><Info size={12} /> Mostrando o que vale em <strong>{selected()!.name}</strong>: o da conta {accountById(selected()!.accountId).label} e o que está dentro da pasta.</p>
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
                <Show
                  when={c.id === "skills" && keys(c.id).length > 0}
                  fallback={
                    <div class="inv-list">
                      <For each={keys(c.id)} fallback={<div class="scope-empty">Nada aqui{q() ? " com essa busca" : ""}</div>}>
                        {(k, n) => (
                          <Show when={byKey().get(k)}>
                            {(r) => <RowView r={r()} n={n()} open={!!open()[k]} onToggle={() => toggle(k)} onAction={runAction} onRead={setReading} />}
                          </Show>
                        )}
                      </For>
                    </div>
                  }
                >
                  <div class="inv-list">
                    <For each={skillFamilies()}>
                      {(f) => (
                        <FamilyView f={f} open={famOpen(f)} onToggle={() => toggle(`fam:${f.id}`)} first={byKey().get(f.keys[0])}>
                          <For each={f.keys}>
                            {(k, n) => (
                              <Show when={byKey().get(k)}>
                                {(r) => <RowView r={r()} n={n()} open={!!open()[k]} onToggle={() => toggle(k)} onAction={runAction} onRead={setReading} />}
                              </Show>
                            )}
                          </For>
                        </FamilyView>
                      )}
                    </For>
                  </div>
                </Show>
              </section>
            </Show>
          )}
        </For>
      </Show>

      <Show when={reading()}>{(i) => <SkillDetail i={i()} onClose={() => setReading(null)} />}</Show>
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
        <div class="inv-menu" ref={(el) => dismissable(el, () => setOpen(false))}>
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
function Linked(props: { where: Where; stored: Stored }) {
  return (
    <span class="inv-where">
      <span class="inv-where-label">vale em</span>
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
      <span class="inv-where-label">guardado</span>
      <span class={`inv-where-chip stored-${props.stored.kind}`} title={props.stored.tip}>{props.stored.text}</span>
    </span>
  );
}

/** Nome bonito para um programa ou prefixo: "chatcut-desktop" → "ChatCut Desktop". */
const known: Record<string, string> = { chatcut: "ChatCut", figma: "Figma", github: "GitHub", openai: "OpenAI", claude: "Claude" };
const pretty = (s: string) => s.split(/[-_]/).filter(Boolean).map((w) => known[w.toLowerCase()] ?? w[0].toUpperCase() + w.slice(1)).join(" ");

interface Family {
  id: string;
  label: string;
  hint: string;
  keys: string[];
  tokens: number;
}

/**
 * Junta receitas, atalhos e ajudantes por de onde vieram: o programa que instalou várias de uma
 * vez (lista dele na pasta skills/), o projeto que as trouxe, o claude.ai, ou o mesmo começo de
 * nome (3 ou mais). O resto fica em "Instaladas uma a uma".
 */
function families(list: { key: string; item: Item }[]): Family[] {
  const prefix = (i: Item) => (i.name.includes("-") ? i.name.replace(/^\//, "").split("-")[0].toLowerCase() : null);
  const count = new Map<string, number>();
  for (const { item: i } of list) {
    const p = prefix(i);
    if (p && !i.group && i.layer === "conta" && i.manage !== "synced") count.set(p, (count.get(p) ?? 0) + 1);
  }
  const fams = new Map<string, Family>();
  const add = (id: string, label: string, hint: string, key: string, tokens: number) => {
    const f = fams.get(id) ?? { id, label, hint, keys: [], tokens: 0 };
    f.keys.push(key);
    f.tokens += tokens;
    fams.set(id, f);
  };
  for (const { key, item: i } of list) {
    const p = prefix(i);
    if (i.group) add(`g:${i.group}`, pretty(i.group), `Instaladas juntas pelo programa ${pretty(i.group)}. Ficam na pasta da conta e valem em todos os projetos. Para tirar todas, desinstale ou reconfigure o ${pretty(i.group)}.`, key, i.alwaysTokens);
    else if (i.layer === "projeto" && i.project) add(`p:${i.project}`, `Vieram com o projeto ${base(i.project)}`, `Estão dentro da pasta do projeto (.claude/). Só valem lá e vão junto no git.`, key, i.alwaysTokens);
    else if (i.manage === "synced") add("claudeai", "Da sua conta claude.ai", "Sincronizadas do site claude.ai. Para tirar, use o site.", key, i.alwaysTokens);
    else if (p && (count.get(p) ?? 0) >= 3) add(`x:${p}`, pretty(p), `Têm o mesmo começo de nome ("${p}-"), então provavelmente vieram juntas do mesmo lugar.`, key, i.alwaysTokens);
    else add("soltas", "Instaladas uma a uma", "Cada uma foi colocada sozinha na pasta da conta. Valem em todos os projetos.", key, i.alwaysTokens);
  }
  return [...fams.values()].sort((a, b) => Number(a.id === "soltas") - Number(b.id === "soltas") || b.keys.length - a.keys.length);
}

function FamilyView(props: { f: Family; open: boolean; onToggle: () => void; first?: Row; children: JSX.Element }) {
  return (
    <div class="inv-family" classList={{ open: props.open }}>
      <button class="inv-family-head" onClick={props.onToggle} aria-expanded={props.open}>
        {props.open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span class="inv-family-icon"><Package size={14} /></span>
        <span class="inv-family-text">
          <strong>{props.f.label} <small class="count">{props.f.keys.length}</small></strong>
          <small>{props.f.hint}</small>
          <Show when={props.first}>{(r) => <Linked where={r().where} stored={r().stored} />}</Show>
        </span>
        <span class="inv-weight">~{fmtTokens(props.f.tokens)} tokens fixos</span>
      </button>
      <Show when={props.open}>
        <div class="inv-family-body">{props.children}</div>
      </Show>
    </div>
  );
}

function RowView(props: { r: Row; n: number; open: boolean; onToggle: () => void; onAction: (a: Action) => void; onRead: (i: Item) => void }) {
  const r = () => props.r;
  const busy = () => !!inv.busy[r().key] || !!xray.busy[r().key];
  const color = () => (r().accounts[0] ? accountById(r().accounts[0]).color : "var(--text-3)");
  const Icon = () => {
    const c = cats.find((x) => x.id === r().cat)!;
    return <c.icon size={15} />;
  };
  const item = () => (r().cat === "skills" ? sk.items.find((i) => `item:${i.id}` === r().key) : undefined);
  return (
    <div class="inv-row" classList={{ open: props.open, off: r().status.tone === "off", running: r().status.tone === "run" }} style={{ "--c": color(), "animation-delay": `${Math.min(props.n, 12) * 30}ms` }}>
      <div class="inv-row-main" onClick={props.onToggle}>
        <span class="inv-row-icon"><Icon /></span>
        <div class="inv-row-text">
          <div class="inv-row-title">
            <strong>{r().name}</strong>
            <Show when={r().tag}><span class="inv-tag">{r().tag}</span></Show>
            <For each={r().accounts}>{(a) => <AccountChip id={a} />}</For>
          </div>
          <small class="inv-row-sub">{r().sub}</small>
          <Linked where={r().where} stored={r().stored} />
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
                  <div class="inv-detail-actions">
                    <Show when={item()?.path?.endsWith(".md")}>
                      <button class="ghost-btn small" onClick={() => props.onRead(item()!)}><BookOpen size={12} /> Ler o que ela diz</button>
                    </Show>
                    <button class="ghost-btn small" onClick={() => api.reveal(path!).catch((e) => showToast(String(e)))}><FolderOpen size={12} /> Mostrar a pasta</button>
                  </div>
                </Show>
              );
            })()}
          </Show>
        </div>
      </Show>
    </div>
  );
}
