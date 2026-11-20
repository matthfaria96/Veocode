// Um commit aberto no lugar do editor: os arquivos que ele mudou à esquerda e, ao lado, o que
// cada um era antes (no commit pai) e como ficou, lado a lado ou numa coluna só. Abre ao clicar
// num commit do gráfico, no painel Git.
import { Cloud, Copy, ExternalLink, FileText, GitCommitHorizontal, Laptop, Tag } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import { api } from "../api";
import { commitByHash, commitDiff, commitFiles, gitOf, since, type CommitFile } from "../git";
import { openRealFile } from "../realProject";
import { currentProject, openFile, showToast } from "../store";
import { DiffRows, parseDiff, SplitSwitch, split, WideButton } from "./DiffView";
import { FileIcon } from "./icons";
import { locale, tx, txn } from "../i18n";

const letter: Record<string, { l: string; tone: string; word: string }> = {
  A: { l: "N", tone: "new", word: "arquivo novo" },
  M: { l: "M", tone: "edit", word: "modificado" },
  D: { l: "A", tone: "deleted", word: "apagado" },
  R: { l: "R", tone: "moved", word: "renomeado ou movido" },
  C: { l: "C", tone: "moved", word: "copiado" },
  T: { l: "T", tone: "edit", word: "tipo mudou" },
};
const letterOf = (s: string) => letter[s[0]] ?? { l: s[0] ?? "?", tone: "edit", word: s };

export default function CommitView(props: { hash: string }) {
  const pid = () => currentProject().id;
  const c = () => commitByHash(pid(), props.hash);
  const short = () => c()?.short ?? props.hash.slice(0, 7);
  const parent = () => c()?.parents?.[0]?.slice(0, 7);
  const web = () => gitOf(pid()).status?.remotes.find((r) => r.web)?.web ?? null;
  const ghUrl = () => (web()?.includes("github.com") && c()?.pushed ? `${web()}/commit/${props.hash}` : null);

  const [files, setFiles] = createSignal<CommitFile[] | null>(null);
  const [err, setErr] = createSignal("");
  const [sel, setSel] = createSignal<string | null>(null);
  const [raw, setRaw] = createSignal<string | null>(null);
  const [diffErr, setDiffErr] = createSignal("");

  createEffect(on(() => [pid(), props.hash] as const, async ([p, h]) => {
    setFiles(null);
    setErr("");
    setSel(null);
    try {
      const list = await commitFiles(p, h);
      if (p !== pid() || h !== props.hash) return;
      setFiles(list);
      setSel(list[0]?.path ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }));
  let seq = 0;
  createEffect(on(sel, async (path) => {
    const my = ++seq;
    setRaw(null);
    setDiffErr("");
    if (!path) return;
    try {
      const d = await commitDiff(pid(), props.hash, path);
      if (my === seq) setRaw(d);
    } catch (e) {
      if (my === seq) setDiffErr(e instanceof Error ? e.message : String(e));
    }
  }));

  const d = createMemo(() => (raw() === null ? null : parseDiff(raw()!)));
  const total = () => (files() ?? []).reduce((t, f) => ({ a: t.a + (f.added ?? 0), r: t.r + (f.removed ?? 0) }), { a: 0, r: 0 });
  const cur = () => files()?.find((f) => f.path === sel());
  const step = (dir: number) => {
    const list = files() ?? [];
    const i = list.findIndex((f) => f.path === sel());
    const next = list[Math.max(0, Math.min(list.length - 1, i + dir))];
    if (next) {
      setSel(next.path);
      requestAnimationFrame(() => document.querySelector(`.cm-file[data-path="${CSS.escape(next.path)}"]`)?.scrollIntoView({ block: "nearest" }));
    }
  };
  const copyHash = () => navigator.clipboard?.writeText(props.hash).then(() => showToast(tx("Hash do commit copiado"))).catch(() => {});
  const openNow = (path: string) => (currentProject().demo ? openFile(path) : openRealFile(path));

  return (
    <div class="diff-view commit-view">
      <header class="cm-head">
        <span class="cm-icon"><GitCommitHorizontal size={16} /></span>
        <div class="cm-title">
          <strong title={c()?.subject}>{c()?.subject ?? tx("Commit {v}", { v: short() })}</strong>
          <small>
            <Show when={c()}>
              {(x) => (
                <>
                  <span class="cm-where" classList={{ pushed: x().pushed }} title={x().pushed ? tx("Já está no remoto (nuvem)") : tx("Só neste computador: ainda não foi enviado")}>
                    {x().pushed ? <Cloud size={11} /> : <Laptop size={11} />} {x().pushed ? tx("no remoto") : tx("só aqui")}
                  </span>
                  <span>{x().author}</span>
                  <span title={new Date(x().time * 1000).toLocaleString(locale())}>{since(x().time)}</span>
                  <For each={x().refs.filter((r) => !r.endsWith("/HEAD")).slice(0, 3)}>
                    {(r) => <span class="git-ref" classList={{ tag: r.startsWith("tag: ") }}>{r.startsWith("tag: ") ? <><Tag size={9} />{r.slice(5)}</> : r}</span>}
                  </For>
                </>
              )}
            </Show>
            <button class="cm-hash" title={tx("Copiar o hash completo")} onClick={copyHash}><code>{short()}</code><Copy size={10} /></button>
          </small>
        </div>
        <span class="df-tools">
          <SplitSwitch />
          <Show when={ghUrl()}>
            <button class="ghost-btn small" title={tx("Ver este commit no GitHub")} onClick={() => void api.openUrl(ghUrl()!).catch(() => {})}><ExternalLink size={12} /> {tx("GitHub")}</button>
          </Show>
          <WideButton />
        </span>
      </header>

      <Show when={!err()} fallback={<div class="df-empty">{err()}</div>}>
        <Show when={files()} fallback={<div class="df-empty"><span class="spinner" /> {tx("Lendo o commit…")}</div>}>
          {(list) => (
            <Show when={list().length} fallback={<div class="df-empty"><strong>{tx("Sem arquivos")}</strong><span>{tx("Este commit não mudou arquivos (é só uma junção).")}</span></div>}>
              <div class="cm-body">
                <nav
                  class="cm-files"
                  aria-label={tx("Arquivos do commit")}
                  tabindex="0"
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown" || e.key === "j") (e.preventDefault(), step(1));
                    if (e.key === "ArrowUp" || e.key === "k") (e.preventDefault(), step(-1));
                  }}
                >
                  <div class="cm-files-head">
                    <span>{txn(list().length, "{n} arquivo", "{n} arquivos")}</span>
                    <span class="df-count"><b class="plus">+{total().a}</b><b class="minus">−{total().r}</b></span>
                  </div>
                  <For each={list()}>
                    {(f) => {
                      const name = f.path.split("/").pop() ?? f.path;
                      const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
                      const l = letterOf(f.status);
                      return (
                        <button class="cm-file" classList={{ on: sel() === f.path }} data-path={f.path} title={`${f.from ? `${f.from} → ` : ""}${f.path} · ${tx(l.word)}`} onClick={() => setSel(f.path)}>
                          <FileIcon name={name} size={13} />
                          <span class="cm-file-name">
                            <span>{name}</span>
                            <Show when={dir}><small>{dir}</small></Show>
                          </span>
                          <Show when={f.added !== null} fallback={<small class="cm-bin">{tx("binário")}</small>}>
                            <span class="git-file-n"><Show when={f.added}><b class="plus">+{f.added}</b></Show><Show when={f.removed}><b class="minus">−{f.removed}</b></Show></span>
                          </Show>
                          <span class={`git-letter ${l.tone}`}>{l.l}</span>
                        </button>
                      );
                    }}
                  </For>
                </nav>
                <section class="cm-diff">
                  <Show when={cur()}>
                    {(f) => (
                      <div class="df-head sub">
                        <FileIcon name={f().path.split("/").pop() ?? f().path} size={13} />
                        <span class="df-name" title={f().path}>
                          <strong>{f().path.split("/").pop()}</strong>
                          <small>{f().from ? tx("antes {v}", { v: f().from }) : f().path.includes("/") ? f().path.slice(0, f().path.lastIndexOf("/")) : ""}</small>
                        </span>
                        <Show when={d()}>
                          {(x) => (
                            <span class="df-count">
                              <Show when={x().isNew}><em class="df-tag new">{tx("arquivo novo")}</em></Show>
                              <Show when={x().gone}><em class="df-tag gone">{tx("apagado")}</em></Show>
                              <b class="plus">+{x().added}</b>
                              <b class="minus">−{x().removed}</b>
                            </span>
                          )}
                        </Show>
                        <span class="df-tools">
                          <Show when={!d()?.gone}>
                            <button class="icon-btn small" title={tx("Abrir o arquivo como está agora")} onClick={() => openNow(f().path)}><FileText size={13} /></button>
                          </Show>
                        </span>
                      </div>
                    )}
                  </Show>
                  <Show when={split() && d() && d()!.rows.length}>
                    <div class="df-cols">
                      <span><b>{tx("Antes")}</b> {parent() ? tx("no commit {v}", { v: parent() }) : ""}</span>
                      <span><b>{tx("Depois")}</b> {tx("no commit {v}", { v: short() })}</span>
                    </div>
                  </Show>
                  <div class="df-body">
                    <Show when={!diffErr()} fallback={<div class="df-empty">{diffErr()}</div>}>
                      <Show when={d()} fallback={<div class="df-empty"><span class="spinner" /> {tx("Lendo as mudanças…")}</div>}>
                        {(x) => (
                          <Show when={!x().binary} fallback={<div class="df-empty">{tx("Arquivo binário: o git não mostra as linhas dele.")}</div>}>
                            <Show when={x().rows.length} fallback={<div class="df-empty">{tx("Nada para mostrar neste arquivo.")}</div>}>
                              <DiffRows rows={x().rows} ext={(sel() ?? "").split(".").pop() ?? ""} split={split()} />
                            </Show>
                          </Show>
                        )}
                      </Show>
                    </Show>
                  </div>
                </section>
              </div>
            </Show>
          )}
        </Show>
      </Show>
    </div>
  );
}
