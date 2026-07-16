# Project Atlas — Jacobo-Yaub-Landing

Base de conocimiento del proyecto. **Empieza por [`atlas_00_overview.md`](atlas_00_overview.md).**

| Archivo | Qué |
|---|---|
| [`atlas_00_overview.md`](atlas_00_overview.md) | Mapa de mapas: stack, topología, verdades transversales |
| [`atlas_frontend.md`](atlas_frontend.md) | `cotizador-ttq/index.html`: secciones, cotizador, diseño, trampas |
| [`atlas_backend.md`](atlas_backend.md) | `landing-consultor`: 6 acciones, prompts, seguridad |
| [`atlas_database.md`](atlas_database.md) | `landing_leads`, rate limits, storage, RLS |
| [`atlas_integrations.md`](atlas_integrations.md) | Foundry, Firecrawl, Resend, calendar-proxy, widget-chat |
| [`atlas_deploy.md`](atlas_deploy.md) | Vercel + functions. ⚠️ **Drift prod↔repo — leer antes de desplegar** |
| [`atlas_changelog.md`](atlas_changelog.md) | Bitácora de cambios estructurales |
| [`atlas_tech_debt.md`](atlas_tech_debt.md) | Deuda técnica (15 pendientes) |
| [`atlas_decisions.md`](atlas_decisions.md) | ADRs: el porqué de lo que parece raro |

## Cómo se mantiene

El original vive en la **memoria de Claude Code** (se auto-carga cada sesión); esto es una **copia
legible/versionable** para humanos y para otras herramientas.

- Se actualiza con `/atlas` tras cambios estructurales (módulos, schema, endpoints, integraciones).
- `/atlas status` audita qué tan fresco está cada sección contra los commits recientes.
- Los `[[enlaces]]` son cross-refs entre archivos de memoria; aquí se leen como texto.
- **Los errores resueltos no van aquí** — van a `docs/TROUBLESHOOTING.md` vía la skill `error-log`.

Última sincronización: **2026-07-15** (init, repo en `698df06`).
