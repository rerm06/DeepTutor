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

## Resultado del inventario (Fase 0)
- 264 rutas reales ↔ 264 acciones existentes (una por ruta) + propuestas NUEVO; ver `CATALOGO-ACCIONES.md`
  (generado: `pnpm --filter @gym/api copilot:doc`).
- Prueba de cobertura: `apps/api/test/copilot-registry.test.ts` (tabla de rutas real de Fastify ↔ registro;
  completitud de cada acción; documento sincronizado).

### Defectos encontrados (no corregidos en Fase 0; se atienden en su módulo)
| # | Defecto | Evidencia | Módulo |
|---|---|---|---|
| 1 | Crear tipo de clase no tiene pantalla, ni auditoría, ni prueba de éxito | `schedule.ts:117`, `web/schedule/api.ts:149`, `schedule.test.ts:93` | Clases |
| 2 | Cancelar sesión no avisa a los inscritos y no se deshace | `0007_schedule.sql` `cancel_class_session` | Agenda |
| 3 | Pasarela de pagos solo simulada; la tienda no la usa; la referencia del proveedor se calcula antes del cargo | `billing.ts` (~344), `store.ts` | Cobros / Ventas |
| 4 | `app.release_stale_orders()` citada pero no existe (pedidos en línea de >48 h no se liberan) | `0009_store.sql:393` | Ventas |
| 5 | `void_invoice` sin evento de auditoría propio, sin pantalla ni prueba | `0006_billing.sql` | Facturas |
| 6 | Web deja a `location_manager` gestionar planes y productos, pero la RLS solo al owner | `0006:906/909`, `0009:757/760` vs `CATALOG_MANAGERS` | Planes / Productos |
| 7 | Botón de puntos por clase llama sin `ref` → `ref_required` sin mapear (error genérico) | pestaña Puntos del socio, `engagement.ts` REASONS | Puntos |
| 8 | Cerrar una escalación no cierra la tarea CRM que creó | `coach_escalation_set_status` | Coach |
| 9 | `ListQuery` de evaluaciones acepta `kind`/`status` y los ignora | `health.ts` | Progreso |
| 10 | Escrituras sin auditoría: check-in/out, puerta, revisión facial, cambio de contraseña, crear tipo de clase, equipos/ejercicios/circuitos de sala, edición de leads y tareas, beneficios de retos | inventario por grupo | Bus y auditoría (Fase 2 lo resuelve para todas) |
| 11 | `whoami`, `triage-preview` y `coach/status` no chequean rol (solo lectura, bajo riesgo) | `health.ts`, `coach.ts` | Progreso |
| 12 | Consentimientos, historial de mensajes y bandeja los lee cualquier personal de la sede (incl. chef, clinician, accountant) | RLS 0004 | Mensajes |

## Decisiones humanas requeridas para pasar a Fase 1
1. **Aprobar el catálogo y la lista NUEVO** (o recortarla).
2. **Agente de voz existente (DOM)**: ¿reemplazar `fill_field`/`press` como vía de ejecución por `ejecutar_accion` → bus (propuesto) y dejar `navigate` y `prellenar_formulario`?
3. **Auditoría**: extender `app.audit_log` (propuesto) vs. tabla nueva.
4. **Tablas nuevas** (cada una requiere aprobación): `class_series` (recurrencia), columnas o tabla de detalles de clase (instructor/sala/color/plan), `knowledge_outbox`, instrucciones versionadas del copiloto, reportes guardados.
5. **Datos de salud y el copiloto**: el owner lee evaluaciones y planes clínicos completos de toda la organización (RLS 0010). ¿Puede el copiloto leerlos y llevarlos a File Search (solo con consentimiento, store de operación)? El coach (0016) excluye al owner por diseño: ¿se mantiene?
6. **Pagos reales**: Stripe no está conectado; las acciones R3 de cobro quedan en "preparar" hasta que se decida la integración.
7. **Clave de Gemini Developer API** para File Search (además de `GEMINI_LIVE_API_KEY`).
