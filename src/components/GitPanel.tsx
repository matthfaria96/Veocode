// Git do projeto, no painel da direita do modo Código. Junta o Source Control do VS Code (escrever
// a mensagem e fazer o commit, a lista do que mudou com a letra de cada arquivo, o gráfico dos
// commits) com o que o Veocode explica: o que está só aqui, o que está no remoto e o GitHub.
// Toda ação é um clique seu; a IA não usa estes botões.
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleX,
  Cloud,
  CloudOff,
  CloudUpload,
  Copy,
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  GitCompareArrows,
  GitPullRequest,
  GitPullRequestDraft,
  Globe,
  Lock,
  Minus,
  Plus,
  RefreshCw,
  Star,
  Tag,
  TriangleAlert,
} from "lucide-solid";
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, type JSX } from "solid-js";
import { createStore } from "solid-js/store";
import { api } from "../api";
import { changeLabel, commitDraft, commitGit, fetchGit, gitOf, loadGit, loadGithub, operationLabel, pullGit, pushGit, setCommitDraft, since, sinceIso, stageFiles, type GitChange, type GitCommit, type GhRun } from "../git";
import CommitGraph from "./CommitGraph";
import { FileIcon } from "./icons";
import { dismissable } from "../dismiss";
import { ALL_CHANGES, currentProject, DIFF, openAllChanges, openDiff, showToast, ws } from "../store";
import { every } from "../every";
import { locale, tx, txn } from "../i18n";

const open = (url: string | null | undefined) => url && void api.openUrl(url).catch(() => {});
const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => showToast(tx("Comando copiado"))).catch(() => {});
const isMac = () => !navigator.userAgent.includes("Windows");

// seções abertas e fechadas (como no VS Code), lembradas neste computador
const SEC_KEY = "veocode.git.sections";
const readSecs = (): Record<string, boolean> => {
  try {
    return JSON.parse(localStorage.getItem(SEC_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
};
const [shut, setShut] = createStore<Record<string, boolean>>(readSecs());
const toggleSec = (id: string, now: boolean) => {
  setShut(id, now);
  try {
    localStorage.setItem(SEC_KEY, JSON.stringify({ ...shut }));
  } catch {
    /* sem armazenamento */
  }
};

/** Seção que abre e fecha (lembrado neste computador). A aba Ambiente usa a mesma. */
export function Section(props: { id: string; title: string; count?: number; hot?: boolean; closed?: boolean; right?: JSX.Element; children: JSX.Element }) {
  const isOpen = () => !(shut[props.id] ?? !!props.closed);
  return (
    <section class="git-sec" classList={{ open: isOpen() }}>
      <header role="button" tabindex="0" aria-expanded={isOpen()} onClick={() => toggleSec(props.id, isOpen())} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggleSec(props.id, isOpen()))}>
        <ChevronRight size={12} class="git-sec-chev" />
        <span class="git-sec-title">{props.title}</span>
        <Show when={props.count}><i class="git-count" classList={{ muted: !props.hot }}>{props.count! > 999 ? "999+" : props.count}</i></Show>
        <span class="git-sec-right" onClick={(e) => e.stopPropagation()}>{props.right}</span>
      </header>
      <Show when={isOpen()}><div class="git-sec-body">{props.children}</div></Show>
    </section>
  );
}

/** Git e GitHub do projeto: o que mudou, o commit, o que falta enviar ou baixar e o GitHub. */
export default function GitPanel() {
  const p = currentProject;
  const pid = () => p().id;
  const e = () => gitOf(pid());
  const s = () => e().status;
  const [showAll, setShowAll] = createSignal(false);

  // ao abrir e a cada 8 s enquanto o painel está aberto (commits feitos fora do Veocode também aparecem)
  createEffect(on(pid, (id) => {
    setShowAll(false);
    void loadGit(id);
    const stopEvery = every(() => void loadGit(id, true), 8000);
    const focus = () => void loadGit(id, true);
    window.addEventListener("focus", focus);
    onCleanup(() => {
      stopEvery();
      window.removeEventListener("focus", focus);
    });
  }));
  // GitHub depois do status (precisa do branch), no máximo a cada minuto
  createEffect(on(() => [pid(), s()?.repo, s()?.branch] as const, ([id, repo]) => repo && void loadGithub(id)));

  const doFetch = async () => {
    const err = await fetchGit(pid());
    if (err) showToast(err);
    else {
      showToast(tx("Remoto atualizado"));
      void loadGithub(pid(), true);
    }
  };
  const doPush = async () => {
    const err = await pushGit(pid());
    showToast(err ?? tx("Enviado para o remoto"));
    if (!err) void loadGithub(pid(), true);
  };
  const doPull = async () => {
    const err = await pullGit(pid());
    showToast(err ?? tx("Baixado: a pasta está igual ao remoto"));
  };

  const groups = createMemo(() => {
    const all = s()?.changes ?? [];
    return {
      conflict: all.filter((c) => c.conflict),
      staged: all.filter((c) => !c.conflict && !c.untracked && c.index !== "."),
      // como no VS Code: alteradas e novas na mesma lista (a letra diz qual é qual)
      work: all.filter((c) => !c.conflict && (c.untracked || c.work !== ".")),
    };
  });
  const changed = () => (s()?.changes.length ?? 0) + (s()?.moreChanges ?? 0);
  const web = () => s()?.remotes.find((r) => r.web)?.web ?? null;
  const graphCommits = () => {
    const all = s()?.graph ?? s()?.commits ?? [];
    return showAll() ? all : all.slice(0, 15);
  };
  const unpushed = () => (s()?.commits ?? []).filter((c) => !c.pushed).length;

  return (
    <div class="git-panel">
      <Show when={s()} fallback={<div class="git-empty">{e().error || (e().loading ? tx("Lendo o git…") : "")}</div>}>
        {(st) => (
          <Show when={st().repo} fallback={<NoRepo />}>
            <Head onFetch={doFetch} onPush={doPush} onPull={doPull} />

            <Show when={st().operation}>
              <div class="git-warn"><TriangleAlert size={13} /> {tx("{v}: termine ou cancele no Terminal antes de continuar.", { v: operationLabel[st().operation!] ?? st().operation })}</div>
            </Show>
            <Show when={st().top}>
              <div class="git-note">{tx("O projeto é a pasta")} <code>{st().prefix || "."}</code> {tx("dentro do repositório")} <code>{st().top}</code>{tx(". Os números valem para o repositório inteiro.")}</div>
            </Show>

            <CommitBox onPush={doPush} onPull={doPull} />

            {/* mudanças */}
            <Section
              id="changes"
              title={tx("Mudanças")}
              count={changed()}
              hot
              right={
                <Show when={st().changes.length}>
                  <button class="git-sec-link accent" classList={{ on: ws.activeFile === ALL_CHANGES }} title={tx("Ver todas as mudanças numa tela só, um arquivo embaixo do outro")} onClick={openAllChanges}>
                    <GitCompareArrows size={12} /> {tx("Revisar tudo")}
                  </button>
                </Show>
              }
            >
              <Show when={st().changes.length} fallback={<div class="git-ok"><CircleCheck size={13} /> {tx("Nada pendente: a pasta está igual ao último commit.")}</div>}>
                <ChangeGroup kind="conflict" title={tx("Em conflito")} items={groups().conflict} />
                <ChangeGroup kind="staged" title={tx("Preparadas para o commit")} items={groups().staged} />
                <ChangeGroup kind="work" title={groups().staged.length || groups().conflict.length ? tx("Ainda não preparadas") : ""} items={groups().work} />
                <Show when={st().moreChanges}><div class="git-more">{tx("e mais {moreChanges} arquivos", { moreChanges: st().moreChanges })}</div></Show>
                <div class="git-tip"><GitCompareArrows size={12} /> {tx("Clique num arquivo para ver o antes e o agora, lado a lado.")}</div>
              </Show>
            </Section>

            {/* chegando */}
            <Show when={st().incoming.length}>
              <Section id="incoming" title={tx("No remoto, ainda não aqui")} count={st().behind} hot>
                <For each={st().incoming}>{(c) => <CommitRow c={c} incoming />}</For>
              </Section>
            </Show>

            {/* gráfico */}
            <Section
              id="graph"
              title={tx("Gráfico")}
              right={<Show when={unpushed()}><span class="git-chip warn" title={tx("Commits que o remoto ainda não tem")}><ArrowUp size={11} /> {txn(unpushed(), "{n} só aqui", "{n} só aqui")}</span></Show>}
            >
              <Show when={!st().empty} fallback={<div class="git-hint">{tx("Nenhum commit ainda.")}</div>}>
                <div class="git-legend">
                  <span><i class="dot local" /> {tx("só neste computador")}</span>
                  <span><i class="dot pushed" /> {tx("já está no remoto")}</span>
                  <span>{tx("cada cor é um branch")}</span>
                </div>
                <div class="git-tip"><GitCompareArrows size={12} /> {tx("Clique num commit para comparar os arquivos dele lado a lado.")}</div>
                <CommitGraph pid={pid()} commits={graphCommits()} head={st().head} uncommitted={changed()} onUncommitted={openAllChanges} />
                <Show when={(st().graph ?? st().commits).length > 15 && !showAll()}>
                  <button class="git-link" onClick={() => setShowAll(true)}>{tx("Mostrar os últimos {length}", { length: (st().graph ?? st().commits).length })}</button>
                </Show>
              </Show>
            </Section>

            <GitHubSection />

            {/* branches */}
            <Section id="branches" title={tx("Branches")} count={st().branches.length} closed>
              <For each={st().branches}>
                {(b) => (
                  <div class="git-branch" classList={{ cur: b.current }} title={b.subject}>
                    <GitBranch size={12} />
                    <span class="git-branch-name">{b.name}</span>
                    <Show when={b.ahead}><span class="git-chip warn" title={tx("Commits que o remoto ainda não tem")}><ArrowUp size={10} />{b.ahead}</span></Show>
                    <Show when={b.behind}><span class="git-chip info" title={tx("Commits do remoto que ainda não estão aqui")}><ArrowDown size={10} />{b.behind}</span></Show>
                    <Show when={b.gone}><span class="git-chip muted" title={tx("O branch foi apagado no remoto (provavelmente já entrou)")}>{tx("apagado no remoto")}</span></Show>
                    <Show when={!b.upstream && !b.gone}><span class="git-chip muted" title={tx("Este branch nunca foi enviado")}>{tx("só local")}</span></Show>
                    <small>{since(b.time)}</small>
                  </div>
                )}
              </For>
            </Section>

            <Show when={st().stashes.length}>
              <Section id="stash" title={tx("Guardados (stash)")} count={st().stashes.length} closed>
                <For each={st().stashes.slice(0, 5)}>
                  {(x) => <div class="git-stash"><Archive size={12} /><span>{x.message}</span><small>{since(x.time)}</small></div>}
                </For>
                <div class="git-hint">{tx("Mudanças deixadas de lado com")} <code>{tx("git stash")}</code>{tx(". Para trazer de volta:")} <code>{tx("git stash pop")}</code>.</div>
              </Section>
            </Show>

            <Section id="remotes" title={tx("Remotos")} count={st().remotes.length} closed={st().remotes.length > 0}>
              <Show when={st().remotes.length} fallback={<div class="git-hint"><CloudOff size={12} /> {tx("Sem remoto: este repositório só existe neste computador. Para pôr no GitHub:")} <button class="git-cmd" onClick={() => copy("gh repo create --private --source=. --push")}><code>{tx("gh repo create --private --source=. --push")}</code><Copy size={11} /></button></div>}>
                <For each={st().remotes}>
                  {(r) => (
                    <div class="git-remote">
                      <Cloud size={12} />
                      <strong>{r.name}</strong>
                      <span class="git-remote-url" title={r.url}>{r.github ?? r.url}</span>
                      <Show when={r.web}><button class="icon-btn small" title={tx("Abrir no navegador")} onClick={() => open(r.web)}><ExternalLink size={12} /></button></Show>
                    </div>
                  )}
                </For>
              </Show>
            </Section>

            <Section id="letters" title={tx("O que as letras querem dizer")} closed>
              <div class="git-letters">
                <span><b class="lg edit">M</b> {tx("modificado (pela IA ou por você)")}</span>
                <span><b class="lg new">N</b> {tx("arquivo novo")}</span>
                <span><b class="lg deleted">A</b> {tx("apagado")}</span>
                <span><b class="lg moved">R</b> {tx("renomeado ou movido")}</span>
                <span><b class="lg conflict">!</b> {tx("em conflito: os dois lados mexeram no mesmo trecho")}</span>
                <span><b class="lg read">L</b> {tx("na árvore: a IA leu o arquivo")}</span>
                <span><b class="lg search">B</b> {tx("na árvore: a IA buscou texto nele")}</span>
              </div>
              <div class="git-hint">{tx("Preparar (+) escolhe o que entra no próximo commit. Sem nada preparado, o commit leva tudo. Enviar manda os commits para o remoto (GitHub); baixar traz os de lá.")}</div>
            </Section>

            <Show when={web()}>
              <div class="git-foot"><button class="git-link" onClick={() => open(web())}>{tx("Abrir o repositório")} <ExternalLink size={11} /></button></div>
            </Show>
          </Show>
        )}
      </Show>
    </div>
  );

  /** Branch, o caminho até o remoto (↑ enviar, ↓ baixar) e "buscar". */
  function Head(props: { onFetch: () => void; onPush: () => void; onPull: () => void }) {
    const st = () => s()!;
    const state = () => {
      const x = st();
      if (x.empty) return { tone: "muted", text: tx("Repositório sem commits") };
      if (!x.upstream) return x.remotes.length ? { tone: "muted", text: tx("Este branch nunca foi enviado") } : { tone: "muted", text: tx("Só neste computador, sem remoto") };
      if (x.ahead && x.behind) return { tone: "warn", text: tx("Os dois lados mudaram: {ahead} para enviar e {behind} para baixar", { ahead: x.ahead, behind: x.behind }) };
      if (x.ahead) return { tone: "warn", text: txn(x.ahead, "{n} commit para enviar", "{n} commits para enviar") };
      if (x.behind) return { tone: "info", text: txn(x.behind, "{n} commit para baixar", "{n} commits para baixar") };
      return { tone: "ok", text: tx("Em dia com o remoto") };
    };
    const busy = () => !!e().acting;
    return (
      <div class="git-head">
        <div class="git-head-top">
          <span class="git-head-br" title={st().upstream ? tx("Acompanha {v}", { v: st().upstream }) : ""}>
            <GitBranch size={13} />
            <strong class="git-head-branch">{st().detached ? tx("HEAD solto em {head}", { head: st().head }) : st().branch}</strong>
          </span>
          <Show when={st().upstream}>
            <button class="git-sync" classList={{ zero: !st().ahead, warn: !!st().ahead }} disabled={!st().ahead || busy()} onClick={props.onPush} title={st().ahead ? tx("Enviar: git push") : tx("Nada para enviar")}>
              <ArrowUp size={11} />{st().ahead}
            </button>
            <button class="git-sync" classList={{ zero: !st().behind, info: !!st().behind }} disabled={!st().behind || busy()} onClick={props.onPull} title={st().behind ? tx("Baixar: git pull (só avança, nunca faz merge)") : tx("Nada para baixar")}>
              <ArrowDown size={11} />{st().behind}
            </button>
          </Show>
          <span class="git-head-sp" />
          <Show when={st().remotes.length}>
            <button class="icon-btn small" disabled={e().fetching} onClick={props.onFetch} title={tx("Buscar (git fetch): pergunta ao remoto o que há de novo, sem mudar seus arquivos")}>
              <Cloud size={13} classList={{ pulse: e().fetching }} />
            </button>
          </Show>
          <button class="icon-btn small" title={tx("Ler de novo")} onClick={() => void loadGit(pid())}><RefreshCw size={12} classList={{ spin: e().loading }} /></button>
        </div>
        <div class={`git-state ${state().tone}`}>
          <i />
          <span>{state().text}</span>
          <small>{e().fetching ? tx("buscando…") : st().fetchedAt ? tx("remoto visto {since}", { since: since(st().fetchedAt) }) : st().remotes.length ? tx("remoto nunca consultado") : ""}</small>
        </div>
      </div>
    );
  }

  /** A caixa do commit, como no VS Code: a mensagem, o botão (com "commit e enviar" ao lado) e,
   *  sem nada para salvar, o que falta enviar ou baixar. */
  function CommitBox(props: { onPush: () => void; onPull: () => void }) {
    const st = () => s()!;
    const staged = () => groups().staged.length;
    const acting = () => e().acting;
    const msg = () => commitDraft(pid());
    const [menu, setMenu] = createSignal(false);
    const [need, setNeed] = createSignal(false);
    let area: HTMLTextAreaElement | undefined;
    const canPush = () => st().remotes.length > 0;
    const doCommit = async (andPush: boolean) => {
      setMenu(false);
      if (!msg().trim()) {
        setNeed(true);
        area?.focus();
        return;
      }
      const err = await commitGit(pid(), msg(), staged() === 0);
      if (err) return showToast(err);
      setCommitDraft(pid(), "");
      setNeed(false);
      if (andPush) return props.onPush();
      showToast(canPush() ? tx("Commit feito. Por enquanto ele está só neste computador: envie quando quiser.") : tx("Commit feito"));
    };
    const what = () =>
      staged()
        ? txn(staged(), "Vai salvar {n} arquivo preparado. Os outros ficam para depois.", "Vai salvar os {n} arquivos preparados. Os outros ficam para depois.")
        : txn(changed(), "Vai salvar {n} mudança num commit, neste computador.", "Vai salvar as {n} mudanças num commit, neste computador.");
    return (
      <Show
        when={changed() > 0}
        fallback={
          <Show when={!st().empty}>
            <div class="git-box calm">
              <Show
                when={st().ahead || st().behind || (!st().upstream && canPush() && !st().detached)}
                fallback={<div class="git-ok"><CircleCheck size={14} /> {st().upstream ? tx("Tudo salvo e em dia com o remoto") : tx("Tudo salvo num commit")}</div>}
              >
                <Show when={st().behind}>
                  <button class="git-primary" classList={{ ghost: !!st().ahead }} disabled={!!acting()} onClick={props.onPull}>
                    <Show when={acting() === "pull"} fallback={<ArrowDown size={14} />}><span class="spinner inline" /></Show>
                    {txn(st().behind, "Baixar {n} commit", "Baixar {n} commits")}
                  </button>
                </Show>
                <Show when={st().ahead && !st().behind}>
                  <button class="git-primary" disabled={!!acting()} onClick={props.onPush}>
                    <Show when={acting() === "push"} fallback={<ArrowUp size={14} />}><span class="spinner inline" /></Show>
                    {txn(st().ahead, "Enviar {n} commit", "Enviar {n} commits")}
                  </button>
                </Show>
                <Show when={!st().upstream && canPush() && !st().detached}>
                  <button class="git-primary" disabled={!!acting()} onClick={props.onPush}>
                    <Show when={acting() === "push"} fallback={<CloudUpload size={14} />}><span class="spinner inline" /></Show>
                    {tx("Publicar o branch {v}", { v: st().branch })}
                  </button>
                </Show>
                <small class="git-box-hint">
                  {st().ahead && st().behind ? tx("Os dois lados mudaram: baixe primeiro. Se o git não conseguir juntar sozinho, ele avisa e nada se perde.") : st().behind ? tx("Traz os commits do remoto para cá. Só avança: nunca cria merge.") : st().ahead ? tx("Manda os seus commits para o remoto (GitHub), onde outras pessoas e a CI veem.") : tx("Este branch ainda não existe no remoto: publicar envia e passa a acompanhá-lo.")}
                </small>
              </Show>
            </div>
          </Show>
        }
      >
        <div class="git-box" classList={{ need: need() }}>
          <textarea
            ref={area}
            class="git-msg"
            rows={Math.min(6, Math.max(1, msg().split("\n").length))}
            value={msg()}
            placeholder={tx("Mensagem do commit ({v} para salvar)", { v: isMac() ? "⌘Enter" : "Ctrl+Enter" })}
            spellcheck={false}
            onInput={(ev) => (setCommitDraft(pid(), ev.currentTarget.value), setNeed(false))}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
                ev.preventDefault();
                void doCommit(false);
              }
            }}
          />
          <Show when={need()}><small class="git-need">{tx("Escreva em uma linha o que mudou, por exemplo “Corrige o login”.")}</small></Show>
          <div class="git-split">
            <button class="git-primary" classList={{ dim: !msg().trim() }} disabled={!!acting()} onClick={() => void doCommit(false)} title={what()}>
              <Show when={acting() === "commit"} fallback={<Check size={14} />}><span class="spinner inline" /></Show>
              {tx("Commit")}
              <i class="git-primary-n">{staged() || changed()}</i>
            </button>
            <Show when={canPush()}>
              <div class="git-split-more">
                <button class="git-primary git-caret" classList={{ dim: !msg().trim() }} disabled={!!acting()} aria-haspopup="menu" aria-expanded={menu()} title={tx("Mais opções de commit")} onClick={() => setMenu(!menu())}>
                  <ChevronDown size={14} />
                </button>
                <Show when={menu()}>
                  <div class="menu pop-in git-split-menu" role="menu" ref={(el) => dismissable(el, () => setMenu(false))}>
                    <button class="menu-item" role="menuitem" onClick={() => void doCommit(false)}><Check size={14} /><span class="menu-label">{tx("Commit")}<small>{tx("Salva só neste computador")}</small></span></button>
                    <button class="menu-item" role="menuitem" onClick={() => void doCommit(true)}><CloudUpload size={14} /><span class="menu-label">{tx("Commit e enviar")}<small>{tx("Salva e já manda para o remoto (push)")}</small></span></button>
                  </div>
                </Show>
              </div>
            </Show>
          </div>
          <small class="git-box-hint">{what()}</small>
        </div>
      </Show>
    );
  }

  function ChangeGroup(props: { kind: "conflict" | "staged" | "work"; title: string; items: GitChange[] }) {
    const st = () => s()!;
    const rel = (path: string) => (st().prefix ? (path.startsWith(st().prefix) ? path.slice(st().prefix.length) : null) : path);
    const busy = () => !!e().acting;
    const stage = async (paths: string[], on: boolean) => {
      const err = await stageFiles(pid(), paths, on);
      if (err) showToast(err);
    };
    const paths = () => props.items.map((c) => c.path.replace(/\/$/, ""));
    return (
      <Show when={props.items.length}>
        <Show when={props.title}>
          <div class="git-group">
            <span>{props.title}</span>
            <i class="git-count muted">{props.items.length}</i>
            <span class="git-group-act">
              <Show when={props.kind === "staged"}>
                <button class="icon-btn small" disabled={busy()} title={tx("Tirar todas do próximo commit")} onClick={() => void stage(paths(), false)}><Minus size={13} /></button>
              </Show>
              <Show when={props.kind === "work"}>
                <button class="icon-btn small" disabled={busy()} title={tx("Preparar todas para o próximo commit")} onClick={() => void stage(paths(), true)}><Plus size={13} /></button>
              </Show>
            </span>
          </div>
        </Show>
        <For each={props.items.slice(0, 120)}>
          {(c) => {
            const l = props.kind === "staged" ? changeLabel({ ...c, work: "." }) : changeLabel({ ...c, index: c.untracked || c.conflict ? c.index : "." });
            const r = rel(c.path);
            const isDir = c.path.endsWith("/");
            const name = c.path.split("/").filter(Boolean).pop() ?? c.path;
            const dir = c.path.split("/").filter(Boolean).slice(0, -1).join("/");
            return (
              <div
                class="git-file"
                classList={{ off: r === null || isDir, sel: r !== null && ws.activeFile === DIFF + r, gone: l.tone === "deleted" }}
                role="button"
                tabindex="0"
                title={`${c.path}: ${tx(l.word)}${r !== null && !isDir ? ` · ${tx("clique para ver o que mudou")}` : ""}`}
                onClick={() => r !== null && !isDir && openDiff(r)}
                onKeyDown={(ev) => ev.key === "Enter" && r !== null && !isDir && openDiff(r)}
              >
                <span class="git-file-icon"><FileIcon name={name} size={13} /></span>
                <span class="git-file-name">{name}{isDir ? "/" : ""}</span>
                <span class="git-file-dir">{dir}</span>
                <Show when={c.added || c.removed}>
                  <span class="git-file-n" title={tx("Linhas que entraram e saíram desde o último commit")}>
                    <Show when={c.added}><b class="plus">+{c.added}</b></Show>
                    <Show when={c.removed}><b class="minus">−{c.removed}</b></Show>
                  </span>
                </Show>
                <span class="git-file-act" onClick={(ev) => ev.stopPropagation()}>
                  <Show when={r !== null && !isDir}>
                    <button class="icon-btn small" title={tx("Comparar lado a lado: antes e agora")} onClick={() => openDiff(r!)}><GitCompareArrows size={12} /></button>
                  </Show>
                  <Show when={props.kind === "staged"}>
                    <button class="icon-btn small" disabled={busy()} title={tx("Tirar do próximo commit")} onClick={() => void stage([c.path.replace(/\/$/, "")], false)}><Minus size={12} /></button>
                  </Show>
                  <Show when={props.kind !== "staged"}>
                    <button class="icon-btn small" disabled={busy()} title={props.kind === "conflict" ? tx("Marcar como resolvido e preparar") : tx("Preparar para o próximo commit")} onClick={() => void stage([c.path.replace(/\/$/, "")], true)}><Plus size={12} /></button>
                  </Show>
                </span>
                <span class={`git-letter ${l.tone}`} title={tx(l.word)}>{l.letter}</span>
              </div>
            );
          }}
        </For>
        <Show when={props.items.length > 120}><div class="git-more">{tx("e mais {v}", { v: props.items.length - 120 })}</div></Show>
      </Show>
    );
  }

  function CommitRow(props: { c: GitCommit; incoming?: boolean }) {
    const c = props.c;
    const url = () => {
      const w = web();
      return w && w.includes("github.com") ? `${w}/commit/${c.hash}` : null;
    };
    return (
      <div class="git-commit" classList={{ incoming: props.incoming }} title={`${c.hash}\n${c.author} · ${new Date(c.time * 1000).toLocaleString(locale())}`}>
        <i class="dot" classList={{ local: !c.pushed, pushed: c.pushed, in: props.incoming }} />
        <div class="git-commit-body">
          <span class="git-commit-subject">{c.subject}</span>
          <small>
            <code>{c.short}</code> · {c.author} · {since(c.time)}
            <For each={c.refs.filter((r) => !r.endsWith("/HEAD")).slice(0, 3)}>{(r) => <span class="git-ref" classList={{ tag: r.startsWith("tag: ") }}>{r.startsWith("tag: ") ? <><Tag size={9} />{r.slice(5)}</> : r}</span>}</For>
          </small>
        </div>
        <Show when={url() && c.pushed}><button class="icon-btn small git-commit-go" title={tx("Ver no GitHub")} onClick={() => open(url())}><ExternalLink size={11} /></button></Show>
      </div>
    );
  }

  function GitHubSection() {
    const gh = () => e().gh;
    return (
      <Section
        id="github"
        title={tx("GitHub")}
        right={
          <Show when={gh()?.state === "ok"}>
            <Show when={gh()!.runs[0]}>
              {(r) => {
                const ok = () => r().status === "completed" && r().conclusion === "success";
                const bad = () => r().status === "completed" && !["success", "skipped", "neutral"].includes(r().conclusion);
                return (
                  <span class="git-chip" classList={{ ok: ok(), bad: bad(), info: r().status !== "completed" }} title={tx("Último teste automático (CI) deste branch")}>
                    {ok() ? <CircleCheck size={10} /> : bad() ? <CircleX size={10} /> : <CircleDashed size={10} />} {tx("CI")}
                  </span>
                );
              }}
            </Show>
            <Show when={gh()!.prs.length}><span class="git-chip muted" title={tx("Pull requests abertos")}><GitPullRequest size={10} /> {gh()!.prs.length}</span></Show>
            <button class="icon-btn small" title={tx("Ler de novo")} onClick={() => void loadGithub(pid(), true)}><RefreshCw size={12} classList={{ spin: e().ghLoading }} /></button>
          </Show>
        }
      >
        <Show when={gh()} fallback={<div class="git-hint">{e().ghLoading ? tx("Consultando o GitHub…") : ""}</div>}>
          {(g) => (
            <>
              <Show when={g().state === "noRemote"}><div class="git-hint">{tx("Este repositório não tem remoto no GitHub.")}</div></Show>
              <Show when={g().state === "noGh"}>
                <div class="git-hint">
                  {tx("Para ver PRs e testes automáticos de")} <strong>{g().repo}</strong>{tx(", instale o GitHub CLI e entre na sua conta:")}
                  <button class="git-cmd" onClick={() => copy(navigator.userAgent.includes("Windows") ? "winget install GitHub.cli" : "brew install gh")}><code>{navigator.userAgent.includes("Windows") ? "winget install GitHub.cli" : "brew install gh"}</code><Copy size={11} /></button>
                  <button class="git-cmd" onClick={() => copy("gh auth login")}><code>{tx("gh auth login")}</code><Copy size={11} /></button>
                </div>
              </Show>
              <Show when={g().state === "noLogin"}>
                <div class="git-hint">{tx("O GitHub CLI está instalado mas sem login. No Terminal:")} <button class="git-cmd" onClick={() => copy("gh auth login")}><code>{tx("gh auth login")}</code><Copy size={11} /></button></div>
              </Show>
              <Show when={g().state === "error"}><div class="git-warn"><TriangleAlert size={13} /> {g().message}</div></Show>
              <Show when={g().state === "ok" && g().info}>
                {(i) => (
                  <>
                    <button class="git-repo" onClick={() => open(i().url)}>
                      <div class="git-repo-top">
                        <strong>{i().nameWithOwner}</strong>
                        <span class="git-chip muted">{i().visibility === "PUBLIC" ? <><Globe size={10} /> {tx("público")}</> : <><Lock size={10} /> {tx("privado")}</>}</span>
                        <Show when={i().isArchived}><span class="git-chip muted">{tx("arquivado")}</span></Show>
                        <ExternalLink size={11} class="git-repo-go" />
                      </div>
                      <Show when={i().description}><small class="git-repo-desc">{i().description}</small></Show>
                      <div class="git-repo-stats">
                        <span title={tx("Issues abertas")}><CircleDot size={11} /> {i().issues}</span>
                        <span title={tx("Pull requests abertos")}><GitPullRequest size={11} /> {i().pullRequests}</span>
                        <span title={tx("Estrelas")}><Star size={11} /> {i().stargazerCount}</span>
                        <Show when={i().latestRelease}><span title={tx("Última versão publicada")}><Tag size={11} /> {i().latestRelease!.tagName}</span></Show>
                        <span>{tx("enviado {v}", { v: sinceIso(i().pushedAt) })}</span>
                      </div>
                    </button>

                    <div class="git-group">{tx("Testes automáticos (CI) de {v}", { v: s()?.branch ?? tx("este branch") })}</div>
                    <Show when={g().runs.length} fallback={<div class="git-hint">{tx("Nenhuma execução recente neste branch (o repositório pode não ter GitHub Actions).")}</div>}>
                      <For each={g().runs.slice(0, 5)}>{(r) => <RunRow r={r} />}</For>
                    </Show>

                    <div class="git-group">{tx("Pull requests abertos")} <small>{g().prs.length}</small></div>
                    <Show when={g().prs.length} fallback={<div class="git-hint">{tx("Nenhum PR aberto.")}</div>}>
                      <For each={g().prs}>
                        {(pr) => (
                          <button class="git-pr" classList={{ mine: pr.headRefName === s()?.branch }} onClick={() => open(pr.url)}>
                            <span class="git-pr-icon">{pr.isDraft ? <GitPullRequestDraft size={13} /> : <GitPullRequest size={13} />}</span>
                            <div>
                              <span class="git-pr-title">#{pr.number} {pr.title}</span>
                              <small>
                                {pr.headRefName} → {pr.baseRefName} · {pr.author?.login} · {sinceIso(pr.updatedAt)}
                                <Show when={pr.headRefName === s()?.branch}> · <b>{tx("este branch")}</b></Show>
                              </small>
                              <span class="git-pr-badges">
                                <Show when={pr.isDraft}><span class="git-chip muted">{tx("rascunho")}</span></Show>
                                <Show when={pr.reviewDecision === "APPROVED"}><span class="git-chip ok">{tx("aprovado")}</span></Show>
                                <Show when={pr.reviewDecision === "CHANGES_REQUESTED"}><span class="git-chip warn">{tx("pediram mudanças")}</span></Show>
                                <Show when={pr.checks.fail}><span class="git-chip bad"><CircleX size={10} /> {tx("{fail} falhou", { fail: pr.checks.fail })}</span></Show>
                                <Show when={pr.checks.running}><span class="git-chip info"><CircleDashed size={10} /> {tx("{running} rodando", { running: pr.checks.running })}</span></Show>
                                <Show when={pr.checks.ok && !pr.checks.fail && !pr.checks.running}><span class="git-chip ok"><CircleCheck size={10} /> {tx("checks ok")}</span></Show>
                              </span>
                            </div>
                          </button>
                        )}
                      </For>
                    </Show>
                  </>
                )}
              </Show>
            </>
          )}
        </Show>
      </Section>
    );
  }
}

function RunRow(props: { r: GhRun }) {
  const r = props.r;
  const tone = () => (r.status !== "completed" ? "info" : r.conclusion === "success" ? "ok" : r.conclusion === "skipped" || r.conclusion === "neutral" ? "muted" : "bad");
  const word = () => (r.status !== "completed" ? tx("rodando") : ({ success: tx("passou"), failure: tx("falhou"), cancelled: tx("cancelado"), skipped: tx("pulado"), timed_out: tx("estourou o tempo") } as Record<string, string>)[r.conclusion] ?? r.conclusion);
  return (
    <button class="git-run" onClick={() => open(r.url)} title={`${r.name} · ${r.event}`}>
      <span class={`git-run-icon ${tone()}`}>{tone() === "ok" ? <CircleCheck size={13} /> : tone() === "bad" ? <CircleX size={13} /> : <CircleDashed size={13} classList={{ spin: tone() === "info" }} />}</span>
      <span class="git-run-title">{r.displayTitle}</span>
      <small>{r.name} · {word()} · {sinceIso(r.createdAt)}</small>
    </button>
  );
}

function NoRepo() {
  return (
    <div class="git-norepo">
      <GitCommitHorizontal size={22} />
      <strong>{tx("Esta pasta não usa git")}</strong>
      <p>{tx("Sem git, não há histórico de versões: não dá para ver o que mudou nem voltar atrás. Para começar, no Terminal desta pasta:")}</p>
      <button class="git-cmd" onClick={() => copy(tx("git init && git add -A && git commit -m \"Primeira versão\""))}><code>{tx("git init && git add -A && git commit -m \"Primeira versão\"")}</code><Copy size={11} /></button>
      <p>{tx("Ou peça para a IA no chat: \"crie um repositório git aqui e faça o primeiro commit\".")}</p>
    </div>
  );
}
