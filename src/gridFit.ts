// Grade que se ajusta sozinha ao número de janelas (modo foco de Projetos e tela Início):
// 2 lado a lado, 3 em linha, 4 em 2×2, 5 e 6 em 3+2 / 3×3, 7 e 8 em 4×2… e, quando a última
// linha tem menos janelas, elas dividem a largura toda.
import { createSignal, onCleanup, onMount, type Accessor } from "solid-js";

export interface GridFit {
  cols: number;
  rows: number;
  /** colunas da grade CSS (a última linha pode ter menos janelas, mais largas) */
  units: number;
  /** quantas colunas da grade cada janela ocupa (normal / na última linha) */
  unit: number;
  lastUnit: number;
  lastStart: number;
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

export function gridFit(n: number, width: number): GridFit {
  const count = Math.max(1, n);
  const fit = width < 620 ? 1 : width < 960 ? 2 : width < 1280 ? 3 : 4;
  const want = count <= 3 ? count : count === 4 ? 2 : count <= 6 ? 3 : count <= 8 ? 4 : Math.ceil(Math.sqrt(count));
  const cols = Math.max(1, Math.min(want, fit));
  const rows = Math.ceil(count / cols);
  const last = count % cols || cols;
  const units = (cols * last) / gcd(cols, last);
  return { cols, rows, units, unit: units / cols, lastUnit: units / last, lastStart: (rows - 1) * cols };
}

/** Coluna da grade que a janela `i` ocupa. */
export const spanOf = (g: GridFit, i: number) => (i >= g.lastStart ? g.lastUnit : g.unit);

/** Largura de um elemento, atualizada quando a janela muda de tamanho. */
export function useWidth(el: () => HTMLElement | undefined, initial = 1200): Accessor<number> {
  const [w, setW] = createSignal(initial);
  onMount(() => {
    const node = el();
    if (!node) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(node);
    onCleanup(() => ro.disconnect());
  });
  return w;
}
