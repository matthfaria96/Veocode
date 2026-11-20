import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { Check, CircleHelp, FolderOpen, Keyboard, Languages, Monitor, Moon, Palette, PanelRight, Sun, Waves } from "lucide-solid";
import { createResource, For, Show, type JSX } from "solid-js";
import { api, isTauri, prettyPath } from "../api";
import { setHelpOpen, showToast } from "../store";
import { settings, updateSettings, type IconStyle, type Motion } from "../settings";
import { FileIcon, FolderIcon, ProjectIcon } from "../components/icons";
import { PageHeader } from "../components/ui";
import { tx } from "../i18n";

/** Árvore de exemplo da prévia: mostra pastas especiais e vários tipos de arquivo. */
const sample: { name: string; dir?: boolean; open?: boolean; depth: number }[] = [
  { name: "src", dir: true, open: true, depth: 0 },
  { name: "components", dir: true, depth: 1 },
  { name: "App.tsx", depth: 1 },
  { name: "main.rs", depth: 1 },
  { name: "styles.css", depth: 1 },
  { name: "assets", dir: true, depth: 0 },
  { name: "tests", dir: true, depth: 0 },
  { name: "package.json", depth: 0 },
  { name: "README.md", depth: 0 },
];

function IconPreview(props: { style: IconStyle }) {
  return (
    <div class="set-preview">
      <div class="set-preview-projects">
        <For each={[["veocode", "Rust · Tauri · Solid"], ["site-loja", "TypeScript · Vite"], ["analise", tx("Python")]]}>
          {([name, stack]) => (
            <div class="set-proj">
              <ProjectIcon id={name} name={name} stack={stack} size={16} style={props.style} />
              <span>{name}</span>
            </div>
          )}
        </For>
      </div>
      <div class="set-preview-tree">
        <For each={sample}>
          {(r) => (
            <div class="set-tree-row" style={{ "padding-left": `${6 + r.depth * 12}px` }}>
              {r.dir ? <FolderIcon name={r.name} open={r.open} style={props.style} /> : <FileIcon name={r.name} style={props.style} />}
              <span>{r.name}</span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

function MotionPreview(props: { motion: Motion }) {
  return (
    <div class="set-preview set-motion" classList={{ "keep-motion": props.motion === "completa", still: props.motion === "reduzida" }}>
      <div class="set-motion-row">
        <span class="set-motion-dot" />
        <span class="set-motion-bar"><i /></span>
      </div>
      <div class="set-motion-row">
        <span class="set-motion-card" />
        <span class="set-motion-card" style={{ "animation-delay": "0.15s" }} />
        <span class="set-motion-card" style={{ "animation-delay": "0.3s" }} />
      </div>
    </div>
  );
}

function ThemePreview(props: { kind: "dark" | "light" | "auto"; icon: JSX.Element }) {
  return (
    <div class={`theme-preview tp-${props.kind}`}>
      <div class="tp-half tp-d"><i /><b /><b /></div>
      <div class="tp-half tp-l"><i /><b /><b /></div>
      <span class="tp-icon">{props.icon}</span>
    </div>
  );
}

function LangPreview(props: { tag: JSX.Element; lines: string[] }) {
  return (
    <div class="set-preview lang-preview">
      <span class="lang-tag">{props.tag}</span>
      <For each={props.lines}>{(l, i) => <span class="lang-line" style={{ opacity: i() ? 0.6 : 1 }}>{l}</span>}</For>
    </div>
  );
}

function PanelPreview(props: { open: boolean }) {
  // o modo Código em miniatura: o editor e, à direita, o painel com a aba Terminal
  return (
    <div class="set-preview panel-preview side">
      <span class="pp-code"><i /><i /><i class="short" /><i /><i class="short" /></span>
      <Show when={props.open}>
        <span class="pp-panel"><b /><i /><i /><i /></span>
      </Show>
    </div>
  );
}

function Choice<T extends string>(props: { value: T; current: T; title: string; desc: string; onPick: (v: T) => void; children: JSX.Element }) {
  const on = () => props.value === props.current;
  return (
    <button class="set-card" classList={{ on: on() }} role="radio" aria-checked={on()} onClick={() => props.onPick(props.value)}>
      {props.children}
      <div class="set-card-foot">
        <span class="set-radio">
          <Show when={on()}><Check size={11} stroke-width={3} /></Show>
        </span>
        <div>
          <strong>{props.title}</strong>
          <small>{props.desc}</small>
        </div>
      </div>
    </button>
  );
}

function Section(props: { icon: JSX.Element; title: string; desc?: string; children: JSX.Element; delay?: number }) {
  return (
    <section class="set-section" style={{ "animation-delay": `${props.delay ?? 0}ms` }}>
      <div class="set-section-head">
        <span class="inv-cat-icon">{props.icon}</span>
        <div>
          <strong>{props.title}</strong>
          <Show when={props.desc}><small>{props.desc}</small></Show>
        </div>
      </div>
      {props.children}
    </section>
  );
}

export default function Settings() {
  const [paths] = createResource(() => (isTauri ? invoke<{ config: string; data: string }>("app_paths") : Promise.resolve(null)));
  const [version] = createResource(() => (isTauri ? getVersion() : Promise.resolve("navegador")));
  const reveal = (p: string) => api.reveal(p).catch((e) => showToast(String(e)));

  return (
    <div class="page">
      <PageHeader title={tx("Ajustes")} subtitle={tx("Como o Veocode aparece e onde ele guarda as coisas. As mudanças valem na hora.")} />

      <Section icon={<Sun size={15} />} title={tx("Claro ou escuro")} desc={tx("As cores do app inteiro. O terminal continua escuro.")}>
        <div class="set-cards three" role="radiogroup" aria-label={tx("Claro ou escuro")}>
          <Choice value="escuro" current={settings.theme} title={tx("Escuro")} desc={tx("Fundo escuro, bom à noite e em salas com pouca luz.")} onPick={(v) => updateSettings({ theme: v })}>
            <ThemePreview kind="dark" icon={<Moon size={16} />} />
          </Choice>
          <Choice value="claro" current={settings.theme} title={tx("Claro")} desc={tx("Fundo claro, mais fácil de ler de dia e com o sol batendo.")} onPick={(v) => updateSettings({ theme: v })}>
            <ThemePreview kind="light" icon={<Sun size={16} />} />
          </Choice>
          <Choice value="sistema" current={settings.theme} title={tx("Igual ao computador")} desc={tx("Troca sozinho quando o computador muda entre claro e escuro.")} onPick={(v) => updateSettings({ theme: v })}>
            <ThemePreview kind="auto" icon={<Monitor size={16} />} />
          </Choice>
        </div>
      </Section>

      <Section icon={<Languages size={15} />} title={tx("Idioma")} desc={tx("Os textos do app inteiro. As conversas com a IA seguem o idioma em que você escreve.")} delay={40}>
        <div class="set-cards three" role="radiogroup" aria-label={tx("Idioma")}>
          <Choice value="sistema" current={settings.language} title={tx("Igual ao computador")} desc={tx("Português se o computador estiver em português; inglês nos outros casos.")} onPick={(v) => updateSettings({ language: v })}>
            <LangPreview tag={<Monitor size={15} />} lines={[tx("Projetos"), tx("Contas e IAs")]} />
          </Choice>
          <Choice value="pt" current={settings.language} title="Português" desc="Todos os textos em português do Brasil." onPick={(v) => updateSettings({ language: v })}>
            <LangPreview tag="PT" lines={["Projetos", "Contas e IAs"]} />
          </Choice>
          <Choice value="en" current={settings.language} title="English" desc="Every screen and message in English." onPick={(v) => updateSettings({ language: v })}>
            <LangPreview tag="EN" lines={["Projects", "Accounts and AIs"]} />
          </Choice>
        </div>
      </Section>

      <Section icon={<Palette size={15} />} title={tx("Ícones")} desc={tx("Pastas, arquivos e projetos em todas as telas.")}>
        <div class="set-cards" role="radiogroup" aria-label={tx("Estilo dos ícones")}>
          <Choice value="detalhado" current={settings.icons} title={tx("Detalhados")} desc={tx("Pastas com volume e cor, arquivos com a etiqueta do tipo e projetos com a sigla da tecnologia.")} onPick={(v) => updateSettings({ icons: v })}>
            <IconPreview style="detalhado" />
          </Choice>
          <Choice value="minimalista" current={settings.icons} title={tx("Minimalistas")} desc={tx("Traços finos de uma cor só. Mais discretos e leves para os olhos.")} onPick={(v) => updateSettings({ icons: v })}>
            <IconPreview style="minimalista" />
          </Choice>
        </div>
      </Section>

      <Section icon={<Waves size={15} />} title={tx("Animações")} desc={tx("Cursores, entradas das listas, pulsos e gráficos.")} delay={80}>
        <div class="set-cards" role="radiogroup" aria-label={tx("Animações")}>
          <Choice value="completa" current={settings.motion} title={tx("Completas")} desc={tx("Movimento só onde ajuda: o cursor da IA no arquivo que ela mexe, a espera da resposta e os pedidos de permissão. Nada fica piscando à toa.")} onPick={(v) => updateSettings({ motion: v })}>
            <MotionPreview motion="completa" />
          </Choice>
          <Choice value="reduzida" current={settings.motion} title={tx("Reduzidas")} desc={tx("Sem laços nem deslizes: as mudanças aparecem direto. Bom para quem se incomoda com movimento.")} onPick={(v) => updateSettings({ motion: v })}>
            <MotionPreview motion="reduzida" />
          </Choice>
        </div>
      </Section>

      <Section icon={<PanelRight size={15} />} title={tx("Terminal no modo Código")} desc={tx("O terminal é uma aba do painel da direita do modo Código, ao lado do Git e do Ambiente. ⌘J abre direto nele; o ícone do painel (⌥⌘B) mostra e esconde.")} delay={120}>
        <div class="set-cards" role="radiogroup" aria-label={tx("Terminal no modo Código")}>
          <Choice value="fechado" current={settings.bottomPanel ? "aberto" : "fechado"} title={tx("Começa fechado")} desc={tx("Mais espaço para o código. Quando quiser o terminal, é um clique.")} onPick={() => updateSettings({ bottomPanel: false })}>
            <PanelPreview open={false} />
          </Choice>
          <Choice value="aberto" current={settings.bottomPanel ? "aberto" : "fechado"} title={tx("Começa aberto")} desc={tx("O terminal já aparece aberto na pasta do projeto ao abrir o app.")} onPick={() => updateSettings({ bottomPanel: true })}>
            <PanelPreview open={true} />
          </Choice>
        </div>
      </Section>

      <Section icon={<FolderOpen size={15} />} title={tx("Onde o Veocode guarda as coisas")} delay={160}>
        <div class="set-rows">
          <div class="set-row">
            <div>
              <strong>{tx("Configuração")}</strong>
              <small>{tx("Projetos (projects.json), contas (accounts.json, sem chaves) e estes ajustes (settings.json).")}</small>
              <Show when={paths()}><code>{prettyPath(paths()!.config)}</code></Show>
            </div>
            <Show when={paths()}><button class="ghost-btn small" onClick={() => reveal(paths()!.config)}><FolderOpen size={12} /> {tx("Mostrar")}</button></Show>
          </div>
          <div class="set-row">
            <div>
              <strong>{tx("Dados")}</strong>
              <small>{tx("Conversas com DeepSeek, OpenAI e Ollama (chats/), a pasta do Chat livre (chat-livre/) e as pastas das contas novas do Claude (claude-accounts/).")}</small>
              <Show when={paths()}><code>{prettyPath(paths()!.data)}</code></Show>
            </div>
            <Show when={paths()}><button class="ghost-btn small" onClick={() => reveal(paths()!.data)}><FolderOpen size={12} /> {tx("Mostrar")}</button></Show>
          </div>
          <div class="set-row">
            <div>
              <strong>{tx("Chaves de API")}</strong>
              <small>{tx("No chaveiro do sistema (Chaves no macOS, Gerenciador de Credenciais no Windows). Nunca em arquivo.")}</small>
            </div>
          </div>
        </div>
      </Section>

      <Section icon={<Keyboard size={15} />} title={tx("Atalhos e ajuda")} delay={240}>
        <div class="set-rows">
          <div class="set-row keys">
            <span><kbd>⌘K</kbd> / <kbd>{tx("Ctrl+K")}</kbd> {tx("buscar projetos, arquivos e ações")}</span>
            <span><kbd>F1</kbd> {tx("ou")} <kbd>?</kbd> {tx("ajuda")}</span>
            <span><kbd>{tx("Esc")}</kbd> {tx("fechar janelas e menus")}</span>
            <span><kbd>⌘S</kbd> / <kbd>{tx("Ctrl+S")}</kbd> {tx("salvar o arquivo agora (o editor também grava sozinho)")}</span>
            <span><kbd>F2</kbd> {tx("renomear o item escolhido na árvore · clique direito ou")} <kbd>⋯</kbd> {tx("para mais ações")}</span>
          </div>
          <div class="set-row">
            <div>
              <strong>{tx("Veocode {v}", { v: version() ?? "" })}</strong>
              <small>{tx("Rust + Tauri e SolidJS. Feito para macOS e Windows.")}</small>
            </div>
            <button class="ghost-btn small" onClick={() => setHelpOpen(true)}><CircleHelp size={12} /> {tx("Abrir a ajuda")}</button>
          </div>
        </div>
      </Section>
    </div>
  );
}
