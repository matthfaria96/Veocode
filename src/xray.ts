// Estado do Raio-X. No app (Tauri) vem do Rust; no navegador puro usa os dados fictícios.

import { createStore, produce, reconcile } from "solid-js/store";
import { isTauri, xrayApi, type AgentGroup, type CacheSpec, type InstallReport, type MachineReport } from "./api";
import { caches as mockCaches, installed as mockInstalled, machines as mockMachines, processes as mockProcs } from "./data/mock";
import { showToast } from "./store";

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
  procs: AgentGroup[];
  procsLoaded: boolean;
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
  procs: [],
  procsLoaded: false,
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
  } catch (e) {
    showToast(`Raio-X: ${errMsg(e)}`);
  }
}

export async function trashCaches(ids: string[]) {
  ids.forEach((id) => setXray("caches", (c) => c.id === id, "trashing", true));
  if (!isTauri) {
    await new Promise((r) => setTimeout(r, 700));
    ids.forEach((id) => setXray("caches", (c) => c.id === id, { size: 0, trashing: false, selected: false }));
    showToast("Navegador: simulação, nada foi movido");
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
  showToast(failed.length ? `Não deu para mover: ${failed.join("; ")}` : "Movido para a Lixeira");
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
    showToast(`Raio-X: ${errMsg(e)}`);
  }
  setXray("installsLoading", false);
}

// ---------- VMs e containers ----------

export async function loadMachines() {
  if (!isTauri) {
    setXray("machines", {
      machines: mockMachines.map((m) => ({
        id: m.id, name: m.name, kind: m.kind, engine: m.engine, running: m.status === "rodando", statusText: m.status,
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
    showToast(`Raio-X: ${errMsg(e)}`);
  }
  setXray("machinesLoading", false);
}

export async function toggleMachine(engine: string, id: string, start: boolean) {
  const key = `m:${engine}:${id}`;
  setXray("busy", key, true);
  try {
    if (isTauri) await xrayApi.toggleMachine(engine, id, start);
    showToast(start ? "Iniciado" : "Parado");
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
    showToast(`Processo ${pid} encerrado`);
    setTimeout(refreshProcs, 400);
  } catch (e) {
    showToast(errMsg(e));
  }
}

export const agentColor = (agent: string) =>
  agent.startsWith("Claude") ? "#e8915b" : agent.startsWith("Codex") ? "#10a37f" : agent.startsWith("Gemini") ? "#4f8cff" : agent.startsWith("Ollama") ? "#34d399" : agent.startsWith("DeepSeek") ? "#4f8cff" : "#a78bfa";
