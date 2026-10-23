// Importar calendarios de redes desde HTML (lib/socialImport.ts) con distintos formatos de archivo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { parseHTML } from "linkedom";

const dir = mkdtempSync(join(tmpdir(), "social-"));
const src = readFileSync(new URL("../lib/socialImport.ts", import.meta.url), "utf8");
writeFileSync(join(dir, "socialImport.mjs"), ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
const { parseSocialCalendar, parseDate, parseTime, jsToJson } = await import(join(dir, "socialImport.mjs"));

const CLIENTS = ["Ultragrif", "Modus Retis", "Confort Iván"];
// Como los arma el navegador: siempre con <html>, <head> y <body>
const wrap = (html) => (/<html/i.test(html) ? html : `<!doctype html><html><head>${html.match(/<title>.*?<\/title>/)?.[0] ?? ""}</head><body>${html.replace(/<title>.*?<\/title>/, "")}</body></html>`);
const parse = (html, fileName) => parseSocialCalendar(parseHTML(wrap(html)).document, { clients: CLIENTS, fileName, year: 2026 });

test("fechas y horas en distintas formas", () => {
  const ctx = { year: 2026, month: 10 };
  assert.equal(parseDate("2026-11-03", ctx), "2026-11-03");
  assert.equal(parseDate("Lunes 3/11", ctx), "2026-11-03");
  assert.equal(parseDate("03/11/26", ctx), "2026-11-03");
  assert.equal(parseDate("martes 3 de noviembre", ctx), "2026-11-03");
  assert.equal(parseDate("Nov 3, 2027", ctx), "2027-11-03");
  assert.equal(parseDate("31/02", ctx), null);
  assert.equal(parseTime("18:30 hs"), "18:30:00");
  assert.equal(parseTime("a las 9h"), "09:00:00");
  assert.equal(parseTime("6pm"), "18:00:00");
});

test("literal JS a JSON", () => {
  assert.deepEqual(JSON.parse(jsToJson(`[{fecha: '2026-11-03', // comentario\n copy: "Hola, \\"che\\"", redes: ['ig', 'tt'],}]`)), [
    { fecha: "2026-11-03", copy: 'Hola, "che"', redes: ["ig", "tt"] },
  ]);
});

test("tabla con una fila por pieza", () => {
  const r = parse(`<html><head><title>Calendario RRSS Ultragrif · Noviembre 2026</title></head><body>
    <table>
      <tr><th>Fecha</th><th>Hora</th><th>Red social</th><th>Formato</th><th>Tema</th><th>Copy</th><th>Hashtags</th><th>Pilar</th><th>Estado</th><th>Arte</th><th>Responsable</th></tr>
      <tr><td>Lun 3/11</td><td>18:00</td><td>Instagram + TikTok</td><td>Reel</td><td>Lanzamiento kit distribuidoras</td>
          <td>Llegó el kit 📦<br>Pedilo hoy.</td><td>#ultragrif #ferreteria</td><td>Producto</td><td>Aprobado</td>
          <td><a href="https://drive.google.com/abc">ver</a></td><td>Yani</td></tr>
      <tr><td>Miércoles 5 de noviembre</td><td></td><td>LinkedIn</td><td>Carrusel</td><td>Casos de éxito</td><td>3 claves…</td><td></td><td>Marca</td><td>En diseño</td><td></td><td>Bárbara</td></tr>
    </table></body></html>`);
  assert.equal(r.method, "tabla");
  assert.equal(r.client, "Ultragrif");
  assert.equal(r.pieces.length, 2);
  const [a, b] = r.pieces;
  assert.deepEqual(
    { date: a.date, time: a.time, networks: a.networks, format: a.format, title: a.title, status: a.status, asset: a.asset_url, pillar: a.pillar },
    { date: "2026-11-03", time: "18:00:00", networks: ["instagram", "tiktok"], format: "reel", title: "Lanzamiento kit distribuidoras", status: "aprobada", asset: "https://drive.google.com/abc", pillar: "Producto" },
  );
  assert.equal(a.copy, "Llegó el kit 📦\nPedilo hoy.");
  assert.equal(a.hashtags, "#ultragrif #ferreteria");
  assert.match(a.notes, /Responsable: Yani/);
  assert.deepEqual([b.date, b.networks, b.format, b.status], ["2026-11-05", ["linkedin"], "carrusel", "en_produccion"]);
});

test("grilla mensual en tabla, con días del mes anterior y siguiente", () => {
  const cell = (d, inner = "") => `<td><span class="num">${d}</span>${inner}</td>`;
  const days = [27, 28, 29, 30, 31].map((d) => cell(d));
  for (let d = 1; d <= 30; d++)
    days.push(
      d === 4
        ? cell(d, `<div class="post ig"><b>Carrusel</b><p>Tips de pintura</p><p>Copy: Elegí bien tu rodillo</p></div><div class="post tiktok"><p>Reel detrás de escena</p></div>`)
        : cell(d),
    );
  days.push(cell(1, `<div class="post"><p>LinkedIn · Post</p><p>Balance del mes</p></div>`));
  const rows = [];
  for (let i = 0; i < days.length; i += 7) rows.push(`<tr>${days.slice(i, i + 7).join("")}</tr>`);
  const r = parse(`<h1>Confort Iván</h1><h2>Noviembre 2026</h2><table><tr><th>Lun</th><th>Mar</th><th>Mié</th><th>Jue</th><th>Vie</th><th>Sáb</th><th>Dom</th></tr>${rows.join("")}</table>`);
  assert.equal(r.method, "grilla");
  assert.equal(r.client, "Confort Iván");
  assert.deepEqual(
    r.pieces.map((p) => [p.date, p.networks.join(","), p.format, p.title]),
    [
      ["2026-11-04", "instagram", "carrusel", "Tips de pintura"],
      ["2026-11-04", "tiktok", "reel", "Reel detrás de escena"],
      ["2026-12-01", "linkedin", "post", "Balance del mes"],
    ],
  );
  assert.equal(r.pieces[0].copy, "Elegí bien tu rodillo");
});

test("datos dentro de un script", () => {
  const r = parse(`<title>Modus Retis — contenidos</title><div id="app"></div><script>
    const MES = "noviembre";
    const posts = [
      { fecha: "2026-11-10", hora: "12:30", redes: ["instagram", "linkedin"], formato: "carrusel", titulo: "5 errores en Meli", copy: "¿Vendés en Meli? 👇\\n#mercadolibre #ecommerce", estado: "programado" },
      { fecha: "2026-11-12", red: "TikTok", tipo: "video", idea: "Un día en Modus", brief: "Cámara en mano por la oficina" },
    ];
    render(posts);
  </script>`);
  assert.equal(r.method, "script");
  assert.equal(r.client, "Modus Retis");
  const [a, b] = r.pieces;
  assert.deepEqual([a.date, a.time, a.networks, a.format, a.title, a.status], ["2026-11-10", "12:30:00", ["instagram", "linkedin"], "carrusel", "5 errores en Meli", "programada"]);
  assert.equal(a.copy, "¿Vendés en Meli? 👇");
  assert.equal(a.hashtags, "#mercadolibre #ecommerce");
  assert.deepEqual([b.networks, b.format, b.title, b.brief], [["tiktok"], "video", "Un día en Modus", "Cámara en mano por la oficina"]);
});

test("script con semanas y días anidados", () => {
  const r = parse(`<script>window.cal = { mes: 11, semanas: [ { dias: [ { dia: 17, piezas: [ { red: "ig", formato: "historia", titulo: "Encuesta" } ] } ] } ] };
    const data = [{ dia: 17, mes: 11, piezas: [{ red: "ig", formato: "historia", titulo: "Encuesta" }, { red: "linkedin", titulo: "Nota" }] }];</script>`);
  assert.deepEqual(
    r.pieces.map((p) => [p.date, p.networks.join(","), p.title]),
    [
      ["2026-11-17", "instagram", "Encuesta"],
      ["2026-11-17", "linkedin", "Nota"],
    ],
  );
});

test("tarjetas debajo de encabezados por día", () => {
  const r = parse(`<h1>Calendario Ultragrif noviembre 2026</h1>
    <section><h3>Lunes 24/11</h3>
      <article class="card"><span class="badge">Instagram</span><span>Reel</span><h4>Promo Black Friday</h4><p>Copy: 20% off en toda la línea.</p><p>Hashtags: #blackfriday #ultragrif</p><p>Estado: Publicado</p></article>
      <article class="card"><img alt="LinkedIn" src="li.png"><span>Post</span><h4>Novedades para distribuidores</h4><p>CTA: Escribinos</p></article>
    </section>
    <section><h3>Martes 25/11</h3>
      <article class="card"><span class="badge">TikTok</span><h4>Tutorial: cómo pintar una reja</h4><p>Brief: plano cenital, 30 segundos</p></article>
    </section>`);
  assert.equal(r.method, "tarjetas");
  assert.deepEqual(
    r.pieces.map((p) => [p.date, p.networks.join(","), p.format, p.title, p.status]),
    [
      ["2026-11-24", "instagram", "reel", "Promo Black Friday", "publicada"],
      ["2026-11-24", "linkedin", "post", "Novedades para distribuidores", null],
      ["2026-11-25", "tiktok", "video", "Tutorial: cómo pintar una reja", null],
    ],
  );
  assert.equal(r.pieces[0].copy, "20% off en toda la línea.");
  assert.equal(r.pieces[0].hashtags, "#blackfriday #ultragrif");
  assert.equal(r.pieces[1].cta, "Escribinos");
  assert.equal(r.pieces[2].brief, "plano cenital, 30 segundos");
});

test("grilla hecha con divs", () => {
  const cells = [];
  for (let d = 1; d <= 30; d++) cells.push(`<div class="day"><div class="n">${d}</div>${d === 8 ? '<div class="event"><i class="icon-instagram"></i> Post · Feriado: cerramos</div>' : ""}</div>`);
  const r = parse(`<h2>Noviembre</h2><div class="grid">${cells.join("")}</div>`);
  assert.equal(r.method, "grilla");
  assert.deepEqual(r.pieces.map((p) => [p.date, p.networks.join(","), p.format, p.title]), [["2026-11-08", "instagram", "post", "Feriado: cerramos"]]);
});

test("un HTML sin calendario no inventa piezas", () => {
  const r = parse(`<h1>Hola</h1><p>Nada que ver acá.</p>`);
  assert.equal(r.pieces.length, 0);
  assert.equal(r.method, null);
});

// Calendarios reales del equipo (generados con IA: los datos están en el <script>)
const fixture = (f) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");

test("calendario real: Ultragrif LinkedIn (const posts = [...], pilares por código, LINK concatenado)", () => {
  const r = parse(fixture("ultragrif-linkedin-octubre-2026.html"), "Ultragrif_LinkedIn_Octubre_2026_1.html");
  assert.equal(r.method, "script");
  assert.equal(r.client, "Ultragrif");
  assert.equal(r.pieces.length, 13);
  assert.ok(r.pieces.every((p) => p.networks.join() === "linkedin" && p.status === "aprobada" && p.copy && p.hashtags));
  const a = r.pieces[0];
  assert.deepEqual([a.date, a.time, a.format, a.title, a.pillar], ["2026-10-01", "08:30:00", "carrusel", "Agilidad PyME vs. burocracia", "Soluciones para Obras"]);
  assert.match(a.brief, /^Portada: 'Los 3 cuellos de botella/);
  assert.match(a.first_comment, /^Conocé cómo trabaja nuestro Departamento de Obras.*https:\/\/ultragrif\.com\.ar$/);
  assert.match(a.notes, /Material:\n• Diseño en Canva\n• Fotos del catálogo web/);
  assert.equal(r.pieces.find((p) => p.date === "2026-10-20").format, "articulo");
  assert.equal(r.pieces.find((p) => p.date === "2026-10-22").format, "video");
});

test("calendario real: Confort Iván (const data = { día: {...} }, días libres con R())", () => {
  const r = parse(fixture("confort-ivan-octubre-2026.html"), "Confort_Ivan___Octubre_2026_1.html");
  assert.equal(r.method, "script");
  assert.equal(r.client, "Confort Iván");
  assert.equal(r.pieces.length, 16);
  assert.ok(r.pieces.every((p) => p.networks.join() === "instagram"));
  assert.deepEqual(
    r.pieces.map((p) => `${p.date.slice(8)} ${p.format}`),
    ["03 reel", "05 historia", "07 carrusel", "08 reel", "11 carrusel", "13 reel", "15 post", "16 historia", "18 historia", "19 historia", "20 reel", "22 carrusel", "24 post", "26 historia", "27 reel", "30 historia"],
  );
  const a = r.pieces[0];
  assert.equal(a.title, "Sillas respaldo alto");
  assert.equal(a.hashtags, "#SillasDeComedor #ConfortIvan #DecoHogar #Comedor");
  assert.doesNotMatch(a.copy, /#SillasDeComedor/);
  assert.equal(a.cta, "Link en bio");
  assert.match(a.brief, /Concepto: Mostrar un básico[\s\S]*Desarrollo:\n• Reel de 7 a 10 segundos/);
  assert.match(a.notes, /También lleva stories\.\nLink a: Web confortivan\.com\.ar\nProducción: /);
  assert.doesNotMatch(r.pieces[1].notes, /Link a/); // "—" no se importa
});

test("datos en el script con claves abreviadas (t, f, can, est, n) y .map() al final", () => {
  const r = parse(`<title>Calendario CM · Modus Retis</title><div id="grid"></div><script>
const ESTADOS=["En guion","En producción","Programado","Publicado"];
let DATA=[
{t:"Reel ERP / Odoo",tema:["Pain Points"],int:"Conversión",can:["TikTok","Instagram Reels","LinkedIn"],est:"En producción",f:"2026-11-10",orig:"2026-10-29",p:"Medio",rec:"Canva y Capcut",
n:"HOOK: ¿Trabajás con mil pestañas abiertas?"},
{t:"Reel Negocio que depende del dueño",tema:["Pain Points"],int:"Educación",can:["Instagram Reels"],est:"En guion",f:"2026-11-05",p:"Medio",rec:"",n:""},
{t:"Historia — Quiénes somos",tema:["Visión Modus"],int:"Posicionamiento",can:["Historias de Instagram"],est:"Publicado",f:"2026-08-19",p:"Alta",rec:"Canva",n:"Somos Modus Retis"}
].map((d,i)=>({...d,id:i}));
</script>`);
  assert.equal(r.method, "script");
  assert.equal(r.client, "Modus Retis");
  assert.deepEqual(
    r.pieces.map((p) => [p.date, p.title, p.networks.sort().join("+"), p.format, p.status, p.pillar]),
    [
      ["2026-08-19", "Historia — Quiénes somos", "instagram", "historia", "publicada", "Visión Modus"],
      ["2026-11-05", "Reel Negocio que depende del dueño", "instagram", "reel", "idea", "Pain Points"],
      ["2026-11-10", "Reel ERP / Odoo", "instagram+linkedin+tiktok", "reel", "en_produccion", "Pain Points"],
    ],
  );
  assert.match(r.pieces[2].brief, /^Guion: HOOK/);
  assert.match(r.pieces[2].notes, /Intención: Conversión\nFecha original: 2026-10-29\nPrioridad: Medio\nRecursos: Canva y Capcut/);
});
