import { Brain, Check, Trash2, FilePlus2, FileSearch, Eye, Globe, ListChecks, MessageSquare, Pencil, Plug, SquareTerminal, User, Users } from "lucide-solid";
import type { ActivityEvent } from "../store";

export const kindColor: Record<ActivityEvent["kind"], string> = {
  user: "var(--text-2)",
  think: "var(--accent-2)",
  read: "var(--info)",
  search: "var(--info)",
  swarm: "var(--accent)",
  edit: "var(--warn)",
  create: "var(--ok)",
  delete: "var(--err)",
  run: "var(--text)",
  tool: "var(--accent-2)",
  done: "var(--ok)",
  say: "var(--accent)",
  web: "var(--info)",
  plan: "var(--accent-2)",
};

export default function ActivityIcon(props: { kind: ActivityEvent["kind"]; size?: number }) {
  const s = () => props.size ?? 13;
  switch (props.kind) {
    case "user": return <User size={s()} />;
    case "think": return <Brain size={s()} />;
    case "read": return <Eye size={s()} />;
    case "search": return <FileSearch size={s()} />;
    case "swarm": return <Users size={s()} />;
    case "edit": return <Pencil size={s()} />;
    case "create": return <FilePlus2 size={s()} />;
    case "delete": return <Trash2 size={s()} />;
    case "run": return <SquareTerminal size={s()} />;
    case "tool": return <Plug size={s()} />;
    case "done": return <Check size={s()} />;
    case "say": return <MessageSquare size={s()} />;
    case "web": return <Globe size={s()} />;
    case "plan": return <ListChecks size={s()} />;
  }
}
