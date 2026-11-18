import {
  Archive,
  ArrowDown,
  ArrowUp,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleX,
  Cloud,
  CloudOff,
  Copy,
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  GitPullRequestDraft,
  Globe,
  Laptop,
  Lock,
  RefreshCw,
  Star,
  Tag,
  TriangleAlert,
} from "lucide-solid";
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, type JSX } from "solid-js";
import { api } from "../api";
import { changeLabel, fetchGit, gitOf, loadGit, loadGithub, operationLabel, since, sinceIso, type GitChange, type GitCommit, type GhRun } from "../git";
import { openRealFile } from "../realProject";
import { currentProject, showToast } from "../store";

const open = (url: string | null | undefined) => url && void api.openUrl(url).catch(() => {});
const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => showToast("Comando copiado")).catch(() => {});

function Section(props: { title: string; count?: number; right?: JSX.Element; children: JSX.Element }) {
  return (
    <section class="git-sec">
      <header>
        <span>{props.title}</span>
        <Show when={props.count !== undefined}><small class="count">{props.count}</small></Show>
        <span class="git-sec-right">{props.right}</span>
      </header>
      {props.children}
    </section>
  );
}

/** Git e GitHub do projeto: o que está aqui, o que está no remoto e o que falta entre os dois. */
export default function GitPanel() {
  const p = currentProject;
  const pid = () => p().id;
  const e = () => gitOf(pid());
  const s = () => e().status;
  const [showAll, setShowAll] = createSignal(false);

  // ao abrir e a cada 8 s enquanto a aba está aberta (commits feitos fora do Veocode também aparecem)
  createEffect(on(pid, (id) => {
    setShowAll(false);
    void loadGit(id);
    const t = window.setInterval(() => void loadGit(id, true), 8000);
    const focus = () => void loadGit(id, true);
    window.addEventListener("focus", focus);
    onCleanup(() => {
      clearInterval(t);
      window.removeEventListener("focus", focus);
    });
  }));
  // GitHub depois do status (precisa do branch), no máximo a cada minuto
  createEffect(on(() => [pid(), s()?.repo, s()?.branch] as const, ([id, repo]) => repo && void loadGithub(id)));

  const doFetch = async () => {
    const err = await fetchGit(pid());
    if (err) showToast(err);
    else {
      showToast("Remoto atualizado");
      void loadGithub(pid(), true);
    }
  };

  const groups = createMemo(() => {
    const all = s()?.changes ?? [];
    return {
      conflict: all.filter((c) => c.conflict),
      staged: all.filter((c) => !c.conflict && !c.untracked && c.index !== "."),
      work: all.filter((c) => !c.conflict && !c.untracked && c.work !== "."),
      untracked: all.filter((c) => c.untracked),
    };
  });
  const web = () => s()?.remotes.find((r) => r.web)?.web ?? null;
  const commits = () => (showAll() ? s()?.commits ?? [] : (s()?.commits ?? []).slice(0, 12));
  const unpushed = () => (s()?.commits ?? []).filter((c) => !c.pushed).length;

  return (
    <div class="git-panel">
        <Show when={s()} fallback={<div class="git-empty">{e().error || (e().loading ? "Lendo o git…" : "")}</div>}>
          {(st) => (
            <Show when={st().repo} fallback={<NoRepo />}>
              <Head onFetch={doFetch} />

              <Show when={st().operation}>
                <div class="git-warn"><TriangleAlert size={13} /> {operationLabel[st().operation!] ?? st().operation}: termine ou cancele no Terminal antes de continuar.</div>
              </Show>
              <Show when={st().top}>
                <div class="git-note">O projeto é a pasta <code>{st().prefix || "."}</code> dentro do repositório <code>{st().top}</code>. Os números valem para o repositório inteiro.</div>
              </Show>

              {/* mudanças */}
              <Section title="Mudanças não salvas no git" count={st().changes.length + st().moreChanges}>
                <Show when={st().changes.length} fallback={<div class="git-ok"><CircleCheck size={13} /> Nada pendente: a pasta está igual ao último commit.</div>}>
                  <ChangeGroup title="Em conflito" items={groups().conflict} />
                  <ChangeGroup title="Prontas para o próximo commit" items={groups().staged} staged />
                  <ChangeGroup title="Alteradas" items={groups().work} />
                  <ChangeGroup title="Novas (o git ainda não acompanha)" items={groups().untracked} />
                  <Show when={st().moreChanges}><div class="git-more">e mais {st().moreChanges} arquivos</div></Show>
                </Show>
              </Section>

              {/* chegando */}
              <Show when={st().incoming.length}>
                <Section title="No remoto, ainda não aqui" count={st().behind}>
                  <For each={st().incoming}>{(c) => <CommitRow c={c} incoming />}</For>
                  <div class="git-hint">Para trazer: <code>git pull</code> no Terminal.</div>
                </Section>
              </Show>

              {/* commits */}
              <Section
                title="Commits"
                right={<Show when={unpushed()}><span class="git-chip warn"><ArrowUp size={11} /> {unpushed()} só neste computador</span></Show>}
              >
                <Show when={!st().empty} fallback={<div class="git-hint">Nenhum commit ainda.</div>}>
                  <div class="git-legend">
                    <span><i class="dot local" /> só neste computador</span>
                    <span><i class="dot pushed" /> já está no remoto</span>
                  </div>
                  <div class="git-commits">
                    <For each={commits()}>{(c) => <CommitRow c={c} />}</For>
                  </div>
                  <Show when={(st().commits.length ?? 0) > 12 && !showAll()}>
                    <button class="git-link" onClick={() => setShowAll(true)}>Mostrar os últimos {st().commits.length}</button>
                  </Show>
                </Show>
              </Section>

              {/* branches */}
              <Section title="Branches" count={st().branches.length}>
                <For each={st().branches}>
                  {(b) => (
                    <div class="git-branch" classList={{ cur: b.current }} title={b.subject}>
                      <GitBranch size={12} />
                      <span class="git-branch-name">{b.name}</span>
                      <Show when={b.ahead}><span class="git-chip warn" title="Commits que o remoto ainda não tem"><ArrowUp size={10} />{b.ahead}</span></Show>
                      <Show when={b.behind}><span class="git-chip info" title="Commits do remoto que ainda não estão aqui"><ArrowDown size={10} />{b.behind}</span></Show>
                      <Show when={b.gone}><span class="git-chip muted" title="O branch foi apagado no remoto (provavelmente já entrou)">apagado no remoto</span></Show>
                      <Show when={!b.upstream && !b.gone}><span class="git-chip muted" title="Este branch nunca foi enviado">só local</span></Show>
                      <small>{since(b.time)}</small>
                    </div>
                  )}
                </For>
              </Section>

              <Show when={st().stashes.length}>
                <Section title="Guardados (stash)" count={st().stashes.length}>
                  <For each={st().stashes.slice(0, 5)}>
                    {(x) => <div class="git-stash"><Archive size={12} /><span>{x.message}</span><small>{since(x.time)}</small></div>}
                  </For>
                  <div class="git-hint">Mudanças deixadas de lado com <code>git stash</code>. Para trazer de volta: <code>git stash pop</code>.</div>
                </Section>
              </Show>

              <GitHubSection />

              <Section title="Remotos" count={st().remotes.length}>
                <Show when={st().remotes.length} fallback={<div class="git-hint"><CloudOff size={12} /> Sem remoto: este repositório só existe neste computador. Para pôr no GitHub: <button class="git-cmd" onClick={() => copy("gh repo create --private --source=. --push")}><code>gh repo create --private --source=. --push</code><Copy size={11} /></button></div>}>
                  <For each={st().remotes}>
                    {(r) => (
                      <div class="git-remote">
                        <Cloud size={12} />
                        <strong>{r.name}</strong>
                        <span class="git-remote-url" title={r.url}>{r.github ?? r.url}</span>
                        <Show when={r.web}><button class="icon-btn small" title="Abrir no navegador" onClick={() => open(r.web)}><ExternalLink size={12} /></button></Show>
                      </div>
                    )}
                  </For>
                </Show>
              </Section>

              <div class="git-foot">
                O Veocode só lê o git. Commit, push e pull ficam com você (aba Terminal) ou com a IA, conforme o nível de acesso. "Buscar" só atualiza o que se sabe do remoto.
                <Show when={web()}><button class="git-link" onClick={() => open(web())}>Abrir o repositório <ExternalLink size={11} /></button></Show>
              </div>
            </Show>
          )}
        </Show>
    </div>
  );

  function Head(props: { onFetch: () => void }) {
    const st = () => s()!;
    const state = () => {
      const x = st();
      if (x.empty) return { tone: "muted", text: "Repositório sem commits" };
      if (!x.upstream) return x.remotes.length ? { tone: "muted", text: "Este branch nunca foi enviado" } : { tone: "muted", text: "Só neste computador" };
      if (x.ahead && x.behind) return { tone: "warn", text: `Os dois lados mudaram: ${x.ahead} para enviar e ${x.behind} para baixar` };
      if (x.ahead) return { tone: "warn", text: `${x.ahead} ${x.ahead === 1 ? "commit para enviar" : "commits para enviar"}` };
      if (x.behind) return { tone: "info", text: `${x.behind} ${x.behind === 1 ? "commit para baixar" : "commits para baixar"}` };
      return { tone: "ok", text: "Em dia com o remoto" };
    };
    return (
      <div class="git-head">
        <div class="git-head-top">
          <GitBranch size={16} />
          <strong class="git-head-branch">{st().detached ? `HEAD solto em ${st().head}` : st().branch}</strong>
          <button class="icon-btn small" title="Ler de novo" onClick={() => void loadGit(pid())}><RefreshCw size={12} classList={{ spin: e().loading }} /></button>
        </div>
        <div class="git-flow">
          <div class="git-side"><Laptop size={13} /><span>Aqui</span></div>
          <div class="git-arrows">
            <span class="git-chip warn" classList={{ zero: !st().ahead }} title="Commits daqui que o remoto ainda não tem"><ArrowUp size={11} />{st().ahead}</span>
            <span class="git-chip info" classList={{ zero: !st().behind }} title="Commits do remoto que ainda não estão aqui"><ArrowDown size={11} />{st().behind}</span>
          </div>
          <div class="git-side"><Cloud size={13} /><span title={st().upstream ?? ""}>{st().upstream ?? "sem remoto"}</span></div>
        </div>
        <div class={`git-state ${state().tone}`}>{state().text}</div>
        <div class="git-fetch">
          <small>{st().fetchedAt ? `Remoto consultado ${since(st().fetchedAt)}` : "O remoto nunca foi consultado daqui"}</small>
          <Show when={st().remotes.length}>
            <button class="ghost-btn small" disabled={e().fetching} onClick={props.onFetch} title="git fetch: pergunta ao remoto o que há de novo, sem mudar seus arquivos">
              <RefreshCw size={12} classList={{ spin: e().fetching }} /> {e().fetching ? "Buscando…" : "Buscar"}
            </button>
          </Show>
        </div>
      </div>
    );
  }

  function ChangeGroup(props: { title: string; items: GitChange[]; staged?: boolean }) {
    const st = () => s()!;
    const rel = (path: string) => (st().prefix ? (path.startsWith(st().prefix) ? path.slice(st().prefix.length) : null) : path);
    return (
      <Show when={props.items.length}>
        <div class="git-group">{props.title} <small>{props.items.length}</small></div>
        <For each={props.items.slice(0, 80)}>
          {(c) => {
            const l = props.staged ? changeLabel({ ...c, work: "." }) : changeLabel({ ...c, index: c.untracked || c.conflict ? c.index : "." });
            const r = rel(c.path);
            const isDir = c.path.endsWith("/");
            return (
              <button class="git-file" classList={{ off: r === null || isDir || l.tone === "deleted" }} title={`${c.path}: ${l.word}`} onClick={() => r !== null && !isDir && l.tone !== "deleted" && openRealFile(r)}>
                <span class={`git-letter ${l.tone}`}>{l.letter}</span>
                <span class="git-file-name">{c.path.split("/").filter(Boolean).pop()}{isDir ? "/" : ""}</span>
                <span class="git-file-dir">{c.path.split("/").filter(Boolean).slice(0, -1).join("/")}</span>
              </button>
            );
          }}
        </For>
        <Show when={props.items.length > 80}><div class="git-more">e mais {props.items.length - 80}</div></Show>
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
      <div class="git-commit" classList={{ incoming: props.incoming }} title={`${c.hash}\n${c.author} · ${new Date(c.time * 1000).toLocaleString("pt-BR")}`}>
        <i class="dot" classList={{ local: !c.pushed, pushed: c.pushed, in: props.incoming }} />
        <div class="git-commit-body">
          <span class="git-commit-subject">{c.subject}</span>
          <small>
            <code>{c.short}</code> · {c.author} · {since(c.time)}
            <For each={c.refs.filter((r) => !r.endsWith("/HEAD")).slice(0, 3)}>{(r) => <span class="git-ref" classList={{ tag: r.startsWith("tag: ") }}>{r.startsWith("tag: ") ? <><Tag size={9} />{r.slice(5)}</> : r}</span>}</For>
          </small>
        </div>
        <Show when={url() && c.pushed}><button class="icon-btn small git-commit-go" title="Ver no GitHub" onClick={() => open(url())}><ExternalLink size={11} /></button></Show>
      </div>
    );
  }

  function GitHubSection() {
    const gh = () => e().gh;
    return (
      <Section
        title="GitHub"
        right={<Show when={gh()?.state === "ok"}><button class="icon-btn small" title="Ler de novo" onClick={() => void loadGithub(pid(), true)}><RefreshCw size={12} classList={{ spin: e().ghLoading }} /></button></Show>}
      >
        <Show when={gh()} fallback={<div class="git-hint">{e().ghLoading ? "Consultando o GitHub…" : ""}</div>}>
          {(g) => (
            <>
              <Show when={g().state === "noRemote"}><div class="git-hint">Este repositório não tem remoto no GitHub.</div></Show>
              <Show when={g().state === "noGh"}>
                <div class="git-hint">
                  Para ver PRs e testes automáticos de <strong>{g().repo}</strong>, instale o GitHub CLI e entre na sua conta:
                  <button class="git-cmd" onClick={() => copy(navigator.userAgent.includes("Windows") ? "winget install GitHub.cli" : "brew install gh")}><code>{navigator.userAgent.includes("Windows") ? "winget install GitHub.cli" : "brew install gh"}</code><Copy size={11} /></button>
                  <button class="git-cmd" onClick={() => copy("gh auth login")}><code>gh auth login</code><Copy size={11} /></button>
                </div>
              </Show>
              <Show when={g().state === "noLogin"}>
                <div class="git-hint">O GitHub CLI está instalado mas sem login. No Terminal: <button class="git-cmd" onClick={() => copy("gh auth login")}><code>gh auth login</code><Copy size={11} /></button></div>
              </Show>
              <Show when={g().state === "error"}><div class="git-warn"><TriangleAlert size={13} /> {g().message}</div></Show>
              <Show when={g().state === "ok" && g().info}>
                {(i) => (
                  <>
                    <button class="git-repo" onClick={() => open(i().url)}>
                      <div class="git-repo-top">
                        <strong>{i().nameWithOwner}</strong>
                        <span class="git-chip muted">{i().visibility === "PUBLIC" ? <><Globe size={10} /> público</> : <><Lock size={10} /> privado</>}</span>
                        <Show when={i().isArchived}><span class="git-chip muted">arquivado</span></Show>
                        <ExternalLink size={11} class="git-repo-go" />
                      </div>
                      <Show when={i().description}><small class="git-repo-desc">{i().description}</small></Show>
                      <div class="git-repo-stats">
                        <span title="Issues abertas"><CircleDot size={11} /> {i().issues}</span>
                        <span title="Pull requests abertos"><GitPullRequest size={11} /> {i().pullRequests}</span>
                        <span title="Estrelas"><Star size={11} /> {i().stargazerCount}</span>
                        <Show when={i().latestRelease}><span title="Última versão publicada"><Tag size={11} /> {i().latestRelease!.tagName}</span></Show>
                        <span>enviado {sinceIso(i().pushedAt)}</span>
                      </div>
                    </button>

                    <div class="git-group">Testes automáticos (CI) de {s()?.branch ?? "este branch"}</div>
                    <Show when={g().runs.length} fallback={<div class="git-hint">Nenhuma execução recente neste branch (o repositório pode não ter GitHub Actions).</div>}>
                      <For each={g().runs.slice(0, 5)}>{(r) => <RunRow r={r} />}</For>
                    </Show>

                    <div class="git-group">Pull requests abertos <small>{g().prs.length}</small></div>
                    <Show when={g().prs.length} fallback={<div class="git-hint">Nenhum PR aberto.</div>}>
                      <For each={g().prs}>
                        {(pr) => (
                          <button class="git-pr" classList={{ mine: pr.headRefName === s()?.branch }} onClick={() => open(pr.url)}>
                            <span class="git-pr-icon">{pr.isDraft ? <GitPullRequestDraft size={13} /> : <GitPullRequest size={13} />}</span>
                            <div>
                              <span class="git-pr-title">#{pr.number} {pr.title}</span>
                              <small>
                                {pr.headRefName} → {pr.baseRefName} · {pr.author?.login} · {sinceIso(pr.updatedAt)}
                                <Show when={pr.headRefName === s()?.branch}> · <b>este branch</b></Show>
                              </small>
                              <span class="git-pr-badges">
                                <Show when={pr.isDraft}><span class="git-chip muted">rascunho</span></Show>
                                <Show when={pr.reviewDecision === "APPROVED"}><span class="git-chip ok">aprovado</span></Show>
                                <Show when={pr.reviewDecision === "CHANGES_REQUESTED"}><span class="git-chip warn">pediram mudanças</span></Show>
                                <Show when={pr.checks.fail}><span class="git-chip bad"><CircleX size={10} /> {pr.checks.fail} falhou</span></Show>
                                <Show when={pr.checks.running}><span class="git-chip info"><CircleDashed size={10} /> {pr.checks.running} rodando</span></Show>
                                <Show when={pr.checks.ok && !pr.checks.fail && !pr.checks.running}><span class="git-chip ok"><CircleCheck size={10} /> checks ok</span></Show>
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
  const word = () => (r.status !== "completed" ? "rodando" : ({ success: "passou", failure: "falhou", cancelled: "cancelado", skipped: "pulado", timed_out: "estourou o tempo" } as Record<string, string>)[r.conclusion] ?? r.conclusion);
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
      <strong>Esta pasta não usa git</strong>
      <p>Sem git, não há histórico de versões: não dá para ver o que mudou nem voltar atrás. Para começar, no Terminal desta pasta:</p>
      <button class="git-cmd" onClick={() => copy("git init && git add -A && git commit -m \"Primeira versão\"")}><code>git init && git add -A && git commit -m "Primeira versão"</code><Copy size={11} /></button>
      <p>Ou peça para a IA no chat: "crie um repositório git aqui e faça o primeiro commit".</p>
    </div>
  );
}
