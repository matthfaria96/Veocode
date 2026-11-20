// Realce de sintaxe simplificado, usado pelo editor e pela tela de mudanças.

export type Tok = { t: string; c?: string };

const KW =
  /^(import|from|export|default|function|return|const|let|fn|pub|use|mod|struct|impl|mut|for|if|else|match|type|interface|async|await|new|self|Self|true|false)$/;

/** Realce de sintaxe simplificado — suficiente para o protótipo. */
export function tokenize(line: string, ext: string): Tok[] {
  if (ext === "md") return [{ t: line, c: line.startsWith("#") ? "tk-head" : line.startsWith("-") ? "tk-str" : undefined }];
  const re = /(\/\/.*$|\/\*.*\*\/|\/\/\/.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`)|(<\/?[A-Za-z][\w.]*|\/?>)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][\w]*)(?=\s*\()|([A-Za-z_][\w]*)/g;
  const out: Tok[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push({ t: line.slice(last, m.index) });
    if (m[1]) out.push({ t: m[0], c: "tk-com" });
    else if (m[2]) out.push({ t: m[0], c: "tk-str" });
    else if (m[3]) out.push({ t: m[0], c: "tk-tag" });
    else if (m[4]) out.push({ t: m[0], c: "tk-num" });
    else if (m[5]) out.push({ t: m[0], c: KW.test(m[0]) ? "tk-kw" : "tk-fn" });
    else out.push({ t: m[0], c: KW.test(m[0]) ? "tk-kw" : /^[A-Z]/.test(m[0]) ? "tk-type" : undefined });
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({ t: line.slice(last) });
  return out;
}
