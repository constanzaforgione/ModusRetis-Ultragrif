// Correr el script de un calendario (lib/socialRun.ts): qué variables se piden
import { test } from "node:test";
import assert from "node:assert/strict";
import { declaredNames } from "../lib/socialRun";

test("variables del script del calendario, sin scripts externos", () => {
  const html = `<script src="https://x.com/a.js">const nope = 1</script><script>const WEB = "x"; let data = {}; var posts = [];\nfunction f(){ const inner = 2 }</script>`;
  assert.deepEqual(declaredNames(html), ["WEB", "data", "posts", "inner"]);
  assert.deepEqual(declaredNames("<p>sin script</p>"), []);
});
