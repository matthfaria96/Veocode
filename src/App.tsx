import { Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { acc, loadAccess } from "./access";
import TitleBar from "./components/TitleBar";
import Rail from "./components/Rail";
import Dialogs from "./components/Dialogs";
import ContextMenu from "./components/ContextMenu";
import CommandPalette from "./components/CommandPalette";
import Help from "./components/Help";
import Workspace from "./views/Workspace";
import Accounts from "./views/Accounts";
import System from "./views/System";
import Inventory from "./views/Inventory";
import Settings from "./views/Settings";
import Livre from "./views/Livre";
import Board from "./views/Board";
import { loadSettings } from "./settings";
import { helpOpen, loadProjects, paletteOpen, setHelpOpen, setPaletteOpen, showToast, toast, view } from "./store";
import { loadSummaries } from "./git";
import { api } from "./api";
import { handleFsChange } from "./realProject";
import { refreshProcs } from "./xray";
import { loadAccounts, refreshStatuses } from "./accounts";
import { startChatEvents } from "./chat";
import { startTermEvents } from "./terminal";

export default function App() {
  const onKey = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      setPaletteOpen(!paletteOpen());
    }
    if (e.key === "Escape") setPaletteOpen(false);
    // F1 (ou ? fora de campos de texto) abre a ajuda na tela atual
    const typing = e.target instanceof HTMLElement && (e.target.closest("input, textarea, select, [contenteditable=true]") !== null);
    if (e.key === "F1" || (e.key === "?" && !typing && !e.metaKey && !e.ctrlKey)) {
      e.preventDefault();
      setPaletteOpen(false);
      setHelpOpen(!helpOpen());
    }
  };
  onMount(() => {
    loadSettings();
    startChatEvents();
    startTermEvents();
    window.addEventListener("keydown", onKey);
    // erro que escapou: aparece na tela em vez de sumir no console (o app nativo não mostra console)
    const onErr = (e: ErrorEvent | PromiseRejectionEvent) => {
      const r = "reason" in e ? e.reason : e.error ?? e.message;
      showToast(`Erro: ${r instanceof Error ? r.message : String(r)}`);
    };
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onErr);
    onCleanup(() => (window.removeEventListener("error", onErr), window.removeEventListener("unhandledrejection", onErr)));
    loadProjects();
    loadAccounts();
    // uso do Claude e Ollama a cada 20 s (só leitura local); APIs só quando pedir
    const accounts = setInterval(() => refreshStatuses(false), 20000);
    onCleanup(() => clearInterval(accounts));
    // mudanças no disco chegam do Rust (src-tauri/src/watch.rs)
    // se o settings do Claude no projeto mudar (por fora ou pelo próprio Claude), o painel do nível relê
    let accTimer: number | undefined;
    let gitTimer: number | undefined;
    const unlisten = api.onFsChange((e) => {
      handleFsChange(e);
      // arquivos mudaram: o número de mudanças do git também (uma leitura leve, juntando os avisos)
      clearTimeout(gitTimer);
      gitTimer = window.setTimeout(() => void loadSummaries(true), 1500);
      if (acc.reports[e.projectId] && e.changes.some((c) => /(^|[\\/])\.claude[\\/]settings(\.local)?\.json$/.test(c.path))) {
        clearTimeout(accTimer);
        accTimer = window.setTimeout(() => loadAccess(e.projectId), 400);
      }
    });
    onCleanup(() => unlisten.then((f) => f()));
    // pulso dos agentes na barra de título; na tela Raio-X ela mesma atualiza a cada 2 s
    refreshProcs();
    const t = setInterval(() => view() !== "system" && refreshProcs(), 5000);
    onCleanup(() => clearInterval(t));
  });
  onCleanup(() => window.removeEventListener("keydown", onKey));

  return (
    <div class="app">
      <TitleBar />
      <div class="app-body">
        <Rail />
        <main class="stage">
          <Switch>
            <Match when={view() === "workspace"}>
              <div class="view-enter"><Workspace /></div>
            </Match>
            <Match when={view() === "accounts"}>
              <div class="view-enter"><Accounts /></div>
            </Match>
            <Match when={view() === "inventory"}>
              <div class="view-enter"><Inventory /></div>
            </Match>
            <Match when={view() === "board"}>
              <div class="view-enter"><Board /></div>
            </Match>
            <Match when={view() === "livre"}>
              <div class="view-enter"><Livre /></div>
            </Match>
            <Match when={view() === "settings"}>
              <div class="view-enter"><Settings /></div>
            </Match>
            <Match when={view() === "system"}>
              <div class="view-enter"><System /></div>
            </Match>
          </Switch>
        </main>
      </div>
      <Show when={helpOpen()}>
        <Help />
      </Show>
      <Show when={paletteOpen()}>
        <CommandPalette />
      </Show>
      <Dialogs />
      <ContextMenu />
      <Show when={toast()}>
        <div class="toast">{toast()}</div>
      </Show>
    </div>
  );
}
