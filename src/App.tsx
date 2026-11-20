import { createEffect, ErrorBoundary, lazy, Match, on, onCleanup, onMount, Show, Suspense, Switch } from "solid-js";
import { ViewCrash } from "./components/ViewCrash";
import { newConversationHere } from "./components/ConvSidebar";
import { projMode } from "./layoutMode";
import { newEntry } from "./fileActions";
import { acc, loadAccess } from "./access";
import TitleBar from "./components/TitleBar";
import Rail from "./components/Rail";
import Dialogs from "./components/Dialogs";
import ChatModals from "./components/ChatModals";
import CloseProjectHost from "./components/CloseProject";
import { MediaViewer } from "./components/Media";
import { trackMedia } from "./media";
import { watchDrops } from "./attachments";
import ContextMenu from "./components/ContextMenu";
import CommandPalette from "./components/CommandPalette";
import Workspace from "./views/Workspace";
import Livre from "./views/Livre";
import Board from "./views/Board";
import { loadSettings } from "./settings";
import { watchLanguage } from "./i18n";
import { helpOpen, loadProjects, paletteOpen, setHelpOpen, setPaletteOpen, setView, showToast, toast, view } from "./store";
import { loadSummaries } from "./git";
import { api } from "./api";
import { handleFsChange } from "./realProject";
import { refreshProcs } from "./xray";
import { loadAccounts, refreshStatuses } from "./accounts";
import { startChatEvents } from "./chat";
import { newLivre } from "./livre";
import { startTermEvents } from "./terminal";
import { startNotices } from "./attention";
import { every } from "./every";
import { refreshLimits, startLimitWatch } from "./limits";
import { SwitchAccountDialog } from "./components/Limits";
import { accts } from "./accounts";
import { tx } from "./i18n";
import { mapFileChanged } from "./projmap";

// telas menos usadas chegam aos poucos: o app abre mais rápido e elas ficam prontas logo depois
const loaders = {
  Accounts: () => import("./views/Accounts"),
  System: () => import("./views/System"),
  Settings: () => import("./views/Settings"),
  Help: () => import("./components/Help"),
};
const Accounts = lazy(loaders.Accounts);
const System = lazy(loaders.System);
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
      const views = ["board", "workspace", "livre", "accounts", "system"] as const;
      const n = Number(e.key);
      if (n >= 1 && n <= views.length) {
        e.preventDefault();
        setView(views[n - 1]);
      } else if (e.key.toLowerCase() === "n" && (view() === "workspace" || view() === "livre")) {
        e.preventDefault();
        if (view() === "livre") void newLivre();
        else if (projMode() === "code") void newEntry("", false);
        else newConversationHere();
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
    // arrastar arquivos do Finder para a caixa de mensagem anexa
    let stopDrops: (() => void) | undefined;
    void watchDrops().then((f) => (stopDrops = f));
    onCleanup(() => stopDrops?.());
    loadSettings();
    watchLanguage();
    startChatEvents();
    startTermEvents();
    window.addEventListener("keydown", onKey);
    // erro que escapou: aparece na tela em vez de sumir no console (o app nativo não mostra console)
    const onErr = (e: ErrorEvent | PromiseRejectionEvent) => {
      const r = "reason" in e ? e.reason : e.error ?? e.message;
      showToast(tx("Erro: {v}", { v: r instanceof Error ? r.message : String(r) }));
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
    // limites do plano (5 h e semana): logo que as contas chegam e depois a cada 3 min
    onCleanup(startLimitWatch());
    createEffect(on(() => accts.loaded, (ok) => ok && void refreshLimits()));
    // uso do Claude e Ollama a cada 20 s (só leitura local); APIs só quando pedir
    onCleanup(every(() => refreshStatuses(false), 20000));
    // mudanças no disco chegam do Rust (src-tauri/src/watch.rs)
    // se o settings do Claude no projeto mudar (por fora ou pelo próprio Claude), o painel do nível relê
    let accTimer: number | undefined;
    let gitTimer: number | undefined;
    const unlisten = api.onFsChange((e) => {
      handleFsChange(e);
      trackMedia(e);
      // arquivos mudaram: o número de mudanças do git também (uma leitura leve, juntando os avisos)
      clearTimeout(gitTimer);
      gitTimer = window.setTimeout(() => void loadSummaries(true), 1500);
      if (e.changes.some((c) => c.path === ".veocode/map.json")) mapFileChanged(e.projectId);
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
          <ErrorBoundary fallback={(err, reset) => <ViewCrash err={err} reset={reset} />}>
          <Suspense>
          <Switch>
            <Match when={view() === "workspace"}>
              <div class="view-enter"><Workspace /></div>
            </Match>
            <Match when={view() === "accounts"}>
              <div class="view-enter"><Accounts /></div>
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
            <Match when={view() === "system" || view() === "inventory"}>
              <div class="view-enter"><System /></div>
            </Match>
          </Switch>
          </Suspense>
          </ErrorBoundary>
        </main>
      </div>
      <Show when={helpOpen()}>
        <Suspense><Help /></Suspense>
      </Show>
      <Show when={paletteOpen()}>
        <CommandPalette />
      </Show>
      <ChatModals />
      <Dialogs />
      <SwitchAccountDialog />
      <CloseProjectHost />
      <MediaViewer />
      <ContextMenu />
      <Show when={toast()}>
        <div class="toast">{toast()}</div>
      </Show>
    </div>
  );
}
