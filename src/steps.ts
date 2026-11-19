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

export function stepsSummary(kinds: string[]): string {
  const count = new Map<string, number>();
  for (const k of kinds) count.set(k, (count.get(k) ?? 0) + 1);
  const parts: string[] = [];
  for (const [k, n] of count) {
    const w = WORDS[k];
    if (w) parts.push(txn(n, w[0], w[1]));
    else if (k === "think") parts.push(tx("pensou"));
    else if (k === "plan") parts.push(tx("atualizou a lista de tarefas"));
  }
  if (!parts.length) return txn(kinds.length, "{n} passo", "{n} passos");
  const text = parts.length === 1 ? parts[0] : tx("{v} e {v2}", { v: parts.slice(0, -1).join(", "), v2: parts[parts.length - 1] });
  return text[0].toUpperCase() + text.slice(1);
}
