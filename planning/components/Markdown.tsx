"use client";
// Markdown simple (títulos, listas, negrita, itálica, links, tablas) a elementos de React.
// Nunca inserta HTML: lo que venga de ClickUp se muestra como texto.
import { Fragment, type ReactNode } from "react";

function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*|__)(.+?)\1|(\*|_)(?!\s)(.+?)(?<!\s)\3|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = key;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[2] !== undefined) out.push(<strong key={k++}>{inline(m[2], k * 100)}</strong>);
    else if (m[4] !== undefined) out.push(<em key={k++}>{inline(m[4], k * 100)}</em>);
    else if (m[5] !== undefined) out.push(<code key={k++}>{m[5]}</code>);
    else if (m[6] !== undefined)
      out.push(
        <a key={k++} href={m[7]} target="_blank" rel="noreferrer">
          {m[6]}
        </a>,
      );
    else if (m[8] !== undefined)
      out.push(
        <a key={k++} href={m[8]} target="_blank" rel="noreferrer">
          {m[8]}
        </a>,
      );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Item = { depth: number; ordered: boolean; text: string };

function list(items: Item[], key: string): ReactNode {
  // Arma listas anidadas según la sangría
  const root: { item: Item; children: Item[] }[] = [];
  const base = Math.min(...items.map((i) => i.depth));
  for (const it of items) {
    if (it.depth <= base || !root.length) root.push({ item: it, children: [] });
    else root[root.length - 1].children.push(it);
  }
  const Tag = items[0].ordered ? "ol" : "ul";
  return (
    <Tag key={key}>
      {root.map((r, i) => (
        <li key={i}>
          {inline(r.item.text)}
          {r.children.length > 0 && list(r.children, `${key}-${i}`)}
        </li>
      ))}
    </Tag>
  );
}

/** Limpia lo propio de ClickUp: menciones "[@Ana](#user_mention#123)" y caracteres escapados ("\\-36%") */
export function clickupClean(md: string) {
  return md
    .replace(/\r/g, "")
    .replace(/^\s*(\[@[^\]]+\]\(#user_mention#\d+\)\s*)+$/gm, "") // renglón que es solo menciones
    .replace(/\[(@[^\]]+)\]\(#user_mention#\d+\)/g, "$1")
    .replace(/\\([-+*_#|.()[\]!>`~])/g, "$1");
}

export function Markdown({ text }: { text: string }) {
  const lines = clickupClean(text).split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push(<p key={`p${blocks.length}`}>{inline(para.join(" "))}</p>);
    para = [];
  };
  while (i < lines.length) {
    const line = lines[i];
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    const li = line.match(/^(\s*)([*\-+]|\d+[.)])\s+(.*)$/);
    if (!line.trim()) {
      flush();
      i++;
    } else if (h) {
      flush();
      const level = Math.min(4, h[1].length + 1);
      const Tag = `h${level}` as "h2" | "h3" | "h4";
      blocks.push(<Tag key={`h${i}`}>{inline(h[2].replace(/\*\*/g, ""))}</Tag>);
      i++;
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      blocks.push(<hr key={`r${i}`} />);
      i++;
    } else if (li) {
      flush();
      const items: Item[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([*\-+]|\d+[.)])\s+(.*)$/);
        if (!m) break;
        items.push({ depth: m[1].replace(/\t/g, "    ").length, ordered: /\d/.test(m[2]), text: m[3] });
        i++;
      }
      blocks.push(list(items, `l${i}`));
    } else if (/^\s*\|.*\|\s*$/.test(line)) {
      flush();
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) rows.push(lines[i].trim().slice(1, -1).split("|").map((c) => c.trim()));
        i++;
      }
      blocks.push(
        <div className="md-table" key={`t${i}`}>
          <table>
            <thead>
              <tr>
                {rows[0]?.map((c, j) => (
                  <th key={j}>{inline(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(1).map((r, j) => (
                <tr key={j}>
                  {r.map((c, k) => (
                    <td key={k}>{inline(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    } else if (/^\s*>/.test(line)) {
      flush();
      blocks.push(<blockquote key={`q${i}`}>{inline(line.replace(/^\s*>\s?/, ""))}</blockquote>);
      i++;
    } else {
      para.push(line.trim());
      i++;
    }
  }
  flush();
  return <div className="md">{blocks.map((b, j) => <Fragment key={j}>{b}</Fragment>)}</div>;
}

/** Texto plano para la vista previa de las tarjetas */
export function plainPreview(md: string, max = 220) {
  const t = clickupClean(md)
    .split("\n")
    .filter((l) => l.trim() && !/^#/.test(l) && !/^\s*\|/.test(l) && !/^\s*(@[\p{L} ]+\s*)+$/u.test(l))
    .map((l) => l.replace(/^\s*([*\-+]|\d+[.)])\s+/, "").replace(/[*_`#>]/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim())
    .join(" · ");
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
