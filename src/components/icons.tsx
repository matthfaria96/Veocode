// Ícones de pastas, arquivos e projetos nos dois estilos dos Ajustes:
// - minimalista: os traços finos do lucide (como era antes);
// - detalhado: desenhos próprios com volume e cor (pasta com aba e brilho, folha com a
//   etiqueta do tipo do arquivo, projeto com a sigla da tecnologia).

import { FileCode2, FileText, Folder, FolderOpen, Image } from "lucide-solid";
import { createUniqueId, Show } from "solid-js";
import { detailed, type IconStyle } from "../settings";

/** Estilo pedido explicitamente (prévia dos Ajustes) ou o escolhido pela pessoa. */
const isDetailed = (style?: IconStyle) => (style ? style === "detalhado" : detailed());

// ---------------------------------------------------------------- cores

/** [claro, escuro] de cada tom de pasta. */
const tones = {
  blue: ["#7cc4ff", "#3b8cf0"],
  orange: ["#ffb27a", "#e8743b"],
  green: ["#7ee0a8", "#22a06b"],
  purple: ["#c9a7ff", "#8b5cf6"],
  pink: ["#ff9fcf", "#e0559a"],
  teal: ["#7fe3df", "#14a3a0"],
  yellow: ["#ffe08a", "#e0a915"],
  red: ["#ff9b9b", "#e04848"],
  gray: ["#b6bfcd", "#6b7586"],
} as const;
type Tone = keyof typeof tones;

const folderTone = (name: string): Tone => {
  const n = name.toLowerCase();
  if (/^(node_modules|target|dist|build|out|\.next|\.cache|vendor|coverage|__pycache__)$/.test(n)) return "gray";
  if (n === ".git" || n === ".github") return "orange";
  if (n === ".claude") return "orange";
  if (/^(tests?|__tests__|spec|e2e)$/.test(n)) return "green";
  if (/^(assets|public|static|images|img|icons|media|fonts)$/.test(n)) return "pink";
  if (/^(docs?|documentation)$/.test(n)) return "teal";
  if (/^(scripts?|bin|tools)$/.test(n)) return "yellow";
  if (/^(\.vscode|\.idea|config|\.config)$/.test(n)) return "purple";
  return "blue";
};

/** Cor e sigla de cada tipo de arquivo. */
const fileKinds: [RegExp, string, string, string?][] = [
  // [nome, cor da etiqueta, sigla, cor do texto]
  [/^dockerfile$|\.dockerfile$/i, "#2496ed", "DOCK"],
  [/^cargo\.(toml|lock)$/i, "#de6b3b", "RS"],
  [/^package(-lock)?\.json$/i, "#cb3837", "NPM"],
  [/^\.gitignore$|^\.gitattributes$/i, "#f05033", "GIT"],
  [/^\.env(\..*)?$/i, "#eab308", "ENV", "#1a1a1a"],
  [/^(readme|license|changelog)(\.\w+)?$/i, "#64748b", "DOC"],
  [/\.tsx?$/i, "#3178c6", "TS"],
  [/\.(m|c)?jsx?$/i, "#f0d43a", "JS", "#1a1a1a"],
  [/\.rs$/i, "#de6b3b", "RS"],
  [/\.json$/i, "#c9a227", "{ }"],
  [/\.mdx?$/i, "#64748b", "MD"],
  [/\.s?css$/i, "#8b5cf6", "CSS"],
  [/\.html?$/i, "#e4572e", "HTML"],
  [/\.py$/i, "#3b77a8", "PY"],
  [/\.go$/i, "#29a9c9", "GO"],
  [/\.swift$/i, "#f05138", "SWIFT"],
  [/\.(kt|kts|java)$/i, "#b07219", "JAVA"],
  [/\.(c|h|cpp|hpp|cc)$/i, "#5c6bc0", "C"],
  [/\.(sh|bash|zsh|ps1|bat)$/i, "#4caf50", "SH"],
  [/\.(ya?ml|toml|ini|conf|xml|plist)$/i, "#7c8798", "CFG"],
  [/\.lock$/i, "#6c7589", "LOCK"],
  [/\.(png|jpe?g|gif|webp|ico|icns|bmp|avif|heic)$/i, "#22a06b", "IMG"],
  [/\.svg$/i, "#f59e0b", "SVG", "#1a1a1a"],
  [/\.(mp4|mov|webm|mp3|wav|m4a)$/i, "#ec4899", "MEDIA"],
  [/\.(zip|gz|tar|tgz|7z|dmg|pkg|exe|msi)$/i, "#a16207", "ZIP"],
  [/\.(pdf)$/i, "#dc2626", "PDF"],
  [/\.(txt|log|csv)$/i, "#94a3b8", "TXT", "#1a1a1a"],
];

function fileKind(name: string): { color: string; label: string; ink: string } {
  for (const [re, color, label, ink] of fileKinds) if (re.test(name)) return { color, label, ink: ink ?? "#fff" };
  const ext = name.includes(".") ? name.split(".").pop()!.slice(0, 4).toUpperCase() : "";
  return { color: "#64748b", label: ext, ink: "#fff" };
}

// ---------------------------------------------------------------- pasta

function DetailedFolder(props: { size: number; open?: boolean; tone: Tone; emblem?: string }) {
  const id = createUniqueId();
  const t = () => tones[props.tone];
  return (
    <svg class="dicon" width={props.size} height={props.size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id={`b${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color={t()[1]} />
          <stop offset="1" stop-color={t()[1]} stop-opacity="0.85" />
        </linearGradient>
        <linearGradient id={`f${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color={t()[0]} />
          <stop offset="1" stop-color={t()[1]} />
        </linearGradient>
      </defs>
      {/* fundo com a aba */}
      <path d="M3 8.2A2.4 2.4 0 0 1 5.4 5.8h6.3c.6 0 1.1.2 1.5.6l1.9 2h13.4A2.4 2.4 0 0 1 30.9 10.8V24.6A2.4 2.4 0 0 1 28.5 27H5.4A2.4 2.4 0 0 1 3 24.6Z" fill={`url(#b${id})`} />
      <Show
        when={props.open}
        fallback={
          <>
            <path d="M3 12.6a2.1 2.1 0 0 1 2.1-2.1h23.7a2.1 2.1 0 0 1 2.1 2.1v12A2.4 2.4 0 0 1 28.5 27H5.4A2.4 2.4 0 0 1 3 24.6Z" fill={`url(#f${id})`} />
            <path d="M4.4 11.7h25.1" stroke="#fff" stroke-opacity="0.45" stroke-width="0.9" stroke-linecap="round" />
          </>
        }
      >
        {/* aberta: a folha aparece e a frente tomba */}
        <rect x="6.5" y="8.4" width="20" height="12" rx="1.2" fill="#f4f7fb" />
        <path d="M8.5 11h12M8.5 13.5h9" stroke="#c4ccd8" stroke-width="0.9" stroke-linecap="round" />
        <path d="M6.6 14h23.6a1.2 1.2 0 0 1 1.17 1.46L29.2 25.1A2.4 2.4 0 0 1 26.85 27H5.2A1.7 1.7 0 0 1 3.55 24.9l1.6-9.7A1.5 1.5 0 0 1 6.6 14Z" fill={`url(#f${id})`} />
        <path d="M6.5 15h23.4" stroke="#fff" stroke-opacity="0.45" stroke-width="0.9" stroke-linecap="round" />
      </Show>
      <Show when={props.emblem}>
        <text x="17" y={props.open ? 23.6 : 22.4} text-anchor="middle" class="dicon-emblem" font-size={props.emblem!.length > 2 ? "6.2" : "7.6"}>
          {props.emblem}
        </text>
      </Show>
    </svg>
  );
}

/** Pasta da árvore de arquivos. */
export function FolderIcon(props: { name: string; open?: boolean; size?: number; style?: IconStyle }) {
  const size = () => props.size ?? 14;
  return (
    <Show when={isDetailed(props.style)} fallback={props.open ? <FolderOpen size={size()} /> : <Folder size={size()} />}>
      <DetailedFolder size={size() + 3} open={props.open} tone={folderTone(props.name)} />
    </Show>
  );
}

// ---------------------------------------------------------------- arquivo

function DetailedFile(props: { name: string; size: number }) {
  const id = createUniqueId();
  const k = () => fileKind(props.name);
  const fs = () => (k().label.length <= 2 ? 7.4 : k().label.length === 3 ? 6.4 : 5.2);
  return (
    <svg class="dicon" width={props.size} height={props.size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id={`p${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#fbfcfe" />
          <stop offset="1" stop-color="#dde3ec" />
        </linearGradient>
      </defs>
      <path d="M8.2 2.5h11.3l7.3 7.3v17.3a2.4 2.4 0 0 1-2.4 2.4H8.2a2.4 2.4 0 0 1-2.4-2.4V4.9a2.4 2.4 0 0 1 2.4-2.4Z" fill={`url(#p${id})`} />
      <path d="M19.5 2.5v5a2.3 2.3 0 0 0 2.3 2.3h5Z" fill="#b7c1cf" />
      <path d="M9 7.5h7M9 10.5h8.5" stroke="#c8d0db" stroke-width="1" stroke-linecap="round" />
      <Show when={k().label}>
        <rect x="3" y="16" width={Math.max(15, k().label.length * 4.2 + 6)} height="9.6" rx="2.2" fill={k().color} />
        <text x={3 + Math.max(15, k().label.length * 4.2 + 6) / 2} y="23.1" text-anchor="middle" class="dicon-label" font-size={String(fs())} fill={k().ink}>
          {k().label}
        </text>
      </Show>
    </svg>
  );
}

export function FileIcon(props: { name: string; size?: number; style?: IconStyle }) {
  const size = () => props.size ?? 14;
  const minimal = () =>
    /\.(png|jpe?g|gif|svg|webp|ico|icns)$/i.test(props.name) ? <Image size={size()} /> : /\.(md|txt|json|toml|ya?ml|lock)$/i.test(props.name) ? <FileText size={size()} /> : <FileCode2 size={size()} />;
  return (
    <Show when={isDetailed(props.style)} fallback={minimal()}>
      <DetailedFile name={props.name} size={size() + 3} />
    </Show>
  );
}

// ---------------------------------------------------------------- projeto

/** Sigla da tecnologia principal do projeto ("Rust · Tauri · Solid" → "Rs"). */
function emblemFor(stack: string, name: string): string {
  const s = stack.toLowerCase();
  const table: [RegExp, string][] = [
    [/rust|tauri|cargo/, "Rs"],
    [/typescript|\bts\b/, "TS"],
    [/swift|xcode|ios/, "Sw"],
    [/python|django|flask/, "Py"],
    [/\bgo\b|golang/, "Go"],
    [/godot|gdscript/, "Gd"],
    [/java|kotlin|android/, "Kt"],
    [/node|javascript|react|solid|vue|svelte|next|vite/, "JS"],
    [/\bc\+\+|cpp|cmake/, "C+"],
  ];
  for (const [re, e] of table) if (re.test(s)) return e;
  return (name.trim()[0] ?? "?").toUpperCase();
}

const projectTones: Tone[] = ["blue", "purple", "teal", "orange", "pink", "green", "yellow", "red"];
const toneFor = (key: string): Tone => {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return projectTones[h % projectTones.length];
};

/** Ícone do projeto: pasta com a cor do projeto e a sigla da tecnologia. */
export function ProjectIcon(props: { name: string; stack?: string; id?: string; size?: number; style?: IconStyle }) {
  const size = () => props.size ?? 18;
  return (
    <Show when={isDetailed(props.style)} fallback={<FolderOpen size={size()} />}>
      <DetailedFolder size={Math.round(size() * 1.5)} tone={toneFor(props.id ?? props.name)} emblem={emblemFor(props.stack ?? "", props.name)} />
    </Show>
  );
}
