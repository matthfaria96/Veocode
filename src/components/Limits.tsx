// Visão dos limites do plano do Claude (5 horas e semana): anel com a porcentagem, barras com
// a hora em que zera, o aviso no chat quando o limite bate e a troca de conta com confirmação.
import { ArrowRightLeft, Hourglass, RefreshCw } from "lucide-solid";
import { createSignal, For, onCleanup, Show } from "solid-js";
import { accountById, accts } from "../accounts";
import { chatOf } from "../chat";
import { activeKey, continueFresh } from "../convTabs";
import { agoText, limits, loadLimits, peak, toneOf, whenText, type Win } from "../limits";
import { projects, setProjectAccount, setView, showToast } from "../store";
import ConfirmDialog from "./ConfirmDialog";
import { ProviderMark } from "./ui";
import { tx } from "../i18n";

// relógio de 30 s: "atualizado há…" e "zera em…" andam sozinhos
const [tick, setTick] = createSignal(0);
let clock: number | undefined;
const useClock = () => {
  clock ??= window.setInterval(() => setTick((n) => n + 1), 30_000);
  onCleanup(() => void 0);
};

/** Anel com a porcentagem do que mais pesa (5 h ou semana). */
function LimitRing(props: { pct: number; size?: number; title?: string; bare?: boolean }) {
  const size = () => props.size ?? 34;
  const r = () => size() / 2 - 2.5;
  const c = () => 2 * Math.PI * r();
  return (
    <span class={`lim-ring t-${toneOf(props.pct)}`} style={{ width: `${size()}px`, height: `${size()}px` }} title={props.title}>
      <svg viewBox={`0 0 ${size()} ${size()}`} aria-hidden="true">
        <circle cx={size() / 2} cy={size() / 2} r={r()} class="lim-ring-bg" />
        <circle cx={size() / 2} cy={size() / 2} r={r()} class="lim-ring-fg" stroke-dasharray={`${(Math.min(100, props.pct) / 100) * c()} ${c()}`} />
      </svg>
      <Show when={!props.bare}><b style={{ "font-size": `${Math.max(8, size() * 0.3)}px` }}>{Math.round(props.pct)}</b></Show>
    </span>
  );
}

function Bar(props: { label: string; w: Win | null; hint: string }) {
  return (
    <Show when={props.w}>
      {(w) => (
        <div class={`lim-row t-${toneOf(w().pct)}`}>
          <div class="lim-row-head">
            <span>{props.label}</span>
            <small>{w().pct >= 100 ? tx("volta {v}", { v: whenText(w().resetsAt) }) : whenText(w().resetsAt) ? tx("zera {v}", { v: whenText(w().resetsAt) }) : props.hint}</small>
            <b>{Math.round(w().pct)}%</b>
          </div>
          <div class="lim-bar"><i style={{ width: `${Math.min(100, w().pct)}%` }} /></div>
        </div>
      )}
    </Show>
  );
}

/** Barras de 5 horas e da semana (e por modelo, quando o plano tem). */
export function LimitBars(props: { id: string }) {
  useClock();
  const l = () => limits[props.id];
  const [busy, setBusy] = createSignal(false);
  const again = async () => {
    setBusy(true);
    await loadLimits(props.id, true);
    setBusy(false);
  };
  return (
    <div class="lim-box">
      <div class="lim-box-head">
        <span>{tx("Limites do plano")}</span>
        <button class="icon-btn tiny" classList={{ spinning: busy() }} title={tx("Ler de novo (não gasta tokens)")} onClick={() => void again()}><RefreshCw size={11} /></button>
      </div>
      <Show when={l()} fallback={<div class="lim-loading"><span class="spinner inline" /> {tx("lendo da Anthropic…")}</div>}>
        <Show when={!l()!.error} fallback={<p class="lim-err">{l()!.error}</p>}>
          <Bar label={tx("Limite de 5 horas")} w={l()!.fiveHour} hint={tx("sem uso agora")} />
          <Bar label={tx("Limite semanal")} w={l()!.week} hint="" />
          <Show when={l()!.models.length}>
            <div class="lim-models">
              <For each={l()!.models}>{([m, w]) => <span class={`mini-chip t-${toneOf(w.pct)}`} title={tx("Limite semanal só do {m}", { m })}>{m} <b>{Math.round(w.pct)}%</b></span>}</For>
            </div>
          </Show>
          <Show when={l()!.note}><p class="lim-note">{l()!.note}</p></Show>
          <small class="lim-at">{tx("Atualizado {v}{v2}", { v: (tick(), agoText(l()!.at)), v2: l()!.source === "claude" ? tx(" · pelo próprio Claude") : "" })}</small>
        </Show>
      </Show>
    </div>
  );
}

/** Anelzinho no botão da conta (caixa de mensagem): mostra o que mais pesa agora. */
export function LimitChip(props: { id: string }) {
  const p = () => peak(props.id);
  return (
    <Show when={p()}>
      {(p) => <span class={`lim-chip t-${toneOf(p().pct)}`} title={`${p().pct >= 100 ? tx("Limite") : tx("{v}% do limite", { v: Math.round(p().pct) })} ${p().win === "semana" ? tx("semanal") : tx("das 5 horas")}${whenText(p().resetsAt) ? ` · ${p().pct >= 100 ? tx("volta {v}", { v: whenText(p().resetsAt) }) : tx("zera {v}", { v: whenText(p().resetsAt) })}` : ""}`}><LimitRing pct={p().pct} size={13} bare /><b>{Math.round(p().pct)}%</b></span>}
    </Show>
  );
}

function PopRow(props: { label: string; w: Win | null }) {
  return (
    <Show when={props.w}>
      {(w) => (
        <div class={`up-row t-${toneOf(w().pct)}`}>
          <div class="up-row-head">
            <span>{props.label}</span>
            <b>{Math.round(w().pct)}%</b>
          </div>
          <div class="lim-bar"><i style={{ width: `${Math.min(100, w().pct)}%` }} /></div>
          <small>{(tick(), w().resetsAt ? `${w().pct >= 100 ? tx("Volta") : tx("Reinicia")} ${whenText(w().resetsAt)}` : tx("Sem uso nesta janela"))}</small>
        </div>
      )}
    </Show>
  );
}

/** Anel do uso do plano na caixa de mensagem (como no app do Claude): passando o mouse, 5 h e semana. */
export function UsageRing(props: { id: string; small?: boolean }) {
  useClock();
  const a = () => accountById(props.id);
  const l = () => limits[props.id];
  const p = () => peak(props.id);
  const [spin, setSpin] = createSignal(false);
  const again = async () => {
    setSpin(true);
    await loadLimits(props.id, true);
    setSpin(false);
  };
  return (
    <Show when={a().provider === "claude"}>
      <button class="usage-ring" classList={{ empty: !p(), small: props.small, spin: spin() }} aria-label={p() ? tx("Uso do plano: {v}%", { v: Math.round(p()!.pct) }) : tx("Uso do plano")} onClick={() => void again()}>
        <LimitRing pct={p()?.pct ?? 0} size={props.small ? 16 : 18} bare />
        <div class="usage-pop" role="tooltip">
          <header>
            <b>{tx("Uso do plano")}</b>
            <small>{a().label}</small>
          </header>
          <Show when={p()} fallback={<p class="up-empty">{l()?.error ?? tx("Lendo o uso da conta…")}</p>}>
            <PopRow label={tx("Limite de 5 horas")} w={l()!.fiveHour} />
            <PopRow label={tx("Semanal · todos os modelos")} w={l()!.week} />
            <For each={l()!.models}>{([m, w]) => <PopRow label={tx("Semanal · {m}", { m })} w={w} />}</For>
          </Show>
          <Show when={l()?.note}><p class="up-note">{l()!.note}</p></Show>
          <footer>{l() ? tx("Atualizado {v} · clique para ler de novo", { v: (tick(), agoText(l()!.at)) }) : tx("Clique para ler agora")}</footer>
        </div>
      </button>
    </Show>
  );
}

/** O "You've hit your weekly limit" do Claude, em português, com as outras contas para continuar. */
export function LimitHitCard(props: { accountId: string; win: "semana" | "5h" | "outro"; raw: string; onPick: (id: string) => void }) {
  const a = () => accountById(props.accountId);
  const w = () => (props.win === "5h" ? limits[props.accountId]?.fiveHour : limits[props.accountId]?.week);
  const others = () => accts.list.filter((x) => x.id !== props.accountId && x.provider === "claude");
  const title = () => (props.win === "semana" ? tx("Limite semanal atingido") : props.win === "5h" ? tx("Limite das 5 horas atingido") : tx("Limite de uso atingido"));
  // aviso antigo: o limite já zerou desde então (fica discreto, sem sugerir troca)
  const past = () => props.win !== "outro" && !!w() && w()!.pct < 100;
  void loadLimits(props.accountId);
  return (
    <Show
      when={!past()}
      fallback={
        <div class="lim-hit past pop-in" title={props.raw}>
          <span class="lim-hit-icon"><Hourglass size={14} /></span>
          <div class="lim-hit-body">
            <strong>{title()} · {a().label}</strong>
            <span>{tx("Já liberou: agora está em {v}%.", { v: Math.round(w()!.pct) })}</span>
          </div>
        </div>
      }
    >
    <div class="lim-hit pop-in" title={props.raw}>
      <span class="lim-hit-icon"><Hourglass size={16} /></span>
      <div class="lim-hit-body">
        <strong>{title()} · {a().label}</strong>
        <span>
          {w()?.resetsAt ? <>{tx("Volta")} <b>{whenText(w()!.resetsAt)}</b>. </> : null}
          {others().length ? tx("Enquanto isso, dá para continuar com outra conta:") : tx("Enquanto isso, adicione outra conta em Contas e IAs para continuar.")}
        </span>
        <div class="lim-hit-actions">
          <For each={others()}>
            {(o) => (
              <button class="lim-pick" onClick={() => props.onPick(o.id)}>
                <ProviderMark id={o.id} size={18} />
                <span>{o.label}</span>
                <Show when={peak(o.id)}>{(p) => <small class={`t-${toneOf(p().pct)}`}>{Math.round(p().pct)}%</small>}</Show>
              </button>
            )}
          </For>
          <button class="ghost-btn small" onClick={() => setView("accounts")}>{tx("Ver uso das contas")}</button>
        </div>
      </div>
    </div>
    </Show>
  );
}

// ---------------------------------------------------------------- trocar de conta com confirmação

const [ask, setAsk] = createSignal<{ pid: string; to: string } | null>(null);

/** Troca a conta do projeto. Se a aba tem conversa, pergunta antes: a outra conta não continua ela. */
export function requestSwitch(pid: string, to: string) {
  const p = projects.find((x) => x.id === pid);
  if (!p || p.accountId === to) return;
  const c = chatOf(activeKey(pid));
  if (!c.context && !c.lastAt) return doSwitch(pid, to, false);
  setAsk({ pid, to });
}

function doSwitch(pid: string, to: string, carry: boolean) {
  const key = activeKey(pid);
  setProjectAccount(pid, to);
  if (carry) continueFresh(pid, key);
  const p = projects.find((x) => x.id === pid);
  showToast(tx("{v} agora usa {label}{v2}", { v: p?.name ?? tx("Projeto"), label: accountById(to).label, v2: carry ? tx(" · resumo pronto na caixa") : "" }));
}

/** Fica no App: a pergunta da troca de conta, de qualquer tela. */
export function SwitchAccountDialog() {
  return (
    <Show when={ask()}>
      {(q) => {
        const from = () => accountById(projects.find((x) => x.id === q().pid)?.accountId ?? "");
        const to = () => accountById(q().to);
        const close = () => setAsk(null);
        return (
          <ConfirmDialog title={tx("Trocar para {label}?", { label: to().label })} confirmLabel={tx("Trocar e levar um resumo")} onCancel={close} onConfirm={() => (doSwitch(q().pid, q().to, true), close())}>
            <div class="switch-ask">
              <div class="switch-ask-row">
                <ProviderMark id={from().id} size={26} /> <ArrowRightLeft size={14} /> <ProviderMark id={to().id} size={26} />
              </div>
              <p>
                {tx("Cada conta guarda as próprias conversas. A")} <b>{to().label}</b> {tx("não consegue continuar a conversa desta aba: o Claude de lá começa do zero.")}
              </p>
              <p class="switch-ask-tip">
                {tx("Com")} <b>{tx("levar um resumo")}</b>{tx(", abre uma aba nova com o resumo desta já na caixa. A conversa antiga continua guardada no histórico da")} <b>{from().label}</b>.
              </p>
              <button class="link-btn" onClick={() => (doSwitch(q().pid, q().to, false), close())}>{tx("Só trocar, sem resumo")}</button>
            </div>
          </ConfirmDialog>
        );
      }}
    </Show>
  );
}
