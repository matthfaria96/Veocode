// "+12 −3" no chat: um clique leva ao que mudou, no modo Código do projeto (a comparação abre no
// editor e o Git fica aberto à direita). Um arquivo só: a comparação dele; vários: todas juntas.
import { setCodeSideOpen, setCodeSideTab, setProjMode } from "./layoutMode";
import { openAllChanges, openDiff, projectId, setProjectId, setView, view } from "./store";

export function showChange(pid: string, path?: string | null) {
  const go = () => {
    setProjMode("code");
    setCodeSideTab("git");
    setCodeSideOpen(true);
    if (path) openDiff(path);
    else openAllChanges();
  };
  if (projectId() === pid && view() === "workspace") return go();
  // trocar de projeto (ou de tela) recomeça o espaço de trabalho: abre a comparação depois disso
  setProjectId(pid);
  setView("workspace");
  setTimeout(go, 60);
}

/** Linhas que entraram e saíram num passo de edição ("+12 −3"; arquivo criado: "40 linhas"). */
export function lineDelta(kind: string, detail?: string | null): { add: number; del: number } | null {
  if (!detail) return null;
  if (kind === "edit") {
    const m = /^\+(\d+)\s*[−-](\d+)$/.exec(detail.trim());
    return m ? { add: Number(m[1]), del: Number(m[2]) } : null;
  }
  if (kind === "create") {
    const m = /^(\d+)\s/.exec(detail.trim());
    return m ? { add: Number(m[1]), del: 0 } : null;
  }
  return null;
}
