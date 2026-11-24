# Presentaciones del Drive en la pestaña Resúmenes

La app muestra, junto a cada resumen mensual, la presentación del mismo cliente y mes que está en Google Drive (Google Slides, .pptx o PDF).

Las presentaciones se ubican por el nombre del archivo:

- **Cliente:** el que va entre corchetes, como en `[Confort Iván] Octubre 2026_ModusRetis`. Si no tiene corchetes, se usa el nombre de la carpeta (`Placebo Amoblamientos / Confort Ivan`).
- **Mes:** el que dice el nombre (`Octubre 2026`). Si dice un rango, como `Resultados Meta Ads Oct-Nov 2026`, la presentación aparece en los dos meses.

La app no entra a tu Drive. Lee la lista de archivos con un script de Google que publicás vos: corre con tu cuenta, la carpeta sigue privada y solo devuelve nombres y links.

## Configuración (una sola vez, unos 5 minutos)

1. Entrá a https://script.google.com con la cuenta dueña de la carpeta y tocá **Nuevo proyecto**.
2. Borrá lo que hay, pegá el código de abajo y cambiá la `CLAVE` por una palabra larga inventada, por ejemplo `mr-presentaciones-8f3k2`.
3. Tocá **Implementar → Nueva implementación**. En el engranaje elegí **Aplicación web** y completá:
   - *Ejecutar como:* **Yo**.
   - *Quién tiene acceso:* **Cualquier usuario**. Sin la clave, el script no devuelve nada.
4. Tocá **Implementar**, autorizá el acceso a Drive cuando lo pida y copiá la **URL de la aplicación web** (termina en `/exec`).
5. En Vercel → Settings → Environment Variables, cargá estas dos variables y volvé a publicar la app:
   - `DRIVE_SCRIPT_URL` = la URL que copiaste.
   - `DRIVE_SCRIPT_TOKEN` = la misma CLAVE que pusiste en el script.

Para sumar otra carpeta, por ejemplo la de otro cliente, agregá su ID en `CARPETAS`. El ID es lo que va después de `/folders/` en el link de la carpeta. Si cambiás el código, publicalo de nuevo con **Implementar → Administrar implementaciones → Editar → Nueva versión**.

```js
// Lista de presentaciones para la app de Planning de Modus Retis
const CARPETAS = ['1KQoJDBKMqyrLG8hFUXcbvmBfbudlcNsr']; // Resumenes Mensuales (Placebo / Confort Iván)
const CLAVE = 'cambiá-esto-por-una-clave-larga';

function doGet(e) {
  const out = (o) => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
  if (((e && e.parameter && e.parameter.token) || '') !== CLAVE) return out({ error: 'token' });
  const files = [];
  const recorrer = (carpeta, ruta, nivel) => {
    const it = carpeta.getFiles();
    while (it.hasNext()) {
      const f = it.next();
      files.push({ id: f.getId(), name: f.getName(), mimeType: f.getMimeType(), url: f.getUrl(),
        created: f.getDateCreated().toISOString(), updated: f.getLastUpdated().toISOString(), folders: ruta });
    }
    if (nivel < 2) {
      const subs = carpeta.getFolders();
      while (subs.hasNext()) { const s = subs.next(); recorrer(s, ruta.concat([s.getName()]), nivel + 1); }
    }
  };
  CARPETAS.forEach((id) => {
    const c = DriveApp.getFolderById(id);
    const padres = c.getParents();
    recorrer(c, (padres.hasNext() ? [padres.next().getName()] : []).concat([c.getName()]), 0);
  });
  return out({ files: files });
}
```
