import { Activity, ArrowRight, Check, FolderOpen, KeyRound, LogIn, Pencil, Plug, Plus, RefreshCw, Trash2 } from "lucide-solid";
import Vault from "../components/Vault";
import { createMemo, createSignal, For, Show } from "solid-js";
import { vault } from "../vault";
const vaultCount = () => vault.items.length;
import { api, isTauri, prettyPath } from "../api";
import { projects, setView, showToast } from "../store";
import {
  accts, addAccount, checkAccount, fmtAgo, fmtTokens, loginAccount, palette, prettyModel, providers, refreshStatuses,
  removeAccount, setAccountKey, stateText, updateAccount, type Account, type ProviderId,
} from "../accounts";
import { CountUp, PageHeader, ProviderMark, Stagger } from "../components/ui";
import ConfirmDialog from "../components/ConfirmDialog";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** A semana em uma frase: "Esta semana: 1,2 mi tokens. Dia mais forte: ter. Hoje está acima do normal." */
function weekSays(days: number[]): string {
  const total = days.reduce((a, b) => a + b, 0);
  if (!total) return "Não usada nos últimos 7 dias.";
  const max = Math.max(...days);
  const peak = days.indexOf(max);
  const before = days.slice(0, 6).filter((d) => d > 0);
  const avg = before.length ? before.reduce((a, b) => a + b, 0) / before.length : 0;
  const today = days[6] ?? 0;
  const trend = !avg ? "" : today > avg * 1.5 ? " Hoje está bem acima do normal." : today < avg * 0.5 && today > 0 ? " Hoje está mais calmo que o normal." : "";
  return `Esta semana: ${fmtTokens(total)} tokens. Dia mais forte: ${peak === 6 ? "hoje" : weekday(6 - peak)}.${trend}`;
}

const weekday = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
};

/** Topo de Contas: a semana de todas as contas num gráfico só, uma cor por conta. */
function WeekHero() {
  const series = createMemo(() =>
    accts.list.map((a) => ({ a, days: accts.status[a.id]?.usage?.days ?? [0, 0, 0, 0, 0, 0, 0] })).filter((x) => x.days.some((d) => d > 0)),
  );
  const totals = createMemo(() => Array.from({ length: 7 }, (_, i) => series().reduce((t, x) => t + (x.days[i] ?? 0), 0)));
  const max = () => Math.max(1, ...totals());
  const week = () => totals().reduce((a, b) => a + b, 0);
  const active = () => accts.list.filter((a) => accts.status[a.id]?.active).length;
  return (
    <section class="acc-hero">
      <span class="cx-orb a" />
      <span class="cx-orb b" />
      <div class="acc-hero-main">
        <small class="cx-eyebrow"><Activity size={12} /> Últimos 7 dias, todas as contas</small>
        <strong class="cx-big"><CountUp value={week()} format={fmtTokens} /> <span class="acc-hero-unit">tokens</span></strong>
        <p>
          {accts.list.length} {accts.list.length === 1 ? "conta" : "contas"}
          {active() ? ` · ${active()} trabalhando agora` : " · nenhuma trabalhando agora"}
          {vaultCount() ? ` · ${vaultCount()} ${vaultCount() === 1 ? "chave guardada" : "chaves guardadas"} no cofre` : ""}
        </p>
        <div class="cx-legend">
          <For each={series()}>
            {(x, i) => (
              <span style={{ "--k": x.a.color, "--i": i() }}>
                <i /> {x.a.label} <b>{fmtTokens(x.days.reduce((t, d) => t + d, 0))}</b>
              </span>
            )}
          </For>
        </div>
      </div>
      <div class="acc-week" aria-label="Tokens por dia">
        <For each={totals()}>
          {(_, i) => (
            <div class="acc-week-col" style={{ "--i": i() }}>
              <div class="acc-week-stack" style={{ height: `${Math.max(3, (totals()[i()] / max()) * 100)}%` }} title={`${weekday(6 - i())}: ${fmtTokens(totals()[i()])} tokens`}>
                <For each={series()}>{(x) => <span style={{ flex: x.days[i()] || 0, background: x.a.color }} />}</For>
              </div>
              <small classList={{ today: i() === 6 }}>{i() === 6 ? "hoje" : weekday(6 - i())}</small>
            </div>
          )}
        </For>
      </div>
    </section>
  );
}

export default function Accounts() {
  const [adding, setAdding] = createSignal(false);
  const [removing, setRemoving] = createSignal<Account | null>(null);
  const [keyFor, setKeyFor] = createSignal<Account | null>(null);

  return (
    <div class="page">
      <PageHeader
        title="Contas e IAs"
        subtitle={isTauri ? "Suas IAs, quanto cada uma trabalhou e o cofre com as chaves e senhas que os projetos usam." : "Modo navegador: contas de exemplo. Abra pelo app para ver as suas."}
        actions={
          <>
            <button class="ghost-btn" onClick={() => refreshStatuses()}>
              <RefreshCw size={14} classList={{ spinning: Object.values(accts.checking).some(Boolean) }} /> Atualizar
            </button>
            <button class="primary-btn" onClick={() => setAdding(true)}>
              <Plus size={14} /> Adicionar conta
            </button>
          </>
        }
      />

      <Show when={accts.loaded && accts.list.length === 0}>
        <div class="empty-state">Nenhuma conta ainda. Adicione uma conta do Claude, uma chave da DeepSeek ou o Ollama.</div>
      </Show>

      <WeekHero />

      <h2 class="section-title acc-section">Suas contas de IA</h2>
      <div class="acc-grid">
        <Stagger each={accts.list} step={70}>
          {(a) => <AccountCard a={a} onRemove={setRemoving} onKey={setKeyFor} />}
        </Stagger>
      </div>

      <Vault />

      <section class="acc-integrations">
        <span class="vault-badge alt"><Plug size={18} /></span>
        <div>
          <strong>Integrações</strong>
          <p>Conexões do Claude com outros programas (Figma, GitHub, navegador…), receitas e atalhos ficam em <b>Computador → Extras do Claude</b>, com ligar, desligar e remover.</p>
        </div>
        <button class="ghost-btn" onClick={() => setView("inventory")}>Abrir Extras <ArrowRight size={13} /></button>
      </section>

      <Show when={adding()}>
        <AddAccount onClose={() => setAdding(false)} />
      </Show>

      <Show when={keyFor()}>
        {(a) => <KeyDialog a={a()} onClose={() => setKeyFor(null)} />}
      </Show>

      <Show when={removing()}>
        {(a) => (
          <ConfirmDialog
            title={`Tirar “${a().label}” do Veocode?`}
            confirmLabel="Tirar da lista"
            danger
            onCancel={() => setRemoving(null)}
            onConfirm={() => {
              const acc = a();
              setRemoving(null);
              removeAccount(acc.id).then(() => showToast(`${acc.label} saiu da lista`), (e) => showToast(errMsg(e)));
            }}
          >
            <p class="foot-note top">
              {a().provider === "claude"
                ? "A pasta da conta continua no disco, com login e históricos. Dá para adicionar de novo depois apontando para ela."
                : a().provider === "ollama"
                  ? "O Ollama e os modelos continuam instalados."
                  : "A chave de API é apagada do chaveiro do sistema."}
            </p>
            <Show when={a().dir}><code class="confirm-cmd">{prettyPath(a().dir!)}</code></Show>
          </ConfirmDialog>
        )}
      </Show>
    </div>
  );
}

function AccountCard(props: { a: Account; onRemove: (a: Account) => void; onKey: (a: Account) => void }) {
  const a = () => props.a;
  const s = () => accts.status[a().id];
  const u = () => s()?.usage ?? null;
  const used = () => projects.filter((p) => p.accountId === a().id);
  const maxDay = createMemo(() => Math.max(1, ...(u()?.days ?? [1])));
  const [editing, setEditing] = createSignal(false);
  const [name, setName] = createSignal("");

  const saveName = () => {
    setEditing(false);
    if (name().trim() && name().trim() !== a().label) updateAccount(a().id, { label: name().trim() }).catch((e) => showToast(errMsg(e)));
  };

  return (
    <div class="acc-card" classList={{ working: s()?.active }} style={{ "--c": a().color }}>
      <div class="acc-top">
        <ProviderMark id={a().id} size={38} />
        <div class="acc-name">
          <Show
            when={editing()}
            fallback={
              <strong>
                {a().label}
                <button class="icon-btn tiny" title="Renomear" onClick={() => (setName(a().label), setEditing(true))}><Pencil size={11} /></button>
              </strong>
            }
          >
            <input class="name-input" value={name()} autofocus onInput={(e) => setName(e.currentTarget.value)} onBlur={saveName} onKeyDown={(e) => e.key === "Enter" && saveName()} />
          </Show>
          <small>{providers[a().provider].name}{s()?.plan ? ` · ${s()!.plan}` : ""}</small>
        </div>
        <span class={`acc-state st-${s()?.state ?? "checking"}`} classList={{ live: s()?.active }}>
          <Show when={s()} fallback={<><span class="spinner inline" /> verificando</>}>
            {s()!.active ? "trabalhando" : stateText[s()!.state]}
          </Show>
        </span>
      </div>

      <Show when={s()?.detail && s()!.state !== "pronta"}>
        <p class="acc-detail">{s()!.detail}</p>
      </Show>

      {/* Claude: uso real dos históricos */}
      <Show when={a().provider === "claude" && u() && u()!.lastActiveSecs !== null}>
        <div class="usage">
          <div class="usage-bars" title="Tokens por dia (entrada nova + saída)">
            <For each={u()!.days}>
              {(d, i) => (
                <div class="ubar-col" title={`${weekday(6 - i())}: ${fmtTokens(d)} tokens`}>
                  <span class="ubar" classList={{ today: i() === 6 }} style={{ height: `${Math.max(3, (d / maxDay()) * 100)}%`, "transition-delay": `${i() * 40}ms` }} />
                  <small>{weekday(6 - i())[0]}</small>
                </div>
              )}
            </For>
          </div>
          <dl>
            <dt>Hoje</dt>
            <dd><CountUp value={u()!.today} format={fmtTokens} /> tokens</dd>
            <dt>Últimas 5 h</dt>
            <dd><CountUp value={u()!.last5h} format={fmtTokens} /></dd>
            <dt>Sessões hoje</dt>
            <dd>{u()!.sessionsToday} · {u()!.messagesToday} respostas</dd>
            <dt>Última vez</dt>
            <dd>{fmtAgo(u()!.lastActiveSecs)}</dd>
          </dl>
        </div>
        <p class="usage-says">{weekSays(u()!.days)}</p>
        <Show when={u()!.models.length}>
          <div class="model-mix">
            <For each={u()!.models}>
              {([m, t]) => <span class="mini-chip" title={`${fmtTokens(t)} tokens em 7 dias`}>{prettyModel(m)} <b>{fmtTokens(t)}</b></span>}
            </For>
          </div>
        </Show>
      </Show>

      {/* APIs e Ollama */}
      <Show when={a().provider !== "claude"}>
        <dl class="acc-facts">
          <Show when={a().provider === "deepseek" || a().provider === "openai"}>
            <dt>Chave</dt>
            <dd>{a().keyHint ?? "nenhuma"}</dd>
          </Show>
          <Show when={s()?.balance}>
            <dt>Saldo</dt>
            <dd class="balance">{s()!.balance}</dd>
          </Show>
          <dt>Servidor</dt>
          <dd>{s()?.who ?? a().baseUrl ?? "—"}</dd>
          <dt>Modelos</dt>
          <dd>{s() ? (s()!.models.length ? `${s()!.models.length} disponíveis` : "—") : "…"}</dd>
          <Show when={a().provider === "ollama" && s()?.state === "pronta" && s()?.detail}>
            <dt>Detalhe</dt>
            <dd>{s()!.detail}</dd>
          </Show>
        </dl>
      </Show>

      <Show when={(s()?.models.length ?? 0) > 0}>
        <label class="model-pick">
          <span>Modelo padrão</span>
          <select value={a().model ?? ""} onChange={(e) => updateAccount(a().id, { model: e.currentTarget.value }).catch((er) => showToast(errMsg(er)))}>
            <option value="">{a().provider === "claude" ? "o do Claude Code" : "automático"}</option>
            <For each={s()!.models}>{(m) => <option value={m}>{a().provider === "claude" ? prettyModel(m) : m}</option>}</For>
          </select>
        </label>
      </Show>

      <div class="acc-foot">
        <div class="acc-actions">
          <Show when={a().provider === "claude"}>
            <button
              class={s()?.state === "semLogin" ? "primary-btn small" : "ghost-btn small"}
              title="Abre um terminal com o Claude Code nesta conta"
              onClick={() => loginAccount(a().id).then(() => showToast("Terminal aberto. Faça o login lá e volte aqui."), (e) => showToast(errMsg(e)))}
            >
              <LogIn size={12} /> {s()?.state === "semLogin" ? "Entrar" : "Terminal"}
            </button>
            <Show when={a().dir}>
              <button class="icon-btn small" title={`Mostrar pasta: ${prettyPath(a().dir!)}`} onClick={() => api.reveal(a().dir!).catch((e) => showToast(errMsg(e)))}>
                <FolderOpen size={12} />
              </button>
            </Show>
          </Show>
          <Show when={a().provider === "deepseek" || a().provider === "openai"}>
            <button class={a().keyHint ? "ghost-btn small" : "primary-btn small"} onClick={() => props.onKey(a())}>
              <KeyRound size={12} /> {a().keyHint ? "Trocar chave" : "Colar chave"}
            </button>
          </Show>
          <button class="icon-btn small" title="Verificar de novo" onClick={() => checkAccount(a().id)}>
            <RefreshCw size={12} classList={{ spinning: accts.checking[a().id] }} />
          </button>
          <button class="icon-btn small" title="Tirar da lista" onClick={() => props.onRemove(a())}><Trash2 size={12} /></button>
        </div>
        <span class="acc-projects">
          <For each={used()} fallback={<small class="muted">nenhum projeto</small>}>{(p) => <span class="mini-chip">{p.name}</span>}</For>
        </span>
      </div>
      <Show when={s()?.who && a().provider === "claude"}>
        <small class="acc-who" title="Quem fez login nesta pasta">{s()!.who}</small>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------- adicionar

const kinds: { id: ProviderId; title: string; text: string }[] = [
  { id: "claude", title: "Claude", text: "Outra conta do Claude Code, com login, histórico e limites próprios." },
  { id: "deepseek", title: "DeepSeek", text: "Pela API, com chave. Mostra o saldo." },
  { id: "openai", title: "Compatível com OpenAI", text: "Qualquer API no formato da OpenAI (OpenRouter, Groq, LM Studio…)." },
  { id: "ollama", title: "Ollama", text: "Modelos rodando na sua máquina, sem internet." },
];

function AddAccount(props: { onClose: () => void }) {
  const [kind, setKind] = createSignal<ProviderId>("claude");
  const [label, setLabel] = createSignal("");
  const [color, setColor] = createSignal(palette[accts.list.length % palette.length]);
  const [baseUrl, setBaseUrl] = createSignal("");
  const [key, setKey] = createSignal("");
  const [folder, setFolder] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");

  const defaultLabel = () => ({ claude: "Claude · nova", deepseek: "DeepSeek · API", openai: "API", ollama: "Local · Ollama" })[kind()];

  const pick = async () => {
    try {
      const p = await api.pickFolder();
      if (p) setFolder(p);
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const a = await addAccount(
        { provider: kind(), label: label().trim() || defaultLabel(), color: color(), baseUrl: baseUrl().trim() || null, configDir: kind() === "claude" ? folder() : null },
        kind() === "deepseek" || kind() === "openai" ? key() : undefined,
      );
      setKey("");
      showToast(kind() === "claude" && !folder() ? `${a.label} criada. Clique em “Entrar” para fazer login.` : `${a.label} adicionada`);
      props.onClose();
    } catch (er) {
      setError(errMsg(er));
    }
    setBusy(false);
  };

  return (
    <div class="palette-backdrop" onClick={props.onClose}>
      <form class="dialog wide" onClick={(e) => e.stopPropagation()} onSubmit={submit} onKeyDown={(e) => e.key === "Escape" && props.onClose()} autocomplete="off">
        <h3>Adicionar conta</h3>
        <div class="kind-grid">
          <For each={kinds}>
            {(k) => (
              <button type="button" class="kind" classList={{ sel: kind() === k.id }} onClick={() => (setKind(k.id), setError(""))}>
                <strong>{k.title}</strong>
                <small>{k.text}</small>
                <Show when={kind() === k.id}><span class="kind-check"><Check size={12} /></span></Show>
              </button>
            )}
          </For>
        </div>

        <div class="form-grid">
          <label>
            <span>Nome</span>
            <input value={label()} placeholder={defaultLabel()} onInput={(e) => setLabel(e.currentTarget.value)} />
          </label>
          <label>
            <span>Cor</span>
            <div class="swatches">
              <For each={palette}>
                {(c) => <button type="button" class="swatch" classList={{ sel: color() === c }} style={{ "--c": c }} onClick={() => setColor(c)} title={c} />}
              </For>
            </div>
          </label>

          <Show when={kind() === "claude"}>
            <label class="span2">
              <span>Pasta da conta</span>
              <div class="row-input">
                <code>{folder() ? prettyPath(folder()!) : "nova pasta criada pelo Veocode"}</code>
                <button type="button" class="ghost-btn small" onClick={pick}>Usar uma existente…</button>
                <Show when={folder()}><button type="button" class="ghost-btn small" onClick={() => setFolder(null)}>Criar nova</button></Show>
              </div>
              <small class="hint">Depois de criar, “Entrar” abre o Claude Code no terminal com essa pasta, e você faz o login lá. O Veocode não vê senha nem token.</small>
            </label>
          </Show>

          <Show when={kind() === "openai"}>
            <label class="span2">
              <span>Endereço da API</span>
              <input value={baseUrl()} placeholder="https://openrouter.ai/api/v1" onInput={(e) => setBaseUrl(e.currentTarget.value)} />
            </label>
          </Show>
          <Show when={kind() === "ollama"}>
            <label class="span2">
              <span>Endereço</span>
              <input value={baseUrl()} placeholder="http://127.0.0.1:11434" onInput={(e) => setBaseUrl(e.currentTarget.value)} />
            </label>
          </Show>

          <Show when={kind() === "deepseek" || kind() === "openai"}>
            <label class="span2">
              <span>Chave de API</span>
              <input type="password" value={key()} placeholder="sk-…" autocomplete="off" spellcheck={false} onInput={(e) => setKey(e.currentTarget.value)} />
              <small class="hint">Vai direto para o chaveiro do sistema. Pode deixar em branco e colar depois.</small>
            </label>
          </Show>
        </div>

        <Show when={error()}><p class="form-error">{error()}</p></Show>
        <div class="dialog-actions">
          <button type="button" class="ghost-btn" onClick={props.onClose}>Cancelar</button>
          <button type="submit" class="primary-btn" disabled={busy()}>
            <Show when={busy()} fallback={<Plus size={14} />}><span class="spinner inline" /></Show> Adicionar
          </button>
        </div>
      </form>
    </div>
  );
}

function KeyDialog(props: { a: Account; onClose: () => void }) {
  const [key, setKey] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    try {
      await setAccountKey(props.a.id, key());
      setKey("");
      showToast("Chave salva no chaveiro");
      props.onClose();
    } catch (er) {
      setError(errMsg(er));
    }
    setBusy(false);
  };
  return (
    <div class="palette-backdrop" onClick={props.onClose}>
      <form class="dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit} onKeyDown={(e) => e.key === "Escape" && props.onClose()} autocomplete="off">
        <h3>Chave de API · {props.a.label}</h3>
        <label class="form-grid one">
          <input type="password" value={key()} placeholder="sk-…" autofocus autocomplete="off" spellcheck={false} onInput={(e) => setKey(e.currentTarget.value)} />
          <small class="hint">{props.a.keyHint ? `Substitui a chave atual (${props.a.keyHint}). ` : ""}Fica no chaveiro do sistema; o Veocode só mostra o final dela.</small>
        </label>
        <Show when={error()}><p class="form-error">{error()}</p></Show>
        <div class="dialog-actions">
          <button type="button" class="ghost-btn" onClick={props.onClose}>Cancelar</button>
          <button type="submit" class="primary-btn" disabled={busy() || !key().trim()}>Salvar e testar</button>
        </div>
      </form>
    </div>
  );
}
