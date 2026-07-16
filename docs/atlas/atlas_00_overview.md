---
name: atlas_00_overview
description: "Mapa de mapas de Jacobo-Yaub-Landing (jacobo.yaub.ai) — stack, topología, índice de secciones y verdades transversales. EMPIEZA AQUÍ."
metadata: 
  node_type: memory
  type: project
  originSessionId: bbd80f50-06fb-44ba-a2a2-409738db8649
---

# Atlas · Jacobo-Yaub-Landing

Landing de **"IA a tu medida"** de Jacobo Payán → **https://jacobo.yaub.ai**. Un cotizador
conversacional de 5 pasos: el visitante platica con un consultor IA, la IA le genera un plan
personalizado, se lo descarga en PDF y agenda una llamada.

**Repo:** `/Users/jacobopayan/Jacobo-Yaub-Landing` · `github.com/Yaubmaster/Jacobo-Yaub-Landing` (main)

## Stack

| Capa | Qué |
|---|---|
| Frontend | **HTML single-file** con runtime propietario **DC** (`support.js`), montado sobre **React 18.3.1 UMD desde unpkg** (`window.React` + `createRoot`). **Sin build, sin `package.json`, sin npm** → el markup NO es JSX y **no puedes instalar librerías** (Framer Motion, etc.). Solo CSS keyframes + JS vanilla. |
| Backend | **1 Supabase Edge Function** (Deno/TS): `landing-consultor` |
| DB | Postgres (Supabase) — la landing solo toca `landing_leads` + `landing_rate_limits` |
| LLM | **Azure AI Foundry · gpt-4o-mini** (no Anthropic, no OpenAI directo) |
| Hosting | Vercel, Root Directory = `cotizador-ttq` |

## Topología

```
Navegador (jacobo.yaub.ai)
   │  cotizador-ttq/index.html  (todo el CSS/JS inline)
   ├──► POST /functions/v1/landing-consultor   ← ESTE repo
   │      6 acciones: analyze · plan · plan_pdf · contact · agenda_slots · agenda_book
   │      ├──► Firecrawl        (scrapea el sitio del lead)
   │      ├──► Azure Foundry    (gpt-4o-mini → chips, plan)
   │      ├──► Resend           (email de aviso a jacobopayan@yaub.ai)
   │      ├──► calendar-proxy   (otra edge fn → agenda_appointments)
   │      └──► DB landing_leads + Storage yaub-quotations (PDF, signed 7d)
   └──► POST /functions/v1/widget-chat         ← FUERA de este repo
          el chat del paso 2; mismo agente Discovery que WhatsApp
```

## Índice de secciones

- [[atlas_frontend]] — la landing DC: secciones, cotizador de 5 pasos, bindings, diseño
- [[atlas_backend]] — `landing-consultor`: 6 acciones, prompts, capa de seguridad
- [[atlas_database]] — `landing_leads`, rate limits, storage, RLS
- [[atlas_integrations]] — Foundry, Firecrawl, Resend, calendar-proxy, widget-chat
- [[atlas_deploy]] — Vercel, deploy de functions, **drift prod↔repo**
- [[atlas_changelog]] · [[atlas_tech_debt]] · [[atlas_decisions]]

## Cómo se trabaja

```bash
cd ~/Jacobo-Yaub-Landing/cotizador-ttq && python3 -m http.server   # servir local
```
Sin build, sin `npm install`. `localhost` está en la allowlist de origins y es first-party del widget,
así que el flujo completo (chat, plan, PDF, agenda) **jala contra la fn y la DB de prod** — los leads
de prueba caen en `landing_leads` reales.

⚠️ **Git y unicode de macOS**: el repo tuvo duplicados NFD/NFC. Para tocar entradas NFD del índice hay
que poner `core.precomposeunicode=false` temporalmente.

⚠️ **Fuera de alcance — no tocar desde aquí**: los dashboards B2B viven en la **oficina de
yaub-platform** (`src/modules/b2b/`), repo aparte que trabaja **otro agente en otra terminal**.
Ver [[yaub-no-tocar-plataforma-b2b]].

## Verdades transversales (lo no obvio)

1. **El repo NO es la fuente de verdad de producción.** Hay drift confirmado: prod tiene una feature
   (`agente_yaub`) que no existe en ningún commit. Un `supabase functions deploy` desde el repo la
   borraría en silencio. Ver [[atlas_deploy]] antes de desplegar **cualquier** cosa.
2. **El proyecto Supabase `xwjhuixuvmyzfhujvxhf` es toda la plataforma Yaub** (~280 tablas, 184 edge
   functions). Esta landing es una esquina diminuta: 2 tablas y 1 función. **No asumas que algo del
   proyecto Supabase pertenece a la landing.**
3. **`cotizador-ttq/index.html` es copia byte-idéntica de `Landing IA a tu medida.dc.html`** (mismo
   md5). El primero es lo que sirve Vercel; el segundo es lo que abre el editor DC. **Editar uno deja
   el otro desincronizado.** Decidir fuente de verdad antes de tocar.
4. **No hay migraciones en el repo.** `supabase/` contiene exactamente un archivo (la función). El
   schema, la RPC `landing_rl_hit` y el bucket viven solo en el proyecto remoto → validar contra la
   DB en vivo, nunca contra el repo.
5. **El frontend es 100% cliente, sin secretos server-side.** La publishable key y la `WIDGET_KEY`
   están en texto plano en el HTML (`index.html:645-648`). La seguridad real vive en la edge function.
6. **La landing degrada en silencio**: si Foundry o Firecrawl fallan, `analyze` responde `ok:true`
   con datos vacíos y el frontend muestra su fallback visual (`index.html:651-666`). Un usuario feliz
   puede estar viendo contenido genérico. No hay alerta.
7. **Idioma del producto:** español mexicano neutro; los prompts lo exigen explícitamente.
8. **Precios duplicados en 3 lugares** (JS `PKGS`, cards HTML, prompt del LLM). Cambiar uno solo deja
   la página mintiendo. Ver [[atlas_tech_debt]].
