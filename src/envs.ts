// Aba Ambiente do modo Código: os perfis do .env (qual opção de cada variável vale agora) e os
// serviços do projeto (o dev do front, do back…), cada um rodando num terminal do projeto.
// Trocar de perfil reinicia os serviços rodando que leem aquele .env: não precisa comentar
// linha nem parar e subir o servidor na mão. A leitura e a troca ficam em src-tauri/src/envs.rs.

import { invoke } from "@tauri-apps/api/core";
import { createSignal } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import { isTauri } from "./api";
import { confirmAction } from "./dialogs";
import { tx, txn } from "./i18n";
import { codeSideOpen, setCodeSideOpen, setCodeSideTab, setTermOpen, termAt } from "./layoutMode";
import { projects, showToast } from "./store";
import { addTerm, closeTerm, errMsg, replaceTerm, setActiveTerm, terms, type TermInfo } from "./terminal";
import { envNames, vault } from "./vault";

export interface EnvOption {
  line: number;
  label: string;
  hint: string;
  active: boolean;
  remote: boolean;
  prod: boolean;
}
export interface EnvGroup {
  id: string;
  keys: string[];
  options: EnvOption[];
  clash: boolean;
}
export interface EnvFile {
  path: string;
  dir: string;
  groups: EnvGroup[];
}
export interface EnvList {
  files: EnvFile[];
  plain: string[];
}
export interface Service {
  key: string;
  name: string;
  cmd: string;
  dir: string;
}

const real = (pid: string) => isTauri && !projects.find((p) => p.id === pid)?.demo;

// ---------------------------------------------------------------- simulação

const demoEnv = (): EnvList => ({
  plain: [],
  files: [
    {
      path: "back/.env",
      dir: "back",
      groups: [
        {
          id: "back/.env|DATABASE_URL",
          keys: ["DATABASE_URL"],
          clash: false,
          options: [
            { line: 1, label: "local", hint: "localhost:5432", active: true, remote: false, prod: false },
            { line: 3, label: "teste", hint: "db-teste.empresa.com", active: false, remote: true, prod: false },
            { line: 5, label: "homolog", hint: "db-hml.empresa.com", active: false, remote: true, prod: false },
          ],
        },
        {
          id: "back/.env|CONTROLE_API_URL",
          keys: ["CONTROLE_API_URL"],
          clash: false,
          options: [
            { line: 8, label: "local", hint: "localhost:4000", active: false, remote: false, prod: false },
            { line: 10, label: "homolog", hint: "api-hml.empresa.com", active: true, remote: true, prod: false },
          ],
        },
      ],
    },
  ],
});
const demoServices: Service[] = [
  { key: "front:dev", name: "front", cmd: "npm run dev", dir: "front" },
  { key: "back:dev", name: "back", cmd: "npm run dev", dir: "back" },
];

// ---------------------------------------------------------------- estado

interface State {
  env: Record<string, EnvList>;
  envLoaded: Record<string, boolean>;
  detected: Record<string, Service[]>;
  /** id do terminal → portas abertas */
  ports: Record<string, Record<string, number[]>>;
  /** chave do serviço (ou do grupo do .env) → trabalhando nele agora */
  busy: Record<string, boolean>;
}
export const [envs, setEnvs] = createStore<State>({ env: {}, envLoaded: {}, detected: {}, ports: {}, busy: {} });

const SAVED = "veocode.services";
const readSaved = (): Record<string, Service[]> => {
  try {
    return JSON.parse(localStorage.getItem(SAVED) ?? "{}") ?? {};
  } catch {
    return {};
  }
};
const [saved, setSaved] = createStore<Record<string, Service[]>>(readSaved());
const writeSaved = () => {
  try {
    localStorage.setItem(SAVED, JSON.stringify(saved));
  } catch {
    /* sem armazenamento: só não lembra */
  }
};

const AUTO = "veocode.env.restart";
const [autoRestart, setAutoRaw] = createSignal((() => {
  try {
    return localStorage.getItem(AUTO) !== "0";
  } catch {
    return true;
  }
})());
export { autoRestart };
export const setAutoRestart = (on: boolean) => {
  setAutoRaw(on);
  try {
    localStorage.setItem(AUTO, on ? "1" : "0");
  } catch {
    /* só não lembra */
  }
};

export const envOf = (pid: string): EnvList => envs.env[pid] ?? { files: [], plain: [] };
/** A lista que a pessoa montou ou, se ela nunca mexeu, a que o Veocode achou na pasta. */
export const servicesOf = (pid: string): Service[] => saved[pid] ?? envs.detected[pid] ?? [];
export const isCustom = (pid: string) => !!saved[pid];

/** O terminal do serviço (o que está rodando, se houver mais de um). */
export const termOfService = (pid: string, key: string): TermInfo | undefined => {
  const list = (terms.byProject[pid] ?? []).filter((t) => t.service === key);
  return list.find((t) => t.alive) ?? list[list.length - 1];
};
export const runningCount = (pid: string) => (terms.byProject[pid] ?? []).filter((t) => t.service && t.alive).length;
export const portsOfTerm = (pid: string, id: string) => envs.ports[pid]?.[id] ?? [];

// ---------------------------------------------------------------- leitura

export async function loadEnv(pid: string) {
  if (!real(pid)) {
    if (!envs.env[pid]) setEnvs("env", pid, demoEnv());
    return setEnvs("envLoaded", pid, true);
  }
  try {
    setEnvs("env", pid, reconcile(await invoke<EnvList>("env_list", { projectId: pid })));
  } catch {
    /* fica a lista de antes */
  }
  setEnvs("envLoaded", pid, true);
}

export async function loadServices(pid: string) {
  if (!real(pid)) return setEnvs("detected", pid, demoServices);
  try {
    setEnvs("detected", pid, reconcile(await invoke<Service[]>("services_detect", { projectId: pid })));
  } catch {
    /* sem detecção: fica a lista da pessoa */
  }
}

export async function loadPorts(pid: string) {
  if (!real(pid) || !runningCount(pid)) return setEnvs("ports", pid, {});
  try {
    setEnvs("ports", pid, reconcile(await invoke<Record<string, number[]>>("service_ports", { projectId: pid })));
  } catch {
    /* sem leitura de portas */
  }
}

// ---------------------------------------------------------------- serviços

const sim = () => showToast(tx("Na simulação nada roda: adicione uma pasta sua para subir os serviços dela."));

async function work<T>(key: string, f: () => Promise<T>): Promise<T | undefined> {
  if (envs.busy[key]) return;
  setEnvs("busy", key, true);
  try {
    return await f();
  } catch (e) {
    showToast(errMsg(e));
  } finally {
    setEnvs("busy", key, false);
  }
}

export async function startService(pid: string, s: Service): Promise<void> {
  if (!real(pid)) return sim();
  const t = termOfService(pid, s.key);
  // parou sozinho (erro, por exemplo): roda de novo no lugar dele
  if (t && !t.alive) return restartService(pid, s);
  await work(s.key, async () => {
    const info = await invoke<TermInfo>("service_start", { projectId: pid, key: s.key, name: s.name, cmd: s.cmd, dir: s.dir, cols: 110, rows: 30 });
    addTerm(pid, info);
    setTimeout(() => void loadPorts(pid), 2500);
  });
}

export async function stopService(pid: string, s: Service) {
  if (!real(pid)) return sim();
  const t = termOfService(pid, s.key);
  if (!t) return;
  await work(s.key, () => closeTerm(pid, t.id));
}

export async function restartService(pid: string, s: Service): Promise<void> {
  if (!real(pid)) return sim();
  const t = termOfService(pid, s.key);
  if (!t) return startService(pid, s);
  await work(s.key, async () => {
    const info = await invoke<TermInfo>("term_restart", { id: t.id });
    replaceTerm(pid, t.id, info);
    setTimeout(() => void loadPorts(pid), 2500);
  });
}

/** Mostra a saída do serviço no terminal (embaixo ou na aba do painel, onde ele estiver). */
export function showServiceTerm(pid: string, s: Service) {
  const t = termOfService(pid, s.key);
  if (!t) return;
  setActiveTerm(pid, t.id);
  if (termAt() === "side") {
    setCodeSideTab("term");
    if (!codeSideOpen()) setCodeSideOpen(true);
  } else setTermOpen(true);
}

export async function startAll(pid: string) {
  for (const s of servicesOf(pid)) if (!termOfService(pid, s.key)?.alive) await startService(pid, s);
}
export async function stopAll(pid: string) {
  await Promise.all(servicesOf(pid).filter((s) => termOfService(pid, s.key)?.alive).map((s) => stopService(pid, s)));
}

export function saveServices(pid: string, list: Service[] | null) {
  setSaved(produce((m) => {
    if (list) m[pid] = list;
    else delete m[pid];
  }));
  writeSaved();
}

/** Chave estável para um serviço novo (a pasta e o nome). */
export const serviceKey = (dir: string, name: string) => `${dir.trim().replace(/^\/+|\/+$/g, "")}:${name.trim().toLowerCase().replace(/\s+/g, "-")}`;

// ---------------------------------------------------------------- perfis

/** O serviço lê esse .env: ele roda na pasta do arquivo ou abaixo dela. */
const reads = (s: Service, envDir: string) => !envDir || s.dir === envDir || s.dir.startsWith(`${envDir}/`);

export async function switchEnv(pid: string, file: EnvFile, g: EnvGroup, o: EnvOption) {
  if (o.active || envs.busy[g.id]) return;
  if (o.prod) {
    const ok = await confirmAction(
      tx("Usar {label}?", { label: o.label }),
      tx("Esta opção parece de produção ({hint}). O que rodar daqui vai ler e gravar dados de verdade.", { hint: o.hint }),
      tx("Usar produção"),
      true,
    );
    if (!ok) return;
  }
  const done = await work(g.id, async () => {
    if (real(pid)) {
      setEnvs("env", pid, reconcile(await invoke<EnvList>("env_switch", { projectId: pid, file: file.path, group: g.id, line: o.line })));
    } else {
      setEnvs("env", pid, "files", (f) => f.path === file.path, "groups", (x) => x.id === g.id, "options", (list) => list.map((x) => ({ ...x, active: x.line === o.line })));
    }
    return true;
  });
  if (!done) return void loadEnv(pid);

  const affected = servicesOf(pid).filter((s) => reads(s, file.dir) && termOfService(pid, s.key)?.alive);
  const what = tx("{label} em {file}", { label: o.label, file: file.path });
  if (!affected.length) return showToast(what);
  if (!autoRestart()) return showToast(`${what} · ${txn(affected.length, "reinicie {n} serviço para valer", "reinicie {n} serviços para valer")}`);
  showToast(`${what} · ${tx("reiniciando {names}…", { names: affected.map((s) => s.name).join(", ") })}`);
  await Promise.all(affected.map((s) => restartService(pid, s)));
}

/** Variáveis do grupo que o cofre também põe nos terminais do projeto (e por isso vencem o .env
 *  em muitos carregadores, que não trocam uma variável que já existe). */
export function vaultOverrides(pid: string, keys: string[]): string[] {
  const set = new Set(
    vault.items.filter((it) => !it.projects.length || it.projects.includes(pid)).flatMap((it) => envNames(it)),
  );
  return keys.filter((k) => set.has(k));
}
