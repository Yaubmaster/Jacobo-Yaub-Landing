---
name: atlas_database
description: "Datos de la landing — tabla landing_leads (schema verificado en vivo), rate limits, RPC landing_rl_hit, bucket yaub-quotations y postura RLS."
metadata: 
  node_type: memory
  type: project
  originSessionId: bbd80f50-06fb-44ba-a2a2-409738db8649
---

# Atlas · Database

Proyecto Supabase **`xwjhuixuvmyzfhujvxhf`** — ojo: es **toda la plataforma Yaub** (~280 tablas, 184
edge functions). La landing solo toca lo de abajo. Ver [[atlas_00_overview]].

⚠️ **Nada de esto está versionado en el repo** (no hay `migrations/`). Vive solo en el proyecto
remoto → **valida siempre contra la DB en vivo** antes de tocar columnas.

## `public.landing_leads` (RLS on, 5 filas al 2026-07-15)

Schema verificado en vivo (`information_schema.columns`):

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK, `gen_random_uuid()` |
| `created_at` / `updated_at` | timestamptz | `now()` |
| `source` | text NOT NULL | default `'landing_ia_a_tu_medida'` — **la edge fn no lo setea, cae al default** |
| `rol`, `sitio`, `proyecto` | text | input del paso 1 |
| `nombre`, `telefono` | text | input del paso 1 |
| `answers` | jsonb | **siempre vacío** — código muerto ([[atlas_tech_debt]]) |
| `extra` | text | **siempre vacío** — código muerto |
| `site_summary` | text | resumen del scrape de Firecrawl |
| `chips` | jsonb | 4 chips del LLM |
| `plan` | jsonb | plan generado |
| `pkg` | text | `MI SETUP` \| `MI NEGOCIO` \| `MI EQUIPO` (mapeado de `pkg_rec` en `index.ts:268`) |
| `contacto` | text | capturado en paso 4 o al agendar |
| `status` | text NOT NULL | default `'nuevo'` |
| `transcript` | text | chat del discovery, truncado a 6000c en el cliente |

**Ciclo de `status`:** `nuevo` → `plan_generado` → `contacto_capturado` → `cita_agendada`.

**Escrituras** (todas desde `landing-consultor` con service role):
- INSERT en `handleAnalyze` `index.ts:207-218`
- UPDATE en `handlePlan` `:261-272` · `handleContact` `:283-288` · `handleAgendaBook` `:394-397`
- SELECT en `handlePlanPdf` `:419-423` (`.maybeSingle()`)

## `public.landing_rate_limits` (RLS on, comment: "Solo service_role")

Contador por `(ip, action)` de la fn pública. Lo maneja la RPC, no la edge fn directamente.

**RPC `landing_rl_hit(p_ip text, p_action text, p_limit int, p_window_secs int) → boolean`**
— verificada en vivo, **SECURITY DEFINER**. Devuelve `false` al exceder. Llamada en `index.ts:516`.
⚠️ **Su SQL no está en el repo.** Si se pierde, el rate-limit falla *open* (`:517`) y nadie se entera.

## Postura RLS

`landing_leads` y `landing_rate_limits` tienen **RLS habilitado y CERO policies**
(`pg_policies` → `[]`). Efecto: **nadie accede salvo `service_role`**. Es correcto y deliberado — la
publishable key del frontend (`index.html:648`) no puede leer leads aunque esté expuesta.
**No agregues policies "para que jale el front": el front nunca debe tocar la tabla directo.**

## Storage — bucket `yaub-quotations`

- **Privado** (`public=false`, verificado en vivo). Compartido con otros productos Yaub, no es solo
  de la landing.
- Path: `ia-a-tu-medida/plan-{folio}-{Date.now()}.pdf`, `upsert:true` (`index.ts:491-492`)
- `createSignedUrl(path, 604800)` = **7 días** (`:494`) → el link del PDF caduca.

## Tabla de terceros que la landing alcanza (indirecto)

`agenda_appointments` (1885 filas) — la escribe **`calendar-proxy`**, no esta función. La landing solo
la toca vía proxy. Ver [[atlas_integrations]].
