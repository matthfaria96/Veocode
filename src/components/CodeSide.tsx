// Modo Código, à direita: o painel que abre e fecha pelo ícone ao lado do terminal (⌥⌘B).
// Só o que serve enquanto você mexe no código: o Git (com o número do que falta resolver), a
// conversa com a IA ao lado do código (como o Claude Code no VS Code), o Ambiente (perfis do
// .env e os serviços do projeto) e, se você pôs ele aqui, o terminal. Comandos, atividade,
// subagentes e rastro moram no painel do modo IA.
import { GitBranch, MessagesSquare, PanelBottom, SlidersHorizontal, SquareTerminal, X } from "lucide-solid";
import { lazy, Match, Show, Suspense, Switch } from "solid-js";
import { pendingOf } from "../git";
import { projectLive } from "../convList";
import { runningCount } from "../envs";
import { codeSideTab, moveTerm, setCodeSideOpen, setCodeSideTab, termAt, type CodeSideTab } from "../layoutMode";
import { currentProject } from "../store";
import ChatPanel from "./ChatPanel";
import EnvPanel from "./EnvPanel";
import GitPanel from "./GitPanel";
import { tx, txn } from "../i18n";

// o xterm só carrega quando o terminal aparece
const ProjectTerminal = lazy(() => import("./ProjectTerminal"));

/** Bolinha com número, como no VS Code: arquivos mudados sem commit; sem mudanças, o que falta
 *  enviar (↑) ou baixar (↓). Vermelha quando há conflito. Nada a resolver: não aparece. */
export function GitCount(props: { pid: string }) {
  const p = () => pendingOf(props.pid);
  const tip = () =>
    [
      p().changed ? txn(p().changed, "{n} arquivo mudado sem commit", "{n} arquivos mudados sem commit") : "",
      p().conflicts ? txn(p().conflicts, "{n} em conflito", "{n} em conflito") : "",
      p().ahead ? txn(p().ahead, "{n} commit para enviar", "{n} commits para enviar") : "",
      p().behind ? txn(p().behind, "{n} commit para baixar", "{n} commits para baixar") : "",
    ]
      .filter(Boolean)
      .join(" · ");
  return (
    <Show when={p().repo && (p().changed || p().ahead || p().behind)}>
      <Show
        when={p().changed}
        fallback={
          <i class="git-count sync" title={tip()}>
            {p().ahead ? `↑${p().ahead}` : ""}
            {p().behind ? `↓${p().behind}` : ""}
          </i>
        }
      >
        <i class="git-count" classList={{ bad: p().conflicts > 0 }} title={tip()}>{p().changed > 99 ? "99+" : p().changed}</i>
      </Show>
    </Show>
  );
}

export default function CodeSide() {
  const pid = () => currentProject().id;
  const live = () => projectLive(pid());
  const tabs = (): { id: CodeSideTab; label: string; hint: string; icon: typeof GitBranch }[] => [
    { id: "git", label: tx("Git"), hint: tx("O que mudou, commit, enviar e baixar, e o GitHub"), icon: GitBranch },
    { id: "chat", label: tx("Conversa"), hint: tx("A conversa com a IA ao lado do código. O arquivo aberto no editor pode ir junto no pedido."), icon: MessagesSquare },
    { id: "env", label: tx("Ambiente"), hint: tx("Perfis do .env (qual banco, qual API…) e os serviços do projeto: trocar um perfil reinicia quem lê aquele .env"), icon: SlidersHorizontal },
    ...(termAt() === "side" ? [{ id: "term" as const, label: tx("Terminal"), hint: tx("Terminal desta pasta (⌘J)"), icon: SquareTerminal }] : []),
  ];

  return (
    <aside class="debug-pane code-side">
      <div class="dbg-tabs" role="tablist">
        {tabs().map((t) => (
          <button role="tab" aria-selected={codeSideTab() === t.id} classList={{ on: codeSideTab() === t.id }} onClick={() => setCodeSideTab(t.id)} title={t.hint}>
            <t.icon size={13} />
            <span>{t.label}</span>
            <Show when={t.id === "git"}><GitCount pid={pid()} /></Show>
            <Show when={t.id === "chat" && live().ask}><i class="cv-gask" title={tx("Esperando você")} /></Show>
            <Show when={t.id === "chat" && !live().ask && live().busy}><i class="ctool-live" title={tx("Trabalhando")} /></Show>
            <Show when={t.id === "env" && runningCount(pid())}><i class="git-count run" title={txn(runningCount(pid()), "{n} serviço rodando", "{n} serviços rodando")}>{runningCount(pid())}</i></Show>
          </button>
        ))}
        <span class="dbg-spacer" />
        <button class="icon-btn small" title={tx("Esconder o painel (⌥⌘B)")} onClick={() => setCodeSideOpen(false)}><X size={13} /></button>
      </div>
      <div class="dbg-body">
        <Switch>
          <Match when={codeSideTab() === "git"}><div class="side-scroll"><GitPanel /></div></Match>
          <Match when={codeSideTab() === "chat"}><ChatPanel slim docked /></Match>
          <Match when={codeSideTab() === "env"}><EnvPanel /></Match>
          <Match when={codeSideTab() === "term" && termAt() === "side"}>
            <section class="code-term docked">
              <Suspense fallback={<div class="pterm-empty"><span class="spinner" /> {tx("Carregando o terminal…")}</div>}>
                <ProjectTerminal
                  tools={
                    <button class="icon-btn small" title={tx("Pôr o terminal embaixo do editor")} onClick={() => moveTerm("bottom")}>
                      <PanelBottom size={13} />
                    </button>
                  }
                />
              </Suspense>
            </section>
          </Match>
        </Switch>
      </div>
    </aside>
  );
}
