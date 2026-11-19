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
import { tx } from "./i18n";

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
    if (st.tone === "ask") out.push({ id: `ask:${p.id}`, urgency: "agora", title: tx("{name}: a IA está esperando você", { name: p.name }), detail: tx("{label}. Ela fica parada até você responder.", { label: st.label }), action: tx("Responder"), go: openProject(p.id, "chat") });
    if (st.tone === "error") out.push({ id: `err:${p.id}`, urgency: "logo", title: tx("{name}: a IA parou com erro", { name: p.name }), detail: tx("Veja a última mensagem para entender o que aconteceu."), action: tx("Ver"), go: openProject(p.id, "chat") });
    const g = git.summaries[p.id];
    if (g?.conflicts) out.push({ id: `conf:${p.id}`, urgency: "logo", title: `${p.name}: ${g.conflicts} ${g.conflicts === 1 ? tx("arquivo em conflito") : tx("arquivos em conflito")}`, detail: tx("Duas versões do mesmo trecho brigaram numa junção. Precisa escolher qual fica."), action: tx("Abrir o Git"), go: openProject(p.id, "git") });
    if (g?.ahead && g.upstream) out.push({ id: `push:${p.id}`, urgency: "lembrete", title: `${p.name}: ${g.ahead} ${g.ahead === 1 ? tx("commit só neste computador") : tx("commits só neste computador")}`, detail: tx("Ainda não foram enviados para o remoto. Se o computador tiver problema, eles se perdem."), action: tx("Abrir o Git"), go: openProject(p.id, "git") });
  }
  for (const a of accts.list) {
    const s = accts.status[a.id];
    if (!s) continue;
    const word = s.state === "semLogin" ? tx("precisa entrar (login)") : s.state === "semChave" ? tx("está sem a chave") : s.state === "erro" ? tx("deu erro ao conferir") : null;
    if (word) out.push({ id: `acc:${a.id}`, urgency: "logo", title: tx("Conta {label} {word}", { label: accountById(a.id).label, word }), detail: s.detail ?? tx("Sem isso, os projetos dessa conta não conseguem conversar."), action: tx("Abrir Contas"), go: () => setView("accounts") });
  }
  if (xray.cachesLoaded) {
    const total = xray.caches.reduce((s, c) => s + (c.size ?? 0), 0);
    if (total > 10 * 1024 ** 3) out.push({ id: "disk", urgency: "lembrete", title: tx("As IAs ocupam {v} no disco", { v: formatBytes(total) }), detail: tx("Históricos e arquivos temporários. Dá para mandar parte para a Lixeira."), action: tx("Liberar espaço"), go: () => setView("system") });
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
      if (tone === "ask") showToast(tx("{name}: a IA está esperando você responder", { name: p.name }));
      else if (before === "work" && tone === "idle") showToast(tx("✓ {name}: a IA terminou", { name: p.name }));
      else if (tone === "error") showToast(tx("{name}: a IA parou com erro", { name: p.name }));
    }
    first = false;
  };
  const stop = every(tick, 2000);
  tick();
  return stop;
}
