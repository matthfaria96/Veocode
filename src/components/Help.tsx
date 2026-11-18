import { ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Bot, Boxes, FolderOpen, Gauge, MessageSquare, MessagesSquare, Network, Puzzle, Radar, Rocket, Settings, X, type LucideProps } from "lucide-solid";
import { createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { setHelpOpen, setView, view } from "../store";
import { topicForView, topics, type TopicId } from "../help/topics";
import { scenes } from "../help/Scenes";

const icons: Record<TopicId, (p: LucideProps) => JSX.Element> = {
  inicio: Rocket,
  mapa: Network,
  projetos: FolderOpen,
  nivel: Gauge,
  chat: MessageSquare,
  livre: MessagesSquare,
  contas: Bot,
  inventario: Boxes,
  raiox: Radar,
  skills: Puzzle,
  ajustes: Settings,
  palavras: BookOpen,
};

/** Ajuda ilustrada: um tópico por tela, com desenho animado e explicação curta. Abre no tópico da tela atual. */
export default function Help() {
  const [id, setId] = createSignal<TopicId>(topicForView(view()));
  const index = () => topics.findIndex((t) => t.id === id());
  const topic = () => topics[index()];
  const go = (d: number) => setId(topics[(index() + d + topics.length) % topics.length].id);

  let body!: HTMLDivElement;
  const pick = (t: TopicId) => {
    setId(t);
    body.scrollTop = 0;
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") setHelpOpen(false);
    else if (e.key === "ArrowDown" || e.key === "ArrowRight") (e.preventDefault(), go(1), (body.scrollTop = 0));
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") (e.preventDefault(), go(-1), (body.scrollTop = 0));
  };
  onMount(() => window.addEventListener("keydown", onKey));
  onCleanup(() => window.removeEventListener("keydown", onKey));

  const openScreen = () => {
    const v = topic().view;
    if (v) setView(v);
    setHelpOpen(false);
  };

  return (
    <div class="palette-backdrop help-backdrop" onClick={() => setHelpOpen(false)}>
      <div class="help" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Ajuda">
        <nav class="help-nav">
          <div class="help-nav-head">
            <strong>Ajuda</strong>
            <small>Como o Veocode funciona</small>
          </div>
          <For each={topics}>
            {(t, i) => (
              <>
                <Show when={i() === 1 || i() === topics.length - 1}><div class="help-nav-sep" /></Show>
                <button classList={{ active: id() === t.id }} onClick={() => pick(t.id)}>
                  <Dynamic component={icons[t.id]} size={15} />
                  <span>{t.title}</span>
                </button>
              </>
            )}
          </For>
          <div class="help-keys">
            <span><kbd>↑</kbd><kbd>↓</kbd> tópicos</span>
            <span><kbd>esc</kbd> fechar</span>
          </div>
        </nav>

        <div class="help-body" ref={body}>
          <button class="icon-btn help-close" title="Fechar (esc)" onClick={() => setHelpOpen(false)}><X size={16} /></button>
          <Show when={topic()} keyed>
            {(t) => (
              <article class="help-article">
                <div class="help-scene">
                  <Dynamic component={scenes[t.id]} />
                </div>
                <div class="help-title">
                  <span class="help-title-icon"><Dynamic component={icons[t.id]} size={18} /></span>
                  <div>
                    <h2>{t.title}</h2>
                    <Show when={t.where}><small>{t.where}</small></Show>
                  </div>
                </div>
                <p class="help-lead">{t.lead}</p>

                <For each={t.sections}>
                  {(s, si) => (
                    <section class="help-section" style={{ "animation-delay": `${120 + si() * 70}ms` }}>
                      <h3>{s.title}</h3>
                      <Show
                        when={s.title === "Em quatro passos"}
                        fallback={
                          <ul>
                            <For each={s.items}>{(it) => <li>{it}</li>}</For>
                          </ul>
                        }
                      >
                        <ol class="help-steps">
                          <For each={s.items}>{(it, n) => <li><span>{n() + 1}</span><p>{it}</p></li>}</For>
                        </ol>
                      </Show>
                    </section>
                  )}
                </For>

                <Show when={t.terms}>
                  <dl class="help-terms">
                    <For each={t.terms}>
                      {([term, def], n) => (
                        <div style={{ "animation-delay": `${n() * 35}ms` }}>
                          <dt>{term}</dt>
                          <dd>{def}</dd>
                        </div>
                      )}
                    </For>
                  </dl>
                </Show>

                <footer class="help-foot">
                  <button class="ghost-btn" onClick={() => (go(-1), (body.scrollTop = 0))}><ArrowLeft size={14} /> {topics[(index() - 1 + topics.length) % topics.length].title}</button>
                  <Show when={t.view}>
                    <button class="primary-btn" onClick={openScreen}>Abrir esta tela <ArrowUpRight size={14} /></button>
                  </Show>
                  <button class="ghost-btn" onClick={() => (go(1), (body.scrollTop = 0))}>{topics[(index() + 1) % topics.length].title} <ArrowRight size={14} /></button>
                </footer>
              </article>
            )}
          </Show>
        </div>
      </div>
    </div>
  );
}
