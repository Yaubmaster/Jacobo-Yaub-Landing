---
name: atlas_backend
description: "Backend de la landing — edge function landing-consultor (Deno): 6 acciones, prompts del LLM, capa de seguridad (rate-limit, origin allowlist, SSRF) y generación de PDF."
metadata: 
  node_type: memory
  type: project
  originSessionId: bbd80f50-06fb-44ba-a2a2-409738db8649
---

# Atlas · Backend — `supabase/functions/landing-consultor/index.ts`

**539 líneas.** Único archivo bajo `supabase/` — no hay migraciones, ni `config.toml`, ni `_shared/`.
`POST /functions/v1/landing-consultor`, `verify_jwt=false` (pública). Ver [[atlas_00_overview]].

⚠️ **El archivo del repo NO es lo que corre en prod.** Ver [[atlas_deploy]] antes de desplegar.

## Contrato — 6 acciones

Router `:526-534`. Sin `action` → 400 `missing_action` (`:504`). No-POST → 405 (`:501`).
`OPTIONS` → 200 + CORS (`:500`). Desconocida → 400 `unknown_action` (`:533`).

| action | Payload (con límites) | Respuesta OK | Handler |
|---|---|---|---|
| `analyze` | `rol≤200, sitio≤300, proyecto≤2000, nombre≤120, telefono≤30` `:184-188` | `{ok, lead_id, nombre_display, resumen, chips[4]}` | `:183` |
| `plan` | `lead_id, rol, sitio, proyecto, answers[≤6], extra≤500, resumen≤1000, transcript≤6000` `:231-237` | `{ok, skills[3], stages[5], equipos[4], pkg_rec 0|1|2, intro}` | `:230` |
| `contact` | `lead_id, contacto≤200` `:280` | `{ok:true}` | `:279` |
| `agenda_slots` | `start_date?, end_date?` (YYYY-MM-DD) `:353-354` | `{ok, available_slots[iso], slots[≤40], timezone, count}` | `:352` |
| `agenda_book` | `start ISO, name≤120, phone (≥10 díg.), lead_id?` `:374-376` | `{ok, appointment_id, starts_at, starts_at_label}` | `:373` |
| `plan_pdf` | `{lead_id}` o `{nombre, empresa, telefono, plan_texto≤4000}` `:411-414` | `{ok, url (signed 7d), filename}` | `:410` |

⚠️ **`agenda_book` devuelve HTTP 200 en TODOS los errores** (`:378,381,391`) con `ok:false`.
Deliberado: el LLM que la invoca lee el `message` en vez de ver un tool failure. **Rompe cualquier
cliente que se guíe por `res.ok`** — hay que checar `ok` en el body (el frontend lo hace, `index.html:886`).

Catch-all `:535-538` → `500 {ok:false, error:"internal"}`, sin detalle (hardening).

## Auxiliares

`json()` `:51` · `esc()` `:56` · `withTimeout()` `:62` · `normalizeUrl()` `:68` ·
`firecrawlScrape()` `:96` · `callFoundry()` `:116` · `callCalendarProxy()` `:323` ·
`tzToday()` `:340` · `slotLabel()` `:344` · `winAnsiSafe()` `:404`.
Cliente Supabase service-role singleton a nivel módulo `:29`.

## Prompts del LLM (`gpt-4o-mini` vía Azure Foundry)

Ambos exigen JSON estricto, reforzado por `response_format:{type:"json_object"}` (`:128`).
**No hay tool-use** — `callFoundry` no manda `tools`.

- **`ANALYZE_SYSTEM`** `:140-154` — rol "consultor IA de Yaub". Devuelve `{nombre_display,
  resumen_sitio, chips[]}`; exige **exactamente 4 chips**, `k`≤12c, `v`≤35c, español mexicano neutro,
  sin markdown. User msg `:198` (+ markdown del sitio scrapeado), `max_tokens 900`.
- **`PLAN_SYSTEM`** `:156-181` — codifica el **catálogo comercial**: pkg 0 MI SETUP $4,990/4sem ·
  1 MI NEGOCIO $12,900/6sem · 2 MI EQUIPO desde $2,990/persona/6sem (`:161-163`). Devuelve
  `{skills[3], stages[5], equipos[4], pkg_rec, intro}`. Reglas duras `:176-181`: `equipos[0]` siempre
  "Cowork Yaub", `equipos[3]` siempre "Plan de 90 días", prohibido prometer métricas. User msg `:243`
  incluye el transcript del discovery como "mejor fuente", `max_tokens 1400`.

⚠️ Los precios del prompt duplican los del frontend — ver [[atlas_tech_debt]].

## Capa de seguridad (commit `698df06`, todo en `:506-523`, antes del switch)

1. **Bypass service-role** `:507-508` — `isTrusted = bearer === SUPABASE_SERVICE_ROLE_KEY`. Si es
   trusted, salta origin check *y* rate-limit. Motivo (`:38-40`): los tools server-to-server de
   WhatsApp/voz no mandan `Origin`.
2. **Origin allowlist** `:510-511` — 403 `forbidden_origin`. Regex `:41`:
   `/^https?:\/\/(jacobo\.yaub\.ai|([a-z0-9-]+\.)?vercel\.app|localhost(:\d+)?|127\.0\.0\.1(:\d+)?)$/i`
   ⚠️ **Solo aplica si `origin` no está vacío** — `curl` sin header `Origin` lo evade por completo.
   ⚠️ `([a-z0-9-]+\.)?vercel\.app` deja pasar **cualquier deploy de Vercel de cualquier persona**.
3. **Rate-limit por IP+acción** `:512-522` — IP de `x-forwarded-for[0]` → `x-real-ip` → `"unknown"`.
   `RATE_LIMITS` `:42-49`: analyze 25/10min · plan 25/10min · contact 15/h · agenda_slots 90/10min ·
   agenda_book 30/h · plan_pdf 40/h. Excedido → 429. Vía RPC `landing_rl_hit` ([[atlas_database]]).
   ⚠️ **Fail-open explícito** `:517` — si el RPC falla, solo loguea y deja pasar.
4. **Escape HTML en email** `:56-60` — `esc()` sobre `contacto, rol, sitio, pkg, proyecto,
   site_summary, id` y `s.name/s.desc` (`:292,303-310`). El `subject` `:300` no usa `esc`, solo
   colapsa CRLF (anti header-injection).
5. **Guard SSRF en `normalizeUrl`** `:68-94` — fuerza https `:71`, exige http/https `:78`, bloquea
   `localhost`/`*.local`/`*.internal` `:81`, IPv4 `0/8 10/8 127/8` `:84`, `169.254/16` (metadata AWS)
   `:85`, `172.16/12` `:86`, `192.168/16` `:87`, CGNAT `100.64/10` `:88`, IPv6 `::1 :: fc* fd* fe80*`
   `:90-92`. Solo se usa en `analyze` `:191`.

⚠️ **CORS `*` `:32` contradice la allowlist** — no es bug: la allowlist es server-side, no CORS.

## PDF (`handlePlanPdf` `:410-497`)

`pdf-lib` desde `esm.sh` (`:9`). Una sola página `:441`, sin paginación. `winAnsiSafe()` `:404-408`
filtra a WinAnsi porque `StandardFonts.Helvetica` **hace throw con emoji/CJK**. Sube a Storage
`:491-492`, firma URL 7 días `:494`. Ver [[atlas_database]].

## Frágil

- **`analyze` degrada en silencio** `:201-203` — si Foundry falla devuelve `ok:true` con `chips:[]` y
  `resumen:null`, **e inserta el lead igual**. `firecrawlScrape` devuelve `""` ante cualquier fallo.
- **IDOR en `lead_id`** — `contact` `:285`, `agenda_book` `:397` y `plan_pdf` `:419-423` aceptan
  cualquier UUID sin verificar propiedad. Ver [[atlas_tech_debt]].
- **PDF sin control de overflow** `:441` — `draw()` decrementa `y` sin límite; un plan largo dibuja en
  `y` negativo. `y = Math.min(y, 96)` `:486` fuerza el footer, que puede encimarse.
- **`FOUNDRY_MODEL` hardcodeado** `:20` (endpoint y api-version sí son env). Cambiar de modelo = deploy.
- **Assistant/tenant IDs hardcodeados** `:26-27`.
- **`chips` no se truncan** `:205` — los límites 12/35c son solo instrucción al LLM, no validación.
