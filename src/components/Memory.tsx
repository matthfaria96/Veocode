// Memória do projeto: o que vai para o Claude no começo de cada conversa nova.
// Em cima, "Sempre lembrar" (texto livre); embaixo, um cartão por conversa concluída.
// Cada cartão edita ou apaga só ele; a tela não recarrega inteira.
import { invoke } from "@tauri-apps/api/core";
import { Brain, Check, ChevronDown, Pencil, Pin, Trash2, X } from "lucide-solid";
import { createEffect, createSignal, For, on, Show } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { isTauri } from "../api";
import { showToast } from "../store";
import { loadMemory, memory as cache, setMemoryText } from "../memoryStore";

type Item = { title: string; body: string };
type Doc = { notes: string; items: Item[] };

function parse(text: string): Doc {
  const parts = text.split(/^## /m);
  const notes = parts.shift()!.trim();
  const items = parts.map((p) => {
    const nl = p.indexOf("\n");
    return nl < 0 ? { title: p.trim(), body: "" } : { title: p.slice(0, nl).trim(), body: p.slice(nl + 1).trim() };
  });
  return { notes, items };
}
const serialize = (d: Doc) => [d.notes.trim(), ...d.items.map((i) => `## ${i.title.trim() || "Sem título"}\n${i.body.trim()}`)].filter(Boolean).join("\n\n");
const tokens = (s: string) => Math.round(s.length / 4);

export function MemoryPanel(props: { pid: string; onClose: () => void }) {
  const [doc, setDoc] = createStore<Doc>({ notes: "", items: [] });
  const [notes, setNotes] = createSignal<string | null>(null); // rascunho das notas fixas
  const [editing, setEditing] = createSignal<Item | null>(null);
  const [draft, setDraft] = createSignal({ title: "", body: "" });
  const [confirm, setConfirm] = createSignal<Item | "all" | null>(null);
  const [open, setOpen] = createSignal<Set<Item>>(new Set());
  const [saving, setSaving] = createSignal(false);

  // chega do disco (ou do cache) → monta os cartões; não refaz enquanto você edita
  createEffect(on(() => [props.pid, cache[props.pid]] as const, ([pid, text]) => {
    void loadMemory(pid);
    if (text === undefined) return;
    if (serialize(doc) === text.trim()) return;
    setDoc(parse(text));
    setNotes(null);
    setEditing(null);
  }));

  const write = async (next: Doc, msg: string) => {
    if (!isTauri) return showToast("A memória funciona no app");
    setSaving(true);
    try {
      const saved = await invoke<string>("memory_set", { projectId: props.pid, text: serialize(next) });
      // o app corta resumos antigos se passar do limite: aí remonta
      if (saved.trim() !== serialize(next)) setDoc(parse(saved));
      setMemoryText(props.pid, saved);
      showToast(msg);
      return true;
    } catch (e) {
      showToast(String(e));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveNotes = async () => {
    const v = notes() ?? doc.notes;
    setDoc("notes", v);
    if (await write({ notes: v, items: doc.items }, "Salvo: vale nas próximas conversas")) setNotes(null);
  };
  const startEdit = (it: Item) => (setEditing(it), setDraft({ title: it.title, body: it.body }), setConfirm(null));
  const saveEdit = async (it: Item) => {
    const d = draft();
    setDoc("items", (x) => x === it, produce((x: Item) => ((x.title = d.title.trim() || x.title), (x.body = d.body))));
    if (await write(doc, "Resumo atualizado")) setEditing(null);
  };
  const remove = async (it: Item) => {
    setConfirm(null);
    const items = doc.items.filter((x) => x !== it);
    setDoc("items", items);
    await write({ notes: doc.notes, items }, "Resumo apagado da memória");
  };
  const wipe = async () => {
    setConfirm(null);
    setDoc({ notes: "", items: [] });
    setNotes(null);
    await write({ notes: "", items: [] }, "Memória apagada");
  };
  const toggle = (it: Item) => {
    const s = new Set(open());
    s.has(it) ? s.delete(it) : s.add(it);
    setOpen(s);
  };

  const total = () => tokens(serialize({ notes: notes() ?? doc.notes, items: doc.items }));
  const newest = () => [...doc.items].reverse();
  const [date, rest] = [(t: string) => t.split(" · ")[0], (t: string) => t.split(" · ").slice(1).join(" · ") || t];

  return (
    <div class="mem-panel pop-in">
      <div class="mem-head">
        <span class="mem-icon"><Brain size={16} /></span>
        <div>
          <strong>Memória do projeto</strong>
          <small>O Claude lê isto no começo de cada conversa nova, em vez de reler conversas antigas inteiras.</small>
        </div>
        <span class="mem-size" title="Quanto a memória pesa em cada conversa nova">~{total()} tokens</span>
        <button class="icon-btn small" title="Voltar para a conversa" onClick={props.onClose}><X size={14} /></button>
      </div>

      <Show when={cache[props.pid] !== undefined || !isTauri} fallback={<div class="loading-rows"><div /><div /></div>}>
        <section class="mem-card notes">
          <header>
            <Pin size={13} />
            <strong>Sempre lembrar</strong>
            <small>como rodar, decisões, o que evitar</small>
          </header>
          <textarea
            class="mem-notes"
            value={notes() ?? doc.notes}
            rows={Math.min(10, Math.max(3, (notes() ?? doc.notes).split("\n").length + 1))}
            placeholder="Ex.: Use npm run tauri build para testar. Respostas em português. Nunca mexer na pasta legado/."
            spellcheck={false}
            onInput={(e) => setNotes(e.currentTarget.value)}
          />
          <Show when={notes() !== null && notes() !== doc.notes}>
            <div class="mem-row-actions pop-in">
              <button class="ghost-btn small" onClick={() => setNotes(null)}>Desfazer</button>
              <button class="primary-btn small" disabled={saving()} onClick={() => void saveNotes()}><Check size={13} /> Salvar</button>
            </div>
          </Show>
        </section>

        <div class="mem-section">
          <span>Conversas concluídas</span>
          <small>{doc.items.length ? `${doc.items.length} ${doc.items.length === 1 ? "resumo" : "resumos"} · mais novo em cima` : ""}</small>
        </div>
        <Show when={doc.items.length} fallback={<p class="mem-empty">Nenhuma ainda. Quando uma conversa terminar, clique no ✓ da aba dela: o resumo (pedidos, arquivos mexidos e a resposta final) entra aqui, feito no próprio app, sem gastar tokens.</p>}>
          <div class="mem-list">
            <For each={newest()}>
              {(it) => (
                <article class="mem-card item" classList={{ editing: editing() === it, open: open().has(it) }}>
                  <Show
                    when={editing() === it}
                    fallback={
                      <>
                        <header onClick={() => toggle(it)}>
                          <span class="mem-date">{date(it.title)}</span>
                          <strong>{rest(it.title)}</strong>
                          <span class="mem-tools" onClick={(e) => e.stopPropagation()}>
                            <Show
                              when={confirm() === it}
                              fallback={
                                <>
                                  <button class="icon-btn small" title="Editar este resumo" onClick={() => startEdit(it)}><Pencil size={12} /></button>
                                  <button class="icon-btn small" title="Apagar este resumo" onClick={() => setConfirm(it)}><Trash2 size={12} /></button>
                                </>
                              }
                            >
                              <span class="mem-confirm pop-in">Apagar?<button class="link-btn danger-text" onClick={() => void remove(it)}>Sim</button><button class="link-btn" onClick={() => setConfirm(null)}>Não</button></span>
                            </Show>
                          </span>
                          <ChevronDown size={13} class="mem-chev" />
                        </header>
                        <p class="mem-body" onClick={() => toggle(it)}>{it.body}</p>
                      </>
                    }
                  >
                    <input class="mem-title-in" value={draft().title} onInput={(e) => setDraft({ ...draft(), title: e.currentTarget.value })} />
                    <textarea class="mem-notes" rows={6} value={draft().body} spellcheck={false} onInput={(e) => setDraft({ ...draft(), body: e.currentTarget.value })} ref={(el) => requestAnimationFrame(() => el.focus())} />
                    <div class="mem-row-actions">
                      <button class="ghost-btn small" onClick={() => setEditing(null)}>Cancelar</button>
                      <button class="primary-btn small" disabled={saving()} onClick={() => void saveEdit(it)}><Check size={13} /> Salvar</button>
                    </div>
                  </Show>
                </article>
              )}
            </For>
          </div>
        </Show>

        <div class="mem-actions">
          <span class="mem-note">Fica guardada no Veocode, fora da pasta do projeto. Passou de ~2 mil tokens, os resumos mais antigos saem sozinhos.</span>
          <Show when={doc.notes || doc.items.length}>
            <Show when={confirm() === "all"} fallback={<button class="ghost-btn small danger-text" onClick={() => setConfirm("all")}>Apagar tudo</button>}>
              <span class="mem-confirm pop-in">Apagar a memória inteira?<button class="link-btn danger-text" onClick={() => void wipe()}>Sim</button><button class="link-btn" onClick={() => setConfirm(null)}>Não</button></span>
            </Show>
          </Show>
        </div>
      </Show>
    </div>
  );
}
