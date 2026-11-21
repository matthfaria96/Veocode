import { FolderOpen, Plus, RotateCw, Server, SquareTerminal, X } from "lucide-solid";
import { createEffect, For, on, onCleanup, onMount, Show, type JSX } from "solid-js";
import { accountById } from "../accounts";
import { isTauri, prettyPath } from "../api";
import { prefsOf } from "../chatPrefs";
import { currentProject } from "../store";
import { closeTerm, pendingRun, setActiveTerm, takeRun, terms, writeTerm } from "../terminal";
import { fitNow, loadExisting, mount, openIn } from "../termView";
import { tx } from "../i18n";
import { ClaudeLogo } from "./ui";

/** Caminho longo: só o fim, que é o que diferencia as pastas. */
const short = (s: string) => (s.length > 44 ? `…${s.slice(-43)}` : s);

/** Terminal de verdade do projeto: abas, um shell por aba, aberto na pasta do projeto. */
export default function ProjectTerminal(props: { tools?: JSX.Element }) {
  const p = currentProject;
  const pid = () => p().id;
  const list = () => terms.byProject[pid()] ?? [];
  const active = () => terms.active[pid()] ?? "";
  const real = () => isTauri && !p().demo;
  const acc = () => accountById(p().accountId);
  const cur = () => list().find((t) => t.id === active());
  /** o Code mode ligado/desligado no menu ainda não vale no terminal da frente (abriu antes) */
  const cmStale = () => {
    const t = cur();
    return !!t && t.alive && !t.service && !!prefsOf(pid()).codeMode !== !!t.codeMode;
  };
  let box!: HTMLDivElement;

  const add = () => box && openIn(pid(), box);

  /** Comando pedido de fora (o "Atualizar no Terminal" do menu da IA): terminal novo e digita. */
  const runPending = async () => {
    if (!real() || !box || terms.opening) return;
    const cmd = takeRun(pid());
    if (!cmd) return;
    const t = await openIn(pid(), box);
    if (t) void writeTerm(t.id, `${cmd}\r`);
  };

  // ao entrar no projeto: pega os terminais que já existem; nenhum → abre um
  createEffect(on(pid, async (id) => {
    if (!real()) return;
    if (!terms.loaded[id]) await loadExisting(id);
    if (pid() === id && pendingRun()?.pid === id) return requestAnimationFrame(() => void runPending());
    // espera o painel ter tamanho: o shell abre já com as colunas certas
    if (pid() === id && !(terms.byProject[id]?.length)) requestAnimationFrame(() => pid() === id && !(terms.byProject[id]?.length) && add());
  }));
  createEffect(on(pendingRun, (r) => r?.pid === pid() && terms.loaded[pid()] && requestAnimationFrame(() => void runPending())));

  createEffect(on([active, pid], ([id]) => {
    if (!box) return;
    if (!id) return terms.opening || box.replaceChildren();
    requestAnimationFrame(() => mount(id, box));
  }));

  onMount(() => {
    const ro = new ResizeObserver(() => fitNow(active()));
    ro.observe(box);
    onCleanup(() => ro.disconnect());
  });

  return (
    <div class="pterm">
      <Show
        when={real()}
        fallback={
          <div class="pterm-empty">
            <Show when={props.tools}><div class="pterm-tools floating">{props.tools}</div></Show>
            <SquareTerminal size={18} />
            <span>{isTauri ? tx("O projeto de demonstração não tem terminal: adicione uma pasta sua para abrir um.") : tx("O terminal precisa do app: no navegador não dá para abrir um shell.")}</span>
          </div>
        }
      >
        <div class="pterm-bar">
          <For each={list()}>
            {(t) => (
              <div
                class="pterm-tab"
                classList={{ on: active() === t.id, dead: !t.alive, svc: !!t.service }}
                onClick={() => setActiveTerm(pid(), t.id)}
                title={t.service ? (t.alive ? tx("Serviço: {cmd} em {cwd}", { cmd: t.cmd ?? "", cwd: t.cwd }) : tx("O serviço parou: reinicie pela aba Ambiente")) : t.alive ? tx("{shell} em {cwd}", { shell: t.shell, cwd: t.cwd }) : tx("O shell terminou")}
              >
                <Show when={t.service} fallback={<span class="pterm-dot" />}><Server size={11} class="pterm-svc" /></Show>
                <span>{t.name}</span>
                <button title={t.service ? tx("Parar o serviço e fechar") : tx("Fechar este terminal")} onClick={(e) => (e.stopPropagation(), closeTerm(pid(), t.id))}><X size={11} /></button>
              </div>
            )}
          </For>
          <button class="pterm-add" title={tx("Novo terminal neste projeto")} disabled={terms.opening} onClick={add}><Plus size={13} /></button>
          <div class="pterm-info">
            <span title={p().path}><FolderOpen size={11} /> {short(prettyPath(p().path ?? ""))}</span>
            <Show when={acc().provider === "claude"}>
              <span class="pterm-acc" style={{ "--c": acc().color }} title={tx("O comando claude digitado aqui usa a conta deste projeto")}><ClaudeLogo size={11} /> {tx("claude = {label}", { label: acc().label })}</span>
              <Show
                when={cmStale()}
                fallback={<Show when={cur()?.codeMode}><span class="pterm-cm" title={tx("O claude aberto neste terminal usa o Code mode")}>{tx("Code mode")}</span></Show>}
              >
                <button class="pterm-cm stale" onClick={add} title={tx("Terminais que já estavam abertos ficam como estavam. Abra um novo para valer.")}>
                  <RotateCw size={11} /> {prefsOf(pid()).codeMode ? tx("Code mode: abrir terminal novo") : tx("Sem Code mode: abrir terminal novo")}
                </button>
              </Show>
            </Show>
          </div>
          <Show when={props.tools}><div class="pterm-tools">{props.tools}</div></Show>
        </div>
      </Show>
      <div class="pterm-box" ref={box} classList={{ hidden: !real() }} />
      <Show when={real() && !list().length}>
        <div class="pterm-empty">
          <Show when={terms.opening} fallback={<button class="ghost-btn small" onClick={add}><SquareTerminal size={12} /> {tx("Abrir um terminal nesta pasta")}</button>}>
            <span class="spinner" /> {tx("Abrindo o terminal…")}
          </Show>
        </div>
      </Show>
    </div>
  );
}
