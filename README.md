# Informe mensual · Confort Iván

Automatización que toma el **resumen mensual de ClickUp** de Confort Iván y genera la
**presentación PowerPoint** con el diseño de los mockups de Modus Retis. Después la sube
a la carpeta de Google Drive.

```
ClickUp (doc "Resumen de avance - <Mes> <Año>")
   │  API de ClickUp
   ▼
Claude (claude-opus-5-5): resume y elige el tipo de cada diapositiva  →  salida/AAAA-MM.json
   │
   ▼
Renderizador python-pptx (diseño de los mockups)  →  "[Confort Iván] <Mes> <Año>_ModusRetis.pptx"
   │  API de Google Drive
   ▼
Carpeta de Drive de los informes
```

- **Fuente:** [doc de resúmenes en ClickUp](https://app.clickup.com/9002139524/v/dc/8c93fw4-3714).
  El equipo carga ahí "Resumen de avance - Mes Año" entre el 1 y el 5 de cada mes.
- **Destino:** [carpeta de Drive](https://drive.google.com/drive/u/0/folders/1KQoJDBKMqyrLG8hFUXcbvmBfbudlcNsr),
  donde están los mockups de julio, agosto y septiembre 2026.

## Cuándo corre

El workflow `.github/workflows/informe-mensual.yml` corre **del 1 al 6 de cada mes a las
09:00 (hora de Argentina)** y siempre informa el **mes anterior**:

1. Si el PPT de ese mes ya está en Drive, no hace nada. Así nunca pisa un informe que
   ya se haya retocado a mano.
2. Si todavía no existe la página del mes en ClickUp, espera a la corrida del día siguiente.
3. Para no tomar un resumen a medio escribir, espera a que la página lleve **24 h sin
   editarse**. El día 6 la toma igual. Si ese día todavía no existe, el workflow falla y
   GitHub manda un aviso por mail.
4. Genera el PPT, lo sube a Drive y deja el `.pptx`, el `.json` y el resumen de ClickUp
   como *artifact* de la ejecución. Los guarda 90 días.

También se puede correr a mano desde **Actions → Informe mensual Confort Iván → Run workflow**.
Ahí se elige el mes (`AAAA-MM`) y si debe reemplazar el archivo existente.

## Puesta en marcha (una sola vez)

Cargar estos secrets en **Settings → Secrets and variables → Actions**:

| Secret | De dónde sale |
|---|---|
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) → API Keys |
| `CLICKUP_API_TOKEN` | ClickUp → Settings → Apps → API Token (`pk_...`), de un usuario con acceso al doc |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN` | Ver abajo |

**Credenciales de Google Drive.** La carpeta está en "Mi unidad" de
constanzaforgione@gmail.com. Por eso la subida se hace en nombre de esa cuenta, porque las
cuentas de servicio no tienen cuota propia en "Mi unidad".

1. En [Google Cloud Console](https://console.cloud.google.com/), crear un proyecto y habilitar la **Google Drive API**.
2. En **Pantalla de consentimiento de OAuth**, elegir tipo *Externo* y **publicar la app (En producción)**.
   Si queda en *Prueba*, el token vence a los 7 días. No hace falta verificarla para uso propio.
3. En **Credenciales**, crear un **ID de cliente de OAuth** de tipo *App de escritorio* y descargar el JSON.
4. En una compu con navegador, correr
   `pip install google-auth-oauthlib && python scripts/obtener_token_google.py client_secret.json`,
   iniciar sesión con la cuenta dueña de la carpeta y copiar los tres valores que imprime.

> Si la carpeta se mueve a una unidad compartida, alcanza con una cuenta de servicio con
> rol de editor: cargar su JSON en el secret `GOOGLE_SERVICE_ACCOUNT_JSON` en lugar de los
> tres de OAuth.

## Uso local

```bash
pip install -r requirements-dev.txt
export ANTHROPIC_API_KEY=... CLICKUP_API_TOKEN=...

# Todo el flujo para el mes anterior, sin tocar Drive (el PPT queda en salida/)
python -m informe_mensual generar --sin-drive

# Un mes puntual, reemplazando el que está en Drive
python -m informe_mensual generar --mes 2026-10 --reemplazar
```

**Corregir algo antes de presentar:** el contenido queda en `salida/AAAA-MM.json`.
Se puede editar un número o un texto y volver a dibujar sin llamar de nuevo a Claude:

```bash
python -m informe_mensual renderizar salida/2026-10.json
python -m informe_mensual subir "salida/[Confort Iván] Octubre 2026_ModusRetis.pptx" --reemplazar
```

El PPT generado es 100 % editable: textos, tarjetas y líneas son formas nativas de
PowerPoint y Google Slides, no imágenes.

## Cómo está armado

| Archivo | Qué hace |
|---|---|
| `informe_mensual/spec.py` | Modelo del informe: portada, horas por área y secciones con diapositivas de 11 tipos. Es también el esquema de salida que recibe Claude. |
| `informe_mensual/extraccion.py` | Prompt y llamada a Claude con salida estructurada. Usa como ejemplo el par `examples/2026-09_clickup.md` → `examples/2026-09.json`, que es el mockup de septiembre. |
| `informe_mensual/render.py` | Dibuja cada tipo de diapositiva con las medidas, colores y tipografías de los mockups. |
| `informe_mensual/clickup.py` | Busca la página del mes en el doc. Tolera errores de tipeo ("Sptiembre") y prefiere las versiones "v2 (Consolidado)" o "COMPLETO". |
| `informe_mensual/drive.py` | Busca y sube el archivo a la carpeta. |
| `informe_mensual/assets/` | Plantilla base (tema y fuentes Roboto y Plus Jakarta Sans embebidas), logo, destello e insignia, extraídos del mockup. |

Tipos de diapositiva disponibles: `kpis_texto` (Mercado Libre · Ventas), `reputacion`,
`ads` (ML Ads con tarjeta de ROAS), `grupos_metricas` (Meta Ads / Tiendanube),
`vision_general`, `kpis_lista` (Instagram), `plataforma` (TikTok), `dos_columnas`
(tareas y recomendaciones, organización y próximos pasos), `lista_numerada`
(conclusiones, contenido destacado), `tabla` (antes vs. después) y `texto_vinietas`
(lanzamiento de campaña). Claude elige cuáles usar según lo que traiga el resumen de
cada mes, igual que pasó con los mockups: julio tuvo 13 diapositivas, agosto 19 y septiembre 17.

**Mejorar el estilo:** si se aprueba un informe con cambios hechos a mano, se puede
reemplazar el ejemplo de referencia. Hay que actualizar `examples/AAAA-MM_clickup.md` y
`examples/AAAA-MM.json`, y cambiar `EJEMPLO_MES` en `extraccion.py`.

```bash
python -m pytest            # tests
python scripts/crear_plantilla_base.py "<mockup>.pptx"   # solo si cambia el diseño base
```
