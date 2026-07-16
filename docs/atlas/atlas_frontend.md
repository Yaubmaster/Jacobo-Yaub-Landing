---
name: atlas_frontend
description: "Frontend de la landing jacobo.yaub.ai — cotizador-ttq/index.html (runtime DC single-file), secciones, cotizador de 5 pasos, sistema de diseño y trampas al editar."
metadata: 
  node_type: memory
  type: project
  originSessionId: bbd80f50-06fb-44ba-a2a2-409738db8649
---

# Atlas · Frontend — `cotizador-ttq/index.html`

**1046 líneas / 126KB.** Single-file: markup + CSS inline + JS inline. Ver [[atlas_00_overview]].

## Runtime DC (NO es HTML estándar)

`index.html:6` carga `./support.js` — runtime propietario que define `x-dc`, `sc-if`, `sc-for`,
`x-import`, `{{binding}}`, `onClick="{{fn}}"`, `style-hover="…"`. **Sin `support.js` la página
renderiza vacío.**

**Por dentro sí es React**: `support.js` carga **React 18.3.1 UMD desde unpkg**
(`react.production.min.js` + `react-dom`), expone `window.React` y monta con `createRoot`.
**Pero eso no te da el ecosistema React**: no hay build, ni `package.json`, ni npm → **no puedes
instalar Framer Motion ni ninguna librería**, y el markup **no es JSX**. Para animar: CSS keyframes +
JS vanilla dentro de `class Component`. No metas `addEventListener` en el markup; usa `onClick="{{fn}}"`.

⚠️ **Dependencia de CDN**: unpkg (React) y Google Fonts. Si unpkg cae, **la página no renderiza nada**.

- `index.html:9-634` — `<x-dc>` (todo el markup)
- `index.html:10-43` — `<helmet>`: fuentes + único `<style>` global
- `index.html:635-1044` — `<script type="text/x-dc">` → `class Component extends DCLogic`

Vecinos: `support.js` (runtime), `deck-stage.js`, `image-slot.js` (componentes importables).

## Secciones (orden visual — reordenado 2026-07-15)

| # | Contenedor | Título |
|---|---|---|
| — | — | Orbs de fondo, navbar (`.mNav`), mascota `#yaubie` |
| — | `sc-if {{bookingOpen}}` | **Modal de agenda** |
| 1 | `#hero.mHero` | `Haz 10× más de lo que ya hacías.` → **el cotizador** |
| 2 | `[data-sec="s2"]` | `Te acompaño yo, no un curso grabado.` |
| 3 | `[data-sec="s4"]` | `EMPRESAS QUE CONFÍAN Y RESPALDAN` — carrusel de logos |
| — | `[data-sec="s5"]` | Testimonios — **oculta** tras `SHOW_TESTIMONIALS` |
| 4 | `[data-sec="s9"]` | `Lo que vas a aprender…` |
| 5 | `[data-sec="s6"]` | `De la plática al plan…` — diagrama fijo de 1160px |
| 6 | `[data-sec="s10"]` | `Agentes, equipo y operación` — carrusel de fotos de operación |
| 7 | `[data-sec="s3"]` | `Esto no es un curso…` — dashboard animado |
| 8 | `[data-sec="s7"]` | `Tres formas de empezar` — 3 cards de precio |
| 9 | `[data-sec="s8"]` | FAQ + footer |

⚠️ **El orden de `data-sec` NO es secuencial** (s2→s4→s5→s9→s6→s10→s3→s7→s8) y **el orden en el archivo
ES el orden visual** — no hay CSS que reordene. Para mover una sección se mueve su bloque completo.
Los sufijos son históricos: **`s4` no va antes que `s5`**. Al agregar una sección con `data-sec`
**debes** añadir su par `vo()/vy()` en `renderVals` o queda invisible (opacity 0).

Paddings verticales: 40px por lado en las secciones (32px en s4), hero `130px 24px 44px` — los 130px
de arriba son por el navbar fixed de 64px.

## Cotizador (dentro del hero)

| Líneas | Paso |
|---|---|
| 114-129 | 1 · Form de entrada (nombre, teléfono, rol, sitio, proyecto) |
| **130-177** | 2 · **Chat del consultor IA** → `widget-chat` |
| 178-204 | 3 · Diagrama SVG de etapas |
| 205-259 | 4 · Plan + precio + **botón PDF** (`243`) + captura de contacto |
| 260-270 | 5 · Cierre / CTA agenda |

**Gating:** `canGen()` (`788`) exige **≥3 turnos de usuario**; `maxUnlocked()` (`789-794`) bloquea
saltos; `goStep(4)` (`900`) no hace nada sin `aiPlan`. Al testear no puedes brincar al paso 4.

## JS — funciones clave (`class Component`, 636-1043)

| Líneas | Qué |
|---|---|
| 637-643 | `state` (37 claves) |
| 645-648 | Endpoints + claves (ver [[atlas_deploy]]) |
| 651-666 | `P` — **datos fallback** que se ven si la API falla |
| 667-671 | `PKGS` — precios `$4,990 / $12,900 / desde $2,990` |
| 754-760 | **`api(payload)`** — POST único a `landing-consultor` |
| 763-780 | **`widgetSend()`** — chat real → `widget-chat` |
| 801-824 | **`startCot()`** — valida, genera `visitorId` (812), dispara `analyze` (814) |
| 825-836 | `dlPdf()` → `plan_pdf` → `window.open(res.url)` |
| 837-849 | `genPlan()` → `plan` |
| 861-896 | Agenda: `openBooking()` (865-878, pide 14 días), `confirmBooking()` (879-896) |
| **918-1042** | **`renderVals()`** — el gran mapa de bindings. Todo `{{x}}` nace aquí |

Validaciones en `startCot` (`804-811`): nombre ≥5, teléfono ≥10 dígitos, rol ≥3, proyecto ≥20 chars.
No hay `<form>` ni `submit`: todo es `value="{{x}}" onChange="{{onX}}"` → `setState`.

## Sistema de diseño

- **Fuentes** (`11-12`): Google Fonts — Manrope (títulos) + Inter (cuerpo). Único CDN externo.
- **Vars CSS**: defaults en `16`; las reales en runtime en `46`, inyectadas por `renderVals` (`970`).
  `--accent:#1E2761` (azul marino), `--accent2:#EC4899` (rosa), `--ink:#1E293B`, `--muted:#64748B`.
  Fondo global `#FAFBFC` (`15`).
- **Paleta editable** vía `data-props` (`635`): `accentColor`, `accent2Color`. Leídas en `920-921`.
- **Breakpoint único**: `@media (max-width:760px)` en **`30-42`**, todo con `!important`. Clases hook:
  `.mOne .mTwo .mH1 .mHero .hideM .mNavBtn .mStageWrap .mStage .mModal`, `#yaubie`, `#chatCol`.
- **Keyframes** (`17-26`, `43`): `orb, fadeUp, chipIn, scan, glowPulse, blink, marquee, yaubie,
  gradMove, yaubieTravel`.

## Assets — `cotizador-ttq/uploads/` (~3.5MB, sin optimizar)

- `Yaub.icon.black.png` (118KB) — navbar `52`, footer `622`
- `yaubie.png` (1.0MB) — mascota `59`, avatar chat `138`/`148`, paso 5 `262`
- `Yaubmaster.png` (1.4MB) — foto de Jacobo `278`
- `OCESS (12).png` (1.0MB) — **huérfano y byte-idéntico a `yaubie.png`**. Borrable.

**6 `image-slot` vacíos**: videos testimonio (`314`, `325`, `340`), fotos (`321`, `332`, `336`).

## Flags y datos editables (en `class Component`, junto a `API`/`APIKEY`)

- **`SHOW_TESTIMONIALS = false`** — apaga la sección s5 completa vía `sc-if {{showTestimonials}}`.
  En `true` reaparece. No borres s5: está viva esperando testimonios reales.
- **`GALERIA[]`** — fotos de operación de la sección s10 (`{src, cap, w, h}`; w/h son las medidas reales,
  necesarias para reservar espacio y evitar layout shift). Fotos en `uploads/galeria/`, ya optimizadas (~1MB las 11). **`conarec.jpg` y `cx-forum.jpg`
  venían espejeadas** (selfies de cámara frontal, gafetes ilegibles) → volteadas con `ImageOps.mirror`.
- **`BRANDS[]`** — única fuente del carrusel de marcas (`{src, alt, h}`). `renderVals` la repite 8×
  en `marqueeBrands`. **Agregar/quitar una marca se hace solo aquí.**
  Logos en `uploads/logos/` normalizados a 120px de alto: `gabssa` (fondo blanco recortado por flood
  fill), `nr-finance` (venía JPG), `alianzatel` (**venía blanco sobre transparente → recoloreado a
  `#1E2761`; en su forma original era invisible sobre el fondo claro**), `yaub-ai`, `yaub-movil`.
  Las alturas (`h`) están afinadas por logo: mismo alto ≠ mismo peso óptico.

## Los dos carruseles: trampas que ya costaron

**Marquee de marcas (s4) y de fotos (s10) comparten el mismo keyframe `marquee` (0 → -50%).**

1. **`gap` descuadra el loop.** El keyframe `marquee` va de 0 a `-50%`; con `gap` el punto de repetición
   no coincide y salta. Por eso cada `<img>` lleva **`margin-right` uniforme**, no `gap`.
2. **Cada mitad debe ser más ancha que la pantalla.** Con `-50%` y solo 2 copias (~700px), al cerrar
   el ciclo **se ve un hueco en blanco** en cualquier monitor > 700px. Por eso son **8 copias**.

## Responsive — lo aprendido

- **`html,body{overflow-x:clip}`** (`:15`) — obligatorio: los orbs y `#yaubie` son `fixed` y se salen
  a propósito (`yaubieTravel` llega a `left:-10%`). Sin recorte, en móvil el `scrollWidth` llegaba a
  **1184px contra 390 de viewport**.
  ⚠️ **Tiene que ser `clip`, NUNCA `hidden`**: con `overflow-x:hidden` el **body se vuelve el
  contenedor de scroll** (`body.scrollTop` en vez de `window.scrollY`) y eso **rompe `scrollHero()`**
  del navbar, que usa `window.scrollTo`. Verificado en vivo.
- **Diagrama de s6**: lienzo fijo de 1160px con nodos `position:absolute` — **no se puede reflowear**.
  Va envuelto en `.mStageWrap` + `.mStage` (mismo patrón que el stage del paso 3): scrollea dentro de
  su caja en móvil.
- **Navbar**: el texto largo del CTA partía en 2 líneas y encimaba el logo. Patrón `hideM`/`showM` =
  "Habla con mi consultor IA" en escritorio, "Consultor IA" en móvil.
- `prefers-reduced-motion` (`:31-34`) apaga las 10 animaciones en loop. Antes no existía.

## Trampas al editar

1. **Líneas gigantes** — `283` (926 chars), `124` (739), `540` (650), `635` (620). Un edit por regex
   destruye la línea entera; ancla con contexto amplio.
2. **CSS inline por elemento** — solo 30 líneas de `<style>`. Cambiar un color = buscar/reemplazar en
   cientos de `style="…"`. Usa `var(--accent)`, no hex nuevos.
3. **`this._bkChip` / `this._bkDayMap`** se asignan como side-effect en un IIFE dentro de `bkDays`
   (`1016-1021`) y se leen en `bkTimes` (`1022`), la clave **siguiente** del mismo object literal.
   **Reordenar esas dos claves rompe la agenda con TypeError.**
4. **`s3` se anima una sola vez** vía flag `this.p3on` (`722`).
5. `componentDidUpdate` fuerza scroll de `#chatCol` en **cada** update (`730-733`) — no puedes
   scrollear arriba mientras algo cambie de estado.
6. **`wa.me/` sin número** en `627` — link roto en el footer.
7. Ver también [[atlas_tech_debt]] (precios duplicados, código muerto `answers`/`extra`).


## Chips de especialidad (s2)

`.spec` × 3: Voice / Chat / Contact Center & BPO. Cada uno con **SVG inline animado** — orbe con
waveform, burbuja escribiendo, diadema flotando. Nada de emojis.
⚠️ **Todo `transform` sobre un nodo SVG necesita `transform-box:fill-box`**; sin eso el origen es el
del lienzo y las piezas salen volando.

## Carrusel de fotos (s10) — por qué está así

- **Altura fija + `width:auto` = la foto conserva su proporción y NO se recorta.** Nada de
  `object-fit:cover` aquí: eso fue lo que cortaba las caras cuando era grid.
- **Sin `loading="lazy"`**: el carrusel se mueve solo, las fotos fuera de pantalla nunca disparaban
  la carga y se veían **celdas grises entrando a cuadro**. Van eager + `fetchpriority="low"`. Los 2
  sets comparten las mismas 11 URLs → el 2º sale de caché, no cuesta red.
- **`width`/`height` + `aspect-ratio` por foto** (medidas reales inyectadas en `GALERIA`): sin eso
  había **layout shift de ~700px** al cargar.

## El diagrama de s6 arrastraba 100px de vacío

Su lienzo tenía `height:250px` pero el contenido termina a los 150px. Los 100px muertos se sumaban
a los paddings y parecían un abismo antes de la galería. Ahora es `height:160px` **con el viewBox
del SVG bajado a `0 0 1160 160`**: div y viewBox deben compartir alto o los conectores se desalinean.


## El carrusel de fotos va por filas (armarFilas)

`armarFilas()` reparte `GALERIA` en filas: **MAX 6 por fila, MIN 3**. Si la última quedaría con
menos de MIN, **se fusiona con la anterior** — se prefiere una fila inflada (6+7) a una huérfana
con 1-2 fotos. Verificado de 4 a 20 fotos: nunca deja fila huérfana.

- **Direcciones alternas**: fila par `marquee` (←), impar `marqueeRev` (→). Distinta velocidad por
  fila (`52 + k*9` s) para que no marchen en bloque.
- **Copias por fila calculadas, no fijas**: cada fila se repite hasta que UNA MITAD supere 2600px.
  El keyframe corre a -50%, así que una mitad más angosta que la pantalla deja hueco en blanco.
  El ancho se estima con las medidas reales (`w/h × alto`), por eso `GALERIA` necesita `w`/`h`.
- `sc-for` **anidado sí funciona** en el runtime DC (fila → fotos). Verificado.


## i18n — cómo funciona y las dos trampas que costaron

`T = { es: {...}, en: {...} }` con **159 claves**. `state.lang` ('es' | 'en'), botón en el navbar
(`toggleLang`), y el texto sale como `{{t_clave}}`.

⚠️ **Trampa 1: el runtime DC NO resuelve bindings anidados** fuera de un `sc-for`. `{{t.clave}}`
devuelve **vacío en silencio** — la página renderiza sin texto y no hay error. Por eso `renderVals`
**aplana** el diccionario con prefijo:
```js
...Object.fromEntries(Object.entries(this.T[st.lang]).map(([k,v]) => ['t_'+k, v]))
```
⚠️ **Trampa 2: claves que empiezan con dígito rompen TODA la clase.** `400_mxn_que_descuentan:` lo
lee JS como literal numérico → `SyntaxError: Numeric separators are not allowed…` → el runtime tira
`logic class eval FAILED — the template renders with props only` y **todos** los bindings quedan
vacíos. Por eso **todas las claves van citadas** (`'400_mxn…':`). Si algún día la landing renderiza
sin textos, mira la consola: el error del runtime lo dice.

**Qué NO está en el diccionario** (a propósito): nombres propios, marcas (Yaub, Claude Code…),
precios y "EL PODER DE LA ACCIÓN".
**Estructuras aparte**: `FAQS_I18N`, `PKGS_I18N` (name/price no se traducen), `stepLabels`,
placeholders (`t_ph_*`) y los captions de `GALERIA` (guardan una clave `gcap*`, no el texto).

## Carrusel de herramientas del hero (TOOLS)

14 chips bajo el cotizador: responde "¿automatizar QUÉ?". Cada uno es **un solo path SVG** (`d`).
- **Marcas con licencia CC0** (Simple Icons): Gmail, Slack, WhatsApp, Google Drive, Sheets, Notion.
  Son **sólidos** → van con `fill`, no `stroke`. De ahí el flag `fill` y los bindings `{{tool.f}}`/`{{tool.s}}`.
- **Outlook, Teams y Excel NO están en Simple Icons**: Microsoft pidió que los retiraran. Para esos
  (y para los conceptuales) hay **glifos propios**.
- Todos monocromos a `var(--ink2)`: se leen como sistema, no como collage de logos.
