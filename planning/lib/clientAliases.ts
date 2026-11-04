// Clientes que aparecen con varios nombres (en ClickUp, en calendarios, en el dictado) y en la app son uno solo.
// "Placebo", "Placebo Amoblamientos" y "Confort Iván" son "Placebo / Confort Iván".

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ]+/g, " ")
    .trim();

export const CLIENT_ALIASES: { name: string; aliases: string[] }[] = [
  { name: "Placebo / Confort Iván", aliases: ["placebo / confort ivan", "placebo amoblamientos", "placebo", "confort ivan"] },
];

/** El nombre de la app para un nombre que viene de afuera ("Placebo Amoblamientos" → "Placebo / Confort Iván") */
export function canonicalClient(raw: string): string {
  const n = ` ${fold(raw)} `;
  for (const c of CLIENT_ALIASES) if (c.aliases.some((a) => n.includes(` ${fold(a)} `))) return c.name;
  return raw;
}

/** Todos los nombres con que se puede nombrar a un cliente de la app (el suyo y sus alias) */
export function namesOf(clientName: string): string[] {
  const c = CLIENT_ALIASES.find((x) => fold(x.name) === fold(clientName));
  return c ? [clientName, ...c.aliases] : [clientName];
}
