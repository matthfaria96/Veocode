// Mapa do projeto: um arquivo só, `.veocode/map.json`, lido e desenhado pelo Veocode (o desenho
// mora em mapEngine.ts). O Veocode escreve a versão tirada do código (src-tauri/src/projmap.rs);
// a IA do projeto pode reescrever o mesmo arquivo com ideias (telas, serviços, dados) no lugar
// de arquivos. Por cima do desenho vai o que está acontecendo agora: o que mudou no git e o que a
// IA está mexendo.
import { createMemo, createRoot, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./api";
import { changedFiles } from "./git";
import { setInput, sendChat, chatOf } from "./chat";
import { setCodeSideOpen, setCodeSideTab, setProjMode } from "./layoutMode";
import { currentProject, MAP_TAB, openFile, showToast, ws } from "./store";
import { lang, tx } from "./i18n";

export const MAP_FILE = ".veocode/map.json";
export { MAP_TAB };
export const isMapTab = (t: string) => t === MAP_TAB;

export interface MapGroup { id: string; label: string; color?: string; note?: string; count: number }
export interface MapNode { i: number; id: string; label: string; g: number; size: number; path?: string; note?: string; out: number[]; inn: number[] }
export interface MapLink { a: number; b: number; label?: string }
export interface MapData {
  title: string;
  /** "veocode" (tirado do código) ou "ia" */
  by: string;
  /** quando foi feito (ms) */
  at: number;
  /** pontos são arquivos (o tamanho é em linhas) */
  files: boolean;
  groups: MapGroup[];
  nodes: MapNode[];
  links: MapLink[];
  flow: number[];
  bytes: number;
}

const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const num = (v: unknown, d: number) => (typeof v === "number" && isFinite(v) ? v : d);
const COLOR = /^#[0-9a-f]{3,8}$/i;
const MAX_NODES = 1500;

/** Lê o texto do arquivo, aceitando listas compactas ou objetos. Null se não for um mapa. */
export function parseMap(raw: string): MapData | null {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!j || typeof j !== "object" || !Array.isArray(j.nodes)) return null;
  const files = j.files === true;
  const groups: MapGroup[] = [];
  const gIndex = new Map<string, number>();
  for (const g of Array.isArray(j.groups) ? j.groups : []) {
    const a = Array.isArray(g) ? g : [g?.id, g?.label ?? g?.name, g?.color, g?.note];
    const raw = str(a[0]);
    const id = raw || String(groups.length);
    if (gIndex.has(id)) continue;
    gIndex.set(id, groups.length);
    // "outros" e "raiz" do Veocode seguem o idioma da tela, não o de quando o mapa foi feito
    const own = raw === "*" ? tx("outros") : !raw && (a[1] === "raiz" || a[1] === "root") ? tx("raiz") : "";
    groups.push({ id, label: own || str(a[1]) || id, color: COLOR.test(str(a[2])) ? str(a[2]) : undefined, note: str(a[3]) || undefined, count: 0 });
  }
  const groupOf = (v: unknown) => {
    if (typeof v === "number" && v >= 0 && v < groups.length) return Math.floor(v);
    const k = str(v);
    if (!k) return -1;
    if (!gIndex.has(k)) (gIndex.set(k, groups.length), groups.push({ id: k, label: k, count: 0 }));
    return gIndex.get(k)!;
  };
  const nodes: MapNode[] = [];
  const nIndex = new Map<string, number>();
  for (const n of (j.nodes as unknown[]).slice(0, MAX_NODES)) {
    const a = Array.isArray(n) ? n : [(n as any)?.id, (n as any)?.label ?? (n as any)?.name, (n as any)?.group, (n as any)?.size ?? (n as any)?.weight, (n as any)?.path ?? (n as any)?.file, (n as any)?.note];
    const id = str(a[0]) || String(nodes.length);
    if (nIndex.has(id)) continue;
    const path = str(a[4]) || (files ? id : "");
    let g = groupOf(a[2]);
    if (g < 0) g = groupOf("*");
    nIndex.set(id, nodes.length);
    nodes.push({ i: nodes.length, id, label: str(a[1]) || id.split("/").pop() || id, g, size: Math.max(0, num(a[3], files ? 40 : 2)), path: path || undefined, note: str(a[5]) || undefined, out: [], inn: [] });
  }
  if (!nodes.length) return null;
  for (const n of nodes) groups[n.g].count++;
  const ref = (v: unknown) => (typeof v === "number" && v >= 0 && v < nodes.length ? Math.floor(v) : nIndex.get(str(v)) ?? -1);
  const links: MapLink[] = [];
  const seen = new Set<number>();
  for (const l of Array.isArray(j.links) ? j.links : []) {
    const a = Array.isArray(l) ? l : [l?.from ?? l?.a ?? l?.source, l?.to ?? l?.b ?? l?.target, l?.label];
    const x = ref(a[0]), y = ref(a[1]);
    if (x < 0 || y < 0 || x === y || seen.has(x * 100003 + y)) continue;
    seen.add(x * 100003 + y);
    links.push({ a: x, b: y, label: str(a[2]) || undefined });
    nodes[x].out.push(y);
    nodes[y].inn.push(x);
  }
  const flow = (Array.isArray(j.flow) ? j.flow : []).map(ref).filter((i) => i >= 0);
  const at = num(j.at, 0);
  return { title: str(j.title), by: str(j.by) || "ia", at: at > 1e12 ? at : at * 1000, files, groups, nodes, links, flow, bytes: raw.length };
}

// ---------------------------------------------------------------- estado por projeto

interface Entry { data: MapData | null; loading: boolean; busy: "scan" | null; error: string | null; at: number }
const [maps, setMaps] = createStore<Record<string, Entry>>({});
const blank = (): Entry => ({ data: null, loading: false, busy: null, error: null, at: 0 });
export const mapOf = (pid: string): Entry => maps[pid] ?? blank();
const ensure = (pid: string) => maps[pid] || setMaps(pid, blank());

/** Lê o mapa do disco (no navegador, um mapa de exemplo). */
export async function loadMap(pid: string, quiet = false) {
  ensure(pid);
  if (!quiet) setMaps(pid, "loading", true);
  try {
    let raw: string | null = null;
    let at = 0;
    if (isTauri && !currentProjectIsDemo(pid)) {
      const r = await invoke<[string, number] | null>("map_read", { projectId: pid });
      if (r) [raw, at] = [r[0], r[1] * 1000];
    } else {
      raw = (await import("./data/demoMap.json?raw")).default;
      at = Date.now() - 3 * 60_000;
    }
    const data = raw ? parseMap(raw) : null;
    if (data && !data.at) data.at = at;
    if (data && !isTauri) data.at = at;
    setMaps(pid, { data, loading: false, error: raw && !data ? tx("O arquivo .veocode/map.json não é um mapa válido.") : null, at: Date.now() });
  } catch (e) {
    setMaps(pid, { loading: false, error: String(e) });
  }
}

const currentProjectIsDemo = (pid: string) => currentProject().id === pid && !!currentProject().demo;

/** Desenha (de novo) o mapa a partir do código. */
export async function scanMap(pid: string) {
  ensure(pid);
  if (mapOf(pid).busy) return;
  if (!isTauri || currentProjectIsDemo(pid)) {
    showToast(tx("No projeto de exemplo o mapa é fixo: adicione uma pasta sua para desenhar o dela."));
    return loadMap(pid, true);
  }
  setMaps(pid, { busy: "scan", error: null });
  try {
    const raw = await invoke<string>("map_scan", { projectId: pid });
    setMaps(pid, { data: parseMap(raw), busy: null, at: Date.now() });
  } catch (e) {
    setMaps(pid, { busy: null, error: String(e) });
  }
}

/** O arquivo mudou no disco (a IA reescreveu, ou outro programa): relê. */
export function mapFileChanged(pid: string) {
  if (maps[pid]) void loadMap(pid, true);
}

/** Pede à IA do projeto um mapa de ideias, no mesmo arquivo. A conversa aparece no modo IA. */
export function askAiForMap(pid: string) {
  if (chatOf(pid).busy) return showToast(tx("A IA deste projeto está ocupada: espere ela terminar ou pare antes."));
  setInput(pid, aiPrompt());
  setProjMode("ai");
  void sendChat(pid);
}

function aiPrompt() {
  const en = lang() === "en";
  const example = `{"v":1,"title":"…","by":"ia","at":${Math.floor(Date.now() / 1000)},
"groups":[["screens","${en ? "Screens" : "Telas"}"],["services","${en ? "Services" : "Serviços"}"],["data","${en ? "Data" : "Dados"}"]],
"nodes":[
["login","${en ? "Login screen" : "Tela de login"}","screens",3,"src/Login.tsx","${en ? "what it does, in a few words" : "o que faz, em poucas palavras"}"],
["auth","${en ? "Auth service" : "Serviço de login"}","services",4,"src/auth.ts",""]
],
"links":[["login","auth","${en ? "calls" : "chama"}"]],
"flow":["login","auth"]}`;
  return en
    ? `Draw this project's map for Veocode. Read the code and write ONE file, ${MAP_FILE}, in this compact format (one item per line):\n\n${example}\n\nRules: groups = the project's 4 to 9 areas (screens, services, data, integrations…); nodes = the pieces that matter (20 to 120), each [id, name, group, weight 1-5, main file or "", short note]; links = who uses/calls/reads whom, [from, to, short label]; flow = the main path a user goes through, in order (optional). Use short ids. Veocode draws the map from this file by itself: don't write anything else, and don't change any other file.`
    : `Desenhe o mapa deste projeto para o Veocode. Leia o código e escreva UM arquivo, ${MAP_FILE}, neste formato compacto (um item por linha):\n\n${example}\n\nRegras: groups = as 4 a 9 áreas do projeto (telas, serviços, dados, integrações…); nodes = as peças que importam (20 a 120), cada uma [id, nome, grupo, peso 1-5, arquivo principal ou "", nota curta]; links = quem usa/chama/lê quem, [de, para, rótulo curto]; flow = o caminho principal de quem usa, em ordem (opcional). Use ids curtos. O Veocode desenha o mapa sozinho a partir desse arquivo: não escreva mais nada e não mude nenhum outro arquivo.`;
}

// ---------------------------------------------------------------- abrir

/** Pedido para o mapa aberto: focar um ponto ou uma área ao abrir. */
export const [mapIntent, setMapIntent] = createSignal<{ node?: string; group?: number; at: number } | null>(null);

/** Abre o mapa numa aba do editor (modo Código). */
export function openMap(intent?: { node?: string; group?: number }) {
  setProjMode("code");
  if (intent) setMapIntent({ ...intent, at: Date.now() });
  openFile(MAP_TAB);
}

/** Abre o painel da direita na aba Mapa. */
export function showMapPanel() {
  setProjMode("code");
  setCodeSideTab("map");
  setCodeSideOpen(true);
}

// ---------------------------------------------------------------- ao vivo

export type Live = "ai" | "now" | "git";
const EDIT = new Set(["edit", "create", "delete"]);
const RECENT = 30 * 60_000;

/** No navegador, alguns pontos "vivos" para o exemplo mostrar como fica. */
const DEMO_LIVE: [string, Live][] = [
  ["src/components/ChatPanel.tsx", "now"],
  ["src/store.ts", "ai"],
  ["src-tauri/src/chat.rs", "ai"],
  ["src/components/GitPanel.tsx", "git"],
  ["src/git.ts", "git"],
  ["src/styles.css", "git"],
];

const [tick, setTick] = createSignal(0);
setInterval(() => setTick((x) => x + 1), 20_000);

/**
 * O que está acontecendo agora em cada arquivo do projeto aberto: "now" (a IA está mexendo neste
 * instante), "ai" (a IA mexeu nos últimos 30 min) e "git" (mudado e ainda sem commit).
 */
export const liveFiles = createRoot(() =>
  createMemo(() => {
    tick();
    const out = new Map<string, Live>();
    const p = currentProject();
    if (p.demo || !isTauri) {
      for (const [f, k] of DEMO_LIVE) out.set(f, k);
      return out;
    }
    for (const f of changedFiles(p.id)) out.set(f, "git");
    const now = Date.now();
    for (const e of ws.events) {
      if (!e.path || !EDIT.has(e.kind)) continue;
      const rel = e.path.replace(/^\.?\//, "");
      if (e.status === "running") out.set(rel, "now");
      else if (now - (e.ts ?? 0) < RECENT && out.get(rel) !== "now") out.set(rel, "ai");
    }
    return out;
  }),
);

/** O estado vivo de cada ponto do mapa (pelo arquivo dele). */
export function liveOf(data: MapData, files: Map<string, Live>): Map<number, Live> {
  const out = new Map<number, Live>();
  if (!files.size) return out;
  const root = currentProject().path?.replace(/\/$/, "") ?? "";
  for (const n of data.nodes) {
    if (!n.path) continue;
    const k = files.get(n.path) ?? (root ? files.get(`${root}/${n.path}`) : undefined);
    if (k) out.set(n.i, k);
  }
  return out;
}
