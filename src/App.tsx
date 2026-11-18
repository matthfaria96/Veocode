import { lazy, Match, onCleanup, onMount, Show, Suspense, Switch } from "solid-js";
import { acc, loadAccess } from "./access";
import TitleBar from "./components/TitleBar";
import Rail from "./components/Rail";
import Dialogs from "./components/Dialogs";
import ContextMenu from "./components/ContextMenu";
import CommandPalette from "./components/CommandPalette";
import Workspace from "./views/Workspace";
import Livre from "./views/Livre";
import Board from "./views/Board";
import { loadSettings } from "./settings";
import { helpOpen, loadProjects, paletteOpen, projectId, setHelpOpen, setPaletteOpen, setView, showToast, toast, view } from "./store";
import { loadSummaries } from "./git";
import { api } from "./api";
import { handleFsChange } from "./realProject";
import { refreshProcs } from "./xray";
import { loadAccounts, refreshStatuses } from "./accounts";
import { newChat, startChatEvents } from "./chat";
import { newLivre } from "./livre";
import { startTermEvents } from "./terminal";
import { startNotices } from "./attention";
import { every } from "./every";

// telas menos usadas chegam aos poucos: o app abre mais rápido e elas ficam prontas logo depois
const loaders = {
  Accounts: () => import("./views/Accounts"),
  System: () => import("./views/System"),
  Inventory: () => import("./views/Inventory"),
  Settings: () => import("./views/Settings"),
  Help: () => import("./components/Help"),
};
const Accounts = lazy(loaders.Accounts);
const System = lazy(loaders.System);
const Inventory = lazy(loaders.Inventory);
const Settings = lazy(loaders.Settings);
const Help = lazy(loaders.Help);

export default function App() {
  const onKey = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      setPaletteOpen(!paletteOpen());
    }
    if (e.key === "Escape") setPaletteOpen(false);
    // ⌘1…5 trocam de tela; ⌘N começa uma conversa nova onde você está
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
      const views = ["board", "workspace", "livre", "accounts", "inventory"] as const;
      const n = Number(e.key);
      if (n >= 1 && n <= views.length) {
        e.preventDefault();
        setView(views[n - 1]);
      } else if (e.key.toLowerCase() === "n" && (view() === "workspace" || view() === "livre")) {
        e.preventDefault();
        void (view() === "livre" ? newLivre() : newChat(projectId()));
      }
    }
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
    // carrega as outras telas quando o app estiver parado, para não haver espera ao abrir
    const warm = () => Object.values(loaders).forEach((l) => void l());
    "requestIdleCallback" in window ? (window as any).requestIdleCallback(warm, { timeout: 3000 }) : setTimeout(warm, 1500);
    // avisa quando a IA de outro projeto termina ou passa a esperar você
    onCleanup(startNotices());
    // uso do Claude e Ollama a cada 20 s (só leitura local); APIs só quando pedir
    onCleanup(every(() => refreshStatuses(false), 20000));
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
    onCleanup(every(() => view() !== "system" && refreshProcs(), 5000));
  });
  onCleanup(() => window.removeEventListener("keydown", onKey));

  return (
    <div class="app">
      <TitleBar />
      <div class="app-body">
        <Rail />
        <main class="stage">
          <Suspense>
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
          </Suspense>
        </main>
      </div>
      <Show when={helpOpen()}>
        <Suspense><Help /></Suspense>
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
