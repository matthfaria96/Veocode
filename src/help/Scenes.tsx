// Ilustrações animadas da Ajuda: miniaturas de cada tela, desenhadas em SVG com as cores do
// tema (classes .il-* em styles.css). Mais leves que capturas de tela, nunca mostram dados
// pessoais e acompanham o tema.

import { Eye, FolderOpen, KeyRound, Lock, MessageSquare, User } from "lucide-solid";
import { For, type JSX } from "solid-js";
import { FileIcon, FolderIcon, ProjectIcon } from "../components/icons";
import type { TopicId } from "./topics";
import { tx } from "../i18n";

const C = { claude: "#e8915b", deep: "#4f8cff", local: "#34d399", purple: "#a78bfa", ok: "#34d399", warn: "#fbbf24", err: "#f87171", info: "#60a5fa" };
const levels: [string, string][] = [["Leitura", "#60a5fa"], ["Sugerir", "#a78bfa"], ["Editar", "#fbbf24"], ["Total", "#f87171"]];

const Svg = (props: { children: JSX.Element }) => (
  <svg class="il" viewBox="0 0 520 220" role="img" aria-hidden="true">
    {props.children}
  </svg>
);

/** Barrinha cinza no lugar de texto. */
const Bar = (p: { x: number; y: number; w: number; h?: number; cls?: string; style?: JSX.CSSProperties }) => (
  <rect x={p.x} y={p.y} width={p.w} height={p.h ?? 6} rx={(p.h ?? 6) / 2} class={p.cls ?? "il-bar"} style={p.style} />
);

/** Animação em sequência: cada parte entra um pouco depois da anterior (laço de 8 s). */
const seq = (i: number): JSX.CSSProperties => ({ "animation-delay": `${i * 0.7}s` });
/** Entrada escalonada (uma vez). */
const rise = (i: number): JSX.CSSProperties => ({ "animation-delay": `${i * 0.16}s` });

// ---------------------------------------------------------------- cenas

function Inicio() {
  const steps: [string, (p: { x: number; y: number; size: number; class: string }) => JSX.Element, string][] = [
    [tx("Pasta"), (p) => <FolderOpen {...p} />, C.info],
    [tx("Conta"), (p) => <User {...p} />, C.claude],
    [tx("Conversa"), (p) => <MessageSquare {...p} />, C.ok],
  ];
  return (
    <Svg>
      <For each={steps}>
        {([label, Icon, color], i) => {
          const x = 24 + i() * 168;
          return (
            <g class="il-rise" style={{ ...rise(i()), "--c": color }}>
              <rect x={x} y={30} width={136} height={96} rx={14} class="il-card" />
              <circle cx={x + 18} cy={48} r={10} class="il-num" />
              <text x={x + 18} y={52} class="il-t il-num-t">{i() + 1}</text>
              <rect x={x + 48} y={46} width={40} height={40} rx={11} class="il-tint" />
              <Icon x={x + 56} y={54} size={24} class="il-ico" />
              <text x={x + 68} y={110} class="il-t il-mid">{label}</text>
            </g>
          );
        }}
      </For>
      <path d="M160 78 H192" class="il-flow" style={{ "--c": C.info }} />
      <path d="M328 78 H360" class="il-flow" style={{ "--c": C.claude }} />
      <text x={260} y={156} class="il-t il-mid il-dim">{tx("e o nível de acesso decide quanto ela pode mexer")}</text>
      <For each={levels}>{([, c], i) => <rect x={150 + i() * 56} y={170} width={52} height={8} rx={4} style={{ fill: c, opacity: 0.75 }} />}</For>
      <circle cx={0} cy={174} r={9} class="il-knob il-slide" />
    </Svg>
  );
}

function Painel() {
  // a grade de projetos, cada um com a conversa ao vivo; o de baixo à direita pede permissão
  const cells = [
    { x: 14, y: 10, c: C.claude, lines: [70, 120, 92], state: "work" },
    { x: 266, y: 10, c: C.deep, lines: [110, 80, 130], state: "work" },
    { x: 14, y: 94, c: C.local, lines: [90, 60, 0], state: "idle" },
    { x: 266, y: 94, c: C.claude, lines: [80, 0, 0], state: "ask" },
  ];
  const dock = [C.purple, C.info, C.ok];
  return (
    <Svg>
      <For each={cells}>
        {(k, i) => (
          <g class="il-rise" style={rise(i())}>
            <rect x={k.x} y={k.y} width={240} height={76} rx={10} class={k.state === "ask" ? "il-win il-pulse-box" : "il-win"} style={k.state === "ask" ? { stroke: C.warn } : k.state === "work" ? { stroke: k.c } : {}} />
            <rect x={k.x + 10} y={k.y + 9} width={14} height={14} rx={4} style={{ fill: k.c, opacity: 0.85 }} />
            <Bar x={k.x + 30} y={k.y + 13} w={58} />
            <circle cx={k.x + 100} cy={k.y + 16} r={3.5} class={k.state === "idle" ? "" : "il-blink"} style={{ fill: k.state === "ask" ? C.warn : k.state === "work" ? C.ok : "var(--text-3)" }} />
            <rect x={k.x + 150} y={k.y + 30} width={80} height={11} rx={5.5} class="il-bubble-me" />
            <For each={k.lines.filter((w) => w)}>
              {(w, j) => <Bar x={k.x + 12} y={k.y + 48 + j() * 9} w={w} h={4} cls={j() === k.lines.filter((x) => x).length - 1 && k.state === "work" ? "il-bar il-typing" : "il-bar"} />}
            </For>
            {k.state === "ask" && (
              <g>
                <rect x={k.x + 12} y={k.y + 48} width={216} height={20} rx={6} style={{ fill: "color-mix(in srgb, #fbbf24 12%, transparent)", stroke: "color-mix(in srgb, #fbbf24 45%, transparent)" }} />
                <rect x={k.x + 128} y={k.y + 52} width={42} height={12} rx={6} class="il-bar" />
                <rect x={k.x + 176} y={k.y + 52} width={44} height={12} rx={6} style={{ fill: C.ok }} />
              </g>
            )}
          </g>
        )}
      </For>
      {/* a barra "Outros projetos": clique põe na tela, arrastar troca */}
      <g class="il-rise" style={rise(4)}>
        <rect x={14} y={180} width={492} height={32} rx={10} class="il-card" />
        <text x={28} y={200} class="il-t il-tiny il-dim">{tx("Outros projetos")}</text>
        <For each={dock}>
          {(c, i) => (
            <g>
              <rect x={124 + i() * 86} y={188} width={78} height={16} rx={8} class="il-item" />
              <rect x={130 + i() * 86} y={192} width={8} height={8} rx={2.5} style={{ fill: c, opacity: 0.85 }} />
              <Bar x={144 + i() * 86} y={193} w={44} h={5} />
            </g>
          )}
        </For>
        <rect x={420} y={188} width={78} height={16} rx={8} class="il-pill" style={{ "--c": C.info }} />
        <text x={459} y={199.5} class="il-t il-mid il-tiny" style={{ fill: C.info }}>{tx("+ Adicionar")}</text>
      </g>
    </Svg>
  );
}
function Projetos() {
  const code = [70, 120, 96, 140, 60, 110, 130, 84, 100, 76, 118, 64];
  const tabs: [string, number][] = [["Git", 36], ["Terminal", 58], [tx("Ambiente"), 58]];
  return (
    <Svg>
      <rect x={10} y={8} width={500} height={204} rx={12} class="il-win" />
      {/* árvore */}
      <For each={[0, 1, 2, 3, 4, 5, 6, 7]}>
        {(r) => (
          <>
            <Bar x={r === 2 || r === 3 ? 32 : 22} y={30 + r * 20} w={r === 3 ? 62 : 48 + ((r * 13) % 30)} cls={r === 3 ? "il-bar il-hl" : "il-bar"} />
            {r === 3 && <circle cx={112} cy={33 + r * 20} r={4} class="il-mark" style={{ "--c": C.warn }} />}
            {r === 5 && <circle cx={112} cy={33 + r * 20} r={4} class="il-mark" style={{ "--c": C.ok, "animation-delay": "1.2s" }} />}
          </>
        )}
      </For>
      <line x1={126} y1={8} x2={126} y2={212} class="il-sep" />
      {/* editor */}
      <For each={code}>
        {(w, i) => (
          <>
            {i() === 4 && <rect x={128} y={26 + i() * 14} width={186} height={12} class="il-changed" />}
            <Bar x={140 + (i() % 3 === 1 ? 14 : 0)} y={29 + i() * 14} w={Math.min(w, 150)} h={5} cls={i() === 4 ? "il-bar il-typing" : "il-bar"} />
          </>
        )}
      </For>
      <line x1={316} y1={8} x2={316} y2={212} class="il-sep" />
      {/* painel da direita: abas Git, Terminal e Ambiente; o terminal aberto */}
      <For each={tabs}>
        {([label, w], i) => {
          const x = 326 + [0, 42, 106][i()];
          return (
            <>
              {i() === 1 && <rect x={x} y={18} width={w} height={18} rx={6} class="il-pill" style={{ "--c": C.info }} />}
              <text x={x + w / 2} y={30.5} class={i() === 1 ? "il-t il-mid il-tiny" : "il-t il-mid il-tiny il-dim"}>{label}</text>
            </>
          );
        }}
      </For>
      <rect x={326} y={46} width={174} height={156} rx={8} class="il-term" />
      <g class="il-rise" style={rise(1)}>
        <text x={336} y={64} class="il-t il-mono il-tiny"><tspan class="il-term-p">{tx("loja $")}</tspan> {tx("npm test")}</text>
      </g>
      <g class="il-rise" style={rise(2)}>
        <text x={336} y={80} class="il-t il-mono il-tiny il-term-ok">{tx("✓ 12 testes passaram")}</text>
      </g>
      <g class="il-rise" style={rise(3)}>
        <text x={336} y={96} class="il-t il-mono il-tiny"><tspan class="il-term-p">{tx("loja $")}</tspan></text>
        <rect x={371} y={89} width={5} height={9} class="il-blink" style={{ fill: C.info }} />
      </g>
      {/* cursor da conta */}
      <g class="il-cursor" style={{ "--c": C.claude }}>
        <path d="M0 0 L0 14 L4 10 L7 17 L9.5 16 L6.5 9 L12 9 Z" />
        <rect x={10} y={14} width={42} height={13} rx={6.5} />
        <text x={31} y={23.5} class="il-t il-mid il-tiny il-on-c">Claude</text>
      </g>
    </Svg>
  );
}
function Chat() {
  return (
    <Svg>
      <rect x={120} y={6} width={280} height={208} rx={12} class="il-win" />
      <g class="il-seq" style={seq(0)}>
        <rect x={270} y={18} width={118} height={24} rx={10} class="il-bubble-me" />
        <Bar x={282} y={27} w={90} h={5} cls="il-bar il-on" />
      </g>
      <g class="il-seq" style={seq(1)}>
        <rect x={132} y={50} width={200} height={20} rx={8} class="il-step" />
        <circle cx={145} cy={60} r={4} style={{ fill: C.info }} />
        <text x={156} y={63.5} class="il-t il-tiny">{tx("Leu src/app.ts")}</text>
      </g>
      <g class="il-seq" style={seq(2)}>
        <rect x={132} y={76} width={244} height={42} rx={10} class="il-bubble" />
        <Bar x={144} y={87} w={200} h={5} />
        <Bar x={144} y={99} w={150} h={5} />
      </g>
      <g class="il-seq" style={{ ...seq(3), "--c": C.warn }}>
        <rect x={132} y={124} width={244} height={46} rx={10} class="il-ask" />
        <text x={144} y={141} class="il-t">{tx("Rodar npm install?")}</text>
        <rect x={144} y={149} width={56} height={15} rx={6} class="il-btn-ok" />
        <text x={172} y={159.5} class="il-t il-mid il-tiny il-on-c">{tx("Permitir")}</text>
        <rect x={206} y={149} width={56} height={15} rx={6} class="il-btn" />
        <text x={234} y={159.5} class="il-t il-mid il-tiny">{tx("Recusar")}</text>
      </g>
      <rect x={132} y={180} width={256} height={26} rx={9} class="il-input" />
      <rect x={140} y={186} width={46} height={14} rx={7} class="il-pill" style={{ "--c": levels[2][1] }} />
      <text x={163} y={196} class="il-t il-mid il-tiny" style={{ fill: levels[2][1] }}>{tx("Editar")}</text>
      <circle cx={374} cy={193} r={8} class="il-send" />
    </Svg>
  );
}

function Livre() {
  return (
    <Svg>
      <rect x={110} y={6} width={300} height={208} rx={12} class="il-win" />
      {/* os dois modos: o marcador vai de "Só conversa" para "Olhar o PC" */}
      <rect x={206} y={16} width={190} height={22} rx={8} class="il-input" />
      <rect x={209} y={19} width={92} height={16} rx={6} class="il-thumb" />
      <text x={255} y={30.5} class="il-t il-mid il-tiny">{tx("Só conversa")}</text>
      <Eye x={312} y={21} size={11} class="il-ico" style={{ color: C.info }} />
      <text x={355} y={30.5} class="il-t il-mid il-tiny" style={{ fill: C.info }}>{tx("Olhar o PC")}</text>
      <g class="il-seq" style={seq(1)}>
        <rect x={268} y={48} width={130} height={22} rx={10} class="il-bubble-me" />
        <text x={333} y={62.5} class="il-t il-mid il-tiny">{tx("Ache o contrato em PDF")}</text>
      </g>
      <g class="il-seq" style={seq(2)}>
        <rect x={122} y={78} width={220} height={20} rx={8} class="il-step" />
        <circle cx={135} cy={88} r={4} style={{ fill: C.info }} />
        <text x={146} y={91.5} class="il-t il-tiny">{tx("Lendo ~/Downloads/contrato.pdf")}</text>
      </g>
      <g class="il-seq" style={{ ...seq(3), "--c": C.err }}>
        <rect x={122} y={102} width={220} height={20} rx={8} class="il-step il-step-no" />
        <Lock x={130} y={106} size={11} class="il-ico" style={{ color: C.err }} />
        <text x={146} y={115.5} class="il-t il-tiny" style={{ fill: C.err }}>{tx("~/.ssh bloqueado")}</text>
      </g>
      <g class="il-seq" style={seq(4)}>
        <rect x={122} y={128} width={260} height={42} rx={10} class="il-bubble" />
        <Bar x={134} y={139} w={210} h={5} />
        <Bar x={134} y={151} w={160} h={5} />
      </g>
      <rect x={122} y={180} width={276} height={26} rx={9} class="il-input" />
      <Bar x={134} y={190} w={120} h={5} />
      <circle cx={384} cy={193} r={8} class="il-send" />
    </Svg>
  );
}

function Contas() {
  const cards = [
    { x: 30, c: C.claude, name: "Claude · trabalho", bars: [30, 52, 40, 66, 48, 72, 58] },
    { x: 276, c: C.deep, name: "DeepSeek", bars: [18, 26, 44, 30, 22, 38, 50], key: true },
  ];
  return (
    <Svg>
      <For each={cards}>
        {(k, ci) => (
          <g class="il-rise" style={{ ...rise(ci()), "--c": k.c }}>
            <rect x={k.x} y={20} width={214} height={180} rx={14} class="il-card" />
            <rect x={k.x + 14} y={34} width={28} height={28} rx={8} class="il-tint" />
            <text x={k.x + 28} y={53} class="il-t il-mid il-c">{k.name[0]}</text>
            <text x={k.x + 52} y={45} class="il-t">{k.name}</text>
            <Bar x={k.x + 52} y={52} w={70} h={4} />
            <For each={k.bars}>
              {(h, i) => <rect x={k.x + 20 + i() * 26} y={170 - h} width={16} height={h} rx={4} class="il-ubar" style={{ "animation-delay": `${ci() * 0.3 + i() * 0.07}s` }} />}
            </For>
            <line x1={k.x + 14} y1={172} x2={k.x + 200} y2={172} class="il-sep" />
            {k.key && (
              <g>
                <rect x={k.x + 150} y={32} width={52} height={20} rx={10} class="il-pill" style={{ "--c": C.ok }} />
                <KeyRound x={k.x + 157} y={36} size={12} class="il-ico" style={{ color: C.ok }} />
                <text x={k.x + 183} y={46} class="il-t il-mid il-tiny" style={{ fill: C.ok }}>{tx("saldo")}</text>
              </g>
            )}
          </g>
        )}
      </For>
    </Svg>
  );
}

function RaioX() {
  const caches: [string, number, string][] = [
    ["npm", 150, C.err],
    ["Claude", 110, C.claude],
    ["pip", 70, C.info],
    ["Docker", 128, C.purple],
  ];
  return (
    <Svg>
      <g transform="translate(118 110)">
        <circle r={86} class="il-ring" />
        <circle r={58} class="il-ring" />
        <circle r={30} class="il-ring" />
        <path d="M0 0 L86 0 A86 86 0 0 0 60.8 -60.8 Z" class="il-sweep" />
        <circle cx={34} cy={-40} r={4} class="il-blip" style={{ "animation-delay": "0.4s" }} />
        <circle cx={-50} cy={22} r={4} class="il-blip" style={{ "animation-delay": "1.6s", "--c": C.claude }} />
        <circle cx={18} cy={52} r={4} class="il-blip" style={{ "animation-delay": "2.4s", "--c": C.info }} />
      </g>
      <For each={caches}>
        {([label, w, c], i) => (
          <g class="il-rise" style={rise(i())}>
            <text x={260} y={52 + i() * 40} class="il-t">{label}</text>
            <rect x={314} y={43 + i() * 40} width={180} height={12} rx={6} class="il-bar" />
            <rect x={314} y={43 + i() * 40} width={w} height={12} rx={6} class="il-grow" style={{ fill: c, "animation-delay": `${i() * 0.15}s` }} />
          </g>
        )}
      </For>
    </Svg>
  );
}

function Ajustes() {
  const cards: { x: number; style: "detalhado" | "minimalista"; label: string; on: boolean }[] = [
    { x: 40, style: "detalhado", label: tx("Detalhados"), on: true },
    { x: 276, style: "minimalista", label: tx("Minimalistas"), on: false },
  ];
  const tree: [string, boolean][] = [["src", true], ["App.tsx", false], ["main.rs", false], ["tests", true]];
  return (
    <Svg>
      <For each={cards}>
        {(c, i) => (
          <g class="il-rise" style={rise(i())}>
            <rect x={c.x} y={14} width={204} height={192} rx={14} class="il-card" classList={{ "il-on": c.on }} />
            <g transform={`translate(${c.x + 18} 30)`}>
              <ProjectIcon id="veocode" name="veocode" stack="Rust" size={20} style={c.style} />
            </g>
            <text x={c.x + 56} y={50} class="il-t">veocode</text>
            <For each={tree}>
              {([name, dir], r) => (
                <>
                  <g transform={`translate(${c.x + 22 + (r() > 0 && r() < 3 ? 14 : 0)} ${70 + r() * 22})`}>
                    {dir ? <FolderIcon name={name} open={r() === 0} size={14} style={c.style} /> : <FileIcon name={name} size={14} style={c.style} />}
                  </g>
                  <text x={c.x + 46 + (r() > 0 && r() < 3 ? 14 : 0)} y={83 + r() * 22} class="il-t">{name}</text>
                </>
              )}
            </For>
            <line x1={c.x} y1={166} x2={c.x + 204} y2={166} class="il-sep" />
            <circle cx={c.x + 22} cy={186} r={8} class={c.on ? "il-radio-on" : "il-radio"} />
            <text x={c.x + 38} y={190} class="il-t">{c.label}</text>
          </g>
        )}
      </For>
    </Svg>
  );
}

function Palavras() {
  const words: [string, number, number, string][] = [
    [tx("Skill"), 60, 50, C.claude],
    ["MCP", 190, 34, C.info],
    [tx("Plugin"), 320, 56, C.purple],
    [tx("Token"), 440, 40, C.warn],
    [tx("Agente"), 100, 128, C.ok],
    [tx("Projeto"), 236, 110, C.info],
    [tx("Cache"), 370, 136, "#a4acbf"],
    [tx("Lixeira"), 170, 180, C.err],
    [tx("Conta"), 330, 186, C.claude],
  ];
  return (
    <Svg>
      <For each={words}>
        {([w, x, y, c], i) => (
          <g class="il-float" style={{ "animation-delay": `${-i() * 0.7}s`, "--c": c }}>
            <rect x={x - (w.length * 4.6 + 16)} y={y - 15} width={w.length * 9.2 + 32} height={30} rx={15} class="il-pill" />
            <text x={x} y={y + 5} class="il-t il-mid il-word">{w}</text>
          </g>
        )}
      </For>
    </Svg>
  );
}

export const scenes: Record<TopicId, () => JSX.Element> = {
  inicio: Inicio,
  painel: Painel,
  projetos: Projetos,
  chat: Chat,
  livre: Livre,
  contas: Contas,
  sistema: RaioX,
  ajustes: Ajustes,
  palavras: Palavras,
};
