# Copiloto del dueño — estado

Fase actual: **0 — Inventario y catálogo de acciones** (esperando aprobación humana del catálogo y de la lista NUEVO).
Se relee al empezar cada sesión. Orden de módulos acordado: Clases → bus y auditoría → Agenda → Socios/CRM →
Cobros/Facturas → Suscripciones/Planes → Productos/Inventario/Ventas → Mensajes → Asistencia → Progreso → Reportes →
Usuarios/Ajustes.

## Stack identificado (verificado en el código, 2026-11-08)
| Capa | Tecnología | Dónde |
|---|---|---|
| Monorepo | pnpm workspaces, TypeScript, Biome (lint+formato) | `package.json`, `biome.json` |
| API | Fastify 5 + zod; cada ruta corre como el usuario (`app.asCaller` → RLS) | `apps/api/src/app.ts`, `apps/api/src/modules/*.ts`, `apps/api/src/routes/*.ts` |
| Base de datos | Postgres 16, RLS `FORCE` en todas las tablas, escrituras sensibles por funciones `SECURITY DEFINER` dueñas `app_definer` | `packages/db/migrations/00NN_*.sql` (29 migraciones) |
| Autenticación | JWT HS256 propio: correo+contraseña de personal (bcrypt, bloqueo, refresh rotativo), código por correo para socios | `apps/api/src/modules/auth.ts`, migraciones 0024/0026 |
| Web | React 18 + Vite + react-router; módulos con rutas y `audience` por rol | `apps/web/src/modules/*/index.ts`, `apps/web/src/App.tsx` |
| Hosting | Netlify: sitio estático + una función (`netlify/functions/api.mts` → `netlify/server-bundle.mjs`); Netlify Database (Postgres) con migraciones espejo e inmutables | `netlify.toml`, `netlify/database/migrations`, `applied-migrations.sha256` |
| Pruebas | vitest: db (790), api (304), web (179); compuerta `scripts/gate.sh` (secretos, términos prohibidos, espejo de migraciones, lint, build, typecheck, pruebas) | `scripts/gate.sh` |
| E2E | No hay suite e2e versionada; las verificaciones e2e se hicieron con Playwright ad hoc. **NUEVO**: suite e2e Playwright | — |

Rol del copiloto: `owner` (existe en `app.role_name`; el código no usa "admin").

## Piezas existentes que se reutilizan (no duplicar)
| Pieza | Estado | Decisión propuesta |
|---|---|---|
| `app.audit_log` + `app.audit()` | Solo inserción (sin UPDATE/DELETE por permisos); dueño lee todo, gerente su sede. 86 llamadas `PERFORM app.audit` en SQL; **muchas escrituras no auditan**. | **Extender** (columnas origen, antes/después, sesión y tool_call del copiloto, confirmación, resultado) en lugar de crear otra tabla. |
| Agente de voz Gemini Live (`apps/api/src/modules/live.ts`, `apps/web/src/components/LiveAgent.tsx`, `apps/web/src/lib/agent/*`) | Token efímero de un solo uso (correcto). Herramientas actuales: `describe_screen`, `fill_field`, `press`, `navigate` → **operan el DOM**. | **Conflicto** con la restricción "no manipulación del DOM para ejecutar acciones". Propuesta: conservar solo `navigate` y "prellenar" (marcado IA, el humano guarda); reemplazar `press`/`fill_field` como vía de ejecución por `ejecutar_accion` → bus. Requiere aprobación. |
| Propuesta→confirmación del agente coach (`app.coach_action`: proposed/confirmed/executed) | Patrón probado para el socio. | Reutilizar el patrón (estados y expiración) para las confirmaciones R1/R2 del copiloto. |
| Outbox de mensajería (`app.outbound_message`, cola con estado y consentimiento) | Específico de mensajes. | No sirve como outbox de conocimiento; `knowledge_outbox` es **NUEVO**. |
| Live board / reportes (`/v1/reports/*`, `/v1/floor/live`) | Lecturas tipadas existentes. | Base de `consultar` y `generar_reporte`. |

## Bloqueo reportado: Clases (diagnóstico de Fase 1, solo lectura)
Causa raíz confirmada con evidencia:
1. La API **sí** permite crear tipos de clase: `POST /v1/schedule/class-types` (`apps/api/src/modules/schedule.ts:117`), con RLS `class_type_insert` para owner/location_manager (`packages/db/migrations/0007_schedule.sql:694`).
2. La web **no** tiene ninguna pantalla ni botón que llame a esa ruta: el cliente solo lista (`apps/web/src/modules/schedule/api.ts:149`, `classTypes()`), no hay `createClassType`.
3. El formulario "Nueva sesión" exige una clase (`<select required>` en `apps/web/src/modules/schedule/AgendaScreen.tsx:573`) y, con el catálogo vacío, solo muestra "No hay clases en el catálogo todavía." (`AgendaScreen.tsx:563`, `dict.ts:37`) sin acción para crearla.
4. Producción (Fitness R Us) tiene **0** tipos de clase y **0** sesiones (verificado con `GET /v1/schedule/class-types` como dueño el 2026-11-08).
5. Tampoco existen: editar/desactivar/duplicar tipo de clase (hay política UPDATE pero no ruta), recurrencia de sesiones, instructor/sala/color/precio en el tipo.

## Decisiones tomadas
- El registro de acciones vive en el servidor (`apps/api/src/copilot/`), porque el bus y los permisos se validan ahí.
- Cada ruta real de la API (incluidas lecturas, públicas y de socio) figura en el registro; las que no aplican al copiloto llevan `copilot: false`.
- La prueba de cobertura usa la tabla de rutas real de Fastify (hook `onRoute` opcional en `buildApp`), no un grep.

## Pendiente de aprobación (al cerrar Fase 0)
Ver `CATALOGO-ACCIONES.md` § NUEVO.
