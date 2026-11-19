import { dec, tx } from "../i18n";
// Dados fictícios — nada aqui é real ainda. Servem só para desenhar a experiência.
// Quando formos ligar as funcionalidades, cada bloco vira um comando Rust (tauri::command).

export type ProviderId = "claude" | "deepseek" | "ollama" | "openai";

export interface Provider {
  id: ProviderId;
  name: string;
  kind: "nuvem" | "local";
}

export interface Account {
  id: string;
  label: string;
  provider: ProviderId;
  plan: string;
  auth: string;
  color: string;
  model: string;
  usage: number; // 0..1 do limite da janela atual
  resetIn: string;
  tokensToday: string;
  status: "ativa" | "ociosa" | "limite";
}

export const accounts: Account[] = [
  {
    id: "claude-pessoal",
    get label() { return tx("Claude · Pessoal"); },
    provider: "claude",
    plan: "Pro",
    auth: "Login OAuth",
    color: "#e8915b",
    model: "Opus 5.5",
    usage: 0.62,
    resetIn: "2h 14min",
    tokensToday: "1,8 M",
    status: "ativa",
  },
  {
    id: "claude-trabalho",
    get label() { return tx("Claude · Trabalho"); },
    provider: "claude",
    plan: "Team",
    auth: "Login OAuth",
    color: "#c084fc",
    model: "Sonnet 5.5",
    usage: 0.28,
    resetIn: "4h 02min",
    tokensToday: "640 k",
    status: "ociosa",
  },
  {
    id: "deepseek",
    label: "DeepSeek · API",
    provider: "deepseek",
    get plan() { return tx("Pré-pago"); },
    get auth() { return tx("Chave de API"); },
    color: "#4f8cff",
    model: "deepseek-chat",
    usage: 0.41,
    resetIn: "saldo US$ 7,40",
    tokensToday: "2,3 M",
    status: "ativa",
  },
  {
    id: "ollama",
    label: "Local · Ollama",
    provider: "ollama",
    get plan() { return tx("Na sua máquina"); },
    auth: "localhost:11434",
    color: "#34d399",
    model: "qwen3-coder:30b",
    usage: 0.12,
    get resetIn() { return tx("sem limite"); },
    tokensToday: "310 k",
    status: "ociosa",
  },
];

// ---------- Nível de acesso ----------

export interface AccessLevel {
  id: number;
  name: string;
  short: string;
  description: string;
  color: string;
}

export const accessLevels: AccessLevel[] = [
  { id: 0, get name() { return tx("Somente leitura"); }, get short() { return tx("Leitura"); }, get description() { return tx("Lê arquivos e responde. Não altera nada."); }, color: "#60a5fa" },
  { id: 1, get name() { return tx("Sugerir"); }, get short() { return tx("Sugerir"); }, get description() { return tx("Propõe mudanças em diff. Você aprova cada uma."); }, color: "#a78bfa" },
  { id: 2, get name() { return tx("Editar"); }, get short() { return tx("Editar"); }, get description() { return tx("Edita arquivos do projeto. Comandos pedem aprovação."); }, color: "#fbbf24" },
  { id: 3, get name() { return tx("Total"); }, get short() { return tx("Total"); }, get description() { return tx("Edita, roda terminal e instala pacotes sozinho."); }, color: "#f87171" },
];

// ---------- Projetos ----------

export interface Project {
  id: string;
  name: string;
  path: string;
  stack: string;
  accountId: string;
  access: number;
  branch: string;
  lastActive: string;
  live: boolean;
  /** Projeto de demonstração: árvore fictícia + agente simulado. */
  demo: boolean;
  /** A pasta ainda existe no disco? */
  exists: boolean;
}

/** Fica sempre na lista para mostrar a animação do agente trabalhando. */
export const demoProject: Project = {
  id: "demo",
  get name() { return tx("demo · simulação"); },
  get path() { return tx("projeto fictício"); },
  stack: "Rust · Tauri · Solid",
  accountId: "claude-pessoal",
  access: 2,
  branch: "main",
  lastActive: "agora",
  live: true,
  demo: true,
  exists: true,
};

// ---------- Árvore de arquivos (projeto veocode) ----------

export interface FileNode {
  name: string;
  path: string;
  dir?: boolean;
  children?: FileNode[];
}

const f = (path: string): FileNode => ({ name: path.split("/").pop()!, path });
const d = (path: string, children: FileNode[]): FileNode => ({ name: path.split("/").pop()!, path, dir: true, children });

export const fileTree: FileNode[] = [
  d("src", [
    d("src/components", [f("src/components/AgentCursor.tsx"), f("src/components/FileTree.tsx")]),
    d("src/views", [f("src/views/Workspace.tsx"), f("src/views/System.tsx"), f("src/views/Accounts.tsx")]),
    f("src/App.tsx"),
    f("src/index.tsx"),
  ]),
  d("src-tauri", [
    d("src-tauri/src", [f("src-tauri/src/lib.rs"), f("src-tauri/src/main.rs"), f("src-tauri/src/scanner.rs")]),
    f("src-tauri/Cargo.toml"),
    f("src-tauri/tauri.conf.json"),
  ]),
  f("CLAUDE.md"),
  f("package.json"),
  f("README.md"),
];

export const fileContents: Record<string, string> = {
  "src/views/System.tsx": `import { For } from "solid-js";
import { caches } from "../data/mock";

export default function System() {
  // Raio-X: tudo que as IAs deixaram na máquina
  return (
    <section class="system">
      <h1>Raio-X do sistema</h1>
      <For each={caches}>
        {(c) => <CacheRow cache={c} />}
      </For>
    </section>
  );
}`,
  "src/App.tsx": `import { createSignal, Match, Switch } from "solid-js";
import Workspace from "./views/Workspace";
import System from "./views/System";

export default function App() {
  const [view, setView] = createSignal("workspace");
  return (
    <Switch>
      <Match when={view() === "workspace"}><Workspace /></Match>
      <Match when={view() === "system"}><System /></Match>
    </Switch>
  );
}`,
  "src-tauri/src/scanner.rs": `use std::path::PathBuf;
use serde::Serialize;

#[derive(Serialize)]
pub struct CacheEntry {
    pub label: String,
    pub path: PathBuf,
    pub bytes: u64,
}

/// Varre pastas de cache conhecidas e devolve o tamanho de cada uma.
pub fn scan_caches() -> Vec<CacheEntry> {
    let home = dirs::home_dir().unwrap_or_default();
    let known = [".claude", ".npm/_cacache", ".cargo/registry"];
    known
        .iter()
        .map(|p| CacheEntry {
            label: p.to_string(),
            path: home.join(p),
            bytes: dir_size(&home.join(p)),
        })
        .collect()
}`,
  "src-tauri/src/lib.rs": `mod scanner;

#[tauri::command]
fn scan_caches() -> Vec<scanner::CacheEntry> {
    scanner::scan_caches()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![scan_caches])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Veocode");
}`,
  "CLAUDE.md": `# Veocode

Workspace visual para agentes de IA.

- Frontend: SolidJS + TypeScript (src/)
- Backend: Rust + Tauri 2 (src-tauri/)
- Nunca rodar comandos fora da pasta do projeto.
- Animações respeitam prefers-reduced-motion.`,
};

export const defaultFileContent = (path: string) =>
  tx("// {path}\n// (conteúdo fictício — o leitor de arquivos real entra na fase 2)\n", { path });

// ---------- Raio-X do sistema ----------

export interface CacheItem {
  id: string;
  label: string;
  path: string;
  bytes: number;
  owner: string; // conta ou "sistema"
  kind: "ia" | "pacotes" | "build" | "containers";
}

const GB = 1024 ** 3;
const MB = 1024 ** 2;

export const caches: CacheItem[] = [
  { id: "claude", get label() { return tx("Sessões e histórico do Claude"); }, path: "~/.claude", bytes: 1.8 * GB, owner: "claude-pessoal", kind: "ia" },
  { id: "deepseek", get label() { return tx("Sessões DeepSeek"); }, path: "~/.veocode/deepseek", bytes: 120 * MB, owner: "deepseek", kind: "ia" },
  { id: "ollama", get label() { return tx("Modelos locais (Ollama)"); }, path: "~/.ollama/models", bytes: 18.6 * GB, owner: "ollama", kind: "ia" },
  { id: "npm", get label() { return tx("Cache do npm"); }, path: "~/.npm/_cacache", bytes: 3.2 * GB, owner: "sistema", kind: "pacotes" },
  { id: "cargo", get label() { return tx("Registro do Cargo"); }, path: "~/.cargo/registry", bytes: 2.1 * GB, owner: "sistema", kind: "pacotes" },
  { id: "pip", get label() { return tx("Cache do pip"); }, path: "~/Library/Caches/pip", bytes: 640 * MB, owner: "sistema", kind: "pacotes" },
  { id: "target", get label() { return tx("Pastas target/ e node_modules/"); }, path: "4 projetos", bytes: 6.4 * GB, owner: "sistema", kind: "build" },
  { id: "docker", get label() { return tx("Build cache do Docker"); }, path: "docker system df", bytes: 4.9 * GB, owner: "sistema", kind: "containers" },
];

export interface InstalledItem {
  id: string;
  name: string;
  manager: "brew" | "npm -g" | "pip" | "cargo" | "docker";
  version: string;
  by: string; // id da conta
  project: string;
  when: string;
  size: string;
}

export const installed: InstalledItem[] = [
  { id: "1", name: "ripgrep", manager: "brew", version: "15.1.0", by: "claude-pessoal", project: "veocode", when: "hoje, 14:32", size: "6,1 MB" },
  { id: "2", name: "tauri-cli", manager: "cargo", version: "2.9.4", by: "claude-pessoal", project: "veocode", when: "hoje, 14:10", size: "48 MB" },
  { id: "3", name: "pandas", manager: "pip", version: "3.0.1", by: "deepseek", project: "analise-dados", when: "hoje, 11:05", size: "62 MB" },
  { id: "4", name: "postgres:17", manager: "docker", version: "17.2", by: "claude-trabalho", project: "loja-api", when: "ontem, 18:47", size: "438 MB" },
  { id: "5", name: "pnpm", manager: "npm -g", version: "10.21.0", by: "claude-trabalho", project: "loja-api", when: "ontem, 17:20", size: "17 MB" },
  { id: "6", name: "jupyterlab", manager: "pip", version: "4.5.0", by: "deepseek", project: "analise-dados", when: "12 nov", size: "112 MB" },
];

export interface MachineItem {
  id: string;
  name: string;
  kind: "container" | "vm";
  engine: string;
  status: "rodando" | "parada";
  cpu: number; // %
  ram: string;
  disk: string;
  by: string;
  ports?: string;
}

export const machines: MachineItem[] = [
  { id: "pg", name: "loja-api-postgres", kind: "container", engine: "Docker", status: "rodando", cpu: 3, ram: "312 MB", disk: "438 MB", by: "claude-trabalho", ports: "5432" },
  { id: "redis", name: "loja-api-redis", kind: "container", engine: "Docker", status: "parada", cpu: 0, ram: "—", disk: "41 MB", by: "claude-trabalho" },
  { id: "lima", name: "sandbox-linux", kind: "vm", engine: "Lima", status: "rodando", cpu: 11, ram: "2,0 GB", disk: "8,4 GB", by: "claude-pessoal", ports: "60022" },
  { id: "utm", name: "ubuntu-testes", kind: "vm", engine: "UTM", status: "parada", cpu: 0, ram: "—", disk: "20 GB", by: "ollama" },
];

export interface ProcessItem {
  pid: number;
  cmd: string;
  by: string;
  project: string;
  cpu: number[];
  mem: string;
  port?: string;
}

export const processes: ProcessItem[] = [
  { pid: 48211, cmd: "vite --port 1420", by: "claude-pessoal", project: "veocode", cpu: [4, 6, 3, 9, 5, 4, 7, 5, 3, 4], mem: "142 MB", port: "1420" },
  { pid: 48230, cmd: "cargo watch -x check", by: "claude-pessoal", project: "veocode", cpu: [2, 30, 64, 22, 8, 4, 2, 41, 12, 3], mem: "380 MB" },
  { pid: 51022, cmd: "jupyter lab", by: "deepseek", project: "analise-dados", cpu: [1, 1, 2, 1, 6, 2, 1, 1, 3, 1], mem: "210 MB", port: "8888" },
  { pid: 39107, cmd: "ollama serve", by: "ollama", project: "—", cpu: [0, 0, 1, 0, 0, 22, 70, 35, 3, 0], mem: "9,8 GB", port: "11434" },
];

// ---------- Skills e MCP ----------

export interface SkillItem {
  id: string;
  name: string;
  description: string;
  scope: "global" | "conta" | "projeto";
  scopeRef?: string;
  usedBy: string[]; // ids de conta
  enabled: boolean;
  kind: "skill" | "mcp";
}

export const skills: SkillItem[] = [
  { id: "s1", name: "code-review", get description() { return tx("Revisa o diff atual procurando bugs."); }, scope: "global", usedBy: ["claude-pessoal", "claude-trabalho"], enabled: true, kind: "skill" },
  { id: "s2", name: "frontend-design", get description() { return tx("Guia visual para telas e componentes."); }, scope: "conta", scopeRef: "claude-pessoal", usedBy: ["claude-pessoal"], enabled: true, kind: "skill" },
  { id: "s3", name: "sql-helper", get description() { return tx("Escreve e explica queries SQL."); }, scope: "projeto", scopeRef: "loja-api", usedBy: ["claude-trabalho"], enabled: true, kind: "skill" },
  { id: "s4", name: "pandas-notebooks", get description() { return tx("Padrões para análise em notebooks."); }, scope: "projeto", scopeRef: "analise-dados", usedBy: ["deepseek"], enabled: true, kind: "skill" },
  { id: "s5", name: "deploy-vercel", get description() { return tx("Publica o site e confere o build."); }, scope: "projeto", scopeRef: "portfolio", usedBy: [], enabled: false, kind: "skill" },
  { id: "m1", name: "filesystem", get description() { return tx("Lê e escreve arquivos dentro da pasta do projeto."); }, scope: "global", usedBy: ["claude-pessoal", "claude-trabalho", "deepseek", "ollama"], enabled: true, kind: "mcp" },
  { id: "m2", name: "github", get description() { return tx("Issues, PRs e reviews."); }, scope: "conta", scopeRef: "claude-trabalho", usedBy: ["claude-trabalho"], enabled: true, kind: "mcp" },
  { id: "m3", name: "postgres", get description() { return tx("Consulta o banco local do projeto."); }, scope: "projeto", scopeRef: "loja-api", usedBy: ["claude-trabalho"], enabled: true, kind: "mcp" },
  { id: "m4", name: "browser", get description() { return tx("Abre páginas e tira screenshots."); }, scope: "global", usedBy: ["claude-pessoal"], enabled: false, kind: "mcp" },
];

export const formatBytes = (b: number) => {
  if (b >= GB) return `${dec(b / GB)} GB`;
  if (b >= MB) return `${Math.round(b / MB)} MB`;
  return `${Math.round(b / 1024)} KB`;
};
