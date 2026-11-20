// "Claude neste computador": quanto o app do Claude, o Claude Code e o Veocode ocupam,
// no mesmo desenho do painel de armazenamento do Claude, com um conserto por item.
import { AlertTriangle, ChevronDown, ChevronRight, RefreshCw, Sparkles, Trash2 } from "lucide-solid";
import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { isTauri, xrayApi, type ClaudeSpace as Report, type SpacePart } from "../api";
import { formatBytes } from "../data/mock";
import { since } from "../git";
import { showToast } from "../store";
import { confirmAction } from "../dialogs";
import { CountUp } from "./ui";
import { tx } from "../i18n";

const TONES = [
  { id: "runtime", get label() { return tx("Ambientes e versões"); }, color: "#2dd4bf" },
  { id: "sessions", get label() { return tx("Conversas e sessões"); }, color: "#fb923c" },
  { id: "cache", get label() { return tx("Caches e logs"); }, color: "#94a3b8" },
  { id: "other", get label() { return tx("Outros"); }, color: "#818cf8" },
] as const;
const toneColor = (t: string) => TONES.find((x) => x.id === t)?.color ?? "#94a3b8";

// guardado fora do componente: trocar de aba não mede tudo de novo
const [data, setData] = createSignal<Report | null>(null);
const [loading, setLoading] = createSignal(false);
const [fixing, setFixing] = createSignal<string | null>(null);

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const mock: Report = {
  total: 0,
  appRunning: true,
  checkedAt: Date.now(),
  groups: [
    {
      id: "app", get label() { return tx("App do Claude"); }, get hint() { return tx("O aplicativo do Claude (chat, Cowork e Code)."); }, bytes: 0,
      parts: [
        { id: "app-runtime", get label() { return tx("Ambiente do Cowork"); }, get hint() { return tx("A máquina virtual onde o Cowork roda as tarefas. É o que mais pesa."); }, bytes: 10.4 * GB, tone: "runtime", paths: ["~/Library/Application Support/Claude/vm_bundles"], details: [], fix: { id: "app-runtime", get label() { return tx("Remover o ambiente"); }, frees: 10.4 * GB, items: 1, get warning() { return tx("O app do Claude baixa de novo (vários GB) na próxima vez que você usar o Cowork."); }, needsAppClosed: true } },
        { id: "app-code", get label() { return tx("Claude Code dentro do app"); }, get hint() { return tx("2 versões do Claude Code que o app usa."); }, bytes: 690 * MB, tone: "runtime", paths: [], details: [], fix: null },
        { id: "app-cache", get label() { return tx("Caches e logs do app"); }, get hint() { return tx("Cache da web, desenhos da tela e registros. O app refaz sozinho."); }, bytes: 981 * MB, tone: "cache", paths: [], details: [], fix: { id: "app-cache", get label() { return tx("Limpar caches e logs"); }, frees: 981 * MB, items: 9, warning: null, needsAppClosed: true } },
        { id: "app-sessions", get label() { return tx("Sessões e tarefas do app"); }, get hint() { return tx("9 sessões do Code e do Cowork. Apague pelo próprio app do Claude."); }, bytes: 33 * MB, tone: "sessions", paths: [], details: [], fix: null },
      ],
    },
    {
      id: "code", label: "Claude Code", get hint() { return tx("O Claude do terminal, que o Veocode usa nos chats."); }, bytes: 0,
      parts: [
        { id: "code-history:0", get label() { return tx("Conversas guardadas"); }, get hint() { return tx("Todo o histórico das sessões, por projeto. Cresce a cada conversa."); }, bytes: 2.5 * GB, tone: "sessions", paths: ["~/.claude/projects"], details: [{ label: "Veocode", bytes: 1.4 * GB, note: tx("{n} conversas", { n: 42 }) }, { label: "loja-api", bytes: 600 * MB, note: tx("{n} conversas", { n: 18 }) }, { label: "site", bytes: 300 * MB, note: tx("{n} conversas", { n: 9 }) }], fix: { id: "code-history:0", get label() { return tx("Apagar as de mais de 30 dias"); }, frees: 1.1 * GB, items: 31, get warning() { return tx("Essas conversas não dão mais para retomar (/resume). As recentes ficam."); }, needsAppClosed: false } },
        { id: "code-file-history:0", get label() { return tx("Pontos de restauração"); }, get hint() { return tx("Cópias dos arquivos antes de cada edição, para desfazer."); }, bytes: 98 * MB, tone: "sessions", paths: [], details: [], fix: null },
        { id: "code-versions", get label() { return tx("Versões do Claude Code"); }, get hint() { return tx("1 versão instalada no computador."); }, bytes: 296 * MB, tone: "runtime", paths: [], details: [], fix: null },
        { id: "code-extras:0", get label() { return tx("Receitas e plugins"); }, get hint() { return tx("Gerencie em Painel → Extras do Claude."); }, bytes: 85 * MB, tone: "other", paths: [], details: [], fix: null },
      ],
    },
    { id: "veocode", label: "Veocode", get hint() { return tx("Só os ajustes e listas do Veocode. As conversas dos chats ficam no Claude Code, acima."); }, bytes: 0, parts: [{ id: "veocode", get label() { return tx("Ajustes, cofre e listas"); }, get hint() { return tx("Projetos, contas, rastro e ajustes."); }, bytes: 40 * 1024, tone: "other", paths: [], details: [], fix: null }] },
  ],
};
for (const g of mock.groups) g.bytes = g.parts.reduce((s, p) => s + p.bytes, 0);
mock.total = mock.groups.reduce((s, g) => s + g.bytes, 0);

export async function loadClaudeSpace() {
  if (loading()) return;
  setLoading(true);
  try {
    setData(isTauri ? await xrayApi.claudeSpace() : structuredClone(mock));
  } catch (e) {
    showToast(String(e));
  } finally {
    setLoading(false);
  }
}
export const claudeSpaceTotal = () => data()?.total ?? null;

export default function ClaudeSpace() {
  onMount(() => !data() && void loadClaudeSpace());
  const parts = createMemo(() => (data()?.groups ?? []).flatMap((g) => g.parts));
  const tones = createMemo(() => TONES.map((t) => ({ ...t, bytes: parts().filter((p) => p.tone === t.id).reduce((s, p) => s + p.bytes, 0) })).filter((t) => t.bytes > 0));
  const freeable = createMemo(() => parts().reduce((s, p) => s + (p.fix?.frees ?? 0), 0));

  const run = async (p: SpacePart) => {
    const f = p.fix!;
    if (f.needsAppClosed && data()?.appRunning) {
      const go = await confirmAction(tx("Feche o app do Claude antes"), tx("Esses arquivos estão em uso enquanto o app do Claude está aberto. Feche-o (⌘Q nele) e clique de novo."), tx("Já fechei, verificar"));
      if (go) await loadClaudeSpace();
      if (!go || data()?.appRunning) return;
    }
    const ok = await confirmAction(
      `${f.label}?`,
      tx("{v}Vai {v2} para a Lixeira{v3}. Dá para recuperar enquanto você não esvaziar a Lixeira.", { v: f.warning ? f.warning + " " : "", v2: formatBytes(f.frees), v3: f.items > 1 ? tx(" ({n} itens)", { n: f.items }) : "" }),
      tx("Mover para a Lixeira"),
      true,
    );
    if (!ok) return;
    setFixing(f.id);
    try {
      const freed = isTauri ? await xrayApi.claudeSpaceFix(f.id) : f.frees;
      showToast(tx("Pronto: {v} na Lixeira. Esvazie a Lixeira para o espaço voltar.", { v: formatBytes(freed) }));
      await loadClaudeSpace();
    } catch (e) {
      showToast(String(e));
    } finally {
      setFixing(null);
    }
  };

  return (
    <section class="cs">
      <header class="cs-head">
        <div>
          <small class="cx-eyebrow"><Sparkles size={12} /> {tx("Claude neste computador")}</small>
          <strong class="cs-total">
            <Show when={data()} fallback={<span class="spinner inline" />}>
              <CountUp value={data()!.total} format={formatBytes} />
            </Show>
          </strong>
          <small class="cs-when">{loading() ? tx("Medindo…") : data() ? tx("Verificado {since}", { since: since(data()!.checkedAt / 1000) }) : ""}</small>
        </div>
        <div class="cs-head-side">
          <Show when={freeable() > 0}>
            <span class="cs-free">{tx("Dá para liberar")} <b>{formatBytes(freeable())}</b></span>
          </Show>
          <button class="ghost-btn small" onClick={() => void loadClaudeSpace()} disabled={loading()}>
            <RefreshCw size={13} classList={{ spinning: loading() }} /> {tx("Atualizar")}
          </button>
        </div>
      </header>

      <Show when={data()} fallback={<div class="loading-rows"><div /><div /><div /></div>}>
        {(d) => (
          <>
            <div class="cs-bar" role="img" aria-label={tx("Divisão do espaço")}>
              <For each={tones()}>{(t) => <span style={{ "--k": t.color, width: `${Math.max(0.8, (t.bytes / Math.max(1, d().total)) * 100)}%` }} title={`${t.label}: ${formatBytes(t.bytes)}`} />}</For>
            </div>
            <div class="cs-legend">
              <For each={tones()}>{(t) => <span style={{ "--k": t.color }}><i /> {t.label} <b>{formatBytes(t.bytes)}</b></span>}</For>
            </div>
            <Show when={d().appRunning && parts().some((p) => p.fix?.needsAppClosed)}>
              <p class="cs-note"><AlertTriangle size={13} /> {tx("O app do Claude está aberto. Para limpar o ambiente do Cowork e os caches do app, feche-o antes.")}</p>
            </Show>

            <For each={d().groups}>
              {(g) => (
                <div class="cs-group">
                  <div class="cs-group-head">
                    <div>
                      <strong>{g.label}</strong>
                      <small>{g.hint}</small>
                    </div>
                    <span class="cs-size">{formatBytes(g.bytes)}</span>
                  </div>
                  <For each={g.parts}>{(p) => <Row p={p} total={d().total} busy={fixing() === p.fix?.id} onFix={() => void run(p)} />}</For>
                </div>
              )}
            </For>
          </>
        )}
      </Show>
    </section>
  );
}

function Row(props: { p: SpacePart; total: number; busy: boolean; onFix: () => void }) {
  const [open, setOpen] = createSignal(false);
  const more = () => props.p.details.length > 0 || props.p.paths.length > 0;
  const maxDetail = () => Math.max(1, ...props.p.details.map((d) => d.bytes));
  return (
    <div class="cs-row" classList={{ open: open() }} style={{ "--k": toneColor(props.p.tone) }}>
      <div class="cs-row-main">
        <i class="cs-dot" />
        <div class="cs-row-text">
          <strong>{props.p.label}</strong>
          <small>{props.p.hint}</small>
          <Show when={more()}>
            <button class="cs-more" onClick={() => setOpen(!open())}>
              {open() ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {tx("Detalhes")}
            </button>
          </Show>
        </div>
        <div class="cs-row-side">
          <span class="cs-size">{formatBytes(props.p.bytes)}</span>
          <span class="cs-meter"><span style={{ width: `${Math.min(100, (props.p.bytes / Math.max(1, props.total)) * 100)}%` }} /></span>
          <Show when={props.p.fix}>
            {(f) => (
              <button class="cs-fix" disabled={props.busy} onClick={props.onFix} title={f().warning ?? tx("Vai para a Lixeira")}>
                <Show when={props.busy} fallback={<Trash2 size={12} />}><span class="spinner inline" /></Show>
                {f().label} · {formatBytes(f().frees)}
              </button>
            )}
          </Show>
        </div>
      </div>
      <Show when={open()}>
        <div class="cs-details">
          <For each={props.p.details}>
            {(d) => (
              <div class="cs-detail">
                <span>{d.label}</span>
                <small>{d.note}</small>
                <span class="cs-meter"><span style={{ width: `${(d.bytes / maxDetail()) * 100}%` }} /></span>
                <b>{formatBytes(d.bytes)}</b>
              </div>
            )}
          </For>
          <For each={props.p.paths}>{(p) => <code>{p}</code>}</For>
        </div>
      </Show>
    </div>
  );
}
