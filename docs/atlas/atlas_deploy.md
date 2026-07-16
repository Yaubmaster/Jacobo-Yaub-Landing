---
name: atlas_deploy
description: "Despliegue de la landing — Vercel (root cotizador-ttq), deploy de edge functions, y el DRIFT confirmado entre producción y el repo. LEER ANTES DE DESPLEGAR."
metadata: 
  node_type: memory
  type: project
  originSessionId: bbd80f50-06fb-44ba-a2a2-409738db8649
---

# Atlas · Deploy

Ver [[atlas_00_overview]].

## 🚨 DRIFT: producción está ADELANTE del repo

**Verificado el 2026-07-15** comparando el código desplegado (`get_edge_function`, v9 ACTIVE) contra
`supabase/functions/landing-consultor/index.ts` en `698df06`.

**Prod tiene una feature completa que NO existe en ningún commit ni rama**: `agente_yaub`.
Confirmado con `git log --all -S 'agente_yaub'` y `-S 'es_dueno'` → **ambos vacíos**. Alguien
desplegó directo a prod sin commitear.

Lo que solo existe en el runtime de Supabase:

1. **`PLAN_SYSTEM` ampliado** — campos `es_dueno`, `vertical`, `agente_yaub`; "Agente Yaub por vertical
   (WhatsApp/voz 24/7)"; regla de `pkg_rec` reescrita; "1er mes de agente de WhatsApp" en MI NEGOCIO.
2. **`handlePlan`** — parsea/sanitiza `agente_yaub`, agrega `es_dueno` + `vertical` al objeto `plan`.
3. **`handleContact`** — inyecta `agenteHtml` en el email (usa `esc()` correctamente).
4. **`handlePlanPdf`** — dibuja el bloque "TU AGENTE YAUB 24/7 (WHATSAPP Y VOZ)".
5. **`winAnsiSafe`** — prod normaliza comillas tipográficas (`/[“”]/`, `/[‘’]/`); el repo tiene ASCII
   (`/[""]/`, `/['']/`) → **la versión del repo es un no-op latente** (reemplaza `"` por `"`).
   Verificado por hexdump; el repo nunca las tuvo en toda su historia.

### ⚠️ Consecuencia operativa

El working tree está limpio y en `698df06`, así que **nada avisa**. Cualquier
`supabase functions deploy landing-consultor` desde este repo **borra `agente_yaub` de producción en
silencio**, sin conflicto de git.

**Antes de desplegar la función: rescatar el código de prod a una rama.** Extraerlo
programáticamente vía `mcp__claude_ai_Supabase__get_edge_function` (project `xwjhuixuvmyzfhujvxhf`,
slug `landing-consultor`) — no transcribir a mano.

### Lo que SÍ está alineado

El hardening de seguridad de `698df06` (`ALLOWED_ORIGIN`, `RATE_LIMITS`, RPC `landing_rl_hit`,
`esc()`, guards SSRF de IP privada, bypass service-role, 500 sin detalle) está **presente e idéntico
en prod**. Cero hunks de diff en las zonas de seguridad. Ver [[atlas_backend]].

## Frontend — Vercel

- **Root Directory del proyecto Vercel = `cotizador-ttq`** (por eso existe `index.html` ahí).
- Dominio: **jacobo.yaub.ai**. Sin build step: se sirve el HTML tal cual.
- `cotizador-ttq/index.html` es **copia byte-idéntica** de `Landing IA a tu medida.dc.html` (mismo
  md5). El primero es lo que sirve Vercel; el segundo es lo que regenera el editor DC.
  **Editar uno NO propaga al otro.** Ver [[atlas_tech_debt]].
- El regex de origins permite `*.vercel.app`, así que los previews funcionan contra la fn de prod
  (misma DB, mismos leads reales) ⚠️.

## Backend — Supabase Edge Functions

Proyecto `xwjhuixuvmyzfhujvxhf`. Las 3 relevantes, todas `ACTIVE` y `verify_jwt=false` (públicas):

| Función | Versión | En este repo |
|---|---|---|
| `landing-consultor` | v9 | ✅ (con drift ↑) |
| `widget-chat` | v5 | ❌ vive fuera |
| `calendar-proxy` | v35 | ❌ vive fuera |

**No hay CI/CD para las functions ni migraciones versionadas.** Los deploys son manuales. Ver
[[atlas_database]] y [[atlas_decisions]].

## Secretos expuestos en el cliente (por diseño)

`index.html:645-648`, texto plano en el bundle:
- URL del proyecto Supabase — expuesta, inevitable.
- **Publishable key** (`sb_publishable_…`) `:648` — diseñada para cliente; riesgo bajo porque
  `landing_leads` tiene RLS sin policies ([[atlas_database]]).
- **`WIDGET_KEY`** (`wk_…`) `:647` — ⚠️ es el **único** auth de `widget-chat`. Cualquiera puede
  consumir el agente Discovery. Ver [[atlas_tech_debt]].
