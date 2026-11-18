import { Bot, FolderOpen, Plus, SquareTerminal, X } from "lucide-solid";
import { createEffect, For, on, onCleanup, onMount, Show } from "solid-js";
import { accountById } from "../accounts";
import { isTauri, prettyPath } from "../api";
import { currentProject } from "../store";
import { closeTerm, setActiveTerm, terms } from "../terminal";
import { fitNow, loadExisting, mount, openIn } from "../termView";

/** Caminho longo: só o fim, que é o que diferencia as pastas. */
const short = (s: string) => (s.length > 44 ? `…${s.slice(-43)}` : s);

/** Terminal de verdade do projeto: abas, um shell por aba, aberto na pasta do projeto. */
export default function ProjectTerminal() {
  const p = currentProject;
  const pid = () => p().id;
  const list = () => terms.byProject[pid()] ?? [];
  const active = () => terms.active[pid()] ?? "";
  const real = () => isTauri && !p().demo;
  const acc = () => accountById(p().accountId);
  let box!: HTMLDivElement;

  const add = () => box && openIn(pid(), box);

  // ao entrar no projeto: pega os terminais que já existem; nenhum → abre um
  createEffect(on(pid, async (id) => {
    if (!real()) return;
    if (!terms.loaded[id]) await loadExisting(id);
    // espera o painel ter tamanho: o shell abre já com as colunas certas
    if (pid() === id && !(terms.byProject[id]?.length)) requestAnimationFrame(() => pid() === id && !(terms.byProject[id]?.length) && add());
  }));

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
            <SquareTerminal size={18} />
            <span>{isTauri ? "O projeto de demonstração não tem terminal: adicione uma pasta sua para abrir um." : "O terminal precisa do app: no navegador não dá para abrir um shell."}</span>
          </div>
        }
      >
        <div class="pterm-bar">
          <For each={list()}>
            {(t) => (
              <div class="pterm-tab" classList={{ on: active() === t.id, dead: !t.alive }} onClick={() => setActiveTerm(pid(), t.id)} title={t.alive ? `${t.shell} em ${t.cwd}` : "O shell terminou"}>
                <span class="pterm-dot" />
                <span>{t.name}</span>
                <button title="Fechar este terminal" onClick={(e) => (e.stopPropagation(), closeTerm(pid(), t.id))}><X size={11} /></button>
              </div>
            )}
          </For>
          <button class="pterm-add" title="Novo terminal neste projeto" disabled={terms.opening} onClick={add}><Plus size={13} /></button>
          <div class="pterm-info">
            <span title={p().path}><FolderOpen size={11} /> {short(prettyPath(p().path ?? ""))}</span>
            <Show when={acc().provider === "claude"}>
              <span class="pterm-acc" style={{ "--c": acc().color }} title="O comando claude digitado aqui usa a conta deste projeto"><Bot size={11} /> claude = {acc().label}</span>
            </Show>
          </div>
        </div>
      </Show>
      <div class="pterm-box" ref={box} classList={{ hidden: !real() }} />
      <Show when={real() && !list().length}>
        <div class="pterm-empty">
          <Show when={terms.opening} fallback={<button class="ghost-btn small" onClick={add}><SquareTerminal size={12} /> Abrir um terminal nesta pasta</button>}>
            <span class="spinner" /> Abrindo o terminal…
          </Show>
        </div>
      </Show>
    </div>
  );
}
