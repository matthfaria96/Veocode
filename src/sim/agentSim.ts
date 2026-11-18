// Simulação do agente trabalhando. É só teatro: nenhum arquivo é lido ou alterado de verdade.
// Na fase 2 esta sequência passa a vir dos eventos reais (stream do CLI / API do provedor).

import { accountById } from "../accounts";
import { currentProject, finishEvent, openFile, pushEvent, resetWorkspace, setWs, ws, type FileMark } from "../store";

const CANCELLED = Symbol("cancelled");

const editLines = [
  "  const total = () => caches.reduce((s, c) => s + c.bytes, 0);",
  "",
  "  return (",
  '    <section class="system">',
  "      <h1>Raio-X do sistema</h1>",
  "      <Gauge value={total()} max={DISK_TOTAL} />",
];

const gaugeLines = [
  'import { createMemo } from "solid-js";',
  "",
  "export function Gauge(props: { value: number; max: number }) {",
  "  const pct = createMemo(() => props.value / props.max);",
  "  return (",
  '    <div class="gauge" style={{ "--pct": pct() }}>',
  '      <span class="gauge-fill" />',
  "    </div>",
  "  );",
  "}",
];

export function startAgentSim(root: HTMLElement) {
  let cancelled = false;

  const wait = async (ms: number) => {
    let left = ms;
    while (left > 0) {
      if (cancelled) throw CANCELLED;
      await new Promise((r) => setTimeout(r, 50));
      if (!ws.paused) left -= 50;
    }
    if (cancelled) throw CANCELLED;
  };

  const point = (target: string) => {
    const el = root.querySelector<HTMLElement>(`[data-target="${CSS.escape(target)}"]`);
    if (!el) return null;
    el.scrollIntoView({ block: "nearest" });
    const r = el.getBoundingClientRect();
    const rr = root.getBoundingClientRect();
    return { x: r.left - rr.left + Math.min(r.width * 0.4, 70), y: r.top - rr.top + r.height / 2 };
  };

  const move = async (id: string, target: string, click = true) => {
    const p = point(target);
    if (!p) return;
    setWs("cursors", (c) => c.id === id, { ...p, visible: true });
    await wait(700);
    if (click) {
      setWs("cursors", (c) => c.id === id, "clicking", true);
      await wait(260);
      setWs("cursors", (c) => c.id === id, "clicking", false);
    }
  };

  const mark = (path: string, m: FileMark) => setWs("marks", path, m);

  const agentLabel = () => accountById(currentProject().accountId).label;
  const agentColor = () => accountById(currentProject().accountId).color;

  async function run() {
    resetWorkspace();
    setWs("running", true);
    setWs("cursors", [{ id: "main", label: agentLabel(), color: agentColor(), x: 40, y: 40, visible: false, clicking: false, main: true }]);
    await wait(500);

    pushEvent({ kind: "user", title: "Cria a tela Raio-X mostrando o tamanho dos caches", agent: "Você", status: "ok" });
    await wait(700);

    let e = pushEvent({ kind: "think", title: "Planejando", detail: "Ler App.tsx e a view System, criar um medidor", agent: agentLabel() });
    await move("main", "chat", false);
    await wait(900);
    finishEvent(e);

    // 1. lê App.tsx
    e = pushEvent({ kind: "read", title: "Lendo src/App.tsx", agent: agentLabel() });
    await move("main", "file:src/App.tsx");
    openFile("src/App.tsx");
    mark("src/App.tsx", "read");
    await wait(800);
    finishEvent(e, "18 linhas");

    // 2. enxame de subagentes vasculhando o projeto
    e = pushEvent({ kind: "swarm", title: "3 subagentes procurando “cache”", detail: "varrendo src/ e src-tauri/", agent: agentLabel() });
    const subs = [
      { id: "s1", path: "src-tauri/src/scanner.rs" },
      { id: "s2", path: "src/views/Workspace.tsx" },
      { id: "s3", path: "CLAUDE.md" },
    ];
    const main = ws.cursors.find((c) => c.id === "main")!;
    setWs("cursors", (list) => [
      ...list,
      ...subs.map((s, i) => ({ id: s.id, label: `sub-${i + 1}`, color: agentColor(), x: main.x, y: main.y, visible: true, clicking: false, main: false })),
    ]);
    await wait(120);
    await Promise.all(
      subs.map(async (s, i) => {
        await wait(i * 180);
        await move(s.id, `file:${s.path}`);
        mark(s.path, "search");
        await wait(400);
        await move(s.id, i === 0 ? "file:src-tauri/src/lib.rs" : i === 1 ? "file:src/views/Accounts.tsx" : "file:package.json");
        mark(i === 0 ? "src-tauri/src/lib.rs" : i === 1 ? "src/views/Accounts.tsx" : "package.json", "search");
      }),
    );
    finishEvent(e, "4 ocorrências em 2 arquivos");
    // subagentes voltam para o cursor principal e somem
    const back = ws.cursors.find((c) => c.id === "main")!;
    setWs("cursors", (c) => !c.main, { x: back.x, y: back.y });
    await wait(600);
    setWs("cursors", (c) => !c.main, "visible", false);
    await wait(300);
    setWs("cursors", (list) => list.filter((c) => c.main));

    // 3. lê System.tsx
    e = pushEvent({ kind: "read", title: "Lendo src/views/System.tsx", agent: agentLabel() });
    await move("main", "file:src/views/System.tsx");
    openFile("src/views/System.tsx");
    mark("src/views/System.tsx", "read");
    await wait(900);
    finishEvent(e, "15 linhas");

    // 4. edita System.tsx
    e = pushEvent({ kind: "edit", title: "Editando src/views/System.tsx", agent: agentLabel() });
    mark("src/views/System.tsx", "edit");
    await move("main", "line:5");
    setWs("inserted", "src/views/System.tsx", { from: 5, remove: 3, lines: [] });
    for (let i = 0; i < editLines.length; i++) {
      setWs("inserted", "src/views/System.tsx", "lines", (l) => [...l, editLines[i]]);
      await move("main", `line:${9 + i}`, false);
      await wait(120);
    }
    finishEvent(e, `+${editLines.length} −3`);

    // 5. cria Gauge.tsx
    e = pushEvent({ kind: "create", title: "Criando src/components/Gauge.tsx", agent: agentLabel() });
    setWs("extraFiles", (f) => [...f, "src/components/Gauge.tsx"]);
    mark("src/components/Gauge.tsx", "new");
    await wait(300);
    await move("main", "file:src/components/Gauge.tsx");
    openFile("src/components/Gauge.tsx");
    setWs("inserted", "src/components/Gauge.tsx", { from: 0, remove: 0, lines: [] });
    for (let i = 0; i < gaugeLines.length; i++) {
      setWs("inserted", "src/components/Gauge.tsx", "lines", (l) => [...l, gaugeLines[i]]);
      await move("main", `line:${i + 1}`, false);
      await wait(90);
    }
    finishEvent(e, `${gaugeLines.length} linhas`);

    // 6. roda o build
    e = pushEvent({ kind: "run", title: "Rodando npm run build", agent: agentLabel() });
    await move("main", "terminal");
    const term = (text: string, tone?: "cmd" | "ok" | "dim") => setWs("terminal", (t) => [...t, { text, tone }]);
    term("$ npm run build", "cmd");
    await wait(500);
    term("vite v8.0.16 building for production…", "dim");
    await wait(700);
    term("✓ 214 modules transformed.", "dim");
    await wait(400);
    term("dist/assets/index.js   61.2 kB │ gzip: 19.8 kB", "dim");
    await wait(300);
    term("✓ built in 1.84s", "ok");
    finishEvent(e, "ok em 1,8 s");

    // 7. ferramenta MCP
    e = pushEvent({ kind: "tool", title: "MCP filesystem · medir ~/.npm/_cacache", detail: "somente leitura", agent: agentLabel() });
    await wait(1100);
    finishEvent(e, "3,2 GB");

    pushEvent({ kind: "done", title: "Pronto: Raio-X criado", detail: "2 arquivos alterados · build ok", agent: agentLabel(), status: "ok" });
    await move("main", "chat", false);
    setWs("running", false);
    await wait(9000);
  }

  (async () => {
    while (!cancelled) {
      try {
        await run();
      } catch (err) {
        if (err === CANCELLED) return;
        throw err;
      }
    }
  })();

  return () => {
    cancelled = true;
  };
}
