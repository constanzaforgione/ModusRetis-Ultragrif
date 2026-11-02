// Lectura de ClickUp (solo servidor): docs de "Resumen de avance" de cada cliente y tareas de resumen.
// Usa el token personal de ClickUp (CLICKUP_API_TOKEN) y el espacio de trabajo (CLICKUP_WORKSPACE_ID).
import { clientFromFolder, type RawPage } from "./summaries";

const V2 = "https://api.clickup.com/api/v2";
const V3 = "https://api.clickup.com/api/v3";

/** Docs que pueden tener resúmenes: "Resumen de avance", "Revisión Kumi"… */
const DOC_NAME = /resum|revisi|informe|reporte/i;
/** Tareas cuyas subtareas son resúmenes mensuales (opcional, con CLICKUP_SUMMARY_TASKS) */
const DEFAULT_PARENT_TASKS: string[] = [];

type Fetcher = typeof fetch;

export interface ClickUpConfig {
  token: string;
  workspace: string;
  parentTasks: string[];
  fresh?: boolean;
}

export function clickupConfig(fresh = false): ClickUpConfig | null {
  const token = process.env.CLICKUP_API_TOKEN;
  const workspace = process.env.CLICKUP_WORKSPACE_ID;
  if (!token || !workspace) return null;
  const parentTasks = (process.env.CLICKUP_SUMMARY_TASKS ?? DEFAULT_PARENT_TASKS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  return { token, workspace, parentTasks, fresh };
}

async function get<T>(http: Fetcher, cfg: ClickUpConfig, url: string): Promise<T> {
  const res = await http(url, {
    headers: { Authorization: cfg.token },
    ...(cfg.fresh ? { cache: "no-store" } : { next: { revalidate: 600 } }),
  } as RequestInit);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const msg = res.status === 401 ? "ClickUp rechazó el token (CLICKUP_API_TOKEN)" : `ClickUp respondió ${res.status}`;
    throw new Error(`${msg}${body ? `: ${body.slice(0, 160)}` : ""}`);
  }
  return (await res.json()) as T;
}

interface Doc {
  id: string;
  name: string;
  parent?: { id: string; type: number };
  deleted?: boolean;
  archived?: boolean;
}
interface Page {
  id: string;
  name: string;
  content?: string;
  date_created?: number | string;
  date_updated?: number | string;
  pages?: Page[];
}

const iso = (v: number | string | undefined) => new Date(Number(v) || Date.now()).toISOString();

/** Nombre del cliente según dónde está el doc: carpeta (o la carpeta de la lista) */
async function clientOf(http: Fetcher, cfg: ClickUpConfig, parent: Doc["parent"], cache: Map<string, string>) {
  if (!parent) return "Sin cliente";
  const k = `${parent.type}:${parent.id}`;
  if (cache.has(k)) return cache.get(k)!;
  let name = "Sin cliente";
  try {
    if (parent.type === 5) name = (await get<{ name: string }>(http, cfg, `${V2}/folder/${parent.id}`)).name;
    else if (parent.type === 6) {
      const l = await get<{ name: string; folder?: { name: string; hidden?: boolean } }>(http, cfg, `${V2}/list/${parent.id}`);
      name = l.folder && !l.folder.hidden ? l.folder.name : l.name;
    } else if (parent.type === 4) name = (await get<{ name: string }>(http, cfg, `${V2}/space/${parent.id}`)).name;
  } catch {}
  const client = clientFromFolder(name);
  cache.set(k, client);
  return client;
}

function flatten(pages: Page[]): Page[] {
  return pages.flatMap((p) => [p, ...flatten(p.pages ?? [])]);
}

/** Todas las páginas candidatas de los docs de resúmenes + las tareas de resumen */
export async function fetchSummaryPages(http: Fetcher, cfg: ClickUpConfig): Promise<RawPage[]> {
  // 1. Docs del espacio de trabajo
  const docs: Doc[] = [];
  let cursor = "";
  for (let i = 0; i < 20; i++) {
    const r = await get<{ docs: Doc[]; next_cursor?: string }>(http, cfg, `${V3}/workspaces/${cfg.workspace}/docs?limit=100&deleted=false&archived=false${cursor ? `&next_cursor=${encodeURIComponent(cursor)}` : ""}`);
    docs.push(...(r.docs ?? []));
    if (!r.next_cursor || r.next_cursor === cursor) break;
    cursor = r.next_cursor;
  }
  const folders = new Map<string, string>();
  const out: RawPage[] = [];

  // 2. Páginas de los docs de resúmenes (con su contenido en markdown)
  for (const d of docs.filter((x) => DOC_NAME.test(x.name) && !x.deleted && !x.archived)) {
    const client = await clientOf(http, cfg, d.parent, folders);
    const r = await get<Page[] | { pages: Page[] }>(http, cfg, `${V3}/workspaces/${cfg.workspace}/docs/${d.id}/pages?max_page_depth=-1&content_format=text/md`);
    for (const p of flatten(Array.isArray(r) ? r : (r.pages ?? []))) {
      out.push({
        key: `doc:${d.id}:${p.id}`,
        client,
        name: p.name,
        content: p.content ?? "",
        url: `https://app.clickup.com/${cfg.workspace}/docs/${d.id}/${p.id}`,
        created: iso(p.date_created),
        updated: iso(p.date_updated ?? p.date_created),
      });
    }
  }

  // 3. Tareas de resumen (subtareas de una tarea por cliente), si se configuraron
  for (const parentId of cfg.parentTasks) {
    try {
      const parent = await get<{ name: string; subtasks?: { id: string; name: string }[] }>(http, cfg, `${V2}/task/${parentId}?include_subtasks=true`);
      for (const s of (parent.subtasks ?? []).filter((x) => /res[uú]m/i.test(x.name))) {
        const t = await get<{ id: string; name: string; markdown_description?: string; description?: string; date_created: string; date_updated: string; url: string }>(
          http,
          cfg,
          `${V2}/task/${s.id}?include_markdown_description=true`,
        );
        out.push({
          key: `task:${t.id}`,
          client: clientFromFolder(parent.name),
          name: t.name,
          content: t.markdown_description ?? t.description ?? "",
          url: t.url || `https://app.clickup.com/t/${t.id}`,
          created: iso(t.date_created),
          updated: iso(t.date_updated),
        });
      }
    } catch {
      // una tarea que ya no existe no frena el resto
    }
  }
  return out;
}

// ---------------------------------------------------------------- escribir en ClickUp
/** Doc de resúmenes de un cliente: el del resumen más reciente de ese cliente */
export function summaryDocFor(pages: RawPage[], client: string): string | null {
  const n = client.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const mine = pages
    .filter((p) => p.key.startsWith("doc:"))
    .filter((p) => {
      const c = p.client.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      return c.includes(n) || n.includes(c);
    })
    .sort((a, b) => b.updated.localeCompare(a.updated));
  return mine[0]?.key.split(":")[1] ?? null;
}

/** Crea la página del resumen en el doc del cliente, o la actualiza si ya se mandó antes */
export async function sendSummaryPage(
  http: Fetcher,
  cfg: ClickUpConfig,
  p: { docId: string; pageId: string | null; name: string; content: string },
): Promise<{ key: string; url: string }> {
  const base = `${V3}/workspaces/${cfg.workspace}/docs/${p.docId}/pages`;
  const res = await http(p.pageId ? `${base}/${p.pageId}` : base, {
    method: p.pageId ? "PUT" : "POST",
    headers: { Authorization: cfg.token, "Content-Type": "application/json" },
    body: JSON.stringify(
      p.pageId
        ? { name: p.name, content: p.content, content_format: "text/md", content_edit_mode: "replace" }
        : { name: p.name, content: p.content, content_format: "text/md" },
    ),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ClickUp respondió ${res.status}${body ? `: ${body.slice(0, 160)}` : ""}`);
  }
  const page = p.pageId ? { id: p.pageId } : ((await res.json().catch(() => ({}))) as { id?: string });
  if (!page.id) throw new Error("ClickUp no devolvió la página creada");
  return { key: `doc:${p.docId}:${page.id}`, url: `https://app.clickup.com/${cfg.workspace}/docs/${p.docId}/${page.id}` };
}
