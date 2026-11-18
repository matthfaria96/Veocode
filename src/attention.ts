// "Precisa de você": junta numa lista só o que pede uma ação da pessoa, espalhado
// pelas telas (permissões, erros, conflitos no git, contas sem login, commits
// esquecidos, disco cheio de sobras). Cada item leva direto para onde se resolve.

import { createMemo } from "solid-js";
import { accts, accountById } from "./accounts";
import { projectState } from "./board";
import { formatBytes } from "./data/mock";
import { git, setGitTab } from "./git";
import { projectId, projects, setProjectId, setView, showToast, view } from "./store";
import { xray } from "./xray";
import { every } from "./every";

export type Urgency = "agora" | "logo" | "lembrete";

export interface Need {
  id: string;
  urgency: Urgency;
  title: string;
  detail: string;
  action: string;
  go: () => void;
}

const order: Record<Urgency, number> = { agora: 0, logo: 1, lembrete: 2 };

const openProject = (pid: string, tab?: "chat" | "git") => () => {
  setProjectId(pid);
  setView("workspace");
  if (tab) setGitTab(tab);
};

export const needs = createMemo<Need[]>(() => {
  const out: Need[] = [];
  for (const p of projects) {
    if (p.demo) continue;
    const st = projectState(p.id);
    if (st.tone === "ask") out.push({ id: `ask:${p.id}`, urgency: "agora", title: `${p.name}: a IA está esperando você`, detail: `${st.label}. Ela fica parada até você responder.`, action: "Responder", go: openProject(p.id, "chat") });
    if (st.tone === "error") out.push({ id: `err:${p.id}`, urgency: "logo", title: `${p.name}: a IA parou com erro`, detail: "Veja a última mensagem para entender o que aconteceu.", action: "Ver", go: openProject(p.id, "chat") });
    const g = git.summaries[p.id];
    if (g?.conflicts) out.push({ id: `conf:${p.id}`, urgency: "logo", title: `${p.name}: ${g.conflicts} ${g.conflicts === 1 ? "arquivo em conflito" : "arquivos em conflito"}`, detail: "Duas versões do mesmo trecho brigaram numa junção. Precisa escolher qual fica.", action: "Abrir o Git", go: openProject(p.id, "git") });
    if (g?.ahead && g.upstream) out.push({ id: `push:${p.id}`, urgency: "lembrete", title: `${p.name}: ${g.ahead} ${g.ahead === 1 ? "commit só neste computador" : "commits só neste computador"}`, detail: "Ainda não foram enviados para o remoto. Se o computador tiver problema, eles se perdem.", action: "Abrir o Git", go: openProject(p.id, "git") });
  }
  for (const a of accts.list) {
    const s = accts.status[a.id];
    if (!s) continue;
    const word = s.state === "semLogin" ? "precisa entrar (login)" : s.state === "semChave" ? "está sem a chave" : s.state === "erro" ? "deu erro ao conferir" : null;
    if (word) out.push({ id: `acc:${a.id}`, urgency: "logo", title: `Conta ${accountById(a.id).label} ${word}`, detail: s.detail ?? "Sem isso, os projetos dessa conta não conseguem conversar.", action: "Abrir Contas", go: () => setView("accounts") });
  }
  if (xray.cachesLoaded) {
    const total = xray.caches.reduce((s, c) => s + (c.size ?? 0), 0);
    if (total > 10 * 1024 ** 3) out.push({ id: "disk", urgency: "lembrete", title: `As IAs ocupam ${formatBytes(total)} no disco`, detail: "Históricos e arquivos temporários. Dá para mandar parte para a Lixeira.", action: "Liberar espaço", go: () => setView("system") });
  }
  return out.sort((a, b) => order[a.urgency] - order[b.urgency]);
});

export const urgentCount = () => needs().filter((n) => n.urgency !== "lembrete").length;

/**
 * Avisos de mudança: quando a IA de um projeto que você não está olhando termina ou
 * passa a esperar você, aparece um aviso curto. Confere a cada 2 s; a primeira
 * passada só anota (não avisa do que já estava assim ao abrir o app).
 */
export function startNotices(): () => void {
  const last = new Map<string, string>();
  let first = true;
  const tick = () => {
    for (const p of projects) {
      if (p.demo) continue;
      const tone = projectState(p.id).tone;
      const before = last.get(p.id);
      last.set(p.id, tone);
      if (first || before === tone) continue;
      const looking = view() === "workspace" && projectId() === p.id;
      if (looking) continue;
      if (tone === "ask") showToast(`${p.name}: a IA está esperando você responder`);
      else if (before === "work" && tone === "idle") showToast(`✓ ${p.name}: a IA terminou`);
      else if (tone === "error") showToast(`${p.name}: a IA parou com erro`);
    }
    first = false;
  };
  const stop = every(tick, 2000);
  tick();
  return stop;
}
