---
name: atlas_tech_debt
description: "Deuda técnica de Jacobo-Yaub-Landing — abierta y resuelta, ordenada por severidad."
metadata: 
  node_type: memory
  type: project
  originSessionId: bbd80f50-06fb-44ba-a2a2-409738db8649
---

# Atlas · Deuda técnica

## Abierta

### DT-019 · 🔴 Bilingüe A MEDIAS: la landing traduce, el consultor NO
Hecho el 2026-07-15: **frontend bilingüe completo** (159 claves × 2 idiomas, botón ES/EN en el navbar).
**Falta el backend, y eso rompe la promesa**: el visitante lee todo en inglés y en el paso 2 el
consultor le responde **en español**. También el plan y el PDF.

Falta:
1. **`landing-consultor`**: `ANALYZE_SYSTEM` y `PLAN_SYSTEM` exigen "español mexicano neutro".
   Hay que pasar `lang` en el payload de `analyze`/`plan` y ramificar el prompt. El PDF igual.
2. **`widget-chat`**: el agente del chat vive en `assistants` de la plataforma, **fuera de este repo**.
   Su prompt hay que tocarlo allá.
⚠️ Tocar el backend **exige rescatar `agente_yaub` primero** (`DT-001`) o se borra.

**Mientras tanto**: el botón EN está publicado y funcionando. Un lead en inglés llega hasta el chat
y ahí se topa con español. Decisión consciente de Jacobo (se le advirtió); se cierra con el backend.

### DT-016 · 🔴 La landing anuncia precios que no se pueden cobrar
Abierta 2026-07-15. El copy dice "$400 MXN" por el plan y "depósito reembolsable" para agendar, pero
**no existe backend de pagos**: `agenda_book` sigue agendando gratis y el plan se muestra sin cobrar.
**No publicar así.** O se construye el cobro, o se revierte el copy. Ver [[atlas_changelog]].

### DT-017 · 🟠 Infra de pagos: lo que falta para cobrar
Abierta 2026-07-15. Proveedor = **MercadoPago**, secret `MP_ACCESS_TOKEN` (funciona: 10 preferencias
creadas). Pero:
- **El webhook de confirmación nunca ha corrido en producción** — las 14 `recharge_orders` están
  100% en `pending`, `paid_at` NULL. Crear el link está probado; **cobrar de verdad, no**.
- `MP_WEBHOOK_SECRET` probablemente sin setear → la validación de firma **se salta en silencio**.
- `agenda_appointments` **no tiene columnas de pago** y su `status` tiene CHECK constraint
  (`booked/confirmed/completed/cancelled/no_show`) → `pending_payment` exige migración.
- `agenda_services.price_mxn` del servicio de Jacobo (`73b63227-…`) está en **NULL**.
- **Comisión no reembolsable**: cada depósito devuelto deja la comisión de MP a cargo de Yaub — se
  castiga económicamente a los que SÍ asisten. Verificar política de MP antes de comprometerse.
- Ruta recomendada: tabla `appointment_orders` + `agenda-checkout-create`/`-webhook` clonando el
  patrón de `recharge-*` (idempotencia, precio del catálogo, conciliación), **sin tocar
  `agenda_appointments`** (1,885 filas vivas).

### DT-018 · 🟠 `capturar-lead-yaub` no valida `Authorization`
Detectada 2026-07-15 (hallazgo lateral). Cualquiera con la URL inserta leads y dispara emails.
Fuera del alcance de la landing pero es de la misma plataforma.

### DT-001 · 🔴 Drift prod↔repo: `agente_yaub` solo existe en producción
Abierta 2026-07-15. Prod (v9) tiene una feature completa que no está en ningún commit. Un
`supabase functions deploy` desde el repo la borra en silencio. **Rescatar a una rama antes de tocar
deploys.** Detalle completo en [[atlas_deploy]].

### DT-002 · 🔴 Dos copias byte-idénticas de la landing, sincronizadas a mano
Abierta 2026-07-14. `cotizador-ttq/index.html` (lo que sirve Vercel) y
`cotizador-ttq/Landing IA a tu medida.dc.html` (lo que abre el editor DC) tienen el mismo md5.
Editar uno deja el otro viejo, sin aviso. **Definir fuente de verdad**: o el editor DC exporta a
`index.html`, o el `.dc.html` se borra. Ver [[atlas_frontend]].

### DT-003 · 🟠 IDOR en `lead_id`
`contact` (`index.ts:285`), `agenda_book` (`:397`) y `plan_pdf` (`:419-423`) aceptan cualquier UUID
sin verificar propiedad. Con un `lead_id` válido se puede sobrescribir el `contacto` de otro lead o
bajar su PDF/plan vía URL firmada. El rate-limit acota volumen, no acceso. Mitigante: el `lead_id` es
un uuid v4 no adivinable y solo lo conoce el propio visitante. Ver [[atlas_backend]].

### DT-004 · 🟠 `WIDGET_KEY` es el único auth de `widget-chat`, y está en el HTML
`index.html:647`, texto plano. Cualquiera puede consumir el agente Discovery (que cuesta tokens).
Sin rate-limit conocido del lado del widget. Ver [[atlas_deploy]].

### DT-005 · 🟠 Rate-limit fail-open y sin migración versionada
`index.ts:517` — si la RPC `landing_rl_hit` falla o no existe (deploy a un proyecto sin ella), **todo
pasa sin límite** y solo aparece en logs. Su SQL no está en el repo. Ver [[atlas_database]].

### DT-006 · 🟡 Origin allowlist evadible y demasiado ancha
Dos huecos en `index.ts:41,511`: (a) el check **solo aplica si hay header `Origin`** → `curl` lo
evade; (b) `([a-z0-9-]+\.)?vercel\.app` deja pasar cualquier deploy de Vercel del mundo. Ver
[[atlas_backend]].

### DT-007 · 🟡 Precios duplicados en 3 lugares
`PKGS` en JS (`index.html:667-671`), cards hardcodeadas en HTML (`index.html:574-599`), y el catálogo
dentro de `PLAN_SYSTEM` (`index.ts:161-163`). Los add-ons también están dos veces
(`index.html:946-947` y `950-951`). Cambiar uno solo deja la página mintiendo.

### DT-008 · 🟡 Fallos silenciosos sin alerta
`analyze` responde `ok:true` con `chips:[]` si Foundry falla (`index.ts:201-203`) e inserta el lead
igual; `firecrawlScrape` devuelve `""` ante cualquier error; sin `RESEND_API_KEY`, `contact` responde
OK **sin notificar a nadie** (`:291`). El usuario ve el fallback visual y nadie se entera. Ver
[[atlas_integrations]].

### DT-009 · 🟡 `Resend` sin timeout
`index.ts:294` — único fetch externo sin `withTimeout`; puede colgar `contact` hasta el límite de la
Edge Function.

### DT-010 · 🟡 PDF de una página sin control de overflow
`index.ts:441` — `draw()` decrementa `y` sin chequear límite; un plan largo dibuja fuera de página.
`y = Math.min(y, 96)` (`:486`) fuerza el footer, que puede encimarse con el contenido.

### DT-011 · 🟢 Fragilidad de `_bkChip` / `_bkDayMap`
`index.html:1016-1022` — se asignan como side-effect en un IIFE y se leen en la clave **siguiente**
del mismo object literal. Reordenar esas dos claves rompe la agenda con TypeError. Ver [[atlas_frontend]].

### DT-012 · 🟢 Código muerto: `answers` / `extra`
Siempre vacíos (`index.html:843`), con `hasExtra:false` fijo (`:992`); columnas correspondientes en
`landing_leads` siempre nulas. Restos de un cuestionario removido. El backend aún los valida y guarda.

### DT-013 · 🟢 Assets pesados y basura
`uploads/` pesa ~3.5MB sin optimizar: `yaubie.png` (1MB) se carga 4 veces, `Yaubmaster.png` (1.4MB)
sin comprimir, y **`OCESS (12).png` (1MB) es un duplicado huérfano byte-idéntico a `yaubie.png`** —
borrable ya. Ver [[atlas_frontend]].

### DT-014 · 🟠 Link de WhatsApp roto en el footer
`index.html:627` — `href="https://wa.me/"` **sin número**. Verificado 2026-07-15: manda al home de
WhatsApp, no a Yaub. Candidato histórico: `5218132402758` (número de Yaub Agenda) — **confirmar con
Jacobo cuál va**, porque el flujo de agenda ya migró al modal web. Fix de 1 línea.

### DT-015 · 🟢 Placeholders en producción
6 `image-slot` de testimonios vacíos (`index.html:314,321,325,332,336,340`); logos de clientes como
texto ("LOGO SazónMX", "LOGO Banca Delta", `490-519`); `folio` cae a `'YB-2026'` sin lead (`:1002`).

## Resuelta

_(nada aún)_
