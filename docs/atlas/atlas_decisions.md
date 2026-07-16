---
name: atlas_decisions
description: Decisiones de arquitectura (ADRs ligeros) de Jacobo-Yaub-Landing — el porqué de lo que parece raro.
metadata: 
  node_type: memory
  type: project
  originSessionId: bbd80f50-06fb-44ba-a2a2-409738db8649
---

# Atlas · Decisiones

ADRs ligeros. Varios están **inferidos del código y sus comentarios**, no confirmados con Jacobo —
marcados con ⚠️.

## ADR-001 · El servidor calcula las fechas, el LLM nunca ✅ confirmado
**Contexto:** la agenda la puede disparar un LLM (WhatsApp/voz) o el frontend.
**Decisión:** `landing-consultor` calcula fechas/slots server-side (`index.ts:351` lo dice explícito);
el modelo solo recibe strings ya formateados. `AGENDA_TZ = "America/Monterrey"` fijo.
**Porqué:** **gpt-4o-mini no sabe la fecha y la alucina.** Por eso el agente usa custom tools propias
(`consultor_agenda_slots` / `consultor_agenda_book` → `landing-consultor`) y
**NUNCA `calendar_check_availability` directo con este modelo.**
**Consecuencia:** más código de fechas en el server (`tzToday`, `slotLabel`), cero citas fantasma.
Calendario: `agenda_calendars` native, America/Monterrey, **L-V 10:00-18:00**; `agenda_services` =
sesión de 15 min. Ver [[atlas_integrations]].

## ADR-002 · `agenda_book` responde HTTP 200 incluso en error
**Decisión:** todos los fallos de `agenda_book` (`index.ts:378,381,391`) devuelven 200 con
`{ok:false, message}`.
**Porqué:** su consumidor principal es un LLM vía tool-call; un HTTP 500 se le presenta como "tool
failure" y el agente se atora, mientras que un `message` en español lo puede leer y explicar al
usuario.
**Consecuencia:** ⚠️ rompe la convención REST. Cualquier cliente que use `res.ok` se traga los
errores. El frontend lo maneja bien (`index.html:886`); un cliente nuevo no lo esperaría.

## ADR-003 · Bypass de seguridad con service role
**Decisión:** si el bearer == `SUPABASE_SERVICE_ROLE_KEY`, se saltan origin check y rate-limit
(`index.ts:507-508`).
**Porqué:** los tools server-to-server de WhatsApp/voz no mandan header `Origin` y comparten IP —
el hardening los habría bloqueado o rate-limiteado (comentarios `:38-40`).
**Consecuencia:** la seguridad del endpoint público depende de que la service role key nunca se
filtre. Ver [[atlas_backend]].

## ADR-004 · Toda la seguridad vive en la edge function, no en RLS
**Decisión:** `landing_leads` tiene RLS **habilitado con cero policies** → solo `service_role` entra.
El frontend nunca toca la tabla; todo pasa por la función.
**Porqué:** la landing es pública y anónima, no hay `auth.uid()` con el cual escribir una policy útil.
**Consecuencia:** la publishable key expuesta en el HTML es inofensiva. **No agregues policies "para
que jale el front"** — sería abrir la tabla al mundo. Ver [[atlas_database]].

## ADR-005 · ⚠️ Frontend en runtime DC single-file, sin build
**Decisión (inferida):** la landing se construye en un editor propietario ("DC") que emite un
`.dc.html` autocontenido; Vercel lo sirve tal cual, sin bundler ni `package.json`.
**Porqué (hipótesis):** iterar visual y rapidísimo sin pipeline; es una landing de marketing, no una
app.
**Consecuencia:** cero tooling (sin lint, sin tests, sin tree-shaking); CSS inline por elemento;
líneas de 900 chars; y la copia manual `index.html` ↔ `.dc.html` (`DT-002` en [[atlas_tech_debt]]).
**Antes de proponer migrar a React/Next: preguntar.** El editor DC parece ser parte del flujo de
trabajo de Jacobo, no un accidente.

## ADR-006 · El discovery lo hace un agente de la plataforma, no la landing ✅ confirmado
**Decisión:** el chat del paso 2 va a `widget-chat` (fn aparte) → assistant **"Agente Consultoría
Jacobo"** (`6abc23ed-5ae0-4d90-b47d-7c16d5ea5614`, ex-"Discovery — IA a tu medida"). Su transcript
alimenta la acción `plan`.
**Porqué:** un solo agente califica leads en **todos los canales** — web y WhatsApp. "Vive en Yaub",
no en la landing.
**Consecuencia:** la calidad del plan depende de un agente que **no vive en este repo** y puede
cambiar sin que el repo se entere. Su prompt trae reglas anti-loop (máx 5 preguntas, no repetir datos
del brief) porque la entrevista se alargaba sin entregar plan. Ver [[atlas_integrations]].

## ADR-007 · ⚠️ Azure Foundry (gpt-4o-mini) como LLM del backend
**Decisión:** `index.ts:20`, modelo hardcodeado; endpoint y api-version sí son env.
**Porqué (hipótesis):** costo — `analyze`/`plan` son tareas de extracción con `json_object`, no
requieren un modelo frontier.
**Consecuencia:** cambiar de modelo requiere deploy (asimetría rara: ¿por qué el endpoint es env y el
modelo no?). Vale la pena confirmar si fue deliberado.

## ADR-008 · El plan se cobra $400 MXN y se descuenta del paquete
**Fecha:** 2026-07-15 (decisión de Jacobo).
**Contexto:** el discovery gratis atraía tres perfiles no deseados: curiosos, quienes buscan copiar el
modelo, y quienes no tienen capacidad de pago.
**Decisión:** cobrar **$400 MXN por el plan, antes de mostrarlo**, y **descontarlos completos del
paquete si contratan**. Agendar pide además un **depósito reembolsable al asistir**. Se eliminó la
escasez por cupo ("máximo 6 clientes") — el filtro ahora es el precio, no el cupo.
**Porqué:** el precio filtra por intención y capacidad de pago sin castigar al cliente serio (para él
el plan termina siendo gratis). El depósito ataca el no-show.
**Consecuencias y tensiones abiertas:**
- ⚠️ **El depósito reembolsable castiga a quien sí asiste**: la comisión de MP no vuelve. Cada cita
  exitosa cuesta la comisión de un cobro neteado a cero.
- ⚠️ **Dos cobros seguidos** ($400 + depósito) duplican fricción y comisiones. Quien pagó los $400 **ya
  se filtró**. Se recomendó un solo cobro; Jacobo optó por mantener ambos por ahora.
- ⚠️ **Cobrar el plan "antes de mostrarlo"** deja pagando tokens de Foundry por quien no compra (el
  plan se genera antes del paywall). Alternativa sugerida: teaser borroso → cobra → revela.
- ⚠️ **$400 no frenan a un competidor** — frena curiosos. Contra la copia del modelo el control real es
  qué revela el plan (el "qué" público, el "cómo" en la sesión), no el precio.
**Estado:** copy publicado en la landing; **el cobro no existe** — ver `DT-016` en [[atlas_tech_debt]].

**Actualización 2026-07-15:** el precio se fija en **$400 MXN** (no USD). Resuelve la fricción de
moneda: MercadoPago México opera en pesos, así que no hay conversión ni configuración extra que hacer.
