// "Executou 2 comandos, leu 1 arquivo e editou 3 arquivos": o resumo de um bloco de passos do Claude,
// usado quando os passos ficam fechados numa linha só (conversa e cantos da tela inicial).
const WORDS: Record<string, [string, string, string]> = {
  read: ["leu", "arquivo", "arquivos"],
  search: ["buscou", "vez", "vezes"],
  edit: ["editou", "arquivo", "arquivos"],
  create: ["criou", "arquivo", "arquivos"],
  delete: ["apagou", "arquivo", "arquivos"],
  run: ["executou", "comando", "comandos"],
  web: ["pesquisou na web", "vez", "vezes"],
  tool: ["usou", "ferramenta", "ferramentas"],
  swarm: ["chamou", "ajudante", "ajudantes"],
};

export function stepsSummary(kinds: string[]): string {
  const count = new Map<string, number>();
  for (const k of kinds) count.set(k, (count.get(k) ?? 0) + 1);
  const parts: string[] = [];
  for (const [k, n] of count) {
    const w = WORDS[k];
    if (w) parts.push(`${w[0]} ${n} ${n === 1 ? w[1] : w[2]}`);
    else if (k === "think") parts.push("pensou");
    else if (k === "plan") parts.push("atualizou a lista de tarefas");
  }
  if (!parts.length) return `${kinds.length} ${kinds.length === 1 ? "passo" : "passos"}`;
  const text = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}`;
  return text[0].toUpperCase() + text.slice(1);
}
