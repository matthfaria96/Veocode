import { dismissable } from "../dismiss";
import { BookOpen, ChevronDown, ChevronRight, Cpu, FolderOpen, Info, Loader2, Package, Play, Power, Puzzle, Search, Server, Trash2, X, type LucideProps } from "lucide-solid";
import { createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { api, isTauri, prettyPath } from "../api";
import { accountById, fmtTokens } from "../accounts";
import { formatBytes } from "../data/mock";
import { absPathOf, projects, showToast } from "../store";
import { kindLabel, sk, type Item, type PluginInfo } from "../skills";
import { xray } from "../xray";
import { inv, pluginAction, removeMcp, trashItem, type McpRun } from "../inventory";
import { AccountChip } from "../components/ui";
import { FolderIcon, ProjectIcon } from "../components/icons";
import ConfirmDialog from "../components/ConfirmDialog";
import Explainer from "../components/Explainer";
import { SkillDetail } from "./SkillDetail";
import { dec, tx } from "../i18n";

// ---------------------------------------------------------------- modelo

type Cat = "plugins" | "skills" | "mcp";
type Tone = "on" | "off" | "run" | "warn" | "bad";

/** Onde a coisa vale: numa conta inteira, numa pasta, ou no computador todo. */
type Where = { kind: "conta"; accounts: string[] } | { kind: "projeto"; path: string } | { kind: "pc" };
type Stored = { kind: "projeto" | "pc" | "nuvem"; text: string; tip: string };

const storedPc = (what: string): Stored => ({ kind: "pc", text: tx("no computador"), tip: tx("{what} Os arquivos ficam na pasta da conta do Claude neste computador, não dentro do projeto: não vão junto no git.", { what }) });
const storedProject: Stored = { kind: "projeto", get text() { return tx("dentro do projeto"); }, get tip() { return tx("Os arquivos estão dentro da pasta do projeto (em .claude/ ou .mcp.json). Vão junto no git: quem clonar o repositório também recebe."); } };

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
  { id: "skills", get label() { return tx("Receitas, atalhos e ajudantes"); }, icon: Puzzle, get hint() { return tx("Instruções extras que o Claude lê. Cada uma ocupa um pouco de toda conversa, mesmo sem uso: apagar as que você não usa deixa o Claude mais leve."); } },
  { id: "mcp", get label() { return tx("Conexões (MCP)"); }, icon: Server, get hint() { return tx("Pontes para outros programas e sites (Figma, GitHub…). Cada conversa aberta liga a sua; com o Claude fechado, não rodam."); } },
  { id: "plugins", get label() { return tx("Pacotes (plugins)"); }, icon: Package, get hint() { return tx("Conjuntos prontos que trazem várias receitas e conexões de uma vez. Desligar tira tudo o que eles trazem."); } },
];

const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
const pct = (n: number) => `${n < 10 ? dec(n) : Math.round(n)}%`;
const scopeLabel: Record<string, string> = { get user() { return tx("conta"); }, get local() { return tx("conta, só nesta pasta"); }, get project() { return tx("arquivo do projeto"); }, plugin: "plugin" };

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
    sub: p.description || tx("Sem descrição"),
    accounts: [p.account],
    where: p.project ? { kind: "projeto", path: p.project } : { kind: "conta", accounts: [p.account] },
    stored: storedPc(p.project ? tx("Foi baixado para o computador, mas só está ligado neste projeto.") : tx("Baixado e ligado para todos os projetos desta conta.")),
    status: p.enabled ? { text: tx("ligado"), tone: "on" } : { text: tx("desligado"), tone: "off" },
    weight: tx("{v} · ~{v2} tokens fixos", { v: formatBytes(p.bytes), v2: fmtTokens(p.alwaysTokens) }),
    details: [
      [tx("Id"), p.pluginId],
      [tx("Instalado na"), scopeLabel[p.scope] ?? p.scope],
      [tx("Traz"), `${p.skills} skills · ${p.mcp} MCP`],
      ...(items.length ? ([[tx("Itens"), items.map((i) => i.name).slice(0, 14).join(", ") + (items.length > 14 ? `… (+${items.length - 14})` : "")]] as [string, string][]) : []),
      [tx("Pasta"), prettyPath(p.path)],
    ],
    actions: [
      p.enabled
        ? { label: tx("Desligar"), icon: Power, run: () => pluginAction(p, "disable") }
        : { label: tx("Ligar"), icon: Play, run: () => pluginAction(p, "enable") },
      {
        label: tx("Remover"),
        icon: Trash2,
        danger: true,
        confirm: {
          title: tx("Remover o plugin {name}?", { name: p.name }),
          label: tx("Remover"),
          body: (
            <>
              <p>{tx("O Claude Code desinstala o plugin desta conta ({label}) e tudo o que ele traz: {skills} skills e {mcp} MCP.", { label: accountById(p.account).label, skills: p.skills, mcp: p.mcp })}</p>
              <p class="muted">{tx("Dá para instalar de novo depois pelo")} <code>/plugin</code> {tx("do Claude. Se só quer parar de usar, \"Desligar\" é reversível na hora.")}</p>
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
      label: tx("Remover"),
      icon: Trash2,
      danger: true,
      confirm: {
        title: tx("Mover {name} para a Lixeira?", { name: i.name }),
        label: tx("Mover para a Lixeira"),
        body: (
          <>
            <p>{tx("{v} em", { v: kindLabel[i.kind] })} <code>{prettyPath(i.path)}</code> {tx("vai para a Lixeira{v}.", { v: i.path.endsWith("SKILL.md") ? tx(" (a pasta inteira da skill)") : "" })}</p>
            <Show when={inRepo}>
              <p class="warn-text">{tx("Fica dentro da pasta do projeto: se ela usa git, vai aparecer como arquivo apagado.")}</p>
            </Show>
            <p class="muted">{tx("Para voltar, é só tirar da Lixeira.")}</p>
          </>
        ),
      },
      run: () => trashItem(i),
    });
  } else if (i.manage === "synced") {
    note = tx("Veio do claude.ai (sincronizado com a conta): tire por lá, em Ajustes → Capacidades.");
  }
  return {
    key: `item:${i.id}`,
    cat: "skills",
    name: i.name,
    tag: kindLabel[i.kind],
    sub: i.description || tx("Sem descrição"),
    accounts: i.accounts,
    where: inRepo && i.project ? { kind: "projeto", path: i.project } : { kind: "conta", accounts: i.accounts },
    stored: inRepo ? storedProject : i.manage === "synced" ? { kind: "nuvem", text: tx("na conta claude.ai"), tip: tx("Veio da sua conta no claude.ai e é sincronizado sozinho. Para tirar, use o site.") } : storedPc(tx("Vale em todos os projetos desta conta.")),
    status: i.enabled ? { text: tx("ativa"), tone: "on" } : { text: tx("desligada"), tone: "off" },
    weight: tx("~{v} fixos · ~{v2} ao usar", { v: fmtTokens(i.alwaysTokens), v2: fmtTokens(i.invokeTokens) }),
    details: [
      [tx("Arquivo"), i.path ? prettyPath(i.path) : "—"],
      ...(i.origin ? ([[tx("Origem"), i.origin]] as [string, string][]) : []),
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
    ? { text: runs.length > 1 ? tx("rodando ×{n}", { n: runs.length }) : tx("rodando"), tone: "run" }
    : m.found === false
      ? { text: tx("falta programa"), tone: "bad" }
      : !i.enabled
        ? { text: tx("desligado"), tone: "off" }
        : remote
          ? { text: tx("remoto"), tone: "on" }
          : { text: tx("parado"), tone: "off" };
  const actions: Action[] = [];
  let note: string | undefined;
  if (m.scope === "plugin" || i.layer === "plugin") {
    note = tx("Vem do plugin {v}: desligue o plugin para tirar.", { v: i.plugin ?? "" });
  } else if (i.manage === "cli") {
    actions.push({
      label: tx("Remover"),
      icon: Trash2,
      danger: true,
      confirm: {
        title: tx("Remover o servidor {name}?", { name: i.name }),
        label: tx("Remover"),
        body: (
          <>
            <p>{tx("O Veocode pede ao próprio Claude Code (")}<code>{tx("claude mcp remove")}</code>{tx(") para tirar este servidor")}{i.accounts.length > 1 ? tx(" das contas {v}", { v: i.accounts.map((a) => accountById(a).label).join(", ") }) : tx(" da conta {label}", { label: accountById(i.accounts[0]).label })}.</p>
            <Show when={m.scope === "project"}>
              <p class="warn-text">{tx("Ele está no")} <code>.mcp.json</code> {tx("do projeto: o arquivo do projeto muda (e o git vai mostrar).")}</p>
            </Show>
            <p class="muted">{tx("As chaves e variáveis dele somem junto. Conversas já abertas seguem com ele até recomeçar.")}</p>
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
    stored: i.mcp?.scope === "project" ? storedProject : storedPc(i.project ? tx("A configuração fica guardada no computador, ligada só a esta pasta.") : tx("Vale em todos os projetos desta conta.")),
    status,
    weight: runs.length ? `${pct(cpu)} CPU · ${formatBytes(mem)}` : remote ? tx("roda fora deste computador") : tx("só roda com o Claude aberto"),
    load: runs.length ? { cpu, mem } : undefined,
    details: [
      [tx("Guardado como"), scopeLabel[m.scope] ?? m.scope],
      [remote ? tx("Endereço") : tx("Comando"), remote ? m.url ?? "—" : [m.command, ...m.args].filter(Boolean).join(" ")],
      [tx("Definido em"), prettyPath(m.definedIn)],
      ...(m.envNames.length || m.headerNames.length ? ([[tx("Segredos"), [...m.envNames, ...m.headerNames].join(", ") + tx(" (só os nomes)")]] as [string, string][]) : []),
      ...runs.map((r, n): [string, string] => [tx("Cópia {v}", { v: n + 1 }), tx("pid {pid} · {agent} em {v} · {v2} · {v3}", { pid: r.pid, agent: r.agent, v: r.cwd ? base(r.cwd) : "?", v2: pct(r.cpu), v3: formatBytes(r.mem) })]),
    ],
    note,
    actions,
  };
}

// ---------------------------------------------------------------- tela

export type ExtrasCat = Cat;

// filtro de projeto e busca valem para as três partes (trocar de parte não perde a escolha)
const [proj, setProj] = createSignal("todos");
const [q, setQ] = createSignal("");
const [open, setOpen] = createSignal<Record<string, boolean>>({});

/** Quantos extras de cada tipo (para o menu do Painel e a Visão geral). */
export const extrasCount = (c: Cat) =>
  c === "plugins" ? sk.plugins.length : c === "mcp" ? sk.items.filter((i) => i.kind === "mcp").length : sk.items.filter((i) => i.kind !== "mcp" && i.layer !== "plugin").length;
/** Conexões (MCP) abertas agora e quanto gastam juntas. */
export const mcpRunning = () => {
  const runs = Object.values(inv.mcp).filter((r) => r.length);
  return { n: runs.length, cpu: runs.flat().reduce((s, r) => s + r.cpu, 0), mem: runs.flat().reduce((s, r) => s + r.mem, 0) };
};
/** Espaço dos plugins baixados. */
export const pluginsDisk = () => sk.plugins.reduce((s, p) => s + p.bytes, 0);

/** Uma das três partes de extras do Painel: receitas e atalhos, conexões ou plugins. */
export function ExtrasPane(props: { cat: Cat }) {
  const [confirm, setConfirm] = createSignal<Action | null>(null);
  const [reading, setReading] = createSignal<Item | null>(null);

  const rows = createMemo<Row[]>(() =>
    props.cat === "plugins"
      ? sk.plugins.map(pluginRow)
      : props.cat === "mcp"
        ? sk.items.filter((i) => i.kind === "mcp").map((i) => mcpRow(i, inv.mcp[i.id] ?? []))
        : sk.items.filter((i) => i.kind !== "mcp" && i.layer !== "plugin").map(itemRow),
  );

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
  const shown = createMemo(() => rows().filter((r) => inProject(r) && matches(r)));
  // as linhas são refeitas a cada leitura (3 s); a lista anda pela chave para não recriar nem repetir a animação
  const byKey = createMemo(() => new Map(rows().map((r) => [r.key, r])));
  const keys = createMemo(() => shown().map((r) => r.key), undefined, { equals: (a, b) => a.length === b.length && a.every((k, i) => k === b[i]) });

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
    props.cat !== "skills" ? [] : families(keys().map((key) => ({ key, item: sk.items.find((i) => `item:${i.id}` === key)! })).filter((x) => x.item)),
  );
  const famOpen = (f: Family) => !!open()[`fam:${f.id}`] || q().trim().length > 0 || skillFamilies().length === 1;
  const runAction = (a: Action) => (a.confirm ? setConfirm(a) : a.run());
  const row = (k: string, n: number) => (
    <Show when={byKey().get(k)}>
      {(r) => <RowView r={r()} n={n} open={!!open()[k]} onToggle={() => toggle(k)} onAction={runAction} onRead={setReading} />}
    </Show>
  );

  return (
    <div class="dash-extras">
      <div class="inv-bar">
        <ProjectPicker value={proj()} onChange={setProj} />
        <label class="search-box">
          <Search size={13} />
          <input placeholder={tx("Buscar…")} value={q()} onInput={(e) => setQ(e.currentTarget.value)} />
          <Show when={q()}><button class="icon-btn tiny visible" title={tx("Limpar a busca")} onClick={() => setQ("")}><X size={11} /></button></Show>
        </label>
        <Show when={props.cat === "skills" && fixed() !== null}>
          <span class="inv-fixed" title={tx("Tokens que entram em toda conversa deste projeto antes de você escrever")}>
            <Cpu size={12} /> {tx("~{v} tokens fixos por conversa", { v: fmtTokens(fixed()!) })}
          </span>
        </Show>
      </div>
      <Show when={selected()}>
        <p class="foot-note inv-scope-note"><Info size={12} /> {tx("Mostrando o que vale em")} <strong>{selected()!.name}</strong>{tx(": o da conta {label} e o que está dentro da pasta.", { label: accountById(selected()!.accountId).label })}</p>
      </Show>

      <Show when={inv.loaded} fallback={<div class="loading-rows"><div /><div /><div /></div>}>
        <Show
          when={props.cat === "skills" && keys().length > 0}
          fallback={
            <div class="inv-list">
              <For each={keys()} fallback={<div class="scope-empty">{q() ? tx("Nada com essa busca") : selected() ? tx("Nada disso vale neste projeto") : tx("Nada instalado aqui")}</div>}>
                {(k, n) => row(k, n())}
              </For>
            </div>
          }
        >
          <div class="inv-list">
            <For each={skillFamilies()}>
              {(f) => (
                <FamilyView f={f} open={famOpen(f)} onToggle={() => toggle(`fam:${f.id}`)} first={byKey().get(f.keys[0])}>
                  <For each={f.keys}>{(k, n) => row(k, n())}</For>
                </FamilyView>
              )}
            </For>
          </div>
        </Show>
      </Show>

      <div class="dash-help">
        <Show when={props.cat === "skills"}>
          <Explainer
            id="skills"
            closed
            openLabel={tx("O que são receitas, atalhos e ajudantes?")}
            title={tx("O que são receitas, atalhos e ajudantes?")}
            intro={tx("O Claude já sabe programar sozinho. Aqui aparecem os extras que alguém instalou para ele:")}
            terms={[
              { word: tx("Receitas (skills)"), means: tx("Instruções prontas para um tipo de tarefa, como “fazer um PDF” ou “revisar código”. O Claude usa sozinho quando o pedido combina.") },
              { word: tx("Atalhos /"), means: tx("Comandos que você digita no chat começando com barra, como /revisar. Cada um manda um pedido pronto.") },
              { word: tx("Ajudantes"), means: tx("Mini-Claudes especializados que o Claude principal chama para uma parte do trabalho (pesquisar, testar…).") },
            ]}
            calm={<>{tx("Você")} <strong>{tx("não precisa mexer em nada aqui")}</strong>{tx(". Clique numa linha para ver os detalhes. Antes de tirar algo, o Veocode pergunta, e o que sai vai para a")} <strong>{tx("Lixeira")}</strong>.</>}
          />
        </Show>
        <Explainer
          id="onde-fica"
          closed
          openLabel={tx("Instalei uma skill ou plugin (do GitHub, por exemplo): fica só no projeto ou no computador?")}
          title={tx("Fica só no projeto ou no computador todo?")}
          intro={<>{tx("Depende de")} <strong>{tx("como")}</strong> {tx("foi instalado. São duas perguntas diferentes:")} <strong>{tx("onde os arquivos ficam guardados")}</strong> e <strong>{tx("em quais projetos valem")}</strong>{tx(". Cada linha da lista abaixo responde as duas (“vale em” e “guardado”).")}</>}
          terms={[
            { word: tx("Skill dentro do projeto"), means: <>{tx("Pasta")} <code>{tx(".claude/skills")}</code> {tx("dentro do projeto, comum quando você baixa um repositório do GitHub que já vem com ela.")} <strong>{tx("Só vale naquele projeto")}</strong> {tx("e vai junto no git.")}</> },
            { word: tx("Skill na conta"), means: <>{tx("Pasta")} <code>~/.claude/skills</code>{tx(", fora dos projetos.")} <strong>{tx("Vale em todos os projetos")}</strong> {tx("daquela conta neste computador.")}</> },
            { word: tx("Plugin (/plugin, do GitHub)"), means: <><strong>{tx("Sempre é baixado para o computador")}</strong> (<code>~/.claude/plugins</code>{tx("). Na instalação você escolhe onde ele liga:")} <em>user</em> {tx("= todos os projetos;")} <em>project</em> {tx("ou")} <em>local</em> {tx("= só no projeto onde instalou.")}</> },
            { word: tx("Conexão (claude mcp add)"), means: <>{tx("Sem nada a mais,")} <strong>{tx("vale só na pasta")}</strong> {tx("onde você rodou o comando (guardada no computador). Com")} <code>--scope project</code> {tx("vai para")} <code>.mcp.json</code> {tx("no projeto; com")} <code>--scope user</code>{tx(", vale em todos.")}</> },
            { word: tx("Programas que a skill instala"), means: <>{tx("Coisas instaladas com npm, pip ou brew ficam")} <strong>{tx("no computador todo")}</strong>{tx(", para qualquer projeto. Veja em")} <em>{tx("Painel → Instalado pelas IAs")}</em>.</> },
          ]}
          calm={<>{tx("No Veocode, cada conta do Claude tem a sua pasta: o que foi instalado “no computador” por uma conta")} <strong>{tx("não aparece")}</strong> {tx("para outra. Quer ver só o que vale num projeto? Escolha ele no seletor do topo.")}</>}
        />
      </div>

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
  const label = () => realProjects().find((p) => p.id === props.value)?.name ?? tx("Todos os projetos");
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
          <button classList={{ on: props.value === "todos" }} onClick={() => pick("todos")}>{tx("Todos os projetos")}</button>
          <For each={realProjects()} fallback={<small class="inv-menu-empty">{tx("Nenhum projeto adicionado ainda")}</small>}>
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

/** "Vale em": conta inteira (com os projetos dela), uma pasta, ou o computador. */
function Linked(props: { where: Where; stored: Stored }) {
  return (
    <span class="inv-where">
      <span class="inv-where-label">{tx("vale em")}</span>
      {(() => {
        const w = props.where;
        if (w.kind === "pc") return <span class="inv-where-chip pc">{tx("computador todo")}</span>;
        if (w.kind === "projeto") {
          const p = realProjects().find((x) => inside(w.path, x.abs));
          return (
            <span class="inv-where-chip proj" title={prettyPath(w.path)}>
              {p ? <ProjectIcon id={p.id} name={p.name} stack={p.stack} size={10} /> : <FolderIcon name={base(w.path)} size={10} />} {p ? p.name : base(w.path)}
              <Show when={!p}><em> {tx("· fora do Veocode")}</em></Show>
            </span>
          );
        }
        const list = realProjects().filter((p) => w.accounts.includes(p.accountId));
        return (
          <span class="inv-where-chip conta" title={list.length ? tx("Projetos desta conta: {v}", { v: list.map((p) => p.name).join(", ") }) : tx("Nenhum projeto do Veocode usa esta conta")}>
            {tx("todos os projetos da conta{v}", { v: list.length ? ` (${list.length})` : "" })}
          </span>
        );
      })()}
      <span class="inv-where-label">{tx("guardado")}</span>
      <span class={`inv-where-chip stored-${props.stored.kind}`} title={props.stored.tip}>{props.stored.text}</span>
    </span>
  );
}

/** Nome bonito para um programa ou prefixo: "chatcut-desktop" → "ChatCut Desktop". */
const known: Record<string, string> = { chatcut: "ChatCut", get figma() { return tx("Figma"); }, github: "GitHub", openai: "OpenAI", claude: "Claude" };
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
    if (i.group) add(`g:${i.group}`, pretty(i.group), tx("Instaladas juntas pelo programa {v}. Ficam na pasta da conta e valem em todos os projetos. Para tirar todas, desinstale ou reconfigure o {v}.", { v: pretty(i.group) }), key, i.alwaysTokens);
    else if (i.layer === "projeto" && i.project) add(`p:${i.project}`, tx("Vieram com o projeto {v}", { v: base(i.project) }), tx("Estão dentro da pasta do projeto (.claude/). Só valem lá e vão junto no git."), key, i.alwaysTokens);
    else if (i.manage === "synced") add("claudeai", tx("Da sua conta claude.ai"), tx("Sincronizadas do site claude.ai. Para tirar, use o site."), key, i.alwaysTokens);
    else if (p && (count.get(p) ?? 0) >= 3) add(`x:${p}`, pretty(p), tx("Têm o mesmo começo de nome (\"{p}-\"), então provavelmente vieram juntas do mesmo lugar.", { p }), key, i.alwaysTokens);
    else add("soltas", tx("Instaladas uma a uma"), tx("Cada uma foi colocada sozinha na pasta da conta. Valem em todos os projetos."), key, i.alwaysTokens);
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
        <span class="inv-weight">{tx("~{v} tokens fixos", { v: fmtTokens(props.f.tokens) })}</span>
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
          <Show when={r().note && !r().actions.length}><button class="inv-how" onClick={props.onToggle}>{tx("como tirar?")}</button></Show>
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
                      <button class="ghost-btn small" onClick={() => props.onRead(item()!)}><BookOpen size={12} /> {tx("Ler o que ela diz")}</button>
                    </Show>
                    <button class="ghost-btn small" onClick={() => api.reveal(path!).catch((e) => showToast(String(e)))}><FolderOpen size={12} /> {tx("Mostrar a pasta")}</button>
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
