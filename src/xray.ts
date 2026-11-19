// Estado do Raio-X. No app (Tauri) vem do Rust; no navegador puro usa os dados fictícios.

import { createSignal } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import { isTauri, xrayApi, type AgentGroup, type CacheSpec, type InstallReport, type MachineReport, type ModelReport, type PortReport } from "./api";
import { caches as mockCaches, installed as mockInstalled, machines as mockMachines, processes as mockProcs } from "./data/mock";
import { showToast } from "./store";
import { tx } from "./i18n";

export interface CacheRow extends CacheSpec {
  size: number | null; // null = medindo
  selected: boolean;
  trashing: boolean;
}

interface XrayState {
  caches: CacheRow[];
  cachesLoaded: boolean;
  installs: InstallReport | null;
  installsLoading: boolean;
  machines: MachineReport | null;
  machinesLoading: boolean;
  models: ModelReport | null;
  modelsLoading: boolean;
  procs: AgentGroup[];
  procsLoaded: boolean;
  ports: PortReport | null;
  /** pid → últimas leituras de CPU (para o gráfico). */
  cpu: Record<number, number[]>;
  busy: Record<string, boolean>;
}

export const [xray, setXray] = createStore<XrayState>({
  caches: [],
  cachesLoaded: false,
  installs: null,
  installsLoading: false,
  machines: null,
  machinesLoading: false,
  models: null,
  modelsLoading: false,
  procs: [],
  procsLoaded: false,
  ports: null,
  cpu: {},
  busy: {},
});

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------- caches ----------

export async function loadCaches() {
  if (!isTauri) {
    setXray({
      caches: mockCaches.map((c) => ({ id: c.id, label: c.label, kind: c.kind === "containers" ? "build" : c.kind, tool: c.owner, displayPaths: [c.path], warning: null, size: c.bytes, selected: false, trashing: false })),
      cachesLoaded: true,
    });
    return;
  }
  try {
    const specs = await xrayApi.caches();
    const prev = new Map(xray.caches.map((c) => [c.id, c]));
    setXray({
      caches: specs.map((s) => ({ ...s, size: prev.get(s.id)?.size ?? null, selected: prev.get(s.id)?.selected ?? false, trashing: false })),
      cachesLoaded: true,
    });
    // mede 3 de cada vez; cada tamanho aparece assim que fica pronto
    const queue = [...specs];
    const worker = async () => {
      for (let s = queue.shift(); s; s = queue.shift()) {
        const id = s.id;
        try {
          const size = await xrayApi.measure(id);
          setXray("caches", (c) => c.id === id, "size", size);
        } catch {
          setXray("caches", (c) => c.id === id, "size", 0);
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    noteDisk(xray.caches.reduce((t, c) => t + (c.size ?? 0), 0));
  } catch (e) {
    showToast(tx("Não deu para ler esta parte do computador: {v}", { v: errMsg(e) }));
  }
}

export async function trashCaches(ids: string[]) {
  ids.forEach((id) => setXray("caches", (c) => c.id === id, "trashing", true));
  if (!isTauri) {
    await new Promise((r) => setTimeout(r, 700));
    ids.forEach((id) => setXray("caches", (c) => c.id === id, { size: 0, trashing: false, selected: false }));
    showToast(tx("Navegador: simulação, nada foi movido"));
    return;
  }
  const failed: string[] = [];
  for (const id of ids) {
    try {
      await xrayApi.trash(id);
      setXray("caches", (c) => c.id === id, { size: 0, selected: false });
    } catch (e) {
      failed.push(`${id}: ${errMsg(e)}`);
    }
    setXray("caches", (c) => c.id === id, "trashing", false);
  }
  showToast(failed.length ? tx("Não deu para mover: {v}", { v: failed.join("; ") }) : tx("Movido para a Lixeira"));
  // some caches deixam de existir; recarrega a lista
  setTimeout(loadCaches, 900);
}

// ---------- instalações ----------

export async function loadInstalls() {
  if (xray.installsLoading) return;
  if (!isTauri) {
    setXray("installs", {
      aiInstalls: mockInstalled.map((i) => ({
        manager: i.manager === "npm -g" ? "npm" : i.manager,
        package: i.name,
        command: `${i.manager} install ${i.name}`,
        project: `~/dev/${i.project}`,
        when: new Date().toISOString(),
        source: "Claude Code",
        status: "instalado",
        version: i.version,
        attempts: 1,
        removeCmd: `${i.manager} uninstall ${i.name}`,
      })),
      system: [],
      transcriptsRead: 0,
      managersFound: [],
    });
    return;
  }
  setXray("installsLoading", true);
  try {
    setXray("installs", await xrayApi.installs());
  } catch (e) {
    showToast(tx("Não deu para ler esta parte do computador: {v}", { v: errMsg(e) }));
  }
  setXray("installsLoading", false);
}

// ---------- VMs e containers ----------

export async function loadMachines() {
  if (!isTauri) {
    setXray("machines", {
      machines: mockMachines.map((m) => ({
        id: m.id, name: m.name, kind: m.kind, engine: m.engine, running: m.status === "rodando", statusText: tx(m.status),
        detail: null, cpu: m.status === "rodando" ? `${m.cpu}%` : null, ram: m.ram, disk: m.disk, ports: m.ports ?? null, canToggle: m.engine === "Docker",
      })),
      engines: [],
    });
    return;
  }
  setXray("machinesLoading", true);
  try {
    setXray("machines", await xrayApi.machines());
  } catch (e) {
    showToast(tx("Não deu para ler esta parte do computador: {v}", { v: errMsg(e) }));
  }
  setXray("machinesLoading", false);
}

export async function loadModels() {
  if (!isTauri) {
    setXray("models", {
      tools: ["Ollama", "Hugging Face"],
      models: [
        { tool: "Ollama", name: "llama3.1:8b", size: 4_920_000_000, path: "~/.ollama/models", removeCmd: "ollama rm llama3.1:8b", project: "/Users/voce/Projetos/assistente", when: "2026-10-02T14:00:00Z" },
        { tool: "Hugging Face", name: "openai/whisper-small", size: 967_000_000, path: "~/.cache/huggingface/hub/models--openai--whisper-small", removeCmd: "hf cache delete openai/whisper-small", project: null, when: null },
      ],
    });
    return;
  }
  setXray("modelsLoading", true);
  try {
    setXray("models", await xrayApi.models());
  } catch (e) {
    showToast(tx("Não deu para procurar as IAs locais: {v}", { v: errMsg(e) }));
  }
  setXray("modelsLoading", false);
}

export async function toggleMachine(engine: string, id: string, start: boolean) {
  const key = `m:${engine}:${id}`;
  setXray("busy", key, true);
  try {
    if (isTauri) await xrayApi.toggleMachine(engine, id, start);
    showToast(start ? tx("Pronto, está ligado") : tx("Pronto, está desligado"));
    await loadMachines();
  } catch (e) {
    showToast(errMsg(e));
  }
  setXray("busy", key, false);
}

// ---------- processos ----------

export async function refreshProcs() {
  if (!isTauri) {
    setXray({
      procsLoaded: true,
      procs: [{
        pid: 1000, agent: "Claude Code", cwd: "~/dev/veocode", cpu: 3, mem: 220 * 1024 ** 2, runSecs: 3600, ports: [],
        children: mockProcs.map((p) => ({ pid: p.pid, name: p.cmd.split(" ")[0], cmd: p.cmd, cpu: p.cpu[p.cpu.length - 1], mem: 150 * 1024 ** 2, ports: p.port ? [Number(p.port)] : [], depth: 1 })),
      }],
    });
    return;
  }
  try {
    const groups = await xrayApi.processes();
    // reconcile por pid: as linhas existentes só atualizam os números, sem recriar nem repetir a animação
    setXray("procs", reconcile(groups, { key: "pid" }));
    setXray(
      produce((s) => {
        s.procsLoaded = true;
        const alive = new Set<number>();
        for (const g of groups) {
          for (const p of [g, ...g.children]) {
            alive.add(p.pid);
            s.cpu[p.pid] = [...(s.cpu[p.pid] ?? []), Math.round(p.cpu)].slice(-20);
          }
        }
        for (const pid of Object.keys(s.cpu).map(Number)) if (!alive.has(pid)) delete s.cpu[pid];
      }),
    );
  } catch {
    /* silencioso: tenta de novo no próximo ciclo */
  }
}

export async function killProc(pid: number) {
  try {
    if (isTauri) await xrayApi.kill(pid);
    showToast(tx("Pronto, o programa foi fechado"));
    setTimeout(refreshProcs, 400);
  } catch (e) {
    showToast(errMsg(e));
  }
}

// ---------- portas abertas ----------

export async function refreshPorts() {
  if (!isTauri) {
    setXray("ports", reconcile({
      leftovers: [{ pid: 4242, cmd: "node vite --port 5173", cwd: "~/dev/site", project: "site", ports: [5173], cpu: 0.4, mem: 180 * 1024 ** 2, runSecs: 3 * 3600, pids: [4241, 4242] }],
      others: [{ pid: 900, name: "node", cmd: "node next dev", ports: [3000], agent: "Claude Code" }, { pid: 901, name: "Discord", cmd: "Discord", ports: [6463], agent: null }],
    }, { key: "pid" }));
    return;
  }
  try {
    setXray("ports", reconcile(await xrayApi.ports(), { key: "pid" }));
  } catch {
    /* silencioso: tenta de novo no próximo ciclo */
  }
}

export async function killLeftover(pid: number) {
  setXray("busy", `l:${pid}`, true);
  try {
    if (isTauri) await xrayApi.killLeftover(pid);
    showToast(tx("Pronto, o servidor foi fechado"));
    setTimeout(refreshPorts, 400);
  } catch (e) {
    showToast(errMsg(e));
  }
  setXray("busy", `l:${pid}`, false);
}

export const agentColor = (agent: string) =>
  agent.startsWith("Claude") ? "#e8915b" : agent.startsWith("Codex") ? "#10a37f" : agent.startsWith("Gemini") ? "#4f8cff" : agent.startsWith("Ollama") ? "#34d399" : agent.startsWith("DeepSeek") ? "#4f8cff" : "#a78bfa";

// ---------- espaço ao longo dos dias ----------
// Um número por dia (o último medido), guardado neste computador. Serve só para o gráfico
// "como o espaço mudou"; se não der para guardar, o gráfico apenas não aparece.

const DISK_KEY = "veocode.disk.history";
export type DiskPoint = { day: string; bytes: number };

const today = () => new Date().toLocaleDateString("sv-SE"); // AAAA-MM-DD no fuso local

function diskHistory(): DiskPoint[] {
  try {
    const v = JSON.parse(localStorage.getItem(DISK_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((p) => typeof p?.day === "string" && typeof p?.bytes === "number") : [];
  } catch {
    return [];
  }
}

export const [diskPoints, setDiskPoints] = createSignal<DiskPoint[]>(diskHistory());

function noteDisk(bytes: number) {
  if (!isTauri || !bytes) return;
  const d = today();
  const list = diskHistory().filter((p) => p.day !== d);
  list.push({ day: d, bytes });
  list.sort((a, b) => a.day.localeCompare(b.day));
  const kept = list.slice(-60);
  try {
    localStorage.setItem(DISK_KEY, JSON.stringify(kept));
  } catch {
    /* sem armazenamento: só não guarda */
  }
  setDiskPoints(kept);
}
