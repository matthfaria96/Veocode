// Git e GitHub de cada projeto (src-tauri/src/git.rs). Só leitura: o Veocode mostra o branch,
// o que falta enviar e baixar, as mudanças, os commits e, pelo GitHub CLI, PRs e CI. A única
// ação é "Buscar" (git fetch), que não mexe nos arquivos nem nos branches.

import { invoke } from "@tauri-apps/api/core";
import { createSignal } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { isTauri } from "./api";
import { projects } from "./store";
import { tx, txn } from "./i18n";

/** No navegador e no projeto de demonstração, um exemplo no lugar do git de verdade. */
const real = (pid: string) => isTauri && !projects.find((x) => x.id === pid)?.demo;

export interface GitChange {
  path: string;
  from: string | null;
  index: string;
  work: string;
  untracked: boolean;
  conflict: boolean;
}
export interface GitCommit {
  hash: string;
  short: string;
  author: string;
  time: number;
  subject: string;
  refs: string[];
  pushed: boolean;
  /** hashes dos pais (o desenho usa para ligar as linhas) */
  parents?: string[];
}
export interface CommitFile {
  path: string;
  from: string | null;
  /** A, M, D, R… */
  status: string;
  added: number | null;
  removed: number | null;
}
export interface GitBranch {
  name: string;
  current: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  gone: boolean;
  time: number;
  subject: string;
}
export interface GitRemote {
  name: string;
  url: string;
  github: string | null;
  web: string | null;
}
export interface GitStatus {
  repo: boolean;
  top: string | null;
  prefix: string;
  branch: string | null;
  detached: boolean;
  head: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  changes: GitChange[];
  moreChanges: number;
  commits: GitCommit[];
  incoming: GitCommit[];
  /** todos os branches, para o desenho */
  graph?: GitCommit[];
  branches: GitBranch[];
  stashes: { message: string; time: number }[];
  remotes: GitRemote[];
  fetchedAt: number | null;
  operation: string | null;
  empty: boolean;
}
export interface GitSummary {
  repo: boolean;
  branch: string | null;
  upstream: boolean;
  ahead: number;
  behind: number;
  changed: number;
  conflicts: number;
}
export interface GhPr {
  number: number;
  title: string;
  author: { login: string };
  headRefName: string;
  baseRefName: string;
  isDraft: boolean;
  url: string;
  updatedAt: string;
  reviewDecision: string;
  checks: { ok: number; fail: number; running: number };
}
export interface GhRun {
  databaseId: number;
  name: string;
  displayTitle: string;
  status: string;
  conclusion: string;
  headBranch: string;
  event: string;
  createdAt: string;
  url: string;
}
export interface GitHubInfo {
  state: "ok" | "noRemote" | "noGh" | "noLogin" | "error";
  repo: string | null;
  message: string | null;
  info: {
    nameWithOwner: string;
    url: string;
    description: string;
    visibility: string;
    isFork: boolean;
    isArchived: boolean;
    stargazerCount: number;
    forkCount: number;
    defaultBranchRef: { name: string } | null;
    pushedAt: string;
    latestRelease: { name: string; tagName: string; publishedAt: string; url: string } | null;
    issues: number;
    pullRequests: number;
    viewerPermission: string;
  } | null;
  prs: GhPr[];
  runs: GhRun[];
}

interface Entry {
  status: GitStatus | null;
  error: string;
  loading: boolean;
  fetching: boolean;
  gh: GitHubInfo | null;
  ghLoading: boolean;
  /** quando o GitHub foi lido (ms) */
  ghAt: number;
}

interface State {
  byProject: Record<string, Entry>;
  summaries: Record<string, GitSummary>;
}

/** Aba aberta no painel da direita (Agente, Acesso ou Git); a barra lateral também abre a do Git. */
/** Aba do chat (conversa ou nível de acesso). */
export const [gitTab, setChatTab] = createSignal<"chat" | "access">("chat");
/** Aba da lateral da tela Projetos: arquivos, Git ou Rastro. */
export const [sideTab, setSideTab] = createSignal<"files" | "git" | "trail">("files");
/** Abre a aba pedida no lugar certo (Git e Rastro ficam na lateral; conversa e nível, no chat). */
export function setGitTab(t: "chat" | "access" | "trail" | "git" | "files") {
  if (t === "git" || t === "trail" || t === "files") setSideTab(t);
  else setChatTab(t);
}

export const [git, setGit] = createStore<State>({ byProject: {}, summaries: {} });

const entry = (pid: string): Entry => git.byProject[pid] ?? { status: null, error: "", loading: false, fetching: false, gh: null, ghLoading: false, ghAt: 0 };
const patch = (pid: string, p: Partial<Entry>) => setGit("byProject", pid, { ...entry(pid), ...p });
export const gitOf = (pid: string) => entry(pid);

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function loadGit(pid: string, quiet = false) {
  if (!quiet) patch(pid, { loading: true });
  try {
    const s = real(pid) ? await invoke<GitStatus>("git_status", { projectId: pid }) : demoStatus();
    patch(pid, { status: s, error: "", loading: false });
    setGit("summaries", pid, toSummary(s));
  } catch (e) {
    patch(pid, { error: msg(e), loading: false });
  }
}

/** git fetch: atualiza o que se sabe do remoto (não muda arquivos nem branches). */
export async function fetchGit(pid: string): Promise<string | null> {
  if (entry(pid).fetching) return null;
  patch(pid, { fetching: true });
  try {
    const s = real(pid) ? await invoke<GitStatus>("git_fetch", { projectId: pid }) : demoStatus();
    patch(pid, { status: s, error: "", fetching: false });
    setGit("summaries", pid, toSummary(s));
    return null;
  } catch (e) {
    patch(pid, { fetching: false });
    return msg(e);
  }
}

export async function loadGithub(pid: string, force = false) {
  const e = entry(pid);
  if (e.ghLoading || (!force && e.gh && Date.now() - e.ghAt < 60_000)) return;
  patch(pid, { ghLoading: true });
  try {
    const branch = e.status?.branch ?? null;
    const gh = real(pid) ? await invoke<GitHubInfo>("git_github", { projectId: pid, branch }) : demoGithub();
    patch(pid, { gh, ghLoading: false, ghAt: Date.now() });
  } catch (err) {
    patch(pid, { gh: { state: "error", repo: null, message: msg(err), info: null, prs: [], runs: [] }, ghLoading: false, ghAt: Date.now() });
  }
}

let summaryAt = 0;
/** Resumo de todos os projetos (Visão geral e barra lateral). No máximo a cada 10 s. */
export async function loadSummaries(force = false) {
  if (!isTauri || (!force && Date.now() - summaryAt < 10_000)) return;
  summaryAt = Date.now();
  try {
    const all = await invoke<Record<string, GitSummary>>("git_summaries");
    setGit(produce((s) => Object.assign(s.summaries, all)));
  } catch {
    /* sem git: os projetos só não mostram o resumo */
  }
}

export const forgetGit = (pid: string) =>
  setGit(produce((s) => {
    delete s.byProject[pid];
    delete s.summaries[pid];
  }));

function toSummary(s: GitStatus): GitSummary {
  return {
    repo: s.repo,
    branch: s.branch,
    upstream: !!s.upstream,
    ahead: s.ahead,
    behind: s.behind,
    changed: s.changes.length + s.moreChanges,
    conflicts: s.changes.filter((c) => c.conflict).length,
  };
}

/** Arquivos que um commit mudou. */
export async function commitFiles(pid: string, hash: string): Promise<CommitFile[]> {
  if (!real(pid)) {
    return [
      { path: "src/components/GitPanel.tsx", from: null, status: "M", added: 42, removed: 7 },
      { path: "src/git.ts", from: null, status: "A", added: 120, removed: 0 },
    ];
  }
  return invoke<CommitFile[]>("git_commit_files", { projectId: pid, hash });
}

/** O diff de um arquivo num commit. */
export async function commitDiff(pid: string, hash: string, path: string): Promise<string> {
  if (!real(pid)) return tx("@@ -1,3 +1,4 @@\n import x from \"y\";\n-const velho = 1;\n+const novo = 2;\n+const outro = 3;\n export default x;");
  return invoke<string>("git_commit_diff", { projectId: pid, hash, path });
}

// ---------------------------------------------------------------- textos

/** Situação do git em palavras: "3 para enviar · 55 mudados". Vazio quando está tudo igual. */
export function gitWords(g: { ahead: number; behind: number; changed: number } | undefined | null): { text: string; tip: string }[] {
  if (!g) return [];
  const out: { text: string; tip: string }[] = [];
  if (g.changed) out.push({ text: txn(g.changed, "{n} mudado", "{n} mudados"), tip: tx("Arquivos mudados desde o último commit (ainda não salvos no git)") });
  if (g.ahead) out.push({ text: tx("{ahead} para enviar", { ahead: g.ahead }), tip: tx("Commits que só existem neste computador") });
  if (g.behind) out.push({ text: tx("{behind} para baixar", { behind: g.behind }), tip: tx("Commits que estão no remoto e ainda não aqui") });
  return out;
}

/** "agora", "há 5 min", "há 3 h", "há 2 d", "há 4 sem", "há 3 meses" */
export function since(sec: number | null): string {
  if (!sec) return "nunca";
  const s = Math.max(0, Date.now() / 1000 - sec);
  if (s < 90) return tx("agora");
  if (s < 3600) return tx("há {v} min", { v: Math.round(s / 60) });
  if (s < 86400) return tx("há {v} h", { v: Math.round(s / 3600) });
  if (s < 86400 * 14) return tx("há {v} d", { v: Math.round(s / 86400) });
  if (s < 86400 * 60) return tx("há {v} sem", { v: Math.round(s / 86400 / 7) });
  if (s < 86400 * 365) return tx("há {v} meses", { v: Math.round(s / 86400 / 30) });
  const y = Math.round(s / 86400 / 365);
  return tx("há {y} {v}", { y, v: y === 1 ? "ano" : "anos" });
}
export const sinceIso = (iso: string) => since(Date.parse(iso) / 1000);

/** O que aconteceu com o arquivo, numa letra e numa palavra. */
export function changeLabel(c: GitChange): { letter: string; word: string; tone: "new" | "edit" | "deleted" | "conflict" | "moved" } {
  if (c.conflict) return { letter: "!", word: tx("em conflito"), tone: "conflict" };
  if (c.untracked) return { letter: "N", word: tx("novo, fora do git"), tone: "new" };
  const x = c.index !== "." ? c.index : c.work;
  switch (x) {
    case "A":
      return { letter: "N", word: "novo", tone: "new" };
    case "D":
      return { letter: "A", word: "apagado", tone: "deleted" };
    case "R":
      return { letter: "R", word: tx("renomeado de {v}", { v: c.from ?? "?" }), tone: "moved" };
    case "C":
      return { letter: "C", word: tx("copiado de {v}", { v: c.from ?? "?" }), tone: "moved" };
    default:
      return { letter: "M", word: "modificado", tone: "edit" };
  }
}

export const operationLabel: Record<string, string> = {
  get merge() { return tx("Um merge está no meio do caminho"); },
  get rebase() { return tx("Um rebase está no meio do caminho"); },
  get "cherry-pick"() { return tx("Um cherry-pick está no meio do caminho"); },
  get revert() { return tx("Um revert está no meio do caminho"); },
  get bisect() { return tx("Um bisect está aberto"); },
};

// ---------------------------------------------------------------- exemplo (navegador)

function demoStatus(): GitStatus {
  const now = Date.now() / 1000;
  const c = (short: string, subject: string, ago: number, pushed: boolean, refs: string[] = [], parents: string[] = []): GitCommit => ({ hash: short.repeat(5), short, author: tx("Você"), time: now - ago, subject, refs, pushed, parents: parents.map((p) => p.repeat(5)) });
  return {
    repo: true,
    top: null,
    prefix: "",
    branch: "main",
    detached: false,
    head: "a1b2c3d",
    upstream: "origin/main",
    ahead: 2,
    behind: 1,
    changes: [
      { path: "src/views/Home.tsx", from: null, index: ".", work: "M", untracked: false, conflict: false },
      { path: "src/git.ts", from: null, index: "A", work: ".", untracked: false, conflict: false },
      { path: "notas.txt", from: null, index: "?", work: "?", untracked: true, conflict: false },
    ],
    moreChanges: 0,
    commits: [c("a1b2c3d", tx("Aba Git em cada projeto"), 600, false, ["main"]), c("e4f5a6b", tx("Ícone do app"), 5400, false), c("c7d8e9f", tx("Terminal por projeto"), 86400, true, ["origin/main"]), c("0a1b2c3", tx("Chat livre"), 86400 * 3, true)],
    incoming: [c("9f8e7d6", tx("Corrige o README (feito no GitHub)"), 7200, true, ["origin/main"])],
    graph: [
      c("a1b2c3d", tx("Aba Git em cada projeto"), 600, false, ["main"], ["e4f5a6b"]),
      c("9f8e7d6", tx("Corrige o README (feito no GitHub)"), 7200, true, ["origin/main"], ["c7d8e9f"]),
      c("e4f5a6b", tx("Ícone do app"), 5400, false, [], ["c7d8e9f"]),
      c("b5c6d7e", tx("Começo do tema claro"), 86400 * 2, false, ["tema-claro"], ["0a1b2c3"]),
      c("c7d8e9f", tx("Terminal por projeto"), 86400, true, [], ["0a1b2c3"]),
      c("0a1b2c3", tx("Chat livre"), 86400 * 3, true, [], []),
    ],
    branches: [
      { name: "main", current: true, upstream: "origin/main", ahead: 2, behind: 1, gone: false, time: now - 600, subject: tx("Aba Git em cada projeto") },
      { name: "tema-claro", current: false, upstream: null, ahead: 0, behind: 0, gone: false, time: now - 86400 * 5, subject: tx("Começo do tema claro") },
    ],
    stashes: [{ message: "WIP on main: ajustes", time: now - 86400 }],
    remotes: [{ name: "origin", url: "https://github.com/voce/veocode.git", github: "voce/veocode", web: "https://github.com/voce/veocode" }],
    fetchedAt: now - 1800,
    operation: null,
    empty: false,
  };
}

function demoGithub(): GitHubInfo {
  const iso = (ago: number) => new Date(Date.now() - ago * 1000).toISOString();
  return {
    state: "ok",
    repo: "voce/veocode",
    message: null,
    info: { nameWithOwner: "voce/veocode", url: "https://github.com/voce/veocode", description: tx("Espaço de trabalho para várias contas de IA"), visibility: "PRIVATE", isFork: false, isArchived: false, stargazerCount: 3, forkCount: 0, defaultBranchRef: { name: "main" }, pushedAt: iso(86400), latestRelease: { name: "v0.1.0", tagName: "v0.1.0", publishedAt: iso(86400 * 2), url: "https://github.com/voce/veocode/releases" }, issues: 2, pullRequests: 1, viewerPermission: "ADMIN" },
    prs: [{ number: 12, title: tx("Tema claro"), author: { login: "voce" }, headRefName: "tema-claro", baseRefName: "main", isDraft: true, url: "https://github.com/voce/veocode/pull/12", updatedAt: iso(3600 * 5), reviewDecision: "", checks: { ok: 3, fail: 1, running: 0 } }],
    runs: [
      { databaseId: 2, name: "Build", displayTitle: tx("Terminal por projeto"), status: "completed", conclusion: "success", headBranch: "main", event: "push", createdAt: iso(86400), url: "https://github.com/voce/veocode/actions" },
      { databaseId: 1, name: "Build", displayTitle: tx("Chat livre"), status: "completed", conclusion: "failure", headBranch: "main", event: "push", createdAt: iso(86400 * 3), url: "https://github.com/voce/veocode/actions" },
    ],
  };
}
