// Enquanto a IA pensa e ainda não escreveu nada: um brilho que respira na cor da conta e o
// texto com a luz passando, no lugar dos três pontinhos.
import { tx } from "../i18n";

export default function Thinking(props: { color: string; label?: string }) {
  return (
    <div class="thinking pop-in" style={{ "--c": props.color }} role="status">
      <span class="thinking-orb" aria-hidden="true" />
      <span class="thinking-text">{props.label ?? tx("Pensando…")}</span>
    </div>
  );
}
