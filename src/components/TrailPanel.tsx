// Aba "Rastro" do projeto: o que a IA deixou por causa dele, dentro e fora da pasta.
// - Pastas fora do projeto (ex.: um "studio" do jogo criado ao lado), guardadas pelo Veocode
//   para o vínculo não sumir quando o Claude apagar conversas antigas;
// - sobras dentro da pasta (depuração, cópias, temporários, arquivos da IA fora do git);
// - o que foi instalado no computador por causa do projeto (pacotes e modelos de IA locais);
// - sites, buscas e conexões que a IA consultou.
import { Box, ChevronDown, ChevronRight, Copy, ExternalLink, EyeOff, FileWarning, FolderInput, FolderOpen, FolderPlus, Globe, HardDrive, Link2, Plug, RefreshCw, Search, Trash2 } from "lucide-solid";
import { createEffect, createMemo, createResource, createSignal, For, on, Show, type JSX } from "solid-js";
import { api, copyText, isTauri, prettyPath, type TrailLeftover } from "../api";
import { since } from "../git";
import { formatBytes } from "../data/mock";
import { absPathOf, addProjectPath, currentProject, showToast } from "../store";
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
  depuracao: { label: "Registros de depuração", hint: "Arquivos de log e de erro. Servem para investigar um problema; depois podem sair." },
  copia: { label: "Cópias e versões antigas", hint: "Arquivos .bak, .old, “cópia”… Confira se não precisa mais antes de tirar." },
  temporario: { label: "Temporários", hint: "São refeitos sozinhos quando precisa. Pode tirar sem medo." },
  ia: { label: "Criados pela IA e fora do git", hint: "A IA criou e ninguém guardou no git ainda. Podem ser úteis (guarde) ou rascunhos (tire)." },
};

export default function TrailPanel() {
  const p = currentProject;
  const real = () => isTauri && !p().demo;
  const [trail, { refetch }] = createResource(() => (real() ? p().id : null), (id) => api.projectTrail(id));
  createEffect(on(() => p().id, () => real() && !xray.installs && void loadInstalls()));

  const root = () => absPathOf(p().id);
  const installs = createMemo(() => (xray.installs?.aiInstalls ?? []).filter((i) => inside(i.project, root())));

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
  const openAsProject = (path: string) => void addProjectPath(path);
  const trashLeftover = async (l: TrailLeftover) => {
    const ok = await confirmAction(`Mover ${l.path} para a Lixeira?`, `${l.why}. ${formatBytes(l.bytes)}. Dá para recuperar pela Lixeira.`, "Mover para a Lixeira", true);
    if (!ok) return;
    markOwn(p().id, l.path);
    await api.trashEntry(p().id, l.path).then(() => showToast("Pronto, foi para a Lixeira. Dá para recuperar lá.")).catch((e) => showToast(String(e)));
    void refetch();
  };

  return (
    <div class="trail">
      <Show when={real()} fallback={<p class="trail-intro">{p().demo ? "O projeto de exemplo não tem rastro: adicione uma pasta sua para ver o que as IAs deixaram nela." : "Abra pelo app para ver o rastro do projeto."}</p>}>
        <div class="trail-top">
          <p class="trail-intro">O que a IA deixou por causa deste projeto: <strong>fora da pasta</strong>, <strong>dentro dela</strong> e <strong>no computador</strong>. Nada aqui é apagado sem você confirmar.</p>
          <button class="icon-btn small" title="Ler de novo" onClick={() => void refetch()}><RefreshCw size={13} classList={{ spinning: trail.loading }} /></button>
        </div>

        <Show when={trail()} fallback={<Show when={trail.error} fallback={<div class="loading-rows"><div /><div /></div>}><p class="trail-empty">Não deu para ler: {String(trail.error)}</p></Show>}>
          {(t) => (
            <>
              <Show when={t().sessions === 0}>
                <p class="trail-note">Nenhuma conversa do Claude guardada para esta pasta (ele apaga as antigas sozinho). O que o Veocode já achou antes continua aqui; o que vier daqui em diante também fica guardado.</p>
              </Show>

              {/* ---------------- fora da pasta */}
              <Block icon={<FolderInput size={14} />} title="Pastas fora do projeto" count={t().outside.length} hint="Criadas ou mexidas pela IA por causa deste projeto, mas fora da pasta dele. O Veocode guarda o vínculo." right={<button class="git-link" onClick={() => void link()}><Link2 size={11} /> Ligar uma pasta</button>}>
                <For each={t().outside} fallback={<p class="trail-empty">Nada fora da pasta. Se a IA criou algo em outro lugar (como um editor do jogo), use “Ligar uma pasta” para não perder de vista.</p>}>
                  {(o) => (
                    <div class="trail-row" classList={{ gone: !o.exists }}>
                      <FolderOpen size={14} class="trail-row-icon" />
                      <div class="trail-row-text">
                        <strong title={o.path}>{prettyPath(o.path)}</strong>
                        <small>{o.exists ? `${formatBytes(o.bytes)}${o.isDir ? ` · ${o.files.toLocaleString("pt-BR")} arquivos` : ""}` : "não existe mais"}{o.last ? ` · ${ago(o.last)}` : ""}</small>
                        <small class="trail-how" title={o.how}>{o.how}</small>
                      </div>
                      <div class="trail-actions">
                        <Show when={o.exists}>
                          <button class="icon-btn small" title="Mostrar no Finder/Explorer" onClick={() => api.reveal(o.path).catch((e) => showToast(String(e)))}><FolderOpen size={12} /></button>
                          <Show when={o.isDir}><button class="icon-btn small" title="Abrir como projeto no Veocode" onClick={() => openAsProject(o.path)}><FolderPlus size={12} /></button></Show>
                        </Show>
                        <button class="icon-btn small" title="Tirar do Rastro (não apaga nada)" onClick={() => void forget(o.path)}><EyeOff size={12} /></button>
                      </div>
                    </div>
                  )}
                </For>
              </Block>

              {/* ---------------- sobras */}
              <Block icon={<FileWarning size={14} />} title="Sobras dentro da pasta" count={t().leftovers.length} hint={t().leftovers.length ? `${formatBytes(t().leftoversBytes)} em depuração, cópias, temporários e arquivos soltos da IA.` : "Depuração, cópias antigas, temporários e arquivos que a IA criou e ninguém guardou."}>
                <Show when={t().leftovers.length} fallback={<p class="trail-empty">Pasta limpa: nenhuma sobra encontrada.</p>}>
                  <For each={(["ia", "depuracao", "copia", "temporario"] as const).filter((k) => t().leftovers.some((l) => l.kind === k))}>
                    {(k) => <LeftoverGroup kind={k} items={t().leftovers.filter((l) => l.kind === k)} onTrash={trashLeftover} />}
                  </For>
                </Show>
              </Block>

              {/* ---------------- no computador */}
              <Block icon={<HardDrive size={14} />} title="Instalado no computador" count={installs().length + t().models.length} hint="Programas e modelos de IA que ficaram no computador todo, mas foram pedidos por este projeto.">
                <Show when={installs().length || t().models.length} fallback={<p class="trail-empty">Nada instalado por este projeto (pelo que os históricos mostram).</p>}>
                  <For each={t().models}>
                    {(m) => (
                      <div class="trail-row">
                        <Box size={14} class="trail-row-icon" />
                        <div class="trail-row-text">
                          <strong>{m.name}</strong>
                          <small>modelo de IA local ({m.tool === "ollama" ? "Ollama" : m.tool === "huggingface" ? "Hugging Face" : "LM Studio"}){m.last ? ` · ${ago(m.last)}` : ""}</small>
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
                          <small>{i.manager} · {i.status === "instalado" ? `instalado${i.version ? " " + i.version : ""}` : i.status === "falhou" ? "tentou e falhou" : "não está mais"}</small>
                        </div>
                        <Show when={i.status === "instalado"}>
                          <button class="icon-btn small" title={`Copiar o comando para remover: ${i.removeCmd}`} onClick={() => copyText(i.removeCmd).then(() => showToast("Comando copiado: cole no Terminal se quiser remover"))}><Copy size={12} /></button>
                        </Show>
                      </div>
                    )}
                  </For>
                </Show>
                <p class="trail-foot">Máquinas virtuais, containers e o espaço de tudo isso: Computador → Espaço e memória.</p>
              </Block>

              {/* ---------------- fontes */}
              <Block icon={<Globe size={14} />} title="Sites, buscas e conexões" count={t().sources.length} hint="Lugares de fora que a IA consultou trabalhando aqui.">
                <For each={t().sources} fallback={<p class="trail-empty">Nenhuma consulta de fora.</p>}>
                  {(s) => (
                    <div class="trail-row">
                      <span class="trail-row-icon">{s.kind === "pagina" ? <Globe size={14} /> : s.kind === "busca" ? <Search size={14} /> : <Plug size={14} />}</span>
                      <div class="trail-row-text">
                        <strong title={s.label}>{s.kind === "busca" ? `“${s.label}”` : s.label}</strong>
                        <small>{s.kind === "pagina" ? "site" : s.kind === "busca" ? "busca na internet" : `conexão (${s.examples.slice(0, 3).join(", ")})`} · {s.count}× {s.last ? `· ${ago(s.last)}` : ""}</small>
                      </div>
                      <Show when={s.kind === "pagina" && s.examples[0]}>
                        <button class="icon-btn small" title={`Abrir ${s.examples[0]}`} onClick={() => void api.openUrl(s.examples[0])}><ExternalLink size={12} /></button>
                      </Show>
                    </div>
                  )}
                </For>
              </Block>
            </>
          )}
        </Show>
      </Show>
    </div>
  );
}

function Block(props: { icon: JSX.Element; title: string; count: number; hint: string; right?: JSX.Element; children: JSX.Element }) {
  return (
    <section class="trail-block">
      <header>
        <span class="trail-block-icon">{props.icon}</span>
        <strong>{props.title}</strong>
        <small class="count">{props.count}</small>
        <span class="trail-block-right">{props.right}</span>
      </header>
      <p class="trail-hint">{props.hint}</p>
      {props.children}
    </section>
  );
}

function LeftoverGroup(props: { kind: TrailLeftover["kind"]; items: TrailLeftover[]; onTrash: (l: TrailLeftover) => void }) {
  const [open, setOpen] = createSignal(false);
  const [all, setAll] = createSignal(false);
  const total = () => props.items.reduce((s, l) => s + l.bytes, 0);
  const shown = () => (all() ? props.items : props.items.slice(0, 12));
  const pid = () => currentProject().id;
  return (
    <div class="trail-group">
      <button class="trail-group-head" onClick={() => setOpen(!open())}>
        {open() ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <strong>{kindInfo[props.kind].label}</strong>
        <small class="count">{props.items.length}</small>
        <span class="trail-group-size">{formatBytes(total())}</span>
      </button>
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
                <button class="icon-btn small" title="Mostrar no Finder/Explorer" onClick={() => { const r = absPathOf(pid()); if (r) api.reveal(`${r}/${l.path}`).catch((e) => showToast(String(e))); }}><FolderOpen size={12} /></button>
                <button class="icon-btn small danger" title="Mover para a Lixeira" onClick={() => props.onTrash(l)}><Trash2 size={12} /></button>
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

