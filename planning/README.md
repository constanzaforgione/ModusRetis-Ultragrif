# Planning Modus Retis

App web para seguir el **roadmap por cliente** y las **tareas del equipo**, con el branding de Modus Retis.
Next.js en Vercel + Supabase (login, base de datos y permisos).

| Pestaña | Qué hace |
|---|---|
| **Roadmap** | Línea de tiempo por cliente (trimestre, semestre o año). Cada proyecto es una barra con su avance. Líderes y admins suman clientes y proyectos. |
| **Tareas** | Vista de lista (vencidas / hoy / próximos 7 días / más adelante / sin fecha) o de tablero por estado. Filtros por cliente, persona y prioridad. **Dictado por voz** para crear tareas o cambiar las existentes. |
| **Atención** | Lo vencido, por vencer (≤ 2 días), bloqueado o sin movimiento (≥ 5 días). Los líderes ven además lo de su equipo. Avisos de asignación. |
| **Equipo** | Roles, líder de cada persona y cuentas activas (solo admin edita). Cada uno cambia su nombre y si recibe mails. |

## Roles y permisos

Los permisos están en la base (Row Level Security de Postgres), no solo en la pantalla: aunque alguien
llame a la API directamente, no puede hacer más de lo que su rol permite.

| | Miembro | Líder | Admin |
|---|:-:|:-:|:-:|
| Ver todas las tareas y el roadmap | ✓ | ✓ | ✓ |
| Crear y editar **sus** tareas | ✓ | ✓ | ✓ |
| Crear y editar tareas de **su equipo** (personas que lo tienen como líder) | | ✓ | ✓ |
| Editar tareas de cualquiera | | | ✓ |
| Sumar clientes y editar el roadmap | | ✓ | ✓ |
| **Borrar** tareas, proyectos o clientes | | | ✓ |
| Cambiar roles, líderes y activar cuentas | | | ✓ |

Un miembro tampoco puede pasarle su tarea a otra persona. La **primera persona que entra queda como admin**;
el resto entra como miembro y un admin le asigna rol y líder desde **Equipo**.

## Alertas

- **En la app**: la pestaña Atención y la campanita muestran lo que hay que mirar. Si la persona activa los
  avisos del navegador, recibe una notificación por día con lo vencido o por vencer.
- **Aviso de asignación**: cuando un líder te asigna una tarea, te aparece en Avisos.
- **Mail diario** (opcional, lunes a viernes 8:00 hora Argentina): un resumen a cada persona con sus tareas
  vencidas, por vencer, bloqueadas o sin movimiento; a los líderes, también lo vencido o bloqueado de su equipo.
  Lo manda el cron de Vercel (`vercel.json`) por [Resend](https://resend.com).

## Dictado por voz

Botón **🎙 Dictar tareas**: se habla de corrido ("para el viernes tengo que mandarle a Ultragrif el kit
de publicaciones, es urgente; la tarea del catálogo de Meli pasala a en curso") y Claude lo ordena en tareas
nuevas (título, descripción, cliente, responsable, prioridad, fechas) y cambios sobre tareas existentes.
Siempre se muestran como borrador para revisar antes de guardar. También hay un micrófono para dictar la
descripción de una tarea.

El dictado usa el reconocimiento de voz del navegador (Chrome, Edge o Safari). Sin `ANTHROPIC_API_KEY`
igual funciona, pero carga el texto como una sola tarea.

## Puesta en marcha

### 1. Supabase

1. Crear un proyecto en [supabase.com](https://supabase.com) (región São Paulo queda cerca).
2. **SQL Editor** → pegar y correr `supabase/migrations/0001_init.sql`, después `supabase/seed.sql`
   (carga Modus Retis, Meli Retis, Ultragrif, Placebo y Odoo).
   Para traer el planning de Lytton (25 tareas y 11 proyectos), correr `supabase/import_planning_lytton.sql`
   después de que el admin haya entrado a la app. Se puede volver a correr cuando entre el resto del equipo:
   no duplica nada y les pasa las tareas que estaban esperando a su responsable.
3. **Authentication → URL Configuration**: *Site URL* = la URL de Vercel, y en *Redirect URLs* agregar
   `https://<tu-app>.vercel.app/auth/callback` y `http://localhost:3000/auth/callback`.
4. (Opcional) **Authentication → Providers → Google** para entrar con Google.

### 2. Vercel

1. *Add New → Project* → importar este repo y poner **Root Directory = `planning`**.
2. Cargar las variables de entorno de `.env.example`:

| Variable | De dónde sale |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Mismo lugar (*service_role*). Solo la usa el cron. |
| `ALLOWED_EMAIL_DOMAINS` | Ej. `modusretis.com`. Vacío = cualquier mail puede entrar. |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) → API Keys (dictado por voz) |
| `CRON_SECRET` | Un texto largo al azar. Vercel lo usa para llamar al cron. |
| `RESEND_API_KEY`, `ALERTS_FROM_EMAIL` | (Opcional) para los mails. El dominio del remitente tiene que estar verificado en Resend. |
| `APP_URL` | URL pública, para los links de los mails |

3. Deploy. La primera persona que entra queda como admin.

### Desarrollo local

```bash
cd planning
cp .env.example .env.local   # completar
npm install
npm run dev                  # http://localhost:3000
npm test                     # permisos (RLS) y reglas de alertas
npm run typecheck
```

`npm test` corre el esquema completo en un Postgres embebido (PGlite) y verifica los permisos de cada rol.

## Estructura

```
planning/
├─ app/(app)/          roadmap · tareas · atencion · equipo
├─ app/api/voice       dictado → Claude → borradores de tareas
├─ app/api/cron/alerts avisos diarios + mails
├─ components/         vistas y diálogos
├─ lib/                tipos, fechas (hora Argentina), permisos, reglas de alertas
└─ supabase/           esquema con RLS + datos iniciales
```
