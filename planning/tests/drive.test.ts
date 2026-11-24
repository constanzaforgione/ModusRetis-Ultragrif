// Presentaciones del Drive unidas a los resúmenes (lib/drive.ts), con los nombres reales de la carpeta
import { test } from "node:test";
import assert from "node:assert/strict";
import { clientOf, fetchPresentations, monthsIn, presentationsFor, toPresentations } from "../lib/drive";
import { matchClient } from "../lib/summaries";

const folders = ["Placebo Amoblamientos / Confort Ivan ", "Resumenes Mensuales"];
const files = [
  { id: "a", name: "[Confort Iván] Octubre 2026_ModusRetis", mimeType: "application/vnd.google-apps.presentation", url: "https://docs.google.com/presentation/d/a/edit", folders },
  { id: "b", name: "[Confort Iván] Agosto 2026_ModusRetis.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", url: "https://drive.google.com/file/d/b/view", folders },
  { id: "c", name: "Julio 2026_ModusRetis.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", url: "https://drive.google.com/file/d/c/view", folders },
  { id: "d", name: "[Confort Iván] Resultados Meta Ads Oct-Nov 2026_ModusRetis", mimeType: "application/vnd.google-apps.presentation", url: "https://docs.google.com/presentation/d/d/edit", folders },
  { id: "e", name: "Fotos.zip", mimeType: "application/zip", url: "x", folders },
];

test("mes y cliente de cada presentación", () => {
  assert.deepEqual(monthsIn("Octubre 2026_ModusRetis"), ["2026-10"]);
  assert.deepEqual(monthsIn("Resultados Meta Ads Oct-Nov 2026"), ["2026-10", "2026-11"]);
  assert.deepEqual(monthsIn("Campaña Nov-Ene 2027"), ["2026-11", "2026-12", "2027-01"]);
  assert.deepEqual(monthsIn("Sin fecha"), []);
  assert.equal(clientOf(files[2]), "Placebo / Confort Iván");
  assert.equal(clientOf(files[0]), "Placebo / Confort Iván");
  assert.equal(clientOf({ name: "Abril 2026", folders: ["002 - ULTRAGRIF", "Resúmenes"] }), "002 - ULTRAGRIF");
  const list = toPresentations(files);
  assert.deepEqual(list.map((p) => [p.id, p.months.join(",")]), [["a", "2026-10"], ["b", "2026-08"], ["c", "2026-07"], ["d", "2026-10,2026-11"]]);
  assert.equal(list[1].name, "[Confort Iván] Agosto 2026_ModusRetis");
});

test("cada resumen muestra las presentaciones de su cliente y mes", () => {
  const list = toPresentations(files);
  const clients = [{ name: "Placebo / Confort Iván" }, { name: "Ultragrif" }];
  const same = (a: string, b: string) => matchClient(a, clients)?.name === matchClient(b, clients)?.name;
  assert.deepEqual(presentationsFor({ client: "Placebo / Confort Iván", month: "2026-10" }, list, same).map((p) => p.id), ["a", "d"]);
  assert.deepEqual(presentationsFor({ client: "Placebo / Confort Iván", month: "2026-11" }, list, same).map((p) => p.id), ["d"]);
  assert.deepEqual(presentationsFor({ client: "Ultragrif", month: "2026-10" }, list, same), []);
});

test("lee la lista del script de Drive con su clave", async () => {
  let called = "";
  const http = (async (u: RequestInfo | URL) => {
    called = String(u);
    return new Response(JSON.stringify({ files }), { status: 200 });
  }) as typeof fetch;
  const list = await fetchPresentations(http, { url: "https://script.google.com/macros/s/X/exec", token: "secreto" });
  assert.equal(called, "https://script.google.com/macros/s/X/exec?token=secreto");
  assert.equal(list.length, 4);
  const bad = (async () => new Response(JSON.stringify({ error: "token" }), { status: 200 })) as unknown as typeof fetch;
  await assert.rejects(fetchPresentations(bad, { url: "https://x", token: "y" }), /rechazó la clave/);
});
