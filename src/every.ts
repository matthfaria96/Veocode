// Repetições que respeitam a janela: com o Veocode minimizado ou escondido atrás de outro app,
// nada é lido do disco nem dos processos. Ao voltar, roda na hora para a tela não ficar velha.

export const hidden = () => typeof document !== "undefined" && document.hidden;

/** Como setInterval, mas pula as voltas com a janela escondida. Devolve a função que para. */
export function every(fn: () => void, ms: number): () => void {
  const t = window.setInterval(() => {
    if (!hidden()) fn();
  }, ms);
  const back = () => {
    if (!hidden()) fn();
  };
  document.addEventListener("visibilitychange", back);
  return () => {
    clearInterval(t);
    document.removeEventListener("visibilitychange", back);
  };
}
