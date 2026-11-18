// Pecinhas visuais reaproveitadas pelas telas.
import { createEffect, createSignal, For, on, onCleanup, type JSX } from "solid-js";
import { accountById, providers } from "../accounts";

/** Bolinha + nome da conta, com a cor da conta. */
export function AccountChip(props: { id: string; compact?: boolean }) {
  const a = () => accountById(props.id);
  return (
    <span class="account-chip" style={{ "--c": a().color }}>
      <span class="account-dot" />
      {props.compact ? providers[a().provider].name : a().label}
    </span>
  );
}

/** Avatar quadrado com a inicial do provedor (sem logos de marca). */
export function ProviderMark(props: { id: string; size?: number }) {
  const a = () => accountById(props.id);
  return (
    <span class="provider-mark" style={{ "--c": a().color, "--s": `${props.size ?? 28}px` }}>
      {providers[a().provider].name[0]}
    </span>
  );
}

/** Anel de uso animado. */
export function Ring(props: { value: number; color: string; size?: number; stroke?: number; children?: JSX.Element }) {
  const size = () => props.size ?? 64;
  const stroke = () => props.stroke ?? 6;
  const r = () => (size() - stroke()) / 2;
  const c = () => 2 * Math.PI * r();
  const [shown, setShown] = createSignal(0);
  createEffect(on(() => props.value, (v) => requestAnimationFrame(() => setShown(v))));
  return (
    <div class="ring" style={{ width: `${size()}px`, height: `${size()}px` }}>
      <svg width={size()} height={size()}>
        <circle cx={size() / 2} cy={size() / 2} r={r()} stroke="var(--line)" stroke-width={stroke()} fill="none" />
        <circle
          class="ring-value"
          cx={size() / 2}
          cy={size() / 2}
          r={r()}
          stroke={props.color}
          stroke-width={stroke()}
          fill="none"
          stroke-linecap="round"
          stroke-dasharray={`${c()}`}
          stroke-dashoffset={`${c() * (1 - shown())}`}
          transform={`rotate(-90 ${size() / 2} ${size() / 2})`}
        />
      </svg>
      <div class="ring-label">{props.children}</div>
    </div>
  );
}

/** Número que "rola" até o valor novo. */
export function CountUp(props: { value: number; format?: (n: number) => string; ms?: number }) {
  const [n, setN] = createSignal(0);
  let raf = 0;
  createEffect(
    on(
      () => props.value,
      (to) => {
        const from = n();
        const start = performance.now();
        const dur = props.ms ?? 900;
        cancelAnimationFrame(raf);
        const step = (t: number) => {
          const k = Math.min(1, (t - start) / dur);
          const ease = 1 - Math.pow(1 - k, 3);
          setN(from + (to - from) * ease);
          if (k < 1) raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
      },
    ),
  );
  onCleanup(() => cancelAnimationFrame(raf));
  return <>{props.format ? props.format(n()) : Math.round(n()).toString()}</>;
}

/** Mini gráfico de linha (CPU dos processos). */
export function Sparkline(props: { data: number[]; color: string; width?: number; height?: number }) {
  const w = () => props.width ?? 90;
  const h = () => props.height ?? 24;
  const pts = () => {
    const max = Math.max(10, ...props.data);
    return props.data.map((v, i) => `${(i / (props.data.length - 1)) * w()},${h() - (v / max) * (h() - 2) - 1}`).join(" ");
  };
  return (
    <svg class="sparkline" width={w()} height={h()} viewBox={`0 0 ${w()} ${h()}`}>
      <polyline points={pts()} fill="none" stroke={props.color} stroke-width="1.5" stroke-linejoin="round" />
    </svg>
  );
}

/** Interruptor liga/desliga. */
export function Toggle(props: { on: boolean; onChange?: (v: boolean) => void; disabled?: boolean; color?: string }) {
  return (
    <button
      class="toggle"
      classList={{ on: props.on, disabled: props.disabled }}
      style={{ "--c": props.color ?? "var(--accent)" }}
      onClick={() => !props.disabled && props.onChange?.(!props.on)}
      role="switch"
      aria-checked={props.on}
    >
      <span class="toggle-knob" />
    </button>
  );
}

/** Cabeçalho de seção das telas. */
export function PageHeader(props: { title: string; subtitle: string; actions?: JSX.Element }) {
  return (
    <header class="page-header">
      <div>
        <h1>{props.title}</h1>
        <p>{props.subtitle}</p>
      </div>
      <div class="page-actions">{props.actions}</div>
    </header>
  );
}

/** Lista com entrada escalonada (cada item aparece um pouco depois do anterior). */
export function Stagger<T>(props: { each: T[]; children: (item: T, i: () => number) => JSX.Element; step?: number }) {
  return (
    <For each={props.each}>
      {(item, i) => (
        <div class="stagger" style={{ "animation-delay": `${i() * (props.step ?? 45)}ms` }}>
          {props.children(item, i)}
        </div>
      )}
    </For>
  );
}
