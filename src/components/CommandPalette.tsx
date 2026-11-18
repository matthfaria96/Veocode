import { ArrowUpRight, Bot, Boxes, MessagesSquare, CircleHelp, Settings2, FolderPlus, Puzzle, Radar, Search, Trash2, LayoutDashboard } from "lucide-solid";
import { ProjectIcon } from "./icons";
import { createMemo, createSignal, For, onMount, type JSX } from "solid-js";
import { addProjectFromPicker, setHelpOpen, setPaletteOpen, setProjectId, setView, showToast, projects } from "../store";

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
    { label: "Adicionar pasta como projeto", hint: "abre o seletor de pastas", icon: () => <FolderPlus size={15} />, run: () => addProjectFromPicker() },
    ...projects.map((p) => ({
      label: `Abrir projeto ${p.name}`,
      hint: p.path,
      icon: () => <ProjectIcon id={p.id} name={p.name} stack={p.stack} size={15} />,
      run: () => {
        setProjectId(p.id);
        setView("workspace");
      },
    })),
    { label: "Limpar todos os caches das IAs", hint: "Raio-X → Caches", icon: () => <Trash2 size={15} />, run: () => { setView("system"); showToast("Simulação: nada foi apagado"); } },
    { label: "Ver o que as IAs instalaram", hint: "Raio-X → Instalado", icon: () => <Radar size={15} />, run: () => setView("system") },
    { label: "Ver VMs e containers", hint: "Raio-X → Máquinas", icon: () => <Radar size={15} />, run: () => setView("system") },
    { label: "Trocar conta de um projeto", hint: "Contas e IAs", icon: () => <Bot size={15} />, run: () => setView("accounts") },
    { label: "Painel: todos os projetos e até 4 chats lado a lado", hint: "Painel", icon: () => <LayoutDashboard size={15} />, run: () => setView("board") },
    { label: "Chat livre: conversar sem projeto", hint: "Chat livre", icon: () => <MessagesSquare size={15} />, run: () => setView("livre") },
    { label: "Ajustes: ícones e animações", hint: "Ajustes", icon: () => <Settings2 size={15} />, run: () => setView("settings") },
    { label: "Ajuda: como o Veocode funciona", hint: "F1", icon: () => <CircleHelp size={15} />, run: () => setHelpOpen(true) },
    { label: "Ver tudo o que as IAs usam neste computador", hint: "Inventário", icon: () => <Boxes size={15} />, run: () => setView("inventory") },
    { label: "Gerenciar skills e MCP", hint: "Skills", icon: () => <Puzzle size={15} />, run: () => setView("skills") },
  ];

  const filtered = createMemo(() => {
    const s = q().toLowerCase().trim();
    return s ? all().filter((a) => (a.label + a.hint).toLowerCase().includes(s)) : all();
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
            placeholder="O que você quer fazer?"
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
          <For each={filtered()} fallback={<div class="palette-empty">Nada encontrado</div>}>
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
