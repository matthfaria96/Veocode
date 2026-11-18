// Ilustrações animadas da Ajuda: miniaturas de cada tela, desenhadas em SVG com as cores do
// tema (classes .il-* em styles.css). Mais leves que capturas de tela, nunca mostram dados
// pessoais e acompanham o tema.

import { Bot, Database, Eye, FolderOpen, KeyRound, Lock, MessageSquare, Package, Puzzle, Server, Trash2, User } from "lucide-solid";
import { For, type JSX } from "solid-js";
import { FileIcon, FolderIcon, ProjectIcon } from "../components/icons";
import type { TopicId } from "./topics";

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
    ["Pasta", (p) => <FolderOpen {...p} />, C.info],
    ["Conta", (p) => <User {...p} />, C.claude],
    ["Conversa", (p) => <MessageSquare {...p} />, C.ok],
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
      <text x={260} y={156} class="il-t il-mid il-dim">e o nível de acesso decide quanto ela pode mexer</text>
      <For each={levels}>{([, c], i) => <rect x={150 + i() * 56} y={170} width={52} height={8} rx={4} style={{ fill: c, opacity: 0.75 }} />}</For>
      <circle cx={0} cy={174} r={9} class="il-knob il-slide" />
    </Svg>
  );
}

function Mapa() {
  const accounts = [
    { y: 52, c: C.claude, label: "Claude" },
    { y: 132, c: C.deep, label: "DeepSeek" },
  ];
  const projs = [
    { y: 28, from: 0, lv: 2 },
    { y: 92, from: 0, lv: 1 },
    { y: 156, from: 1, lv: 0 },
  ];
  return (
    <Svg>
      <For each={projs}>
        {(p) => {
          const a = accounts[p.from];
          const y1 = a.y + 18;
          const y2 = p.y + 18;
          return (
            <>
              <path d={`M168 ${y1} C 260 ${y1}, 270 ${y2}, 352 ${y2}`} class="il-flow" style={{ "--c": a.c }} />
              <g transform={`translate(${246} ${(y1 + y2) / 2 - 8})`}>
                <rect width={44} height={16} rx={8} class="il-pill" style={{ "--c": levels[p.lv][1] }} />
                <text x={22} y={11.5} class="il-t il-mid il-tiny" style={{ fill: levels[p.lv][1] }}>{levels[p.lv][0]}</text>
              </g>
            </>
          );
        }}
      </For>
      <For each={accounts}>
        {(a, i) => (
          <g class="il-rise" style={{ ...rise(i()), "--c": a.c }}>
            <rect x={28} y={a.y} width={140} height={38} rx={10} class="il-card" />
            <rect x={38} y={a.y + 8} width={22} height={22} rx={6} class="il-tint" />
            <text x={49} y={a.y + 23} class="il-t il-mid il-c">{a.label[0]}</text>
            <text x={68} y={a.y + 17} class="il-t">{a.label}</text>
            <Bar x={68} y={a.y + 24} w={60} h={4} />
            <circle cx={156} cy={a.y + 10} r={3.5} class="il-dot il-pulse" />
          </g>
        )}
      </For>
      <For each={projs}>
        {(p, i) => (
          <g class="il-rise" style={rise(i() + 2)}>
            <rect x={352} y={p.y} width={140} height={36} rx={10} class="il-card" />
            <FolderOpen x={362} y={p.y + 10} size={16} class="il-ico-dim" />
            <Bar x={386} y={p.y + 11} w={70} />
            <Bar x={386} y={p.y + 21} w={44} h={4} />
          </g>
        )}
      </For>
    </Svg>
  );
}

function Projetos() {
  const code = [70, 120, 96, 140, 60, 110, 130, 84];
  return (
    <Svg>
      <rect x={10} y={8} width={500} height={204} rx={12} class="il-win" />
      {/* árvore */}
      <For each={[0, 1, 2, 3, 4, 5, 6]}>
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
            {i() === 4 && <rect x={128} y={26 + i() * 13} width={232} height={11} class="il-changed" />}
            <Bar x={140 + (i() % 3 === 1 ? 14 : 0)} y={28 + i() * 13} w={w} h={5} cls={i() === 4 ? "il-bar il-typing" : "il-bar"} />
          </>
        )}
      </For>
      {/* painel de baixo: o terminal do projeto */}
      <line x1={126} y1={140} x2={362} y2={140} class="il-sep" />
      <text x={138} y={155} class="il-t il-tiny il-dim">Atividade</text>
      <rect x={186} y={145} width={50} height={14} rx={7} class="il-pill" style={{ "--c": C.info }} />
      <text x={211} y={155} class="il-t il-mid il-tiny">Terminal</text>
      <rect x={134} y={164} width={220} height={42} rx={6} class="il-term" />
      <g class="il-rise" style={rise(1)}>
        <text x={142} y={178} class="il-t il-mono il-tiny"><tspan class="il-term-p">loja $</tspan> npm test</text>
      </g>
      <g class="il-rise" style={rise(2)}>
        <text x={142} y={191} class="il-t il-mono il-tiny il-term-ok">✓ 12 testes passaram</text>
      </g>
      <g class="il-rise" style={rise(3)}>
        <text x={142} y={202} class="il-t il-mono il-tiny"><tspan class="il-term-p">loja $</tspan></text>
        <rect x={177} y={195} width={5} height={9} class="il-blink" style={{ fill: C.info }} />
      </g>
      <line x1={362} y1={8} x2={362} y2={212} class="il-sep" />
      {/* chat */}
      <rect x={410} y={26} width={88} height={22} rx={9} class="il-bubble-me il-rise" />
      <g class="il-rise" style={rise(1)}>
        <rect x={374} y={58} width={120} height={46} rx={9} class="il-bubble" />
        <Bar x={384} y={68} w={92} h={5} />
        <Bar x={384} y={79} w={70} h={5} />
        <Bar x={384} y={90} w={84} h={5} />
      </g>
      <rect x={372} y={178} width={128} height={24} rx={8} class="il-input" />
      {/* cursor da conta */}
      <g class="il-cursor" style={{ "--c": C.claude }}>
        <path d="M0 0 L0 14 L4 10 L7 17 L9.5 16 L6.5 9 L12 9 Z" />
        <rect x={10} y={14} width={42} height={13} rx={6.5} />
        <text x={31} y={23.5} class="il-t il-mid il-tiny il-on-c">Claude</text>
      </g>
    </Svg>
  );
}

function Nivel() {
  const rules: [string, string, string][] = [
    ["Editar arquivos", "Permitido", C.ok],
    ["Rodar comandos", "Pergunta", C.warn],
    ["git push", "Bloqueado", C.err],
  ];
  return (
    <Svg>
      <line x1={70} y1={74} x2={450} y2={74} class="il-track" />
      <For each={levels}>
        {([label, c], i) => (
          <>
            <circle cx={70 + i() * 126.6} cy={74} r={7} style={{ fill: c }} />
            <text x={70 + i() * 126.6} y={104} class="il-t il-mid" style={{ fill: c }}>{label}</text>
          </>
        )}
      </For>
      <circle cx={0} cy={74} r={13} class="il-knob il-steps" />
      <For each={rules}>
        {([label, rule, c], i) => (
          <g class="il-rise" style={{ ...rise(i()), "--c": c }}>
            <rect x={28 + i() * 160} y={136} width={146} height={52} rx={10} class="il-card" />
            <text x={40 + i() * 160} y={156} class="il-t">{label}</text>
            <rect x={40 + i() * 160} y={164} width={70} height={16} rx={8} class="il-pill" />
            <text x={75 + i() * 160} y={175.5} class="il-t il-mid il-tiny il-c">{rule}</text>
          </g>
        )}
      </For>
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
        <text x={156} y={63.5} class="il-t il-tiny">Leu src/app.ts</text>
      </g>
      <g class="il-seq" style={seq(2)}>
        <rect x={132} y={76} width={244} height={42} rx={10} class="il-bubble" />
        <Bar x={144} y={87} w={200} h={5} />
        <Bar x={144} y={99} w={150} h={5} />
      </g>
      <g class="il-seq" style={{ ...seq(3), "--c": C.warn }}>
        <rect x={132} y={124} width={244} height={46} rx={10} class="il-ask" />
        <text x={144} y={141} class="il-t">Rodar npm install?</text>
        <rect x={144} y={149} width={56} height={15} rx={6} class="il-btn-ok" />
        <text x={172} y={159.5} class="il-t il-mid il-tiny il-on-c">Permitir</text>
        <rect x={206} y={149} width={56} height={15} rx={6} class="il-btn" />
        <text x={234} y={159.5} class="il-t il-mid il-tiny">Recusar</text>
      </g>
      <rect x={132} y={180} width={256} height={26} rx={9} class="il-input" />
      <rect x={140} y={186} width={46} height={14} rx={7} class="il-pill" style={{ "--c": levels[2][1] }} />
      <text x={163} y={196} class="il-t il-mid il-tiny" style={{ fill: levels[2][1] }}>Editar</text>
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
      <text x={255} y={30.5} class="il-t il-mid il-tiny">Só conversa</text>
      <Eye x={312} y={21} size={11} class="il-ico" style={{ color: C.info }} />
      <text x={355} y={30.5} class="il-t il-mid il-tiny" style={{ fill: C.info }}>Olhar o PC</text>
      <g class="il-seq" style={seq(1)}>
        <rect x={268} y={48} width={130} height={22} rx={10} class="il-bubble-me" />
        <text x={333} y={62.5} class="il-t il-mid il-tiny">Ache o contrato em PDF</text>
      </g>
      <g class="il-seq" style={seq(2)}>
        <rect x={122} y={78} width={220} height={20} rx={8} class="il-step" />
        <circle cx={135} cy={88} r={4} style={{ fill: C.info }} />
        <text x={146} y={91.5} class="il-t il-tiny">Lendo ~/Downloads/contrato.pdf</text>
      </g>
      <g class="il-seq" style={{ ...seq(3), "--c": C.err }}>
        <rect x={122} y={102} width={220} height={20} rx={8} class="il-step il-step-no" />
        <Lock x={130} y={106} size={11} class="il-ico" style={{ color: C.err }} />
        <text x={146} y={115.5} class="il-t il-tiny" style={{ fill: C.err }}>~/.ssh bloqueado</text>
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
                <text x={k.x + 183} y={46} class="il-t il-mid il-tiny" style={{ fill: C.ok }}>saldo</text>
              </g>
            )}
          </g>
        )}
      </For>
    </Svg>
  );
}

function Inventario() {
  const rows: { ico: (p: { x: number; y: number; size: number; class: string }) => JSX.Element; c: string; where: string; wc: string; st: string; sc: string; run?: boolean; w: number }[] = [
    { ico: (p) => <Bot {...p} />, c: C.claude, where: "meu-app", wc: C.info, st: "rodando", sc: C.ok, run: true, w: 60 },
    { ico: (p) => <Package {...p} />, c: C.claude, where: "toda a conta", wc: C.purple, st: "ligado", sc: C.ok, w: 40 },
    { ico: (p) => <Server {...p} />, c: C.claude, where: "toda a conta", wc: C.purple, st: "parado", sc: "#6c7589", w: 24 },
    { ico: (p) => <Database {...p} />, c: "#6c7589", where: "computador", wc: "#6c7589", st: "2,1 GB", sc: C.warn, w: 80 },
  ];
  return (
    <Svg>
      <rect x={20} y={12} width={480} height={196} rx={12} class="il-card" />
      <For each={rows}>
        {(r, i) => {
          const y = 22 + i() * 46;
          return (
            <g class="il-rise" style={{ ...rise(i()), "--c": r.c }}>
              {i() > 0 && <line x1={20} y1={y - 5} x2={500} y2={y - 5} class="il-sep" />}
              <rect x={34} y={y + 4} width={28} height={28} rx={8} class="il-tint" classList={{ "il-pulse-box": !!r.run }} />
              {r.ico({ x: 40, y: y + 10, size: 16, class: "il-ico" })}
              <Bar x={74} y={y + 8} w={90 + ((i() * 17) % 40)} />
              <rect x={74} y={y + 20} width={70} height={13} rx={6.5} class="il-pill" style={{ "--c": r.wc }} />
              <text x={109} y={y + 29.5} class="il-t il-mid il-tiny" style={{ fill: r.wc }}>{r.where}</text>
              <rect x={286} y={y + 9} width={64} height={18} rx={9} class="il-pill" style={{ "--c": r.sc }} />
              <text x={318} y={y + 21.5} class="il-t il-mid il-tiny" style={{ fill: r.sc }}>{r.st}</text>
              <rect x={366} y={y + 15} width={80} height={6} rx={3} class="il-bar" />
              <rect x={366} y={y + 15} width={r.w} height={6} rx={3} class="il-weight" style={{ fill: r.sc }} />
              {i() === 3 && (
                <g class="il-blink">
                  <rect x={456} y={y + 8} width={30} height={20} rx={6} class="il-btn" />
                  <Trash2 x={464} y={y + 12} size={13} class="il-ico-dim" />
                </g>
              )}
            </g>
          );
        }}
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

function Skills() {
  const cols: [string, string, (p: { x: number; y: number; size: number; class: string }) => JSX.Element][] = [
    ["Da conta", C.claude, (p) => <User {...p} />],
    ["Plugins", C.purple, (p) => <Package {...p} />],
    ["Do projeto", C.info, (p) => <FolderOpen {...p} />],
  ];
  return (
    <Svg>
      <For each={cols}>
        {([label, c, Icon], i) => {
          const x = 22 + i() * 168;
          return (
            <g class="il-rise" style={{ ...rise(i()), "--c": c }}>
              <rect x={x} y={14} width={140} height={192} rx={12} class="il-card" />
              <Icon x={x + 12} y={26} size={15} class="il-ico" />
              <text x={x + 34} y={38} class="il-t">{label}</text>
              <For each={[0, 1, 2]}>
                {(r) => (
                  <g>
                    <rect x={x + 10} y={54 + r * 46} width={120} height={38} rx={8} class="il-item" />
                    <Puzzle x={x + 18} y={62 + r * 46} size={12} class="il-ico" />
                    <Bar x={x + 36} y={63 + r * 46} w={60 + ((r * 19 + i() * 7) % 30)} h={5} />
                    <Bar x={x + 36} y={74 + r * 46} w={50} h={4} />
                  </g>
                )}
              </For>
            </g>
          );
        }}
      </For>
      <path d="M164 110 H188" class="il-flow" style={{ "--c": C.claude }} />
      <path d="M332 110 H356" class="il-flow" style={{ "--c": C.purple }} />
    </Svg>
  );
}

function Ajustes() {
  const cards: { x: number; style: "detalhado" | "minimalista"; label: string; on: boolean }[] = [
    { x: 40, style: "detalhado", label: "Detalhados", on: true },
    { x: 276, style: "minimalista", label: "Minimalistas", on: false },
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
    ["Skill", 60, 50, C.claude],
    ["MCP", 190, 34, C.info],
    ["Plugin", 320, 56, C.purple],
    ["Token", 440, 40, C.warn],
    ["Agente", 100, 128, C.ok],
    ["Projeto", 236, 110, C.info],
    ["Cache", 370, 136, "#a4acbf"],
    ["Lixeira", 170, 180, C.err],
    ["Conta", 330, 186, C.claude],
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
  mapa: Mapa,
  projetos: Projetos,
  nivel: Nivel,
  chat: Chat,
  livre: Livre,
  contas: Contas,
  inventario: Inventario,
  raiox: RaioX,
  skills: Skills,
  ajustes: Ajustes,
  palavras: Palavras,
};
