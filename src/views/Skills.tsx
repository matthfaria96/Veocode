import { AlertTriangle, ChevronDown, ChevronRight, FolderOpen, Package, RefreshCw, Search, User, X } from "lucide-solid";
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { api, isTauri, prettyPath } from "../api";
import { accountById, accts } from "../accounts";
import { projects, showToast } from "../store";
import { kindLabel, loadSkills, readSkillFile, sk, type Item, type Kind, type PluginInfo } from "../skills";
import { PageHeader } from "../components/ui";
import { FolderIcon } from "../components/icons";

const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Filter = "tudo" | Kind;
const filters: { id: Filter; label: string }[] = [
  { id: "tudo", label: "Tudo" },
  { id: "skill", label: "Skills" },
  { id: "command", label: "Comandos" },
  { id: "agent", label: "Agentes" },
  { id: "mcp", label: "MCP" },
];

export default function Skills() {
  const [filter, setFilter] = createSignal<Filter>("tudo");
  const [q, setQ] = createSignal("");
  const [open, setOpen] = createSignal<Item | null>(null);
  const [openPlugins, setOpenPlugins] = createSignal<Record<string, boolean>>({});

  onMount(() => !sk.loaded && loadSkills());
  // o macOS pode segurar a leitura até a pessoa liberar a pasta Documentos (pedido de permissão)
  const [slow, setSlow] = createSignal(false);
  createEffect(() => {
    if (!sk.loading) return setSlow(false);
    const t = setTimeout(() => setSlow(true), 3000);
    onCleanup(() => clearTimeout(t));
  });

  const match = (i: Item) => {
    if (filter() !== "tudo" && i.kind !== filter()) return false;
    const s = q().trim().toLowerCase();
    return !s || i.name.toLowerCase().includes(s) || i.description.toLowerCase().includes(s) || (i.plugin ?? "").toLowerCase().includes(s);
  };
  const visible = createMemo(() => sk.items.filter(match));
  const count = (k: Filter) => (k === "tudo" ? sk.items.length : sk.items.filter((i) => i.kind === k).length);

  const claudeAccounts = () => accts.list.filter((a) => a.provider === "claude");
  const otherAccounts = () => accts.list.filter((a) => a.provider !== "claude");
  const byAccount = (id: string) => visible().filter((i) => i.layer === "conta" && i.accounts.includes(id));
  const pluginItems = (p: PluginInfo) => visible().filter((i) => i.layer === "plugin" && i.plugin === p.name && i.accounts.includes(p.account));
  const projectGroups = createMemo(() => {
    const groups = new Map<string, Item[]>();
    for (const i of visible().filter((i) => i.layer === "projeto")) {
      const k = i.project ?? "?";
      groups.set(k, [...(groups.get(k) ?? []), i]);
    }
    const known = new Set(projects.map((p) => p.path));
    return [...groups.entries()].sort((a, b) => Number(known.has(b[0])) - Number(known.has(a[0])) || a[0].localeCompare(b[0])).map(([path, items]) => ({ path, items, known: known.has(path) }));
  });
  const togglePlugin = (id: string) => setOpenPlugins((o) => ({ ...o, [id]: !o[id] }));
  const searching = () => q().trim().length > 0;
  // com busca ou filtro de tipo, só aparecem os plugins que têm algo que bate
  const shownPlugins = createMemo(() => (searching() || filter() !== "tudo" ? sk.plugins.filter((p) => pluginItems(p).length) : sk.plugins));

  return (
    <div class="page">
      <PageHeader
        title="Skills e MCP"
        subtitle={isTauri ? "O que cada conta do Claude sabe fazer além do básico e de onde isso vem. Lido das pastas do Claude Code." : "Modo navegador: exemplo. Abra pelo app para ver as suas."}
        actions={
          <button class="ghost-btn" onClick={loadSkills}>
            <RefreshCw size={14} classList={{ spinning: sk.loading }} /> Atualizar
          </button>
        }
      />

      <div class="skills-bar">
        <div class="who-filter">
          <For each={filters}>
            {(f) => (
              <button classList={{ active: filter() === f.id }} onClick={() => setFilter(f.id)}>
                {f.label} <small class="count">{sk.loaded ? count(f.id) : "…"}</small>
              </button>
            )}
          </For>
        </div>
        <label class="search-box">
          <Search size={13} />
          <input placeholder="Buscar por nome ou descrição…" value={q()} onInput={(e) => setQ(e.currentTarget.value)} />
          <Show when={q()}><button class="icon-btn tiny visible" onClick={() => setQ("")}><X size={11} /></button></Show>
        </label>
      </div>

      <Show when={slow()}>
        <p class="acc-detail slow-note">Demorando mais que o normal. Se o sistema perguntou se o Veocode pode acessar uma pasta (como Documentos), é ele esperando a sua resposta: plugins e servidores MCP às vezes ficam lá.</p>
      </Show>
      <Show when={sk.loaded} fallback={<div class="loading-rows"><div /><div /><div /></div>}>
        <div class="scope-cols">
          {/* ---------------- conta */}
          <Column icon={<User size={15} />} title="Da conta" hint="pastas skills/, commands/, agents/ e MCP de cada conta" arrow>
            <For each={claudeAccounts()} fallback={<div class="scope-empty">Nenhuma conta do Claude</div>}>
              {(a) => (
                <div class="group" style={{ "--c": a.color }}>
                  <div class="group-head">
                    <span class="account-dot" />
                    <strong>{a.label}</strong>
                    <small>{byAccount(a.id).length}</small>
                  </div>
                  <For each={byAccount(a.id)} fallback={<div class="scope-empty small">{searching() ? "Nada com esse filtro" : "Nada instalado nesta conta"}</div>}>
                    {(i) => <Card i={i} onOpen={setOpen} />}
                  </For>
                </div>
              )}
            </For>
            <Show when={otherAccounts().length}>
              <p class="foot-note">{otherAccounts().map((a) => a.label).join(", ")}: skills e MCP são do Claude Code. As outras IAs vão usar os do Veocode numa próxima fase.</p>
            </Show>
          </Column>

          {/* ---------------- plugins */}
          <Column icon={<Package size={15} />} title="Plugins" hint="pacotes instalados que trazem skills e MCP" arrow>
            <For each={shownPlugins()} fallback={<div class="scope-empty">{sk.plugins.length ? "Nada com esse filtro" : "Nenhum plugin instalado"}</div>}>
              {(p) => (
                <div class="plugin-card" classList={{ off: !p.enabled }} style={{ "--c": accountById(p.account).color }}>
                  <button class="plugin-head" onClick={() => togglePlugin(p.id)}>
                    {openPlugins()[p.id] || searching() ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <div>
                      <strong>{p.name} <Show when={p.version}><small>v{p.version}</small></Show></strong>
                      <small>{p.description}</small>
                    </div>
                    <span class="status-tag" classList={{ instalado: p.enabled, ausente: !p.enabled }}>{p.enabled ? "ativo" : "desligado"}</span>
                  </button>
                  <div class="plugin-meta">
                    <span class="account-dot" title={accountById(p.account).label} />
                    <span>{p.skills} skills · {p.mcp} MCP</span>
                    <Show when={p.project}><span class="proj-chip" title={p.project!}>só em {base(p.project!)}</span></Show>
                    <Show when={p.path && isTauri}>
                      <button class="icon-btn small" title={`Mostrar pasta: ${prettyPath(p.path)}`} onClick={() => api.reveal(p.path).catch((e) => showToast(errMsg(e)))}><FolderOpen size={12} /></button>
                    </Show>
                  </div>
                  <Show when={openPlugins()[p.id] || searching()}>
                    <div class="plugin-items">
                      <For each={pluginItems(p)} fallback={<div class="scope-empty small">Nada com esse filtro</div>}>
                        {(i) => <Card i={i} onOpen={setOpen} compact />}
                      </For>
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </Column>

          {/* ---------------- projetos */}
          <Column icon={<FolderOpen size={15} />} title="Do projeto" hint=".claude/ e .mcp.json dentro da pasta, e MCP que a conta guardou para ela">
            <For each={projectGroups()} fallback={<div class="scope-empty">{searching() ? "Nada com esse filtro" : "Nenhum projeto com skills ou MCP próprios"}</div>}>
              {(g) => (
                <div class="group">
                  <div class="group-head">
                    <FolderIcon name={base(g.path)} size={12} />
                    <strong title={g.path}>{base(g.path)}</strong>
                    <Show when={!g.known}><small class="muted" title="Pasta que não está entre os projetos do Veocode">fora do Veocode</small></Show>
                    <small>{g.items.length}</small>
                  </div>
                  <For each={g.items}>{(i) => <Card i={i} onOpen={setOpen} />}</For>
                </div>
              )}
            </For>
          </Column>
        </div>
      </Show>

      <Show when={open()}>{(i) => <Detail i={i()} onClose={() => setOpen(null)} />}</Show>
    </div>
  );
}

function Column(props: { icon: JSX.Element; title: string; hint: string; arrow?: boolean; children: JSX.Element }) {
  return (
    <div class="scope-col stagger">
      <div class="scope-head">
        {props.icon}
        <div>
          <strong>{props.title}</strong>
          <small>{props.hint}</small>
        </div>
        {props.arrow && <ChevronRight size={16} class="scope-arrow" />}
      </div>
      {props.children}
    </div>
  );
}

function McpStatus(props: { i: Item }) {
  const m = () => props.i.mcp!;
  return (
    <Show when={m().found === false} fallback={<span class="mcp-tag">{m().transport}</span>}>
      <span class="mcp-tag bad" title="O programa que este servidor precisa não existe nesta máquina: ele vai falhar ao conectar">
        <AlertTriangle size={10} /> programa não encontrado
      </span>
    </Show>
  );
}

function Card(props: { i: Item; onOpen: (i: Item) => void; compact?: boolean }) {
  const i = () => props.i;
  return (
    <button class="skill-card pop-in" classList={{ off: !i().enabled, compact: props.compact }} onClick={() => props.onOpen(i())}>
      <div class="skill-top">
        <span class={`kind-badge ${i().kind}`}>{kindLabel[i().kind]}</span>
        <strong title={i().name}>{i().name}</strong>
        <Show when={i().mcp}><McpStatus i={i()} /></Show>
      </div>
      <Show when={!props.compact || i().kind === "mcp"}>
        <p>{i().description || "Sem descrição"}</p>
      </Show>
      <Show when={i().origin || (i().layer === "projeto" && i().accounts.length)}>
        <div class="skill-foot">
          <small>{i().origin ?? ""}</small>
          <span class="used-by">
            <For each={i().accounts}>{(id) => <span class="account-dot" style={{ "--c": accountById(id).color }} title={accountById(id).label} />}</For>
          </span>
        </div>
      </Show>
    </button>
  );
}

function Detail(props: { i: Item; onClose: () => void }) {
  const i = () => props.i;
  const isMd = () => !!i().path?.endsWith(".md");
  const [text] = createResource(() => (isMd() ? i().path : null), (p) => readSkillFile(p!).catch((e) => `Não deu para ler: ${errMsg(e)}`));
  return (
    <div class="palette-backdrop" onClick={props.onClose} onKeyDown={(e) => e.key === "Escape" && props.onClose()} tabIndex={-1} ref={(el) => requestAnimationFrame(() => el.focus())}>
      <div class="dialog wide detail" onClick={(e) => e.stopPropagation()}>
        <div class="detail-head">
          <span class={`kind-badge ${i().kind}`}>{kindLabel[i().kind]}</span>
          <h3>{i().name}</h3>
          <button class="icon-btn" title="Fechar" onClick={props.onClose}><X size={14} /></button>
        </div>
        <p class="detail-desc">{i().description}</p>
        <dl class="acc-facts detail-facts">
          <dt>Camada</dt>
          <dd>{i().layer === "conta" ? "da conta" : i().layer === "plugin" ? `plugin ${i().plugin}` : `projeto ${base(i().project ?? "")}`}</dd>
          <Show when={i().origin}><dt>Origem</dt><dd>{i().origin}</dd></Show>
          <dt>Contas</dt>
          <dd>{i().accounts.map((id) => accountById(id).label).join(", ") || "—"}</dd>
          <Show when={i().mcp}>
            {(m) => (
              <>
                <dt>Transporte</dt><dd>{m().transport}</dd>
                <Show when={m().command}><dt>Comando</dt><dd class="mono-dd" title={m().command!}>{prettyPath(m().command!)} {m().args.join(" ")}</dd></Show>
                <Show when={m().url}><dt>Endereço</dt><dd class="mono-dd">{m().url}</dd></Show>
                <Show when={m().found !== null}><dt>Programa</dt><dd classList={{ bad: m().found === false }}>{m().found ? "encontrado" : "não existe nesta máquina"}</dd></Show>
                <Show when={m().envNames.length}><dt>Variáveis</dt><dd><For each={m().envNames}>{(n) => <code class="env-chip">{n}</code>}</For></dd></Show>
                <Show when={m().headerNames.length}><dt>Cabeçalhos</dt><dd><For each={m().headerNames}>{(n) => <code class="env-chip">{n}</code>}</For></dd></Show>
              </>
            )}
          </Show>
        </dl>
        <Show when={i().mcp && (i().mcp!.envNames.length || i().mcp!.headerNames.length)}>
          <p class="foot-note">Os valores das variáveis e cabeçalhos costumam ser chaves e não são mostrados.</p>
        </Show>
        <Show when={isMd()}>
          <pre class="skill-text">{text.loading ? "Carregando…" : text()}</pre>
        </Show>
        <Show when={i().path && isTauri}>
          <div class="dialog-actions">
            <code class="detail-path" title={i().path!}>{prettyPath(i().path!)}</code>
            <button class="ghost-btn small" onClick={() => api.reveal(i().path!).catch((e) => showToast(errMsg(e)))}><FolderOpen size={12} /> Mostrar na pasta</button>
          </div>
        </Show>
      </div>
    </div>
  );
}
