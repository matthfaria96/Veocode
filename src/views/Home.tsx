import { ArrowUpRight, Boxes, FolderOpen, FolderPlus, HardDrive, Zap } from "lucide-solid";
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { accessLevels, formatBytes } from "../data/mock";
import { accountById, accountSub, accts, isWorking, providers } from "../accounts";
import { loadCaches, loadMachines, xray } from "../xray";
import { addProjectFromPicker, projects, setProjectId, setView } from "../store";
import { CountUp, PageHeader, ProviderMark } from "../components/ui";
import { ProjectIcon } from "../components/icons";

interface Link {
  id: string;
  d: string;
  color: string;
  live: boolean;
  level: number;
  mx: number;
  my: number;
}

export default function Home() {
  let graph!: HTMLDivElement;
  const [links, setLinks] = createSignal<Link[]>([]);
  const [hover, setHover] = createSignal<string | null>(null);

  const measure = () => {
    if (!graph) return;
    const g = graph.getBoundingClientRect();
    setLinks(
      projects.flatMap((p) => {
        // a conta ou o projeto ainda não apareceu (lista carregando): fica sem linha por enquanto
        const ea = graph.querySelector<HTMLElement>(`[data-acc="${p.accountId}"]`);
        const eb = graph.querySelector<HTMLElement>(`[data-proj="${p.id}"]`);
        if (!ea || !eb) return [];
        const a = ea.getBoundingClientRect();
        const b = eb.getBoundingClientRect();
        const x1 = a.right - g.left;
        const y1 = a.top + a.height / 2 - g.top;
        const x2 = b.left - g.left;
        const y2 = b.top + b.height / 2 - g.top;
        const dx = (x2 - x1) * 0.5;
        return [{
          id: p.id,
          d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
          color: accountById(p.accountId).color,
          live: p.live,
          level: p.access,
          mx: (x1 + x2) / 2,
          my: (y1 + y2) / 2,
        }];
      }),
    );
  };

  onMount(() => {
    if (!xray.cachesLoaded) loadCaches();
    if (!xray.machines) loadMachines();
    const ro = new ResizeObserver(measure);
    ro.observe(graph);
    onCleanup(() => ro.disconnect());
  });
  createEffect(() => {
    projects.forEach((p) => (p.accountId, p.access));
    accts.list.length;
    requestAnimationFrame(measure);
  });

  const aiDisk = () => xray.caches.reduce((s, c) => s + (c.size ?? 0), 0);
  const running = () => xray.machines?.machines.filter((m) => m.running).length ?? 0;
  const active = () => xray.procs.length;
  const projectsOf = (accId: string) => projects.filter((p) => p.accountId === accId);
  const related = (accId: string, projId?: string) => {
    const h = hover();
    if (!h) return true;
    return h === accId || h === projId || projects.some((p) => p.id === h && p.accountId === accId);
  };

  return (
    <div class="page">
      <PageHeader
        title="Mapa"
        subtitle="Quem trabalha onde: cada conta de IA, os projetos que ela toca e com que nível de acesso."
        actions={
          <button class="primary-btn" onClick={addProjectFromPicker}>
            <FolderPlus size={14} /> Adicionar projeto
          </button>
        }
      />

      <div class="stats">
        <button class="stat" onClick={() => setView("workspace")}>
          <FolderOpen size={16} />
          <div><strong><CountUp value={projects.length} /></strong><span>{projects.length === 1 ? "projeto" : "projetos"}</span></div>
        </button>
        <button class="stat" onClick={() => setView("system")}>
          <Zap size={16} />
          <div><strong><CountUp value={active()} /></strong><span>{active() === 1 ? "agente de IA aberto" : "agentes de IA abertos"}</span></div>
        </button>
        <button class="stat" onClick={() => setView("system")}>
          <HardDrive size={16} />
          <div><strong><CountUp value={aiDisk()} format={formatBytes} ms={1200} /></strong><span>em caches e históricos</span></div>
        </button>
        <button class="stat" onClick={() => setView("system")}>
          <Boxes size={16} />
          <div><strong><CountUp value={running()} /></strong><span>VMs/containers rodando</span></div>
        </button>
      </div>

      <div class="graph" ref={graph}>
        <svg class="graph-links">
          <For each={links()}>
            {(l) => (
              <g classList={{ dim: !!hover() && hover() !== l.id && !projects.some((p) => p.id === l.id && p.accountId === hover()) }}>
                <path d={l.d} stroke={l.color} class="link-base" />
                <path d={l.d} stroke={l.color} class="link-flow" classList={{ live: l.live }} />
                <foreignObject x={l.mx - 40} y={l.my - 11} width="80" height="22">
                  <div class="link-tag" style={{ "--lc": accessLevels[l.level].color }}>{accessLevels[l.level].short}</div>
                </foreignObject>
              </g>
            )}
          </For>
        </svg>

        <div class="graph-col">
          <small class="col-title">Contas e IAs</small>
          <For each={accts.list}>
            {(a, i) => (
              <div
                class="node acc-node stagger"
                classList={{ dim: !related(a.id) }}
                style={{ "--c": a.color, "animation-delay": `${i() * 70}ms` }}
                data-acc={a.id}
                onMouseEnter={() => setHover(a.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => setView("accounts")}
              >
                <ProviderMark id={a.id} size={34} />
                <div class="node-text">
                  <strong>{a.label}</strong>
                  <small>{providers[a.provider].kind === "local" ? "roda na sua máquina" : (accts.status[a.id]?.plan ?? providers[a.provider].name)} · {accountSub(a)}</small>
                </div>
                <Show when={accts.status[a.id]?.usage}>
                  {(u) => (
                    <div class="node-usage" title="Tokens de hoje comparados ao dia mais pesado da semana">
                      <span style={{ width: `${(u().today / Math.max(1, ...u().days)) * 100}%` }} />
                    </div>
                  )}
                </Show>
                <Show when={isWorking(a.id)}>
                  <span class="pulse" />
                </Show>
                <span class="node-count">{projectsOf(a.id).length}</span>
              </div>
            )}
          </For>
        </div>

        <div class="graph-col right">
          <small class="col-title">Projetos</small>
          <For each={projects}>
            {(p, i) => (
              <div
                class="node proj-node stagger"
                classList={{ dim: !!hover() && !related(p.accountId, p.id) }}
                style={{ "--c": accountById(p.accountId).color, "animation-delay": `${200 + i() * 70}ms` }}
                data-proj={p.id}
                onMouseEnter={() => setHover(p.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => {
                  setProjectId(p.id);
                  setView("workspace");
                }}
              >
                <span class="node-icon"><ProjectIcon id={p.id} name={p.name} stack={p.stack} size={18} /></span>
                <div class="node-text">
                  <strong>{p.name}</strong>
                  <small>{p.stack}</small>
                </div>
                <span class="node-time" classList={{ live: p.live }}>{p.demo ? "demo" : p.live ? "ao vivo" : p.branch}</span>
                <ArrowUpRight size={14} class="node-go" />
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
