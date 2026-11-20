// Aba Ambiente (modo Código, painel da direita): os perfis do .env e os serviços do projeto.
// Um clique troca qual opção de uma variável vale (banco local, de teste, de homologação…) e os
// serviços que leem aquele .env reiniciam sozinhos. Cada serviço roda num terminal do projeto.
import { Check, Database, Ellipsis, FileKey, Globe, KeyRound, Pencil, Play, Plus, RefreshCw, RotateCw, Server, SlidersHorizontal, Square, SquareTerminal, Trash2, Undo2 } from "lucide-solid";
import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import { api, isTauri } from "../api";
import {
  autoRestart,
  envOf,
  envs,
  isCustom,
  loadEnv,
  loadPorts,
  loadServices,
  portsOfTerm,
  restartService,
  runningCount,
  saveServices,
  serviceKey,
  servicesOf,
  setAutoRestart,
  showServiceTerm,
  startAll,
  startService,
  stopAll,
  stopService,
  switchEnv,
  termOfService,
  vaultOverrides,
  type EnvFile,
  type EnvGroup,
  type Service,
} from "../envs";
import { every } from "../every";
import { setContextMenu, type MenuEntry } from "../fileActions";
import { openRealFile } from "../realProject";
import { currentProject, openFile } from "../store";
import { syncTermList } from "../terminal";
import { loadVault, vault } from "../vault";
import { Section } from "./GitPanel";
import { tx, txn } from "../i18n";

/** Nome curto de um grupo: a variável, ou o começo comum de um bloco (DB_HOST, DB_USER → DB_*). */
function keyLabel(keys: string[]) {
  if (keys.length === 1) return keys[0];
  const first = keys[0];
  let n = 0;
  while (n < first.length && keys.every((k) => k[n] === first[n])) n++;
  const cut = first.slice(0, n).lastIndexOf("_");
  return cut >= 1 ? `${first.slice(0, cut + 1)}*` : `${first} +${keys.length - 1}`;
}

function GroupIcon(props: { keys: string[] }) {
  const k = () => props.keys.join(" ").toUpperCase();
  return (
    <Show when={/DATABASE|(^|_| )DB(_| |$)|POSTGRES|MYSQL|MARIA|MONGO|REDIS|SQL|SUPABASE/.test(k())} fallback={
      <Show when={/KEY|TOKEN|SECRET|PASSWORD|PASS(_|$)/.test(k())} fallback={
        <Show when={/URL|URI|HOST|API|ENDPOINT|DOMAIN/.test(k())} fallback={<SlidersHorizontal size={12} />}><Globe size={12} /></Show>
      }><KeyRound size={12} /></Show>
    }><Database size={12} /></Show>
  );
}

function Group(props: { pid: string; file: EnvFile; g: EnvGroup }) {
  const busy = () => !!envs.busy[props.g.id];
  const fromVault = () => vaultOverrides(props.pid, props.g.keys);
  return (
    <div class="env-group" classList={{ busy: busy() }}>
      <div class="env-group-head" title={props.g.keys.join(", ")}>
        <GroupIcon keys={props.g.keys} />
        <span class="env-key">{keyLabel(props.g.keys)}</span>
        <Show when={busy()}><span class="spinner tiny" /></Show>
      </div>
      <For each={props.g.options}>
        {(o) => (
          <button
            class="env-opt"
            classList={{ on: o.active, remote: o.remote, prod: o.prod }}
            disabled={busy()}
            onClick={() => void switchEnv(props.pid, props.file, props.g, o)}
            title={o.active ? tx("{label} está valendo agora", { label: o.label }) : tx("Usar {label} (as outras opções desta variável ficam comentadas no {file})", { label: o.label, file: props.file.path })}
          >
            <span class="env-radio">
              <Show when={o.active}><Check size={9} stroke-width={3.2} /></Show>
            </span>
            <span class="env-opt-label">{o.label}</span>
            <Show when={o.hint && o.hint !== o.label}><span class="env-opt-hint">{o.hint}</span></Show>
            <Show when={o.prod} fallback={<Show when={o.remote}><i class="env-tag" title={tx("Aponta para outra máquina, não para este computador")}>{tx("remoto")}</i></Show>}>
              <i class="env-tag prod" title={tx("Parece produção: dados de verdade")}>{tx("produção")}</i>
            </Show>
          </button>
        )}
      </For>
      <Show when={props.g.clash}>
        <p class="env-note warn">{tx("Mais de uma opção ativa no arquivo: vale a última. Escolha uma para arrumar.")}</p>
      </Show>
      <Show when={fromVault().length}>
        <p class="env-note">
          {tx("O cofre do Veocode também define {keys} nos terminais deste projeto. Muitos carregadores de .env não trocam uma variável que já existe: tire do cofre se a troca não pegar.", { keys: fromVault().join(", ") })}
        </p>
      </Show>
    </div>
  );
}

const EXAMPLE = "# local\nDATABASE_URL=postgres://localhost/app\n# homolog\n# DATABASE_URL=postgres://hml.empresa.com/app";

function Profiles(props: { pid: string }) {
  const list = () => envOf(props.pid);
  const open = (path: string) => (currentProject().demo ? openFile(path) : openRealFile(path));
  return (
    <Show
      when={list().files.length}
      fallback={
        <div class="env-empty">
          <p>
            <Show when={list().plain.length} fallback={tx("Nenhum .env com opções nesta pasta.")}>
              {txn(list().plain.length, "{files} não tem variável com opções.", "{files} não têm variável com opções.", { files: list().plain.join(", ") })}
            </Show>{" "}
            {tx("Deixe as opções de uma variável uma embaixo da outra: uma ativa e as outras comentadas com #. O comentário de cima vira o nome, e aqui a troca é um clique.")}
          </p>
          <pre class="env-example">{EXAMPLE}</pre>
        </div>
      }
    >
      <For each={list().files}>
        {(f) => (
          <div class="env-file">
            <Show when={list().files.length > 1 || f.path !== ".env"}>
              <button class="env-file-name" onClick={() => open(f.path)} title={tx("Abrir {path} no editor", { path: f.path })}>
                <FileKey size={12} /> <span>{f.path}</span>
              </button>
            </Show>
            <For each={f.groups}>{(g) => <Group pid={props.pid} file={f} g={g} />}</For>
          </div>
        )}
      </For>
    </Show>
  );
}

function ServiceForm(props: { pid: string; init?: Service; onDone: () => void }) {
  const [name, setName] = createSignal(props.init?.name ?? "");
  const [cmd, setCmd] = createSignal(props.init?.cmd ?? "");
  const [dir, setDir] = createSignal(props.init?.dir ?? "");
  const ok = () => name().trim() && cmd().trim();
  const save = () => {
    if (!ok()) return;
    const s: Service = { key: props.init?.key ?? serviceKey(dir(), name()), name: name().trim(), cmd: cmd().trim(), dir: dir().trim().replace(/^\.?\/+|\/+$/g, "") };
    const list = servicesOf(props.pid);
    saveServices(props.pid, props.init ? list.map((x) => (x.key === props.init!.key ? s : x)) : [...list.filter((x) => x.key !== s.key), s]);
    props.onDone();
  };
  let first!: HTMLInputElement;
  createEffect(() => first?.focus());
  return (
    <form class="svc-form" onSubmit={(e) => (e.preventDefault(), save())} onKeyDown={(e) => e.key === "Escape" && props.onDone()}>
      <label>
        <span>{tx("Nome")}</span>
        <input ref={first} value={name()} placeholder="back" onInput={(e) => setName(e.currentTarget.value)} />
      </label>
      <label>
        <span>{tx("Comando")}</span>
        <input class="mono" value={cmd()} placeholder="npm run dev" onInput={(e) => setCmd(e.currentTarget.value)} spellcheck={false} />
      </label>
      <label>
        <span>{tx("Pasta")}</span>
        <input class="mono" value={dir()} placeholder={tx("(a do projeto)")} onInput={(e) => setDir(e.currentTarget.value)} spellcheck={false} />
      </label>
      <div class="svc-form-actions">
        <button type="button" class="ghost-btn small" onClick={props.onDone}>{tx("Cancelar")}</button>
        <button type="submit" class="primary-btn small" disabled={!ok()}>{props.init ? tx("Salvar") : tx("Adicionar")}</button>
      </div>
    </form>
  );
}

function ServiceRow(props: { pid: string; s: Service; onEdit: () => void }) {
  const t = () => termOfService(props.pid, props.s.key);
  const on = () => !!t()?.alive;
  const dead = () => !!t() && !t()!.alive;
  const busy = () => !!envs.busy[props.s.key];
  const ports = () => (t() ? portsOfTerm(props.pid, t()!.id) : []);
  const state = () => (busy() ? tx("trabalhando…") : on() ? tx("rodando") : dead() ? tx("parou") : tx("parado"));
  const menu = (e: MouseEvent) => {
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const items: MenuEntry[] = [
      ...(t() ? [{ label: tx("Ver no terminal"), icon: () => <SquareTerminal size={13} />, run: () => showServiceTerm(props.pid, props.s) }] : []),
      { label: tx("Editar"), icon: () => <Pencil size={13} />, run: props.onEdit },
      "sep",
      { label: tx("Tirar da lista"), icon: () => <Trash2 size={13} />, danger: true, run: () => saveServices(props.pid, servicesOf(props.pid).filter((x) => x.key !== props.s.key)) },
    ];
    setContextMenu({ x: e.type === "contextmenu" ? e.clientX : r.left, y: e.type === "contextmenu" ? e.clientY : r.bottom + 4, items });
  };
  return (
    <div class="svc-row" classList={{ on: on(), dead: dead(), busy: busy() }} onContextMenu={menu} title={`${props.s.cmd}${props.s.dir ? `  ·  ${props.s.dir}/` : ""}`}>
      <span class="svc-dot" />
      <span class="svc-name">{props.s.name}</span>
      <span class="svc-meta">
        <For each={ports()}>
          {(p) => (
            <button class="svc-port" title={tx("Abrir localhost:{p} no navegador", { p })} onClick={() => void api.openUrl(`http://localhost:${p}`)}>:{p}</button>
          )}
        </For>
        <Show when={ports().length}><span class="svc-sep">·</span></Show>
        {state()}
      </span>
      <span class="svc-actions">
        <Show
          when={on()}
          fallback={
            <button class="icon-btn small" title={dead() ? tx("Rodar de novo") : tx("Rodar")} disabled={busy()} onClick={() => void startService(props.pid, props.s)}>
              <Play size={12} />
            </button>
          }
        >
          <button class="icon-btn small" title={tx("Reiniciar")} disabled={busy()} onClick={() => void restartService(props.pid, props.s)}><RotateCw size={12} /></button>
          <button class="icon-btn small" title={tx("Parar")} disabled={busy()} onClick={() => void stopService(props.pid, props.s)}><Square size={11} /></button>
        </Show>
        <Show when={t()}>
          <button class="icon-btn small" title={tx("Ver no terminal")} onClick={() => showServiceTerm(props.pid, props.s)}><SquareTerminal size={12} /></button>
        </Show>
        <button class="icon-btn small" title={tx("Mais")} onClick={menu}><Ellipsis size={12} /></button>
      </span>
    </div>
  );
}

function Services(props: { pid: string }) {
  const [editing, setEditing] = createSignal<Service | "new" | null>(null);
  return (
    <>
      <Show when={servicesOf(props.pid).length || editing()} fallback={
        <p class="env-empty">{tx("Nenhum serviço achado. Adicione com o +: o comando que você roda no terminal para subir o projeto (ex.: npm run dev).")}</p>
      }>
        <For each={servicesOf(props.pid)}>
          {(s) => (
            <Show when={editing() !== s} fallback={<ServiceForm pid={props.pid} init={s} onDone={() => setEditing(null)} />}>
              <ServiceRow pid={props.pid} s={s} onEdit={() => setEditing(s)} />
            </Show>
          )}
        </For>
      </Show>
      <Show when={editing() === "new"}><ServiceForm pid={props.pid} onDone={() => setEditing(null)} /></Show>
      <div class="svc-foot">
        <label class="env-auto" title={tx("Ao trocar um perfil do .env, os serviços rodando que leem aquele arquivo param e sobem de novo com o valor novo")}>
          <input type="checkbox" checked={autoRestart()} onChange={(e) => setAutoRestart(e.currentTarget.checked)} />
          <span>{tx("Reiniciar ao trocar de perfil")}</span>
        </label>
        <Show when={editing() !== "new"}>
          <button class="ghost-btn small" onClick={() => setEditing("new")}><Plus size={12} /> {tx("Serviço")}</button>
        </Show>
        <Show when={isCustom(props.pid)}>
          <button class="icon-btn small" title={tx("Voltar para a lista que o Veocode achou na pasta")} onClick={() => saveServices(props.pid, null)}><Undo2 size={12} /></button>
        </Show>
      </div>
    </>
  );
}

export default function EnvPanel() {
  const pid = () => currentProject().id;
  const groups = () => envOf(pid()).files.reduce((n, f) => n + f.groups.length, 0);
  const all = () => servicesOf(pid());
  const running = () => runningCount(pid());

  createEffect(on(pid, (id) => {
    void loadEnv(id);
    void loadServices(id);
    void syncTermList(id).then(() => loadPorts(id));
    if (isTauri && !vault.loaded) void loadVault();
    // o .env pode mudar fora daqui (no editor, pela IA): relê enquanto a aba está aberta
    const stop = every(() => {
      void loadEnv(id);
      void loadPorts(id);
    }, 5000);
    const focus = () => void loadEnv(id);
    window.addEventListener("focus", focus);
    onCleanup(() => {
      stop();
      window.removeEventListener("focus", focus);
    });
  }));

  return (
    <div class="side-scroll env-panel">
      <Section
        id="env-profiles"
        title={tx("Perfis do .env")}
        count={groups()}
        right={<button class="icon-btn small" title={tx("Ler os .env de novo")} onClick={() => void loadEnv(pid())}><RefreshCw size={12} /></button>}
      >
        <Show when={envs.envLoaded[pid()]} fallback={<div class="env-empty"><span class="spinner" /></div>}>
          <Profiles pid={pid()} />
        </Show>
      </Section>
      <Section
        id="env-services"
        title={tx("Serviços")}
        count={running()}
        hot
        right={
          <Show when={all().length}>
            <span class="svc-total">{tx("{on}/{all} rodando", { on: running(), all: all().length })}</span>
            <Show when={running() < all().length}>
              <button class="icon-btn small" title={tx("Rodar todos")} onClick={() => void startAll(pid())}><Play size={12} /></button>
            </Show>
            <Show when={running()}>
              <button class="icon-btn small" title={tx("Parar todos")} onClick={() => void stopAll(pid())}><Square size={11} /></button>
            </Show>
          </Show>
        }
      >
        <Services pid={pid()} />
      </Section>
      <p class="env-foot">
        <Server size={11} /> {tx("Cada serviço roda num terminal deste projeto: a saída aparece lá, numa aba com o nome dele.")}
      </p>
    </div>
  );
}
