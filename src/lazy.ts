// Painéis pesados (navegador, Git, mapa, diferenças, rastro…) ficam em arquivos à parte para o app
// abrir mais leve. Alguns segundos depois de abrir, eles são lidos em segundo plano, quando o app
// está parado: assim a primeira vez que você abre cada um continua instantânea.
const panels = [
  () => import("./components/Browser"),
  () => import("./components/GitPanel"),
  () => import("./components/EnvPanel"),
  () => import("./components/MapPanel"),
  () => import("./components/ProjectMap"),
  () => import("./components/DiffView"),
  () => import("./components/CommitView"),
  () => import("./components/TrailPanel"),
  () => import("./components/MapMaker"),
];

export function preloadPanels() {
  const idle = (f: () => void) => ("requestIdleCallback" in window ? window.requestIdleCallback(f, { timeout: 4000 }) : setTimeout(f, 0));
  // um de cada vez, cada um num momento parado, para não travar nada que esteja acontecendo
  const next = (i: number) => {
    if (i >= panels.length) return;
    idle(() => void panels[i]().catch(() => {}).finally(() => next(i + 1)));
  };
  setTimeout(() => next(0), 2500);
}
