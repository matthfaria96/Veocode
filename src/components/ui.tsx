// Pecinhas visuais reaproveitadas pelas telas.
import { createEffect, createSignal, For, on, onCleanup, Show, type JSX } from "solid-js";
import { accountById, providers, type ProviderId } from "../accounts";

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

const CLAUDE_PATH = "M189.531 430.72L288.951 374.971L290.59 370.088L288.951 367.369H284.035L267.374 366.355L210.562 364.835L161.399 362.807L113.6 360.273L101.583 357.739L90.3843 342.788L91.4768 335.439L101.583 328.597L116.059 329.864L148.015 332.145L196.086 335.439L230.774 337.467L282.396 342.788H290.59L291.682 339.494L288.951 337.467L286.766 335.439L237.056 301.736L183.249 266.259L155.117 245.733L140.094 235.344L132.447 225.714L129.169 204.428L142.826 189.223L161.399 190.491L166.042 191.758L184.888 206.202L225.038 237.371L277.48 275.889L285.127 282.224L288.207 280.145L288.678 278.676L285.127 272.848L256.722 221.406L226.404 168.951L212.747 147.158L209.197 134.234C207.821 128.811 207.012 124.324 207.012 118.776L222.58 97.4901L231.32 94.7026L252.351 97.4901L261.092 105.092L274.202 134.994L295.233 181.875L328.009 245.733L337.569 264.739L342.758 282.224L344.67 287.545H347.948V284.505L350.679 248.521L355.595 204.428L360.512 147.665L362.15 131.7L370.071 112.441L385.913 102.051L398.204 107.88L408.31 122.324L406.944 131.7L400.935 170.725L389.19 231.796L381.543 272.848H385.913L391.102 267.526L411.86 240.158L446.548 196.572L461.843 179.341L479.87 160.335L491.342 151.212H513.192L529.034 175.033L521.932 199.613L499.536 227.995L480.963 252.068L454.332 287.747L437.808 316.434L439.29 318.8L443.271 318.461L503.359 305.537L535.862 299.709L574.647 293.12L592.127 301.229L594.039 309.592L587.211 326.57L545.695 336.706L497.077 346.589L424.68 363.632L423.878 364.277L424.824 365.68L457.473 368.636L471.403 369.396H505.545L569.184 374.211L585.845 385.107L595.678 398.538L594.039 408.927L568.365 421.851L533.95 413.742L453.376 394.483L425.79 387.641H421.966V389.922L444.909 412.475L487.245 450.486L539.959 499.647L542.69 511.811L535.862 521.44L528.761 520.427L482.328 485.456L464.302 469.745L423.878 435.535H421.147V439.083L430.433 452.767L479.87 527.015L482.328 549.822L478.778 557.171L465.94 561.732L452.011 559.198L422.786 518.399L393.014 472.786L368.979 431.734L366.076 433.567L351.771 586.312L345.216 594.168L329.921 599.996L317.084 590.367L310.255 574.656L317.084 543.487L325.278 502.941L331.833 470.759L337.842 430.72L341.511 417.345L341.187 416.45L338.255 416.943L308.07 458.342L262.184 520.427L225.858 559.198L217.117 562.746L202.095 554.89L203.461 540.953L211.928 528.536L262.184 464.677L292.502 424.892L312.042 402.055L311.851 398.751L310.773 398.659L177.24 485.71L153.478 488.751L143.099 479.121L144.464 463.41L149.381 458.342L189.531 430.72Z";

/** A faísca do Claude, na cor do tema (laranja mais claro no escuro, mais fundo no claro). */
export function ClaudeLogo(props: { size?: number; class?: string }) {
  return (
    <svg class={`claude-logo${props.class ? ` ${props.class}` : ""}`} width={props.size ?? 16} height={props.size ?? 16} viewBox="84 88 518 518" aria-hidden="true">
      <path d={CLAUDE_PATH} fill="currentColor" />
    </svg>
  );
}

/** Avatar quadrado do provedor: o Claude com a faísca dele, os outros com a inicial. */
export function ProviderGlyph(props: { provider: ProviderId; color: string; size?: number }) {
  const s = () => props.size ?? 28;
  return (
    <span class="provider-mark" classList={{ claude: props.provider === "claude" }} style={{ "--c": props.color, "--s": `${s()}px` }}>
      <Show when={props.provider === "claude"} fallback={providers[props.provider].name[0]}>
        <ClaudeLogo size={Math.round(s() * 0.64)} />
      </Show>
    </span>
  );
}

/** O avatar de uma conta. */
export function ProviderMark(props: { id: string; size?: number }) {
  const a = () => accountById(props.id);
  return <ProviderGlyph provider={a().provider} color={a().color} size={props.size} />;
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
/** Enquanto um painel carregado sob demanda chega. Só aparece se demorar, para não piscar. */
export function LazyWait() {
  return <div class="lazy-wait"><span class="spinner" /></div>;
}

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
