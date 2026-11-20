// Quando uma tela quebra: em vez de ficar tudo em branco, mostra o que aconteceu e deixa tentar
// de novo (o resto do app continua funcionando).
import { AlertTriangle, Copy, RotateCcw } from "lucide-solid";
import { onMount } from "solid-js";
import { showToast } from "../store";
import { tx } from "../i18n";

export function ViewCrash(props: { err: unknown; reset: () => void }) {
  const e = () => (props.err instanceof Error ? props.err : new Error(String(props.err)));
  const text = () => `${e().message}\n${e().stack ?? ""}`.trim();
  onMount(() => console.error("[veocode] tela quebrou:", props.err));
  return (
    <div class="view-crash">
      <div class="view-crash-card">
        <AlertTriangle size={22} />
        <strong>{tx("Esta tela travou")}</strong>
        <p>{tx("Um erro interrompeu a tela. As conversas e os arquivos não foram afetados.")}</p>
        <pre>{text()}</pre>
        <div class="view-crash-actions">
          <button class="ghost-btn" onClick={() => void navigator.clipboard.writeText(text()).then(() => showToast(tx("Erro copiado")))}><Copy size={13} /> {tx("Copiar o erro")}</button>
          <button class="primary-btn" onClick={() => props.reset()}><RotateCcw size={13} /> {tx("Tentar de novo")}</button>
        </div>
      </div>
    </div>
  );
}
