---
name: atlas_integrations
description: "Integraciones de la landing — Azure Foundry (gpt-4o-mini), Firecrawl, Resend, calendar-proxy y widget-chat; con env vars, timeouts y modos de fallo."
metadata: 
  node_type: memory
  type: project
  originSessionId: bbd80f50-06fb-44ba-a2a2-409738db8649
---

# Atlas · Integraciones

Todas se invocan desde `landing-consultor` salvo `widget-chat`, que el navegador llama directo.
Ver [[atlas_backend]].

| Servicio | Endpoint / modelo | Línea | Auth | Timeout |
|---|---|---|---|---|
| **Azure AI Foundry** | `${FOUNDRY_ENDPOINT}?api-version=…`, **`gpt-4o-mini` hardcodeado** `:20`, temp 0.6, `response_format:json_object` | `:120-131` | header `api-key:` ← `AZURE_FOUNDRY_API_KEY` | **25s** `:118` |
| **Firecrawl** | `POST api.firecrawl.dev/v1/scrape`, `formats:["markdown"]`, `onlyMainContent`, corta a 9000c | `:100-108` | `Bearer FIRECRAWL_API_KEY` | **9s** `:98` |
| **Resend** | `POST api.resend.com/emails` | `:294-313` | `Bearer RESEND_API_KEY` | ⚠️ **ninguno** |
| **calendar-proxy** | `${SUPABASE_URL}/functions/v1/calendar-proxy` — sub-acciones `check_availability` `:360`, `book_slot` `:383`, `duration_minutes:15` | `:326-331` | `Bearer SUPABASE_SERVICE_ROLE_KEY` | **20s** `:324` |
| **pdf-lib** | `esm.sh/pdf-lib@1.17.1` | `:9` | — | — |

**No hay Anthropic/Claude ni OpenAI directo.** El único LLM del backend es gpt-4o-mini vía Azure.

## Variables de entorno (`Deno.env.get`)

| Var | Línea | Si falta… |
|---|---|---|
| `SUPABASE_URL` | `:11` | **rompe** (`!`) — cliente `:29` + URL del proxy `:326` |
| `SUPABASE_SERVICE_ROLE_KEY` | `:12` | **rompe** (`!`) — cliente, auth al proxy, y **bypass** `:508` |
| `AZURE_FOUNDRY_API_KEY` | `:14` | `callFoundry` lanza `:117` → de facto obligatoria |
| `FIRECRAWL_API_KEY` | `:13` | scrape devuelve `""` **en silencio** `:97` |
| `RESEND_API_KEY` | `:15` | `contact` responde OK **sin notificar a nadie** `:291` |
| `AZURE_FOUNDRY_ENDPOINT` | `:17` | cae al default hardcodeado `:18` (recurso propio `jacob-mn3yo64e-eastus2`) ⚠️ si el recurso Azure cambia y no está la env, **todo `analyze`/`plan` falla** |
| `AZURE_FOUNDRY_API_VERSION` | `:19` | default `2024-05-01-preview` |

## Agenda (Yaub Calendar)

`landing-consultor` **no** habla con el calendario: pasa por `calendar-proxy` (edge fn v35, activa,
fuera de este repo), que lee/escribe `agenda_appointments` ([[atlas_database]]).

Constantes hardcodeadas, inyectadas en todo payload al proxy (`:329`):
- `CONSULTOR_ASSISTANT_ID = "6abc23ed-…"` `:26`
- `CONSULTOR_TENANT_ID = "2cc20bca-…"` `:27`
- `AGENDA_TZ = "America/Monterrey"` `:338`

**Decisión de diseño** (`:351`): el **servidor** calcula las fechas, el LLM nunca. Ver [[atlas_decisions]].

## Email

`NOTIFICATION_EMAILS = ["jacobopayan@yaub.ai"]` `:22`, `FROM_EMAIL` `:23`. Se dispara en `contact`.
Todo campo del usuario pasa por `esc()` ([[atlas_backend]]).

## `widget-chat` — el chat del paso 2 (FUERA de este repo)

Edge fn v5, activa, `verify_jwt=false`. El navegador la llama **directo** (`index.html:766-770`):

```json
POST /functions/v1/widget-chat
{ "action":"message", "key":"<WIDGET_KEY>", "visitor_id":"…", "text":"…" }
```

Detrás está el assistant **"Agente Consultoría Jacobo"** — id `6abc23ed-5ae0-4d90-b47d-7c16d5ea5614`
(tabla `assistants`; ex-"Discovery — IA a tu medida"). **Es el mismo del WhatsApp de Yaub.** Su
transcript alimenta la acción `plan`. Nota: ese id es también el `CONSULTOR_ASSISTANT_ID` hardcodeado
en `index.ts:26`.

⚠️ **Asimetría de auth**: `widget-chat` **no manda header `apikey`** (autentica con `key` en el body),
mientras `landing-consultor` sí. Verifica antes de "normalizarlo" — puede ser intencional.

⚠️ **Gate de dominios**: `widget-chat` valida contra `widget_config.allowed_domains`.
`localhost`/`127.0.0.1` son first-party por default; **un dominio nuevo de producción hay que darlo de
alta ahí** o el chat falla en prod aunque funcione local.

## Los tools que llaman *a* esta función (inverso)

`consultor_agenda_slots` `:381` y `consultor_plan_pdf` `:403` son tools **del propio agente** en sus
otros canales (WhatsApp/voz). Esta función es el *callee*. Por eso existen el bypass service-role y el
`HTTP 200` en errores de `agenda_book` ([[atlas_decisions]]). **Sus definiciones no están en este
repo.** Cambiar el contrato de esas acciones rompe WhatsApp/voz sin que el repo lo note.

Las **5 tool-defs** del agente: `consultor_agenda_slots`, `consultor_agenda_book`,
`consultor_plan_pdf`, `submit_discovery_brief` (→ edge fn `discovery-plan`), `send_document`.

### 🔧 Convención de la plataforma (cuesta caro descubrirla)

Las tool-definitions **que ve el LLM** viven en **`assistants.tools`** (jsonb).
**`assistant_custom_tools` es solo el attach/billing.** **Hacen falta las dos**: si agregas una tool
en una sola tabla, o el modelo no la ve, o no se factura.
