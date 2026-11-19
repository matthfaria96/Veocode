// Memória do projeto em cache (o texto que o app guarda em <dados>/memoria/<projeto>.md).
import { invoke } from "@tauri-apps/api/core";
import { createStore } from "solid-js/store";
import { isTauri } from "./api";

const [memory, setMemory] = createStore<Record<string, string>>({});
export { memory };
export const setMemoryText = (pid: string, text: string) => setMemory(pid, text);

const loading = new Set<string>();
/** Lê do disco uma vez por projeto (force relê). */
export async function loadMemory(pid: string, force = false) {
  if (!isTauri || loading.has(pid) || (!force && memory[pid] !== undefined)) return;
  loading.add(pid);
  try {
    setMemory(pid, await invoke<string>("memory_get", { projectId: pid }));
  } catch {
    setMemory(pid, "");
  } finally {
    loading.delete(pid);
  }
}
