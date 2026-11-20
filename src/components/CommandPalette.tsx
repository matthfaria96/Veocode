import { ArrowUpRight, Bot, MessagesSquare, CircleHelp, Settings2, FolderPlus, HardDrive, Puzzle, Search, LayoutDashboard, Gauge } from "lucide-solid";
import { FileIcon, ProjectIcon } from "./icons";
import { api } from "../api";
import { revealAndOpen } from "../fileActions";
import { createMemo, createResource, createSignal, For, onMount, type JSX } from "solid-js";
import { addProjectFromPicker, currentProject, setHelpOpen, setPaletteOpen, setProjectId, setView, projects } from "../store";
import { tx } from "../i18n";
import { toggleCtx, ctxPanel } from "../contextInfo";
import { activeKey } from "../convTabs";
import { accountById } from "../accounts";

interface Action {
  label: string;
  hint: string;
  icon: () => JSX.Element;
  run: () => void;
}

export default function CommandPalette() {
  const [q, setQ] = createSignal("");
  const [sel, setSel] = createSignal(0);
  let input!: HTMLInputElement;

  const all = (): Action[] => [
    { label: tx("Adicionar pasta como projeto"), hint: tx("abre o seletor de pastas"), icon: () => <FolderPlus size={15} />, run: () => addProjectFromPicker() },
    ...projects.map((p) => ({
      label: tx("Abrir projeto {name}", { name: p.name }),
      hint: p.path,
      icon: () => <ProjectIcon id={p.id} name={p.name} stack={p.stack} size={15} />,
      run: () => {
        setProjectId(p.id);
        setView("workspace");
      },
    })),
    ...(currentProject() && accountById(currentProject().accountId).provider === "claude"
      ? [{ label: tx("Contexto da conversa: o que ocupa a janela do Claude e compactar"), hint: tx("Projetos → medidor ao lado das abas"), icon: () => <Gauge size={15} />, run: () => {
          const k = activeKey(currentProject().id);
          setView("workspace");
          if (ctxPanel() !== k) setTimeout(() => toggleCtx(k), 60);
        } }]
      : []),
    { label: tx("Liberar espaço: caches e históricos das IAs"), hint: tx("Computador → Uso da máquina"), icon: () => <HardDrive size={15} />, run: () => setView("system") },
    { label: tx("Ver programas e máquinas virtuais que as IAs usam"), hint: tx("Computador → Uso da máquina"), icon: () => <HardDrive size={15} />, run: () => setView("system") },
    { label: tx("Trocar conta de um projeto"), hint: tx("Contas e IAs"), icon: () => <Bot size={15} />, run: () => setView("accounts") },
    { label: tx("Visão geral: todos os projetos com as conversas ao vivo"), hint: tx("Visão geral"), icon: () => <LayoutDashboard size={15} />, run: () => setView("board") },
    { label: tx("Chat livre: conversar sem projeto"), hint: tx("Chat livre"), icon: () => <MessagesSquare size={15} />, run: () => setView("livre") },
    { label: tx("Ajustes: ícones e animações"), hint: tx("Ajustes"), icon: () => <Settings2 size={15} />, run: () => setView("settings") },
    { label: tx("Ajuda: como o Veocode funciona"), hint: "F1", icon: () => <CircleHelp size={15} />, run: () => setHelpOpen(true) },
    { label: tx("Extras do Claude: receitas, atalhos e conexões (skills e MCP)"), hint: tx("Computador → Extras do Claude"), icon: () => <Puzzle size={15} />, run: () => setView("inventory") },
  ];

  // arquivos do projeto aberto (o que o .gitignore esconde fica de fora)
  const cur = currentProject();
  const [files] = createResource(() => (cur.demo ? null : cur.id), (id) => api.listFiles(id).catch(() => [] as string[]));
  const fileActions = (s: string): Action[] => {
    if (!s || !files()) return [];
    const hits = files()!.filter((f) => f.toLowerCase().includes(s));
    // nome do arquivo bate primeiro, depois o caminho
    hits.sort((a, b) => Number(!(a.split("/").pop() ?? "").toLowerCase().includes(s)) - Number(!(b.split("/").pop() ?? "").toLowerCase().includes(s)) || a.length - b.length);
    return hits.slice(0, 30).map((f) => ({
      label: f.split("/").pop() ?? f,
      hint: `${cur.name} · ${f}`,
      icon: () => <FileIcon name={f.split("/").pop() ?? f} size={15} />,
      run: () => {
        setView("workspace");
        void revealAndOpen(f);
      },
    }));
  };

  const filtered = createMemo(() => {
    const s = q().toLowerCase().trim();
    return s ? [...all().filter((a) => (a.label + a.hint).toLowerCase().includes(s)), ...fileActions(s)] : all();
  });

  const exec = (a?: Action) => {
    if (!a) return;
    a.run();
    setPaletteOpen(false);
  };

  onMount(() => input.focus());

  return (
    <div class="palette-backdrop" onClick={() => setPaletteOpen(false)}>
      <div class="palette" onClick={(e) => e.stopPropagation()}>
        <div class="palette-input">
          <Search size={16} />
          <input
            ref={input}
            placeholder={tx("Busque um projeto, um arquivo do projeto aberto ou uma ação…")}
            value={q()}
            onInput={(e) => {
              setQ(e.currentTarget.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, filtered().length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              if (e.key === "Enter") exec(filtered()[sel()]);
            }}
          />
        </div>
        <div class="palette-list">
          <For each={filtered()} fallback={<div class="palette-empty">{tx("Nada encontrado")}</div>}>
            {(a, i) => (
              <button class="palette-item" classList={{ sel: sel() === i() }} onMouseEnter={() => setSel(i())} onClick={() => exec(a)}>
                {a.icon()}
                <span class="palette-label">{a.label}</span>
                <span class="palette-hint">{a.hint}</span>
                <ArrowUpRight size={13} class="palette-go" />
              </button>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
