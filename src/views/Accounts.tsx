import { LimitBars } from "../components/Limits";
import { ArrowRight, Check, ExternalLink, FolderOpen, Globe, KeyRound, Pencil, Plug, Plus, RefreshCw, SquareTerminal, Trash2, X } from "lucide-solid";
import Vault from "../components/Vault";
import { createMemo, createSignal, For, Show } from "solid-js";
import { api, isTauri, prettyPath } from "../api";
import { projects, setProjectAccount, setView, showToast } from "../store";
import { settings, updateSettings } from "../settings";
import { loadLimits } from "../limits";
import {
  accts, addAccount, browserLogin, cancelLogin, checkAccount, fmtAgo, fmtTokens, loginAccount, logins, palette, prettyModel, providers, refreshStatuses,
  removeAccount, sendLoginCode, setAccountKey, stateText, updateAccount, type Account, type ProviderId,
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

export default function Accounts() {
  const [adding, setAdding] = createSignal(false);
  const [removing, setRemoving] = createSignal<Account | null>(null);
  const [keyFor, setKeyFor] = createSignal<Account | null>(null);

  return (
    <div class="page">
      <PageHeader
        title="Contas e IAs"
        subtitle={isTauri ? "As IAs que os seus projetos usam, quanto falta de cada plano e o cofre de chaves." : "Modo navegador: contas de exemplo. Abra pelo app para ver as suas."}
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

      <Show when={removing()}>{(a) => <RemoveDialog a={a()} onClose={() => setRemoving(null)} />}</Show>
    </div>
  );
}

/** Tirar a conta: se algum projeto usa ela, escolhe para qual conta eles vão antes. */
function RemoveDialog(props: { a: Account; onClose: () => void }) {
  const a = () => props.a;
  const users = () => projects.filter((p) => !p.demo && p.accountId === a().id);
  const others = () => accts.list.filter((x) => x.id !== a().id);
  const [to, setTo] = createSignal(others()[0]?.id ?? "");
  const [busy, setBusy] = createSignal(false);
  const blocked = () => users().length > 0 && !others().length;
  const go = async () => {
    setBusy(true);
    try {
      if (users().length) await Promise.all(users().map((p) => setProjectAccount(p.id, to())));
      // projetos de exemplo e o Chat livre também saem dela
      for (const p of projects.filter((p) => p.demo && p.accountId === a().id)) void setProjectAccount(p.id, to() || others()[0]?.id || "");
      if (settings.freeAccount === a().id) await updateSettings({ freeAccount: to() || "" });
      await removeAccount(a().id);
      showToast(`${a().label} saiu do Veocode`);
      props.onClose();
    } catch (e) {
      showToast(errMsg(e));
      setBusy(false);
    }
  };
  return (
    <ConfirmDialog title={`Remover “${a().label}”?`} confirmLabel={busy() ? "Removendo…" : "Remover conta"} danger disabled={busy() || blocked()} onCancel={props.onClose} onConfirm={() => void go()}>
      <div class="rm-acc">
        <div class="rm-acc-who">
          <ProviderMark id={a().id} size={30} />
          <div>
            <strong>{a().label}</strong>
            <small>{accts.status[a().id]?.who ?? providers[a().provider].name}</small>
          </div>
        </div>
        <Show when={users().length}>
          <Show
            when={!blocked()}
            fallback={<p class="rm-acc-warn">{users().map((p) => p.name).join(", ")} {users().length === 1 ? "usa" : "usam"} esta conta e não há outra para pôr no lugar. Adicione outra conta antes de remover esta.</p>}
          >
            <label class="rm-acc-move">
              <span>{users().length === 1 ? `${users()[0].name} usa esta conta. Passar para:` : `${users().length} projetos usam esta conta. Passar todos para:`}</span>
              <select value={to()} onChange={(e) => setTo(e.currentTarget.value)}>
                <For each={others()}>{(o) => <option value={o.id}>{o.label}</option>}</For>
              </select>
            </label>
          </Show>
        </Show>
        <p class="foot-note top">
          {a().provider === "claude"
            ? a().configDir
              ? "Só sai do Veocode. A pasta da conta fica no disco, com o login e as conversas: dá para adicionar de novo depois."
              : "Só sai do Veocode. O Claude Code no terminal continua logado nesta conta, igual antes."
            : a().provider === "ollama"
              ? "O Ollama e os modelos continuam instalados."
              : "A chave de API é apagada do chaveiro do sistema."}
        </p>
      </div>
    </ConfirmDialog>
  );
}

/** Esperando a pessoa terminar o login na página da Anthropic. */
function LoginWait(props: { id: string }) {
  const l = () => logins[props.id];
  const [code, setCode] = createSignal("");
  const [showCode, setShowCode] = createSignal(false);
  const send = async (e: Event) => {
    e.preventDefault();
    if (!code().trim()) return;
    try {
      await sendLoginCode(props.id, code());
      setCode("");
      showToast("Código enviado. Terminando o login…");
    } catch (er) {
      showToast(errMsg(er));
    }
  };
  return (
    <div class="login-wait pop-in">
      <div class="login-wait-head">
        <span class="login-pulse"><Globe size={15} /></span>
        <div>
          <strong>Termine o login no navegador</strong>
          <small>A página da Anthropic abriu. Entre com a conta do Claude que quer usar aqui; o Veocode atualiza sozinho quando acabar.</small>
        </div>
      </div>
      <div class="login-wait-actions">
        <Show when={l()?.url}>
          <button class="ghost-btn small" onClick={() => api.openUrl(l()!.url!).catch((e) => showToast(errMsg(e)))}><ExternalLink size={12} /> Abrir a página de novo</button>
        </Show>
        <button class="link-btn" onClick={() => setShowCode((v) => !v)}>A página mostrou um código?</button>
        <span class="grow" />
        <button class="ghost-btn small" onClick={() => cancelLogin(props.id)}><X size={12} /> Cancelar</button>
      </div>
      <Show when={showCode()}>
        <form class="login-code" onSubmit={send} autocomplete="off">
          <input value={code()} placeholder="Cole o código aqui" spellcheck={false} autofocus onInput={(e) => setCode(e.currentTarget.value)} />
          <button class="primary-btn small" disabled={!code().trim()}>Enviar</button>
        </form>
      </Show>
    </div>
  );
}

/** Entra pelo navegador e, quando termina, avisa e lê o uso da conta. */
export function startBrowserLogin(a: Account) {
  browserLogin(a.id).then(
    (ok) => {
      if (!ok) return;
      const who = accts.status[a.id]?.who;
      showToast(who ? `${a.label} conectada: ${who}` : `${a.label} conectada`);
      void loadLimits(a.id, true);
    },
    (e) => {
      const m = errMsg(e);
      if (!/cancelad/i.test(m)) showToast(m);
    },
  );
}

function AccountCard(props: { a: Account; onRemove: (a: Account) => void; onKey: (a: Account) => void }) {
  const a = () => props.a;
  const s = () => accts.status[a().id];
  const u = () => s()?.usage ?? null;
  const used = () => projects.filter((p) => !p.demo && p.accountId === a().id);
  const maxDay = createMemo(() => Math.max(1, ...(u()?.days ?? [1])));
  const week = () => (u()?.days ?? []).reduce((t, d) => t + d, 0);
  const [editing, setEditing] = createSignal(false);
  const [name, setName] = createSignal("");
  const claude = () => a().provider === "claude";
  const noLogin = () => claude() && s()?.state === "semLogin";
  const loggingIn = () => !!logins[a().id];

  const saveName = () => {
    setEditing(false);
    if (name().trim() && name().trim() !== a().label) updateAccount(a().id, { label: name().trim() }).catch((e) => showToast(errMsg(e)));
  };

  return (
    <div class="acc-card" classList={{ working: s()?.active, off: noLogin() }} style={{ "--c": a().color }}>
      <div class="acc-top">
        <ProviderMark id={a().id} size={40} />
        <div class="acc-name">
          <Show
            when={editing()}
            fallback={
              <strong>
                <span class="acc-label">{a().label}</span>
                <button class="icon-btn tiny" title="Renomear" onClick={() => (setName(a().label), setEditing(true))}><Pencil size={11} /></button>
              </strong>
            }
          >
            <input class="name-input" value={name()} autofocus onInput={(e) => setName(e.currentTarget.value)} onBlur={saveName} onKeyDown={(e) => e.key === "Enter" && saveName()} />
          </Show>
          <small class="acc-sub">
            <span>{providers[a().provider].name}</span>
            <Show when={s()?.plan}><span class="acc-plan">{s()!.plan}</span></Show>
            <Show when={claude() && s()?.who}><span class="acc-email" title="Quem fez login nesta conta">{s()!.who}</span></Show>
          </small>
        </div>
        <span class={`acc-state st-${s()?.state ?? "checking"}`} classList={{ live: s()?.active }}>
          <Show when={s()} fallback={<><span class="spinner inline" /> verificando</>}>
            <i class="acc-dot" /> {s()!.active ? "trabalhando" : stateText[s()!.state]}
          </Show>
        </span>
      </div>

      <Show when={loggingIn()}>
        <LoginWait id={a().id} />
      </Show>

      <Show when={!loggingIn() && noLogin()}>
        <div class="acc-cta">
          <p>Ninguém entrou nesta conta ainda. Entre com a sua conta do Claude (Pro ou Max) pelo navegador.</p>
          <button class="primary-btn" onClick={() => startBrowserLogin(a())}><Globe size={14} /> Entrar pelo navegador</button>
        </div>
      </Show>

      <Show when={!noLogin() && s()?.detail && s()!.state !== "pronta"}>
        <p class="acc-detail">{s()!.detail}</p>
      </Show>

      <Show when={claude() && s() && !noLogin()}>
        <LimitBars id={a().id} />
      </Show>

      {/* Claude: uso real dos históricos */}
      <Show when={claude() && u() && u()!.lastActiveSecs !== null}>
        <div class="acc-usage">
          <div class="acc-usage-nums">
            <div><small>Hoje</small><b><CountUp value={u()!.today} format={fmtTokens} /></b></div>
            <div><small>7 dias</small><b><CountUp value={week()} format={fmtTokens} /></b></div>
            <div><small>Última vez</small><b class="soft">{fmtAgo(u()!.lastActiveSecs)}</b></div>
          </div>
          <div class="usage-bars" title={weekSays(u()!.days)}>
            <For each={u()!.days}>
              {(d, i) => (
                <div class="ubar-col" title={`${weekday(6 - i())}: ${fmtTokens(d)} tokens`}>
                  <span class="ubar" classList={{ today: i() === 6 }} style={{ height: `${Math.max(4, (d / maxDay()) * 100)}%`, "transition-delay": `${i() * 40}ms` }} />
                  <small>{i() === 6 ? "hoje" : weekday(6 - i())[0]}</small>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* APIs e Ollama */}
      <Show when={!claude()}>
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
        </dl>
      </Show>

      <Show when={(s()?.models.length ?? 0) > 0}>
        <label class="model-pick">
          <span>Modelo padrão</span>
          <select value={a().model ?? ""} onChange={(e) => updateAccount(a().id, { model: e.currentTarget.value }).catch((er) => showToast(errMsg(er)))}>
            <option value="">{claude() ? "o do Claude Code" : "automático"}</option>
            <For each={s()!.models}>{(m) => <option value={m}>{claude() ? prettyModel(m) : m}</option>}</For>
          </select>
        </label>
      </Show>

      <div class="acc-used">
        <small>Usada em</small>
        <For each={used()} fallback={<span class="muted">nenhum projeto ainda</span>}>{(p) => <span class="mini-chip">{p.name}</span>}</For>
        <Show when={settings.freeAccount === a().id}><span class="mini-chip">Chat livre</span></Show>
      </div>

      <div class="acc-foot">
        <div class="acc-actions">
          <Show when={claude() && !noLogin() && !loggingIn()}>
            <button class="ghost-btn small" title="Entra de novo pelo navegador (troca quem está logado nesta conta)" onClick={() => startBrowserLogin(a())}>
              <Globe size={12} /> Entrar de novo
            </button>
          </Show>
          <Show when={a().provider === "deepseek" || a().provider === "openai"}>
            <button class={a().keyHint ? "ghost-btn small" : "primary-btn small"} onClick={() => props.onKey(a())}>
              <KeyRound size={12} /> {a().keyHint ? "Trocar chave" : "Colar chave"}
            </button>
          </Show>
          <Show when={claude()}>
            <button class="icon-btn small" title="Abrir o Claude Code no terminal com esta conta" onClick={() => loginAccount(a().id).catch((e) => showToast(errMsg(e)))}>
              <SquareTerminal size={13} />
            </button>
            <Show when={a().dir}>
              <button class="icon-btn small" title={`Mostrar a pasta da conta: ${prettyPath(a().dir!)}`} onClick={() => api.reveal(a().dir!).catch((e) => showToast(errMsg(e)))}>
                <FolderOpen size={13} />
              </button>
            </Show>
          </Show>
          <button class="icon-btn small" title="Verificar de novo" onClick={() => checkAccount(a().id)}>
            <RefreshCw size={13} classList={{ spinning: accts.checking[a().id] }} />
          </button>
        </div>
        <button class="acc-remove" onClick={() => props.onRemove(a())}>
          <Trash2 size={12} /> Remover
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- adicionar

const kinds: { id: ProviderId; title: string; text: string }[] = [
  { id: "claude", title: "Claude", text: "Sua conta Pro ou Max. Entra pelo navegador, com histórico e limites próprios." },
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
      props.onClose();
      // conta nova do Claude: já abre o login no navegador
      if (kind() === "claude" && !folder()) startBrowserLogin(a);
      else showToast(`${a.label} adicionada`);
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
              <small class="hint">Ao adicionar, a página de login da Anthropic abre no navegador. O login fica no chaveiro do Mac: o Veocode não vê senha nem token.</small>
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
            <Show when={busy()} fallback={kind() === "claude" && !folder() ? <Globe size={14} /> : <Plus size={14} />}><span class="spinner inline" /></Show> {kind() === "claude" && !folder() ? "Adicionar e entrar" : "Adicionar"}
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
