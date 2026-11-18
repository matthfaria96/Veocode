// Inventário: tudo que as IAs instalaram ou usam neste computador, em uma lista só.
// Junta Skills e MCP (com o peso de cada um), plugins, o que está rodando agora (Rust:
// inventory.rs) e o que o Raio-X já sabe (programas instalados, VMs e caches).

import { invoke } from "@tauri-apps/api/core";
import { createStore, reconcile } from "solid-js/store";
import { isTauri, type AgentGroup } from "./api";
import { setSk, sk, loadSkills, type Item, type PluginInfo } from "./skills";
import { showToast } from "./store";

export interface McpRun {
  pid: number;
  cpu: number;
  mem: number;
  cwd: string | null;
  agent: string;
}

interface Probe {
  id: string;
  needle: string;
  project: string | null;
}

interface InvState {
  probes: Probe[];
  /** id do servidor MCP → cópias rodando agora */
  mcp: Record<string, McpRun[]>;
  agents: AgentGroup[];
  loaded: boolean;
  loading: boolean;
  runningLoaded: boolean;
  /** ação em andamento, por chave da linha */
  busy: Record<string, boolean>;
}

export const [inv, setInv] = createStore<InvState>({ probes: [], mcp: {}, agents: [], loaded: false, loading: false, runningLoaded: false, busy: {} });

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function loadInventory() {
  if (inv.loading) return;
  setInv("loading", true);
  try {
    if (isTauri) {
      const r = await invoke<{ skills: { items: Item[]; plugins: PluginInfo[] }; probes: Probe[] }>("inventory_report");
      // a tela de Skills e MCP aproveita a mesma leitura
      setSk("items", reconcile(r.skills.items, { key: "id" }));
      setSk({ plugins: r.skills.plugins, loaded: true });
      setInv("probes", r.probes);
    } else {
      if (!sk.loaded) await loadSkills();
      setInv("probes", sk.items.filter((i) => i.kind === "mcp").map((i) => ({ id: i.id, needle: i.name, project: i.project })));
    }
    setInv("loaded", true);
    await refreshRunning();
  } catch (e) {
    showToast(`Não deu para ler os extras do Claude: ${errMsg(e)}`);
  }
  setInv("loading", false);
}

/** O que está rodando agora: agentes e as cópias de cada servidor MCP. */
export async function refreshRunning() {
  try {
    if (isTauri) {
      const r = await invoke<{ mcp: Record<string, McpRun[]>; agents: AgentGroup[] }>("inventory_running", { probes: inv.probes });
      setInv("mcp", reconcile(r.mcp));
      setInv("agents", reconcile(r.agents, { key: "pid" }));
    } else {
      const first = inv.probes[0];
      setInv("mcp", first ? { [first.id]: [{ pid: 4242, cpu: 1.4, mem: 88 * 1024 ** 2, cwd: "~/dev/veocode", agent: "Claude Code" }] } : {});
      setInv("agents", [{ pid: 1000, agent: "Claude Code", cwd: "~/dev/veocode", cpu: 3, mem: 220 * 1024 ** 2, runSecs: 3600, ports: [], children: [] }]);
    }
    setInv("runningLoaded", true);
  } catch {
    /* silencioso: tenta de novo no próximo ciclo */
  }
}

async function act(key: string, run: () => Promise<unknown>, ok: string) {
  if (inv.busy[key]) return;
  setInv("busy", key, true);
  try {
    if (isTauri) await run();
    else await new Promise((r) => setTimeout(r, 600));
    showToast(isTauri ? ok : "Navegador: simulação, nada mudou");
    await loadInventory();
  } catch (e) {
    showToast(errMsg(e));
  }
  setInv("busy", key, false);
}

/** Liga, desliga ou remove um plugin pelo próprio Claude Code. */
export const pluginAction = (p: PluginInfo, action: "enable" | "disable" | "uninstall") =>
  act(
    `plugin:${p.id}`,
    () => invoke("inventory_plugin", { account: p.account, pluginId: p.pluginId, scope: p.scope, project: p.project, action }),
    action === "uninstall"
      ? `Plugin ${p.name} removido`
      : `${p.name} ${action === "enable" ? "ligado" : "desligado"}. Conversas do Claude já abertas só percebem quando recomeçam.`,
  );

/** Skill, comando ou agente → Lixeira. */
export const trashItem = (i: Item) => act(`item:${i.id}`, () => invoke("inventory_trash", { path: i.path }), `${i.name} foi para a Lixeira`);

/** Servidor MCP removido em cada conta que o tem (pelo `claude mcp remove`). */
export const removeMcp = (i: Item) =>
  act(
    `item:${i.id}`,
    async () => {
      for (const account of i.accounts) await invoke("inventory_mcp_remove", { account, name: i.name, scope: i.mcp!.scope, project: i.project });
    },
    `Servidor ${i.name} removido`,
  );
