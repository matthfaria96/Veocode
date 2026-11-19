// Cofre na tela Contas: chaves de API e logins guardados uma vez, usados por todos os projetos.
import { Copy, Eye, EyeOff, Globe, KeyRound, Lock, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-solid";
import { createSignal, For, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { confirmAction } from "../dialogs";
import { projects } from "../store";
import { copyVault, deleteVault, envNames, loadVault, presets, saveVault, vault, type VaultItem, type VaultKind } from "../vault";
import { ProjectIcon } from "./icons";
import { tx } from "../i18n";

type Draft = { id?: string; name: string; kind: VaultKind; env: string; user: string; site: string; projects: string[]; hint?: string };

export default function Vault() {
  const [editing, setEditing] = createSignal<Draft | null>(null);
  onMount(() => !vault.loaded && void loadVault());

  const fromPreset = (p: (typeof presets)[number]) =>
    setEditing({ name: p.kind === "chave" ? p.label : "", kind: p.kind, env: p.env, user: "", site: "", projects: [], hint: p.hint });
  const edit = (it: VaultItem) =>
    setEditing({ id: it.id, name: it.name, kind: it.kind, env: it.env ?? "", user: it.user ?? "", site: it.site ?? "", projects: [...it.projects], hint: it.hint });
  const remove = async (it: VaultItem) => {
    const ok = await confirmAction(
      tx("Apagar “{name}” do cofre?", { name: it.name }),
      tx("O segredo sai do Chaveiro do macOS e os projetos deixam de recebê-lo. Não dá para desfazer; se precisar de novo, cole outra vez."),
      tx("Apagar"),
      true,
    );
    if (ok) await deleteVault(it);
  };
  const scope = (it: VaultItem) => {
    if (!it.projects.length) return tx("todos os projetos");
    const names = it.projects.map((id) => projects.find((p) => p.id === id)?.name).filter(Boolean);
    return names.length ? names.join(", ") : tx("projeto removido");
  };

  return (
    <section class="vault">
      <div class="vault-head">
        <span class="vault-badge"><Lock size={18} /></span>
        <div>
          <h2>{tx("Cofre de chaves e senhas")}</h2>
          <p>{tx("Guarde uma vez e pronto: os projetos recebem as chaves sozinhos e a IA para de pedir. Tudo fica no Chaveiro do macOS; a IA só fica sabendo o")} <b>{tx("nome")}</b> {tx("da variável, nunca o valor.")}</p>
        </div>
      </div>

      <div class="vault-presets">
        <For each={presets}>
          {(p, i) => (
            <button class="vault-preset" style={{ "--k": p.color, "--i": i() }} onClick={() => fromPreset(p)}>
              <Plus size={12} /> {p.label}
            </button>
          )}
        </For>
      </div>

      <Show
        when={vault.items.length}
        fallback={
          <div class="vault-empty">
            <ShieldCheck size={22} />
            <strong>{tx("Nada guardado ainda")}</strong>
            <span>{tx("Clique num serviço acima, cole a chave e ela passa a valer em todos os projetos.")}</span>
          </div>
        }
      >
        <div class="vault-list">
          <For each={[...vault.items].sort((a, b) => a.name.localeCompare(b.name))}>
            {(it, i) => (
              <div class="vault-item" style={{ "--i": i() }}>
                <span class={`vault-kind ${it.kind}`}>{it.kind === "login" ? <Globe size={15} /> : <KeyRound size={15} />}</span>
                <div class="vault-info">
                  <strong>{it.name}</strong>
                  <small>
                    <Show when={it.kind === "login" && it.user}>{it.user} · </Show>
                    <Show when={it.site}>{it.site} · </Show>
                    {tx("vale em {v}", { v: scope(it) })}
                  </small>
                </div>
                <div class="vault-envs">
                  <For each={envNames(it)} fallback={<span class="vault-noenv">{tx("só para copiar")}</span>}>{(n) => <code>{n}</code>}</For>
                </div>
                <span class="vault-hint">{it.hint}</span>
                <span class="vault-actions">
                  <button class="icon-btn" title={it.kind === "login" ? tx("Copiar a senha") : tx("Copiar a chave")} onClick={() => void copyVault(it)}><Copy size={13} /></button>
                  <button class="icon-btn" title={tx("Editar")} onClick={() => edit(it)}><Pencil size={13} /></button>
                  <button class="icon-btn danger" title={tx("Apagar do cofre")} onClick={() => void remove(it)}><Trash2 size={13} /></button>
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={editing()}>{(d) => <Portal><VaultDialog draft={d()} onClose={() => setEditing(null)} /></Portal>}</Show>
    </section>
  );
}

function VaultDialog(props: { draft: Draft; onClose: () => void }) {
  const [d, setD] = createSignal<Draft>({ ...props.draft });
  const [secret, setSecret] = createSignal("");
  const [show, setShow] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const isNew = !props.draft.id;
  const set = (k: keyof Draft, v: unknown) => setD((x) => ({ ...x, [k]: v }));
  const real = () => projects.filter((p) => !p.demo);
  const toggleProject = (id: string) => set("projects", d().projects.includes(id) ? d().projects.filter((x) => x !== id) : [...d().projects, id]);
  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    const x = d();
    const ok = await saveVault(
      { id: x.id, name: x.name, kind: x.kind, env: x.env.trim() || null, user: x.kind === "login" ? x.user.trim() || null : null, site: x.kind === "login" ? x.site.trim() || null : null, projects: x.projects },
      secret(),
    );
    setBusy(false);
    if (ok) {
      setSecret("");
      props.onClose();
    }
  };
  const envPreview = () => (d().env.trim() ? (d().kind === "login" ? tx("{toUpperCase}_USER e {toUpperCase}_PASSWORD", { toUpperCase: d().env.trim().toUpperCase() }) : d().env.trim().toUpperCase()) : "");

  return (
    <div class="palette-backdrop" onClick={props.onClose}>
      <form class="dialog vault-dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit} onKeyDown={(e) => e.key === "Escape" && props.onClose()} autocomplete="off">
        <h3>{isNew ? tx("Guardar no cofre") : tx("Editar {name}", { name: props.draft.name })}</h3>
        <div class="seg three vault-seg">
          <button type="button" classList={{ active: d().kind === "chave" }} onClick={() => set("kind", "chave")}>{tx("Chave de API")}</button>
          <button type="button" classList={{ active: d().kind === "login" }} onClick={() => set("kind", "login")}>{tx("Login de site")}</button>
          <button type="button" classList={{ active: d().kind === "outro" }} onClick={() => set("kind", "outro")}>{tx("Outro")}</button>
          <span class="seg-thumb" style={{ transform: `translateX(${d().kind === "chave" ? 0 : d().kind === "login" ? 100 : 200}%)` }} />
        </div>
        <label class="vf">
          <span>{tx("Nome")}</span>
          <input value={d().name} placeholder={d().kind === "login" ? tx("Painel da loja") : tx("OpenAI pessoal")} autofocus onInput={(e) => set("name", e.currentTarget.value)} />
        </label>
        <Show when={d().kind === "login"}>
          <div class="vf-row">
            <label class="vf"><span>{tx("Site")}</span><input value={d().site} placeholder="loja.exemplo.com" onInput={(e) => set("site", e.currentTarget.value)} /></label>
            <label class="vf"><span>{tx("Usuário ou e-mail")}</span><input value={d().user} placeholder={tx("voce@exemplo.com")} onInput={(e) => set("user", e.currentTarget.value)} /></label>
          </div>
        </Show>
        <label class="vf">
          <span>{d().kind === "login" ? tx("Senha") : d().kind === "chave" ? tx("Chave") : tx("Valor")}</span>
          <div class="vf-secret">
            <input
              type={show() ? "text" : "password"}
              value={secret()}
              placeholder={isNew ? props.draft.hint ?? "" : tx("deixe vazio para manter ({v})", { v: props.draft.hint ?? "atual" })}
              autocomplete="new-password"
              spellcheck={false}
              onInput={(e) => setSecret(e.currentTarget.value)}
            />
            <button type="button" class="icon-btn" title={show() ? tx("Esconder") : tx("Mostrar")} onClick={() => setShow(!show())}>{show() ? <EyeOff size={14} /> : <Eye size={14} />}</button>
          </div>
        </label>
        <label class="vf">
          <span>{tx("Nome da variável")} <small>{tx("(opcional: sem ela, fica só para você copiar)")}</small></span>
          <input class="mono" value={d().env} placeholder={d().kind === "login" ? "LOJA" : "OPENAI_API_KEY"} onInput={(e) => set("env", e.currentTarget.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))} />
          <Show when={envPreview()}><small class="hint">{tx("Os projetos recebem")} <code>{envPreview()}</code>.</small></Show>
        </label>
        <div class="vf">
          <span>{tx("Vale em")}</span>
          <div class="vf-projects">
            <button type="button" class="vf-chip" classList={{ on: !d().projects.length }} onClick={() => set("projects", [])}>{tx("Todos os projetos")}</button>
            <For each={real()}>
              {(p) => (
                <button type="button" class="vf-chip" classList={{ on: d().projects.includes(p.id) }} onClick={() => toggleProject(p.id)}>
                  <ProjectIcon id={p.id} name={p.name} stack={p.stack} size={13} /> {p.name}
                </button>
              )}
            </For>
          </div>
        </div>
        <div class="dialog-actions">
          <button type="button" class="ghost-btn" onClick={props.onClose}>{tx("Cancelar")}</button>
          <button type="submit" class="primary-btn" disabled={busy() || !d().name.trim() || (isNew && !secret().trim())}>
            <Lock size={13} /> {isNew ? tx("Guardar") : tx("Salvar")}
          </button>
        </div>
      </form>
    </div>
  );
}
