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

const TONES = [
  { id: "runtime", label: "Ambientes e versões", color: "#2dd4bf" },
  { id: "sessions", label: "Conversas e sessões", color: "#fb923c" },
  { id: "cache", label: "Caches e logs", color: "#94a3b8" },
  { id: "other", label: "Outros", color: "#818cf8" },
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
      id: "app", label: "App do Claude", hint: "O aplicativo do Claude (chat, Cowork e Code).", bytes: 0,
      parts: [
        { id: "app-runtime", label: "Ambiente do Cowork", hint: "A máquina virtual onde o Cowork roda as tarefas. É o que mais pesa.", bytes: 10.4 * GB, tone: "runtime", paths: ["~/Library/Application Support/Claude/vm_bundles"], details: [], fix: { id: "app-runtime", label: "Remover o ambiente", frees: 10.4 * GB, items: 1, warning: "O app do Claude baixa de novo (vários GB) na próxima vez que você usar o Cowork.", needsAppClosed: true } },
        { id: "app-code", label: "Claude Code dentro do app", hint: "2 versões do Claude Code que o app usa.", bytes: 690 * MB, tone: "runtime", paths: [], details: [], fix: null },
        { id: "app-cache", label: "Caches e logs do app", hint: "Cache da web, desenhos da tela e registros. O app refaz sozinho.", bytes: 981 * MB, tone: "cache", paths: [], details: [], fix: { id: "app-cache", label: "Limpar caches e logs", frees: 981 * MB, items: 9, warning: null, needsAppClosed: true } },
        { id: "app-sessions", label: "Sessões e tarefas do app", hint: "9 sessões do Code e do Cowork. Apague pelo próprio app do Claude.", bytes: 33 * MB, tone: "sessions", paths: [], details: [], fix: null },
      ],
    },
    {
      id: "code", label: "Claude Code", hint: "O Claude do terminal, que o Veocode usa nos chats.", bytes: 0,
      parts: [
        { id: "code-history:0", label: "Conversas guardadas", hint: "Todo o histórico das sessões, por projeto. Cresce a cada conversa.", bytes: 2.5 * GB, tone: "sessions", paths: ["~/.claude/projects"], details: [{ label: "Veocode", bytes: 1.4 * GB, note: "42 conversas" }, { label: "loja-api", bytes: 600 * MB, note: "18 conversas" }, { label: "site", bytes: 300 * MB, note: "9 conversas" }], fix: { id: "code-history:0", label: "Apagar as de mais de 30 dias", frees: 1.1 * GB, items: 31, warning: "Essas conversas não dão mais para retomar (/resume). As recentes ficam.", needsAppClosed: false } },
        { id: "code-file-history:0", label: "Pontos de restauração", hint: "Cópias dos arquivos antes de cada edição, para desfazer.", bytes: 98 * MB, tone: "sessions", paths: [], details: [], fix: null },
        { id: "code-versions", label: "Versões do Claude Code", hint: "1 versão instalada no computador.", bytes: 296 * MB, tone: "runtime", paths: [], details: [], fix: null },
        { id: "code-extras:0", label: "Receitas e plugins", hint: "Gerencie em Computador → Extras do Claude.", bytes: 85 * MB, tone: "other", paths: [], details: [], fix: null },
      ],
    },
    { id: "veocode", label: "Veocode", hint: "Só os ajustes e listas do Veocode. As conversas dos chats ficam no Claude Code, acima.", bytes: 0, parts: [{ id: "veocode", label: "Ajustes, cofre e listas", hint: "Projetos, contas, rastro e ajustes.", bytes: 40 * 1024, tone: "other", paths: [], details: [], fix: null }] },
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
      const go = await confirmAction("Feche o app do Claude antes", "Esses arquivos estão em uso enquanto o app do Claude está aberto. Feche-o (⌘Q nele) e clique de novo.", "Já fechei, verificar");
      if (go) await loadClaudeSpace();
      if (!go || data()?.appRunning) return;
    }
    const ok = await confirmAction(
      `${f.label}?`,
      `${f.warning ? f.warning + " " : ""}Vai ${formatBytes(f.frees)} para a Lixeira${f.items > 1 ? ` (${f.items} itens)` : ""}. Dá para recuperar enquanto você não esvaziar a Lixeira.`,
      "Mover para a Lixeira",
      true,
    );
    if (!ok) return;
    setFixing(f.id);
    try {
      const freed = isTauri ? await xrayApi.claudeSpaceFix(f.id) : f.frees;
      showToast(`Pronto: ${formatBytes(freed)} na Lixeira. Esvazie a Lixeira para o espaço voltar.`);
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
          <small class="cx-eyebrow"><Sparkles size={12} /> Claude neste computador</small>
          <strong class="cs-total">
            <Show when={data()} fallback={<span class="spinner inline" />}>
              <CountUp value={data()!.total} format={formatBytes} />
            </Show>
          </strong>
          <small class="cs-when">{loading() ? "Medindo…" : data() ? `Verificado ${since(data()!.checkedAt / 1000)}` : ""}</small>
        </div>
        <div class="cs-head-side">
          <Show when={freeable() > 0}>
            <span class="cs-free">Dá para liberar <b>{formatBytes(freeable())}</b></span>
          </Show>
          <button class="ghost-btn small" onClick={() => void loadClaudeSpace()} disabled={loading()}>
            <RefreshCw size={13} classList={{ spinning: loading() }} /> Atualizar
          </button>
        </div>
      </header>

      <Show when={data()} fallback={<div class="loading-rows"><div /><div /><div /></div>}>
        {(d) => (
          <>
            <div class="cs-bar" role="img" aria-label="Divisão do espaço">
              <For each={tones()}>{(t) => <span style={{ "--k": t.color, width: `${Math.max(0.8, (t.bytes / Math.max(1, d().total)) * 100)}%` }} title={`${t.label}: ${formatBytes(t.bytes)}`} />}</For>
            </div>
            <div class="cs-legend">
              <For each={tones()}>{(t) => <span style={{ "--k": t.color }}><i /> {t.label} <b>{formatBytes(t.bytes)}</b></span>}</For>
            </div>
            <Show when={d().appRunning && parts().some((p) => p.fix?.needsAppClosed)}>
              <p class="cs-note"><AlertTriangle size={13} /> O app do Claude está aberto. Para limpar o ambiente do Cowork e os caches do app, feche-o antes.</p>
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
              {open() ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Detalhes
            </button>
          </Show>
        </div>
        <div class="cs-row-side">
          <span class="cs-size">{formatBytes(props.p.bytes)}</span>
          <span class="cs-meter"><span style={{ width: `${Math.min(100, (props.p.bytes / Math.max(1, props.total)) * 100)}%` }} /></span>
          <Show when={props.p.fix}>
            {(f) => (
              <button class="cs-fix" disabled={props.busy} onClick={props.onFix} title={f().warning ?? "Vai para a Lixeira"}>
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
