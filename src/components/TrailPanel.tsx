// Aba "Rastro" do projeto: o que a IA deixou por causa dele, dentro e fora da pasta.
// Mostra só o que tem coisa para ver ou fazer: sobras para limpar, pastas fora do projeto,
// o que ficou instalado no computador e o que a IA consultou.
import { Box, ChevronDown, ChevronRight, Copy, ExternalLink, EyeOff, FileWarning, FolderInput, FolderOpen, FolderPlus, Globe, HardDrive, Link2, Plug, RefreshCw, Search, ShieldCheck, Trash2 } from "lucide-solid";
import { createEffect, createMemo, createResource, createSignal, For, on, Show, Suspense, type JSX } from "solid-js";
import { api, copyText, isTauri, prettyPath, type Trail, type TrailLeftover, type TrailSource } from "../api";
import { since } from "../git";
import { formatBytes } from "../data/mock";
import { absPathOf, addProjectPath, currentProject, setView, showToast } from "../store";
import { loadInstalls, xray } from "../xray";
import { confirmAction } from "../dialogs";
import { markOwn } from "../editing";

const ago = (ms: number) => (ms ? since(ms / 1000) : "");
const inside = (path: string, root: string | null | undefined) => {
  if (!root) return false;
  const p = path.replace(/\\/g, "/").replace(/\/$/, "");
  const r = root.replace(/\\/g, "/").replace(/\/$/, "");
  return p === r || p.startsWith(r + "/");
};

const kindInfo: Record<TrailLeftover["kind"], { label: string; hint: string }> = {
  temporario: { label: "Temporários", hint: "Refeitos sozinhos quando precisa. Pode tirar sem medo." },
  depuracao: { label: "Logs de depuração", hint: "Serviram para investigar um erro; depois podem sair." },
  copia: { label: "Cópias e versões antigas", hint: ".bak, .old, “cópia”… confira antes de tirar." },
  ia: { label: "Criados pela IA, fora do git", hint: "Guarde no git o que for útil; o resto pode sair." },
};
const kindOrder = ["temporario", "depuracao", "copia", "ia"] as const;
const sourceIcon = (k: TrailSource["kind"]) => (k === "pagina" ? <Globe size={13} /> : k === "busca" ? <Search size={13} /> : <Plug size={13} />);

export default function TrailPanel() {
  const p = currentProject;
  const real = () => isTauri && !p().demo;
  return (
    <div class="trail">
      <Show when={real()} fallback={<p class="trail-empty-box">{p().demo ? "O projeto de exemplo não tem rastro. Adicione uma pasta sua para ver o que as IAs deixaram nela." : "Abra pelo app para ver o rastro do projeto."}</p>}>
        {/* fronteira própria: carregar o rastro não pode recarregar a tela do projeto inteira */}
        <Suspense fallback={<div class="loading-rows"><div /><div /><div /></div>}>
          <TrailBody />
        </Suspense>
      </Show>
    </div>
  );
}

function TrailBody() {
  const p = currentProject;
  const [trail, { refetch }] = createResource(() => p().id, (id) => api.projectTrail(id));
  createEffect(on(() => p().id, () => !xray.installs && void loadInstalls()));
  const root = () => absPathOf(p().id);
  const installs = createMemo(() => (xray.installs?.aiInstalls ?? []).filter((i) => inside(i.project, root()) && i.status === "instalado"));
  const t = () => trail.latest as Trail | undefined;
  const [allSources, setAllSources] = createSignal(false);
  const sources = () => [...(t()?.sources ?? [])].sort((a, b) => b.last - a.last);

  const link = async () => {
    const path = await api.pickFolder();
    if (!path) return;
    await api.trailLink(p().id, path).catch((e) => showToast(String(e)));
    showToast("Pasta ligada a este projeto");
    void refetch();
  };
  const forget = async (path: string) => {
    const ok = await confirmAction("Tirar esta pasta do Rastro?", `${prettyPath(path)} continua no computador, só deixa de aparecer aqui.`, "Tirar do Rastro");
    if (!ok) return;
    await api.trailForget(p().id, path).catch((e) => showToast(String(e)));
    void refetch();
  };
  const trash = async (items: TrailLeftover[]) => {
    const size = formatBytes(items.reduce((s, l) => s + l.bytes, 0));
    const ok = await confirmAction(
      items.length === 1 ? `Mover ${items[0].path} para a Lixeira?` : `Mover ${items.length} itens para a Lixeira?`,
      `${size} no total. Dá para recuperar pela Lixeira.`,
      "Mover para a Lixeira",
      true,
    );
    if (!ok) return;
    let fail = 0;
    for (const l of items) {
      markOwn(p().id, l.path);
      await api.trashEntry(p().id, l.path).catch(() => fail++);
    }
    showToast(fail ? `${items.length - fail} foram para a Lixeira; ${fail} não deu.` : `Pronto: ${size} foram para a Lixeira.`);
    void refetch();
  };

  const nothing = () => {
    const x = t();
    return !!x && !x.outside.length && !x.leftovers.length && !x.models.length && !installs().length && !x.sources.length;
  };

  return (
    <Show when={t()}>
      {(x) => (
        <>
          <div class="trail-head">
            <span>O que a IA deixou por causa deste projeto</span>
            <button class="icon-btn small" title="Ler de novo" onClick={() => void refetch()}><RefreshCw size={13} classList={{ spinning: trail.loading }} /></button>
          </div>
          <div class="trail-sum">
            <Stat icon={<FileWarning size={14} />} n={x().leftovers.length} label="sobras" sub={x().leftovers.length ? formatBytes(x().leftoversBytes) : "pasta limpa"} tone={x().leftovers.length ? "warn" : "ok"} />
            <Stat icon={<FolderInput size={14} />} n={x().outside.length} label="pastas fora" sub="ligadas ao projeto" />
            <Stat icon={<HardDrive size={14} />} n={installs().length + x().models.length} label="instalados" sub="no computador" />
            <Stat icon={<Globe size={14} />} n={x().sources.length} label="consultas" sub="sites e conexões" />
          </div>

          <Show when={nothing()}>
            <div class="trail-empty-box">
              <ShieldCheck size={22} />
              <strong>Nada para cuidar aqui</strong>
              <span>A IA não deixou sobras nem mexeu fora da pasta deste projeto.</span>
            </div>
          </Show>

          {/* ---------------- sobras: o que dá para limpar já */}
          <Show when={x().leftovers.length}>
            <Block icon={<FileWarning size={14} />} title="Sobras para limpar" count={x().leftovers.length} right={<span class="trail-size">{formatBytes(x().leftoversBytes)}</span>}>
              <For each={kindOrder.filter((k) => x().leftovers.some((l) => l.kind === k))}>
                {(k) => <LeftoverGroup kind={k} items={x().leftovers.filter((l) => l.kind === k)} onTrash={(items) => void trash(items)} />}
              </For>
            </Block>
          </Show>

          {/* ---------------- fora da pasta */}
          <Show when={x().outside.length}>
            <Block icon={<FolderInput size={14} />} title="Pastas fora do projeto" count={x().outside.length}>
              <For each={x().outside}>
                {(o) => (
                  <div class="trail-row" classList={{ gone: !o.exists }}>
                    <FolderOpen size={14} class="trail-row-icon" />
                    <div class="trail-row-text">
                      <strong title={o.path}>{prettyPath(o.path)}</strong>
                      <small title={o.how}>{o.exists ? `${formatBytes(o.bytes)}${o.isDir ? ` · ${o.files.toLocaleString("pt-BR")} arquivos` : ""}` : "não existe mais"}{o.last ? ` · ${ago(o.last)}` : ""}</small>
                    </div>
                    <div class="trail-actions">
                      <Show when={o.exists}>
                        <button class="icon-btn small" title="Mostrar no Finder" onClick={() => api.reveal(o.path).catch((e) => showToast(String(e)))}><FolderOpen size={12} /></button>
                        <Show when={o.isDir}><button class="icon-btn small" title="Abrir como projeto" onClick={() => void addProjectPath(o.path)}><FolderPlus size={12} /></button></Show>
                      </Show>
                      <button class="icon-btn small" title="Tirar do Rastro (não apaga nada)" onClick={() => void forget(o.path)}><EyeOff size={12} /></button>
                    </div>
                  </div>
                )}
              </For>
            </Block>
          </Show>

          {/* ---------------- no computador */}
          <Show when={installs().length || x().models.length}>
            <Block icon={<HardDrive size={14} />} title="Instalado no computador" count={installs().length + x().models.length} right={<button class="git-link" onClick={() => setView("system")}>Ver no Computador</button>}>
              <For each={x().models}>
                {(m) => (
                  <div class="trail-row">
                    <Box size={14} class="trail-row-icon" />
                    <div class="trail-row-text">
                      <strong>{m.name}</strong>
                      <small>modelo de IA ({m.tool === "ollama" ? "Ollama" : m.tool === "huggingface" ? "Hugging Face" : "LM Studio"}){m.last ? ` · ${ago(m.last)}` : ""}</small>
                    </div>
                  </div>
                )}
              </For>
              <For each={installs()}>
                {(i) => (
                  <div class="trail-row">
                    <Box size={14} class="trail-row-icon" />
                    <div class="trail-row-text">
                      <strong>{i.package}</strong>
                      <small>{i.manager}{i.version ? ` · ${i.version}` : ""}</small>
                    </div>
                    <button class="icon-btn small" title={`Copiar o comando para remover: ${i.removeCmd}`} onClick={() => copyText(i.removeCmd).then(() => showToast("Comando copiado: cole no Terminal para remover"))}><Copy size={12} /></button>
                  </div>
                )}
              </For>
            </Block>
          </Show>

          {/* ---------------- consultas */}
          <Show when={x().sources.length}>
            <Block icon={<Globe size={14} />} title="O que a IA consultou" count={x().sources.length}>
              <For each={allSources() ? sources() : sources().slice(0, 6)}>
                {(s) => (
                  <div class="trail-row trail-src">
                    <span class="trail-row-icon">{sourceIcon(s.kind)}</span>
                    <div class="trail-row-text">
                      <strong title={s.examples.join("\n") || s.label}>{s.kind === "busca" ? `“${s.label}”` : s.label}</strong>
                      <small>{s.kind === "pagina" ? "site" : s.kind === "busca" ? "busca" : "conexão"}{s.last ? ` · ${ago(s.last)}` : ""}</small>
                    </div>
                    <span class="trail-times">{s.count}×</span>
                    <Show when={s.kind === "pagina" && s.examples[0]}>
                      <button class="icon-btn small" title={`Abrir ${s.examples[0]}`} onClick={() => void api.openUrl(s.examples[0])}><ExternalLink size={12} /></button>
                    </Show>
                  </div>
                )}
              </For>
              <Show when={sources().length > 6}>
                <button class="git-link trail-more" onClick={() => setAllSources(!allSources())}>{allSources() ? "Mostrar menos" : `Mostrar todas (${sources().length})`}</button>
              </Show>
            </Block>
          </Show>

          <button class="trail-link" onClick={() => void link()}>
            <Link2 size={13} /> A IA criou algo em outra pasta? <strong>Ligar uma pasta</strong>
          </button>
        </>
      )}
    </Show>
  );
}

function Stat(props: { icon: JSX.Element; n: number; label: string; sub: string; tone?: "ok" | "warn" }) {
  return (
    <div class="trail-stat" classList={{ zero: !props.n, [props.tone ?? ""]: !!props.tone }}>
      <span class="trail-stat-icon">{props.icon}</span>
      <span class="trail-stat-text">
        <span><strong>{props.n}</strong> {props.label}</span>
        <small>{props.sub}</small>
      </span>
    </div>
  );
}

function Block(props: { icon: JSX.Element; title: string; count: number; right?: JSX.Element; children: JSX.Element }) {
  return (
    <section class="trail-block">
      <header>
        <span class="trail-block-icon">{props.icon}</span>
        <strong>{props.title}</strong>
        <small class="count">{props.count}</small>
        <span class="trail-block-right">{props.right}</span>
      </header>
      {props.children}
    </section>
  );
}

function LeftoverGroup(props: { kind: TrailLeftover["kind"]; items: TrailLeftover[]; onTrash: (items: TrailLeftover[]) => void }) {
  const [open, setOpen] = createSignal(false);
  const [all, setAll] = createSignal(false);
  const total = () => props.items.reduce((s, l) => s + l.bytes, 0);
  const shown = () => (all() ? props.items : props.items.slice(0, 12));
  const pid = () => currentProject().id;
  return (
    <div class="trail-group">
      <div class="trail-group-head">
        <button class="trail-group-toggle" onClick={() => setOpen(!open())} title={kindInfo[props.kind].hint}>
          {open() ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <strong>{kindInfo[props.kind].label}</strong>
          <small class="count">{props.items.length}</small>
          <span class="trail-group-size">{formatBytes(total())}</span>
        </button>
        <button class="trail-trash-all" title={`Mover os ${props.items.length} para a Lixeira`} onClick={() => props.onTrash(props.items)}><Trash2 size={12} /> Limpar</button>
      </div>
      <Show when={open()}>
        <p class="trail-hint">{kindInfo[props.kind].hint}</p>
        <For each={shown()}>
          {(l) => (
            <div class="trail-row small">
              <div class="trail-row-text">
                <strong title={l.path}>{l.path}{l.isDir ? "/" : ""}</strong>
                <small>{formatBytes(l.bytes)}{l.modified ? ` · ${ago(l.modified)}` : ""}</small>
              </div>
              <div class="trail-actions">
                <button class="icon-btn small" title="Mostrar no Finder" onClick={() => { const r = absPathOf(pid()); if (r) api.reveal(`${r}/${l.path}`).catch((e) => showToast(String(e))); }}><FolderOpen size={12} /></button>
                <button class="icon-btn small danger" title="Mover para a Lixeira" onClick={() => props.onTrash([l])}><Trash2 size={12} /></button>
              </div>
            </div>
          )}
        </For>
        <Show when={props.items.length > 12 && !all()}>
          <button class="git-link" onClick={() => setAll(true)}>Mostrar todos ({props.items.length})</button>
        </Show>
      </Show>
    </div>
  );
}
