// O desenho do mapa do projeto, em canvas: cada área é uma nuvem colorida, cada ponto um arquivo
// (ou uma ideia, no mapa da IA), as linhas são quem usa quem. Física simples (repulsão, molas e
// um ímã por área) que assenta e para; o quadro só é redesenhado quando algo muda. Arrastar move
// um ponto, arrastar o fundo passeia, a roda dá zoom. O que está vivo (a IA mexendo, mudado no
// git) ganha um anel. Usado na aba do mapa (inteiro) e no painel da direita (miniatura, sem nomes).
import type { Live, MapData, MapNode } from "./projmap";

const DARK = ["#0a84ff", "#ff9f0a", "#30d158", "#bf5af2", "#ff375f", "#40c8e0", "#ffd60a", "#7d7aff", "#ff6961", "#ac8e68"];
const LIGHT = ["#007aff", "#e58600", "#24a148", "#a24bd4", "#e3264a", "#1c9fd1", "#c79400", "#5856d6", "#d93d33", "#8f7350"];
const FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif";

export const isLight = () => document.documentElement.dataset.theme === "light";
/** A cor de uma área: a do arquivo, se ele disser, ou a da paleta do tema. */
export const groupColor = (data: MapData, g: number) => data.groups[g]?.color ?? (data.groups[g]?.id === "*" ? (isLight() ? "#8e8e93" : "#98989f") : (isLight() ? LIGHT : DARK)[g % 10]);

function theme() {
  return isLight()
    ? { hull: 0.07, link: "rgba(60,60,67,0.14)", linkOn: 0.9, label: "#1d1d1f", label2: "#6e6e73", halo: "rgba(255,255,255,0.92)", box: "rgba(29,29,31,0.88)", boxText: "#fff", ring: "#fff", gold: "#c48a12", git: "#e58600", ai: "#d6249f" }
    : { hull: 0.06, link: "rgba(235,235,245,0.11)", linkOn: 0.9, label: "#f5f5f7", label2: "#a1a1a6", halo: "rgba(22,22,24,0.9)", box: "rgba(245,245,247,0.94)", boxText: "#1d1d1f", ring: "#1c1c1e", gold: "#e3b341", git: "#ff9f0a", ai: "#ff4fd8" };
}

interface P { n: MapNode; x: number; y: number; vx: number; vy: number; r: number; deg: number; born: number }

export interface MapCtl {
  stop(): void;
  select(i: number | null, fly?: boolean): void;
  setHidden(h: Set<number>): void;
  setLive(live: Map<number, Live>): void;
  /** Destaca quem combina com a busca (vazio: ninguém). Devolve quantos achou. */
  highlight(ids: number[] | null): void;
  focusGroup(g: number): void;
  /** Mostra um fluxo: o caminho dourado, os passos numerados e o enquadramento neles. */
  setFlow(steps: number[] | null): void;
  fit(): void;
  zoomBy(k: number): void;
}

export function mountMap(host: HTMLElement, data: MapData, opts: { mini?: boolean; onSelect?: (n: MapNode | null) => void; onOpen?: (n: MapNode) => void; onHover?: (n: MapNode | null, x: number, y: number) => void } = {}): MapCtl {
  const mini = !!opts.mini;
  const cv = document.createElement("canvas");
  cv.className = "pmap-canvas";
  cv.setAttribute("role", "img");
  cv.setAttribute("aria-label", data.title);
  host.prepend(cv);
  const ctx = cv.getContext("2d")!;
  const N = data.nodes.length;
  const G = Math.max(1, data.groups.length);

  // ---------------------------------------------------------------- pontos e posição inicial
  const counts = data.groups.map((g) => g.count);
  // áreas em volta de um círculo (a maior em cima); áreas grandes ganham mais espaço
  const spread = 150 + Math.sqrt(N) * 22;
  const anchor: [number, number][] = data.groups.map((_, g) => {
    if (G === 1) return [0, 0];
    const a = (g / G) * Math.PI * 2 - Math.PI / 2;
    const k = 0.85 + Math.min(0.35, Math.sqrt((counts[g] ?? 1) / Math.max(1, N)) * 0.4);
    return [Math.cos(a) * spread * k * 1.12, Math.sin(a) * spread * k * 0.86];
  });
  const maxSize = Math.max(1, ...data.nodes.map((n) => n.size));
  const ps: P[] = data.nodes.map((n, i) => {
    const deg = n.out.length + n.inn.length;
    const r = data.files
      ? 3.2 + Math.min(9, Math.sqrt(n.size) / 5 + Math.sqrt(deg) * 0.9)
      : 4 + Math.min(10, (Math.min(5, n.size) / 5) * 6 + Math.sqrt(deg) * 1.1 + (n.size > 5 ? (n.size / maxSize) * 4 : 0));
    const [ax, ay] = anchor[n.g] ?? [0, 0];
    const k = i * 2.39996;
    const rad = 10 + Math.sqrt(i % Math.max(1, counts[n.g] ?? 1)) * 12;
    return { n, x: ax + Math.cos(k) * rad, y: ay + Math.sin(k) * rad, vx: 0, vy: 0, r: mini ? r * 0.9 : r, deg, born: n.g * 110 + (i % 40) * 9 };
  });
  // o fluxo mostrado agora (passos em ordem)
  let flowPath: number[] = [];

  let hidden = new Set<number>();
  let live = new Map<number, Live>();
  let hl: Set<number> | null = null;
  let hover: P | null = null, sel: P | null = null, drag: P | null = null, moved = false;
  const vis = (p: P) => !hidden.has(p.n.g);

  // ---------------------------------------------------------------- física
  let alpha = 1;
  const grid = new Map<number, P[]>();
  const CELL = 90;
  function tick() {
    const vs = ps.filter(vis);
    if (vs.length <= 420) {
      for (let i = 0; i < vs.length; i++)
        for (let j = i + 1; j < vs.length; j++) repel(vs[i], vs[j]);
    } else {
      // muitos pontos: só os vizinhos de célula se empurram
      grid.clear();
      for (const p of vs) {
        const k = (Math.floor(p.x / CELL) + 5000) * 10000 + Math.floor(p.y / CELL) + 5000;
        (grid.get(k) ?? grid.set(k, []).get(k)!).push(p);
      }
      for (const [k, list] of grid)
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++) {
            const other = grid.get(k + dx * 10000 + dy);
            if (!other) continue;
            for (const a of list) for (const b of other) if (a.n.i < b.n.i) repel(a, b);
          }
    }
    for (const l of data.links) {
      const a = ps[l.a], b = ps[l.b];
      if (!vis(a) || !vis(b)) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
      const same = a.n.g === b.n.g;
      const rest = (same ? 44 : 150) + a.r + b.r, k = same ? 0.016 : 0.0012;
      const f = (d - rest) * k, fx = (dx / d) * f, fy = (dy / d) * f;
      a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
    }
    for (const p of vs) {
      if (p === drag) { p.vx = p.vy = 0; continue; }
      const [ax, ay] = anchor[p.n.g] ?? [0, 0];
      p.vx += (ax - p.x) * 0.009; p.vy += (ay - p.y) * 0.009;
      p.vx *= 0.8; p.vy *= 0.8;
      p.x += p.vx * alpha; p.y += p.vy * alpha;
    }
  }
  function repel(a: P, b: P) {
    let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
    if (!(d2 >= 1)) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
    const f = Math.min(12, ((a.r + b.r) * 260) / d2), d = Math.sqrt(d2);
    dx = (dx / d) * f; dy = (dy / d) * f;
    a.vx += dx; a.vy += dy; b.vx -= dx; b.vy -= dy;
  }
  // começa já meio assentado: menos bagunça no primeiro quadro
  for (let i = 0; i < (N > 500 ? 40 : 90); i++) { tick(); alpha *= 0.985; }

  // ---------------------------------------------------------------- câmera
  let W = 0, H = 0, dpr = 1, zoom = 1, ox = 0, oy = 0, raf = 0, alive = true, dirty = true, userCam = false;
  let cam: { z: number; x: number; y: number; t0: number; from: [number, number, number] } | null = null;
  const t0 = performance.now();
  const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
  const size = () => {
    dpr = devicePixelRatio || 1;
    W = host.clientWidth; H = host.clientHeight;
    cv.width = Math.max(1, Math.round(W * dpr)); cv.height = Math.max(1, Math.round(H * dpr));
    cv.style.width = `${W}px`; cv.style.height = `${H}px`;
    if (!userCam) fitAll(true);
    dirty = true;
  };
  function bounds() {
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const p of ps) if (vis(p)) { x0 = Math.min(x0, p.x - p.r); x1 = Math.max(x1, p.x + p.r); y0 = Math.min(y0, p.y - p.r); y1 = Math.max(y1, p.y + p.r); }
    return { x0, x1, y0, y1 };
  }
  const pad = () => (mini ? [40, 30] : [150, 110]);
  function fitZoom() {
    const b = bounds(), [px, py] = pad();
    return { b, z: Math.max(0.12, Math.min(mini ? 1.2 : 1.5, W / (b.x1 - b.x0 + px), H / (b.y1 - b.y0 + py))) };
  }
  function fitAll(instant = false) {
    if (W <= 0) return;
    const { b, z } = fitZoom();
    if (!(b.x1 > b.x0)) return;
    const x = (-(b.x0 + b.x1) / 2) * z, y = (-(b.y0 + b.y1) / 2) * z;
    if (instant) (zoom = z), (ox = x), (oy = y);
    else cam = { z, x, y, t0: performance.now(), from: [zoom, ox, oy] };
    userCam = false; dirty = true;
  }
  /** Enquadra o ponto com os vizinhos dele; o cartão do ponto cobre a direita, então o
   *  enquadramento fica no que sobra. */
  const flyTo = (p: P) => {
    userCam = true;
    const card = !mini && W > 460 ? 310 : 0; // o cartão tem 290px fixos encostados à direita
    let x0 = p.x, x1 = p.x, y0 = p.y, y1 = p.y;
    for (const i of [...p.n.out, ...p.n.inn]) {
      const q = ps[i];
      if (!vis(q)) continue;
      x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y);
    }
    const z = Math.max(0.35, Math.min(1.3, (W - card) / (x1 - x0 + 220), H / (y1 - y0 + 180)));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    // com muitos vizinhos o centro da caixa foge do ponto: ele nunca pode cair embaixo do cartão
    const m = 70, clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), Math.max(a, b));
    const x = clamp(-cx * z - card / 2, m - W / 2 - p.x * z, W / 2 - card - m - p.x * z);
    const y = clamp(-cy * z, m - H / 2 - p.y * z, H / 2 - m - p.y * z);
    cam = { z, x, y, t0: performance.now(), from: [zoom, ox, oy] };
  };

  // ---------------------------------------------------------------- desenho
  function focus(): Set<number> | null {
    if (hl) return hl;
    const f = hover ?? sel;
    if (!f) return null;
    const s = new Set([f.n.i]);
    for (const o of f.n.out) s.add(o);
    for (const o of f.n.inn) s.add(o);
    return s;
  }
  function hull(pts: [number, number][]) {
    if (pts.length < 3) return pts;
    pts = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo: [number, number][] = [], up: [number, number][] = [];
    for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (const p of [...pts].reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  const colors = () => data.groups.map((_, g) => groupColor(data, g));

  function draw(now: number) {
    const T = theme(), C = colors();
    const age = mini ? 1e9 : now - t0;
    const grow = (p: P) => ease((age - p.born) / 520);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.translate(W / 2 + ox, H / 2 + oy);
    ctx.scale(zoom, zoom);
    const fs = focus(), lit = (p: P) => !fs || fs.has(p.n.i);
    const fp = hover ?? sel;

    // nuvens das áreas
    const centers: { g: number; x: number; y: number; top: number }[] = [];
    for (let g = 0; g < G; g++) {
      if (hidden.has(g)) continue;
      const pts = ps.filter((p) => p.n.g === g && grow(p) > 0.4).map((p) => [p.x, p.y] as [number, number]);
      if (!pts.length) continue;
      let cx = 0, cy = 0, top = 1e9;
      for (const [x, y] of pts) (cx += x), (cy += y), (top = Math.min(top, y));
      centers.push({ g, x: cx / pts.length, y: cy / pts.length, top });
      const h = hull(pts);
      ctx.beginPath();
      if (h.length >= 3) { h.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); }
      else for (const [x, y] of h) { ctx.moveTo(x + 1, y); ctx.arc(x, y, 1, 0, Math.PI * 2); }
      const inFocus = fs && [...fs].some((i) => data.nodes[i].g === g);
      ctx.globalAlpha = fs && !inFocus ? T.hull * 0.35 : T.hull;
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.lineWidth = (mini ? 30 : 46) / Math.max(0.55, zoom);
      ctx.strokeStyle = ctx.fillStyle = C[g];
      ctx.stroke(); ctx.fill();
    }

    // ligações
    const flowOff = (now / 45) % 24;
    ctx.lineCap = "round";
    for (const l of data.links) {
      const a = ps[l.a], b = ps[l.b];
      if (!vis(a) || !vis(b)) continue;
      const gr = Math.min(grow(a), grow(b));
      if (gr <= 0) continue;
      const on = !!fs && fs.has(a.n.i) && fs.has(b.n.i) && (!fp || a === fp || b === fp || !!hl);
      const touch = fp && (a === fp || b === fp);
      ctx.globalAlpha = gr * (fs ? (on ? T.linkOn : 0.035) : 1);
      ctx.strokeStyle = on ? C[(a === fp ? b : a).n.g] : T.link;
      ctx.lineWidth = (on ? 1.5 : 0.8) / zoom;
      // quem usa o ponto escolhido chega tracejado, andando até ele
      ctx.setLineDash(touch && b === fp ? [8 / zoom, 6 / zoom] : []);
      ctx.lineDashOffset = touch && b === fp ? -flowOff / zoom : 0;
      const dx = b.x - a.x, dy = b.y - a.y, bend = 0.1;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      if (gr >= 1 && bend) ctx.quadraticCurveTo((a.x + b.x) / 2 - dy * bend, (a.y + b.y) / 2 + dx * bend, b.x, b.y);
      else ctx.lineTo(a.x + dx * gr, a.y + dy * gr);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // o fluxo escolhido: um caminho dourado de passo em passo, com a direção andando
    if (flowPath.length > 1) {
      ctx.strokeStyle = T.gold;
      ctx.lineWidth = 2.6 / zoom;
      ctx.globalAlpha = 0.9;
      ctx.setLineDash([10 / zoom, 7 / zoom]);
      ctx.lineDashOffset = -flowOff / zoom;
      ctx.beginPath();
      for (let i = 1; i < flowPath.length; i++) {
        const a = ps[flowPath[i - 1]], b = ps[flowPath[i]];
        if (!vis(a) || !vis(b)) continue;
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // pontos
    const pulse = (Math.sin(now / 260) + 1) / 2;
    for (const p of ps) {
      if (!vis(p)) continue;
      const gr = grow(p);
      if (gr <= 0) continue;
      ctx.globalAlpha = lit(p) ? 1 : 0.13;
      const r = (p === fp ? p.r + 2 : p.r) * (gr < 1 ? 0.3 + gr * 0.7 + Math.sin(gr * Math.PI) * 0.25 : 1);
      const lv = live.get(p.n.i);
      if (lv) {
        ctx.beginPath();
        const rr = r + (lv === "now" ? 5 + pulse * 5 : 4.5);
        ctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
        ctx.strokeStyle = lv === "git" ? T.git : T.ai;
        ctx.lineWidth = (lv === "now" ? 2.4 : 1.8) / Math.max(0.6, zoom);
        ctx.globalAlpha = (lit(p) ? 1 : 0.3) * (lv === "now" ? 0.45 + pulse * 0.55 : 0.9);
        if (lv === "git") ctx.setLineDash([3 / zoom, 2.5 / zoom]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = lit(p) ? 1 : 0.13;
      }
      if (p === sel) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 6 + Math.sin(now / 300) * 1.5, 0, Math.PI * 2);
        ctx.strokeStyle = C[p.n.g]; ctx.lineWidth = 2 / zoom; ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = C[p.n.g];
      ctx.fill();
      if (!mini && r * zoom > 5) { ctx.strokeStyle = T.ring; ctx.lineWidth = 1.1 / zoom; ctx.stroke(); }
    }

    if (mini) { ctx.globalAlpha = 1; return; }

    // nomes das áreas, acima de cada nuvem: texto neutro com a bolinha da cor (os nomes dos
    // pontos desviam deles)
    const boxes: number[][] = [];
    ctx.textAlign = "left"; ctx.textBaseline = "bottom";
    for (const c of centers) {
      const fz = 12 / zoom, dot = 3.5 / zoom, gap = 6 / zoom;
      ctx.font = `600 ${fz}px ${FONT}`;
      const text = data.groups[c.g].label;
      const tw = ctx.measureText(text).width, w = dot * 2 + gap + tw;
      const x = c.x - w / 2, y = c.top - 22 / Math.max(0.55, zoom);
      ctx.globalAlpha = fs ? 0.35 : 1;
      ctx.lineWidth = 3 / zoom; ctx.strokeStyle = T.halo; ctx.lineJoin = "round";
      ctx.strokeText(text, x + dot * 2 + gap, y);
      ctx.fillStyle = T.label2;
      ctx.fillText(text, x + dot * 2 + gap, y);
      ctx.beginPath();
      ctx.arc(x + dot, y - fz * 0.36, dot, 0, Math.PI * 2);
      ctx.fillStyle = C[c.g];
      ctx.fill();
      boxes.push([x - 4, y - fz - 2, x + w + 4, y + 2]);
    }
    ctx.textAlign = "center";

    // nomes dos pontos: os maiores e os em foco primeiro, sem encavalar
    const prio = (p: P) => (p === fp ? 0 : fs?.has(p.n.i) ? 1 : live.has(p.n.i) ? 1.5 : 3 - p.r / 10);
    const order = ps.filter(vis).sort((x, y) => prio(x) - prio(y));
    ctx.textBaseline = "top";
    for (const p of order) {
      const gr = grow(p);
      if (gr < 0.6) continue;
      const pr = prio(p);
      if (fs && !fs.has(p.n.i) && pr > 1.5) continue;
      if (!fs && pr > 2 && p.r * zoom < 7) continue;
      // tamanho fixo na tela (12 px, 11 nos de fundo), qualquer que seja o zoom
      const fz = (pr <= 1.5 ? 12 : 11) / zoom;
      ctx.font = `${pr <= 1.5 ? 600 : 500} ${fz}px ${FONT}`;
      const label = p.n.label.length > 32 ? `${p.n.label.slice(0, 31)}…` : p.n.label;
      const w = ctx.measureText(label).width, x0 = p.x - w / 2 - 4, y0 = p.y + p.r + 4 / zoom;
      const box = [x0, y0, x0 + w + 8, y0 + fz + 5];
      if (pr > 0 && boxes.some((o) => box[0] < o[2] && box[2] > o[0] && box[1] < o[3] && box[3] > o[1])) continue;
      boxes.push(box);
      ctx.globalAlpha = (lit(p) ? 1 : 0.25) * ease((gr - 0.6) / 0.4);
      if (pr === 0) {
        ctx.fillStyle = T.box;
        roundRect(box[0], box[1], box[2] - box[0], box[3] - box[1], 5 / zoom);
        ctx.fill();
        ctx.fillStyle = T.boxText;
      } else {
        ctx.strokeStyle = T.halo; ctx.lineWidth = 3.2 / zoom; ctx.lineJoin = "round";
        ctx.strokeText(label, p.x, y0 + 2.5 / zoom);
        ctx.fillStyle = pr <= 2 ? T.label : T.label2;
      }
      ctx.fillText(label, p.x, y0 + 2.5 / zoom);
    }

    // número de cada passo do fluxo, no canto do ponto
    if (flowPath.length) {
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const firstAt = new Map<number, number>();
      flowPath.forEach((n, i) => !firstAt.has(n) && firstAt.set(n, i + 1));
      for (const [n, k] of firstAt) {
        const p = ps[n];
        if (!vis(p)) continue;
        const rr = 8 / zoom, x = p.x + p.r * 0.75 + rr * 0.6, y = p.y - p.r * 0.75 - rr * 0.6;
        ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2);
        ctx.fillStyle = T.gold; ctx.fill();
        ctx.font = `700 ${10 / zoom}px ${FONT}`;
        ctx.fillStyle = "#1a1408";
        ctx.fillText(String(k), x, y + 0.5 / zoom);
      }
    }
    ctx.globalAlpha = 1;
  }
  function roundRect(x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------------------------------------------------------------- laço
  function loop(now: number) {
    if (!alive) return;
    if (alpha > 0.02 || drag) {
      tick();
      if (!drag) alpha *= 0.985;
      if (!userCam && !drag && !cam) {
        const { b, z } = fitZoom();
        if (b.x1 > b.x0 && W > 0) {
          zoom += (z - zoom) * 0.1;
          ox += ((-(b.x0 + b.x1) / 2) * zoom - ox) * 0.1;
          oy += ((-(b.y0 + b.y1) / 2) * zoom - oy) * 0.1;
        }
      }
      dirty = true;
    }
    if (cam) {
      const k = ease((now - cam.t0) / 460);
      zoom = cam.from[0] + (cam.z - cam.from[0]) * k;
      ox = cam.from[1] + (cam.x - cam.from[1]) * k;
      oy = cam.from[2] + (cam.y - cam.from[2]) * k;
      if (k >= 1) cam = null;
      dirty = true;
    }
    if (!mini && (now - t0 < 2400 || sel || hover || flowPath.length)) dirty = true;
    if ([...live.values()].includes("now")) dirty = true;
    if (dirty && W > 0 && !document.hidden) { draw(now); dirty = false; }
    raf = requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------- mouse
  const at = (ev: MouseEvent) => {
    const r = cv.getBoundingClientRect();
    const x = (ev.clientX - r.left - W / 2 - ox) / zoom, y = (ev.clientY - r.top - H / 2 - oy) / zoom;
    let best: P | null = null, bd = 1e9;
    for (const p of ps) {
      if (!vis(p)) continue;
      const d = Math.hypot(p.x - x, p.y - y) - p.r;
      if (d < 7 / zoom && d < bd) (best = p), (bd = d);
    }
    return { x, y, p: best, sx: ev.clientX - r.left, sy: ev.clientY - r.top };
  };
  let pan: { x: number; y: number } | null = null;
  if (!mini) {
    cv.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      const h = at(ev);
      moved = false;
      cv.setPointerCapture(ev.pointerId);
      if (h.p) drag = h.p;
      else pan = { x: ev.clientX - ox, y: ev.clientY - oy };
    });
    cv.addEventListener("pointermove", (ev) => {
      const h = at(ev);
      if (drag) {
        if (Math.hypot(h.x - drag.x, h.y - drag.y) > 2 / zoom) (moved = true), (alpha = Math.max(alpha, 0.22));
        drag.x = h.x; drag.y = h.y; dirty = true;
        return;
      }
      if (pan) {
        ox = ev.clientX - pan.x; oy = ev.clientY - pan.y;
        userCam = true; moved = true; dirty = true;
        cv.style.cursor = "grabbing";
        return;
      }
      if (h.p !== hover) (hover = h.p), (dirty = true);
      cv.style.cursor = h.p ? "pointer" : "grab";
      opts.onHover?.(h.p?.n ?? null, h.sx, h.sy);
    });
    cv.addEventListener("pointerup", (ev) => {
      const h = at(ev);
      if (!moved) select(h.p?.n.i ?? null, false);
      drag = null; pan = null;
      cv.style.cursor = h.p ? "pointer" : "grab";
    });
    cv.addEventListener("dblclick", (ev) => {
      const h = at(ev);
      if (h.p) opts.onOpen?.(h.p.n);
    });
    cv.addEventListener("pointerleave", () => {
      if (hover) (hover = null), (dirty = true);
      opts.onHover?.(null, 0, 0);
    });
    cv.addEventListener(
      "wheel",
      (ev) => {
        ev.preventDefault();
        const r = cv.getBoundingClientRect(), mx = ev.clientX - r.left - W / 2, my = ev.clientY - r.top - H / 2;
        // pinça do trackpad chega com ctrl; rolar com dois dedos passeia
        if (!ev.ctrlKey && Math.abs(ev.deltaX) > Math.abs(ev.deltaY) * 0.5 && ev.deltaMode === 0) {
          ox -= ev.deltaX; oy -= ev.deltaY; userCam = true; cam = null; dirty = true;
          return;
        }
        const dy = ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaY;
        const nz = Math.max(0.12, Math.min(4, zoom * Math.exp(-Math.max(-120, Math.min(120, dy)) * (ev.ctrlKey ? 0.012 : 0.0024))));
        ox = mx - ((mx - ox) * nz) / zoom; oy = my - ((my - oy) * nz) / zoom; zoom = nz;
        userCam = true; cam = null; dirty = true;
      },
      { passive: false },
    );
  }

  function select(i: number | null, fly = true) {
    sel = i == null ? null : ps[i] ?? null;
    hl = null; dirty = true;
    if (sel && fly) flyTo(sel);
    opts.onSelect?.(sel?.n ?? null);
  }

  const ro = new ResizeObserver(size);
  ro.observe(host);
  size();
  const theme$ = new MutationObserver(() => (dirty = true));
  theme$.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  raf = requestAnimationFrame(loop);

  return {
    stop() { alive = false; cancelAnimationFrame(raf); ro.disconnect(); theme$.disconnect(); cv.remove(); },
    select,
    setHidden(h) { hidden = h; alpha = Math.max(alpha, 0.3); if (sel && hidden.has(sel.n.g)) select(null); fitAll(); },
    setLive(l) { live = l; dirty = true; },
    highlight(ids) { hl = ids && ids.length ? new Set(ids) : null; dirty = true; },
    focusGroup(g) {
      const list = ps.filter((p) => p.n.g === g);
      if (!list.length) return;
      hl = new Set(list.map((p) => p.n.i));
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const p of list) (x0 = Math.min(x0, p.x)), (x1 = Math.max(x1, p.x)), (y0 = Math.min(y0, p.y)), (y1 = Math.max(y1, p.y));
      const z = Math.max(0.3, Math.min(1.8, W / (x1 - x0 + 260), H / (y1 - y0 + 200)));
      userCam = true;
      cam = { z, x: (-(x0 + x1) / 2) * z, y: (-(y0 + y1) / 2) * z, t0: performance.now(), from: [zoom, ox, oy] };
      dirty = true;
    },
    setFlow(steps) {
      flowPath = steps ?? [];
      hl = flowPath.length ? new Set(flowPath) : null;
      dirty = true;
      if (!flowPath.length) return;
      const list = flowPath.map((i) => ps[i]).filter(vis);
      if (!list.length) return;
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const p of list) (x0 = Math.min(x0, p.x)), (x1 = Math.max(x1, p.x)), (y0 = Math.min(y0, p.y)), (y1 = Math.max(y1, p.y));
      const z = Math.max(0.3, Math.min(1.6, W / (x1 - x0 + 300), H / (y1 - y0 + 220)));
      userCam = true;
      cam = { z, x: (-(x0 + x1) / 2) * z, y: (-(y0 + y1) / 2) * z, t0: performance.now(), from: [zoom, ox, oy] };
    },
    fit: () => { hl = null; fitAll(); },
    zoomBy(k) {
      const nz = Math.max(0.12, Math.min(4, zoom * k));
      cam = { z: nz, x: (ox * nz) / zoom, y: (oy * nz) / zoom, t0: performance.now(), from: [zoom, ox, oy] };
      userCam = true;
    },
  };
}
