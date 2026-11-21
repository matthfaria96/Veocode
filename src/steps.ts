import { tx, txn } from "./i18n";
// "Executou 2 comandos, leu 1 arquivo e editou 3 arquivos": o resumo de um bloco de passos do Claude,
// usado quando os passos ficam fechados numa linha só (conversa e cantos da tela inicial).
const WORDS: Record<string, [string, string]> = {
  read: ["leu {n} arquivo", "leu {n} arquivos"],
  search: ["buscou {n} vez", "buscou {n} vezes"],
  edit: ["editou {n} arquivo", "editou {n} arquivos"],
  create: ["criou {n} arquivo", "criou {n} arquivos"],
  delete: ["apagou {n} arquivo", "apagou {n} arquivos"],
  run: ["executou {n} comando", "executou {n} comandos"],
  web: ["pesquisou na web {n} vez", "pesquisou na web {n} vezes"],
  tool: ["usou {n} ferramenta", "usou {n} ferramentas"],
  swarm: ["chamou {n} ajudante", "chamou {n} ajudantes"],
};

/** Um arquivo só (mesmo editado várias vezes): o nome dele no lugar de "1 arquivo", como no Claude Code. */
const ONE: Record<string, string> = { edit: "editou {name}", create: "criou {name}", delete: "apagou {name}", read: "leu {name}" };
const FILES = new Set(["read", "edit", "create", "delete"]);

export function stepsSummary(kinds: string[], paths?: (string | null | undefined)[]): string {
  const count = new Map<string, number>();
  // arquivos contam uma vez cada (três edições no mesmo arquivo: "editou app.ts")
  const files = new Map<string, Set<string>>();
  kinds.forEach((k, i) => {
    const p = paths?.[i];
    if (p && FILES.has(k)) {
      const s = files.get(k) ?? new Set<string>();
      if (s.has(p)) return;
      s.add(p);
      files.set(k, s);
    }
    count.set(k, (count.get(k) ?? 0) + 1);
  });
  const parts: string[] = [];
  for (const [k, n] of count) {
    const w = WORDS[k];
    const only = files.get(k);
    if (n === 1 && only?.size === 1 && ONE[k]) {
      const p = [...only][0];
      parts.push(tx(ONE[k], { name: p.slice(p.lastIndexOf("/") + 1) }));
    } else if (w) parts.push(txn(n, w[0], w[1]));
    else if (k === "think") parts.push(tx("pensou"));
    else if (k === "plan") parts.push(tx("atualizou a lista de tarefas"));
  }
  if (!parts.length) return txn(kinds.length, "{n} passo", "{n} passos");
  const text = parts.length === 1 ? parts[0] : tx("{v} e {v2}", { v: parts.slice(0, -1).join(", "), v2: parts[parts.length - 1] });
  return text[0].toUpperCase() + text.slice(1);
}
