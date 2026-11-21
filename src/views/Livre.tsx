import { AlertTriangle, ArrowUp, Ban, Check, ChevronDown, ChevronRight, FileSearch, FolderPlus, Globe, Lock, MessageSquarePlus, PanelRightClose, PanelRightOpen, Paperclip, Search, ShieldCheck, Sparkles, Square, SquarePen, Trash2, X } from "lucide-solid";
import { createEffect, createMemo, createResource, createSignal, For, Match, on, onCleanup, onMount, Show, Switch } from "solid-js";
import { accountById, accts } from "../accounts";
import { isTauri } from "../api";
import { settings } from "../settings";
import { answerLivre, compactLivre, continueLivre, freeAccount, freeAccountId, freeLevels, listLivre, livre, newLivre, openLivre, sendLivre, setFreeAccount, setFreeLevel, setLivre, stopLivre, type Item } from "../livre";
import { attsOf, dropPid, pasteFiles, pickFiles } from "../attachments";
import AttachBar from "../components/AttachBar";
import { SentThumbs } from "../components/Media";
import { deleteConvos, type Convo } from "../chat";
import { LIVRE } from "../livre";
import Markdown from "../components/Markdown";
import { LiveLine, LongText, latestPlan, PlanCard, WorkFold, type WorkStep } from "../components/Work";
import { ago, Tool } from "../components/ConvBar";
import { CACHE_TTL, fmtTokens, weightOf } from "../convTabs";
import MsgTools, { focusComposer } from "../components/MsgTools";
import { MicButton } from "../components/Mic";
import { LimitHitCard, UsageRing } from "../components/Limits";
import { AgentChipButton, AgentMenu, LevelChip, LevelMenu } from "../components/AgentMenu";
import { ContextChip } from "../components/ContextPanel";
import { ProjectIcon } from "../components/icons";
import { ProviderMark } from "../components/ui";
import { projectLive, shortAgo } from "../convList";
import { addProjectFromPicker, projects, setProjectId, setView } from "../store";
import { limitHit } from "../limits";
import { listeningTo, voiceKey } from "../voice";
import { lang, locale, tx } from "../i18n";

// ideias para começar: dúvidas gerais e perguntas sobre o computador, juntas
const ideas = [
  "Explique o que é uma API REST como se eu nunca tivesse programado",
  "Me ajude a escrever um e-mail pedindo um prazo maior",
  "O que tem na minha pasta Downloads?",
  "Resuma o arquivo de texto mais recente da Área de Trabalho",
];

// ---------------------------------------------------------------- painel da direita: aberto ou não

const read = (k: string, d: boolean) => {
  try {
    const v = localStorage.getItem(k);
    return v === null ? d : v === "1";
  } catch {
    return d;
  }
};
const write = (k: string, v: boolean) => {
  try {
    localStorage.setItem(k, v ? "1" : "0");
  } catch {
    /* só não lembra */
  }
};
const SIDE_KEY = "veocode.livre.side";
const PROJ_KEY = "veocode.livre.projects";
// janela larga: o painel fica ao lado (aberto por padrão, lembrado); estreita: gaveta por cima
const [wideOpen, setWideOpen] = createSignal(read(SIDE_KEY, true));
const [sheet, setSheet] = createSignal(false);
const narrowQ = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(max-width: 980px)") : null;
const [narrow, setNarrow] = createSignal(!!narrowQ?.matches);
narrowQ?.addEventListener("change", (e) => (setNarrow(e.matches), setSheet(false)));
const sideOpen = () => (narrow() ? sheet() : wideOpen());
const toggleSide = () => (narrow() ? setSheet(!sheet()) : (setWideOpen(!wideOpen()), write(SIDE_KEY, wideOpen())));
const doneInSheet = () => narrow() && setSheet(false);

/** Conversa vazia: a marca, uma linha sobre o que ela faz e ideias para começar. */
function Empty() {
  return (
    <div class="idle-hero livre-hero pop-in">
      <span class="idle-mark livre-mark" style={{ "--c": freeAccount().color }}>
        <Sparkles size={26} />
      </span>
      <h2>{tx("Pergunte o que quiser")}</h2>
      <p>{tx("Dúvidas rápidas sobre qualquer assunto, com {label}. Quando a pergunta for sobre o seu Mac, ela mesma olha os arquivos.", { label: freeAccount().label })}</p>
      <div class="livre-perks">
        <span><Globe size={12} /> {tx("Pesquisa na internet")}</span>
        <span><FileSearch size={12} /> {tx("Lê seus arquivos quando precisa")}</span>
        <span><Lock size={12} /> {tx("Senhas e chaves ficam de fora")}</span>
      </div>
      <div class="livre-ideas">
        <For each={ideas.map((x) => tx(x))}>
          {(t, i) => (
            <button class="livre-idea pop-in" style={{ "animation-delay": `${80 + i() * 60}ms` }} onClick={() => sendLivre(t)}>
              <MessageSquarePlus size={14} />
              <span>{t}</span>
            </button>
          )}
        </For>
      </div>
    </div>
  );
}

const clock = (at: number) => new Date(at).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** As mesmas mensagens do chat dos projetos: seu pedido num balão, a resposta em texto corrido, os passos numa linha. */
function Message(props: { item: Item }) {
  return (
    <Switch>
      <Match when={props.item.t === "user" && props.item}>
        {(it) => (
          <div class="bubble user pop-in">
            <LongText text={it().text} />
            <SentThumbs text={it().text} />
            <MsgTools text={it().text} onReuse={() => (setLivre("input", it().text), focusComposer(document.querySelector(".livre-composer")))} />
          </div>
        )}
      </Match>
      <Match when={props.item.t === "say" && props.item}>
        {(it) => (
          <Show
            when={limitHit(it().text)}
            fallback={
              <div class="bubble agent say md-bubble pop-in" style={{ "--c": accountById(it().account).color }}>
                <Markdown text={it().text} />
                <MsgTools text={it().text} />
              </div>
            }
          >
            {(h) => <LimitHitCard accountId={it().account} win={h().win} raw={h().raw} onPick={(id) => void setFreeAccount(id)} />}
          </Show>
        )}
      </Match>
      <Match when={props.item.t === "work" && (props.item as Item & { t: "work" })}>{(it) => <WorkFold steps={it().steps} />}</Match>
      <Match when={props.item.t === "done" && props.item}>
        {(it) => (
          <Show
            when={it().ok}
            fallback={<div class="done-line stopped pop-in" title={it().detail ?? undefined}><span>■</span> {tx("Você parou · {time}", { time: clock(it().at) })}</div>}
          >
            <div class="done-line pop-in" title={it().detail ?? undefined}><span>✓</span> {tx("{agent} terminou · {time}", { agent: accountById(it().account).label, time: clock(it().at) })}</div>
          </Show>
        )}
      </Match>
      <Match when={props.item.t === "note" && props.item}>{(it) => <div class="livre-note pop-in">{it().text}</div>}</Match>
    </Switch>
  );
}

// conversas anteriores agrupadas por quando foram usadas pela última vez
const DAY = 86_400_000;
const WHEN = ["Hoje", "Ontem", "Últimos 7 dias", "Últimos 30 dias", "Mais antigas"] as const;
const whenOf = (ms: number) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const t = today.getTime();
  return ms >= t ? 0 : ms >= t - DAY ? 1 : ms >= t - 7 * DAY ? 2 : ms >= t - 30 * DAY ? 3 : 4;
};

// relógio de 30 s para o "há quanto tempo" da lista
const [now, setNow] = createSignal(Date.now());
setInterval(() => setNow(Date.now()), 30_000);

/** Aviso em cima da caixa, igual ao dos projetos: conversa pesada ou parada há muito tempo (a próxima
 *  mensagem sai cara). Aqui não há abas nem memória de projeto: as saídas são outra conversa com um
 *  resumo desta ou compactar esta mesma. */
function EconomyHint() {
  const [hidden, setHidden] = createSignal<string | null>(null);
  const id = () => livre.conv?.id ?? "nova";
  const idle = () => (livre.lastAt ? now() - livre.lastAt : 0);
  const kind = () => {
    const n = livre.context ?? 0;
    if (livre.busy || !livre.items.length || hidden() === id() || n < 20_000) return null;
    if (idle() > CACHE_TTL) return "cold";
    if (weightOf(n) === "pesada") return "heavy";
    return null;
  };
  return (
    <Show when={kind()}>
      <div class="eco-hint pop-in" classList={{ cold: kind() === "cold" }}>
        <Sparkles size={14} />
        <span>
          <Show when={kind() === "cold"} fallback={<>{tx("Conversa pesada: cada mensagem manda")} <b>{fmtTokens(livre.context ?? 0)}</b> {tx("tokens de novo.")}</>}>
            {tx("Parada há {ago}: a próxima mensagem relê", { ago: ago(idle()) })} <b>{fmtTokens(livre.context ?? 0)}</b> {tx("tokens sem o desconto do cache.")}
          </Show>
        </span>
        <button class="primary-btn small" title={tx("Começa outra conversa com um resumo desta já na caixa")} onClick={() => void continueLivre()}>{tx("Nova com resumo")}</button>
        <button class="ghost-btn small" title={tx("Resume esta conversa aqui mesmo e libera espaço na janela da IA")} onClick={() => void compactLivre()}>{tx("Compactar")}</button>
        <button class="icon-btn small" title={tx("Continuar nesta mesmo")} onClick={() => setHidden(id())}><X size={12} /></button>
      </div>
    </Show>
  );
}

/** Painel da direita: conversa nova, busca, os projetos (um clique abre) e o histórico do Chat livre. */
function Side(props: { open: boolean }) {
  const [q, setQ] = createSignal("");
  const [data, { refetch }] = createResource(() => livre.listVer, () => listLivre().catch(() => ({ items: [] as Convo[], current: null })));
  const [opening, setOpening] = createSignal<string | null>(null);
  const [projOpen, setProjOpen] = createSignal(read(PROJ_KEY, true));
  const [allProj, setAllProj] = createSignal(false);
  const [shown, setShown] = createSignal(40);
  const list = () => data.latest?.items ?? [];
  const current = () => data.latest?.current ?? null;
  const groups = createMemo(() => {
    const t = q().trim().toLowerCase();
    const out: { when: number; items: Convo[] }[] = [];
    for (const c of list()) {
      if (t && !`${c.title} ${c.lastPrompt ?? ""}`.toLowerCase().includes(t)) continue;
      const w = whenOf(c.updated);
      const g = out.find((x) => x.when === w) ?? (out.push({ when: w, items: [] }), out[out.length - 1]);
      g.items.push(c);
    }
    return out;
  });
  // até onde mostrar (a lista pode ser longa): conta através dos grupos
  const cut = (gi: number) => groups().slice(0, gi).reduce((n, g) => n + g.items.length, 0);
  const total = () => groups().reduce((n, g) => n + g.items.length, 0);
  const projs = () => (allProj() ? projects : projects.slice(0, 6));
  const open = async (c: Convo) => {
    const key = `${c.kind}:${c.id}`;
    if (key === current()) return doneInSheet();
    setOpening(key);
    await openLivre(c);
    setOpening(null);
    doneInSheet();
  };
  const del = async (c: Convo) => (await deleteConvos(LIVRE, [c], current())) && refetch();
  const fresh = () => (void newLivre(), doneInSheet(), focusComposer(document.querySelector(".livre-composer")));

  return (
    <aside class="livre-side" aria-label={tx("Conversas e projetos")} aria-hidden={!props.open} ref={(el) => createEffect(() => (el.inert = !props.open))}>
      <div class="ls-inner">
        <div class="cv-top">
          <button class="cv-new" disabled={livre.busy} onClick={fresh} title={tx("Começar uma conversa nova (⌘N); a atual fica no histórico")}>
            <SquarePen size={14} />
            <span>{tx("Nova conversa")}</span>
            <kbd>⌘N</kbd>
          </button>
          <label class="cv-search">
            <Search size={13} />
            <input value={q()} placeholder={tx("Buscar conversas")} onInput={(e) => setQ(e.currentTarget.value)} onKeyDown={(e) => e.key === "Escape" && setQ("")} />
            <Show when={q()}><button class="cv-clear" title={tx("Limpar")} onClick={() => setQ("")}><X size={12} /></button></Show>
          </label>
        </div>

        <div class="cv-scroll ls-scroll">
          <Show when={!q().trim()}>
            <div class="cv-sec ls-sec">
              <button class="ls-sec-btn" aria-expanded={projOpen()} onClick={() => (setProjOpen(!projOpen()), write(PROJ_KEY, projOpen()))}>
                <span>{tx("Projetos")}</span>
                <ChevronDown size={11} class="ls-sec-chev" />
              </button>
              <button class="icon-btn small" title={tx("Adicionar pasta como projeto")} onClick={() => void addProjectFromPicker()}><FolderPlus size={13} /></button>
            </div>
            <Show when={projOpen()}>
              <div class="ls-projs slide-in">
                <For each={projs()}>
                  {(p) => {
                    const live = () => projectLive(p.id);
                    return (
                      <div
                        class="cv-row ls-proj"
                        role="button"
                        tabindex="0"
                        title={tx("Abrir o projeto {name}", { name: p.name })}
                        onClick={() => (setProjectId(p.id), setView("workspace"), doneInSheet())}
                        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLElement).click()}
                      >
                        <span class="ls-pico"><ProjectIcon id={p.id} name={p.name} stack={p.stack} size={16} /></span>
                        <span class="cv-title">{p.name}</span>
                        <span class="cv-meta">
                          <Show when={live().ask} fallback={<Show when={live().busy}><span class="spinner inline" title={tx("Trabalhando")} /></Show>}>
                            <i class="ls-ask" title={tx("Esperando você")} />
                          </Show>
                        </span>
                        <ChevronRight size={12} class="ls-go" />
                      </div>
                    );
                  }}
                </For>
                <Show when={projects.length > 6}>
                  <button class="cv-more-list" onClick={() => setAllProj(!allProj())}>
                    {allProj() ? tx("Mostrar menos") : tx("Mostrar todos ({n})", { n: projects.length })}
                  </button>
                </Show>
              </div>
            </Show>
          </Show>

          <div class="cv-sec ls-sec">
            <span>{tx("Histórico")}</span>
            <Show when={data.loading}><span class="spinner inline" /></Show>
          </div>
          <Show
            when={total()}
            fallback={
              <p class="cv-empty ls-empty">
                {q().trim() ? tx("Nenhuma conversa com “{q}”.", { q: q().trim() }) : isTauri ? tx("As conversas ficam guardadas aqui para você voltar nelas depois.") : tx("No navegador as conversas não ficam guardadas: abra o app.")}
              </p>
            }
          >
            <For each={groups()}>
              {(g, gi) => (
                <Show when={cut(gi()) < shown()}>
                  <div class="ls-when">{tx(WHEN[g.when])}</div>
                  <For each={g.items.slice(0, Math.max(0, shown() - cut(gi())))}>
                    {(c) => {
                      const key = `${c.kind}:${c.id}`;
                      const exists = () => accts.list.some((x) => x.id === c.account);
                      const on = () => current() === key;
                      return (
                        <div
                          class="cv-row ls-row"
                          classList={{ on: on(), locked: !exists() }}
                          role="button"
                          tabindex="0"
                          aria-current={on() ? "true" : undefined}
                          title={exists() ? (c.account === freeAccountId() ? tx(c.title) : tx("Continuar (troca para a conta {label})", { label: accountById(c.account).label })) : tx("A conta desta conversa não existe mais")}
                          onClick={() => exists() && !opening() && void open(c)}
                          onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLElement).click()}
                        >
                          <span class="cv-st">
                            <Show when={opening() === key} fallback={<Show when={on() && livre.busy} fallback={<i class="cv-dot" />}><span class="spinner inline" /></Show>}>
                              <span class="spinner inline" />
                            </Show>
                          </span>
                          <span class="cv-title">{tx(c.title)}</span>
                          <Show when={c.account !== freeAccountId()}><ProviderMark id={c.account} size={13} /></Show>
                          <span class="cv-meta"><small class="cv-time">{shortAgo(c.updated, now(), lang())}</small></span>
                          <button class="cv-more" disabled={livre.busy && on()} title={tx("Apagar esta conversa (vai para a Lixeira)")} aria-label={tx("Apagar esta conversa")} onClick={(e) => (e.stopPropagation(), void del(c))}>
                            <Trash2 size={12} />
                          </button>
                        </div>
                      );
                    }}
                  </For>
                </Show>
              )}
            </For>
            <Show when={total() > shown()}>
              <button class="cv-more-list" onClick={() => setShown(shown() + 40)}>{tx("Mostrar mais ({n})", { n: total() - shown() })}</button>
            </Show>
          </Show>
        </div>

        <div class="ls-foot">
          <Lock size={11} />
          <span>{tx("Ela só abre seus arquivos quando a pergunta pede. Senhas e chaves ficam sempre de fora.")}</span>
        </div>
      </div>
    </aside>
  );
}

export default function Livre() {
  const [menu, setMenu] = createSignal(false);
  const [levelMenu, setLevelMenu] = createSignal(false);
  let agentBtn: HTMLButtonElement | undefined;
  let levelBtn: HTMLButtonElement | undefined;
  let scroller!: HTMLDivElement;
  let box!: HTMLTextAreaElement;
  let stick = true;

  const fit = () => {
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, 160)}px`;
  };
  // texto que chega pelo ditado (ou é limpo ao enviar) também ajusta a altura da caixa
  createEffect(on(() => livre.input, () => box && requestAnimationFrame(fit), { defer: true }));
  const send = () => {
    stick = true;
    sendLivre();
    requestAnimationFrame(fit);
  };
  // desce junto com a resposta, a não ser que a pessoa tenha subido para ler
  createEffect(on(() => [livre.items.length, livre.draft.length, livre.perms.length, livre.error], () => {
    if (stick) requestAnimationFrame(() => scroller && (scroller.scrollTop = scroller.scrollHeight));
  }));
  // outra conversa aberta (ou uma nova): começa de baixo e com a caixa pronta
  createEffect(on(() => livre.conv?.id, () => ((stick = true), box?.focus()), { defer: true }));
  onMount(() => box.focus());
  onCleanup(() => setSheet(false));

  // o pedido em curso: o que veio depois da sua última mensagem (para a lista de tarefas e a linha viva)
  const turn = createMemo(() => {
    let i = livre.items.length - 1;
    while (i >= 0 && livre.items[i].t !== "user") i--;
    const steps: WorkStep[] = [];
    for (const it of livre.items.slice(i + 1)) if (it.t === "work") steps.push(...it.steps);
    const u = livre.items[i];
    return { since: u?.t === "user" ? u.at : undefined, steps };
  });
  const plan = createMemo(() => latestPlan(livre.items.flatMap((it): WorkStep[] => (it.t === "work" ? it.steps : it.t === "user" ? [{ id: it.key, kind: "user", title: "", status: "ok" }] : []))));
  const runningStep = () => [...turn().steps].reverse().find((x) => x.status === "running");

  const a = freeAccount;
  const level = () => freeLevels[Math.min(3, Math.max(0, settings.freeLevel ?? 0))];
  // conversa nova: o título é a primeira pergunta, igual ao que aparece no histórico
  const asked = () => livre.items.find((it) => it.t === "user");
  const title = () => {
    const u = asked();
    return livre.conv?.title ?? (u && u.t === "user" ? u.text.split("\n")[0].slice(0, 70) || tx("Conversa nova") : tx("Chat livre"));
  };
  return (
    <div class="livre-shell" classList={{ "side-on": sideOpen(), "side-sheet": narrow() }}>
      <div class="livre">
        <header class="conv-bar slim livre-bar">
          <div class="conv-now">
            <i class="conv-dot" classList={{ busy: livre.busy, ask: livre.perms.length > 0, err: !!livre.error }} />
            <strong title={title()}>{tx(title())}</strong>
            <Show when={livre.busy || livre.perms.length}>
              <small>{livre.perms.length ? tx("esperando você") : tx("trabalhando")}</small>
            </Show>
          </div>
          <div class="conv-tools">
            <Show when={!sideOpen()}>
              <Tool icon={SquarePen} name={tx("Nova conversa")} hint={tx("Começa do zero (⌘N); esta fica no histórico")} disabled={livre.busy || (!livre.items.length && !livre.conv)} onClick={() => void newLivre()} />
            </Show>
            <Tool
              icon={sideOpen() ? PanelRightClose : PanelRightOpen}
              name={sideOpen() ? tx("Esconder o painel") : tx("Mostrar o painel")}
              hint={tx("Conversa nova, projetos e histórico")}
              on={sideOpen()}
              onClick={toggleSide}
            />
          </div>
        </header>

        <div class="livre-scroll" ref={scroller} onScroll={() => (stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80)}>
          <div class="livre-col" classList={{ empty: !livre.items.length }}>
            <Show when={livre.items.length} fallback={<Empty />}>
              <For each={livre.items}>{(it) => <Message item={it} />}</For>
            </Show>
            <Show when={plan()}>{(t) => <PlanCard todos={t()} color={a().color} live={livre.busy} />}</Show>
            <Show when={livre.busy && !livre.perms.length}>
              <Show when={livre.draft}>
                <div class="bubble agent say streaming" style={{ "--c": a().color }}>{livre.draft.replace(/\*\*/g, "")}</div>
              </Show>
              <LiveLine color={a().color} step={livre.draft ? null : runningStep()} writing={!!livre.draft} since={turn().since} onStop={() => void stopLivre()} />
            </Show>
            <For each={livre.perms}>
              {(q) => (
                <div class="perm-ask pop-in" style={{ "--c": a().color }}>
                  <div class="perm-ask-head">
                    <ShieldCheck size={14} />
                    <span>{tx("Precisa da sua aprovação")}</span>
                    <small>{q.tool}</small>
                  </div>
                  <strong>{q.title}</strong>
                  <Show when={q.detail}><pre>{q.detail}</pre></Show>
                  <div class="perm-ask-actions">
                    <button class="ghost-btn" disabled={q.answering} onClick={() => answerLivre(q.requestId, false)}><Ban size={13} /> {tx("Recusar")}</button>
                    <button class="primary-btn small" disabled={q.answering} onClick={() => answerLivre(q.requestId, true)}><Check size={13} /> {tx("Permitir")}</button>
                  </div>
                </div>
              )}
            </For>
            <Show when={livre.error}>
              <div class="bubble chat-error pop-in">
                <AlertTriangle size={14} />
                <span>{livre.error}</span>
                <button class="icon-btn small" title={tx("Fechar")} onClick={() => setLivre("error", null)}><X size={12} /></button>
              </div>
            </Show>
          </div>
        </div>

        <div class="livre-bottom">
          <div class="livre-col">
            <Show when={a().provider === "claude"}><EconomyHint /></Show>
            <div class="composer livre-composer" classList={{ busy: livre.busy, listening: listeningTo(LIVRE), dropping: dropPid() === LIVRE }} style={{ "--c": a().color }} data-attach-pid={LIVRE}>
              <AttachBar pid={LIVRE} />
              <textarea
                onPaste={(e) => void pasteFiles(LIVRE, e)}
                ref={box}
                rows={2}
                value={livre.input}
                readOnly={listeningTo(LIVRE)}
                placeholder={listeningTo(LIVRE) ? tx("Pode falar… (Enter para, Esc cancela)") : tx("Pergunte qualquer coisa a {label}… (Enter envia, ⌥ Espaço para falar)", { label: a().label })}
                onInput={(e) => {
                  setLivre("input", e.currentTarget.value);
                  fit();
                }}
                onKeyDown={(e) => {
                  if (voiceKey(LIVRE, e)) return;
                  if (e.key === "Escape" && livre.busy) return (e.preventDefault(), void stopLivre());
                  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
                    e.preventDefault();
                    if (!livre.busy) send();
                  }
                }}
              />
              <div class="composer-bar">
                <button class="icon-btn" classList={{ on: attsOf(LIVRE).length > 0 }} title={tx("Anexar arquivos ou imagens (ou cole com ⌘V, ou arraste do Finder)")} onClick={() => void pickFiles(LIVRE)}>
                  <Paperclip size={14} />
                </button>
                <AgentChipButton prefKey={LIVRE} accountId={a().id} open={menu()} btnRef={(el) => (agentBtn = el)} disabled={livre.busy} title={livre.busy ? tx("Espere a resposta terminar para trocar") : tx("Conta, modelo e força do raciocínio do Chat livre")} onClick={() => (setLevelMenu(false), setMenu(!menu()))} />
                <LevelChip
                  level={level()}
                  label={level().name}
                  open={levelMenu()}
                  btnRef={(el) => (levelBtn = el)}
                  disabled={livre.busy}
                  title={livre.busy ? tx("Espere a resposta terminar para trocar") : tx("Permissão: o que a IA pode fazer no seu computador (clique para mudar)")}
                  onClick={() => (setMenu(false), setLevelMenu(!levelMenu()))}
                />
                <Show when={a().provider === "claude"}>
                  <ContextChip k={LIVRE} />
                </Show>
                <span class="composer-gap" />
                <UsageRing id={freeAccountId()} />
                <MicButton target={LIVRE} />
                <Show
                  when={livre.busy}
                  fallback={
                    <button class="send-btn" title={tx("Enviar (Enter)")} disabled={!livre.input.trim() && !attsOf(LIVRE).length} onClick={send}>
                      <ArrowUp size={16} stroke-width={2.4} />
                    </button>
                  }
                >
                  <button class="send-btn stop" title={tx("Parar (Esc)")} onClick={() => stopLivre()}>
                    <Square size={11} fill="currentColor" />
                  </button>
                </Show>
              </div>
              <Show when={menu()}>
                <AgentMenu anchor={agentBtn} prefKey={LIVRE} accountId={a().id} title={tx("Conta no Chat livre")} onPick={(id) => void setFreeAccount(id)} onClose={() => setMenu(false)} />
              </Show>
              <Show when={levelMenu()}>
                <LevelMenu
                  anchor={levelBtn}
                  title={tx("Permissão no Chat livre")}
                  levels={freeLevels}
                  current={settings.freeLevel}
                  note={tx("Em qualquer nível, pastas de senhas e chaves (.ssh, .aws, chaveiro) ficam de fora.")}
                  onPick={(i) => void setFreeLevel(i)}
                  onClose={() => setLevelMenu(false)}
                />
              </Show>
            </div>
          </div>
        </div>
      </div>

      <Show when={narrow() && sideOpen()}>
        <div class="livre-scrim" onClick={() => setSheet(false)} />
      </Show>
      <Side open={sideOpen()} />
    </div>
  );
}
