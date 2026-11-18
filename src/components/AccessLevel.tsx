import { AlertTriangle, Ban, Check, ChevronDown, ChevronRight, CircleHelp, FileCode2, FolderOpen, ShieldCheck, ShieldOff, TerminalSquare, Undo2 } from "lucide-solid";
import { createEffect, createSignal, For, Match, on, Show, Switch } from "solid-js";
import { accessLevels } from "../data/mock";
import { acc, applyAccess, loadAccess, modeText, openClaude, removeAccess, ruleText, setCap, setLevel, type Rule } from "../access";
import { accountById, providers } from "../accounts";
import { api, isTauri, prettyPath } from "../api";
import { projects, showToast } from "../store";
import ConfirmDialog from "./ConfirmDialog";

const ruleIcon = { permitido: Check, pergunta: CircleHelp, bloqueado: Ban } as const;
const order: Rule[] = ["permitido", "pergunta", "bloqueado"];

/** Nível de acesso de um projeto: régua, o que cada coisa vira no Claude Code e o arquivo gravado. */
export default function AccessLevel(props: { projectId: string }) {
  const project = () => projects.find((p) => p.id === props.projectId)!;
  const report = () => acc.reports[props.projectId];
  const busy = () => !!acc.busy[props.projectId];
  const lvl = () => accessLevels[project().access];
  const account = () => accountById(project().accountId);
  const isClaude = () => account().provider === "claude";
  const real = () => isTauri && !project().demo;
  const state = () => report()?.fileState.state;

  const [showPreview, setShowPreview] = createSignal(false);
  const [showOwn, setShowOwn] = createSignal(false);
  const [confirmRemove, setConfirmRemove] = createSignal(false);

  createEffect(on(() => props.projectId, (id) => loadAccess(id)));

  const pick = (cap: string, r: Rule, from: Rule) => setCap(props.projectId, cap, r === from ? null : r);

  return (
    <div class="access">
      <div class="access-scale" style={{ "--c": lvl().color, "--i": project().access }}>
        <span class="access-thumb" />
        <For each={accessLevels}>
          {(l) => (
            <button
              class="access-step"
              classList={{ active: l.id === project().access, passed: l.id < project().access }}
              disabled={busy()}
              onClick={() => l.id !== project().access && setLevel(props.projectId, l.id)}
            >
              {l.short}
            </button>
          )}
        </For>
      </div>

      <div class="access-desc" style={{ "--c": lvl().color }}>
        <ShieldCheck size={16} />
        <div>
          <strong>{lvl().name}</strong>
          <span>{lvl().description}</span>
          <Show when={report()}>
            <small class="mode-chip">Claude começa em: {modeText[report()!.mode] ?? report()!.mode}</small>
          </Show>
        </div>
      </div>

      {/* ---------------- vale de verdade? */}
      <Show when={real()} fallback={<div class="file-card demo"><FileCode2 size={15} /><div><strong>Projeto de demonstração</strong><span>Mexa à vontade: aqui nada é gravado. Num projeto real, o nível vira regras que o Claude Code obedece.</span></div></div>}>
        <Switch>
          <Match when={state() === "naoAplicado"}>
            <div class="file-card pending pop-in">
              <ShieldOff size={15} />
              <div>
                <strong>Ainda não vale de verdade</strong>
                <span>Grave as regras em <code>.claude/settings.local.json</code> e o Claude Code passa a obedecer este nível nesta pasta. Suas regras no arquivo continuam lá.</span>
                <div class="file-actions">
                  <button class="primary-btn small" disabled={busy()} onClick={() => applyAccess(props.projectId)}>Gravar no projeto</button>
                  <button class="link-btn" onClick={() => setShowPreview(!showPreview())}>{showPreview() ? "Esconder" : "Ver o que será gravado"}</button>
                </div>
              </div>
            </div>
          </Match>
          <Match when={state() === "aplicado"}>
            <div class="file-card ok pop-in">
              <ShieldCheck size={15} />
              <div>
                <strong>Valendo no Claude Code</strong>
                <span class="mono-path" title={report()!.file}>{prettyPath(report()!.file)}</span>
                <Show when={!isClaude()}>
                  <span class="warn-text">{account().label} ({providers[account().provider].name}) não lê esse arquivo: para ele, o nível vale pelas ferramentas do chat do Veocode.</span>
                </Show>
              </div>
            </div>
          </Match>
          <Match when={report()?.fileState.state === "alterado" && report()!.fileState}>
            {(fs) => (
              <div class="file-card changed pop-in">
                <AlertTriangle size={15} />
                <div>
                  <strong>O arquivo foi mexido fora do Veocode</strong>
                  <span>Faltam {(fs() as { missing: string[] }).missing.length} regra(s) deste nível:</span>
                  <ul class="rule-list">
                    <For each={(fs() as { missing: string[] }).missing.slice(0, 6)}>{(m) => <li><code>{m}</code></li>}</For>
                  </ul>
                  <div class="file-actions">
                    <button class="primary-btn small" disabled={busy()} onClick={() => applyAccess(props.projectId)}>Gravar de novo</button>
                  </div>
                </div>
              </div>
            )}
          </Match>
          <Match when={report()?.fileState.state === "erro" && report()!.fileState}>
            {(fs) => (
              <div class="file-card changed pop-in">
                <AlertTriangle size={15} />
                <div>
                  <strong>Não deu para ler o arquivo</strong>
                  <span>{(fs() as { message: string }).message}</span>
                </div>
              </div>
            )}
          </Match>
        </Switch>
      </Show>

      {/* ---------------- capacidades */}
      <div class="perm-list">
        <div class="perm fixed">
          <div class="perm-text">
            <span>Ler arquivos do projeto</span>
            <small>sempre, dentro da pasta</small>
          </div>
          <span class="rule-tag permitido"><Check size={11} /> Permitido</span>
        </div>
        <For each={report()?.caps ?? []}>
          {(c) => (
            <div class="perm" classList={{ [c.rule]: true, tuned: c.rule !== c.fromLevel }}>
              <div class="perm-text">
                <span>
                  {c.label}
                  <Show when={c.rule !== c.fromLevel}>
                    <button class="tuned-tag" title={`Voltar ao padrão do nível (${ruleText[c.fromLevel]})`} onClick={() => setCap(props.projectId, c.id, null)}>
                      ajustado <Undo2 size={10} />
                    </button>
                  </Show>
                </span>
                <small>{c.hint}</small>
              </div>
              <div class="rule-seg" style={{ "--n": c.choices.length, "--k": c.choices.indexOf(c.rule) }} data-rule={c.rule}>
                <span class="rule-thumb" />
                <For each={order.filter((r) => c.choices.includes(r))}>
                  {(r) => {
                    const Icon = ruleIcon[r];
                    return (
                      <button classList={{ active: c.rule === r }} title={ruleText[r]} disabled={busy()} onClick={() => c.rule !== r && pick(c.id, r, c.fromLevel)}>
                        <Icon size={12} />
                      </button>
                    );
                  }}
                </For>
              </div>
            </div>
          )}
        </For>
      </div>

      {/* ---------------- avisos */}
      <Show when={real() && report()?.loosen.length}>
        <div class="loosen pop-in">
          <div class="loosen-head"><AlertTriangle size={13} /> Regras de fora que deixam passar sem perguntar</div>
          <For each={report()!.loosen}>
            {(l) => (
              <div class="loosen-row">
                <code>{l.rule}</code>
                <small>em {l.source}</small>
              </div>
            )}
          </For>
          <small class="loosen-foot">O que estiver Bloqueado continua bloqueado: bloqueio sempre vence. Essas regras só pulam a pergunta.</small>
        </div>
      </Show>

      <Show when={real() && report()?.ownRules.length}>
        <button class="fold-btn" onClick={() => setShowOwn(!showOwn())}>
          {showOwn() ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Suas regras neste arquivo <small>{report()!.ownRules.length} · o Veocode não mexe</small>
        </button>
        <Show when={showOwn()}>
          <ul class="rule-list boxed">
            <For each={report()!.ownRules}>{(r) => <li><code>{r}</code></li>}</For>
          </ul>
        </Show>
      </Show>

      <Show when={report() && (showPreview() || state() === "aplicado" || state() === "alterado" || !real())}>
        <button class="fold-btn" onClick={() => setShowPreview(!showPreview())}>
          {showPreview() ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Regras que o Veocode grava
        </button>
      </Show>
      <Show when={showPreview() && report()}>
        <pre class="rules-preview slide-in">{report()!.preview}</pre>
      </Show>

      {/* ---------------- ações */}
      <Show when={real()}>
        <div class="access-actions">
          <button class="ghost-btn" disabled={!isClaude()} title={isClaude() ? "Abre o Terminal com o Claude Code nesta pasta, usando a conta do projeto" : "Só para contas do Claude"} onClick={() => openClaude(props.projectId)}>
            <TerminalSquare size={14} /> Abrir o Claude aqui
          </button>
          <Show when={state() === "aplicado" || state() === "alterado"}>
            <button class="icon-btn" title="Mostrar o arquivo" onClick={() => api.reveal(report()!.file).catch((e) => showToast(String(e)))}>
              <FolderOpen size={14} />
            </button>
            <button class="icon-btn" title="Tirar as regras do Veocode deste projeto" onClick={() => setConfirmRemove(true)}>
              <Undo2 size={14} />
            </button>
          </Show>
        </div>
      </Show>

      <Show when={confirmRemove()}>
        <ConfirmDialog
          title="Tirar as regras do Veocode?"
          confirmLabel="Tirar regras"
          onCancel={() => setConfirmRemove(false)}
          onConfirm={() => {
            setConfirmRemove(false);
            removeAccess(props.projectId);
          }}
        >
          <p>O Veocode apaga do arquivo só o que ele mesmo gravou e devolve o modo que estava antes. As suas regras ficam.</p>
          <p class="muted">Depois disso o Claude Code volta a seguir só as configurações normais dele nesta pasta.</p>
        </ConfirmDialog>
      </Show>
    </div>
  );
}
