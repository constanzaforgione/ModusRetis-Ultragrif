// Importar un calendario de redes desde un HTML (exportado de Notion, Google Docs, Canva, Excel,
// armado a mano o generado con IA). No hay un formato fijo, así que se prueban cuatro lecturas y se
// usa la primera que encuentra piezas:
//   1. datos dentro de un <script> (const posts = [{ fecha, red, copy… }])
//   2. tabla con una fila por pieza (columnas Fecha, Red, Formato, Copy…)
//   3. grilla de calendario (tabla o divs con un número de día y las piezas adentro)
//   4. tarjetas sueltas con fecha, red y textos con rótulos ("Copy: …", "Hashtags: …")
// Lo que no se reconoce queda en notas; en la app se revisa todo antes de importar.
import type { Network, PostFormat, PostStatus } from "./types";

export interface ImportedPiece {
  date: string | null;
  time: string | null;
  networks: Network[];
  format: PostFormat | null;
  title: string;
  copy: string;
  hashtags: string;
  pillar: string;
  brief: string;
  cta: string;
  asset_url: string;
  status: PostStatus | null;
  notes: string;
}

export interface ImportResult {
  pieces: ImportedPiece[];
  /** Nombre del cliente si aparece en el título o encabezados */
  client: string | null;
  method: "script" | "tabla" | "grilla" | "tarjetas" | null;
  year: number;
}

type Field = keyof ImportedPiece;

// ---------------------------------------------------------------- texto
export const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const MONTHS: Record<string, number> = {
  enero: 1, ene: 1, january: 1, jan: 1,
  febrero: 2, feb: 2, february: 2,
  marzo: 3, mar: 3, march: 3,
  abril: 4, abr: 4, april: 4, apr: 4,
  mayo: 5, may: 5,
  junio: 6, jun: 6, june: 6,
  julio: 7, jul: 7, july: 7,
  agosto: 8, ago: 8, august: 8, aug: 8,
  septiembre: 9, setiembre: 9, sep: 9, sept: 9, set: 9, september: 9,
  octubre: 10, oct: 10, october: 10,
  noviembre: 11, nov: 11, november: 11,
  diciembre: 12, dic: 12, december: 12, dec: 12,
};
const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");
const WEEKDAYS = ["lun", "mar", "mie", "jue", "vie", "sab", "dom", "mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const pad = (n: number) => String(n).padStart(2, "0");
function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null;
}

export interface Ctx {
  year: number;
  month: number | null;
}

/** Fecha en cualquier forma habitual: 2026-10-14, 14/10/2026, 14/10, 14 de octubre, oct 14, lunes 14 oct */
export function parseDate(text: string, ctx: Ctx): string | null {
  const t = norm(text);
  let m = t.match(/\b(20\d\d)-(\d{1,2})-(\d{1,2})\b/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = t.match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : ctx.year;
    return iso(y, +m[2], +m[1]);
  }
  m = t.match(new RegExp(`\\b(\\d{1,2})(?:º|°)?\\s*(?:de\\s+)?(${MONTH_RE})\\.?(?:\\s*(?:de\\s+|del\\s+)?(20\\d\\d))?\\b`));
  if (m) return iso(m[3] ? +m[3] : ctx.year, MONTHS[m[2]], +m[1]);
  m = t.match(new RegExp(`\\b(${MONTH_RE})\\.?\\s+(\\d{1,2})\\b(?:,?\\s*(20\\d\\d))?`));
  if (m) return iso(m[3] ? +m[3] : ctx.year, MONTHS[m[1]], +m[2]);
  return null;
}

/** "18:30", "18.30", "18h", "18 hs", "6pm" → "18:30:00" */
export function parseTime(text: string): string | null {
  const t = norm(text);
  let m = t.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\s*(am|pm)?\b/);
  if (m) {
    let h = +m[1];
    if (m[3] === "pm" && h < 12) h += 12;
    return `${pad(h)}:${m[2]}:00`;
  }
  m = t.match(/\b([01]?\d|2[0-3])\s*(hs|h|am|pm)\b/);
  if (m) {
    let h = +m[1];
    if (m[2] === "pm" && h < 12) h += 12;
    return `${pad(h)}:00:00`;
  }
  return null;
}

export function detectNetworks(text: string): Network[] {
  const t = norm(text);
  const out: Network[] = [];
  if (/instagram|\binsta\b|\big\b|\breels?\b/.test(t)) out.push("instagram");
  if (/linked\s?in|\bli\b|\blnkd\b/.test(t)) out.push("linkedin");
  if (/tik\s?tok|\btt\b/.test(t)) out.push("tiktok");
  return out;
}

export function detectFormat(text: string): PostFormat | null {
  const t = norm(text);
  if (/carrusel|carousel|slides?\b/.test(t)) return "carrusel";
  if (/\breels?\b/.test(t)) return "reel";
  if (/historias?\b|stor(y|ies)\b/.test(t)) return "historia";
  if (/articulo|article|newsletter|nota\b/.test(t)) return "articulo";
  if (/\bvideos?\b|youtube|short/.test(t)) return "video";
  if (/\bpost\b|posteo|publicacion|placa|imagen|estatic|foto|feed|infograf/.test(t)) return "post";
  return null;
}

export function detectStatus(text: string): PostStatus | null {
  const t = norm(text);
  if (/publicad|posteado|subido|\blive\b|published/.test(t)) return "publicada";
  if (/programad|agendad|scheduled/.test(t)) return "programada";
  if (/aprobad|\bok\b|listo para|approved/.test(t)) return "aprobada";
  if (/revision|revisar|a revisar|feedback|review/.test(t)) return "en_revision";
  if (/produccion|diseno|disenando|en proceso|en curso|editando|grabando|in progress/.test(t)) return "en_produccion";
  if (/idea|pendiente|borrador|draft|to ?do|por hacer/.test(t)) return "idea";
  return null;
}

// Rótulos de columna o de campo → campo de la pieza
const LABELS: [RegExp, Field][] = [
  [/^(fecha|dia|day|date|publicacion|fecha de publicacion|cuando)$/, "date"],
  [/^(hora|horario|time|hour)$/, "time"],
  [/^(red|redes|red social|redes sociales|plataforma|plataformas|canal|canales|network|networks|platform)$/, "networks"],
  [/^(formato|tipo|tipo de pieza|tipo de contenido|format|type|pieza)$/, "format"],
  [/^(titulo|tema|idea|concepto|contenido|asunto|nombre|title|topic|headline|gancho|hook)$/, "title"],
  [/^(copy|caption|texto|text|descripcion|copy final|texto del post|bajada|cuerpo)$/, "copy"],
  [/^(hashtags?|#|tags)$/, "hashtags"],
  [/^(pilar|pilar de contenido|categoria|eje|objetivo|category|pillar|linea)$/, "pillar"],
  [/^(brief|visual|arte|diseno|idea visual|indicaciones|referencia visual|guion|guion visual|script|descripcion visual)$/, "brief"],
  [/^(cta|llamado a la accion|call to action)$/, "cta"],
  [/^(link|links|url|drive|canva|figma|archivo|material|assets?|arte final)$/, "asset_url"],
  [/^(estado|status|etapa)$/, "status"],
  [/^(notas?|observaciones|obs|comentarios?|comments?|notes?)$/, "notes"],
];
export function fieldFor(label: string): Field | null {
  const l = norm(label).replace(/[:*·•\-–]+$/g, "").replace(/\s*\(.*\)$/, "").trim();
  if (!l || l.length > 40) return null;
  for (const [re, f] of LABELS) if (re.test(l)) return f;
  return null;
}

const empty = (): ImportedPiece => ({
  date: null, time: null, networks: [], format: null, title: "", copy: "", hashtags: "", pillar: "",
  brief: "", cta: "", asset_url: "", status: null, notes: "",
});

const addText = (cur: string, v: string) => (cur ? `${cur}\n${v}` : v);

function setField(p: ImportedPiece, f: Field, raw: string, ctx: Ctx, label?: string) {
  const v = raw.trim();
  if (!v) return;
  switch (f) {
    case "date":
      p.date ??= parseDate(v, ctx);
      p.time ??= parseTime(v.replace(/\b\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?\b/, ""));
      break;
    case "time":
      p.time ??= parseTime(v);
      break;
    case "format":
      p.format ??= detectFormat(v);
      for (const n of detectNetworks(v)) if (!p.networks.includes(n)) p.networks.push(n);
      break;
    case "status":
      p.status ??= detectStatus(v);
      break;
    case "title":
      if (!p.title) p.title = v.slice(0, 200);
      else if (v.length > 80) p.brief = addText(p.brief, v);
      else p.notes = addText(p.notes, `${label ?? "Tema"}: ${v}`);
      break;
    case "networks": {
      const nets = detectNetworks(v);
      for (const n of nets) if (!p.networks.includes(n)) p.networks.push(n);
      p.format ??= detectFormat(v);
      if (!nets.length && label) p.notes = addText(p.notes, `${label}: ${v}`);
      break;
    }
    case "hashtags":
      p.hashtags = addText(p.hashtags, v);
      break;
    case "asset_url":
      if (!p.asset_url && /^https?:\/\//.test(v)) p.asset_url = v;
      else p.notes = addText(p.notes, `${label ?? "Link"}: ${v}`);
      break;
    default:
      p[f] = addText(p[f] as string, v) as never;
  }
}

/** Ajustes finales: título si faltaba, hashtags sueltos en el copy, formato por defecto */
function finish(p: ImportedPiece): ImportedPiece | null {
  if (!p.hashtags) {
    const tags = p.copy.match(/(^|\s)#[\p{L}\d_]+/gu);
    if (tags && tags.length >= 2) {
      const lastLine = p.copy.trim().split("\n").pop() ?? "";
      if (/^(\s*#[\p{L}\d_]+)+\s*$/u.test(lastLine)) {
        p.hashtags = lastLine.trim();
        p.copy = p.copy.trim().split("\n").slice(0, -1).join("\n").trim();
      }
    }
  }
  if (!p.title) {
    const src = p.copy || p.brief || p.notes;
    const first = src.split(/\n|(?<=[.!?])\s/)[0]?.trim() ?? "";
    p.title = first.length > 90 ? `${first.slice(0, 87)}…` : first;
  }
  if (!p.title && !p.copy && !p.brief) return null;
  p.format ??= detectFormat(p.title);
  if (!p.format && p.networks.length === 1 && p.networks[0] === "tiktok") p.format = "video";
  return p;
}

// ---------------------------------------------------------------- DOM
const BLOCK = new Set(["P", "DIV", "LI", "TR", "BR", "H1", "H2", "H3", "H4", "H5", "H6", "SECTION", "ARTICLE", "HEADER", "FOOTER", "UL", "OL", "TABLE", "BLOCKQUOTE", "PRE", "DT", "DD"]);

/** Texto del elemento respetando los saltos entre bloques */
function linesOf(el: Element): string[] {
  const out: string[] = [];
  let cur = "";
  const walk = (n: Node) => {
    if (n.nodeType === 3) {
      cur += n.textContent ?? "";
      return;
    }
    if (n.nodeType !== 1) return;
    const e = n as Element;
    if (e.tagName === "SCRIPT" || e.tagName === "STYLE") return;
    const block = BLOCK.has(e.tagName) || e.tagName === "TD" || e.tagName === "TH";
    if (block && cur.trim()) {
      out.push(cur);
      cur = "";
    }
    if (e.tagName === "BR") {
      out.push(cur);
      cur = "";
      return;
    }
    // <span>Instagram</span><span>Reel</span> no tiene que quedar "InstagramReel"
    if (!block && cur && !/\s$/.test(cur)) cur += " ";
    e.childNodes.forEach(walk);
    if (!block && cur && !/\s$/.test(cur)) cur += " ";
    if (block && cur.trim()) {
      out.push(cur);
      cur = "";
    }
  };
  walk(el);
  if (cur.trim()) out.push(cur);
  return out.map((l) => l.replace(/[ \t ]+/g, " ").trim()).filter(Boolean);
}

const attrs = (el: Element) =>
  [el.getAttribute("class"), el.getAttribute("data-network"), el.getAttribute("data-red"), el.getAttribute("title"), el.getAttribute("alt"), el.getAttribute("aria-label")]
    .filter(Boolean)
    .join(" ");

/** Redes que aparecen como íconos o clases (img alt, class="ig", data-network…) */
function networksFromAttrs(el: Element): Network[] {
  const bits = [attrs(el), ...[...el.querySelectorAll("*")].map(attrs)].join(" ").replace(/[-_]/g, " ");
  return detectNetworks(bits);
}

function linkOf(el: Element): string {
  const links = [...el.querySelectorAll("a[href]")].map((a) => a.getAttribute("href") ?? "").filter((h) => /^https?:\/\//.test(h));
  return links.find((h) => /drive|docs\.google|canva|figma|dropbox|frame\.io|wetransfer/.test(h)) ?? links[0] ?? "";
}

/** Una pieza a partir de un bloque de texto con rótulos ("Copy: …") */
function pieceFromElement(el: Element, ctx: Ctx, base?: Partial<ImportedPiece>): ImportedPiece | null {
  const p = { ...empty(), ...base, networks: [...(base?.networks ?? [])] };
  // Partes marcadas con clases (class="copy", "hashtags", "titulo"…)
  const claimed = new Set<Element>();
  for (const e of el.querySelectorAll("[class]")) {
    const cls = norm(e.getAttribute("class") ?? "").split(/[\s_-]+/);
    const f = cls.map((c) => fieldFor(c) ?? (c === "caption" ? "copy" : c === "tag" ? "hashtags" : null)).find(Boolean) ?? null;
    if (!f || f === "date" || [...claimed].some((c) => c.contains(e))) continue;
    const text = linesOf(e).join("\n");
    if (!text || text.length > 4000) continue;
    claimed.add(e);
    // "Copy: texto" adentro de un elemento con clase: se saca el rótulo
    const lab = text.match(/^([^:\n]{1,30}):\s*([\s\S]*)$/);
    setField(p, f, lab && fieldFor(lab[1]) === f ? lab[2] : text, ctx);
  }
  const lines = linesOf(el).filter((l) => ![...claimed].some((c) => (c.textContent ?? "").includes(l)));
  let current: Field | null = null;
  const loose: string[] = [];
  for (const line of lines) {
    const lab = line.match(/^([^:]{1,40}):\s*(.*)$/);
    const f = lab ? fieldFor(lab[1]) : null;
    if (f) {
      current = f;
      if (lab![2]) setField(p, f, lab![2], ctx, lab![1].trim());
      continue;
    }
    if (current && ["copy", "brief", "notes", "hashtags", "cta"].includes(current)) {
      setField(p, current, line, ctx);
      continue;
    }
    current = null;
    loose.push(line);
  }
  // Líneas sin rótulo: fecha, red, formato, estado, hashtags o el título
  const tagOnly = (s: string) => {
    const r = norm(s).replace(/instagram|linkedin|tiktok|\b(ig|tt|li|reels?|post|carrusel|historias?|stor(y|ies)|video)\b|[·|/,+&\-–y]/g, "").trim();
    return (detectNetworks(s).length > 0 || detectFormat(s) !== null) && r.length < 4;
  };
  for (let line of loose) {
    // "IG · Reel · Feriado: cerramos" → red y formato, y el resto es el título
    const parts = line.split(/\s*[·|•]\s*/);
    while (parts.length > 1 && tagOnly(parts[0])) {
      const head = parts.shift()!;
      detectNetworks(head).forEach((x) => !p.networks.includes(x) && p.networks.push(x));
      p.format ??= detectFormat(head);
    }
    line = parts.join(" · ");
    const n = norm(line);
    const short = line.length <= 60;
    if (short && !p.date && parseDate(line, ctx)) {
      p.date = parseDate(line, ctx);
      p.time ??= parseTime(line.replace(/\b\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?\b/, ""));
      continue;
    }
    if (short && !p.time && parseTime(line) && n.replace(/[\d:.hsapm ]/g, "").length < 3) {
      p.time = parseTime(line);
      continue;
    }
    if (/^(#[\p{L}\d_]+[\s,]*)+$/u.test(line)) {
      p.hashtags = addText(p.hashtags, line);
      continue;
    }
    const nets = short ? detectNetworks(line) : [];
    const fmt = short ? detectFormat(line) : null;
    const st = short ? detectStatus(line) : null;
    if (short && tagOnly(line)) {
      nets.forEach((x) => !p.networks.includes(x) && p.networks.push(x));
      p.format ??= fmt;
      continue;
    }
    if (st && n.length < 25) {
      p.status ??= st;
      continue;
    }
    if (/^\d{1,2}$/.test(n)) continue; // número de día suelto
    if (!p.title && short) p.title = line;
    else p.copy = addText(p.copy, line);
  }
  for (const x of networksFromAttrs(el)) if (!p.networks.includes(x)) p.networks.push(x);
  if (!p.asset_url) p.asset_url = linkOf(el);
  return finish(p);
}

// ---------------------------------------------------------------- 1. datos en <script>
// Muchos calendarios (los armados con IA, por ejemplo) guardan las piezas en el código y las dibujan con
// JavaScript: const posts = [{ date, topic, copy… }] o const data = { 3: { f: ["reel"], product… } }.
// No se ejecuta nada: se leen los literales, con sus constantes (const LINK = "…") y sus diccionarios.

/** Convierte un literal JS a JSON: claves sin comillas o numéricas, comillas simples, comas finales,
 *  comentarios, constantes conocidas, "texto" + CONSTANTE y llamadas a funciones (quedan en null) */
export function jsToJson(src: string, consts: Map<string, unknown> = new Map()): string {
  let out = "";
  let i = 0;
  const nextChar = (k: number) => {
    while (/\s/.test(src[k] ?? "")) k++;
    return { k, c: src[k] };
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\") {
          const nx = src[j + 1];
          s += nx === "n" ? "\n" : nx === "t" ? "\t" : nx;
          j += 2;
          continue;
        }
        s += src[j];
        j++;
      }
      if (c === "`" && s.includes("${")) throw new Error("plantilla con variables");
      out += JSON.stringify(s);
      i = j + 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i = src.indexOf("*/", i + 2);
      if (i < 0) break;
      i += 2;
      continue;
    }
    if (/[0-9]/.test(c) && !/[\w$.]/.test(src[i - 1] ?? "")) {
      let j = i;
      while (/[0-9.]/.test(src[j] ?? "")) j++;
      const num = src.slice(i, j);
      out += nextChar(j).c === ":" ? JSON.stringify(num) : num; // { 3: {...} } → { "3": {...} }
      i = j;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < src.length && /[\w$]/.test(src[j])) j++;
      const word = src.slice(i, j);
      const nx = nextChar(j);
      if (nx.c === ":" && src[nx.k + 1] !== ":") out += JSON.stringify(word);
      else if (["true", "false", "null"].includes(word)) out += word;
      else if (word === "undefined") out += "null";
      else if (nx.c === "(") {
        // R(), R(0, "Día libre") → null: no se ejecuta código
        let depth = 0;
        let q: string | null = null;
        let k = nx.k;
        for (; k < src.length; k++) {
          const ch = src[k];
          if (q) {
            if (ch === "\\") k++;
            else if (ch === q) q = null;
          } else if (ch === '"' || ch === "'" || ch === "`") q = ch;
          else if (ch === "(") depth++;
          else if (ch === ")" && --depth === 0) break;
        }
        out += "null";
        i = k + 1;
        continue;
      } else if (consts.has(word)) out += JSON.stringify(consts.get(word));
      else throw new Error(`identificador ${word}`);
      i = j;
      continue;
    }
    if (c === ",") {
      const nx = nextChar(i + 1);
      if (nx.c === "]" || nx.c === "}") {
        i++;
        continue;
      }
    }
    out += c;
    i++;
  }
  // "texto: " + "https://…" → un solo texto
  const STR = String.raw`"(?:[^"\\]|\\.)*"`;
  const concat = new RegExp(`(${STR})\\s*\\+\\s*(${STR})`);
  for (let m = out.match(concat); m; m = out.match(concat)) out = out.replace(m[0], JSON.stringify(JSON.parse(m[1]) + JSON.parse(m[2])));
  return out;
}

/** Hasta dónde llega el valor que empieza en `from` (el ; o fin de línea fuera de strings y paréntesis) */
function exprEnd(code: string, from: number): number {
  let depth = 0;
  let q: string | null = null;
  for (let i = from; i < code.length; i++) {
    const c = code[i];
    if (q) {
      if (c === "\\") i++;
      else if (c === q) q = null;
      continue;
    }
    if (c === "/" && code[i + 1] === "/" && depth === 0) return i;
    if (c === '"' || c === "'" || c === "`") q = c;
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (depth === 0 && (c === ";" || c === "\n")) {
      // una línea que termina con + o , sigue en la de abajo
      if (c === "\n" && /[+,]\s*$/.test(code.slice(from, i))) continue;
      return i;
    }
  }
  return code.length;
}

/** Literales del script: const/let/var con valor simple (texto, número, arreglo u objeto), más arreglos sueltos */
function literalsInScript(code: string): { consts: Map<string, unknown>; values: unknown[] } {
  const consts = new Map<string, unknown>();
  const values: unknown[] = [];
  const decl = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g;
  let m: RegExpExecArray | null;
  while ((m = decl.exec(code))) {
    const from = m.index + m[0].length;
    const end = exprEnd(code, from);
    try {
      const v = JSON.parse(jsToJson(code.slice(from, end), consts));
      consts.set(m[1], v);
      if (v && typeof v === "object") values.push(v);
    } catch {
      // función, cálculo o algo que no es un dato: se ignora
    }
  }
  // Arreglos sin nombre: render([{ … }])
  const re = /\[\s*\{/g;
  while ((m = re.exec(code))) {
    let depth = 0;
    let q: string | null = null;
    let end = -1;
    for (let i = m.index; i < code.length; i++) {
      const c = code[i];
      if (q) {
        if (c === "\\") i++;
        else if (c === q) q = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") q = c;
      else if (c === "[" || c === "{") depth++;
      else if ((c === "]" || c === "}") && --depth === 0) {
        end = i;
        break;
      }
    }
    if (end < 0) break;
    try {
      values.push(JSON.parse(jsToJson(code.slice(m.index, end + 1), consts)));
      re.lastIndex = end + 1;
    } catch {}
  }
  return { consts, values };
}

const TITLE_KEYS = ["title", "titulo", "tema", "topic", "idea", "nombre", "name", "product", "producto", "copy", "caption", "texto", "text", "headline", "hook", "gancho"];

// Claves habituales en datos de calendarios → campo (y rótulo cuando va a notas o brief)
const DATA_KEYS: [RegExp, Field | "formats" | "skip", string?][] = [
  [/^(product|producto|topic|tema|asunto)$/, "title"],
  [/^(f|fmt|formats|formatos|tipos)$/, "formats"],
  [/^(creative|creatividad|arte|visual|direccion de arte|brief)$/, "brief"],
  [/^(concept|concepto|idea central)$/, "brief", "Concepto"],
  [/^(dev|desarrollo|guion|script|slides|placas|escenas)$/, "brief", "Desarrollo"],
  [/^(prod|produccion|material de produccion)$/, "notes", "Producción"],
  [/^(chan|channel|canal destino|link a|destino)$/, "notes", "Link a"],
  [/^(objective|objetivo|goal)$/, "pillar", "Objetivo"],
  [/^(persona|publico|audiencia|audience|target)$/, "notes", "Público"],
  [/^(comment|primer comentario|first comment)$/, "notes", "Primer comentario"],
  [/^(tips|recomendacion|recomendaciones)$/, "notes", "Recomendación"],
  [/^(planb|plan b)$/, "notes", "Plan B"],
  [/^(verify|chequear|checklist)$/, "notes", "Chequear antes de publicar"],
  [/^(warn|warning|atencion|ojo)$/, "notes", "Atención"],
  [/^(src|source|sources|fuentes|material|materiales)$/, "notes", "Material"],
  [/^(via|red|network|platform)$/, "networks"],
  [/^(id|key|color|icon|emoji|order|orden|changed|cambio|label|rest|ready|listo|done)$/, "skip"],
];
function dataField(key: string): [Field | "formats" | "skip", string?] | null {
  const k = norm(key).replace(/[_-]+/g, " ");
  for (const [re, f, label] of DATA_KEYS) if (re.test(k)) return [f, label];
  const f = fieldFor(key);
  return f ? [f] : null;
}

/** Formatos en lista (["reel", "st"]): el principal y si además lleva historias */
function formatFromList(list: string[]): { format: PostFormat | null; stories: boolean } {
  const fmts = list.map((x) => {
    const t = norm(String(x));
    if (/^(st|sts|story|stories|historias?)$/.test(t)) return "historia" as PostFormat;
    if (/^carr/.test(t)) return "carrusel" as PostFormat;
    return detectFormat(t);
  });
  const main = fmts.find((f) => f && f !== "historia") ?? fmts.find(Boolean) ?? null;
  return { format: main, stories: main !== "historia" && fmts.includes("historia") };
}

const clean = (s: string) =>
  s
    .replace(/^\s*[—–-]\s*$/, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();

/** Recorre los datos: cada objeto con texto es una pieza; la fecha sale del propio objeto, de una clave de día
 *  ({ 3: {...} } = día 3 del mes) o de un contenedor. Los códigos (pillar: "p2") se traducen con los diccionarios del script. */
function piecesFromData(data: unknown, ctx: Ctx, dicts: unknown[] = []): ImportedPiece[] {
  const out: ImportedPiece[] = [];
  const lookup = (code: string): string => {
    for (const d of dicts) {
      if (!d || typeof d !== "object" || Array.isArray(d) || !(code in (d as object))) continue;
      const v = (d as Record<string, unknown>)[code];
      if (typeof v === "string") return v;
      if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        const name = o.name ?? o.nombre ?? o.label ?? o.title ?? o.titulo;
        if (typeof name === "string") return name;
      }
    }
    return code;
  };
  const put = (p: ImportedPiece, f: Field, v: string, label?: string) => {
    if (!v) return;
    if (f === "pillar" && p.pillar) return void (p.notes = addText(p.notes, `${label ?? "Pilar"}: ${v}`));
    if ((f === "notes" || f === "brief") && label) v = v.includes("\n") ? `${label}:\n${v}` : `${label}: ${v}`;
    setField(p, f, v, ctx, label);
  };
  const walk = (v: unknown, inherited: Partial<ImportedPiece>, depth: number, key?: string) => {
    if (depth > 8 || v == null || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach((x) => walk(x, inherited, depth + 1));
    const o = v as Record<string, unknown>;
    if (o.rest === true || o.descanso === true || o.libre === true) return; // días sin publicación
    const p = { ...empty(), ...inherited, networks: [...(inherited.networks ?? [])] };
    if (!p.date && key && /^\d{1,2}$/.test(key) && ctx.month) p.date = iso(ctx.year, ctx.month, Number(key));
    let mon: number | null = null;
    let dayN: number | null = null;
    let hasText = false;
    const nested: [string, unknown][] = [];
    for (const [k, val] of Object.entries(o)) {
      const nk = norm(k);
      const df = dataField(k);
      if (df?.[0] === "skip") {
        if (/^(ready|listo|done)$/.test(nk) && val === true) p.status ??= "aprobada";
        continue;
      }
      if (val == null || val === "" || typeof val === "boolean") continue;
      if (Array.isArray(val) && val.every((x) => x == null || typeof x !== "object")) {
        const items = val.filter((x) => x != null && x !== "").map((x) => clean(lookup(String(x))));
        if (!items.length) continue;
        if (df?.[0] === "formats" || (df?.[0] === "format" && items.length > 1)) {
          const { format, stories } = formatFromList(items);
          p.format ??= format;
          if (stories) p.notes = addText(p.notes, "También lleva stories.");
        } else if (df?.[0] === "networks" || /^(redes|networks|platforms|plataformas|canales)$/.test(nk)) setField(p, "networks", items.join(" "), ctx);
        else if (df?.[0] === "hashtags" || /^(hashtags|tags)$/.test(nk)) setField(p, "hashtags", items.map((x) => (x.startsWith("#") ? x : `#${x}`)).join(" "), ctx);
        else if (df) put(p, df[0], df[0] === "brief" || df[0] === "notes" ? items.map((x) => `• ${x}`).join("\n") : items.join(", "), df[1] ?? (df[0] === "notes" ? k : undefined));
        continue;
      }
      if (typeof val === "object") {
        nested.push([k, val]);
        continue;
      }
      const s = clean(String(val));
      if (/^(mes|month)$/.test(nk)) {
        mon = typeof val === "number" ? val : (MONTHS[norm(s)] ?? (Number(s) || null));
        continue;
      }
      if (/^(anio|ano|year)$/.test(nk)) continue;
      const f = df?.[0] === "formats" ? "format" : (df?.[0] as Field | undefined);
      if (f === "date" && /^\d{1,2}$/.test(s)) {
        dayN = Number(s);
        continue;
      }
      if (f) {
        put(p, f, f === "pillar" ? lookup(s) : s, df?.[1]);
        if (TITLE_KEYS.includes(nk) || f === "title" || f === "copy") hasText = true;
      } else if (s.length < 300) {
        p.notes = addText(p.notes, `${k}: ${s}`);
      }
    }
    if (dayN && !p.date) p.date = iso(ctx.year, mon ?? ctx.month ?? 1, dayN);
    if (hasText) {
      const done = finish(p);
      if (done) out.push(done);
    }
    // Lo anidado hereda fecha, hora y redes de este objeto
    const inh: Partial<ImportedPiece> = { ...inherited };
    if (p.date) inh.date = p.date;
    if (p.time) inh.time = p.time;
    if (p.networks.length) inh.networks = p.networks;
    if (p.format) inh.format = p.format;
    nested.forEach(([k, n]) => walk(n, hasText ? inherited : inh, depth + 1, k));
  };
  walk(data, {}, 0);
  return out;
}

function fromScripts(doc: Document, ctx: Ctx): ImportedPiece[] {
  let best: ImportedPiece[] = [];
  for (const s of doc.querySelectorAll("script:not([src])")) {
    const type = s.getAttribute("type") ?? "";
    if (/json/.test(type)) {
      try {
        const pieces = piecesFromData(JSON.parse(s.textContent ?? ""), ctx).filter((p) => p.date);
        if (pieces.length > best.length) best = pieces;
      } catch {}
      continue;
    }
    const { values } = literalsInScript(s.textContent ?? "");
    for (const v of values) {
      const pieces = piecesFromData(v, ctx, values).filter((p) => p.date);
      if (pieces.length > best.length) best = pieces;
    }
  }
  return best;
}

// ---------------------------------------------------------------- 2 y 3. tablas
function rowsOf(table: Element): Element[][] {
  return [...table.querySelectorAll("tr")].filter((tr) => tr.closest("table") === table).map((tr) => [...tr.children].filter((c) => c.tagName === "TD" || c.tagName === "TH"));
}

const isWeekday = (s: string) => {
  const n = norm(s).replace(/[^a-z]/g, "");
  return n.length >= 2 && WEEKDAYS.some((w) => n.startsWith(w));
};

function fromTables(doc: Document, ctx: Ctx): { pieces: ImportedPiece[]; grid: boolean } {
  let best: ImportedPiece[] = [];
  let grid = false;
  for (const table of doc.querySelectorAll("table")) {
    if (table.querySelector("table")) continue; // la de afuera de una tabla anidada
    const rows = rowsOf(table);
    if (rows.length < 2) continue;
    const head = rows[0].map((c) => (c.textContent ?? "").trim());

    // Grilla de calendario: encabezados con días de la semana
    if (head.filter(isWeekday).length >= 5) {
      const pieces = piecesFromGridCells(rows.slice(1).flat(), ctx, monthFor(table, ctx));
      if (pieces.length > best.length) {
        best = pieces;
        grid = true;
      }
      continue;
    }

    // Una fila por pieza: las columnas dicen qué es cada cosa
    const cols = head.map((h) => fieldFor(h));
    if (cols.filter(Boolean).length < 2 || !cols.some((c) => c === "date" || c === "title" || c === "copy")) continue;
    const pieces: ImportedPiece[] = [];
    let lastDate: string | null = null;
    for (const r of rows.slice(1)) {
      if (r.length < 2) continue;
      const p = empty();
      r.forEach((cell, i) => {
        const text = linesOf(cell).join("\n");
        const f = cols[i];
        if (f === "networks") for (const n of networksFromAttrs(cell)) if (!p.networks.includes(n)) p.networks.push(n);
        if (f === "asset_url" && !text.startsWith("http")) {
          const href = linkOf(cell);
          if (href) return setField(p, f, href, ctx);
        }
        if (f) setField(p, f, text, ctx, head[i]);
        else if (text && head[i]) p.notes = addText(p.notes, `${head[i]}: ${text}`);
      });
      if (!p.asset_url) p.asset_url = r.map(linkOf).find(Boolean) ?? "";
      // Celdas de fecha combinadas (rowspan): la fila hereda la fecha de la anterior
      if (!p.date && lastDate && cols.includes("date")) p.date = lastDate;
      lastDate = p.date ?? lastDate;
      const done = finish(p);
      if (done) pieces.push(done);
    }
    if (pieces.length > best.length) {
      best = pieces;
      grid = false;
    }
  }
  return { pieces: best, grid };
}

/** Mes de una grilla: el encabezado más cercano antes de la tabla ("Octubre 2026") */
function monthFor(el: Element, ctx: Ctx): Ctx {
  const caption = el.querySelector("caption")?.textContent ?? "";
  const tryText = (t: string) => {
    const m = norm(t).match(new RegExp(`\\b(${MONTH_RE})\\b\\.?\\s*(?:de\\s+|del\\s+)?(20\\d\\d)?`));
    return m ? { month: MONTHS[m[1]], year: m[2] ? +m[2] : ctx.year } : null;
  };
  const fromCaption = tryText(caption);
  if (fromCaption) return fromCaption;
  let node: Element | null = el;
  for (let up = 0; node && up < 4; up++, node = node.parentElement) {
    let sib = node.previousElementSibling;
    for (let i = 0; sib && i < 6; i++, sib = sib.previousElementSibling) {
      const t = sib.textContent ?? "";
      if (t.length < 80) {
        const r = tryText(t);
        if (r) return r;
      }
    }
  }
  return ctx;
}

/** Celdas de una grilla mensual: número de día + piezas adentro. Los días del mes anterior/siguiente se corren. */
function piecesFromGridCells(cells: Element[], ctx: Ctx, mctx: Ctx): ImportedPiece[] {
  const out: ImportedPiece[] = [];
  let phase = 0; // 0 antes del día 1, 1 en el mes, 2 mes siguiente
  let last = 0;
  for (const cell of cells) {
    const lines = linesOf(cell);
    const day = Number((lines[0] ?? "").match(/^(\d{1,2})\b/)?.[1] ?? NaN);
    if (!day || day > 31) continue;
    if (phase === 0 && day === 1) phase = 1;
    else if (phase === 1 && day < last) phase = 2;
    last = day;
    const month = mctx.month ?? 1;
    const [y, m] = phase === 0 && day > 7 ? (month === 1 ? [mctx.year - 1, 12] : [mctx.year, month - 1]) : phase === 2 ? (month === 12 ? [mctx.year + 1, 1] : [mctx.year, month + 1]) : [mctx.year, month];
    const date = iso(y, m, day);
    // Cada hijo con contenido es una pieza; si no hay hijos claros, la celda entera
    const items = itemsIn(cell).filter((e) => !/^\d{1,2}$/.test((e.textContent ?? "").trim()));
    const sources = items.length ? items : lines.length > 1 ? [cell] : [];
    for (const it of sources) {
      const p = pieceFromElement(it, ctx, { date });
      if (p) out.push(p);
    }
  }
  return out;
}

/** Elementos que parecen piezas dentro de un contenedor (tarjetas, ítems de lista, chips) */
function itemsIn(container: Element): Element[] {
  const marked = [...container.querySelectorAll("[class]")].filter((e) =>
    /\b(post|pieza|piece|item|event|evento|card|chip|entry|publicacion|contenido|content)\b/.test(norm(e.getAttribute("class") ?? "").replace(/[-_]/g, " ")),
  );
  const outer = marked.filter((e) => !marked.some((o) => o !== e && o.contains(e)));
  if (outer.length) return outer;
  const lis = [...container.querySelectorAll("li")];
  if (lis.length) return lis;
  const kids = [...container.children].filter((e) => (e.textContent ?? "").trim().length > 3);
  return kids.length > 1 ? kids : [];
}

// ---------------------------------------------------------------- 4. tarjetas
function fromCards(doc: Document, ctx: Ctx): { pieces: ImportedPiece[]; grid: boolean } {
  const body = doc.body ?? doc.documentElement;

  // Grilla hecha con divs: contenedores cuyos hijos empiezan con un número de día 1–31
  const gridParents = [...body.querySelectorAll("*")].filter((el) => {
    const kids = [...el.children];
    if (kids.length < 20) return false;
    const days = kids.map((k) => Number(linesOf(k)[0]?.match(/^(\d{1,2})$/)?.[1] ?? 0)).filter((d) => d >= 1 && d <= 31);
    return days.length >= 20;
  });
  if (gridParents.length) {
    const pieces = gridParents.flatMap((g) => piecesFromGridCells([...g.children], ctx, monthFor(g, ctx)));
    if (pieces.length) return { pieces, grid: true };
  }

  // Tarjetas: el contenedor más chico que tiene red o formato y al menos dos partes
  const hint = (el: Element) => {
    const t = (el.textContent ?? "").slice(0, 3000);
    return detectNetworks(t).length > 0 || detectFormat(t) !== null || networksFromAttrs(el).length > 0;
  };
  const candidates = [...body.querySelectorAll("article, section, li, div, td")].filter(
    (el) => el.children.length >= 2 && (el.textContent ?? "").trim().length >= 15 && (el.textContent ?? "").length < 6000 && hint(el),
  );
  const cards = candidates.filter((el) => !candidates.some((o) => o !== el && el.contains(o)));
  const out: ImportedPiece[] = [];
  for (const card of cards) {
    const p = pieceFromElement(card, ctx);
    if (!p) continue;
    if (!p.date) p.date = inheritedDate(card, ctx);
    out.push(p);
  }
  return { pieces: out.filter((p) => p.date), grid: false };
}

/** Fecha de un encabezado anterior o de un contenedor ("Lunes 14/10" arriba de las tarjetas del día) */
function inheritedDate(el: Element, ctx: Ctx): string | null {
  let node: Element | null = el;
  for (let up = 0; node && up < 6; up++, node = node.parentElement) {
    let sib = node.previousElementSibling;
    for (let i = 0; sib && i < 40; i++, sib = sib.previousElementSibling) {
      const t = sib.textContent ?? "";
      if (t.length <= 80) {
        const d = parseDate(t, ctx);
        if (d) return d;
      }
    }
    const first: Element | null | undefined = node.parentElement?.firstElementChild;
    if (first && first !== node && (first.textContent ?? "").length <= 80) {
      const d = parseDate(first.textContent ?? "", ctx);
      if (d) return d;
    }
  }
  return null;
}

// ---------------------------------------------------------------- entrada
/** Año y mes de referencia: "Calendario Octubre 2026" en el título o encabezados */
function docContext(doc: Document, fallbackYear: number): Ctx {
  const heads = [doc.title || doc.querySelector("title")?.textContent || "", ...[...doc.querySelectorAll("h1, h2, h3, header, caption")].slice(0, 10).map((e) => e.textContent ?? "")].join(" · ");
  const m = norm(heads).match(new RegExp(`\\b(${MONTH_RE})\\b\\.?\\s*(?:de\\s+|del\\s+)?(20\\d\\d)`));
  if (m) return { year: +m[2], month: MONTHS[m[1]] };
  const y = norm(heads).match(/\b(20\d\d)\b/) ?? norm((doc.body?.textContent ?? "").slice(0, 4000)).match(/\b(20\d\d)\b/);
  const mo = norm(heads).match(new RegExp(`\\b(${MONTH_RE.split("|").filter((x) => x.length > 3).join("|")})\\b`));
  return { year: y ? +y[1] : fallbackYear, month: mo ? MONTHS[mo[1]] : null };
}

export function parseSocialCalendar(doc: Document, opts: { clients: string[]; fileName?: string; year?: number }): ImportResult {
  const ctx = docContext(doc, opts.year ?? new Date().getFullYear());
  const title = doc.title || doc.querySelector("title")?.textContent || "";
  const heads = norm([(opts.fileName ?? "").replace(/[_-]+/g, " "), title, ...[...doc.querySelectorAll("h1, h2, header")].slice(0, 6).map((e) => e.textContent ?? "")].join(" "));
  const client = opts.clients.find((c) => heads.includes(norm(c))) ?? null;

  let method: ImportResult["method"] = null;
  let pieces = fromScripts(doc, ctx);
  if (pieces.length) method = "script";
  if (!pieces.length) {
    const t = fromTables(doc, ctx);
    if (t.pieces.length) [pieces, method] = [t.pieces, t.grid ? "grilla" : "tabla"];
  }
  if (!pieces.length) {
    const c = fromCards(doc, ctx);
    if (c.pieces.length) [pieces, method] = [c.pieces, c.grid ? "grilla" : "tarjetas"];
  }
  // Calendario de una sola red ("LinkedIn · Ultragrif", "Instagram · @marca"): esa red para las piezas que no dicen
  const heading = [title, (opts.fileName ?? "").replace(/[_-]+/g, " "), ...[...doc.querySelectorAll("header, h1, .eyebrow")].slice(0, 4).map((e) => (e.textContent ?? "").slice(0, 300))].join(" · ");
  const docNets = detectNetworks(heading);
  if (docNets.length === 1) for (const p of pieces) if (!p.networks.length) p.networks = [...docNets];
  pieces.sort((a, b) => (a.date ?? "9").localeCompare(b.date ?? "9") || (a.time ?? "99").localeCompare(b.time ?? "99"));
  return { pieces, client, method, year: ctx.year };
}
