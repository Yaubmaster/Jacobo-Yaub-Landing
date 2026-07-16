# Troubleshooting — Jacobo-Yaub-Landing

Bitácora de errores resueltos. Más reciente arriba. Busca aquí **antes** de depurar: si el síntoma ya
apareció, aplica lo aprendido en vez de re-diagnosticar.

---

## [2026-07-16] Los botones de horario de la agenda no hacían nada (0 citas en toda la historia del landing)
**Área:** Frontend
**Síntoma:** El modal "Agenda 15 min con Jacobo" cargaba y mostraba los chips de día, pero la fila de
horarios salía con botones **vacíos, sin estilo y sin click**. Al darle "Confirmar mi cita" siempre
respondía `Elige un día y un horario.` — nunca se podía agendar. Sin error en consola. En datos:
16 citas con `source='agent'` (canal WhatsApp) contra **0 leads** en `status='cita_agendada'`.

**Causa raíz:** Colisión de namespace entre el `sc-for` y el i18n, no un problema de la API.
En `cotizador-ttq/index.html` el loop de horarios era:

```html
<sc-for list="{{bkTimes}}" as="t"><button onClick="{{t_pick}}" style="{{t_style}}">{{t_label}}</button></sc-for>
```

El runtime DC (`support.js`, `walkFor`) hace `sub = { ...vals, [asName]: item }` → con `as="t"` el item
vive en la clave **`t`** y se accede **con punto** (`{{t.pick}}`). Escrito con guion bajo, `resolvePath`
busca `vals['t_pick']` como identificador plano — que cae justo en el **namespace del i18n aplanado**
(`renderVals` expone el diccionario como `'t_' + clave`). Como no existen claves `label`/`pick`/`style`
en el diccionario, los tres resolvían a `undefined` **en silencio**. Era el único `sc-for` del archivo
escrito así; el de días (`as="d"`, `{{d.pick}}`) siempre funcionó, de ahí que se pudiera elegir día
pero nunca hora. Presente desde el commit `714a4d5` (2026-07-14), o sea desde que salió el front.

**Solución:** Migrado a los slots pre-formateados del servidor (`slots[{start,label}]` de
`agenda_slots`) con `sc-for as="s"` y bindings con punto (`{{s.pick}}` / `{{s.label}}` / `{{s.style}}`).
De paso se eliminaron `dayKey()`, `fmtDay()` y `fmtTime()`: el front ya no calcula ni formatea fechas
— pinta `label` tal cual y devuelve `start` sin transformar. Verificado en vivo: cita real creada en
`agenda_appointments` (`source='agent'`, `status='booked'`) y lead en `status='cita_agendada'`.

**Prevención:**
- En el runtime DC, **los items de `sc-for` se acceden SIEMPRE con punto** (`{{item.campo}}`). Con
  guion bajo no truena: resuelve a `undefined` y renderiza vacío.
- **Nunca uses `as="t"`** en un `sc-for` de este archivo: colisiona con el prefijo `t_` del i18n y
  convierte un typo en un bug invisible.
- Un binding que resuelve a `undefined` no avisa. Si un control interactivo "no hace nada" y la
  consola está limpia, sospecha del binding antes que de la API.

---
