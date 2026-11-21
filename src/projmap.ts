// Mapa do projeto: um arquivo só, `.veocode/map.json`, lido e desenhado pelo Veocode (o desenho
// mora em mapEngine.ts). O Veocode escreve a versão tirada do código (src-tauri/src/projmap.rs),
// grátis e em segundos; a IA do projeto pode reescrever o mesmo arquivo com um resumo explicado
// (áreas, o que cada peça faz e os fluxos passo a passo). Por cima do desenho vai o que está
// acontecendo agora: o que mudou no git e o que a IA está mexendo. Do mapa sai também
// `.veocode/MAP.md`, um resumo em texto que a IA do projeto lê para achar onde mexer.
import { createMemo, createRoot, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./api";
import { changedFiles } from "./git";
import { setInput, sendChat } from "./chat";
import { renameTab, startConversation } from "./convTabs";
import { setCodeSideOpen, setCodeSideTab, setProjMode } from "./layoutMode";
import { currentProject, MAP_TAB, openFile, showToast, ws } from "./store";
import { lang, tx } from "./i18n";

export const MAP_FILE = ".veocode/map.json";
export const MAP_NOTES = ".veocode/MAP.md";
export { MAP_TAB };
export const isMapTab = (t: string) => t === MAP_TAB;

export interface MapGroup { id: string; label: string; color?: string; note?: string; count: number }
export interface MapNode { i: number; id: string; label: string; g: number; size: number; path?: string; note?: string; out: number[]; inn: number[] }
export interface MapLink { a: number; b: number; label?: string }
/** Um passo de um fluxo: a peça e o que acontece nela. */
export interface MapStep { n: number; note?: string }
/** Uma coisa que alguém faz no app, passo a passo (ex.: "Mandar uma mensagem"). */
export interface MapFlow { name: string; note?: string; steps: MapStep[] }
export interface MapData {
  title: string;
  /** "veocode" (tirado do código) ou "ia" */
  by: string;
  /** quando foi feito (ms) */
  at: number;
  /** pontos são arquivos (o tamanho é em linhas) */
  files: boolean;
  /** o que o projeto é e como se organiza, em poucas frases */
  about?: string;
  groups: MapGroup[];
  nodes: MapNode[];
  links: MapLink[];
  flows: MapFlow[];
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
  // fluxos: [nome, [[peça, o que acontece], …], nota?] ou {name, steps, note}; o "flow" antigo
  // (uma lista de peças) vira o "Caminho principal"
  const stepOf = (v: unknown): MapStep | null => {
    const a = Array.isArray(v) ? v : v && typeof v === "object" ? [(v as any).node ?? (v as any).id ?? (v as any).step, (v as any).note ?? (v as any).text] : [v];
    const n = ref(a[0]);
    return n < 0 ? null : { n, note: str(a[1]) || undefined };
  };
  const stepsOf = (v: unknown) => (Array.isArray(v) ? v : []).map(stepOf).filter((x): x is MapStep => !!x);
  const flows: MapFlow[] = [];
  for (const f of Array.isArray(j.flows) ? j.flows : []) {
    const a = Array.isArray(f) ? f : [f?.name ?? f?.title, f?.steps, f?.note];
    const steps = stepsOf(a[1]);
    if (steps.length >= 2) flows.push({ name: str(a[0]) || tx("Fluxo {n}", { n: flows.length + 1 }), note: str(a[2]) || undefined, steps });
  }
  if (!flows.length) {
    const steps = stepsOf(j.flow);
    if (steps.length >= 2) flows.push({ name: tx("Caminho principal"), steps });
  }
  const at = num(j.at, 0);
  const about = str(j.about ?? j.summary).trim();
  return { title: str(j.title), by: str(j.by) || "ia", at: at > 1e12 ? at : at * 1000, files, about: about || undefined, groups, nodes, links, flows, bytes: raw.length };
}

// ---------------------------------------------------------------- leituras do mapa

/** Como uma área se liga a outra: quantas ligações e o que passa por elas. */
export interface AreaLink { a: number; b: number; n: number; labels: string[] }

/** As ligações entre áreas (a soma das ligações entre as peças), da mais forte à mais fraca. */
export function areaLinks(d: MapData): AreaLink[] {
  const m = new Map<string, { a: number; b: number; n: number; lab: Map<string, number> }>();
  for (const l of d.links) {
    const ga = d.nodes[l.a].g, gb = d.nodes[l.b].g;
    if (ga === gb) continue;
    const k = `${ga}>${gb}`;
    let e = m.get(k);
    if (!e) m.set(k, (e = { a: ga, b: gb, n: 0, lab: new Map() }));
    e.n++;
    if (l.label) e.lab.set(l.label, (e.lab.get(l.label) ?? 0) + 1);
  }
  return [...m.values()]
    .map((e) => ({ a: e.a, b: e.b, n: e.n, labels: [...e.lab.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map((x) => x[0]) }))
    .sort((x, y) => y.n - x.n);
}

/** As peças mais importantes de uma área: as mais ligadas, depois as maiores. */
export function keyNodes(d: MapData, g: number): MapNode[] {
  const score = (n: MapNode) => (n.out.length + n.inn.length) * 2 + (d.files ? Math.sqrt(n.size) / 4 : n.size * 3);
  return d.nodes.filter((n) => n.g === g).sort((a, b) => score(b) - score(a));
}

/** O texto do ligação entre duas peças, se houver (de a para b). */
export const linkLabel = (d: MapData, a: number, b: number) => d.links.find((l) => l.a === a && l.b === b)?.label;

/**
 * O resumo em texto (`.veocode/MAP.md`) que a IA do projeto lê para achar onde mexer: o que o
 * projeto é, as áreas com as peças principais, como as áreas se ligam e os fluxos.
 */
export function mapNotes(d: MapData): string {
  const out: string[] = [];
  const date = new Date(d.at || Date.now()).toISOString().slice(0, 10);
  const nodeRef = (n: MapNode) => `${n.label}${n.path && n.path !== n.label ? ` (\`${n.path}\`)` : ""}`;
  out.push(`# ${tx("Mapa do projeto")}${d.title ? `: ${d.title}` : ""}`, "");
  out.push(`_${tx("Feito {by} em {date}, a partir de {file}. O Veocode atualiza este arquivo sozinho; não edite à mão.", { by: d.by === "veocode" ? tx("pelo Veocode (imports do código)") : tx("pela IA"), date, file: MAP_FILE })}_`, "");
  if (d.about) out.push(d.about, "");
  out.push(`## ${tx("Áreas")}`, "");
  d.groups.forEach((g, gi) => {
    if (!g.count) return;
    out.push(`### ${g.label}`);
    if (g.note) out.push(g.note);
    const ns = keyNodes(d, gi);
    for (const n of ns.slice(0, 15)) out.push(`- ${nodeRef(n)}${n.note ? `: ${n.note}` : ""}`);
    if (ns.length > 15) out.push(`- ${tx("… e mais {n}", { n: ns.length - 15 })}`);
    out.push("");
  });
  const al = areaLinks(d);
  if (al.length) {
    out.push(`## ${tx("Como as áreas se ligam")}`, "");
    for (const l of al.slice(0, 30)) out.push(`- ${d.groups[l.a].label} → ${d.groups[l.b].label}${l.labels.length ? `: ${l.labels.join(", ")}` : ""} (${l.n})`);
    out.push("");
  }
  if (d.flows.length) {
    out.push(`## ${tx("Fluxos")}`, "");
    for (const f of d.flows) {
      out.push(`### ${f.name}`);
      if (f.note) out.push(f.note);
      f.steps.forEach((s, i) => {
        const n = d.nodes[s.n];
        out.push(`${i + 1}. ${nodeRef(n)}${s.note || n.note ? `: ${s.note || n.note}` : ""}`);
      });
      out.push("");
    }
  }
  return out.join("\n");
}

/** Grava o resumo em texto ao lado do mapa (o Rust só regrava se mudou). */
function writeNotes(pid: string, d: MapData | null) {
  if (!d || !isTauri || currentProjectIsDemo(pid)) return;
  void invoke("map_write_notes", { projectId: pid, text: mapNotes(d) }).catch(() => {});
}

// ---------------------------------------------------------------- estado por projeto

interface Entry { data: MapData | null; loading: boolean; busy: "scan" | null; error: string | null; at: number }
const [maps, setMaps] = createStore<Record<string, Entry>>({});
const blank = (): Entry => ({ data: null, loading: false, busy: null, error: null, at: 0 });
export const mapOf = (pid: string): Entry => maps[pid] ?? blank();
const ensure = (pid: string) => maps[pid] || setMaps(pid, blank());

/** Lê o mapa do disco (no navegador, um mapa de exemplo). Duas telas pedindo juntas: uma leitura só. */
const reading = new Map<string, Promise<void>>();
export function loadMap(pid: string, quiet = false): Promise<void> {
  const cur = reading.get(pid);
  if (cur) return cur;
  const p = readMap(pid, quiet).finally(() => reading.delete(pid));
  reading.set(pid, p);
  return p;
}

async function readMap(pid: string, quiet: boolean) {
  ensure(pid);
  if (!quiet) setMaps(pid, "loading", true);
  try {
    let raw: string | null = null;
    let at = 0;
    if (isTauri && !currentProjectIsDemo(pid)) {
      const r = await invoke<[string, number] | null>("map_read", { projectId: pid });
      if (r) [raw, at] = [r[0], r[1] * 1000];
    } else {
      raw = lang() === "en" ? (await import("./data/demoMap.en.json?raw")).default : (await import("./data/demoMap.json?raw")).default;
      at = Date.now() - 3 * 60_000;
    }
    const data = raw ? parseMap(raw) : null;
    if (data && !data.at) data.at = at;
    if (data && !isTauri) data.at = at;
    writeNotes(pid, data);
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
    showToast(tx("No projeto de exemplo o mapa é fixo: adicione uma pasta sua para fazer o dela."));
    return loadMap(pid, true);
  }
  setMaps(pid, { busy: "scan", error: null });
  try {
    const raw = await invoke<string>("map_scan", { projectId: pid });
    const data = parseMap(raw);
    setMaps(pid, { data, busy: null, at: Date.now() });
    writeNotes(pid, data);
  } catch (e) {
    setMaps(pid, { busy: null, error: String(e) });
  }
}

/** O arquivo mudou no disco (a IA reescreveu, ou outro programa): relê. */
export function mapFileChanged(pid: string) {
  if (maps[pid]) void loadMap(pid, true);
}

/**
 * Pede à IA do projeto o mapa explicado, numa conversa nova (a que estava aberta continua como
 * estava). A conversa aparece no modo IA e dá para parar a qualquer momento.
 */
export function askAiForMap(pid: string, over?: { model?: string | null }) {
  if (!isTauri || currentProjectIsDemo(pid)) return showToast(tx("No projeto de exemplo o mapa é fixo: adicione uma pasta sua para fazer o dela."));
  const key = startConversation(pid);
  if (!key) return;
  renameTab(pid, key, tx("Mapa do projeto"));
  setInput(key, aiPrompt());
  setProjMode("ai");
  void sendChat(key, undefined, over);
}

function aiPrompt() {
  const en = lang() === "en";
  const example = en
    ? `{"v":2,"title":"…","by":"ia","at":${Math.floor(Date.now() / 1000)},
"about":"What the project is and how it's organized, in 2 or 3 sentences.",
"groups":[["screens","Screens","","what people see and use"],["services","Services","","rules and outside calls"],["data","Data","","where things are stored"]],
"nodes":[
["login","Login screen","screens",3,"src/Login.tsx","signs in with email and password"],
["auth","Auth service","services",4,"src/auth.ts","checks the password and opens the session"],
["db","Database","data",4,"","users and sessions"]
],
"links":[["login","auth","calls"],["auth","db","reads and saves to"]],
"flows":[["Sign in",[["login","the person types email and password"],["auth","checks the password"],["db","keeps the session"]]]]}`
    : `{"v":2,"title":"…","by":"ia","at":${Math.floor(Date.now() / 1000)},
"about":"O que o projeto é e como ele se organiza, em 2 ou 3 frases.",
"groups":[["telas","Telas","","o que a pessoa vê e usa"],["servicos","Serviços","","regras e chamadas para fora"],["dados","Dados","","onde as coisas ficam guardadas"]],
"nodes":[
["login","Tela de login","telas",3,"src/Login.tsx","entra com e-mail e senha"],
["auth","Serviço de login","servicos",4,"src/auth.ts","confere a senha e abre a sessão"],
["db","Banco","dados",4,"","usuários e sessões"]
],
"links":[["login","auth","chama"],["auth","db","lê e salva em"]],
"flows":[["Entrar no app",[["login","a pessoa digita e-mail e senha"],["auth","confere a senha"],["db","guarda a sessão"]]]]}`;
  return en
    ? `Make this project's map for Veocode. Read the code and write ONE file, ${MAP_FILE}, in this compact format:\n\n${example}\n\nThe map is for a person to understand the project in 2 minutes and for an AI to find where to make changes. Keep it short and concrete:\n- about: 2 or 3 sentences: what the project is and how it's organized.\n- groups: 4 to 8 areas, each [id, name, "", what the area does in one sentence].\n- nodes: only the pieces that matter (15 to 45), each [id, name, area, weight 1-5, main file or "", what it does in a few words]. Outside things (APIs, database, services) count too, with file "".\n- links: the real connections, [from, to, what goes through: a short verb like "calls", "saves to", "reads", "shows"].\n- flows: 2 to 5 main things someone does in the app, each [name, [[piece, what happens at this step], …]], 3 to 8 steps in the order they happen.\nWrite the texts in English, with short ids. Veocode draws the map and writes the summary ${MAP_NOTES} by itself from this file: don't write anything else and don't change any other file.`
    : `Faça o mapa deste projeto para o Veocode. Leia o código e escreva UM arquivo, ${MAP_FILE}, neste formato compacto:\n\n${example}\n\nO mapa é para uma pessoa entender o projeto em 2 minutos e para uma IA achar onde mexer. Seja curto e concreto:\n- about: 2 ou 3 frases: o que o projeto é e como ele se organiza.\n- groups: 4 a 8 áreas, cada uma [id, nome, "", o que a área faz numa frase].\n- nodes: só as peças que importam (15 a 45), cada uma [id, nome, área, peso 1-5, arquivo principal ou "", o que faz em poucas palavras]. Coisas de fora (APIs, banco, serviços) também valem, com arquivo "".\n- links: as ligações reais, [de, para, o que passa: um verbo curto como "chama", "salva em", "lê", "mostra"].\n- flows: 2 a 5 coisas principais que alguém faz no app, cada uma [nome, [[peça, o que acontece nesse passo], …]], de 3 a 8 passos, na ordem em que acontecem.\nEscreva os textos em português, com ids curtos. O Veocode desenha o mapa e escreve o resumo ${MAP_NOTES} sozinho a partir desse arquivo: não escreva mais nada e não mude nenhum outro arquivo.`;
}

// ---------------------------------------------------------------- abrir

export type MapViewKind = "overview" | "flows" | "graph";
/** O jeito de ver o mapa (vale para todos os projetos nesta sessão). */
export const [mapView, setMapView] = createSignal<MapViewKind>("overview");

/** Pedido para o mapa aberto: mostrar um jeito de ver, uma área, um fluxo ou um ponto. */
export interface MapIntent { view?: MapViewKind; node?: string; group?: number; flow?: number }
export const [mapIntent, setMapIntent] = createSignal<(MapIntent & { at: number }) | null>(null);

/** Abre o mapa numa aba do editor (modo Código). */
export function openMap(intent?: MapIntent) {
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
