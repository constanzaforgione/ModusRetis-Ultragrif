// Solo navegador. Muchos calendarios arman sus piezas con funciones de su propio script
// (ST("Story 1", "…"), "Link: " + L("producto")), y eso no se puede leer sin correrlo.
// Se corre el archivo en un iframe aislado (sandbox sin acceso a la app, a sus cookies ni a la sesión)
// y se devuelven sus datos (const data = {…}) ya armados, como JSON.

/** Nombres de las variables que declara el script del calendario */
export function declaredNames(html: string): string[] {
  const code = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join("\n");
  return [...new Set([...code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)].map((m) => m[1]))].slice(0, 200);
}

export function runCalendarScripts(html: string, timeoutMs = 4000): Promise<unknown[]> {
  const names = declaredNames(html);
  if (!names.length || typeof document === "undefined") return Promise.resolve([]);
  const token = Math.random().toString(36).slice(2);
  const collector = `<script>(function(){var sent=false;function go(){if(sent)return;sent=true;var out={};var n=${JSON.stringify(names)};
for(var i=0;i<n.length;i++){try{var v=(0,eval)(n[i]);if(v&&typeof v==="object")out[n[i]]=JSON.parse(JSON.stringify(v,function(k,x){return typeof x==="function"?undefined:x}));}catch(e){}}
parent.postMessage({mrCalendar:${JSON.stringify(token)},vars:out},"*");}
try{go()}catch(e){sent=false}if(!sent)addEventListener("load",go);})();<\/script>`;
  const doc = /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${collector}</body>`) : html + collector;

  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;left:-10000px;top:0;width:1200px;height:800px;border:0;visibility:hidden";
    let done = false;
    const finish = (vals: unknown[]) => {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMsg);
      frame.remove();
      resolve(vals);
    };
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.contentWindow || e.data?.mrCalendar !== token) return;
      finish(Object.values((e.data.vars ?? {}) as Record<string, unknown>));
    };
    window.addEventListener("message", onMsg);
    setTimeout(() => finish([]), timeoutMs);
    frame.srcdoc = doc;
    document.body.appendChild(frame);
  });
}
