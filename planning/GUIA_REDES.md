# Publicación automática en Instagram, LinkedIn y TikTok

Con esto, la pestaña **RRSS** publica sola cada pieza en estado **Programada**, a su fecha y hora,
igual que Metricool. Se hace una sola vez. Cada red pide crear una "app de desarrollador" propia de
Modus Retis: es gratis, pero algunas tardan en aprobarse.

| Red | Qué hace la app | Qué hay que pedir | Demora típica |
|---|---|---|---|
| Instagram | Publica posts, carruseles, reels y stories (sin stickers) + primer comentario | Nada, si las cuentas de los clientes se suman como "testers" | El mismo día |
| LinkedIn | Publica en la página de la empresa: texto, fotos, video y carrusel PDF + primer comentario | Acceso a "Community Management API" (formulario) | Días o semanas |
| TikTok | Manda el video o las fotos a los **borradores** de TikTok; con la auditoría aprobada, publica directo | Revisión de la app; para publicar directo, auditoría | Semanas |

Lo que **no** se puede publicar por la API de ninguna red y queda como recordatorio para hacerlo a mano
(la app avisa a la hora indicada, con el copy y el material listos para copiar):
stories con stickers (encuestas, links, menciones), artículos de LinkedIn y, hasta que TikTok apruebe
la auditoría, el último toque en TikTok. Metricool tiene las mismas limitaciones.

---

## 0. Antes de empezar

1. **Supabase → SQL Editor**: correr `supabase/migrations/0006_publicacion.sql`.
2. **Supabase → SQL Editor**: abrir `supabase/cron_publicacion.sql`, reemplazar `TU_CRON_SECRET` por el valor
   de `CRON_SECRET` que ya está en Vercel, y correrlo. Es el reloj que cada 5 minutos revisa qué publicar.
3. **Vercel → Settings → Environment Variables**: sumar `LEGAL_CONTACT_EMAIL` con un mail real del equipo
   (aparece en `https://planning-mr.vercel.app/privacidad` y `/terminos`, que las redes piden).

Las direcciones de vuelta (redirect) que vas a cargar en cada red son:

- `https://planning-mr.vercel.app/api/social/callback/instagram`
- `https://planning-mr.vercel.app/api/social/callback/linkedin`
- `https://planning-mr.vercel.app/api/social/callback/tiktok`

## 1. Instagram

Las cuentas tienen que ser **profesionales** (empresa o creador). No hace falta página de Facebook.

1. Entrá a [developers.facebook.com](https://developers.facebook.com) → **Mis apps** → **Crear app**.
   Tipo: **Empresa** (o el caso de uso "Administrar mensajes y contenido en Instagram").
2. En la app, sumá el producto **Instagram** → **Configuración de la API con inicio de sesión de Instagram**.
3. Copiá el **identificador de la app de Instagram** y la **clave secreta de la app de Instagram**
   (ojo: no son los de Facebook, están en esa misma pantalla de Instagram).
   En Vercel: `INSTAGRAM_APP_ID` y `INSTAGRAM_APP_SECRET`.
4. En **Configurar el inicio de sesión de empresa de Instagram** → **URI de redireccionamiento de OAuth válidos**:
   pegá `https://planning-mr.vercel.app/api/social/callback/instagram`.
5. **Roles de la app → Roles → Evaluadores de Instagram**: agregá cada cuenta (@ultragrif.ar, @confort.ivan, la de
   Modus Retis…). Cada cuenta acepta la invitación desde instagram.com → **Configuración → Apps y sitios web →
   Invitaciones de evaluador**.
   Con las cuentas como evaluadoras, la app funciona sin pasar por la revisión de Meta.
6. En **Configuración básica** completá la URL de privacidad (`https://planning-mr.vercel.app/privacidad`) y
   la de términos (`https://planning-mr.vercel.app/terminos`).

Más adelante, si suman muchos clientes y no quieren invitarlos uno por uno, se pide la revisión de Meta para
`instagram_business_content_publish` (con verificación del negocio).

## 2. LinkedIn

Quien conecte cada página tiene que ser **administrador** de esa página en LinkedIn.

1. Entrá a [linkedin.com/developers/apps](https://www.linkedin.com/developers/apps) → **Create app**.
   Asociala a la página de Modus Retis (un admin de la página confirma la verificación) y subí el logo.
2. Pestaña **Products** → **Community Management API** → **Request access** y completá el formulario
   (empresa: Modus Retis Consulting; uso: publicar el contenido que planificamos en las páginas de nuestros
   clientes). LinkedIn pide que ese producto esté solo en la app, así que conviene una app nueva solo para esto.
3. Pestaña **Auth** → **Authorized redirect URLs**: `https://planning-mr.vercel.app/api/social/callback/linkedin`.
4. Copiá **Client ID** y **Primary Client Secret**. En Vercel: `LINKEDIN_CLIENT_ID` y `LINKEDIN_CLIENT_SECRET`.

Hasta que LinkedIn apruebe el acceso, el botón Conectar va a dar un error de permisos: es normal.

## 3. TikTok

1. Entrá a [developers.tiktok.com](https://developers.tiktok.com) con un mail de la empresa → **Manage apps** →
   **Connect an app**. Completá nombre, ícono, descripción, y las URL de términos y privacidad de arriba.
2. Sumá los productos **Login Kit** y **Content Posting API**.
   Permisos: `user.info.basic`, `user.info.profile`, `video.upload`, `video.publish`.
3. **Login Kit → Redirect URI**: `https://planning-mr.vercel.app/api/social/callback/tiktok`.
4. **Content Posting API → verificar el dominio**: elegí verificar por **URL prefix** con
   `https://TU-PROYECTO.supabase.co/storage/v1/object/public/social/`
   (TU-PROYECTO es el mismo de `NEXT_PUBLIC_SUPABASE_URL`). TikTok te da un archivo `.txt`: subilo en
   **Supabase → Storage → social** (en la raíz del bucket) y tocá **Verify**. Así TikTok puede bajar el material.
5. Mientras la app está en **Sandbox**, sumá las cuentas de TikTok de los clientes como **Target users**. Después,
   **Submit for review**.
6. Copiá **Client key** y **Client secret**. En Vercel: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` y
   `TIKTOK_MODE=inbox`.
7. Cuando TikTok apruebe la auditoría de **Direct Post**, cambiá `TIKTOK_MODE` a `direct` y se publica solo, en público.

## 4. Conectar las cuentas

Después de cargar las variables en Vercel (y de que se vuelva a publicar la app):

1. **RRSS → 🔗 Cuentas**.
2. En cada cliente, **Conectar Instagram / LinkedIn / TikTok**, y entrar con la cuenta del cliente.
   En LinkedIn, si administrás varias páginas, la app pregunta cuál es la del cliente.
3. Las conexiones se renuevan solas. Si alguna vence (por ejemplo, si cambiaron la contraseña), aparece en
   rojo con el botón **Reconectar**, y las piezas de esa red avisan que no se pudieron publicar.

## 5. Usarlo día a día

1. Armá la pieza como siempre: redes, formato, fecha, **hora**, copy, hashtags y, si querés, **primer comentario**
   (ahí va el link).
2. Subí el **material** (fotos, video o PDF) arrastrándolo al panel. Las fotos se convierten solas a JPG.
   En carruseles, el orden de las miniaturas es el orden de publicación.
3. En **Publicación**, cada red dice si sale sola o qué falta. Tocá **Programar publicación**.
4. A la hora indicada se publica (puede demorar hasta 5 minutos), la pieza pasa a **Publicada** con el link,
   y al responsable le llega un aviso. Si algo falla, reintenta dos veces y después avisa con el motivo.
5. **Publicar ahora** publica en el momento. **Ya la publiqué** marca a mano lo que se hizo desde la app de la red.

En el calendario: ⏱ programada · ↻ publicándose · ✓ publicada · ✋ hay que terminarla a mano · ⚠ no se pudo publicar.

## Límites a tener en cuenta

- **Tamaño**: hasta 50 MB por archivo, y 1 GB en total en el plan gratis de Supabase. Los reels pesados llenan
  ese espacio en unos meses: conviene borrar el material viejo o pasar a Supabase Pro.
- **Instagram**: hasta 100 publicaciones por día por cuenta. Fotos entre 4:5 y 1.91:1; reels y stories en 9:16.
- **Lo que Metricool hace y esto no**: métricas y reportes, Facebook, YouTube y Google Business, y la
  sugerencia de mejores horarios.
