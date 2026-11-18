import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { Check, CircleHelp, FolderOpen, Keyboard, Palette, Sparkles } from "lucide-solid";
import { createResource, For, Show, type JSX } from "solid-js";
import { api, isTauri, prettyPath } from "../api";
import { setHelpOpen, showToast } from "../store";
import { settings, updateSettings, type IconStyle, type Motion } from "../settings";
import { FileIcon, FolderIcon, ProjectIcon } from "../components/icons";
import { PageHeader } from "../components/ui";

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
        <For each={[["veocode", "Rust · Tauri · Solid"], ["site-loja", "TypeScript · Vite"], ["analise", "Python"]]}>
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
      <PageHeader title="Ajustes" subtitle="Como o Veocode aparece e onde ele guarda as coisas. As mudanças valem na hora." />

      <Section icon={<Palette size={15} />} title="Ícones" desc="Pastas, arquivos e projetos em todas as telas.">
        <div class="set-cards" role="radiogroup" aria-label="Estilo dos ícones">
          <Choice value="detalhado" current={settings.icons} title="Detalhados" desc="Pastas com volume e cor, arquivos com a etiqueta do tipo e projetos com a sigla da tecnologia." onPick={(v) => updateSettings({ icons: v })}>
            <IconPreview style="detalhado" />
          </Choice>
          <Choice value="minimalista" current={settings.icons} title="Minimalistas" desc="Traços finos de uma cor só. Mais discretos e leves para os olhos." onPick={(v) => updateSettings({ icons: v })}>
            <IconPreview style="minimalista" />
          </Choice>
        </div>
      </Section>

      <Section icon={<Sparkles size={15} />} title="Animações" desc="Cursores, entradas das listas, pulsos e gráficos." delay={80}>
        <div class="set-cards" role="radiogroup" aria-label="Animações">
          <Choice value="completa" current={settings.motion} title="Completas" desc="Tudo se mexe: é assim que o Veocode mostra o que as IAs estão fazendo." onPick={(v) => updateSettings({ motion: v })}>
            <MotionPreview motion="completa" />
          </Choice>
          <Choice value="reduzida" current={settings.motion} title="Reduzidas" desc="Sem laços nem deslizes: as mudanças aparecem direto. Bom para quem se incomoda com movimento." onPick={(v) => updateSettings({ motion: v })}>
            <MotionPreview motion="reduzida" />
          </Choice>
        </div>
      </Section>

      <Section icon={<FolderOpen size={15} />} title="Onde o Veocode guarda as coisas" delay={160}>
        <div class="set-rows">
          <div class="set-row">
            <div>
              <strong>Configuração</strong>
              <small>Projetos (projects.json), contas (accounts.json, sem chaves) e estes ajustes (settings.json).</small>
              <Show when={paths()}><code>{prettyPath(paths()!.config)}</code></Show>
            </div>
            <Show when={paths()}><button class="ghost-btn small" onClick={() => reveal(paths()!.config)}><FolderOpen size={12} /> Mostrar</button></Show>
          </div>
          <div class="set-row">
            <div>
              <strong>Dados</strong>
              <small>Conversas com DeepSeek, OpenAI e Ollama (chats/), a pasta do Chat livre (chat-livre/) e as pastas das contas novas do Claude (claude-accounts/).</small>
              <Show when={paths()}><code>{prettyPath(paths()!.data)}</code></Show>
            </div>
            <Show when={paths()}><button class="ghost-btn small" onClick={() => reveal(paths()!.data)}><FolderOpen size={12} /> Mostrar</button></Show>
          </div>
          <div class="set-row">
            <div>
              <strong>Chaves de API</strong>
              <small>No chaveiro do sistema (Chaves no macOS, Gerenciador de Credenciais no Windows). Nunca em arquivo.</small>
            </div>
          </div>
        </div>
      </Section>

      <Section icon={<Keyboard size={15} />} title="Atalhos e ajuda" delay={240}>
        <div class="set-rows">
          <div class="set-row keys">
            <span><kbd>⌘K</kbd> / <kbd>Ctrl+K</kbd> buscar projetos, arquivos e ações</span>
            <span><kbd>F1</kbd> ou <kbd>?</kbd> ajuda</span>
            <span><kbd>Esc</kbd> fechar janelas</span>
          </div>
          <div class="set-row">
            <div>
              <strong>Veocode {version() ?? ""}</strong>
              <small>Rust + Tauri e SolidJS. Feito para macOS e Windows.</small>
            </div>
            <button class="ghost-btn small" onClick={() => setHelpOpen(true)}><CircleHelp size={12} /> Abrir a ajuda</button>
          </div>
        </div>
      </Section>
    </div>
  );
}
