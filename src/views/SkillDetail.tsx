// Janela que mostra um extra do Claude (receita, atalho, ajudante ou conexão) em palavras
// simples, com o texto dele. Usada na aba "Extras do Claude" (Inventory.tsx).
import { FolderOpen, X } from "lucide-solid";
import { createResource, For, Show } from "solid-js";
import { api, isTauri, prettyPath } from "../api";
import { accountById } from "../accounts";
import { showToast } from "../store";
import { kindLabel, readSkillFile, type Item, type Kind } from "../skills";
import { tx } from "../i18n";

const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const whatIs: Record<Kind, string> = {
  get skill() { return tx("Receita: instruções que o Claude segue sozinho quando o pedido combina."); },
  get command() { return tx("Atalho: digite / e o nome no chat para mandar este pedido pronto."); },
  get agent() { return tx("Ajudante: um Claude especializado que o principal chama para uma parte do trabalho."); },
  get mcp() { return tx("Conexão: deixa o Claude usar outro programa ou site."); },
};

export function SkillDetail(props: { i: Item; onClose: () => void }) {
  const i = () => props.i;
  const isMd = () => !!i().path?.endsWith(".md");
  const [text] = createResource(() => (isMd() ? i().path : null), (p) => readSkillFile(p!).catch((e) => tx("Não deu para ler: {v}", { v: errMsg(e) })));
  return (
    <div class="palette-backdrop" onClick={props.onClose} onKeyDown={(e) => e.key === "Escape" && props.onClose()} tabIndex={-1} ref={(el) => requestAnimationFrame(() => el.focus())}>
      <div class="dialog wide detail" onClick={(e) => e.stopPropagation()}>
        <div class="detail-head">
          <span class={`kind-badge ${i().kind}`}>{kindLabel[i().kind]}</span>
          <h3>{i().name}</h3>
          <button class="icon-btn" title={tx("Fechar")} onClick={props.onClose}><X size={14} /></button>
        </div>
        <p class="detail-desc">{i().description}</p>
        <dl class="acc-facts detail-facts">
          <dt>{tx("Para que serve")}</dt>
          <dd>{whatIs[i().kind]}</dd>
          <dt>{tx("Onde vale")}</dt>
          <dd>{i().layer === "conta" ? tx("em todos os projetos desta conta") : i().layer === "plugin" ? tx("veio no pacote {plugin}", { plugin: i().plugin }) : tx("só no projeto {v}", { v: base(i().project ?? "") })}</dd>
          <Show when={i().origin}><dt>{tx("Origem")}</dt><dd>{i().origin}</dd></Show>
          <dt>{tx("Quem usa")}</dt>
          <dd>{i().accounts.map((id) => accountById(id).label).join(", ") || "—"}</dd>
          <Show when={i().mcp}>
            {(m) => (
              <>
                <dt>{tx("Como conecta")}</dt><dd>{m().transport === "stdio" ? tx("programa neste computador") : tx("pela internet ({transport})", { transport: m().transport })}</dd>
                <Show when={m().command}><dt>{tx("Programa que roda")}</dt><dd class="mono-dd" title={m().command!}>{prettyPath(m().command!)} {m().args.join(" ")}</dd></Show>
                <Show when={m().url}><dt>{tx("Endereço")}</dt><dd class="mono-dd">{m().url}</dd></Show>
                <Show when={m().found !== null}><dt>{tx("Está funcionando?")}</dt><dd classList={{ bad: m().found === false }}>{m().found ? tx("sim, o programa existe") : tx("não: o programa que ela precisa não está instalado")}</dd></Show>
                <Show when={m().envNames.length}><dt>{tx("Configurações")}</dt><dd><For each={m().envNames}>{(n) => <code class="env-chip">{n}</code>}</For></dd></Show>
                <Show when={m().headerNames.length}><dt>{tx("Senhas de acesso")}</dt><dd><For each={m().headerNames}>{(n) => <code class="env-chip">{n}</code>}</For></dd></Show>
              </>
            )}
          </Show>
        </dl>
        <Show when={i().mcp && (i().mcp!.envNames.length || i().mcp!.headerNames.length)}>
          <p class="foot-note">{tx("Os valores ficam escondidos porque costumam ser senhas e chaves.")}</p>
        </Show>
        <Show when={isMd()}>
          <pre class="skill-text">{text.loading ? tx("Carregando…") : text()}</pre>
        </Show>
        <Show when={i().path && isTauri}>
          <div class="dialog-actions">
            <code class="detail-path" title={i().path!}>{prettyPath(i().path!)}</code>
            <button class="ghost-btn small" onClick={() => api.reveal(i().path!).catch((e) => showToast(errMsg(e)))}><FolderOpen size={12} /> {tx("Mostrar na pasta")}</button>
          </div>
        </Show>
      </div>
    </div>
  );
}
