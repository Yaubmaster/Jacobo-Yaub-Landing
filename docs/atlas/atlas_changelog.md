---
name: atlas_changelog
description: Bitácora cronológica de cambios estructurales de Jacobo-Yaub-Landing (lo más nuevo arriba).
metadata: 
  node_type: memory
  type: project
  originSessionId: bbd80f50-06fb-44ba-a2a2-409738db8649
---

# Atlas · Changelog

## [2026-07-15] Galería de operación + decisión: la DB no se toca por ahora
**Sección(es):** atlas_frontend, atlas_tech_debt
**Qué cambió:** galería s10 con 17 fotos en carrusel de 3 filas (6+6+5) con direcciones alternas.
6 capturas de plataforma entran al inicio (producto primero). Chips de especialidad con SVG animados.
**Decisión de Jacobo (2026-07-15):** **NO se toca la DB por ahora.** El cobro de los $400 y los
códigos promo quedan **pendientes** — ver `DT-016`/`DT-017` en [[atlas_tech_debt]]. La landing sigue
anunciando precios que no se pueden cobrar: **no publicar como definitiva**.
**Pedido nuevo:** landing bilingüe ES/EN → `DT-019`. Medido: 363 strings + backend + agente externo.
No se hizo: cruza 3 sistemas y traducir solo la landing daría planes en español a leads en inglés.
**Dónde:** commits `cda3bca` → `d09e44b`.

## [2026-07-15] Nuevo modelo comercial: el plan se cobra ($400 MXN, se descuenta del paquete)
**Sección(es):** atlas_frontend (copy), atlas_decisions (ADR-008)
**Qué cambió (SOLO copy — el cobro NO existe todavía):**
- **El plan pasa a costar $400 MXN** (fijado más tarde ese día; primero fue $20 USD) y **se descuenta completo del paquete si contratan** → el filtro se
  mantiene y el riesgo del cliente serio es cero. Anunciado en: subtítulo del hero, paso 3 del embudo,
  FAQ "¿Por qué el plan tiene costo?", y un badge bajo "Tres formas de empezar".
- **Agendar pide depósito reembolsable al asistir** (anti no-show). Anunciado en el paso 4 y su FAQ.
- **Fuera "Cupo real: máximo 6 clientes activos"** → "Agenda abierta esta semana". Esto dejó huérfano
  el FAQ "¿Por qué hay cupo?", reemplazado por los dos FAQ de precio/depósito.
- **Las 3 promesas de "gratis y sin compromiso" se reescribieron**: con el plan cobrado eran falsas.
  Ahora el "gratis" se limita al discovery, que es lo único que sigue sin costo.
- Los 5 pasos de s6 muestran el embudo completo con los cobros a la vista (transparencia deliberada).
**Dónde:** `cotizador-ttq/index.html` (working tree, sin commitear).
**⚠️ RIESGO VIVO:** la página **anuncia precios que no se pueden cobrar** — no hay backend de pagos.
Hoy el flujo sigue agendando gratis. **No publicar hasta cerrar el cobro** o se promete algo que no
ocurre. Ver `DT-016`/`DT-017` en [[atlas_tech_debt]] y el ADR-008 en [[atlas_decisions]].

## [2026-07-15] Rework de la landing: copy, marcas reales, reorden y fix de responsive
**Sección(es):** atlas_frontend
**Qué cambió:**
- **Hero**: `¿Cuánto de tu semana…?` → **`Haz 10× más de lo que ya hacías.`** con el `10×` en gradiente
  + `heroPop`. Se quitó "15 minutos" del subtítulo: chocaba con la cita de 15 min que pasará a costar
  $500 (el visitante leía "15 minutos gratis" y luego se le cobraba).
- **Marcas**: fuera los 10 logos placeholder (SazónMX, Banca Delta…, 20 divs). Entran 5 marcas reales
  en carrusel con logos procesados. `BRANDS[]` es la única fuente.
- **Testimonios** (s5): ocultos tras `SHOW_TESTIMONIALS = false`, no borrados.
- **Reorden**: s4 (empresas) subió tras s2; s6 (cómo funciona) bajó tras s9.
  Orden nuevo: `s2 → s4 → [s5 oculta] → s9 → s6 → s3 → s7 → s8`.
- **Paddings**: 60px → 40px por lado (hero inferior 70 → 44). Huecos medidos: 160px/120px → ~80px.
- **Animación**: typing con 3 puntos, `glowPulse` en el CTA, stagger en skills y planLines, `.lift`.
- **Accesibilidad**: se agregó `prefers-reduced-motion` — no existía y había 10 animaciones en loop.
**Dónde:** `cotizador-ttq/index.html` (working tree, sin commitear). `uploads/logos/` (5 PNG nuevos).
**Atlas:** [[atlas_frontend]] reescrito en secciones, flags, marquee y responsive.
**Bugs encontrados y corregidos:**
1. **Scroll lateral en móvil**: `scrollWidth` 1184 vs viewport 390 (**+794px**). Causa: orbs/`#yaubie`
   fixed + el diagrama de s6 (lienzo fijo de 1160px, cero clases responsive). Fix: `overflow-x:clip`
   + `.mStageWrap` en s6. Ahora 0 de exceso en 360/390/768.
2. **`overflow-x:hidden` rompía el navbar** (bug introducido y detectado en la misma sesión): convertía
   al body en scroll container → `window.scrollY` se quedaba en 0 y `scrollHero()` moría. Se usó `clip`.
3. **Hueco en blanco del carrusel**: `-50%` con 2 copias más angostas que la pantalla. Fix: 8 copias +
   `margin-right` en vez de `gap`.
4. **Navbar encimado en móvil**: CTA en 2 líneas sobre el logo. Fix: `hideM`/`showM`.
**Pendiente:** el `.dc.html` quedó desincronizado a propósito (decisión del usuario: editar solo
`index.html`) — ver `DT-002` en [[atlas_tech_debt]].

## [2026-07-15] Init del Atlas
**Sección(es):** todas
**Qué cambió:** se construyó la base de conocimiento del proyecto desde cero, validando contra el
sistema en vivo (Supabase remoto), no solo contra el repo.
**Dónde:** repo en `698df06` tras `git pull`; proyecto Supabase `xwjhuixuvmyzfhujvxhf`.
**Atlas:** creados `atlas_00_overview`, `atlas_frontend`, `atlas_backend`, `atlas_database`,
`atlas_integrations`, `atlas_deploy`, `atlas_changelog`, `atlas_tech_debt`, `atlas_decisions`.
**Hallazgo principal:** **drift prod↔repo** — producción tiene la feature `agente_yaub` que no existe
en ningún commit. Ver [[atlas_deploy]]. Se abrió deuda `DT-001`.

## [2026-07-14] Hardening de seguridad de `landing-consultor`
**Sección(es):** atlas_backend
**Qué cambió:** el endpoint público se endureció — rate-limit por IP+acción vía RPC `landing_rl_hit`,
allowlist de origins, `esc()` de HTML en el email de notificación, guard SSRF en `normalizeUrl`
(bloquea hosts privados/reservados), y el 500 dejó de filtrar detalle interno. Bypass server-to-server
con service role para no romper los tools de WhatsApp/voz.
**Dónde:** commit `698df06`, `supabase/functions/landing-consultor/index.ts` (+68/−12).
**Atlas:** documentado en [[atlas_backend]] § Capa de seguridad. Confirmado presente en prod v9.

## [2026-07-14] `index.html` como home de jacobo.yaub.ai
**Sección(es):** atlas_frontend, atlas_deploy
**Qué cambió:** se copió `Landing IA a tu medida.dc.html` a `cotizador-ttq/index.html` para que el
dominio raíz sirva la landing (Root Directory de Vercel = `cotizador-ttq`). También se eliminó
`Cotizador Agéntico TTQ.zip` (artefacto no usado, 3.7MB).
**Dónde:** commits `714a4d5`, `a60162f`.
**Atlas:** [[atlas_deploy]]. Generó la deuda `DT-002` (dos copias byte-idénticas a mano).
