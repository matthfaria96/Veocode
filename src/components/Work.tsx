// O trabalho da IA no chat, do jeito do Claude Code: os passos fecham numa linha cinza ("Executou
// 4 comandos, leu 2 arquivos ›") com as imagens que ela abriu, a lista de tarefas dela vira um
// cartão com ✓ / girando / pendente, e enquanto trabalha uma linha viva diz o que está fazendo e
// há quanto tempo ("Executando um comando · 4 min 47 s"). Usado no chat dos projetos e no Chat livre.
import { ChevronDown, Square } from "lucide-solid";
import { createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js";
import { imageUrl, isImagePath, openViewer } from "../media";
import { stepsSummary } from "../steps";
import { tx } from "../i18n";
import ActivityIcon, { kindColor } from "./ActivityIcon";
import type { ActivityEvent } from "../store";

/** Um passo, venha do espaço de trabalho (projetos) ou direto do Rust (Chat livre). */
export interface WorkStep {
  id: string | number;
  kind: string;
  title: string;
  detail?: string | null;
  status: string;
  path?: string | null;
  ts?: number;
}

// ---------------------------------------------------------------- tempo

const [now, setNow] = createSignal(Date.now());
let users = 0;
let timer = 0;
/** Relógio de um segundo, ligado só enquanto alguém mostra um tempo correndo. */
export function useClock() {
  if (users++ === 0) timer = window.setInterval(() => setNow(Date.now()), 1000);
  // acerta o relógio (pode estar atrasado com a janela em segundo plano) logo depois de montar,
  // não durante: mudar um sinal no meio da montagem fazia um <Show> sumir enquanto era criado
  queueMicrotask(() => setNow(Date.now()));
  onCleanup(() => {
    if (--users === 0) clearInterval(timer);
  });
  return now;
}

/** "12 s", "4 min 47 s", "1 h 3 min". */
export function elapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

// ---------------------------------------------------------------- linha viva

const VERB: Record<string, string> = {
  run: "Executando um comando",
  read: "Lendo um arquivo",
  edit: "Editando um arquivo",
  create: "Criando um arquivo",
  delete: "Apagando um arquivo",
  search: "Buscando nos arquivos",
  web: "Pesquisando na web",
  tool: "Usando uma ferramenta",
  swarm: "Rodando um ajudante",
  plan: "Atualizando a lista de tarefas",
  compact: "Compactando a conversa",
};
export const verbOf = (kind?: string) => tx(VERB[kind ?? ""] ?? "Pensando");

/**
 * Enquanto a IA trabalha: o que ela está fazendo agora (pelo tipo do passo que roda) e há quanto
 * tempo o pedido começou. Sem passo rodando e sem texto chegando, ela está pensando.
 */
export function LiveLine(props: { color: string; step?: WorkStep | null; writing?: boolean; since?: number; where?: string; onStop?: () => void; stopTitle?: string; stopping?: boolean }) {
  const clock = useClock();
  const mounted = Date.now();
  const label = () => (props.step ? verbOf(props.step.kind) : props.writing ? tx("Escrevendo a resposta") : tx("Pensando"));
  return (
    <div class="live-line pop-in" style={{ "--c": props.color }} role="status">
      <svg class="live-spark" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 1.5v4M8 10.5v4M1.5 8h4M10.5 8h4M3.4 3.4l2.8 2.8M9.8 9.8l2.8 2.8M12.6 3.4L9.8 6.2M6.2 9.8l-2.8 2.8" />
      </svg>
      <span class="live-text" title={props.step?.title}>{props.stopping ? tx("Parando") : label()}</span>
      <span class="live-dots" aria-hidden="true"><i /><i /><i /></span>
      <small class="live-time">{elapsed(clock() - (props.since ?? mounted))}</small>

      <Show when={props.where}><small class="live-where">{props.where}</small></Show>
      <Show when={props.onStop}>
        <button class="live-stop" disabled={props.stopping} title={props.stopTitle ?? tx("Parar tudo o que ela está fazendo (Esc)")} onClick={() => props.onStop?.()}>
          <Square size={8} fill="currentColor" stroke-width={0} />
          <span>{tx("Parar")}</span>
        </button>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------- miniaturas

function Thumb(props: { pid: string; path: string; at?: number }) {
  const [url] = createResource(() => ({ pid: props.pid, path: props.path, at: props.at ?? 0 }), (k) => imageUrl(k.pid, k.path, k.at).catch(() => null));
  return (
    <Show when={url()}>
      <span
        class="work-thumb"
        role="button"
        title={props.path}
        onClick={(e) => (e.stopPropagation(), openViewer(props.pid, props.path, [{ path: props.path, at: props.at ?? 0, url: url() }]))}
      >
        <img src={url()!} alt="" />
      </span>
    </Show>
  );
}

// ---------------------------------------------------------------- bloco de passos

/** Uma linha por passo: ícone, o que fez e o detalhe (ou girando, se ainda está rodando). */
function WorkRows(props: { steps: WorkStep[] }) {
  return (
    <For each={props.steps}>
      {(x) => (
        <div class="work-row" classList={{ running: x.status === "running", error: x.status === "error" }} title={x.detail ?? x.title}>
          <span class="work-icon" style={{ color: kindColor[x.kind as ActivityEvent["kind"]] }}>
            <ActivityIcon kind={x.kind as ActivityEvent["kind"]} />
          </span>
          <span class="work-title">{x.title}</span>
          <Show when={x.status === "running"} fallback={<small class="work-detail">{x.status === "error" ? tx("falhou") : x.kind === "run" || x.kind === "plan" ? "" : x.detail}</small>}>
            <span class="spinner" />
          </Show>
        </div>
      )}
    </For>
  );
}

/** Passos fechados numa linha cinza; um clique abre a lista. */
export function WorkFold(props: { steps: WorkStep[]; pid?: string | null; max?: number }) {
  const [open, setOpen] = createSignal(false);
  const [all, setAll] = createSignal(false);
  const max = () => props.max ?? 8;
  const shown = () => (all() ? props.steps : props.steps.slice(-max()));
  const running = () => props.steps.some((x) => x.status === "running");
  const failed = () => props.steps.filter((x) => x.status === "error").length;
  // imagens que ela abriu (as últimas três) aparecem na própria linha, como no Claude Code
  const images = createMemo(() => {
    if (!props.pid) return [];
    const seen = new Set<string>();
    return props.steps
      .filter((x) => x.kind === "read" && x.path && isImagePath(x.path) && !seen.has(x.path) && seen.add(x.path))
      .slice(-3);
  });
  return (
    <div class="work-fold pop-in" classList={{ open: open(), live: running() }}>
      <button class="work-sum" aria-expanded={open()} onClick={() => setOpen(!open())}>
        <span class="work-sum-text">{stepsSummary(props.steps.map((x) => x.kind))}</span>
        <Show when={running()}><span class="spinner tiny" /></Show>
        <Show when={failed() > 0}><small class="work-sum-fail">{tx("{failed} falhou", { failed: failed() })}</small></Show>
        <ChevronDown size={13} class="work-chev" />
      </button>
      <Show when={images().length}>
        <div class="work-thumbs">
          <For each={images()}>{(x) => <Thumb pid={props.pid!} path={x.path!} at={x.ts} />}</For>
        </div>
      </Show>
      <Show when={open()}>
        <div class="work-card slide-in">
          <Show when={props.steps.length > max() && !all()}>
            <button class="work-more" onClick={() => setAll(true)}>{tx("+{v} antes · mostrar tudo", { v: props.steps.length - max() })}</button>
          </Show>
          <WorkRows steps={shown()} />
        </div>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------- lista de tarefas

type Todo = { content: string; status: string; active?: string | null };
type Op =
  | { op: "create"; content: string; active?: string | null }
  | { op: "update"; id: string; status?: string | null; content?: string | null; active?: string | null }
  // plano do app do Claude sem a lista: concluir/começar passos (números a partir de 1) e o fim do turno
  | { op: "step"; advance?: boolean; done?: number[]; start?: number | null }
  | { op: "finish" };

function parseDetail(detail?: string | null): Todo[] | Op | null {
  if (!detail || (detail[0] !== "[" && detail[0] !== "{")) return null;
  try {
    const v = JSON.parse(detail);
    if (Array.isArray(v)) return v.length && v.every((t) => typeof t?.content === "string") ? (v as Todo[]) : null;
    return ["create", "update", "step", "finish"].includes(v?.op) ? (v as Op) : null;
  } catch {
    return null;
  }
}

/**
 * A lista de tarefas da conversa, se o pedido em curso mexeu nela. Vem inteira (TodoWrite) ou
 * aos poucos (TaskCreate / TaskUpdate, numeradas na ordem em que foram criadas).
 */
export function latestPlan(events: WorkStep[]): Todo[] | null {
  let full: Todo[] | null = null;
  const tasks: (Todo & { id: string })[] = [];
  let last: "full" | "tasks" | null = null;
  let seq = 0;
  for (const e of events) {
    if (e.kind === "user") {
      last = null;
      continue;
    }
    if (e.kind !== "plan") continue;
    const d = parseDetail(e.detail);
    if (!d) continue;
    if (Array.isArray(d)) (full = d), (last = "full");
    else if (d.op === "step" || d.op === "finish") {
      if (!full) continue;
      const l: Todo[] = (full as Todo[]).map((t) => ({ ...t }));
      if (d.op === "finish") l.forEach((t) => t.status === "in_progress" && (t.status = "completed"));
      else {
        for (const n of d.done ?? []) if (l[n - 1]) l[n - 1].status = "completed";
        if (d.advance) {
          const i = l.findIndex((t) => t.status === "in_progress");
          if (i >= 0) l[i].status = "completed";
          const j = l.findIndex((t, k) => k > i && t.status === "pending");
          if (j >= 0) l[j].status = "in_progress";
        }
        if (d.start && l[d.start - 1]) l[d.start - 1].status = "in_progress";
      }
      (full = l), (last = "full");
    } else if (d.op === "create") tasks.push({ id: String(++seq), content: d.content, active: d.active, status: "pending" }), (last = "tasks");
    else {
      const i = tasks.findIndex((t) => t.id === String(d.id));
      if (i >= 0) {
        if (d.status === "deleted") tasks.splice(i, 1);
        else tasks[i] = { ...tasks[i], status: d.status ?? tasks[i].status, content: d.content ?? tasks[i].content, active: d.active ?? tasks[i].active };
      }
      last = "tasks";
    }
  }
  return last === "full" ? full : last === "tasks" && tasks.length ? tasks : null;
}

/** O cartão de tarefas: feitas com ✓, a de agora girando, as que faltam com um círculo pontilhado. */
export function PlanCard(props: { todos: Todo[]; color: string; live?: boolean }) {
  const done = () => props.todos.filter((t) => t.status === "completed").length;
  return (
    <div class="plan-card pop-in" style={{ "--c": props.color }}>
      <div class="plan-head">
        <span>{tx("Tarefas")}</span>
        <small>{tx("{done} de {n}", { done: done(), n: props.todos.length })}</small>
        <span class="plan-bar" aria-hidden="true"><i style={{ width: `${(done() / props.todos.length) * 100}%` }} /></span>
      </div>
      <ol class="plan-list">
        <For each={props.todos}>
          {(t) => {
            const now = () => t.status === "in_progress";
            return (
              <li class="plan-item" classList={{ done: t.status === "completed", now: now() }}>
                <span class="plan-mark" aria-hidden="true">
                  <Show when={t.status === "completed"} fallback={<Show when={now() && props.live !== false} fallback={<i class="plan-ring" />}><span class="spinner tiny" /></Show>}>
                    <svg viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="8" r="7.25" /><path d="M5 8.2l2 2 4-4.4" /></svg>
                  </Show>
                </span>
                <span class="plan-text">{now() && t.active ? t.active : t.content}</span>
              </li>
            );
          }}
        </For>
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------- mensagem longa

/** Pedido grande fica fechado em algumas linhas, com "Mostrar mais" (como no Claude Code). */
export function LongText(props: { text: string }) {
  const [open, setOpen] = createSignal(false);
  const long = () => props.text.length > 700 || props.text.split("\n").length > 10;
  return (
    <>
      <div class="long-text" classList={{ clamp: long() && !open() }}>{props.text}</div>
      <Show when={long()}>
        <button class="long-more" onClick={() => setOpen(!open())}>{open() ? tx("Mostrar menos") : tx("Mostrar mais")}</button>
      </Show>
    </>
  );
}
