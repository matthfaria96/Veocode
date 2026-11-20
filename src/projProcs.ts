// O que está rodando dentro da pasta de um projeto (servidor de dev, build, testes…), lido do
// sistema de tempos em tempos enquanto o painel de depuração está aberto. As portas abertas
// viram endereços para o navegador do painel.
import { invoke } from "@tauri-apps/api/core";
import { createStore, reconcile } from "solid-js/store";
import { isTauri } from "./api";
import { every } from "./every";
import { projects, showToast } from "./store";
import { tx } from "./i18n";

export interface ProjProc {
  pid: number;
  cmd: string;
  ports: number[];
  cpu: number;
  mem: number;
  runSecs: number;
  /** agente de IA que iniciou (Claude Code, Codex…), se foi um */
  agent: string | null;
  pids: number[];
}

const real = (pid: string) => isTauri && !projects.find((p) => p.id === pid)?.demo;

const demo: ProjProc[] = [
  { pid: 4241, cmd: "vite --port 5173", ports: [5173], cpu: 0.8, mem: 182 * 1024 ** 2, runSecs: 1260, agent: "Claude Code", pids: [4241, 4242] },
  { pid: 4310, cmd: "cargo watch -x check", ports: [], cpu: 3.1, mem: 96 * 1024 ** 2, runSecs: 340, agent: null, pids: [4310] },
];

const [procs, setProcs] = createStore<Record<string, ProjProc[]>>({});
const [loaded, setLoaded] = createStore<Record<string, boolean>>({});
export const procsOf = (pid: string): ProjProc[] => procs[pid] ?? [];
export const procsLoaded = (pid: string) => !!loaded[pid];
/** Portas abertas no projeto, na ordem dos processos (servidores mais novos primeiro). */
export const portsOf = (pid: string): number[] => [...new Set(procsOf(pid).flatMap((p) => p.ports))];

export async function loadProcs(pid: string) {
  try {
    const list = real(pid) ? await invoke<ProjProc[]>("project_procs", { projectId: pid }) : demo;
    setProcs(pid, reconcile(list, { key: "pid" }));
  } catch {
    /* sem leitura dos processos: fica a lista anterior */
  }
  setLoaded(pid, true);
}

/** Lê agora e a cada `ms` enquanto alguém estiver olhando. Devolve a função que para. */
export function watchProcs(pid: string, ms = 3000): () => void {
  void loadProcs(pid);
  return every(() => void loadProcs(pid), ms);
}

export async function stopProc(pid: string, p: ProjProc) {
  if (!real(pid)) return showToast(tx("Simulação: nada foi encerrado"));
  try {
    await invoke("project_kill", { projectId: pid, pid: p.pid });
    showToast(tx("Encerrado: {cmd}", { cmd: p.cmd.split(" ")[0] }));
  } catch (e) {
    showToast(String(e));
  }
  setTimeout(() => void loadProcs(pid), 500);
}
