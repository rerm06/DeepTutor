# Catálogo de acciones del copiloto

Generado desde `apps/api/src/copilot/registry.ts` (no editar a mano). La prueba `apps/api/test/copilot-registry.test.ts` falla si una ruta de la API no está en el registro o si una acción está incompleta.

## Resumen

| | Total | R0 | R1 | R2 | R3 |
|---|---|---|---|---|---|
| Acciones existentes (una por ruta) | 264 | 122 | 68 | 66 | 8 |
| …de ellas, disponibles al copiloto del dueño | 200 | 100 | 46 | 48 | 6 |
| NUEVO (pedido del dueño, no existe; requiere aprobación) | 32 | 7 | 12 | 12 | 1 |

Riesgo: R0 sin confirmación · R1 confirmación verbal tras repetir los datos · R2 tarjeta con diff + clic del dueño · R3 el copiloto solo prepara; ejecuta el dueño en su pantalla.

## Acciones existentes por módulo

### acceso (20)

| Acción | Qué hace | Cómo lo diría el dueño | Ruta | Riesgo | Roles | Pantalla | Copiloto |
|---|---|---|---|---|---|---|---|
| `acceso.activar_acceso_facial` | Activa o apaga el acceso por reconocimiento facial en una sede. | «Activa el acceso por reconocimiento facial en Caguas»<br>«Apaga las cámaras de reconocimiento en Bayamón» | `PUT /v1/door/face-access` | R2 | owner | `/staff/door` | sí |
| `acceso.actividad_puerta` | Muestra las últimas 20 entradas y salidas de la sede (últimas 16 h). | «¿Quién entró y salió en la última hora en Caguas?»<br>«Enséñame la actividad de la puerta de hoy» | `GET /v1/door/activity/:locationId` | R0 | owner, location_manager, front_desk | `/staff/door` | sí |
| `acceso.camara_reconocimiento` | La cámara reporta un reconocimiento facial; registra entrada/salida o lo deja en revisión. | — | `POST /v1/public/device/recognitions` | R1 |  | `/staff/door` | no |
| `acceso.camara_sincronizar` | La cámara descarga las fotos de los socios con consentimiento facial de su sede. | — | `GET /v1/public/device/enrolment` | R0 |  | `/staff/door` | no |
| `acceso.cambiar_mi_consentimiento_facial` | El socio da o retira su consentimiento biométrico para entrar por cara. | — | `PUT /v1/me/biometric-consent` | R2 | member | `/me/access` | no |
| `acceso.codigos_puerta` | Devuelve los dos códigos QR rotativos (entrada y salida) que muestra la tableta de la puerta. | «Muestra el código de la puerta de Caguas»<br>«Pon la tableta de la entrada con el QR» | `GET /v1/door/kiosk/:locationId` | R0 | owner, location_manager, front_desk | `/staff/door` | no |
| `acceso.eventos_faciales` | Lista los últimos 30 reconocimientos de cámara, primero los pendientes de revisión. | «¿Hay reconocimientos pendientes de confirmar?»<br>«Enséñame los últimos eventos de las cámaras en Caguas» | `GET /v1/door/face-events` | R0 | owner, location_manager, front_desk | `/staff/door` | sí |
| `acceso.historial_entradas` | Lista los últimos intentos de entrada (permitidos y denegados) por sede o socio. | «¿Quién ha entrado hoy en Caguas?»<br>«¿Cuándo vino Pedro por última vez?» | `GET /v1/schedule/check-ins` | R0 | owner, location_manager, front_desk, member, guardian | `/staff/check-in` | sí |
| `acceso.listar_camaras` | Lista las cámaras/pasarelas de puerta registradas (dirección, revisión obligatoria, última conexión). | «¿Qué cámaras tengo registradas en Caguas?»<br>«¿Cuándo se conectó por última vez la cámara de la entrada?» | `GET /v1/door/devices` | R0 | owner, location_manager, front_desk | `/staff/door` | sí |
| `acceso.mi_consentimiento_facial` | Muestra al socio si dio su consentimiento para el acceso por reconocimiento facial. | — | `GET /v1/me/biometric-consent` | R0 | member | `/me/access` | no |
| `acceso.mi_qr` | Genera la credencial QR rotativa (30 s) del socio o de su menor a cargo. | — | `GET /v1/schedule/qr-token` | R0 | member, guardian | `/me/credential` | no |
| `acceso.pasar_puerta_socio` | El socio escanea el código de la puerta para registrar su entrada o salida. | — | `POST /v1/me/door` | R1 | member | `/door/:token` | no |
| `acceso.quien_esta_dentro` | Lista quién está dentro de la sede ahora (visitas abiertas de las últimas 16 h). | «¿Quién está ahora mismo en el gimnasio de Caguas?»<br>«¿Cuánta gente hay dentro en Bayamón?» | `GET /v1/door/inside/:locationId` | R0 | owner, location_manager, front_desk | `/staff/door` | sí |
| `acceso.registrar_camara` | Registra una cámara de puerta y devuelve una sola vez su secreto de conexión. | «Registra una cámara nueva en la entrada de Caguas»<br>«Añade la cámara de salida de Bayamón» | `POST /v1/door/devices` | R2 | owner, location_manager | `/staff/door` | no |
| `acceso.registrar_entrada` | Registra la entrada de un socio en una sede, por su ID o escaneando su QR, y decide si se permite. | «Dale entrada a Pedro Santiago en Caguas»<br>«Registra la llegada de Ana López» | `POST /v1/schedule/check-ins` | R1 | owner, location_manager, front_desk | `/staff/check-in` | sí |
| `acceso.registrar_salida` | Cierra a mano la visita de un socio que salió sin escanear. | «Marca la salida de Pedro en Caguas»<br>«Ana se fue y no escaneó, sácala» | `POST /v1/door/check-out` | R1 | owner, location_manager, front_desk | `/staff/door` | sí |
| `acceso.revisar_evento_facial` | Confirma (registra la entrada/salida) o descarta un reconocimiento de cámara pendiente. | «Confirma la entrada de Pedro que detectó la cámara»<br>«Descarta ese reconocimiento, no es ella» | `POST /v1/door/face-events/:id/review` | R1 | owner, location_manager, front_desk | `/staff/door` | sí |
| `acceso.revision_camara` | Cambia si una cámara exige confirmación de recepción en cada reconocimiento. | «Haz que la cámara de la entrada siempre pida confirmación»<br>«Quítale la revisión manual a la cámara de Bayamón» | `PUT /v1/door/devices/:id/review` | R2 | owner, location_manager | `/staff/door` | sí |
| `acceso.revocar_camara` | Revoca una cámara de puerta para que deje de funcionar. | «Revoca la cámara vieja de Caguas»<br>«Da de baja la cámara de la salida» | `DELETE /v1/door/devices/:id` | R2 | owner, location_manager | `/staff/door` | sí |
| `acceso.ver_acceso_facial` | Muestra por sede si el acceso por reconocimiento facial está activado. | «¿En qué sedes está activado el acceso por cara?»<br>«¿Las cámaras de Caguas están reconociendo socios?» | `GET /v1/door/face-access` | R0 | owner, location_manager, front_desk, trainer, nutritionist, chef, clinician, accountant | `/staff/door` | sí |

<details><summary>Campos, servicio, auditoría, conocimiento y prueba</summary>

- **`acceso.activar_acceso_facial`** — servicio `apps/api/src/modules/access.ts:149 → app.set_face_access (0024_access.sql:337)`; R2 sensible; roles por `0024_access.sql:340 set_face_access (role = owner)`.
  Entrada: body inline {location_id, on}.
  - `location_id` uuid (requerido) — sede de la org
  - `on` boolean (requerido)
  Auditoría: bus `acceso.activar_acceso_facial`; hoy `face_access.set`. Conocimiento: sistema. Prueba: `apps/api/test/access.test.ts`.
  Nota: Datos biométricos: decisión del dueño.
- **`acceso.actividad_puerta`** — servicio `apps/api/src/modules/access.ts:67 → SELECT app.check_in UNION app.check_out (LIMIT 20)`; R0 lectura; roles por `0007_schedule.sql:727 policy check_in_select + 0024_access.sql:559 policy check_out_select`.
  Entrada: params LocParams.
  Auditoría: bus `acceso.actividad_puerta`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/access.test.ts`.
- **`acceso.camara_reconocimiento`** — servicio `apps/api/src/modules/access.ts:380 → app_public.device_recognition (0025_device_review.sql:35)`; R1 reversible; roles por `apps/api/src/modules/access.ts:356 (cabecera Device) + app.device_auth`.
  Entrada: body Recognition.
  - `member_id` uuid (requerido)
  - `score` number (requerido) — 0–1; <0.45 rechazado; <0.62 o requires_review → revisión
  - `direction` enum — solo si la cámara es 'both'
  Auditoría: bus `acceso.camara_reconocimiento`; hoy **sin auditoría**. Conocimiento: socio. Prueba: `apps/api/test/access.test.ts`.
  Nota: Sin app.audit; queda en app.face_event.
- **`acceso.camara_sincronizar`** — servicio `apps/api/src/modules/access.ts:364 → app_public.device_enrolment (0025_device_review.sql:88)`; R0 lectura; roles por `apps/api/src/modules/access.ts:356 (cabecera 'Authorization: Device <id>:<secreto>') + app.device_auth`.
  Entrada: ninguna.
  Auditoría: bus `acceso.camara_sincronizar`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/access.test.ts`.
  Nota: Credencial de dispositivo; devuelve fotos (datos biométricos). KioskScreen.tsx:562 lo usa como pasarela en el navegador.
- **`acceso.cambiar_mi_consentimiento_facial`** — servicio `apps/api/src/modules/access.ts:128 → app.set_biometric_consent (0024_access.sql:355)`; R2 sensible; roles por `0024_access.sql:361 set_biometric_consent (role = member)`.
  Entrada: body inline {grant}.
  - `grant` boolean (requerido) — true = otorga versión face-v1; false = revoca
  Auditoría: bus `acceso.cambiar_mi_consentimiento_facial`; hoy `biometric_consent.grant|biometric_consent.revoke`. Conocimiento: socio. Prueba: `apps/api/test/access.test.ts`.
  Nota: Consentimiento: solo el socio.
- **`acceso.codigos_puerta`** — servicio `apps/api/src/modules/access.ts:45 → app.door_kiosk (0024_access.sql:159)`; R0 lectura; roles por `0024_access.sql:165 door_kiosk (role IN owner, location_manager, front_desk)`.
  Entrada: params LocParams.
  Auditoría: bus `acceso.codigos_puerta`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/access.test.ts`.
  Nota: Tokens rotativos para la tableta: fuera del copiloto.
- **`acceso.eventos_faciales`** — servicio `apps/api/src/modules/access.ts:212 → SELECT app.face_event JOIN app.member/app.door_device`; R0 lectura; roles por `0024_access.sql:572 policy face_event_select`.
  Entrada: query LocQuery.
  - `location_id` uuid — uuid
  Auditoría: bus `acceso.eventos_faciales`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/access.test.ts`.
- **`acceso.historial_entradas`** — servicio `apps/api/src/modules/schedule.ts:371 → SELECT app.check_in LEFT JOIN app.member`; R0 lectura; roles por `0007_schedule.sql:727 policy check_in_select (FOH de la sede; socio/tutor)`.
  Entrada: query CheckInQuery.
  - `location_id` uuid — uuid
  - `member_id` uuid — uuid
  - `limit` integer — 1–200 (coerce)
  Auditoría: bus `acceso.historial_entradas`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/schedule.test.ts`.
  Nota: Sin filtro de fechas: solo los últimos N. También en la pestaña de la ficha (/staff/members/:id).
- **`acceso.listar_camaras`** — servicio `apps/api/src/modules/access.ts:160 → SELECT app.door_device`; R0 lectura; roles por `0024_access.sql:569 policy door_device_select`.
  Entrada: query LocQuery.
  - `location_id` uuid — uuid
  Auditoría: bus `acceso.listar_camaras`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/access.test.ts`.
- **`acceso.mi_consentimiento_facial`** — servicio `apps/api/src/modules/access.ts:101 → SELECT app.biometric_consent + app.location_policy.face_access`; R0 lectura; roles por `apps/api/src/modules/access.ts:110 (filtro app.role()='member')`.
  Entrada: ninguna.
  Auditoría: bus `acceso.mi_consentimiento_facial`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/access.test.ts`.
- **`acceso.mi_qr`** — servicio `apps/api/src/modules/schedule.ts:346 → app.my_qr_token (0007_schedule.sql:201)`; R0 lectura; roles por `0007_schedule.sql:206 my_qr_token (sched_self_or_ward; staff no puede emitir)`.
  Entrada: query MemberQuery.
  - `member_id` uuid (requerido) — el propio socio o un menor a cargo
  Auditoría: bus `acceso.mi_qr`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/schedule.test.ts`.
  Nota: Token de acceso: fuera del copiloto.
- **`acceso.pasar_puerta_socio`** — servicio `apps/api/src/modules/access.ts:34 → app.door_pass (0024_access.sql:177) → access_enter/access_exit`; R1 reversible; roles por `0024_access.sql:195 door_pass (role = member)`.
  Entrada: body inline {token}.
  - `token` string (requerido) — 1–160; formato d1.<sede>.<i\|o>.<ventana>.<hmac>
  Auditoría: bus `acceso.pasar_puerta_socio`; hoy **sin auditoría**. Conocimiento: socio. Prueba: `apps/api/test/access.test.ts`.
  Nota: Esquema zod en línea sin nombre (access.ts:35). Registra check_in/check_out sin app.audit.
- **`acceso.quien_esta_dentro`** — servicio `apps/api/src/modules/access.ts:56 → app.location_inside (0024_access.sql:251)`; R0 lectura; roles por `0024_access.sql:255 location_inside (role IN owner, location_manager, front_desk)`.
  Entrada: params LocParams.
  Auditoría: bus `acceso.quien_esta_dentro`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/access.test.ts`.
- **`acceso.registrar_camara`** — servicio `apps/api/src/modules/access.ts:172 → app.create_door_device (0025_device_review.sql:8 → 0024_access.sql:390)`; R2 sensible; roles por `0024_access.sql:397 create_door_device (role IN owner, location_manager)`.
  Entrada: body inline {location_id, name, direction, requires_review}.
  - `location_id` uuid (requerido) — sede visible
  - `name` string (requerido) — trim, 2–60
  - `direction` enum (requerido)
  - `requires_review` boolean — true = toda detección la confirma recepción
  Auditoría: bus `acceso.registrar_camara`; hoy `door_device.create`. Conocimiento: sistema. Prueba: `apps/api/test/access.test.ts`.
  Nota: Devuelve el secreto del dispositivo una sola vez: no debe pasar por el copiloto/transcripciones. El cambio de requires_review del wrapper no se audita.
- **`acceso.registrar_entrada`** — servicio `apps/api/src/modules/schedule.ts:357 → app.check_in (0007_schedule.sql:241) → INSERT app.check_in`; R1 reversible; roles por `0007_schedule.sql:256 check_in (role IN owner, location_manager, front_desk)`.
  Entrada: body CheckInBody.
  - `location_id` uuid (requerido) — sede visible
  - `member_id` uuid — uno de los dos: member_id o token
  - `token` string — uno de los dos; 1–200 ASCII imprimible (QR v1.*)
  Auditoría: bus `acceso.registrar_entrada`; hoy **sin auditoría**. Conocimiento: socio. Prueba: `apps/api/test/schedule.test.ts`.
  Nota: Queda registro en app.check_in (permitido o denegado) pero sin app.audit. No se puede borrar.
- **`acceso.registrar_salida`** — servicio `apps/api/src/modules/access.ts:88 → app.check_out_member (0024_access.sql:239)`; R1 reversible; roles por `0024_access.sql:242 check_out_member (role IN owner, location_manager, front_desk)`.
  Entrada: body inline {location_id, member_id}.
  - `location_id` uuid (requerido) — uuid
  - `member_id` uuid (requerido) — uuid
  Auditoría: bus `acceso.registrar_salida`; hoy **sin auditoría**. Conocimiento: socio. Prueba: `apps/api/test/access.test.ts`.
  Nota: Esquema en línea (access.ts:89). 409 not_inside si no tenía visita abierta. Sin app.audit.
- **`acceso.revisar_evento_facial`** — servicio `apps/api/src/modules/access.ts:226 → app.review_face_event (0024_access.sql:518)`; R1 reversible; roles por `0024_access.sql:527 review_face_event (role IN owner, location_manager, front_desk)`.
  Entrada: params IdParams, body inline {accept}.
  - `accept` boolean (requerido) — true = confirma y registra; false = descarta
  Auditoría: bus `acceso.revisar_evento_facial`; hoy **sin auditoría**. Conocimiento: socio. Prueba: `apps/api/test/access.test.ts`.
  Nota: Sin app.audit (solo reviewed_by/reviewed_at en face_event). Requiere identificar el evento: el copiloto debe listar antes.
- **`acceso.revision_camara`** — servicio `apps/api/src/modules/access.ts:193 → app.set_device_review (0025_device_review.sql:19)`; R2 sensible; roles por `0025_device_review.sql:24 set_device_review (role IN owner, location_manager)`.
  Entrada: params IdParams, body inline {requires_review}.
  - `requires_review` boolean (requerido)
  Auditoría: bus `acceso.revision_camara`; hoy `door_device.review_policy`. Conocimiento: sistema. Prueba: `apps/api/test/access.test.ts`.
  Nota: Apagar la revisión en cámaras sin detección de vida baja la seguridad (0025_device_review.sql:1-4).
- **`acceso.revocar_camara`** — servicio `apps/api/src/modules/access.ts:204 → app.revoke_door_device (0024_access.sql:413) → UPDATE revoked_at`; R2 sensible; roles por `0024_access.sql:418 revoke_door_device (role IN owner, location_manager)`.
  Entrada: params IdParams.
  Auditoría: bus `acceso.revocar_camara`; hoy `door_device.revoke`. Conocimiento: sistema. Prueba: `apps/api/test/route-gaps.test.ts`.
  Nota: No borra la fila (marca revoked_at) pero no hay forma de reactivarla. Sin prueba HTTP.
- **`acceso.ver_acceso_facial`** — servicio `apps/api/src/modules/access.ts:139 → SELECT app.location LEFT JOIN app.location_policy WHERE app.can_see_location`; R0 lectura; roles por `apps/api/src/modules/access.ts:144 (app.can_see_location) + 0002_rls.sql:41 policy loc_select`.
  Entrada: ninguna.
  Auditoría: bus `acceso.ver_acceso_facial`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/route-gaps.test.ts`.
  Nota: Solo se prueba el PUT en access.test.ts. Un socio recibe lista vacía (can_see_location falso).

</details>

### agenda (11)

| Acción | Qué hace | Cómo lo diría el dueño | Ruta | Riesgo | Roles | Pantalla | Copiloto |
|---|---|---|---|---|---|---|---|
| `agenda.cancelar_cita` | Cancela una cita programada. | «Cancela la cita de entrenamiento de Luis del jueves»<br>«Anula el PT de Ana de mañana» | `POST /v1/schedule/appointments/:id/cancel` | R1 | owner, location_manager, front_desk, trainer, nutritionist, clinician, member, guardian | `/staff/appointments` | sí |
| `agenda.cancelar_reserva` | Cancela la reserva de un socio (marca cancelación tardía si aplica y sube al primero de la lista de espera). | «Cancela la reserva de Luis en el spinning de mañana»<br>«Saca a Carmen de la clase de yoga del sábado» | `POST /v1/schedule/bookings/:id/cancel` | R1 | owner, location_manager, front_desk, member, guardian | `/staff/schedule` | sí |
| `agenda.cancelar_sesion` | Cancela una sesión de clase y, con ella, todas sus reservas y lista de espera. | «Cancela la clase de spinning de hoy a las 6»<br>«Suspende el yoga del sábado en Caguas» | `POST /v1/schedule/sessions/:id/cancel` | R2 | owner, location_manager | `/staff/schedule` | sí |
| `agenda.crear_cita` | Agenda una cita individual de un socio con un profesional en una sede. | «Agenda un entrenamiento personal para Luis con Carla el jueves a las 5»<br>«Dale una cita de PT a Ana mañana a las 7 de la mañana» | `POST /v1/schedule/appointments` | R1 | owner, location_manager, front_desk, trainer, nutritionist, clinician | `/staff/appointments` | sí |
| `agenda.crear_sesion` | Programa una sesión de una clase del catálogo en una sede, con hora, instructor, sala y cupo. | «Programa spinning el lunes a las 6 de la tarde en Caguas con cupo de 20»<br>«Pon una clase de yoga el sábado a las 9 con Carla de instructora» | `POST /v1/schedule/sessions` | R1 | owner, location_manager | `/staff/schedule` | sí |
| `agenda.listar_citas` | Lista las citas (entrenamiento personal, evaluación, nutrición, clínica) en un rango, por sede o socio. | «¿Qué citas de entrenamiento personal hay mañana?»<br>«¿Qué citas tiene Luis Ortiz esta semana?» | `GET /v1/schedule/appointments` | R0 | owner, location_manager, front_desk, trainer, nutritionist, clinician, member, guardian | `/staff/appointments` | sí |
| `agenda.listar_instructores` | Lista entrenadores, nutricionistas y clínicos activos (por sede) para elegir instructor o profesional. | «¿Qué entrenadores hay en Caguas?»<br>«Dame la lista de instructores disponibles» | `GET /v1/schedule/staff` | R0 | owner, location_manager, front_desk, trainer, nutritionist, chef, clinician, accountant | `/staff/schedule` | sí |
| `agenda.listar_sesiones` | Lista las sesiones de clase en un rango de fechas con instructor, sala, cupo, inscritos y lista de espera. | «¿Qué clases hay mañana en Caguas?»<br>«¿Cuántos inscritos tiene el spinning de las 6?» | `GET /v1/schedule/sessions` | R0 | owner, location_manager, front_desk, trainer, nutritionist, chef, clinician, accountant, member, guardian | `/staff/schedule` | sí |
| `agenda.reservar_clase` | Inscribe a un socio en una sesión; si está llena queda en lista de espera. | «Inscribe a Luis Ortiz en el spinning de mañana a las 6»<br>«Reserva a Carmen en el yoga del sábado» | `POST /v1/schedule/bookings` | R1 | owner, location_manager, front_desk, member, guardian | `/staff/schedule` | sí |
| `agenda.reservas_socio` | Lista las reservas de un socio (clase, fecha, estado, lista de espera y cancelaciones tardías). | «¿A qué clases ha ido Pedro este mes?»<br>«¿Qué reservas tiene Ana López?» | `GET /v1/schedule/bookings` | R0 | owner, location_manager, front_desk, trainer, member, guardian | `/staff/members/:id` | sí |
| `agenda.ver_lista_sesion` | Muestra la lista de inscritos y de espera de una sesión con nombre, número y estado. | «¿Quién está inscrito en el spinning de las 6?»<br>«Dame la lista de espera de la clase de yoga» | `GET /v1/schedule/sessions/:id/roster` | R0 | owner, location_manager, front_desk, trainer | `/staff/schedule` | sí |

<details><summary>Campos, servicio, auditoría, conocimiento y prueba</summary>

- **`agenda.cancelar_cita`** — servicio `apps/api/src/modules/schedule.ts:311 → app.cancel_appointment (0007_schedule.sql:657)`; R1 reversible; roles por `0007_schedule.sql:663 cancel_appointment (socio/tutor, profesional asignado, FOH solo personal_training)`.
  Entrada: params IdParams.
  Auditoría: bus `agenda.cancelar_cita`; hoy `appointment.cancel`. Conocimiento: socio. Prueba: `apps/api/test/route-gaps.test.ts`.
  Nota: Sin prueba HTTP de esta URL.
- **`agenda.cancelar_reserva`** — servicio `apps/api/src/modules/schedule.ts:231 → app.cancel_booking (0007_schedule.sql:490)`; R1 reversible; roles por `0007_schedule.sql:505 cancel_booking (socio/tutor o FOH de la sede)`.
  Entrada: params IdParams.
  Auditoría: bus `agenda.cancelar_reserva`; hoy `booking.cancel`. Conocimiento: socio, clase. Prueba: `apps/api/test/schedule.test.ts`.
  Nota: Si libera un cupo también escribe 'booking.promote'. La cancelación tardía puede tener consecuencias (late_cancel).
- **`agenda.cancelar_sesion`** — servicio `apps/api/src/modules/schedule.ts:171 → app.cancel_class_session (0007_schedule.sql:368)`; R2 sensible; roles por `0007_schedule.sql:375 cancel_class_session (role IN owner, location_manager)`.
  Entrada: params IdParams.
  Auditoría: bus `agenda.cancelar_sesion`; hoy `class_session.cancel`. Conocimiento: clase, socio. Prueba: `apps/api/test/route-gaps.test.ts`.
  Nota: R2: afecta reservas de varios socios y no hay forma de reactivar la sesión ni las reservas. No avisa a los inscritos (sin mensaje). Ninguna prueba HTTP llama esta URL (las '/cancel' de schedule.test.ts son de reservas).
- **`agenda.crear_cita`** — servicio `apps/api/src/modules/schedule.ts:299 → app.create_appointment (0007_schedule.sql:607)`; R1 reversible; roles por `0007_schedule.sql:633 create_appointment (FOH solo personal_training; el resto solo para sí mismo)`.
  Entrada: body AppointmentBody.
  - `kind` enum (requerido) — personal_training: trainer; assessment: trainer/clinician; nutrition: nutritionist; clinical: clinician
  - `staff_member_id` uuid (requerido) — profesional activo asignado a la sede; no ocupado (staff_busy → 409)
  - `member_id` uuid (requerido) — socio de la org
  - `location_id` uuid (requerido) — sede visible
  - `starts_at` datetime (requerido) — ISO con zona; en el futuro
  - `ends_at` datetime (requerido) — > starts_at y ≤ starts_at + 8 h (CHECK de tabla)
  Auditoría: bus `agenda.crear_cita`; hoy `appointment.create`. Conocimiento: socio. Prueba: `apps/api/test/schedule.test.ts`.
  Nota: El dueño solo puede crear personal_training; los tipos de salud los agenda el propio profesional.
- **`agenda.crear_sesion`** — servicio `apps/api/src/modules/schedule.ts:151 → app.create_class_session (0007_schedule.sql:325)`; R1 reversible; roles por `0007_schedule.sql:332 create_class_session (role IN owner, location_manager)`.
  Entrada: body SessionBody.
  - `location_id` uuid (requerido) — sede visible para el que llama
  - `class_type_id` uuid (requerido) — tipo de clase activo de la org
  - `instructor_id` uuid|null — entrenador (role trainer) activo asignado a la sede; null = por asignar; no puede estar ocupado (staff_busy → 409)
  - `room` string — ≤60, sin saltos ni {}<>; CHECK SQL ^[A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9 &'.#-]{1,60}$
  - `starts_at` datetime (requerido) — ISO con zona; en el futuro
  - `ends_at` datetime (requerido) — ISO con zona; > starts_at y ≤ starts_at + 8 h
  - `capacity` integer (requerido) — 1–500
  Auditoría: bus `agenda.crear_sesion`; hoy `class_session.create`. Conocimiento: clase. Prueba: `apps/api/test/schedule.test.ts`.
  Nota: NUEVO: recurrencia — no existe crear una serie (p. ej. todos los lunes 6 pm por 8 semanas); una sesión por llamada, el copiloto tendría que iterar y no hay transacción común. NUEVO: editar sesión (cambiar hora, instructor, sala o cupo) — no hay ruta ni función SQL; solo crear y cancelar. capacity es obligatorio aunque el tipo tenga default_capacity, y ends_at no se deriva de duration_min: el copiloto debe calcularlos.
- **`agenda.listar_citas`** — servicio `apps/api/src/modules/schedule.ts:280 → SELECT app.appointment JOIN app.staff_member/app.member (máx. 500)`; R0 lectura; roles por `0007_schedule.sql:718 policy appointment_select`.
  Entrada: query Range.
  - `location_id` uuid — uuid
  - `member_id` uuid — uuid
  - `from` datetime — ISO con zona
  - `to` datetime — ISO con zona; rango ≤ 62 días
  Auditoría: bus `agenda.listar_citas`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/schedule.test.ts`.
  Nota: Owner/manager/front desk solo ven personal_training; las citas de salud solo las ven nutricionista/clínico o el profesional asignado.
- **`agenda.listar_instructores`** — servicio `apps/api/src/modules/schedule.ts:318 → SELECT app.staff_member JOIN app.staff_location`; R0 lectura; roles por `0002_rls.sql:80 policy staff_select + 0002_rls.sql:94 staffloc_select (requiere is_staff)`.
  Entrada: query StaffQuery.
  - `location_id` uuid — uuid
  Auditoría: bus `agenda.listar_instructores`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/schedule.test.ts`.
  Nota: No indica disponibilidad horaria; solo quién existe.
- **`agenda.listar_sesiones`** — servicio `apps/api/src/modules/schedule.ts:131 → SELECT app.class_session JOIN app.class_type/app.staff_member + app.session_occupancy (máx. 500)`; R0 lectura; roles por `0007_schedule.sql:702 policy class_session_select (staff: sus sedes; socios: toda la org)`.
  Entrada: query Range.
  - `location_id` uuid — uuid; filtra por sede
  - `member_id` uuid — aceptado por Range pero ignorado en esta consulta
  - `from` datetime — ISO 8601 con zona
  - `to` datetime — ISO 8601 con zona; to > from y rango ≤ 62 días
  Auditoría: bus `agenda.listar_sesiones`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/schedule.test.ts`.
  Nota: Range.member_id no tiene efecto aquí.
- **`agenda.reservar_clase`** — servicio `apps/api/src/modules/schedule.ts:194 → app.book_class (0007_schedule.sql:435)`; R1 reversible; roles por `0007_schedule.sql:450 book_class (socio/tutor o FOH de la sede)`.
  Entrada: body BookingBody.
  - `session_id` uuid (requerido) — sesión no cancelada y no empezada
  - `member_id` uuid (requerido) — socio elegible (no frozen/cancelled/lead; past_due según política)
  Auditoría: bus `agenda.reservar_clase`; hoy `booking.create`. Conocimiento: socio, clase. Prueba: `apps/api/test/schedule.test.ts`.
  Nota: También la usa el socio en /me/classes. Duplicado → 409 (already_booked).
- **`agenda.reservas_socio`** — servicio `apps/api/src/modules/schedule.ts:212 → SELECT app.booking JOIN app.class_session/app.class_type (máx. 200)`; R0 lectura; roles por `0007_schedule.sql:707 policy booking_select (socio/tutor, FOH de la sede, trainer de la sesión)`.
  Entrada: query MemberQuery.
  - `member_id` uuid (requerido) — uuid del socio
  Auditoría: bus `agenda.reservas_socio`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/schedule.test.ts`.
  Nota: Pestaña 'Agenda' de la ficha (MemberScheduleTab) y /me/classes. Sin filtro de fechas.
- **`agenda.ver_lista_sesion`** — servicio `apps/api/src/modules/schedule.ts:181 → app.session_roster (0007_schedule.sql:406)`; R0 lectura; roles por `0007_schedule.sql:165 sched_staff_session (FOH de la sede o el trainer instructor), usado en 0007_schedule.sql:411`.
  Entrada: params IdParams.
  Auditoría: bus `agenda.ver_lista_sesion`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/schedule.test.ts`.

</details>

### ajustes (4)

| Acción | Qué hace | Cómo lo diría el dueño | Ruta | Riesgo | Roles | Pantalla | Copiloto |
|---|---|---|---|---|---|---|---|
| `ajustes.cambiar_politica_sede` | Fija la política de una sede: horas mínimas para cancelar, penalidad por no-show y negar entrada a morosos. | «Cambia la ventana de cancelación de Caguas a 6 horas»<br>«Niega la entrada a los socios morosos en Bayamón» | `PUT /v1/schedule/location-policies/:location_id` | R2 | owner, location_manager | — | sí |
| `ajustes.listar_sedes` | Lista las sedes visibles para la sesión (nombre, marca, zona horaria y municipio). | «¿Cuántas sedes tengo?»<br>«Dame la lista de mis sedes» | `GET /v1/locations` | R0 | owner, location_manager, front_desk, trainer, nutritionist, chef, clinician, accountant, member, guardian | `/staff/org` | sí |
| `ajustes.ver_marca` | Lista las marcas de la organización con su tema visual (logo, colores, lema). | «¿Qué colores tiene la marca del gimnasio?»<br>«Enséñame el logo y el lema que estamos usando» | `GET /v1/brand` | R0 | owner, location_manager, front_desk, trainer, nutritionist, chef, clinician, accountant, member, guardian | — | sí |
| `ajustes.ver_politicas_sede` | Muestra por sede la ventana de cancelación, la penalidad por no-show y si se niega la entrada a morosos. | «¿Cuántas horas antes pueden cancelar en Caguas?»<br>«¿Le estamos negando la entrada a los morosos?» | `GET /v1/schedule/location-policies` | R0 | owner, location_manager, front_desk, trainer, nutritionist, chef, clinician, accountant, member, guardian | `/me/classes` | sí |

<details><summary>Campos, servicio, auditoría, conocimiento y prueba</summary>

- **`ajustes.cambiar_politica_sede`** — servicio `apps/api/src/modules/schedule.ts:265 → app.set_location_policy (0007_schedule.sql:572)`; R2 sensible; roles por `0007_schedule.sql:579 set_location_policy (owner, location_manager); 0007_schedule.sql:586 deny_past_due solo owner`.
  Entrada: params PolicyParams, body PolicyBody.
  - `cancel_window_hours` integer (requerido) — 0–72
  - `no_show_penalty` boolean (requerido)
  - `deny_past_due` boolean (requerido) — solo el owner puede cambiarlo
  Auditoría: bus `ajustes.cambiar_politica_sede`; hoy `location_policy.update`. Conocimiento: sistema. Prueba: `apps/api/test/schedule.test.ts`.
  Nota: NUEVO: la web no expone esta escritura (apps/web/src/modules/schedule/api.ts:176 solo policies GET). PUT completo: hay que enviar los tres campos, el copiloto debe leer los valores actuales antes. R2 porque negar acceso a morosos es decisión del dueño.
- **`ajustes.listar_sedes`** — servicio `apps/api/src/routes/org.ts:29 → SELECT app.location`; R0 lectura; roles por `0002_rls.sql:41 policy loc_select (staff: sus sedes; owner/accountant: toda la org; socios: todas)`.
  Entrada: ninguna.
  Auditoría: bus `ajustes.listar_sedes`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/route-gaps.test.ts`.
  Nota: Necesaria para resolver nombres de sede ('Caguas') a location_id en casi todas las acciones.
- **`ajustes.ver_marca`** — servicio `apps/api/src/routes/org.ts:20 → SELECT app.brand (máx. 20)`; R0 lectura; roles por `0002_rls.sql:34 policy brand_select (toda la org)`.
  Entrada: ninguna.
  Auditoría: bus `ajustes.ver_marca`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/route-gaps.test.ts`.
  Nota: Sin pantalla propia: la consume apps/web/src/lib/brandTheme.ts para aplicar el tema. No hay ruta API para editar la marca aunque RLS brand_update (0002_rls.sql:37) lo permitiría al owner.
- **`ajustes.ver_politicas_sede`** — servicio `apps/api/src/modules/schedule.ts:255 → SELECT app.location_policy`; R0 lectura; roles por `0007_schedule.sql:711 policy location_policy_select`.
  Entrada: ninguna.
  Auditoría: bus `ajustes.ver_politicas_sede`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/route-gaps.test.ts`.
  Nota: Solo la consume la pantalla del socio (/me/classes); no hay pantalla de staff que muestre las políticas. Sin prueba HTTP del GET.

</details>

### asistencia (1)

| Acción | Qué hace | Cómo lo diría el dueño | Ruta | Riesgo | Roles | Pantalla | Copiloto |
|---|---|---|---|---|---|---|---|
| `asistencia.marcar` | Marca si un socio asistió o no se presentó a su clase reservada. | «Marca que Luis asistió al spinning»<br>«Pon a Carmen como que no vino al yoga de hoy» | `POST /v1/schedule/bookings/:id/attendance` | R1 | owner, location_manager, front_desk, trainer | `/staff/schedule` | sí |

<details><summary>Campos, servicio, auditoría, conocimiento y prueba</summary>

- **`asistencia.marcar`** — servicio `apps/api/src/modules/schedule.ts:242 → app.mark_attendance (0007_schedule.sql:538)`; R1 reversible; roles por `0007_schedule.sql:546 mark_attendance → sched_staff_session (0007_schedule.sql:165)`.
  Entrada: params IdParams, body AttendanceBody.
  - `status` enum (requerido) — desde 30 min antes del inicio
  Auditoría: bus `asistencia.marcar`; hoy `booking.attendance`. Conocimiento: socio. Prueba: `apps/api/test/schedule.test.ts`.
  Nota: La penalidad por no-show solo queda marcada en la auditoría; el cargo es [VERIFICAR] de billing (0007_schedule.sql:562).

</details>

### clases (2)

| Acción | Qué hace | Cómo lo diría el dueño | Ruta | Riesgo | Roles | Pantalla | Copiloto |
|---|---|---|---|---|---|---|---|
| `clases.crear_tipo` | Crea una clase en el catálogo (nombre, descripción, duración y cupo por defecto). | «Crea una clase de spinning de 45 minutos»<br>«Añade yoga al catálogo con cupo de 15»<br>«Mete una clase nueva que se llame Zumba Gold de una hora» | `POST /v1/schedule/class-types` | R1 | owner, location_manager | `/staff/schedule` | sí |
| `clases.listar_tipos` | Lista el catálogo de clases (nombre, descripción, duración, cupo por defecto y si está activa). | «¿Qué clases tengo en el catálogo?»<br>«¿Cuánto dura y qué cupo tiene la clase de yoga?» | `GET /v1/schedule/class-types` | R0 | owner, location_manager, front_desk, trainer, nutritionist, chef, clinician, accountant, member, guardian | `/staff/schedule` | sí |

<details><summary>Campos, servicio, auditoría, conocimiento y prueba</summary>

- **`clases.crear_tipo`** — servicio `apps/api/src/modules/schedule.ts:117 → INSERT app.class_type (RLS class_type_insert)`; R1 reversible; roles por `0007_schedule.sql:694 policy class_type_insert`.
  Entrada: body ClassTypeBody.
  - `name` string (requerido) — trim; regex CLASS_NAME_PATTERN ^[A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9 &'.-]{1,60}$; CHECK SQL además rechaza lo que parezca dominio; único por org (UNIQUE org_id,name → 409 conflict)
  - `description` string — ≤500; sin saltos de línea ni {}<>
  - `duration_min` integer — 5–480
  - `default_capacity` integer — 1–500
  Auditoría: bus `clases.crear_tipo`; hoy **sin auditoría**. Conocimiento: clase. Prueba: `apps/api/test/schedule.test.ts`.
  Nota: NUEVO: la web no expone crear tipo de clase (apps/web/src/modules/schedule/api.ts:149 solo tiene classTypes GET); por eso el dueño no puede crear clases. NUEVO: sin auditoría — INSERT directo sin app.audit ni trigger (otros catálogos como product sí tienen trigger, 0009_store.sql:728); falta 'class_type.create'. La prueba solo cubre rechazos de validación (schedule.test.ts:93-94), no una creación exitosa. NUEVO: clases.editar_tipo (PATCH /v1/schedule/class-types/:id) — la BD ya lo permite (0007_schedule.sql:696 policy class_type_update + GRANT UPDATE(name, description, duration_min, default_capacity, active) 0007_schedule.sql:739) pero no hay ruta API ni UI. NUEVO: clases.desactivar_tipo (active=false) — mismo caso: columna y política existen, falta ruta/UI; create_class_session ya rechaza tipos inactivos (0007_schedule.sql:339).
- **`clases.listar_tipos`** — servicio `apps/api/src/modules/schedule.ts:107 → SELECT app.class_type ORDER BY active DESC, name`; R0 lectura; roles por `0007_schedule.sql:693 policy class_type_select (toda la org)`.
  Entrada: ninguna.
  Auditoría: bus `clases.listar_tipos`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/route-gaps.test.ts`.
  Nota: Incluye tipos inactivos (active=false) al final. Ninguna prueba HTTP hace GET de esta ruta.

</details>

### coach (15)

| Acción | Qué hace | Cómo lo diría el dueño | Ruta | Riesgo | Roles | Pantalla | Copiloto |
|---|---|---|---|---|---|---|---|
| `coach.atender_escalacion` | Marca como atendida una escalación del coach (dolor, síntomas agudos, lesión o petición de hablar con una persona). | «Marca como atendida la escalación de Pedro»<br>«Ya hablé con Ana, da por vista su alerta del coach» | `POST /v1/coach/escalations/:id/acknowledge` | R1 | trainer, location_manager | `/staff/members/:id` | no |
| `coach.borrar_memoria` | El socio o su tutor borra un dato de la memoria del coach (el texto se elimina; solo queda una lápida para auditoría). | — | `DELETE /v1/coach/memory/:id` | R3 | member, guardian | `/me/coach/memory` | no |
| `coach.cerrar_escalacion` | Cierra una escalación del coach (abierta o atendida). | «Cierra la escalación de dolor de Pedro»<br>«Da por cerrada la alerta del coach de Ana» | `POST /v1/coach/escalations/:id/close` | R1 | trainer, location_manager | `/staff/members/:id` | no |
| `coach.chatear` | El socio conversa con el coach de IA; un guardián detecta síntomas agudos o petición de hablar con una persona y escala, y las escrituras quedan como propuestas a confirmar. | — | `POST /v1/coach/chat` | R1 | member | `/me/coach/chat` | no |
| `coach.confirmar_accion` | El socio o su tutor confirma una acción propuesta por el coach (registrar serie, reservar clase, guardar memoria o check-in) y se ejecuta. | — | `POST /v1/coach/actions/:id/confirm` | R2 | member, guardian | `/me/coach/chat` | no |
| `coach.editar_memoria` | El socio o su tutor corrige un dato de la memoria del coach. | — | `PATCH /v1/coach/memory/:id` | R2 | member, guardian | `/me/coach/memory` | no |
| `coach.guardar_memoria` | El socio o su tutor añade un dato a la memoria del coach; se reconcilia (añadir, actualizar o ignorar duplicado). | — | `POST /v1/coach/memory` | R2 | member, guardian | `/me/coach/memory` | no |
| `coach.listar_acciones` | El socio o su tutor ve las últimas 50 acciones que el agente coach le propuso y su estado. | — | `GET /v1/coach/actions` | R0 | member, guardian | — | no |
| `coach.listar_checkins` | El socio o su tutor ve sus últimos 28 check-ins diarios (sueño, energía, dolor, puntuación). | — | `GET /v1/coach/checkins` | R0 | member, guardian | — | no |
| `coach.listar_memoria` | El socio (o su tutor) ve los datos que el coach recuerda de él: preferencias, restricciones, lesiones, metas, equipo y horario. | — | `GET /v1/coach/memory` | R0 | member, guardian | `/me/coach/memory` | no |
| `coach.rechazar_accion` | El socio o su tutor rechaza una acción propuesta por el coach. | — | `POST /v1/coach/actions/:id/reject` | R1 | member, guardian | `/me/coach/chat` | no |
| `coach.registrar_checkin` | El socio o su tutor registra el check-in de hoy (sueño 1–5, energía 1–5, dolor 0–10 y zona); dolor alto o síntomas agudos escalan a una persona. | — | `POST /v1/coach/checkins` | R2 | member, guardian | `/me/coach/today` | no |
| `coach.ver_estado_ia` | Indica qué proveedor de IA usa el coach y si está activado. | «¿Está prendido el coach de inteligencia artificial?»<br>«¿Qué proveedor de IA usa el coach?» | `GET /v1/coach/status` | R0 | owner, location_manager, front_desk, trainer, nutritionist, chef, clinician, accountant, member, guardian | `/staff/ai` | sí |
| `coach.ver_hoy` | Pantalla 'Hoy' del socio: check-in de hoy, banda de preparación y una sugerencia basada solo en el plan de entrenamiento publicado. | — | `GET /v1/coach/today` | R0 | member, guardian | `/me/coach/today` | no |
| `coach.ver_resumen_socio` | Pestaña 'Coach' de la ficha del socio: memoria (solo lectura), tendencia de 28 check-ins y escalaciones. | «¿Cómo van los check-ins de Pedro este mes?»<br>«¿Tiene Pedro alguna escalación abierta del coach?» | `GET /v1/coach/members/:id/summary` | R0 | trainer, location_manager | `/staff/members/:id` | no |

<details><summary>Campos, servicio, auditoría, conocimiento y prueba</summary>

- **`coach.atender_escalacion`** — servicio `apps/api/src/modules/coach.ts:822 bucle acknowledge/close (registrada en apps/api/src/modules/coach.ts:826) → app.coach_escalation_set_status(id,'acknowledged') (0016_coach.sql:307)`; R1 reversible; roles por `0016_coach.sql:314 coach_staff_can_see(e.member_id) (0016_coach.sql:140: trainer\|location_manager de la sede)`.
  Entrada: params IdParams, body EmptyBody.
  Auditoría: bus `coach.atender_escalacion`; hoy `coach.escalation.acknowledged`. Conocimiento: —. Prueba: `apps/api/test/coach.test.ts`.
  Nota: Transiciones: open→acknowledged\|closed, acknowledged→closed; no se reabre. OWNER → 403 forbidden (coach_staff_can_see lo excluye). La tarea CRM vinculada (crm_task_id) NO se toca: coach_escalation_set_status (0016_coach.sql:307-326) no actualiza crm_task, queda abierta aparte. RLS coach: memoria, check-ins y escalaciones solo para el propio socio/tutor y para trainer/location_manager de la sede (coach_staff_can_see, 0016_coach.sql:140); coach_action solo socio/tutor (0016_coach.sql:506). El OWNER NO tiene acceso (explícito en el comentario 0016_coach.sql:138-139); el copiloto del dueño no puede consultar esto. Lo único que el owner ve de coach: eventos coach.* en audit_log sin contenido (audit_select 0002_rls.sql:114) y la tarea CRM neutra 'Seguimiento con socio <n.º>' que crea coach_escalate (0016_coach.sql:186).
- **`coach.borrar_memoria`** — servicio `apps/api/src/modules/coach.ts:536 → app.coach_memory_write(...,'DELETE',...) (0016_coach.sql:249 content='(borrado)', deleted_at=now())`; R3 irreversible / dinero externo; roles por `apps/api/src/modules/coach.ts:540 rol member\|guardian si no 403; 0016_coach.sql:224 health_self_or_guardian`.
  Entrada: params IdParams.
  Auditoría: bus `coach.borrar_memoria`; hoy `coach.memory.delete`. Conocimiento: —. Prueba: `apps/api/test/coach.test.ts`.
  Nota: Borrado definitivo del contenido (no recuperable) → R3. RLS coach: memoria, check-ins y escalaciones solo para el propio socio/tutor y para trainer/location_manager de la sede (coach_staff_can_see, 0016_coach.sql:140); coach_action solo socio/tutor (0016_coach.sql:506). El OWNER NO tiene acceso (explícito en el comentario 0016_coach.sql:138-139); el copiloto del dueño no puede consultar esto. Lo único que el owner ve de coach: eventos coach.* en audit_log sin contenido (audit_select 0002_rls.sql:114) y la tarea CRM neutra 'Seguimiento con socio <n.º>' que crea coach_escalate (0016_coach.sql:186).
- **`coach.cerrar_escalacion`** — servicio `apps/api/src/modules/coach.ts:822 bucle acknowledge/close (registrada en apps/api/src/modules/coach.ts:826) → app.coach_escalation_set_status(id,'closed') (0016_coach.sql:307)`; R1 reversible; roles por `0016_coach.sql:314 coach_staff_can_see(e.member_id) (0016_coach.sql:140: trainer\|location_manager de la sede)`.
  Entrada: params IdParams, body EmptyBody.
  Auditoría: bus `coach.cerrar_escalacion`; hoy `coach.escalation.closed`. Conocimiento: —. Prueba: `apps/api/test/route-gaps.test.ts`.
  Nota: Transiciones: open→acknowledged\|closed, acknowledged→closed; no se reabre. Sin prueba HTTP (grep '/close'); SQL cubierto en packages/db/test/coach.test.ts:534. OWNER → 403 forbidden (coach_staff_can_see lo excluye). La tarea CRM vinculada (crm_task_id) NO se toca: coach_escalation_set_status (0016_coach.sql:307-326) no actualiza crm_task, queda abierta aparte. RLS coach: memoria, check-ins y escalaciones solo para el propio socio/tutor y para trainer/location_manager de la sede (coach_staff_can_see, 0016_coach.sql:140); coach_action solo socio/tutor (0016_coach.sql:506). El OWNER NO tiene acceso (explícito en el comentario 0016_coach.sql:138-139); el copiloto del dueño no puede consultar esto. Lo único que el owner ve de coach: eventos coach.* en audit_log sin contenido (audit_select 0002_rls.sql:114) y la tarea CRM neutra 'Seguimiento con socio <n.º>' que crea coach_escalate (0016_coach.sql:186).
- **`coach.chatear`** — servicio `apps/api/src/modules/coach.ts:686 → guardianPre + runCoachTurn (proveedor IA) + app.coach_chat_event (0016_coach.sql:399) + app.coach_action_propose (0016_coach.sql:330)`; R1 reversible; roles por `apps/api/src/modules/coach.ts:688 role !== 'member' → 403 (tutor también 403, apps/api/test/coach.test.ts:711)`.
  Entrada: body ChatBody.
  - `message` string (requerido) — trim 1–1000
  - `history` array — máx 8 de {role: member\|coach, content ≤1000}
  - `lang` enum
  Auditoría: bus `coach.chatear`; hoy `coach.chat.turn|coach.chat.emergency|coach.chat.human|coach.action.propose|coach.escalation.create`. Conocimiento: —. Prueba: `apps/api/test/coach.test.ts`.
  Nota: Solo socio (no tutor). No guarda el texto de la conversación; audita sin contenido. Llama a un proveedor externo de IA si está configurado. RLS coach: memoria, check-ins y escalaciones solo para el propio socio/tutor y para trainer/location_manager de la sede (coach_staff_can_see, 0016_coach.sql:140); coach_action solo socio/tutor (0016_coach.sql:506). El OWNER NO tiene acceso (explícito en el comentario 0016_coach.sql:138-139); el copiloto del dueño no puede consultar esto. Lo único que el owner ve de coach: eventos coach.* en audit_log sin contenido (audit_select 0002_rls.sql:114) y la tarea CRM neutra 'Seguimiento con socio <n.º>' que crea coach_escalate (0016_coach.sql:186).
- **`coach.confirmar_accion`** — servicio `apps/api/src/modules/coach.ts:640 → app.coach_action_decide(id,true) (0016_coach.sql:354) → executeAction (log_set\|book_class\|coach_memory_write\|coach_register_checkin) → app.coach_action_finish (0016_coach.sql:377)`; R2 sensible; roles por `0016_coach.sql:361 coach_action_decide exige health_self_or_guardian (staff nunca); prueba trainer→403 apps/api/test/coach.test.ts:731`.
  Entrada: params IdParams, body EmptyBody.
  Auditoría: bus `coach.confirmar_accion`; hoy `coach.action.confirmed|coach.action.executed|coach.action.failed`. Conocimiento: —. Prueba: `apps/api/test/coach.test.ts`.
  Nota: Caduca a las 24 h (action_expired). Puede reservar clase o escribir datos de salud → R2. Además se auditan los eventos del módulo que ejecuta. RLS coach: memoria, check-ins y escalaciones solo para el propio socio/tutor y para trainer/location_manager de la sede (coach_staff_can_see, 0016_coach.sql:140); coach_action solo socio/tutor (0016_coach.sql:506). El OWNER NO tiene acceso (explícito en el comentario 0016_coach.sql:138-139); el copiloto del dueño no puede consultar esto. Lo único que el owner ve de coach: eventos coach.* en audit_log sin contenido (audit_select 0002_rls.sql:114) y la tarea CRM neutra 'Seguimiento con socio <n.º>' que crea coach_escalate (0016_coach.sql:186).
- **`coach.editar_memoria`** — servicio `apps/api/src/modules/coach.ts:513 → app.coach_memory_write(...,'UPDATE',...,'member') (0016_coach.sql:215)`; R2 sensible; roles por `apps/api/src/modules/coach.ts:518 rol member\|guardian si no 403; 0016_coach.sql:224 health_self_or_guardian`.
  Entrada: params IdParams, body MemoryPatch.
  - `content` string (requerido) — 1–280, coachTextSafe
  - `category` enum — normalizeMemoryCategory si falta
  Auditoría: bus `coach.editar_memoria`; hoy `coach.memory.update|coach.escalation.create`. Conocimiento: —. Prueba: `apps/api/test/coach.test.ts`.
  Nota: RLS coach: memoria, check-ins y escalaciones solo para el propio socio/tutor y para trainer/location_manager de la sede (coach_staff_can_see, 0016_coach.sql:140); coach_action solo socio/tutor (0016_coach.sql:506). El OWNER NO tiene acceso (explícito en el comentario 0016_coach.sql:138-139); el copiloto del dueño no puede consultar esto. Lo único que el owner ve de coach: eventos coach.* en audit_log sin contenido (audit_select 0002_rls.sql:114) y la tarea CRM neutra 'Seguimiento con socio <n.º>' que crea coach_escalate (0016_coach.sql:186).
- **`coach.guardar_memoria`** — servicio `apps/api/src/modules/coach.ts:503 → rememberFact → app.coach_memory_lock + app.coach_memory_write (0016_coach.sql:215)`; R2 sensible; roles por `0016_coach.sql:224 health_self_or_guardian(p_member); apps/api/src/modules/coach.ts:321 actingMember`.
  Entrada: body MemoryCreate.
  - `member_id` uuid — tutor: id del menor
  - `category` enum — si falta se infiere del texto
  - `content` string (requerido) — 1–280, trim, coachTextSafe (sin < > { } ` \, enlaces ni control); máx 50 hechos vivos (memory_full)
  Auditoría: bus `coach.guardar_memoria`; hoy `coach.memory.add|coach.memory.update|coach.escalation.create`. Conocimiento: —. Prueba: `apps/api/test/coach.test.ts`.
  Nota: Contenido puede ser de salud (lesiones, alergias) → R2. Categoría injury abre escalación a humano (0016_coach.sql:257). Reconciliación NOOP no audita. RLS coach: memoria, check-ins y escalaciones solo para el propio socio/tutor y para trainer/location_manager de la sede (coach_staff_can_see, 0016_coach.sql:140); coach_action solo socio/tutor (0016_coach.sql:506). El OWNER NO tiene acceso (explícito en el comentario 0016_coach.sql:138-139); el copiloto del dueño no puede consultar esto. Lo único que el owner ve de coach: eventos coach.* en audit_log sin contenido (audit_select 0002_rls.sql:114) y la tarea CRM neutra 'Seguimiento con socio <n.º>' que crea coach_escalate (0016_coach.sql:186).
- **`coach.listar_acciones`** — servicio `apps/api/src/modules/coach.ts:627 → actingMember → SELECT app.coach_action LIMIT 50`; R0 lectura; roles por `0016_coach.sql:506 policy coach_action_select (solo health_self_or_guardian; staff nunca)`.
  Entrada: query MemberQuery.
  - `member_id` uuid — tutor: id del menor
  Auditoría: bus `coach.listar_acciones`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/route-gaps.test.ts`.
  Nota: Ninguna pantalla web ni prueba HTTP llama GET /coach/actions (las propuestas llegan en la respuesta de /coach/chat). RLS coach: memoria, check-ins y escalaciones solo para el propio socio/tutor y para trainer/location_manager de la sede (coach_staff_can_see, 0016_coach.sql:140); coach_action solo socio/tutor (0016_coach.sql:506). El OWNER NO tiene acceso (explícito en el comentario 0016_coach.sql:138-139); el copiloto del dueño no puede consultar esto. Lo único que el owner ve de coach: eventos coach.* en audit_log sin contenido (audit_select 0002_rls.sql:114) y la tarea CRM neutra 'Seguimiento con socio <n.º>' que crea coach_escalate (0016_coach.sql:186).
- **`coach.listar_checkins`** — servicio `apps/api/src/modules/coach.ts:558 → actingMember → SELECT app.daily_checkin LIMIT 28`; R0 lectura; roles por `apps/api/src/modules/coach.ts:321 actingMember; 0016_coach.sql:499 policy daily_checkin_select`.
  Entrada: query MemberQuery.
  - `member_id` uuid — tutor: id del menor
  Auditoría: bus `coach.listar_checkins`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/route-gaps.test.ts`.
  Nota: Ninguna pantalla web llama esta ruta y ninguna prueba HTTP la ejercita (grep). Staff ve la tendencia vía /coach/members/:id/summary. RLS coach: memoria, check-ins y escalaciones solo para el propio socio/tutor y para trainer/location_manager de la sede (coach_staff_can_see, 0016_coach.sql:140); coach_action solo socio/tutor (0016_coach.sql:506). El OWNER NO tiene acceso (explícito en el comentario 0016_coach.sql:138-139); el copiloto del dueño no puede consultar esto. Lo único que el owner ve de coach: eventos coach.* en audit_log sin contenido (audit_select 0002_rls.sql:114) y la tarea CRM neutra 'Seguimiento con socio <n.º>' que crea coach_escalate (0016_coach.sql:186).
- **`coach.listar_memoria`** — servicio `apps/api/src/modules/coach.ts:490 → actingMember (rol member\|guardian, si no 403) → SELECT app.member_memory`; R0 lectura; roles por `apps/api/src/modules/coach.ts:321 actingMember lanza 403 si rol ≠ member/guardian; 0016_coach.sql:496 policy member_memory_select`.
  Entrada: query MemberQuery.
  - `member_id` uuid — tutor: id del menor; socio: por defecto él mismo
  Auditoría: bus `coach.listar_memoria`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/coach.test.ts`.
  Nota: RLS coach: memoria, check-ins y escalaciones solo para el propio socio/tutor y para trainer/location_manager de la sede (coach_staff_can_see, 0016_coach.sql:140); coach_action solo socio/tutor (0016_coach.sql:506). El OWNER NO tiene acceso (explícito en el comentario 0016_coach.sql:138-139); el copiloto del dueño no puede consultar esto. Lo único que el owner ve de coach: eventos coach.* en audit_log sin contenido (audit_select 0002_rls.sql:114) y la tarea CRM neutra 'Seguimiento con socio <n.º>' que crea coach_escalate (0016_coach.sql:186). Para staff la lectura es vía /v1/coach/members/:id/summary (solo trainer/location_manager).
- **`coach.rechazar_accion`** — servicio `apps/api/src/modules/coach.ts:671 → app.coach_action_decide(id,false) (0016_coach.sql:354)`; R1 reversible; roles por `0016_coach.sql:361 health_self_or_guardian`.
  Entrada: params IdParams, body EmptyBody.
  Auditoría: bus `coach.rechazar_accion`; hoy `coach.action.rejected`. Conocimiento: —. Prueba: `apps/api/test/coach.test.ts`.
  Nota: RLS coach: memoria, check-ins y escalaciones solo para el propio socio/tutor y para trainer/location_manager de la sede (coach_staff_can_see, 0016_coach.sql:140); coach_action solo socio/tutor (0016_coach.sql:506). El OWNER NO tiene acceso (explícito en el comentario 0016_coach.sql:138-139); el copiloto del dueño no puede consultar esto. Lo único que el owner ve de coach: eventos coach.* en audit_log sin contenido (audit_select 0002_rls.sql:114) y la tarea CRM neutra 'Seguimiento con socio <n.º>' que crea coach_escalate (0016_coach.sql:186).
- **`coach.registrar_checkin`** — servicio `apps/api/src/modules/coach.ts:570 → registerCheckin → app.coach_register_checkin (0016_coach.sql:268)`; R2 sensible; roles por `0016_coach.sql:280 health_self_or_guardian; apps/api/src/modules/coach.ts:321 actingMember`.
  Entrada: body CheckinBody.
  - `member_id` uuid — tutor: id del menor
  - `sleep` integer (requerido) — 1–5
  - `energy` integer (requerido) — 1–5
  - `pain` integer (requerido) — 0–10; ≥4 escala
  - `pain_area` enum — obligatorio si y solo si pain>0; chest con dolor → emergencia
  - `pain_acute` boolean — true escala
  - `note` string — máx 280, coachTextSafe; palabras de síntoma agudo → emergencia
  Auditoría: bus `coach.registrar_checkin`; hoy `coach.checkin.create|coach.escalation.create`. Conocimiento: —. Prueba: `apps/api/test/coach.test.ts`.
  Nota: Un check-in por día local (UNIQUE member_id, local_date). Puntuación solo tras 7 días de base. Datos de salud → R2. RLS coach: memoria, check-ins y escalaciones solo para el propio socio/tutor y para trainer/location_manager de la sede (coach_staff_can_see, 0016_coach.sql:140); coach_action solo socio/tutor (0016_coach.sql:506). El OWNER NO tiene acceso (explícito en el comentario 0016_coach.sql:138-139); el copiloto del dueño no puede consultar esto. Lo único que el owner ve de coach: eventos coach.* en audit_log sin contenido (audit_select 0002_rls.sql:114) y la tarea CRM neutra 'Seguimiento con socio <n.º>' que crea coach_escalate (0016_coach.sql:186).
- **`coach.ver_estado_ia`** — servicio `apps/api/src/modules/coach.ts:484 → resolveProvider() (env COACH_AI_PROVIDER/API_KEY/MODEL), sin BD`; R0 lectura; roles por `apps/api/src/modules/coach.ts:484 sin chequeo de rol (solo JWT válido, apps/api/src/app.ts:54)`.
  Entrada: ninguna.
  Auditoría: bus `coach.ver_estado_ia`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/coach.test.ts`.
  Nota: También la usa el socio (pantalla de chat). /staff/ai tiene audience owner, location_manager, front_desk (apps/web/src/modules/hub/index.ts:5). No hay ruta para activar/configurar el proveedor: es por variables de entorno → NUEVO: si el dueño pide 'activa el coach', no existe acción.
- **`coach.ver_hoy`** — servicio `apps/api/src/modules/coach.ts:582 → actingMember → daily_checkin + care_plan publicado (publishedTrainingPlan)`; R0 lectura; roles por `apps/api/src/modules/coach.ts:321 actingMember; 0016_coach.sql:499 daily_checkin_select; 0010_health.sql:646 care_plan_select`.
  Entrada: query MemberQuery.
  - `member_id` uuid — tutor: id del menor
  Auditoría: bus `coach.ver_hoy`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/coach.test.ts`.
  Nota: RLS coach: memoria, check-ins y escalaciones solo para el propio socio/tutor y para trainer/location_manager de la sede (coach_staff_can_see, 0016_coach.sql:140); coach_action solo socio/tutor (0016_coach.sql:506). El OWNER NO tiene acceso (explícito en el comentario 0016_coach.sql:138-139); el copiloto del dueño no puede consultar esto. Lo único que el owner ve de coach: eventos coach.* en audit_log sin contenido (audit_select 0002_rls.sql:114) y la tarea CRM neutra 'Seguimiento con socio <n.º>' que crea coach_escalate (0016_coach.sql:186).
- **`coach.ver_resumen_socio`** — servicio `apps/api/src/modules/coach.ts:792 → SELECT member_memory + daily_checkin + coach_escalation (RLS)`; R0 lectura; roles por `apps/api/src/modules/coach.ts:794 rol ∉ {trainer, location_manager} → 403; 0016_coach.sql:496/499/502 policies con coach_staff_can_see (0016_coach.sql:140)`.
  Entrada: params IdParams.
  Auditoría: bus `coach.ver_resumen_socio`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/coach.test.ts`.
  Nota: La extracción lista EmptyBody por arrastre del bucle de escalaciones (coach.ts:822); esta ruta solo parsea IdParams. OWNER → 403 (probado apps/api/test/coach.test.ts:672-680; también nutritionist, front_desk, chef, accountant). RLS coach: memoria, check-ins y escalaciones solo para el propio socio/tutor y para trainer/location_manager de la sede (coach_staff_can_see, 0016_coach.sql:140); coach_action solo socio/tutor (0016_coach.sql:506). El OWNER NO tiene acceso (explícito en el comentario 0016_coach.sql:138-139); el copiloto del dueño no puede consultar esto. Lo único que el owner ve de coach: eventos coach.* en audit_log sin contenido (audit_select 0002_rls.sql:114) y la tarea CRM neutra 'Seguimiento con socio <n.º>' que crea coach_escalate (0016_coach.sql:186). Si el dueño pide '¿qué socios tienen dolor/escalaciones?', NO existe ruta para él → NUEVO: haría falta una vista agregada sin contenido de salud (p. ej. conteo de escalaciones abiertas por sede) con política explícita para owner.

</details>

### cobros (3)

| Acción | Qué hace | Cómo lo diría el dueño | Ruta | Riesgo | Roles | Pantalla | Copiloto |
|---|---|---|---|---|---|---|---|
| `cobros.registrar_pago` | Registra un pago (efectivo, tarjeta o ACH) contra una factura abierta; con tarjeta/ACH cobra por la pasarela. | «Pedro pagó 50 dólares en efectivo de su factura»<br>«Cóbrale con tarjeta el saldo de la factura de María»<br>«Registra el cheque 1234 por 30 dólares en la factura de Luis» | `POST /v1/invoices/:id/payments` | R3 | owner, location_manager, front_desk | `/staff/billing` | sí |
| `cobros.vender_pase` | Vende en recepción una sesión suelta, pase de día o paquete a un socio: emite la factura, cobra el total y otorga el pase o los créditos. | «Véndele a Pedro un pase de día en efectivo»<br>«Cóbrale a María un paquete de 10 clases con tarjeta»<br>«Vende dos paquetes de entrenamiento personal a José» | `POST /v1/members/:id/sales` | R3 | owner, location_manager, front_desk | `/staff/members/:id` | sí |
| `cobros.ver_comision_plataforma` | Muestra la comisión de la plataforma (puntos base y centavos) aplicada a cada factura. | «¿Cuánto nos cobra la plataforma en comisiones?»<br>«Enséñame las comisiones de plataforma de Caguas» | `GET /v1/billing/fees` | R0 | owner, location_manager, accountant | `/staff/billing` | sí |

<details><summary>Campos, servicio, auditoría, conocimiento y prueba</summary>

- **`cobros.registrar_pago`** — servicio `apps/api/src/modules/billing.ts:421 → gateway.charge (apps/api/src/modules/billing.ts:446) + app.record_payment (0006_billing.sql:609) → app.billing_apply_payment`; R3 irreversible / dinero externo; roles por `0006_billing.sql:618 y :622 record_payment (role IN owner, location_manager, front_desk + billing_staff_at)`.
  Entrada: params IdParams, body PaymentBody.
  - `method` enum (requerido) — card/ach → gateway.charge antes de registrar
  - `amount_cents` integer (requerido) — 1–10,000,000 y ≤ saldo abierto (comprobado antes del cargo y en SQL)
  - `idempotency_key` string (requerido) — regex ^[A-Za-z0-9_-]{8,64}$; misma clave+factura+monto devuelve el mismo pago
  - `reference` string — ≤40, regex ^[A-Za-z0-9 #._-]*$, máx. 6 dígitos (no números de tarjeta)
  Auditoría: bus `cobros.registrar_pago`; hoy `payment.record, invoice.update`. Conocimiento: socio, reporte. Prueba: `apps/api/test/billing.test.ts`.
  Nota: R3: con card_simulated/ach_simulated cobra por PaymentGateway (Stripe en producción; hoy simulado). Con cash sería R2. NUEVO: no existe reembolso de pagos de facturas (solo se anula una factura SIN pagos).
- **`cobros.vender_pase`** — servicio `apps/api/src/modules/billing.ts:340 → app.sell_one_off (0006_billing.sql:637) + gateway.charge (apps/api/src/modules/billing.ts:361, adaptador simulado)`; R3 irreversible / dinero externo; roles por `0006_billing.sql:650 y :653 sell_one_off (role IN owner, location_manager, front_desk + billing_staff_at + staff_can_see_member)`.
  Entrada: params IdParams, body SaleBody.
  - `price_id` uuid (requerido) — precio activo de drop_in/day_pass/class_pack/pt_package
  - `location_id` uuid (requerido) — sede donde vende el caller
  - `quantity` integer — 1–20; drop_in y day_pass solo 1
  - `method` enum (requerido) — card/ach pasan por PaymentGateway.charge
  - `idempotency_key` string (requerido) — regex ^[A-Za-z0-9_-]{8,64}$; reintento con misma clave devuelve la misma factura
  Auditoría: bus `cobros.vender_pase`; hoy `sale.one_off, invoice.issue, payment.record`. Conocimiento: socio, reporte. Prueba: `apps/api/test/billing.test.ts`.
  Nota: R3 porque con card_simulated/ach_simulated cobra a través del PaymentGateway, que en producción sería Stripe (spec §5.1); hoy solo existe simulatedGateway. Con method=cash sería R2. Hallazgo: el handler calcula provider_ref (sim_ + sha256) ANTES del cargo y lo guarda; el provider_ref real que devuelva un adaptador Stripe se ignora.
- **`cobros.ver_comision_plataforma`** — servicio `apps/api/src/modules/billing.ts:486 → app.invoice_fees (0006_billing.sql:798)`; R0 lectura; roles por `0006_billing.sql:802 invoice_fees (role IN owner, accountant, location_manager)`.
  Entrada: query FeesQuery.
  - `location_id` uuid
  Auditoría: bus `cobros.ver_comision_plataforma`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/billing.test.ts`.
  Nota: Máximo 500 facturas.

</details>

### comunidad (3)

| Acción | Qué hace | Cómo lo diría el dueño | Ruta | Riesgo | Roles | Pantalla | Copiloto |
|---|---|---|---|---|---|---|---|
| `comunidad.crear_publicacion` | El socio publica en el muro de la comunidad; queda pendiente hasta que se modere. | — | `POST /v1/engagement/posts` | R1 | member | `/me/wall` | no |
| `comunidad.listar_publicaciones` | Lista hasta 200 publicaciones del muro de la comunidad, filtrables por estado (pendiente, aprobada, rechazada). | «¿Hay publicaciones pendientes de aprobar?»<br>«Enséñame lo último del muro» | `GET /v1/engagement/posts` | R0 | owner, location_manager, front_desk, member, guardian | `/staff/engagement/community` | sí |
| `comunidad.moderar_publicacion` | Aprueba o rechaza una publicación del muro (una aprobada todavía se puede retirar). | «Aprueba la publicación de María en el muro»<br>«Quita el post de Juan del muro» | `POST /v1/engagement/posts/:id/moderate` | R1 | owner, location_manager, front_desk | `/staff/engagement/community` | sí |

<details><summary>Campos, servicio, auditoría, conocimiento y prueba</summary>

- **`comunidad.crear_publicacion`** — servicio `apps/api/src/modules/engagement.ts:544 → app.create_post()`; R1 reversible; roles por `packages/db/migrations/0012_engagement.sql:719-720 create_post (solo eng_is_self)`.
  Entrada: body PostBody.
  - `member_id` uuid (requerido) — debe ser el propio socio
  - `body` string (requerido) — zod ≤1000; la BD exige 1–500 tras compactar espacios y sin enlaces/teléfonos/promesas de salud (forbidden_content)
  Auditoría: bus `comunidad.crear_publicacion`; hoy `post.create`. Conocimiento: —. Prueba: `apps/api/test/engagement.test.ts`.
  Nota: Solo-socio; menores no pueden (minor_cannot_post); máximo 3 pendientes (post_limit).
- **`comunidad.listar_publicaciones`** — servicio `apps/api/src/modules/engagement.ts:531 → SELECT app.community_post`; R0 lectura; roles por `packages/db/migrations/0012_engagement.sql:900 policy community_post_select`.
  Entrada: query PostsQuery.
  - `status` enum — estado
  Auditoría: bus `comunidad.listar_publicaciones`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/engagement.test.ts`.
  Nota: Módulo 'comunidad' añadido (no estaba en la lista sugerida).
- **`comunidad.moderar_publicacion`** — servicio `apps/api/src/modules/engagement.ts:557 → app.moderate_post()`; R1 reversible; roles por `packages/db/migrations/0012_engagement.sql:745 moderate_post (role IN owner, location_manager, front_desk + can_see_location)`.
  Entrada: params IdParams, body ModerateBody.
  - `decision` enum (requerido) — pending→approved\|rejected; approved→rejected
  Auditoría: bus `comunidad.moderar_publicacion`; hoy `post.approved / post.rejected`. Conocimiento: —. Prueba: `apps/api/test/engagement.test.ts`.
  Nota: Aprobar hace visible el texto a todos los socios. 'rejected' es final (409 invalid_transition).

</details>

### crm (11)

| Acción | Qué hace | Cómo lo diría el dueño | Ruta | Riesgo | Roles | Pantalla | Copiloto |
|---|---|---|---|---|---|---|---|
| `crm.convertir_lead` | Convierte un lead en socio: crea la ficha de socio con su email, nombre y teléfono y marca el lead como ganado. | «Convierte a Carmen Rivera en socia»<br>«José Ortiz se inscribió, pásalo a socio» | `POST /v1/crm/leads/:id/convert` | R1 | owner, location_manager, front_desk | `/staff/crm/leads/:id` | sí |
| `crm.crear_lead` | Registra un lead nuevo (prospecto) con su fuente, nombre y al menos email o teléfono. | «Apunta un lead: Carmen Rivera, llegó por Instagram, su cel es 787-555-1234»<br>«Crea un prospecto walk-in en Caguas, José Ortiz, jose@correo.com»<br>«Añade a Luis Medina como lead referido y asígnaselo a la recepcionista» | `POST /v1/crm/leads` | R1 | owner, location_manager, front_desk | `/staff/crm/leads` | sí |
| `crm.crear_tarea` | Crea una tarea de seguimiento con fecha límite, asignada a un empleado y opcionalmente ligada a un lead o a un socio. | «Créale una tarea a Ana para llamar a Carmen mañana a las 10»<br>«Recuérdale al entrenador Pedro que le dé seguimiento a María López el viernes» | `POST /v1/crm/tasks` | R1 | owner, location_manager, front_desk | `/staff/crm/tasks` | sí |
| `crm.editar_lead` | Edita un lead: cambia su etapa (excepto 'ganado'), motivo de pérdida, fuente, datos de contacto, notas o responsable. | «Pasa a Carmen Rivera a contactado»<br>«Marca el lead de José como perdido porque se mudó»<br>«Cámbiale el teléfono a Luis Medina al 787-555-9876» | `PATCH /v1/crm/leads/:id` | R1 | owner, location_manager, front_desk | `/staff/crm/leads` | sí |
| `crm.editar_tarea` | Cambia el estado, título, fecha o responsable de una tarea de seguimiento. | «Marca como hecha la tarea de llamar a Carmen»<br>«Pasa la tarea de seguimiento de María al viernes»<br>«Cancela la tarea de llamar a José» | `PATCH /v1/crm/tasks/:id` | R1 | owner, location_manager, front_desk, trainer | `/staff/crm/tasks` | sí |
| `crm.listar_leads` | Lista hasta 500 leads (prospectos) visibles, filtrables por sede y etapa, ordenados por último cambio de etapa. | «Enséñame los leads nuevos de Bayamón»<br>«¿Cuántos prospectos tengo en prueba gratis?»<br>«Dame los leads que están en tour agendado» | `GET /v1/crm/leads` | R0 | owner, location_manager, front_desk | `/staff/crm/leads` | sí |
| `crm.listar_personal_asignable` | Lista el personal activo de una sede que puede ser responsable de un lead o recibir una tarea. | «¿A quién le puedo asignar tareas en Caguas?»<br>«¿Quién de recepción puede llevar leads en Bayamón?» | `GET /v1/crm/staff` | R0 | owner, location_manager, front_desk | `/staff/crm/leads` | sí |
| `crm.listar_tareas` | Lista hasta 500 tareas de seguimiento, filtrables por mías, socio, lead, sede o estado (abiertas primero). | «¿Qué tareas tengo pendientes hoy?»<br>«Enséñame las tareas abiertas de la sede de Carolina»<br>«¿Hay seguimientos pendientes con María López?» | `GET /v1/crm/tasks` | R0 | owner, location_manager, front_desk, trainer | `/staff/crm/tasks` | sí |
| `crm.registrar_actividad_lead` | Añade al historial del lead una llamada, mensaje, tour o nota. | «Anota que llamé a Carmen y quedó en venir el jueves»<br>«Pon una nota en el lead de José: quiere precio de pareja» | `POST /v1/crm/leads/:id/activities` | R1 | owner, location_manager, front_desk | `/staff/crm/leads/:id` | sí |
| `crm.ver_embudo` | Calcula el embudo de leads creados en un rango de fechas por sede y fuente: cuántos hay en cada etapa y el % de conversión. | «¿Cómo va el embudo de leads este mes?»<br>«¿Qué fuente me convierte más, Instagram o WhatsApp, desde enero?»<br>«Dame la conversión de leads de Bayamón en octubre» | `GET /v1/crm/funnel` | R0 | owner, location_manager | `/staff/crm/funnel` | sí |
| `crm.ver_lead` | Muestra la ficha de un lead con su historial de actividades (llamadas, mensajes, tours, notas y cambios de etapa). | «Ábreme el lead de Carmen Rivera»<br>«¿Qué se ha hablado con José Ortiz?» | `GET /v1/crm/leads/:id` | R0 | owner, location_manager, front_desk | `/staff/crm/leads/:id` | sí |

<details><summary>Campos, servicio, auditoría, conocimiento y prueba</summary>

- **`crm.convertir_lead`** — servicio `apps/api/src/modules/crm.ts:208 → app.convert_lead() → app.register_member()`; R1 reversible; roles por `packages/db/migrations/0008_crm.sql:286 convert_lead (crm_is_manager + can_see_location); packages/db/migrations/0003_definer_functions.sql:45 register_member`.
  Entrada: params IdParams.
  Auditoría: bus `crm.convertir_lead`; hoy `lead.convert`. Conocimiento: socio. Prueba: `apps/api/test/crm.test.ts`.
  Nota: No reversible: el lead queda 'won' para siempre (guard lead_converted) y el socio creado existe. Requiere email (email_required); 409 already_converted. Audita lead.convert y lead.stage. NO crea consentimiento de mensajería ni membresía/cobro. Clasificado R1 (crear ficha) pero el copiloto debería confirmar por ser irreversible.
- **`crm.crear_lead`** — servicio `apps/api/src/modules/crm.ts:131 → INSERT app.lead (triggers crm_lead_guard + crm_lead_log)`; R1 reversible; roles por `packages/db/migrations/0008_crm.sql:130 policy lead_insert (app.crm_is_manager())`.
  Entrada: body LeadBody.
  - `location_id` uuid (requerido) — sede del lead; debe ser visible para el que llama (RLS lead_insert)
  - `source` enum (requerido) — fuente
  - `full_name` string (requerido) — 1–200 caracteres, trim, sin caracteres de control
  - `email` string — email válido, se pasa a minúsculas, ≤254; email o phone obligatorio
  - `phone` string — regex ^\+?[0-9 ().-]{7,20}$; email o phone obligatorio
  - `notes` string — ≤2000
  - `owner_staff_id` uuid — responsable; debe ser owner/location_manager/front_desk activo en la sede (trigger crm_lead_guard → invalid_owner)
  Auditoría: bus `crm.crear_lead`; hoy `lead.create`. Conocimiento: socio. Prueba: `apps/api/test/crm.test.ts`.
  Nota: Capturar un lead NO crea consentimiento de mensajería (0008_crm.sql:7). knowledge 'socio' porque el lead es un socio potencial; no existe documento 'lead'.
- **`crm.crear_tarea`** — servicio `apps/api/src/modules/crm.ts:243 → INSERT app.crm_task (triggers crm_task_guard + crm_task_audit)`; R1 reversible; roles por `packages/db/migrations/0008_crm.sql:156 policy crm_task_insert`.
  Entrada: body TaskBody.
  - `location_id` uuid (requerido) — sede de la tarea (RLS crm_task_insert)
  - `title` string (requerido) — 1–200 caracteres, trim, sin caracteres de control
  - `due_at` string(datetime) (requerido) — ISO 8601 con zona horaria (offset obligatorio)
  - `assigned_staff_id` uuid (requerido) — owner/location_manager/front_desk/trainer de la sede (invalid_assignee)
  - `lead_id` uuid — lead de la misma sede (invalid_lead); excluyente con member_id
  - `member_id` uuid — socio visible para el que llama (invalid_member); excluyente con lead_id
  Auditoría: bus `crm.crear_tarea`; hoy `crm_task.create`. Conocimiento: socio. Prueba: `apps/api/test/crm.test.ts`.
  Nota: knowledge 'socio' solo si la tarea lleva member_id o lead_id.
- **`crm.editar_lead`** — servicio `apps/api/src/modules/crm.ts:171 → UPDATE app.lead (triggers crm_lead_guard + crm_lead_log)`; R1 reversible; roles por `packages/db/migrations/0008_crm.sql:133 policy lead_update`.
  Entrada: params IdParams, body LeadPatch.
  - `stage` enum — etapa manual; 'won' solo vía convertir
  - `lost_reason` string — 1–300 sin control; obligatorio si stage=lost (trigger lost_reason_required); se borra al salir de lost
  - `source` enum — fuente
  - `full_name` string — 1–200 caracteres, trim, sin caracteres de control
  - `email` string|null — email ≤254 o null; el lead debe conservar email o phone (CHECK lead_contact)
  - `phone` string|null — regex ^\+?[0-9 ().-]{7,20}$ o null
  - `notes` string|null — ≤2000 o null
  - `owner_staff_id` uuid|null — owner/location_manager/front_desk de la sede (invalid_owner)
  Auditoría: bus `crm.editar_lead`; hoy `lead.stage`. Conocimiento: socio. Prueba: `apps/api/test/crm.test.ts`.
  Nota: Body vacío → 400 empty_patch. Solo el cambio de etapa se audita (lead.stage, 0008_crm.sql:214) y genera actividad stage_change; editar nombre/contacto/notas/responsable NO deja auditoría. Un lead ganado no puede reabrirse (lead_converted).
- **`crm.editar_tarea`** — servicio `apps/api/src/modules/crm.ts:263 → UPDATE app.crm_task (crm_task_guard + crm_task_audit)`; R1 reversible; roles por `packages/db/migrations/0008_crm.sql:159 policy crm_task_update; :226-230 crm_task_guard (trainer solo status de las suyas)`.
  Entrada: params IdParams, body TaskPatch.
  - `status` enum — estado; completed_at lo pone el trigger
  - `title` string — 1–200 caracteres, trim, sin caracteres de control
  - `due_at` string(datetime) — ISO 8601 con offset
  - `assigned_staff_id` uuid — owner/location_manager/front_desk/trainer de la sede (invalid_assignee)
  Auditoría: bus `crm.editar_tarea`; hoy `crm_task.update`. Conocimiento: socio. Prueba: `apps/api/test/crm.test.ts`.
  Nota: Body vacío → 400 empty_patch. Solo se audita cambio de estado o responsable; cambiar título/fecha no deja auditoría.
- **`crm.listar_leads`** — servicio `apps/api/src/modules/crm.ts:118 → SELECT app.lead (LIMIT 500)`; R0 lectura; roles por `packages/db/migrations/0008_crm.sql:127 policy lead_select (app.crm_is_manager() :98-99; sede propia salvo owner)`.
  Entrada: query LeadQuery.
  - `location_id` uuid — uuid de sede
  - `stage` enum — etapa del lead
  Auditoría: bus `crm.listar_leads`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/crm.test.ts`.
  Nota: Límite fijo de 500 filas sin paginación.
- **`crm.listar_personal_asignable`** — servicio `apps/api/src/modules/crm.ts:297 → SELECT app.staff_member WHERE app.crm_is_manager() AND app.crm_staff_at_location()`; R0 lectura; roles por `apps/api/src/modules/crm.ts:302 (app.crm_is_manager() en el WHERE); packages/db/migrations/0008_crm.sql:98-99`.
  Entrada: query StaffQuery.
  - `location_id` uuid (requerido) — uuid de sede
  - `purpose` enum — lead → owner/location_manager/front_desk; task → además trainer
  Auditoría: bus `crm.listar_personal_asignable`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/crm.test.ts`.
  Nota: Otros roles reciben lista vacía (no 403). Herramienta auxiliar para resolver nombres → ids antes de crear/editar lead o tarea.
- **`crm.listar_tareas`** — servicio `apps/api/src/modules/crm.ts:220 → SELECT app.crm_task (app.crm_my_staff_ids())`; R0 lectura; roles por `packages/db/migrations/0008_crm.sql:151 policy crm_task_select (trainer solo las suyas)`.
  Entrada: query TaskQuery.
  - `mine` enum — solo tareas asignadas a mí
  - `member_id` uuid — uuid
  - `lead_id` uuid — uuid
  - `location_id` uuid — uuid
  - `status` enum — estado
  Auditoría: bus `crm.listar_tareas`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/crm.test.ts`.
  Nota: También aparece como pestaña 'Tareas' en /staff/members/:id (memberTabs del módulo crm).
- **`crm.registrar_actividad_lead`** — servicio `apps/api/src/modules/crm.ts:192 → INSERT app.lead_activity`; R1 reversible; roles por `packages/db/migrations/0008_crm.sql:144 policy lead_activity_insert`.
  Entrada: params IdParams, body ActivityBody.
  - `kind` enum (requerido) — tipo de actividad
  - `body` string (requerido) — 1–2000, trim
  Auditoría: bus `crm.registrar_actividad_lead`; hoy **sin auditoría**. Conocimiento: socio. Prueba: `apps/api/test/crm.test.ts`.
  Nota: La actividad es append-only (sin UPDATE/DELETE) y no se audita aparte. kind='message' solo REGISTRA que se habló; no envía nada.
- **`crm.ver_embudo`** — servicio `apps/api/src/modules/crm.ts:283 → app.crm_funnel()`; R0 lectura; roles por `packages/db/migrations/0008_crm.sql:315 crm_funnel (role IN owner, location_manager)`.
  Entrada: query FunnelQuery.
  - `from` string(date) (requerido) — YYYY-MM-DD; fecha local de la sede
  - `to` string(date) (requerido) — YYYY-MM-DD; from ≤ to y rango ≤ 366 días (invalid_range)
  - `location_id` uuid — uuid de sede
  Auditoría: bus `crm.ver_embudo`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/crm.test.ts`.
  Nota: Cohorte por fecha de CREACIÓN del lead con su etapa ACTUAL (no histórico de transiciones).
- **`crm.ver_lead`** — servicio `apps/api/src/modules/crm.ts:152 → SELECT app.lead + app.lead_activity`; R0 lectura; roles por `packages/db/migrations/0008_crm.sql:127 policy lead_select; :141 lead_activity_select`.
  Entrada: params IdParams.
  Auditoría: bus `crm.ver_lead`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/crm.test.ts`.
  Nota: 404 si el lead no existe o está fuera de la sede del que llama (indistinguibles).

</details>

### equipos (12)

| Acción | Qué hace | Cómo lo diría el dueño | Ruta | Riesgo | Roles | Pantalla | Copiloto |
|---|---|---|---|---|---|---|---|
| `equipos.confirmar_averia` | Confirma un reporte de avería y saca el equipo de servicio. | «Confirma la avería de la trotadora TM-01»<br>«Sí, la bicicleta está dañada, sácala de servicio» | `POST /v1/floor/issues/:id/confirm` | R1 | owner, location_manager, trainer, front_desk | `/staff/floor/equipment` | sí |
| `equipos.crear` | Añade uno o varios equipos iguales a una sede; cada unidad recibe su código de estación automático. | «Añade tres bicicletas estáticas en Caguas»<br>«Registra una prensa de piernas marca Life Fitness»<br>«Mete dos racks nuevos en la sede principal» | `POST /v1/floor/assets` | R1 | owner, location_manager, trainer | `/staff/floor/equipment` | sí |
| `equipos.editar` | Cambia el estado (en servicio, fuera de servicio, mantenimiento) u otros datos de un equipo. | «Pon la trotadora TM-03 en mantenimiento»<br>«La prensa LP-01 ya está arreglada, ponla en servicio»<br>«Cámbiale la marca al rack RACK-02 a Rogue» | `PATCH /v1/floor/assets/:id` | R1 | owner, location_manager, trainer | `/staff/floor/equipment` | sí |
| `equipos.iniciar_uso` | El socio escanea una estación y queda registrado usando ese equipo, ligado a su rutina abierta. | — | `POST /v1/floor/stations/:code/use` | R1 | member | `/s/:code` | no |
| `equipos.listar` | Lista los equipos de la sala con su código de estación, estado y averías abiertas. | «¿Qué máquinas tenemos en la sede de Bayamón?»<br>«Enséñame los equipos que están fuera de servicio»<br>«¿Cuántas trotadoras hay?» | `GET /v1/floor/assets` | R0 | owner, location_manager, front_desk, trainer, nutritionist, chef, clinician, accountant, member, guardian | `/staff/floor/equipment` | sí |
| `equipos.listar_averias` | Lista los reportes de averías y 'ocupado' de los equipos, filtrables por sede y estado. | «¿Hay máquinas reportadas como dañadas?»<br>«Enséñame las averías pendientes de confirmar en Caguas»<br>«¿Qué reportes de equipos se resolvieron?» | `GET /v1/floor/issues` | R0 | owner, location_manager, trainer, front_desk, member | `/staff/floor/equipment` | sí |
| `equipos.reportar_averia` | Reporta un equipo como dañado (queda pendiente de confirmar) o como ocupado por 15 minutos. | «Reporta que la bicicleta BIC-02 está dañada»<br>«Marca el cable CAB-01 como roto, que no hala» | `POST /v1/floor/assets/:id/issues` | R1 | owner, location_manager, trainer, front_desk, member | `/staff/floor/equipment` | sí |
| `equipos.resolver_averia` | Cierra un reporte de avería y, por defecto, devuelve el equipo a servicio. | «Ya arreglaron la prensa, cierra el reporte»<br>«Resuelve la avería del rack pero déjalo en mantenimiento» | `POST /v1/floor/issues/:id/resolve` | R1 | owner, location_manager, trainer | `/staff/floor/equipment` | sí |
| `equipos.terminar_uso` | El socio indica que dejó de usar el equipo. | — | `POST /v1/floor/uses/:id/end` | R1 | member | `/s/:code` | no |
| `equipos.ver_estacion` | Muestra la ficha de una estación por su código: equipo, ejercicios posibles y pasos de circuitos que la usan. | — | `GET /v1/floor/stations/:code` | R0 | member, guardian | `/s/:code` | no |
| `equipos.ver_mi_uso` | Devuelve el equipo que el socio está usando ahora y su rutina abierta con progreso. | — | `GET /v1/floor/me/use` | R0 | member | `/s/:code` | no |
| `equipos.ver_uso_en_vivo` | Tablero en vivo: cada estación con quién la usa ahora, usos y minutos de hoy, y socios haciendo rutina con su progreso. | «¿Quién está usando las máquinas ahora mismo?»<br>«¿Cuántas personas hay entrenando en la sala?»<br>«¿Qué equipo se ha usado más hoy?» | `GET /v1/floor/live` | R0 | owner, location_manager, trainer | `/staff/floor/live` | sí |

<details><summary>Campos, servicio, auditoría, conocimiento y prueba</summary>

- **`equipos.confirmar_averia`** — servicio `apps/api/src/modules/floor.ts:273 → app.confirm_asset_issue (0011_floor.sql:346)`; R1 reversible; roles por `0011_floor.sql:354 confirm_asset_issue role check (+ can_see_location :358)`.
  Entrada: params IdParams.
  Auditoría: bus `equipos.confirmar_averia`; hoy `asset_issue.confirm`. Conocimiento: sistema. Prueba: `apps/api/test/floor.test.ts`.
  Nota: También escribe asset.status vía trigger cuando el equipo pasa de ok a out_of_service. 409 si el reporte ya no está abierto; solo reportes out_of_service (busy → 22023).
- **`equipos.crear`** — servicio `apps/api/src/modules/floor.ts:169 → INSERT app.asset ×quantity (trigger app.asset_station_code_trigger 0029_equipment_use.sql:36 genera el código)`; R1 reversible; roles por `0011_floor.sql:171 policy asset_insert`.
  Entrada: body NewAsset.
  - `location_id` uuid (requerido) — sede donde está el equipo
  - `equipment_type` enum (requerido) — barbell\|dumbbell\|kettlebell\|cable\|leg_press\|chest_press\|lat_pulldown\|row_machine\|treadmill\|bike\|rower\|bench\|rack\|smith\|bodyweight_station\|other
  - `brand` string — regex [A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9 &'().,/+-]{1,80}
  - `model` string — regex [A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9 &'().,/+-]{1,80}
  - `station_code` string — se normaliza a MAYÚSCULAS; regex FLOOR_STATION_CODE ^[A-Z0-9][A-Z0-9-]{2,23}$; solo con quantity=1; omitido → <PREFIJO>-<NN> generado (0029)
  - `quantity` integer — 1–50 unidades; default 1
  - `notes` string — ≤500, sin caracteres de control ni <>{}
  Auditoría: bus `equipos.crear`; hoy **sin auditoría**. Conocimiento: sistema. Prueba: `apps/api/test/floor.test.ts`.
  Nota: El alta de equipo no escribe app.audit (solo los cambios de estado, trigger asset_audit). También ejercitado en apps/api/test/equipment.test.ts (códigos automáticos).
- **`equipos.editar`** — servicio `apps/api/src/modules/floor.ts:194 → UPDATE app.asset (columnas de las claves zod)`; R1 reversible; roles por `0011_floor.sql:175 policy asset_update`.
  Entrada: params IdParams, body AssetPatch.
  - `status` enum — ok\|out_of_service\|maintenance
  - `equipment_type` enum — barbell\|dumbbell\|kettlebell\|cable\|leg_press\|chest_press\|lat_pulldown\|row_machine\|treadmill\|bike\|rower\|bench\|rack\|smith\|bodyweight_station\|other
  - `brand` string|null — regex 1–80; null borra
  - `model` string|null — regex 1–80; null borra
  - `station_code` string — MAYÚSCULAS; ^[A-Z0-9][A-Z0-9-]{2,23}$; único por org
  - `notes` string|null — ≤500, sin control ni <>{}; null borra
  Auditoría: bus `equipos.editar`; hoy `asset.status`. Conocimiento: sistema. Prueba: `apps/api/test/floor.test.ts`.
  Nota: Al menos un campo (refine 'empty patch'). asset.status solo se audita si cambia el estado (trigger 0011_floor.sql:276); los demás cambios no se auditan. Cambiar station_code invalida la etiqueta QR impresa.
- **`equipos.iniciar_uso`** — servicio `apps/api/src/modules/equipment.ts:155 → app.start_equipment_use (0029_equipment_use.sql:107)`; R1 reversible; roles por `0029_equipment_use.sql:117 start_equipment_use (floor_my_member_id) + apps/api/src/modules/equipment.ts:106 myMember 403`.
  Entrada: params inline z.object({code: StationCode}), body UseBody.
  - `source` enum — scan\|code; default scan
  Auditoría: bus `equipos.iniciar_uso`; hoy **sin auditoría**. Conocimiento: socio. Prueba: `apps/api/test/equipment.test.ts`.
  Nota: 404 código desconocido, 409 asset_unavailable si el equipo no está en servicio. No audita (es registro de entrenamiento del socio).
- **`equipos.listar`** — servicio `apps/api/src/modules/floor.ts:151 → SELECT app.asset (+ conteo app.asset_issue abiertas)`; R0 lectura; roles por `0011_floor.sql:167 policy asset_select (personal de la sede; owner/accountant toda la org; member/guardian toda la org)`.
  Entrada: query AssetQuery.
  - `location_id` uuid — sede; omitido = todas las sedes visibles para el rol
  Auditoría: bus `equipos.listar`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/floor.test.ts`.
  Nota: La pantalla solo la muestra a FLOOR_ISSUE_STAFF (owner, location_manager, trainer, front_desk); RLS deja leer a todo el personal de la sede y a socios. Límite 500 filas.
- **`equipos.listar_averias`** — servicio `apps/api/src/modules/floor.ts:242 → SELECT app.asset_issue JOIN app.asset`; R0 lectura; roles por `0011_floor.sql:184 policy asset_issue_select (reporter ve los suyos; owner/location_manager/trainer/front_desk los de su sede)`.
  Entrada: query IssueQuery.
  - `location_id` uuid — sede; omitido = todas las sedes visibles para el rol
  - `status` enum — reported\|confirmed\|resolved
  Auditoría: bus `equipos.listar_averias`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/floor.test.ts`.
  Nota: Un socio solo ve sus propios reportes (campo mine). Límite 200.
- **`equipos.reportar_averia`** — servicio `apps/api/src/modules/floor.ts:260 → app.report_asset_issue (0011_floor.sql:299)`; R1 reversible; roles por `0011_floor.sql:310 report_asset_issue role check`.
  Entrada: params IdParams, body IssueBody.
  - `kind` enum (requerido) — out_of_service\|busy ('busy' expira a los 15 min y no se guarda como historial)
  - `note` string — ≤500, sin control ni <>{}
  Auditoría: bus `equipos.reportar_averia`; hoy `asset_issue.report`. Conocimiento: sistema. Prueba: `apps/api/test/floor.test.ts`.
  Nota: Solo se audita kind=out_of_service. En la web solo lo llama el socio (/me/circuits); para el dueño es más directo equipos.editar (status) o reportar+confirmar. Reportes repetidos devuelven el abierto.
- **`equipos.resolver_averia`** — servicio `apps/api/src/modules/floor.ts:286 → app.resolve_asset_issue (0011_floor.sql:378)`; R1 reversible; roles por `0011_floor.sql:386 resolve_asset_issue role check (+ can_see_location :390)`.
  Entrada: params IdParams, body ResolveBody.
  - `restore_asset` boolean — default true: vuelve a 'ok' si no quedan otras averías confirmadas
  Auditoría: bus `equipos.resolver_averia`; hoy `asset_issue.resolve`. Conocimiento: sistema. Prueba: `apps/api/test/floor.test.ts`.
  Nota: front_desk puede confirmar pero no resolver. Si restaura el equipo también se escribe asset.status (trigger). 409 si ya estaba resuelto.
- **`equipos.terminar_uso`** — servicio `apps/api/src/modules/equipment.ts:168 → app.end_equipment_use (0029_equipment_use.sql:155)`; R1 reversible; roles por `0029_equipment_use.sql:161 end_equipment_use (floor_my_member_id)`.
  Entrada: params inline z.object({id: Id}).
  Auditoría: bus `equipos.terminar_uso`; hoy **sin auditoría**. Conocimiento: socio. Prueba: `apps/api/test/equipment.test.ts`.
  Nota: params sin esquema con nombre (objeto inline).
- **`equipos.ver_estacion`** — servicio `apps/api/src/modules/floor.ts:212 → SELECT app.asset + app.exercise + app.circuit_step`; R0 lectura; roles por `0011_floor.sql:167 policy asset_select (y 0011_floor.sql:191 exercise_select, :214 circuit_step_select)`.
  Entrada: params inline z.object({code: StationCode}).
  Auditoría: bus `equipos.ver_estacion`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/floor.test.ts`.
  Nota: params sin esquema con nombre (objeto inline con StationCode). RLS también deja al personal de la sede consultarla; el copiloto puede usar equipos.listar.
- **`equipos.ver_mi_uso`** — servicio `apps/api/src/modules/equipment.ts:178 → SELECT app.equipment_use + app.circuit_run/app.circuit_step`; R0 lectura; roles por `apps/api/src/modules/equipment.ts:106 myMember (app.floor_my_member_id, 403 si no es socio)`.
  Entrada: ninguna.
  Auditoría: bus `equipos.ver_mi_uso`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/equipment.test.ts`.
- **`equipos.ver_uso_en_vivo`** — servicio `apps/api/src/modules/equipment.ts:196 → SELECT app.asset LEFT JOIN app.equipment_use, app.circuit_run, app.set_log`; R0 lectura; roles por `apps/api/src/modules/equipment.ts:12 COACHES + :197 requireCoach; RLS 0029_equipment_use.sql:87 equipment_use_select`.
  Entrada: query LiveQuery.
  - `location_id` uuid — sede; omitido = todas las sedes visibles para el rol
  Auditoría: bus `equipos.ver_uso_en_vivo`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/equipment.test.ts`.
  Nota: Solo hoy (día local de la sede); 'activo' = sin terminar y actividad en los últimos 20 min. No hay histórico de uso por equipo (ver notas de reportes).

</details>

### facturas (4)

| Acción | Qué hace | Cómo lo diría el dueño | Ruta | Riesgo | Roles | Pantalla | Copiloto |
|---|---|---|---|---|---|---|---|
| `facturas.anular` | Anula una factura abierta que no tiene pagos, con motivo; el número queda usado. | «Anula la factura 1043, se emitió por error»<br>«Cancela la factura duplicada de Ana» | `POST /v1/invoices/:id/void` | R2 | owner, location_manager | — | sí |
| `facturas.correr_ciclo` | Corre el ciclo de renovación a una fecha: renueva períodos vencidos, emite sus facturas, cierra cancelaciones y marca morosos. | «Corre la facturación de hoy»<br>«Genera las renovaciones de la sede de Ponce»<br>«Pasa el ciclo de cobro al 1 de noviembre» | `POST /v1/billing/cycle` | R2 | owner, location_manager | `/staff/billing` | sí |
| `facturas.listar` | Lista facturas de socios con filtros por estado, vencidas, sede o socio, con su saldo pendiente. | «¿Qué facturas están vencidas?»<br>«Enséñame las facturas abiertas de Bayamón»<br>«¿Qué facturas tiene pendientes Carlos?» | `GET /v1/invoices` | R0 | owner, location_manager, front_desk, accountant | `/staff/billing` | sí |
| `facturas.ver` | Muestra una factura con sus líneas, IVU estatal y municipal, pagos y saldo. | «Enséñame la factura 1043»<br>«¿Qué incluye la última factura de Ana?» | `GET /v1/invoices/:id` | R0 | owner, location_manager, front_desk, accountant | `/staff/billing` | sí |

<details><summary>Campos, servicio, auditoría, conocimiento y prueba</summary>

- **`facturas.anular`** — servicio `apps/api/src/modules/billing.ts:468 → app.void_invoice (0006_billing.sql:701)`; R2 sensible; roles por `0006_billing.sql:706 y :710 void_invoice (role IN owner, location_manager + billing_staff_at)`.
  Entrada: params IdParams, body VoidBody.
  - `reason` string (requerido) — trim, 1–300
  Auditoría: bus `facturas.anular`; hoy `invoice.update (solo trigger invoice_status_audit con void_reason; la función no llama app.audit)`. Conocimiento: socio, reporte. Prueba: `apps/api/test/route-gaps.test.ts`.
  Nota: Irreversible (void es final). Sin pantalla web ni prueba HTTP; solo prueba SQL en packages/db/test/billing.test.ts. Hallazgo: único movimiento de dinero de billing sin evento app.audit propio.
- **`facturas.correr_ciclo`** — servicio `apps/api/src/modules/billing.ts:475 → app.run_billing_cycle (0006_billing.sql:724)`; R2 sensible; roles por `0006_billing.sql:740 run_billing_cycle (role IN owner, location_manager; sede con can_see_location)`.
  Entrada: body CycleBody.
  - `as_of` string — YYYY-MM-DD (regex ^\d{4}-\d{2}-\d{2}$); ≤ hoy UTC+1 y ≥ hoy−366
  - `location_id` uuid — una sede; omitido = todas las visibles
  Auditoría: bus `facturas.correr_ciclo`; hoy `billing.cycle, invoice.issue, subscription.update`. Conocimiento: socio, reporte. Prueba: `apps/api/test/billing.test.ts`.
  Nota: Emite facturas a muchos socios a la vez (no cobra tarjetas). Idempotente por (suscripción, period_start). NUEVO: no hay cobro automático de renovaciones (auto-charge) ni cron en esta ruta.
- **`facturas.listar`** — servicio `apps/api/src/modules/billing.ts:376 → SELECT app.invoice (+payment para saldo) LIMIT 200`; R0 lectura; roles por `0006_billing.sql:940 policy invoice_select (accountant, billing_staff_at, billing_is_self)`.
  Entrada: query InvoicesQuery.
  - `status` enum
  - `overdue` string — "true" = abiertas con due_date < hoy (America/Puerto_Rico)
  - `location_id` uuid
  - `member_id` uuid
  Auditoría: bus `facturas.listar`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/billing.test.ts`.
  Nota: Los socios también ven sus propias facturas por RLS (test billing.test.ts:351). Máximo 200 filas.
- **`facturas.ver`** — servicio `apps/api/src/modules/billing.ts:392 → SELECT app.invoice, invoice_line, payment`; R0 lectura; roles por `0006_billing.sql:940 invoice_select; 0006_billing.sql:943 invoice_line_select; 0006_billing.sql:945 payment_select`.
  Entrada: params IdParams.
  Auditoría: bus `facturas.ver`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/billing.test.ts`.
  Nota: La web no llama este detalle (usa las líneas de /members/:id/billing); ui apunta a la pantalla donde se ven facturas. Socio/tutor también lo leen por RLS.

</details>

### finanzas (24)

| Acción | Qué hace | Cómo lo diría el dueño | Ruta | Riesgo | Roles | Pantalla | Copiloto |
|---|---|---|---|---|---|---|---|
| `finanzas.anular_cuenta_por_pagar` | Anula una factura de proveedor pendiente o aprobada (error o duplicada), con motivo. | «Anula la factura 8841 de Agua Pura, está duplicada»<br>«Cancela la factura de Clima PR, se entró por error» | `POST /v1/finance/bills/:id/void` | R2 | owner, location_manager | `/staff/finance` | sí |
| `finanzas.anular_gasto` | Anula un gasto registrado (queda en el historial pero sale del P&L y de las exportaciones). | «Anula el gasto de 85 de limpieza, estaba duplicado»<br>«Borra el gasto de publicidad de ayer, fue un error» | `POST /v1/finance/expenses/:id/void` | R2 | owner, location_manager | `/staff/finance` | sí |
| `finanzas.cambiar_estado_comision` | Aprueba, marca como pagada o anula una comisión (pendiente→aprobada→pagada; anular si no está pagada). | «Aprueba la comisión de Javier»<br>«Marca pagada hoy la comisión de Luisa»<br>«Anula la comisión duplicada de Pedro» | `POST /v1/finance/commissions/:id/status` | R2 | owner | `/staff/finance` | sí |
| `finanzas.crear_gasto_recurrente` | Crea una plantilla de gasto recurrente cada N meses para una sede. | «Programa la renta de Bayamón de 2,500 cada mes desde el 1 de diciembre»<br>«Crea un gasto fijo de internet de 90 mensuales en Caguas» | `POST /v1/finance/recurring` | R2 | owner, location_manager | `/staff/finance` | sí |
| `finanzas.decidir_cuenta_por_pagar` | Aprueba o rechaza una factura de proveedor pendiente (rechazar la anula). | «Aprueba la factura de Agua Pura»<br>«Rechaza la factura 8841, el monto está mal» | `POST /v1/finance/bills/:id/decision` | R2 | owner, location_manager | `/staff/finance` | sí |
| `finanzas.descargar_exportacion` | Devuelve una exportación contable ya generada con su CSV y nombre de archivo. | «Descárgame el diario contable de octubre»<br>«Dame la exportación contable del mes pasado» | `GET /v1/finance/exports/:id` | R0 | owner, accountant | `/staff/finance` | sí |
| `finanzas.editar_gasto_recurrente` | Cambia descripción, monto, intervalo o próxima fecha de un gasto recurrente, o lo activa/desactiva. | «Sube la renta de Bayamón a 2,700»<br>«Desactiva el gasto fijo de internet de Caguas» | `PATCH /v1/finance/recurring/:id` | R2 | owner, location_manager | `/staff/finance` | sí |
| `finanzas.fijar_umbral_aprobacion` | Cambia el monto máximo que un gerente de sede puede aprobar o pagar sin el dueño. | «Sube el límite de aprobación de los gerentes a 1,000 dólares»<br>«Pon el umbral de gerente en 300» | `PUT /v1/finance/policy` | R2 | owner | `/staff/finance` | sí |
| `finanzas.generar_exportacion_contable` | Genera el diario contable resumido de un mes en CSV (formato de importación de QuickBooks Online), una entrada por sede. | «Genera el diario contable de octubre para el contador»<br>«Exporta la contabilidad del mes pasado» | `POST /v1/finance/exports` | R2 | owner, accountant | `/staff/finance` | sí |
| `finanzas.generar_gastos_recurrentes` | Genera los gastos vencidos de todas las plantillas recurrentes activas hasta una fecha. | «Genera los gastos fijos del mes»<br>«Corre los gastos recurrentes hasta hoy» | `POST /v1/finance/recurring/run` | R2 | owner, location_manager | `/staff/finance` | sí |
| `finanzas.listar_comisiones` | Lista las comisiones del personal con su estado (pendiente, aprobada, pagada, anulada). | «¿Qué comisiones están pendientes de aprobar?»<br>«¿Cuánto le debemos en comisiones a Javier?» | `GET /v1/finance/commissions` | R0 | owner, location_manager, accountant | `/staff/finance` | sí |
| `finanzas.listar_cuentas_por_pagar` | Lista las facturas de proveedores (cuentas por pagar) con estado, vencimiento y monto; primero las pendientes de aprobar. | «¿Qué facturas de proveedores faltan por aprobar?»<br>«¿Qué cuentas por pagar vencen esta semana?»<br>«Enséñame las facturas pagadas de Caguas» | `GET /v1/finance/bills` | R0 | owner, location_manager, accountant | `/staff/finance` | sí |
| `finanzas.listar_exportaciones` | Lista los diarios contables mensuales ya generados (período, líneas, total). | «¿Qué exportaciones contables tenemos?»<br>«Enséñame los diarios contables generados» | `GET /v1/finance/exports` | R0 | owner, accountant | `/staff/finance` | sí |
| `finanzas.listar_gastos` | Lista los gastos registrados por mes y sede (opcionalmente los anulados). | «¿Cuánto gastamos en mantenimiento este mes?»<br>«Enséñame los gastos de octubre en Bayamón» | `GET /v1/finance/expenses` | R0 | owner, location_manager, accountant | `/staff/finance` | sí |
| `finanzas.listar_gastos_recurrentes` | Lista las plantillas de gastos recurrentes (renta, luz…) con su próxima fecha. | «¿Qué gastos fijos tenemos programados?»<br>«¿Cuándo se genera la próxima renta?» | `GET /v1/finance/recurring` | R0 | owner, location_manager, accountant | `/staff/finance` | sí |
| `finanzas.listar_personal` | Lista el personal activo por sede para asignarle comisiones. | «¿Quién del personal puede recibir comisión en Toa Baja?»<br>«Lista el personal activo de la sede» | `GET /v1/finance/staff` | R0 | owner, location_manager, accountant | `/staff/finance` | sí |
| `finanzas.marcar_cuenta_pagada` | Marca como pagada fuera de la plataforma (cheque o transferencia) una factura de proveedor aprobada. | «Marca pagada la factura de Agua Pura con el cheque 1520 de hoy»<br>«La factura de Clima PR se pagó por transferencia TRX-889 ayer» | `POST /v1/finance/bills/:id/pay` | R2 | owner, location_manager | `/staff/finance` | sí |
| `finanzas.registrar_comision` | Propone una comisión para un empleado de la sede por una venta, membresía o sesión. | «Dale a Javier 25 dólares de comisión por la membresía de María»<br>«Registra una comisión de 10 para Luisa por la sesión de ayer» | `POST /v1/finance/commissions` | R2 | owner, location_manager | `/staff/finance` | sí |
| `finanzas.registrar_cuenta_por_pagar` | Registra una factura de proveedor en una sede; entra pendiente de aprobación. | «Registra la factura 8841 de Agua Pura por 320 dólares, vence el 30»<br>«Entra la factura de mantenimiento de Clima PR por 1,200 en Bayamón» | `POST /v1/finance/bills` | R2 | owner, location_manager | `/staff/finance` | sí |
| `finanzas.registrar_gasto` | Registra un gasto pagado en una sede (categoría, monto, fecha, nota y proveedor opcional). | «Anota un gasto de 85 dólares de materiales de limpieza hoy en Caguas»<br>«Registra 1,500 de renta de noviembre en Bayamón»<br>«Gasté 40 en publicidad en Facebook ayer» | `POST /v1/finance/expenses` | R2 | owner, location_manager | `/staff/finance` | sí |
| `finanzas.ver_aprobaciones_cuenta` | Muestra el historial de aprobaciones y rechazos de una factura de proveedor. | «¿Quién aprobó la factura de Clima PR?»<br>«¿Por qué rechazaron la factura 8841?» | `GET /v1/finance/bills/:id/approvals` | R0 | owner, location_manager, accountant | — | sí |
| `finanzas.ver_estado_resultados` | Muestra el estado de resultados (P&L) de un mes por sede y consolidado: ingresos, gastos, neto y flujo de caja. | «¿Cuánto ganamos en octubre?»<br>«Dame el P&L de este mes por sede»<br>«¿Cuál fue el neto de Bayamón el mes pasado?» | `GET /v1/finance/pnl` | R0 | owner, location_manager, accountant | `/staff/finance` | sí |
| `finanzas.ver_pasivos` | Muestra ingresos diferidos por sede (períodos prepagados y créditos sin usar) y, para dueño o contador, los puntos pendientes. | «¿Cuánto dinero tenemos cobrado por adelantado?»<br>«¿Cuántos puntos deben los socios en total?» | `GET /v1/finance/liabilities` | R0 | owner, location_manager, accountant | `/staff/finance` | sí |
| `finanzas.ver_umbral_aprobacion` | Muestra el monto máximo que un gerente de sede puede aprobar sin el dueño. | «¿Hasta cuánto puede aprobar un gerente?»<br>«¿Cuál es el límite de aprobación de gastos?» | `GET /v1/finance/policy` | R0 | owner, location_manager, accountant | `/staff/finance` | sí |

<details><summary>Campos, servicio, auditoría, conocimiento y prueba</summary>

- **`finanzas.anular_cuenta_por_pagar`** — servicio `apps/api/src/modules/finance.ts:350 → app.void_bill (0013_finance.sql:414)`; R2 sensible; roles por `0013_finance.sql:420 void_bill; 0013_finance.sql:424 fin_writer_at; 0013_finance.sql:426 fin_can_decide`.
  Entrada: params IdParams, body ReasonBody.
  - `reason` string (requerido) — trim, 3–200, sin caracteres de control (Text(3,200))
  Auditoría: bus `finanzas.anular_cuenta_por_pagar`; hoy `bill.void (trigger fin_audit_trigger)`. Conocimiento: proveedor, reporte. Prueba: `apps/api/test/finance.test.ts`.
  Nota: Irreversible; una factura pagada nunca se anula.
- **`finanzas.anular_gasto`** — servicio `apps/api/src/modules/finance.ts:400 → app.void_expense (0013_finance.sql:436)`; R2 sensible; roles por `0013_finance.sql:442 void_expense; 0013_finance.sql:446 fin_writer_at`.
  Entrada: params IdParams, body ReasonBody.
  - `reason` string (requerido) — trim, 3–200, sin caracteres de control (Text(3,200))
  Auditoría: bus `finanzas.anular_gasto`; hoy `expense.void (trigger fin_audit_trigger)`. Conocimiento: reporte. Prueba: `apps/api/test/finance.test.ts`.
  Nota: Irreversible (expense_guard). Sin chequeo de umbral: un gerente puede anular un gasto mayor al umbral que registró el owner en su sede.
- **`finanzas.cambiar_estado_comision`** — servicio `apps/api/src/modules/finance.ts:530 → app.set_commission_status (0013_finance.sql:492)`; R2 sensible; roles por `0013_finance.sql:497 set_commission_status (role = owner)`.
  Entrada: params IdParams, body CommissionStatusBody.
  - `status` enum (requerido) — pending→approved\|void; approved→paid\|void
  - `paid_on` string — YYYY-MM-DD y fecha válida (Day); obligatorio si status=paid; ≥ earned_on y ≤ hoy
  Auditoría: bus `finanzas.cambiar_estado_comision`; hoy `commission.approved | commission.paid | commission.void (trigger fin_audit_trigger)`. Conocimiento: reporte. Prueba: `apps/api/test/finance.test.ts`.
  Nota: 'paid' solo registra un pago hecho fuera (nómina); no mueve dinero. paid/void son finales.
- **`finanzas.crear_gasto_recurrente`** — servicio `apps/api/src/modules/finance.ts:423 → INSERT app.recurring_expense`; R2 sensible; roles por `0013_finance.sql:839 policy recurring_expense_insert (fin_writer_at; gerente ≤ fin_manager_max)`.
  Entrada: body RecurringBody.
  - `location_id` uuid (requerido)
  - `category` enum (requerido)
  - `description` string (requerido) — trim, 1–120, sin caracteres de control (Text(1,120))
  - `amount_cents` integer (requerido) — entero 1–100,000,000 (FINANCE_MAX_AMOUNT_CENTS); location_manager ≤ umbral
  - `interval_months` integer — 1–12
  - `next_on` string (requerido) — YYYY-MM-DD y fecha válida (Day)
  - `vendor_id` uuid
  Auditoría: bus `finanzas.crear_gasto_recurrente`; hoy `recurring_expense.insert (trigger fin_audit_trigger)`. Conocimiento: reporte. Prueba: `apps/api/test/finance.test.ts`.
- **`finanzas.decidir_cuenta_por_pagar`** — servicio `apps/api/src/modules/finance.ts:328 → app.decide_bill (0013_finance.sql:341)`; R2 sensible; roles por `0013_finance.sql:349 decide_bill (owner/location_manager); 0013_finance.sql:354 fin_writer_at; 0013_finance.sql:361 fin_can_decide (gerente ≤ umbral, suma 30 días por proveedor)`.
  Entrada: params IdParams, body DecisionBody.
  - `decision` enum (requerido) — reject deja la factura en void
  - `note` string — trim, 1–300, sin caracteres de control (Text(1,300))
  Auditoría: bus `finanzas.decidir_cuenta_por_pagar`; hoy `bill.decision, bill.approved | bill.void (trigger fin_audit_trigger)`. Conocimiento: proveedor, reporte. Prueba: `apps/api/test/finance.test.ts`.
  Nota: El creador de la factura no puede decidirla (approver_is_creator). Irreversible.
- **`finanzas.descargar_exportacion`** — servicio `apps/api/src/modules/finance.ts:619 → SELECT app.journal_export (csv)`; R0 lectura; roles por `0013_finance.sql:866 policy journal_export_select`.
  Entrada: params IdParams.
  Auditoría: bus `finanzas.descargar_exportacion`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/finance.test.ts`.
  Nota: Lectura del CSV ya generado; sin datos personales.
- **`finanzas.editar_gasto_recurrente`** — servicio `apps/api/src/modules/finance.ts:445 → UPDATE app.recurring_expense`; R2 sensible; roles por `0013_finance.sql:843 policy recurring_expense_update (gerente ≤ umbral antes y después)`.
  Entrada: params IdParams, body RecurringPatch.
  - `description` string — trim, 1–120, sin caracteres de control (Text(1,120))
  - `amount_cents` integer — entero 1–100,000,000 (FINANCE_MAX_AMOUNT_CENTS)
  - `interval_months` integer — 1–12
  - `next_on` string — YYYY-MM-DD y fecha válida (Day)
  - `active` boolean — false = desactivar
  Auditoría: bus `finanzas.editar_gasto_recurrente`; hoy `recurring_expense.update (trigger fin_audit_trigger)`. Conocimiento: reporte. Prueba: `apps/api/test/finance.test.ts`.
  Nota: Al menos un campo. Los grants permiten cambiar category y vendor_id pero RecurringPatch no los expone. La web solo usa active.
- **`finanzas.fijar_umbral_aprobacion`** — servicio `apps/api/src/modules/finance.ts:223 → INSERT … ON CONFLICT (org_id) DO UPDATE app.finance_policy`; R2 sensible; roles por `0013_finance.sql:814 finance_policy_insert / 0013_finance.sql:816 finance_policy_update (solo owner)`.
  Entrada: body PolicyBody.
  - `manager_approval_max_cents` integer (requerido) — 0–100,000,000; sin fila vale 50,000 ($500)
  Auditoría: bus `finanzas.fijar_umbral_aprobacion`; hoy `finance_policy.insert | finance_policy.update (trigger fin_audit_trigger)`. Conocimiento: sistema. Prueba: `apps/api/test/finance.test.ts`.
  Nota: Control de segregación de funciones: cambiarlo altera quién aprueba gastos y cuentas por pagar.
- **`finanzas.generar_exportacion_contable`** — servicio `apps/api/src/modules/finance.ts:599 → app.generate_journal_export (0013_finance.sql:587)`; R2 sensible; roles por `0013_finance.sql:598 generate_journal_export (role IN owner, accountant)`.
  Entrada: body ExportBody.
  - `month` string (requerido) — YYYY-MM; no posterior al mes actual
  Auditoría: bus `finanzas.generar_exportacion_contable`; hoy `journal.export`. Conocimiento: reporte. Prueba: `apps/api/test/finance.test.ts`.
  Nota: Exporta solo agregados y nombres de sede (sin datos personales) → R2, no R3. Append-only: cada llamada crea una exportación nueva. Plan de cuentas [VERIFICAR · CPA].
- **`finanzas.generar_gastos_recurrentes`** — servicio `apps/api/src/modules/finance.ts:463 → app.run_recurring_expenses (0013_finance.sql:456)`; R2 sensible; roles por `0013_finance.sql:465 run_recurring_expenses (owner/location_manager; plantillas con fin_writer_at)`.
  Entrada: body RunBody.
  - `as_of` string — YYYY-MM-DD y fecha válida (Day); ≤ hoy
  Auditoría: bus `finanzas.generar_gastos_recurrentes`; hoy `expense.recurring_run, expense.insert, recurring_expense.update`. Conocimiento: reporte. Prueba: `apps/api/test/finance.test.ts`.
  Nota: Crea gastos en lote; idempotente por (plantilla, fecha). No hay cron: alguien tiene que llamarla.
- **`finanzas.listar_comisiones`** — servicio `apps/api/src/modules/finance.ts:492 → SELECT app.commission LIMIT 500`; R0 lectura; roles por `0013_finance.sql:858 policy commission_select`.
  Entrada: query CommissionsQuery.
  - `status` enum
  - `location_id` uuid
  Auditoría: bus `finanzas.listar_comisiones`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/finance.test.ts`.
- **`finanzas.listar_cuentas_por_pagar`** — servicio `apps/api/src/modules/finance.ts:279 → SELECT app.bill LIMIT 500`; R0 lectura; roles por `0013_finance.sql:828 policy bill_select (fin_reader_at 0013_finance.sql:192)`.
  Entrada: query BillsQuery.
  - `status` enum
  - `location_id` uuid
  Auditoría: bus `finanzas.listar_cuentas_por_pagar`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/finance.test.ts`.
- **`finanzas.listar_exportaciones`** — servicio `apps/api/src/modules/finance.ts:583 → SELECT app.journal_export LIMIT 100`; R0 lectura; roles por `0013_finance.sql:866 policy journal_export_select`.
  Entrada: ninguna.
  Auditoría: bus `finanzas.listar_exportaciones`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/finance.test.ts`.
  Nota: location_manager recibe lista vacía (no 403).
- **`finanzas.listar_gastos`** — servicio `apps/api/src/modules/finance.ts:362 → SELECT app.expense LIMIT 500`; R0 lectura; roles por `0013_finance.sql:849 policy expense_select`.
  Entrada: query ExpensesQuery.
  - `month` string — YYYY-MM (FINANCE_MONTH_PATTERN)
  - `location_id` uuid
  - `include_voided` string — "true"\|"false" → boolean
  Auditoría: bus `finanzas.listar_gastos`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/finance.test.ts`.
- **`finanzas.listar_gastos_recurrentes`** — servicio `apps/api/src/modules/finance.ts:411 → SELECT app.recurring_expense LIMIT 500`; R0 lectura; roles por `0013_finance.sql:837 policy recurring_expense_select`.
  Entrada: ninguna.
  Auditoría: bus `finanzas.listar_gastos_recurrentes`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/route-gaps.test.ts`.
  Nota: Sin prueba HTTP de GET /finance/recurring.
- **`finanzas.listar_personal`** — servicio `apps/api/src/modules/finance.ts:477 → SELECT app.staff_member JOIN staff_location`; R0 lectura; roles por `apps/api/src/modules/finance.ts:479 chequeo FINANCE_READER_ROLES; 0002_rls.sql:80 staff_select / :94 staffloc_select`.
  Entrada: query StaffQuery.
  - `location_id` uuid
  Auditoría: bus `finanzas.listar_personal`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/finance.test.ts`.
  Nota: Selector auxiliar del formulario de comisiones.
- **`finanzas.marcar_cuenta_pagada`** — servicio `apps/api/src/modules/finance.ts:339 → app.pay_bill (0013_finance.sql:387)`; R2 sensible; roles por `0013_finance.sql:393 pay_bill (owner/location_manager); 0013_finance.sql:397 fin_writer_at; 0013_finance.sql:400 fin_can_decide`.
  Entrada: params IdParams, body PayBody.
  - `paid_on` string (requerido) — YYYY-MM-DD y fecha válida (Day); ≥ issued_on y ≤ hoy (America/Puerto_Rico)
  - `payment_ref` string (requerido) — trim, regex FINANCE_REF_PATTERN ^[A-Za-z0-9][A-Za-z0-9 #._/-]{0,39}$ (nunca cuenta bancaria)
  Auditoría: bus `finanzas.marcar_cuenta_pagada`; hoy `bill.paid (trigger fin_audit_trigger)`. Conocimiento: proveedor, reporte. Prueba: `apps/api/test/finance.test.ts`.
  Nota: Solo registra un pago hecho fuera (no mueve dinero ni toca Stripe) → R2. Irreversible: una factura pagada no se puede anular ni editar (bill_guard); valorar tratarlo como R3 en la confirmación.
- **`finanzas.registrar_comision`** — servicio `apps/api/src/modules/finance.ts:509 → INSERT app.commission (status pending)`; R2 sensible; roles por `0013_finance.sql:860 policy commission_insert (fin_writer_at + staff_location)`.
  Entrada: body CommissionBody.
  - `staff_member_id` uuid (requerido) — asignado a location_id (staff_location)
  - `location_id` uuid (requerido)
  - `source` enum (requerido)
  - `source_ref` string (requerido) — trim, regex ^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$ (FINANCE_SOURCE_REF_PATTERN)
  - `amount_cents` integer (requerido) — 1–10,000,000 (FINANCE_MAX_COMMISSION_CENTS)
  - `earned_on` string (requerido) — YYYY-MM-DD y fecha válida (Day)
  - `note` string — trim, 1–300, sin caracteres de control (Text(1,300))
  Auditoría: bus `finanzas.registrar_comision`; hoy `commission.insert (trigger fin_audit_trigger)`. Conocimiento: reporte. Prueba: `apps/api/test/finance.test.ts`.
  Nota: source_ref es texto libre: no se valida que la venta/membresía/sesión exista. No hay reglas automáticas de comisión.
- **`finanzas.registrar_cuenta_por_pagar`** — servicio `apps/api/src/modules/finance.ts:293 → INSERT app.bill (status pending_approval)`; R2 sensible; roles por `0013_finance.sql:830 policy bill_insert (fin_writer_at; created_by = caller)`.
  Entrada: body BillBody.
  - `vendor_id` uuid (requerido)
  - `location_id` uuid (requerido) — sede que el caller escribe
  - `number` string (requerido) — trim, regex FINANCE_REF_PATTERN ^[A-Za-z0-9][A-Za-z0-9 #._/-]{0,39}$ (nunca cuenta bancaria)
  - `category` enum
  - `memo` string — trim, 1–300, sin caracteres de control (Text(1,300))
  - `issued_on` string (requerido) — YYYY-MM-DD y fecha válida (Day)
  - `due_on` string (requerido) — YYYY-MM-DD y fecha válida (Day)
  - `amount_cents` integer (requerido) — entero 1–100,000,000 (FINANCE_MAX_AMOUNT_CENTS)
  Auditoría: bus `finanzas.registrar_cuenta_por_pagar`; hoy `bill.insert (trigger fin_audit_trigger)`. Conocimiento: proveedor, reporte. Prueba: `apps/api/test/finance.test.ts`.
  Nota: R2: registro contable inmutable (solo se anula), no mueve dinero. Quien la crea no puede aprobarla (segregación).
- **`finanzas.registrar_gasto`** — servicio `apps/api/src/modules/finance.ts:380 → INSERT app.expense`; R2 sensible; roles por `0013_finance.sql:852 policy expense_insert (fin_writer_at; gerente ≤ fin_manager_max)`.
  Entrada: body ExpenseBody.
  - `location_id` uuid (requerido) — sede que el caller escribe
  - `category` enum (requerido)
  - `amount_cents` integer (requerido) — entero 1–100,000,000 (FINANCE_MAX_AMOUNT_CENTS); location_manager ≤ umbral de gerente
  - `spent_on` string (requerido) — YYYY-MM-DD y fecha válida (Day)
  - `receipt_note` string — trim, 1–300, sin caracteres de control (Text(1,300))
  - `vendor_id` uuid
  Auditoría: bus `finanzas.registrar_gasto`; hoy `expense.insert (trigger fin_audit_trigger)`. Conocimiento: reporte. Prueba: `apps/api/test/finance.test.ts`.
  Nota: R2: registro contable inmutable (solo se anula). No hay adjunto de recibo (solo nota de texto).
- **`finanzas.ver_aprobaciones_cuenta`** — servicio `apps/api/src/modules/finance.ts:315 → SELECT app.bill_approval`; R0 lectura; roles por `0013_finance.sql:834 policy bill_approval_select`.
  Entrada: params IdParams.
  Auditoría: bus `finanzas.ver_aprobaciones_cuenta`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/finance.test.ts`.
  Nota: La web no la llama.
- **`finanzas.ver_estado_resultados`** — servicio `apps/api/src/modules/finance.ts:546 → app.finance_pnl (0013_finance.sql:519) → app.fin_month_amounts`; R0 lectura; roles por `0013_finance.sql:526 finance_pnl (role IN owner, accountant, location_manager; filas por fin_reader_at)`.
  Entrada: query MonthQuery.
  - `month` string (requerido) — YYYY-MM (FINANCE_MONTH_PATTERN)
  Auditoría: bus `finanzas.ver_estado_resultados`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/finance.test.ts`.
  Nota: Base devengado. Reconocimiento de paquetes al vender marcado [VERIFICAR · CPA] en 0013.
- **`finanzas.ver_pasivos`** — servicio `apps/api/src/modules/finance.ts:560 → app.finance_deferred (0013_finance.sql:550) + app.points_liability (0012_engagement.sql:780)`; R0 lectura; roles por `0013_finance.sql:554 finance_deferred (owner, accountant, location_manager); apps/api/src/modules/finance.ts:567 + 0012_engagement.sql:783 points_liability (owner, accountant)`.
  Entrada: ninguna.
  Auditoría: bus `finanzas.ver_pasivos`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/finance.test.ts`.
  Nota: location_manager recibe points = null.
- **`finanzas.ver_umbral_aprobacion`** — servicio `apps/api/src/modules/finance.ts:208 → SELECT app.finance_policy (default 50,000 centavos)`; R0 lectura; roles por `apps/api/src/modules/finance.ts:210 chequeo FINANCE_READER_ROLES; 0013_finance.sql:812 policy finance_policy_select`.
  Entrada: ninguna.
  Auditoría: bus `finanzas.ver_umbral_aprobacion`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/finance.test.ts`.

</details>

### fotos (6)

| Acción | Qué hace | Cómo lo diría el dueño | Ruta | Riesgo | Roles | Pantalla | Copiloto |
|---|---|---|---|---|---|---|---|
| `fotos.borrar_mia` | El socio borra definitivamente su propia foto. | — | `DELETE /v1/me/photo` | R3 | member | `/me/access` | no |
| `fotos.borrar_socio` | Borra definitivamente la foto de un socio. | «Borra la foto de Pedro Santiago»<br>«Quita la foto de Ana, salió borrosa» | `DELETE /v1/members/:id/photo` | R3 | owner, location_manager, front_desk | `/staff/members/:id` | sí |
| `fotos.subir_mia` | El socio sube o reemplaza su propia foto con su consentimiento. | — | `PUT /v1/me/photo` | R2 | member | `/me/access` | no |
| `fotos.subir_socio` | Guarda o reemplaza la foto de un socio; el personal da fe del consentimiento. | «Sube esta foto al perfil de Pedro»<br>«Cambia la foto de Ana López» | `PUT /v1/members/:id/photo` | R2 | owner, location_manager, front_desk | `/staff/members/:id` | no |
| `fotos.ver_mia` | Muestra al socio su propia foto. | — | `GET /v1/me/photo` | R0 | member | `/me/access` | no |
| `fotos.ver_socio` | Muestra la foto de identificación de un socio. | «Enséñame la foto de Pedro Santiago»<br>«¿Ana López tiene foto?» | `GET /v1/members/:id/photo` | R0 | owner, location_manager, front_desk, trainer, member, guardian | `/staff/members/:id` | sí |

<details><summary>Campos, servicio, auditoría, conocimiento y prueba</summary>

- **`fotos.borrar_mia`** — servicio `apps/api/src/modules/photo.ts:123 → app.clear_member_photo (0023_member_photo.sql:106)`; R3 irreversible / dinero externo; roles por `0023_member_photo.sql:54 photo_write_target (rama member)`.
  Entrada: ninguna.
  Auditoría: bus `fotos.borrar_mia`; hoy `member_photo.clear`. Conocimiento: socio. Prueba: `apps/api/test/photo-live.test.ts`.
- **`fotos.borrar_socio`** — servicio `apps/api/src/modules/photo.ts:112 → app.clear_member_photo (0023_member_photo.sql:106) → DELETE app.member_photo`; R3 irreversible / dinero externo; roles por `0023_member_photo.sql:62 photo_write_target`.
  Entrada: params IdParams.
  Auditoría: bus `fotos.borrar_socio`; hoy `member_photo.clear`. Conocimiento: socio. Prueba: `apps/api/test/route-gaps.test.ts`.
  Nota: Borrado definitivo sin papelera. Solo se prueba DELETE /v1/me/photo, no esta URL.
- **`fotos.subir_mia`** — servicio `apps/api/src/modules/photo.ts:122 → app.set_member_photo (0023_member_photo.sql:70)`; R2 sensible; roles por `0023_member_photo.sql:54 photo_write_target (rama member: su propia fila)`.
  Entrada: body PhotoBody.
  - `mime` enum (requerido)
  - `data` string (requerido) — base64 estándar sin prefijo data:; decodificado 1024–153600 bytes; cabecera mágica JPEG/WebP
  - `consent_version` string (requerido) — regex ^photo-v[0-9]{1,3}$ (actual photo-v1)
  Auditoría: bus `fotos.subir_mia`; hoy `member_photo.set|member_photo.replace`. Conocimiento: socio. Prueba: `apps/api/test/photo-live.test.ts`.
  Nota: La entrada no lista PhotoBody (parseado en write(), photo.ts:66). También lo llama la página pública tras unirse (JoinScreen.tsx:328).
- **`fotos.subir_socio`** — servicio `apps/api/src/modules/photo.ts:108 → app.set_member_photo (0023_member_photo.sql:70)`; R2 sensible; roles por `0023_member_photo.sql:62 photo_write_target (owner, location_manager, front_desk de la sede de casa)`.
  Entrada: params IdParams, body PhotoBody.
  - `mime` enum (requerido)
  - `data` string (requerido) — base64 estándar sin prefijo data:; decodificado 1024–153600 bytes; cabecera mágica JPEG/WebP
  - `consent_version` string (requerido) — regex ^photo-v[0-9]{1,3}$ (actual photo-v1)
  Auditoría: bus `fotos.subir_socio`; hoy `member_photo.set|member_photo.replace`. Conocimiento: socio. Prueba: `apps/api/test/photo-live.test.ts`.
  Nota: La entrada no lista PhotoBody porque se parsea dentro del helper write() (photo.ts:66). Requiere una imagen capturada con cámara: no encaja por voz. R2 por consentimiento.
- **`fotos.ver_mia`** — servicio `apps/api/src/modules/photo.ts:117 → SELECT app.member_photo JOIN app.member (app.role()='member')`; R0 lectura; roles por `apps/api/src/modules/photo.ts:55 (filtro app.role()='member'; el tutor recibe 404)`.
  Entrada: ninguna.
  Auditoría: bus `fotos.ver_mia`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/photo-live.test.ts`.
- **`fotos.ver_socio`** — servicio `apps/api/src/modules/photo.ts:102 → SELECT app.member_photo (RLS)`; R0 lectura; roles por `0023_member_photo.sql:126 policy member_photo_select → photo_can_see (0023_member_photo.sql:36)`.
  Entrada: params IdParams.
  Auditoría: bus `fotos.ver_socio`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/photo-live.test.ts`.
  Nota: Devuelve la imagen en base64; accountant/nutritionist/clinician/chef reciben 404.

</details>

### inventario (7)

| Acción | Qué hace | Cómo lo diría el dueño | Ruta | Riesgo | Roles | Pantalla | Copiloto |
|---|---|---|---|---|---|---|---|
| `inventario.ajustar` | Corrige existencias de un producto en una sede (conteo, daño, vencimiento) con motivo obligatorio. | «Resta 2 proteínas en Caguas, llegaron rotas»<br>«Ajusta el inventario de agua más 5 por conteo físico» | `POST /v1/store/inventory/adjust` | R1 | owner, location_manager | `/staff/store/inventory` | sí |
| `inventario.fijar_punto_reorden` | Fija el punto de reorden de un producto en una sede (desde cuántas unidades se considera bajo). | «Avísame cuando queden 5 proteínas en Bayamón»<br>«Pon el mínimo del agua en 24» | `PUT /v1/store/inventory/reorder-point` | R1 | owner, location_manager | `/staff/store/inventory` | sí |
| `inventario.listar_transferencias` | Lista las últimas 100 transferencias de inventario entre sedes con sus líneas. | «¿Qué transferencias de inventario hicimos este mes?»<br>«Enséñame lo que se mandó a Caguas» | `GET /v1/store/transfers` | R0 | owner, location_manager | — | sí |
| `inventario.recibir` | Registra la entrada de mercancía de un producto en una sede. | «Llegaron 24 botellas de agua a Bayamón»<br>«Recibimos 10 proteínas whey en Caguas, factura 5531» | `POST /v1/store/inventory/receive` | R1 | owner, location_manager | `/staff/store/inventory` | sí |
| `inventario.transferir` | Mueve mercancía de una sede a otra de la misma organización en una sola operación. | «Pasa 10 aguas de Bayamón a Caguas»<br>«Transfiere 3 camisetas de Ponce a Bayamón» | `POST /v1/store/transfers` | R1 | owner, location_manager | `/staff/store/inventory` | sí |
| `inventario.ver` | Muestra existencias por producto y sede (a mano, reservado, disponible, punto de reorden y si está bajo). | «¿Qué productos están bajos de inventario?»<br>«¿Cuánto inventario hay en Ponce?»<br>«¿Cuántas botellas de agua tenemos?» | `GET /v1/store/inventory` | R0 | owner, location_manager, front_desk | `/staff/store/inventory` | sí |
| `inventario.ver_movimientos` | Lista los últimos 200 movimientos de inventario (recibos, ventas, devoluciones, transferencias, ajustes). | «¿Quién ajustó el inventario de proteína esta semana?»<br>«Enséñame los movimientos de inventario de Caguas» | `GET /v1/store/movements` | R0 | owner, location_manager | — | sí |

<details><summary>Campos, servicio, auditoría, conocimiento y prueba</summary>

- **`inventario.ajustar`** — servicio `apps/api/src/modules/store.ts:282 → app.adjust_stock (0009_store.sql:552)`; R1 reversible; roles por `0009_store.sql:558 adjust_stock (store_can_manage)`.
  Entrada: body AdjustBody.
  - `location_id` uuid (requerido)
  - `product_id` uuid (requerido)
  - `delta` integer (requerido) — −100,000..100,000, distinto de 0; no puede dejar on_hand < reservado
  - `reason` string (requerido) — trim, 3–200, sin caracteres de control (Text(3,200))
  Auditoría: bus `inventario.ajustar`; hoy `store.stock.adjust`. Conocimiento: producto. Prueba: `apps/api/test/store.test.ts`.
- **`inventario.fijar_punto_reorden`** — servicio `apps/api/src/modules/store.ts:297 → app.set_reorder_point (0009_store.sql:636)`; R1 reversible; roles por `0009_store.sql:641 set_reorder_point (store_can_manage)`.
  Entrada: body ReorderBody.
  - `location_id` uuid (requerido)
  - `product_id` uuid (requerido)
  - `reorder_point` integer (requerido) — 0–100,000
  Auditoría: bus `inventario.fijar_punto_reorden`; hoy `store.stock.reorder_point`. Conocimiento: producto. Prueba: `apps/api/test/store.test.ts`.
- **`inventario.listar_transferencias`** — servicio `apps/api/src/modules/store.ts:325 → SELECT app.stock_transfer + stock_transfer_line LIMIT 100`; R0 lectura; roles por `0009_store.sql:775 policy transfer_select`.
  Entrada: ninguna.
  Auditoría: bus `inventario.listar_transferencias`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/route-gaps.test.ts`.
  Nota: Sin pantalla web ni prueba HTTP (store.test.ts solo hace POST /store/transfers). No tiene filtros.
- **`inventario.recibir`** — servicio `apps/api/src/modules/store.ts:267 → app.receive_stock (0009_store.sql:530)`; R1 reversible; roles por `0009_store.sql:535 receive_stock (store_can_manage 0009_store.sql:227)`.
  Entrada: body ReceiveBody.
  - `location_id` uuid (requerido)
  - `product_id` uuid (requerido)
  - `qty` integer (requerido) — 1–100,000
  - `ref` string — regex ^[A-Za-z0-9 ._/#-]{1,60}$ (referencia libre, p. ej. factura del suplidor)
  Auditoría: bus `inventario.recibir`; hoy `store.stock.receive`. Conocimiento: producto. Prueba: `apps/api/test/store.test.ts`.
  Nota: NUEVO: el recibo no se liga a proveedor (app.vendor) ni a costo; no hay costo de mercancía en el P&L.
- **`inventario.transferir`** — servicio `apps/api/src/modules/store.ts:311 → app.transfer_stock (0009_store.sql:584)`; R1 reversible; roles por `0009_store.sql:592 transfer_stock (store_can_manage sobre la sede origen)`.
  Entrada: body TransferBody.
  - `from_location_id` uuid (requerido) — sede que el caller gestiona
  - `to_location_id` uuid (requerido) — otra sede de la org (≠ origen)
  - `lines` array<{product_id: uuid, qty: int}> (requerido) — 1–50 líneas (STORE_MAX_LINES); qty entero 1–999 (STORE_MAX_LINE_QTY); objetos .strict()
  - `note` string — trim, 0–200, sin caracteres de control (Text(0,200))
  Auditoría: bus `inventario.transferir`; hoy `store.stock.transfer`. Conocimiento: producto. Prueba: `apps/api/test/store.test.ts`.
  Nota: No hay ruta para revertir una transferencia; se deshace con otra transferencia inversa.
- **`inventario.ver`** — servicio `apps/api/src/modules/store.ts:235 → SELECT app.inventory_level JOIN product LIMIT 2000`; R0 lectura; roles por `0009_store.sql:765 policy inventory_select`.
  Entrada: query InventoryQuery.
  - `location_id` uuid
  - `low` string — "true"\|"false" → boolean
  Auditoría: bus `inventario.ver`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/store.test.ts`.
- **`inventario.ver_movimientos`** — servicio `apps/api/src/modules/store.ts:252 → SELECT app.stock_movement LIMIT 200`; R0 lectura; roles por `0009_store.sql:771 policy movement_select`.
  Entrada: query MovementsQuery.
  - `location_id` uuid
  - `product_id` uuid
  Auditoría: bus `inventario.ver_movimientos`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/store.test.ts`.
  Nota: Ninguna pantalla web la llama.

</details>

### mensajes (7)

| Acción | Qué hace | Cómo lo diría el dueño | Ruta | Riesgo | Roles | Pantalla | Copiloto |
|---|---|---|---|---|---|---|---|
| `mensajes.dar_baja_total` | Da de baja a un socio de todos los mensajes de una marca (todos los canales y propósitos) y bloquea lo que esté en cola. | «Juan Pérez pidió que no le escribamos más, dale de baja»<br>«Saca a María López de todos los mensajes de la marca» | `POST /v1/members/:id/opt-out` | R2 | owner, location_manager, front_desk, trainer, nutritionist, chef, clinician, accountant, member, guardian | `/staff/members/:id` | sí |
| `mensajes.enviar_mensaje` | Pone en cola UN mensaje a UN socio usando una plantilla del catálogo; si no tiene consentimiento queda bloqueado. | «Mándale a María López un recordatorio de su clase del martes a las 6:00 por WhatsApp»<br>«Envíale a Juan Pérez el aviso de pago fallido de $45.00 por SMS»<br>«Mándale a Carmen la promo del 20% hasta el 30 de noviembre por email» | `POST /v1/messages` | R1 | owner, location_manager, front_desk | `/staff/members/:id` | sí |
| `mensajes.listar_plantillas` | Lista las plantillas de mensajes disponibles con su idioma, propósito y texto. | «¿Qué plantillas de mensajes tengo?»<br>«¿Cómo dice el mensaje de promoción?» | `GET /v1/templates` | R0 | owner, location_manager, front_desk, trainer, nutritionist, chef, clinician, accountant, member, guardian | `/staff/members/:id` | sí |
| `mensajes.registrar_consentimiento` | Registra que un socio da o retira su consentimiento para recibir mensajes de una marca por un canal y propósito. | «Anota que María López acepta recordatorios por SMS, firmó el formulario hoy»<br>«Juan Pérez no quiere promociones por email, quítaselo» | `PUT /v1/members/:id/consents` | R2 | owner, location_manager, front_desk, trainer, nutritionist, chef, clinician, accountant, member, guardian | `/staff/members/:id` | sí |
| `mensajes.ver_bandeja` | Muestra los últimos 200 mensajes entrantes de socios y contactos, filtrables por sede. | «¿Qué mensajes nuevos tenemos en la bandeja?»<br>«Enséñame lo que ha llegado a la sede de Caguas» | `GET /v1/inbox` | R0 | owner, location_manager, front_desk, trainer, nutritionist, chef, clinician, accountant | `/staff/inbox` | sí |
| `mensajes.ver_consentimientos` | Muestra los consentimientos de mensajería de un socio por marca, canal y propósito, con su origen y evidencia. | «¿María López aceptó recibir promociones por WhatsApp?»<br>«¿Qué permisos de mensajes tiene Juan Pérez?» | `GET /v1/members/:id/consents` | R0 | owner, location_manager, front_desk, trainer, nutritionist, chef, clinician, accountant, member, guardian | `/staff/members/:id` | sí |
| `mensajes.ver_historial` | Muestra los últimos 100 mensajes enviados o bloqueados a un socio, con su estado y motivo de bloqueo. | «¿Qué mensajes le hemos mandado a María López?»<br>«¿Por qué no le llegó el recordatorio a Juan?» | `GET /v1/messages` | R0 | owner, location_manager, front_desk, trainer, nutritionist, chef, clinician, accountant, member, guardian | `/staff/members/:id` | sí |

<details><summary>Campos, servicio, auditoría, conocimiento y prueba</summary>

- **`mensajes.dar_baja_total`** — servicio `apps/api/src/routes/messaging.ts:85 → app.opt_out()`; R2 sensible; roles por `packages/db/migrations/0004_messaging_consent.sql:358 opt_out (can_act_for_member + check_consent_source)`.
  Entrada: params IdParams, body OptOutBody.
  - `brand_id` uuid (requerido) — marca de la sede del socio
  - `source` enum (requerido) — mismas reglas que en consentimientos
  Auditoría: bus `mensajes.dar_baja_total`; hoy `consent.opt_out`. Conocimiento: socio. Prueba: `apps/api/test/messaging.test.ts`.
  Nota: Solo el propio socio/tutor puede levantarla volviendo a otorgar por el portal.
- **`mensajes.enviar_mensaje`** — servicio `apps/api/src/routes/messaging.ts:98 → app.enqueue_message() → app.render_message()`; R1 reversible; roles por `packages/db/migrations/0004_messaging_consent.sql:412 enqueue_message (role IN owner, location_manager, front_desk + staff_can_see_member)`.
  Entrada: body MessageBody.
  - `member_id` uuid (requerido) — un solo socio visible para el que llama
  - `brand_id` uuid (requerido) — marca de la sede del socio (forbidden_brand)
  - `channel` enum (requerido) — canal
  - `template_key` enum (requerido) — plantilla; el propósito sale de la plantilla (class.reminder=reminder, promo.generic=marketing, resto transactional)
  - `locale` enum (requerido) — idioma
  - `vars` object — claves date (YYYY-MM-DD), time (HH:MM), amount ($0.00), last4 (4 dígitos), discount (1–99%); valores ≤40 sin \r\n{}<>; la BD exige exactamente las que usa la plantilla
  Auditoría: bus `mensajes.enviar_mensaje`; hoy `message.enqueue`. Conocimiento: socio. Prueba: `apps/api/test/messaging.test.ts`.
  Nota: CONSENTIMIENTO: el código SÍ lo aplica — sin consent 'granted' exacto (socio, marca, canal, propósito) se guarda 'blocked' con block_reason no_consent (no da error; devuelve 201 con status). HORARIO: SÍ lo aplica para reminder/marketing — scheduled_for = app.next_allowed_send() dentro de la ventana de message_policy (por defecto 08:00–21:00 hora local de la sede); transactional sale inmediato. Una llamada = un socio, por eso R1; si el copiloto lo repite para >1 socio (campaña) debe tratarse como R2 con confirmación. NUEVO: no hay endpoint de envío masivo/segmento, ni ruta para cancelar un mensaje en cola, ni para configurar la ventana horaria (message_policy solo por SQL), ni worker de entrega en apps/api.
- **`mensajes.listar_plantillas`** — servicio `apps/api/src/routes/messaging.ts:119 → SELECT app.message_template`; R0 lectura; roles por `packages/db/migrations/0004_messaging_consent.sql:462 policy template_select (cualquier usuario con org)`.
  Entrada: ninguna.
  Auditoría: bus `mensajes.listar_plantillas`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/route-gaps.test.ts`.
  Nota: Catálogo global de plataforma (5 plantillas fijas, es/en); el dueño no puede crear plantillas propias (NUEVO si el pedido lo exige). Sin prueba HTTP.
- **`mensajes.registrar_consentimiento`** — servicio `apps/api/src/routes/messaging.ts:72 → app.set_consent()`; R2 sensible; roles por `packages/db/migrations/0004_messaging_consent.sql:279 set_consent (can_act_for_member; otorgar solo owner/location_manager/front_desk :293; fuente :256-262)`.
  Entrada: params IdParams, body ConsentBody.
  - `brand_id` uuid (requerido) — marca de la sede del socio (forbidden_brand)
  - `channel` enum (requerido) — canal
  - `purpose` enum (requerido) — propósito
  - `granted` boolean (requerido) — true = otorga, false = retira
  - `source` enum (requerido) — personal: front_desk\|web_form\|import (import solo owner); socio/tutor: member_portal; keyword nunca (invalid_source)
  - `evidence` string — ≤2000; obligatorio al otorgar (evidence_required)
  Auditoría: bus `mensajes.registrar_consentimiento`; hoy `consent.grant / consent.revoke`. Conocimiento: socio. Prueba: `apps/api/test/messaging.test.ts`.
  Nota: R2 (consentimiento). Cualquier personal que vea al socio puede RETIRAR; solo mostrador puede OTORGAR. El personal no puede reactivar lo que el socio retiró por portal/palabra clave (member_revoked) ni con baja de marca vigente (member_opted_out). Retirar bloquea los mensajes en cola de ese canal/propósito. El copiloto nunca debe otorgar sin evidencia real del socio.
- **`mensajes.ver_bandeja`** — servicio `apps/api/src/routes/messaging.ts:140 → SELECT app.inbound_message`; R0 lectura; roles por `packages/db/migrations/0004_messaging_consent.sql:476 policy inbound_select (app.is_staff(), por sede)`.
  Entrada: query InboxQuery.
  - `location_id` uuid — uuid de sede (query no estricta)
  Auditoría: bus `mensajes.ver_bandeja`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/messaging.test.ts`.
  Nota: Cualquier rol de personal lee la bandeja de sus sedes. NUEVO: no hay ruta para marcar 'handled' (existe GRANT UPDATE(handled), 0004:494) ni para responder; la ingesta de webhooks aún no existe.
- **`mensajes.ver_consentimientos`** — servicio `apps/api/src/routes/messaging.ts:58 → SELECT app.consent`; R0 lectura; roles por `packages/db/migrations/0004_messaging_consent.sql:465 policy consent_select (app.can_act_for_member :163: cualquier personal que vea al socio, el socio, su tutor)`.
  Entrada: params IdParams.
  Auditoría: bus `mensajes.ver_consentimientos`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/messaging.test.ts`.
  Nota: También en /me/consents para el socio. Visible a cualquier rol de personal con el socio en su sede (incluye trainer, chef, clinician, accountant). Expone el campo evidence (texto libre).
- **`mensajes.ver_historial`** — servicio `apps/api/src/routes/messaging.ts:128 → SELECT app.outbound_message`; R0 lectura; roles por `packages/db/migrations/0004_messaging_consent.sql:474 policy outbound_select (can_act_for_member)`.
  Entrada: query MessagesQuery.
  - `member_id` uuid (requerido) — socio (query no estricta)
  Auditoría: bus `mensajes.ver_historial`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/netlify.test.ts`.
  Nota: Solo por socio; no hay listado global de envíos ni métricas de entrega.

</details>

### nutricion (1)

| Acción | Qué hace | Cómo lo diría el dueño | Ruta | Riesgo | Roles | Pantalla | Copiloto |
|---|---|---|---|---|---|---|---|
| `nutricion.crear_borrador_energia` | El especialista en nutrición genera un BORRADOR de rango de energía para un socio, guardado como plan de nutrición en borrador que luego debe aprobar con licencia verificada. | «Calcula un borrador de energía de mantenimiento para Carmen, mujer, nacida en 1990»<br>«Prepara un borrador de superávit para Luis» | `POST /v1/coach/nutrition-drafts` | R2 | nutritionist | `/staff/members/:id` | no |

<details><summary>Campos, servicio, auditoría, conocimiento y prueba</summary>

- **`nutricion.crear_borrador_energia`** — servicio `apps/api/src/modules/coach.ts:842 → nutritionDraftRefusal + app.coach_activity_days (0016_coach.sql:422) + computeEnergyDraft + app.coach_nutrition_draft (0016_coach.sql:444) → INSERT app.care_plan kind=nutrition status=draft`; R2 sensible; roles por `apps/api/src/modules/coach.ts:844 role !== 'nutritionist' → 403; 0016_coach.sql:454 health_can_author('nutrition') AND health_staff_can_see`.
  Entrada: body DraftBody.
  - `member_id` uuid (requerido) — visible al llamante
  - `goal` enum (requerido) — deficit prohibido con embarazo, lactancia o TCA
  - `birth_date` string (YYYY-MM-DD) (requerido) — fecha válida; <18 años o con tutor → rechazo minor_no_calorie_counting
  - `sex` enum (requerido)
  Auditoría: bus `nutricion.crear_borrador_energia`; hoy `coach.nutrition_draft|care_plan.create`. Conocimiento: socio. Prueba: `apps/api/test/coach.test.ts`.
  Nota: La extracción lista coach_action_propose en sqlFns por arrastre (pertenece a proposeWrite, coach.ts:1007); esta ruta no lo llama. Requiere triaje firmado (triage_required), bloquea triaje nutricional rojo. Owner sin permiso. Resultado visible en /staff/health/plans (pestaña 'Borrador de energía' en la ficha).

</details>

### planes (5)

| Acción | Qué hace | Cómo lo diría el dueño | Ruta | Riesgo | Roles | Pantalla | Copiloto |
|---|---|---|---|---|---|---|---|
| `planes.activar_precio` | Activa o desactiva un precio del catálogo de planes. | «Desactiva el precio viejo de 40 dólares de la membresía»<br>«Vuelve a activar el precio del pase de día» | `PATCH /v1/billing/prices/:id` | R2 | owner, location_manager | `/staff/billing/catalog` | sí |
| `planes.crear_precio` | Crea un precio para un producto del catálogo (monto, intervalo de cobro, créditos, vigencia y permanencia), global o de una sede. | «Ponle precio de 45 dólares mensuales a la Membresía Estudiante»<br>«Crea un precio de 120 dólares por el paquete de 10 clases válido 90 días»<br>«Añade un precio anual de 450 con 12 meses de permanencia en la sede de Caguas» | `POST /v1/billing/prices` | R2 | owner, location_manager | `/staff/billing/catalog` | sí |
| `planes.crear_producto` | Crea un producto del catálogo de planes (membresía, paquete, pase, sesión suelta, cuota de inscripción…) sin precio. | «Crea un plan nuevo que se llame Membresía Estudiante»<br>«Añade un paquete de 10 clases al catálogo»<br>«Crea una cuota de inscripción exenta de IVU» | `POST /v1/billing/products` | R2 | owner | `/staff/billing/catalog` | sí |
| `planes.editar_producto` | Cambia nombre, descripción, categoría de IVU o activa/desactiva un producto del catálogo de planes. | «Desactiva el plan Verano 2025»<br>«Cambia el nombre del paquete de 10 clases a Pack 10»<br>«Marca la cuota de inscripción como exenta» | `PATCH /v1/billing/products/:id` | R2 | owner | `/staff/billing/catalog` | sí |
| `planes.ver_catalogo` | Muestra el catálogo de planes y paquetes (productos de membresía) con todos sus precios. | «¿Qué planes tenemos ahora mismo?»<br>«Dime los precios de las membresías»<br>«¿Cuánto cuesta el pase de día?» | `GET /v1/billing/catalog` | R0 | owner, location_manager, front_desk, accountant, member, guardian | `/staff/billing/catalog` | sí |

<details><summary>Campos, servicio, auditoría, conocimiento y prueba</summary>

- **`planes.activar_precio`** — servicio `apps/api/src/modules/billing.ts:263 → UPDATE app.price SET active`; R2 sensible; roles por `0006_billing.sql:923 policy price_update (location_manager solo precios de sus sedes)`.
  Entrada: params IdParams, body PricePatch.
  - `active` boolean (requerido) — único campo editable de un precio
  Auditoría: bus `planes.activar_precio`; hoy `price.update (trigger billing_audit_trigger, 0006:864)`. Conocimiento: producto. Prueba: `apps/api/test/route-gaps.test.ts`.
  Nota: Sin prueba HTTP que llame PATCH /v1/billing/prices/:id (la web sí: setPriceActive).
- **`planes.crear_precio`** — servicio `apps/api/src/modules/billing.ts:242 → INSERT app.price (+ trigger app.price_kind_check)`; R2 sensible; roles por `0006_billing.sql:919 policy price_insert (owner cualquiera; location_manager solo location_id de sus sedes)`.
  Entrada: body PriceBody.
  - `product_id` uuid (requerido) — producto activo de la org
  - `location_id` uuid|null — null = toda la organización (solo owner); location_manager solo su sede
  - `amount_cents` integer (requerido) — entero 0–10,000,000
  - `billing_interval` enum — membership/addon exigen month\|year; el resto none (trigger price_kind_check 0006:815)
  - `credits` integer|null — 1–500; obligatorio para class_pack/pt_package, prohibido en el resto
  - `validity_days` integer|null — 1–730
  - `commitment_months` integer — 0–36; al suscribir no puede superar billing_policy.max_commitment_months
  Auditoría: bus `planes.crear_precio`; hoy `price.insert (trigger billing_audit_trigger, 0006:864)`. Conocimiento: producto. Prueba: `apps/api/test/billing.test.ts`.
  Nota: Cambiar precios = R2. El monto de un precio existente no se puede editar (solo grant UPDATE(active)): cambiar precio = crear precio nuevo + desactivar el viejo.
- **`planes.crear_producto`** — servicio `apps/api/src/modules/billing.ts:203 → INSERT app.plan_product`; R2 sensible; roles por `0006_billing.sql:906 policy plan_product_insert (solo owner, Security review H1)`.
  Entrada: body ProductBody.
  - `kind` enum (requerido) — tipo fijo después de crear (no hay grant UPDATE de kind)
  - `name` string (requerido) — trim, 1–80, regex ^[^\r\n{}<>]*$ (Name)
  - `description` string — ≤500, regex ^[^{}<>]*$
  - `tax_category` enum — IVU aplica solo a taxable
  Auditoría: bus `planes.crear_producto`; hoy `plan_product.insert (trigger billing_audit_trigger, 0006:864)`. Conocimiento: producto. Prueba: `apps/api/test/billing.test.ts`.
  Nota: Crear planes es 'cambiar planes' → R2. Inconsistencia: la web (CATALOG_MANAGERS en apps/web/src/modules/billing/index.ts y packages/shared) muestra el catálogo a location_manager, pero RLS solo deja escribir al owner.
- **`planes.editar_producto`** — servicio `apps/api/src/modules/billing.ts:215 → UPDATE app.plan_product`; R2 sensible; roles por `0006_billing.sql:909 policy plan_product_update (solo owner)`.
  Entrada: params IdParams, body ProductPatch.
  - `name` string — trim, 1–80, regex ^[^\r\n{}<>]*$ (Name)
  - `description` string|null — ≤500, regex ^[^{}<>]*$; null la borra
  - `tax_category` enum
  - `active` boolean — false = desactivar (deja de venderse)
  Auditoría: bus `planes.editar_producto`; hoy `plan_product.update (trigger billing_audit_trigger, 0006:864)`. Conocimiento: producto. Prueba: `apps/api/test/route-gaps.test.ts`.
  Nota: Body requiere al menos un campo (refine 'empty'). Desactivar o cambiar IVU = R2. Sin prueba HTTP que llame PATCH /v1/billing/products/:id (la web sí lo usa: setProductActive).
- **`planes.ver_catalogo`** — servicio `apps/api/src/modules/billing.ts:185 → SELECT app.plan_product, app.price (RLS)`; R0 lectura; roles por `0006_billing.sql:902 policy plan_product_select; 0006_billing.sql:913 policy price_select (location_manager/front_desk solo precios de su sede u org-wide)`.
  Entrada: ninguna.
  Auditoría: bus `planes.ver_catalogo`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/billing.test.ts`.
  Nota: Socios y tutores también la leen por RLS; trainer/chef/clínicos reciben listas vacías (no 403), ver test billing.test.ts:102.

</details>

### portal (7)

| Acción | Qué hace | Cómo lo diría el dueño | Ruta | Riesgo | Roles | Pantalla | Copiloto |
|---|---|---|---|---|---|---|---|
| `portal.fijar_meta_semanal` | El socio fija su meta de entrenamientos por semana (1 a 14). | — | `PUT /v1/me/goal` | R1 | member | `/me/progress` | no |
| `portal.mis_socios` | Devuelve el socio propio o los menores a cargo del tutor para reservar en su nombre. | — | `GET /v1/schedule/my-members` | R0 | member, guardian | `/me/classes` | no |
| `portal.ver_documentos` | Devuelve al socio sus contratos firmados, el estado de sus consentimientos de mensajería y sus facturas. | — | `GET /v1/me/documents` | R0 | member, guardian | `/me/documents` | no |
| `portal.ver_inicio` | Devuelve el panel del socio: membresía, próxima clase, racha, meta semanal, programas, reto destacado y número de documentos. | — | `GET /v1/me/home` | R0 | member, guardian | `/me/home` | no |
| `portal.ver_mi_membresia` | El socio (o su tutor) ve su propia membresía, facturas, pagos, créditos y pases. | — | `GET /v1/billing/me` | R0 | member, guardian | `/me/membership` | no |
| `portal.ver_nutricion` | Devuelve al socio su plan de nutrición publicado (aprobado por el profesional licenciado) y su próxima cita de nutrición. | — | `GET /v1/me/nutrition` | R0 | member, guardian | `/me/nutrition` | no |
| `portal.ver_progreso` | Devuelve el progreso del socio: entrenamientos, clases y minutos activos de las últimas 12 semanas y sus 20 eventos recientes. | — | `GET /v1/me/progress` | R0 | member, guardian | `/me/progress` | no |

<details><summary>Campos, servicio, auditoría, conocimiento y prueba</summary>

- **`portal.fijar_meta_semanal`** — servicio `apps/api/src/modules/portal.ts:520 → app.set_member_goal()`; R1 reversible; roles por `packages/db/migrations/0021_portal.sql:90 set_member_goal (role = member; el tutor no puede)`.
  Entrada: body GoalBody.
  - `weekly_trainings` integer (requerido) — 1–14 entrenamientos por semana ISO local
  Auditoría: bus `portal.fijar_meta_semanal`; hoy `member_goal.set`. Conocimiento: socio. Prueba: `apps/api/test/portal.test.ts`.
  Nota: Solo-socio. default=4 es el valor implícito cuando no hay fila (DEFAULT_WEEKLY_GOAL), no un default del body.
- **`portal.mis_socios`** — servicio `apps/api/src/modules/schedule.ts:334 → SELECT app.member (RLS)`; R0 lectura; roles por `apps/api/src/modules/schedule.ts:335 (chequeo de rol member/guardian en el handler) + 0002_rls.sql:50 member_select`.
  Entrada: ninguna.
  Auditoría: bus `portal.mis_socios`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/schedule.test.ts`.
- **`portal.ver_documentos`** — servicio `apps/api/src/modules/portal.ts:531 → SELECT member_agreement + consent + invoice`; R0 lectura; roles por `packages/db/migrations/0021_portal.sql:56-64 portal_acting_member (role IN member, guardian; personal → 403)`.
  Entrada: query ActingQuery.
  - `member_id` uuid — solo tutor: elige el menor a cargo (si no, el primero); el socio solo puede poner su propio id
  Auditoría: bus `portal.ver_documentos`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/portal.test.ts`.
  Nota: Solo-socio.
- **`portal.ver_inicio`** — servicio `apps/api/src/modules/portal.ts:411 → app.portal_acting_member() + lecturas de schedule/billing/floor/engagement`; R0 lectura; roles por `packages/db/migrations/0021_portal.sql:56-64 portal_acting_member (role IN member, guardian; personal → 403)`.
  Entrada: query ActingQuery.
  - `member_id` uuid — solo tutor: elige el menor a cargo (si no, el primero); el socio solo puede poner su propio id
  Auditoría: bus `portal.ver_inicio`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/portal.test.ts`.
  Nota: Solo-socio (el personal recibe 403).
- **`portal.ver_mi_membresia`** — servicio `apps/api/src/modules/billing.ts:291 → billingFor() con app.billing_is_self (0006_billing.sql:286)`; R0 lectura; roles por `0006_billing.sql:286 app.billing_is_self (role IN member, guardian)`.
  Entrada: ninguna.
  Auditoría: bus `portal.ver_mi_membresia`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/billing.test.ts`.
  Nota: Ruta solo-socio.
- **`portal.ver_nutricion`** — servicio `apps/api/src/modules/portal.ts:569 → SELECT app.care_plan (published) + app.appointment`; R0 lectura; roles por `packages/db/migrations/0021_portal.sql:56-64 portal_acting_member (role IN member, guardian; personal → 403)`.
  Entrada: query ActingQuery.
  - `member_id` uuid — solo tutor: elige el menor a cargo (si no, el primero); el socio solo puede poner su propio id
  Auditoría: bus `portal.ver_nutricion`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/portal.test.ts`.
  Nota: Dato de salud: solo-socio; nunca se devuelve al personal por esta ruta.
- **`portal.ver_progreso`** — servicio `apps/api/src/modules/portal.ts:481 → app.portal_acting_member() + SELECT check_in/booking/circuit_run/member_goal`; R0 lectura; roles por `packages/db/migrations/0021_portal.sql:56-64 portal_acting_member (role IN member, guardian; personal → 403)`.
  Entrada: query ActingQuery.
  - `member_id` uuid — solo tutor: elige el menor a cargo (si no, el primero); el socio solo puede poner su propio id
  Auditoría: bus `portal.ver_progreso`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/portal.test.ts`.
  Nota: La entrada lista sqlFns=set_member_goal pero esta ruta solo LEE app.member_goal (helper weeklyGoal, portal.ts:201); no la llama. Minutos activos son estimados (60 min por visita sin clase).

</details>

### productos (4)

| Acción | Qué hace | Cómo lo diría el dueño | Ruta | Riesgo | Roles | Pantalla | Copiloto |
|---|---|---|---|---|---|---|---|
| `productos.crear` | Crea un producto de la tienda con SKU, nombre, categoría, precio y si paga IVU o requiere verificar edad. | «Añade a la tienda una botella de agua de 2 dólares, SKU AGUA-500»<br>«Crea el producto proteína whey de 45 dólares en suplementos»<br>«Mete una camiseta del gym de 20 dólares» | `POST /v1/store/products` | R1 | owner | `/staff/store/products` | sí |
| `productos.editar` | Cambia nombre, categoría, precio, IVU, restricción de edad o activa/desactiva un producto de la tienda. | «Sube la proteína whey a 49.99»<br>«Desactiva la camiseta roja»<br>«Marca la bebida energética como restringida por edad» | `PATCH /v1/store/products/:id` | R2 | owner | `/staff/store/products` | sí |
| `productos.listar` | Lista los productos de la tienda (SKU, categoría, precio, IVU, restricción de edad, activo). | «¿Qué productos vendemos en la tienda?»<br>«Enséñame también los productos desactivados»<br>«¿Cuánto cuesta la proteína de chocolate?» | `GET /v1/store/products` | R0 | owner, location_manager, front_desk, accountant | `/staff/store/products` | sí |
| `productos.ver_catalogo_sede` | Muestra el catálogo activo de la tienda con las unidades disponibles para vender en una sede. | «¿Qué hay disponible para vender en la tienda de Bayamón?»<br>«¿Cuántas proteínas quedan en Caguas?» | `GET /v1/store/catalogue` | R0 | owner, location_manager, front_desk, member, guardian | `/staff/store/pos` | sí |

<details><summary>Campos, servicio, auditoría, conocimiento y prueba</summary>

- **`productos.crear`** — servicio `apps/api/src/modules/store.ts:184 → INSERT app.product`; R1 reversible; roles por `0009_store.sql:757 policy product_insert (solo owner, Security review H1)`.
  Entrada: body ProductBody.
  - `sku` string (requerido) — regex ^[A-Z0-9][A-Z0-9-]{1,31}$ (STORE_SKU_PATTERN); no editable después
  - `name` string (requerido) — trim, 1–120, sin caracteres de control (Text(1,120))
  - `category` enum (requerido)
  - `age_restricted` boolean — true exige verificar edad al vender
  - `taxable` boolean — IVU estatal+municipal
  - `price_cents` integer (requerido) — 0–100,000 (STORE_MAX_PRICE_CENTS)
  - `active` boolean
  Auditoría: bus `productos.crear`; hoy `store.product.create (trigger store_product_audit)`. Conocimiento: producto. Prueba: `apps/api/test/store.test.ts`.
  Nota: Inconsistencia: STORE_MANAGER_ROLES (packages/shared/src/modules/store.ts) y la pantalla /staff/store/products incluyen location_manager, pero RLS solo deja crear al owner.
- **`productos.editar`** — servicio `apps/api/src/modules/store.ts:197 → UPDATE app.product`; R2 sensible; roles por `0009_store.sql:760 policy product_update (solo owner)`.
  Entrada: params IdParams, body ProductPatch.
  - `name` string — trim, 1–120, sin caracteres de control (Text(1,120))
  - `category` enum
  - `age_restricted` boolean
  - `taxable` boolean
  - `price_cents` integer — 0–100,000
  - `active` boolean — false = desactivar
  Auditoría: bus `productos.editar`; hoy `store.product.update (trigger store_product_audit, guarda old_price_cents)`. Conocimiento: producto. Prueba: `apps/api/test/store.test.ts`.
  Nota: Al menos un campo (refine empty_patch); sku no editable. R2 por cambiar precio/desactivar; un simple cambio de nombre sería R1.
- **`productos.listar`** — servicio `apps/api/src/modules/store.ts:172 → SELECT app.product LIMIT 1000`; R0 lectura; roles por `0009_store.sql:752 policy product_select (socio/tutor solo activos)`.
  Entrada: query ProductsQuery.
  - `include_inactive` string — "true"\|"false" → boolean
  Auditoría: bus `productos.listar`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/store.test.ts`.
- **`productos.ver_catalogo_sede`** — servicio `apps/api/src/modules/store.ts:214 → app.store_catalogue (0009_store.sql:657)`; R0 lectura; roles por `0009_store.sql:664 store_catalogue (member/guardian de la org o store_can_sell 0009_store.sql:220)`.
  Entrada: query LocationQuery.
  - `location_id` uuid (requerido)
  Auditoría: bus `productos.ver_catalogo_sede`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/store.test.ts`.
  Nota: También la usa la tienda del socio (/me/store).

</details>

### proveedores (3)

| Acción | Qué hace | Cómo lo diría el dueño | Ruta | Riesgo | Roles | Pantalla | Copiloto |
|---|---|---|---|---|---|---|---|
| `proveedores.crear` | Da de alta un proveedor con nombre y correo de contacto opcional. | «Añade el proveedor Distribuidora Boricua»<br>«Crea el suplidor Agua Pura con correo ventas@aguapura.com» | `POST /v1/finance/vendors` | R1 | owner, location_manager | `/staff/finance` | sí |
| `proveedores.editar` | Cambia nombre o correo de un proveedor, o lo activa/desactiva. | «Cambia el correo de Agua Pura a pedidos@aguapura.com»<br>«Desactiva el proveedor Distribuidora Boricua» | `PATCH /v1/finance/vendors/:id` | R2 | owner | — | sí |
| `proveedores.listar` | Lista los proveedores (nombre, correo de contacto, activo). | «¿Qué proveedores tenemos?»<br>«Enséñame también los proveedores inactivos» | `GET /v1/finance/vendors` | R0 | owner, location_manager, accountant | `/staff/finance` | sí |

<details><summary>Campos, servicio, auditoría, conocimiento y prueba</summary>

- **`proveedores.crear`** — servicio `apps/api/src/modules/finance.ts:250 → INSERT app.vendor`; R1 reversible; roles por `0013_finance.sql:821 policy vendor_insert (owner, location_manager; created_by = caller)`.
  Entrada: body VendorBody.
  - `name` string (requerido) — trim, 1–120, sin caracteres de control (Text(1,120))
  - `contact_email` string — email válido, ≤254
  Auditoría: bus `proveedores.crear`; hoy `vendor.insert (trigger fin_audit_trigger)`. Conocimiento: proveedor. Prueba: `apps/api/test/finance.test.ts`.
  Nota: La prueba solo verifica que el accountant recibe 403.
- **`proveedores.editar`** — servicio `apps/api/src/modules/finance.ts:262 → UPDATE app.vendor`; R2 sensible; roles por `0013_finance.sql:824 policy vendor_update (solo owner)`.
  Entrada: params IdParams, body VendorPatch.
  - `name` string — trim, 1–120, sin caracteres de control (Text(1,120))
  - `contact_email` string|null — email ≤254; null lo borra
  - `active` boolean — false = desactivar
  Auditoría: bus `proveedores.editar`; hoy `vendor.update (trigger fin_audit_trigger)`. Conocimiento: proveedor. Prueba: `apps/api/test/route-gaps.test.ts`.
  Nota: R2 por poder desactivar; renombrar o cambiar correo solo sería R1. Sin pantalla web ni prueba HTTP. Inconsistencia: location_manager puede crear proveedores pero no editarlos.
- **`proveedores.listar`** — servicio `apps/api/src/modules/finance.ts:239 → SELECT app.vendor LIMIT 500`; R0 lectura; roles por `0013_finance.sql:819 policy vendor_select`.
  Entrada: query VendorsQuery.
  - `include_inactive` string — "true"\|"false" → boolean
  Auditoría: bus `proveedores.listar`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/route-gaps.test.ts`.
  Nota: Sin prueba HTTP de GET /finance/vendors (finance.test.ts solo hace POST).

</details>

### puntos (17)

| Acción | Qué hace | Cómo lo diría el dueño | Ruta | Riesgo | Roles | Pantalla | Copiloto |
|---|---|---|---|---|---|---|---|
| `puntos.acreditar_referido` | Confirma que el invitado ya es socio activo y acredita los puntos de referido a quien lo invitó. | «Acredítale a María el referido de su prima, ya se inscribió»<br>«Confirma el referido de Juan» | `POST /v1/engagement/referrals/:id/credit` | R1 | owner, location_manager, front_desk | `/staff/engagement/points` | sí |
| `puntos.ajustar_puntos` | Suma o resta puntos a mano a un socio con un motivo obligatorio (sin dejar el saldo negativo). | «Dale 100 puntos a Juan Pérez por cumpleaños»<br>«Quítale 50 puntos a María, se le dieron de más» | `POST /v1/engagement/members/:id/manual` | R1 | owner, location_manager, front_desk | `/staff/engagement/points` | sí |
| `puntos.cambiar_estado_canje` | Marca un canje como entregado o lo cancela (cancelar devuelve los puntos). | «Marca como entregada la camiseta de María»<br>«Cancela el canje del batido de Juan y devuélvele los puntos» | `PATCH /v1/engagement/redemptions/:id` | R1 | owner, location_manager, front_desk, member | `/staff/engagement/rewards` | sí |
| `puntos.canjear_recompensa` | Canjea una recompensa para un socio descontando sus puntos (queda 'solicitada' hasta entregarla). | «Canjéale a María López la camiseta con sus puntos»<br>«Juan quiere cambiar sus puntos por el batido» | `POST /v1/engagement/redemptions` | R1 | owner, location_manager, front_desk, member | `/staff/engagement/rewards` | sí |
| `puntos.crear_recompensa` | Añade una recompensa al catálogo con su costo en puntos y si está vedada a menores. | «Crea una recompensa: camiseta del gym por 500 puntos»<br>«Añade una sesión de entrenamiento personal gratis a 1,200 puntos, no para menores» | `POST /v1/engagement/rewards` | R2 | owner | `/staff/engagement/rewards` | sí |
| `puntos.crear_referido` | El socio invita a alguien por email (no se envía ningún mensaje). | — | `POST /v1/engagement/referrals` | R1 | member | `/me/refer` | no |
| `puntos.crear_regla` | Crea la regla de puntos para un evento (una por evento en la organización). | «Que cada compra dé 5 puntos»<br>«Activa el bono de regreso con 50 puntos» | `POST /v1/engagement/rules` | R2 | owner | `/staff/engagement/points` | sí |
| `puntos.editar_recompensa` | Edita una recompensa: nombre, descripción, costo en puntos, restricción a menores o si está activa. | «Sube la camiseta a 600 puntos»<br>«Desactiva la recompensa del batido» | `PATCH /v1/engagement/rewards/:id` | R2 | owner | `/staff/engagement/rewards` | sí |
| `puntos.editar_regla` | Cambia los puntos de una regla o la activa/desactiva. | «Sube la visita a 15 puntos»<br>«Desactiva los puntos por compra» | `PATCH /v1/engagement/rules/:id` | R2 | owner | `/staff/engagement/points` | sí |
| `puntos.listar_canjes` | Lista los canjes de recompensas (hasta 200), filtrables por socio y estado. | «¿Qué canjes están pendientes de entregar?»<br>«¿Qué ha canjeado María López?» | `GET /v1/engagement/redemptions` | R0 | owner, location_manager, front_desk, member, guardian | `/staff/engagement/rewards` | sí |
| `puntos.listar_recompensas` | Lista el catálogo de recompensas canjeables con su costo en puntos. | «¿Qué recompensas tenemos?»<br>«¿Cuántos puntos cuesta la botella de agua?» | `GET /v1/engagement/rewards` | R0 | owner, location_manager, front_desk, member, guardian | `/staff/engagement/rewards` | sí |
| `puntos.listar_referidos` | Lista los referidos (invitaciones por email) con su estado y puntos acreditados. | «¿Qué referidos tenemos pendientes?»<br>«¿A quién ha referido María López?» | `GET /v1/engagement/referrals` | R0 | owner, location_manager, front_desk, member, guardian | `/staff/engagement/points` | sí |
| `puntos.listar_reglas` | Lista las reglas de puntos: cuántos puntos da cada evento (visita, clase, compra, meta de reto, referido, bono de regreso) y si están activas. | «¿Cuántos puntos da una visita?»<br>«Enséñame las reglas de puntos» | `GET /v1/engagement/rules` | R0 | owner, location_manager, front_desk, member, guardian | `/staff/engagement/points` | sí |
| `puntos.otorgar_puntos` | Otorga a un socio los puntos de la regla de visita, clase o compra (con bonos de regreso, racha y progreso de retos). | «Dale los puntos de la visita de hoy a Juan Pérez»<br>«Acredítale a María los puntos de la clase de spinning» | `POST /v1/engagement/members/:id/award` | R1 | owner, location_manager, front_desk | `/staff/members/:id` | sí |
| `puntos.ver_movimientos` | Lista los últimos movimientos de puntos (todos o de un socio), con motivo y nota. | «Enséñame los últimos movimientos de puntos»<br>«¿Qué puntos se le han dado a Juan Pérez esta semana?» | `GET /v1/engagement/ledger` | R0 | owner, location_manager, front_desk, member, guardian | `/staff/engagement/points` | sí |
| `puntos.ver_pasivo` | Calcula los puntos pendientes de canje de toda la organización y cuántos socios tienen saldo (pasivo contable). | «¿Cuántos puntos debemos en total?»<br>«¿Cuántos socios tienen puntos sin canjear?» | `GET /v1/engagement/liability` | R0 | owner, accountant | `/staff/engagement/points` | sí |
| `puntos.ver_puntos_socio` | Muestra el saldo de puntos de un socio, su racha semanal, sus últimos 100 movimientos y sus logros. | «¿Cuántos puntos tiene María López?»<br>«¿Qué racha lleva Juan Pérez?» | `GET /v1/engagement/members/:id/points` | R0 | owner, location_manager, front_desk, member, guardian | `/staff/members/:id` | sí |

<details><summary>Campos, servicio, auditoría, conocimiento y prueba</summary>

- **`puntos.acreditar_referido`** — servicio `apps/api/src/modules/engagement.ts:516 → app.credit_referral()`; R1 reversible; roles por `packages/db/migrations/0012_engagement.sql:681-682 credit_referral (eng_front_staff_for del que refiere)`.
  Entrada: params IdParams.
  Auditoría: bus `puntos.acreditar_referido`; hoy `referral.credited / referral.joined`. Conocimiento: socio. Prueba: `apps/api/test/engagement.test.ts`.
  Nota: No reversible (already_credited; libro append-only). Sin regla 'referral' activa queda 'joined' sin puntos. 409 referral_not_joined si el invitado no es socio activo creado después del referido.
- **`puntos.ajustar_puntos`** — servicio `apps/api/src/modules/engagement.ts:296 → app.award_manual_points()`; R1 reversible; roles por `packages/db/migrations/0012_engagement.sql:416 award_manual_points (eng_front_staff_for)`.
  Entrada: params IdParams, body ManualBody.
  - `delta` integer (requerido) — -10000..10000, distinto de 0; negativo no puede sobregirar (409 insufficient_points)
  - `note` string (requerido) — motivo 3–200, sin {}<> ni saltos de línea
  Auditoría: bus `puntos.ajustar_puntos`; hoy `points.manual`. Conocimiento: socio. Prueba: `apps/api/test/engagement.test.ts`.
  Nota: Libro de puntos append-only: se corrige con otro ajuste, no se borra. Afecta el pasivo de puntos.
- **`puntos.cambiar_estado_canje`** — servicio `apps/api/src/modules/engagement.ts:364 → app.set_redemption_status()`; R1 reversible; roles por `packages/db/migrations/0012_engagement.sql:480 set_redemption_status (eng_front_staff_for; el socio solo 'cancelled' del suyo)`.
  Entrada: params IdParams, body RedemptionPatch.
  - `status` enum (requerido) — solo desde 'requested'
  Auditoría: bus `puntos.cambiar_estado_canje`; hoy `redemption.fulfilled / redemption.cancelled`. Conocimiento: socio. Prueba: `apps/api/test/engagement.test.ts`.
  Nota: Transición única desde 'requested' (409 invalid_transition): 'fulfilled' es final.
- **`puntos.canjear_recompensa`** — servicio `apps/api/src/modules/engagement.ts:334 → app.redeem_reward()`; R1 reversible; roles por `packages/db/migrations/0012_engagement.sql:446 redeem_reward (eng_is_self OR eng_front_staff_for)`.
  Entrada: body RedeemBody.
  - `member_id` uuid (requerido) — socio
  - `reward_id` uuid (requerido) — recompensa activa
  Auditoría: bus `puntos.canjear_recompensa`; hoy `reward.redeem`. Conocimiento: socio. Prueba: `apps/api/test/engagement.test.ts`.
  Nota: Reversible cancelando el canje (reembolsa puntos). 409 insufficient_points / reward_unavailable; 403 restricted_for_minors. La web solo ofrece canjear en /me/redeem (socio); el personal puede hacerlo por API pero no tiene botón.
- **`puntos.crear_recompensa`** — servicio `apps/api/src/modules/engagement.ts:216 → INSERT app.reward (trigger eng_config_audit)`; R2 sensible; roles por `packages/db/migrations/0012_engagement.sql:851 policy reward_insert (role = owner)`.
  Entrada: body RewardBody.
  - `name` string (requerido) — trim, 2–80, regex ^[A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9 &'.,()%+-]+$; la BD además prohíbe efectivo/cash/dinero/sorteo/rifa/lotería
  - `description` string — 1–300, sin {}<>
  - `points_cost` integer (requerido) — 1–1.000.000 puntos
  - `restricted_for_minors` boolean — no canjeable por socios con tutor
  - `active` boolean — visible/canjeable
  Auditoría: bus `puntos.crear_recompensa`; hoy `reward.insert`. Conocimiento: sistema. Prueba: `apps/api/test/engagement.test.ts`.
  Nota: R2: fija el precio en puntos (pasivo). La pantalla /staff/engagement/rewards se muestra a owner/location_manager/front_desk pero solo el owner puede crear (RLS).
- **`puntos.crear_referido`** — servicio `apps/api/src/modules/engagement.ts:503 → app.create_referral()`; R1 reversible; roles por `packages/db/migrations/0012_engagement.sql:646 create_referral (solo eng_is_self)`.
  Entrada: body ReferralBody.
  - `member_id` uuid (requerido) — debe ser el propio socio
  - `email` string (requerido) — trim ≤254; la BD valida formato y que no sea el propio email (invalid_email)
  Auditoría: bus `puntos.crear_referido`; hoy `referral.create`. Conocimiento: socio. Prueba: `apps/api/test/engagement.test.ts`.
  Nota: Solo-socio; menores no pueden (minor_not_allowed); máximo 10 en 30 días (referral_limit).
- **`puntos.crear_regla`** — servicio `apps/api/src/modules/engagement.ts:181 → INSERT app.points_rule (trigger eng_config_audit)`; R2 sensible; roles por `packages/db/migrations/0012_engagement.sql:839 policy points_rule_insert (role = owner)`.
  Entrada: body RuleBody.
  - `event` enum (requerido) — evento; único por organización (UNIQUE org_id,event)
  - `points` integer (requerido) — 1–10000 puntos
  - `active` boolean — activa
  Auditoría: bus `puntos.crear_regla`; hoy `points_rule.insert`. Conocimiento: sistema. Prueba: `apps/api/test/route-gaps.test.ts`.
  Nota: R2: cambia el valor del programa de puntos (pasivo financiero; revisión 'money modules' H1 lo deja solo al owner). Sin prueba HTTP (packages/db/test/engagement.test.ts cubre la tabla). La web no tiene botón para crear reglas (engagementApi no expone POST /rules); repetir un evento choca con UNIQUE → 409 conflict.
- **`puntos.editar_recompensa`** — servicio `apps/api/src/modules/engagement.ts:234 → UPDATE app.reward (trigger eng_config_audit)`; R2 sensible; roles por `packages/db/migrations/0012_engagement.sql:854 policy reward_update (role = owner)`.
  Entrada: params IdParams, body RewardPatch.
  - `name` string — trim, 2–80, regex ^[A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9 &'.,()%+-]+$
  - `description` string — 1–300, sin {}<>; no se puede borrar (coalesce)
  - `points_cost` integer — 1–1.000.000
  - `restricted_for_minors` boolean
  - `active` boolean
  Auditoría: bus `puntos.editar_recompensa`; hoy `reward.update`. Conocimiento: sistema. Prueba: `apps/api/test/route-gaps.test.ts`.
  Nota: R2 (cambia precio en puntos / desactiva). Sin prueba HTTP. La descripción no puede vaciarse (null = conservar).
- **`puntos.editar_regla`** — servicio `apps/api/src/modules/engagement.ts:192 → UPDATE app.points_rule (trigger eng_config_audit)`; R2 sensible; roles por `packages/db/migrations/0012_engagement.sql:842 policy points_rule_update (role = owner)`.
  Entrada: params IdParams, body RulePatch.
  - `points` integer — 1–10000
  - `active` boolean — activa/inactiva
  Auditoría: bus `puntos.editar_regla`; hoy `points_rule.update`. Conocimiento: sistema. Prueba: `apps/api/test/engagement.test.ts`.
  Nota: R2 (precio del programa de puntos). Body vacío se acepta y no cambia nada (pero dispara el trigger de auditoría igual). 404 si no existe o el rol no es owner (RLS).
- **`puntos.listar_canjes`** — servicio `apps/api/src/modules/engagement.ts:347 → SELECT app.redemption`; R0 lectura; roles por `packages/db/migrations/0012_engagement.sql:861 policy redemption_select (eng_can_view)`.
  Entrada: query RedemptionsQuery.
  - `member_id` uuid — uuid
  - `status` enum — estado
  Auditoría: bus `puntos.listar_canjes`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/route-gaps.test.ts`.
  Nota: Sin prueba HTTP de GET /engagement/redemptions.
- **`puntos.listar_recompensas`** — servicio `apps/api/src/modules/engagement.ts:207 → SELECT app.reward`; R0 lectura; roles por `packages/db/migrations/0012_engagement.sql:846 policy reward_select (member/guardian solo activas)`.
  Entrada: ninguna.
  Auditoría: bus `puntos.listar_recompensas`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/route-gaps.test.ts`.
  Nota: Sin prueba HTTP que llame GET /engagement/rewards.
- **`puntos.listar_referidos`** — servicio `apps/api/src/modules/engagement.ts:488 → SELECT app.referral`; R0 lectura; roles por `packages/db/migrations/0012_engagement.sql:865 policy referral_select (eng_can_view)`.
  Entrada: query MemberQuery.
  - `member_id` uuid — socio que refiere
  Auditoría: bus `puntos.listar_referidos`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/engagement.test.ts`.
  Nota: Incluye el email del invitado (dato de tercero). El componente StaffReferrals vive dentro de /staff/engagement/points.
- **`puntos.listar_reglas`** — servicio `apps/api/src/modules/engagement.ts:175 → SELECT app.points_rule`; R0 lectura; roles por `packages/db/migrations/0012_engagement.sql:834 policy points_rule_select (member/guardian solo activas)`.
  Entrada: ninguna.
  Auditoría: bus `puntos.listar_reglas`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/engagement.test.ts`.
  Nota: Socios y tutores ven solo las reglas activas.
- **`puntos.otorgar_puntos`** — servicio `apps/api/src/modules/engagement.ts:282 → app.award_points()`; R1 reversible; roles por `packages/db/migrations/0012_engagement.sql:348 award_points (eng_front_staff_for: owner/location_manager/front_desk con el socio en su sede)`.
  Entrada: params IdParams, body AwardBody.
  - `event` enum (requerido) — evento
  - `ref` string — ≤80, regex ^[A-Za-z0-9_.:-]+$; OBLIGATORIO en SQL para class/purchase (ref_required)
  Auditoría: bus `puntos.otorgar_puntos`; hoy `points.award`. Conocimiento: socio. Prueba: `apps/api/test/engagement.test.ts`.
  Nota: Una visita por día local (already_awarded); ref idempotente. Sin regla activa → 409 no_active_rule. 'ref_required'/'event_not_awardable' no están en REASONS → 409 conflict. HALLAZGO: la web (MemberPointsTab) envía award('class') sin ref, lo que el SQL rechaza.
- **`puntos.ver_movimientos`** — servicio `apps/api/src/modules/engagement.ts:310 → SELECT app.points_ledger`; R0 lectura; roles por `packages/db/migrations/0012_engagement.sql:859 policy points_ledger_select (eng_can_view)`.
  Entrada: query LedgerQuery.
  - `member_id` uuid — uuid de socio
  - `limit` integer — 1–200 (coerce desde texto)
  Auditoría: bus `puntos.ver_movimientos`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/engagement.test.ts`.
  Nota: El accountant entra a /staff/engagement/points pero RLS le devuelve vacío aquí (solo ve el pasivo).
- **`puntos.ver_pasivo`** — servicio `apps/api/src/modules/engagement.ts:324 → app.points_liability()`; R0 lectura; roles por `packages/db/migrations/0012_engagement.sql:783 points_liability (role IN owner, accountant)`.
  Entrada: ninguna.
  Auditoría: bus `puntos.ver_pasivo`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/engagement.test.ts`.
  Nota: Devuelve solo puntos; la valoración en dólares está marcada como pendiente de CPA en la migración (0012:778) (no implementada).
- **`puntos.ver_puntos_socio`** — servicio `apps/api/src/modules/engagement.ts:259 → app.points_balance() + app.weekly_streak() + SELECT app.points_ledger/app.achievement`; R0 lectura; roles por `packages/db/migrations/0012_engagement.sql:765 points_balance / :219 eng_can_view (staff de mostrador de la sede, el socio, su tutor)`.
  Entrada: params IdParams.
  Auditoría: bus `puntos.ver_puntos_socio`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/engagement.test.ts`.
  Nota: En la web: pestaña 'Puntos' de /staff/members/:id y /me/points para el socio.

</details>

### registro (4)

| Acción | Qué hace | Cómo lo diría el dueño | Ruta | Riesgo | Roles | Pantalla | Copiloto |
|---|---|---|---|---|---|---|---|
| `registro.abrir_inscripcion_online` | Abre o cierra la inscripción en línea de una sede. | «Abre la inscripción en línea en Caguas»<br>«Cierra el registro online de Bayamón» | `PUT /v1/signup/locations/:id` | R1 | owner, location_manager | `/staff/online-join` | sí |
| `registro.info_publica` | Devuelve los datos de la página pública Únete (marca, tema, sedes abiertas, textos legales). | — | `GET /v1/public/join/:orgId` | R0 |  | `/join/:orgId` | no |
| `registro.unirse_online` | Un visitante se inscribe en línea: crea su ficha de socio (lead), acepta términos y consentimientos SMS. | — | `POST /v1/public/join` | R2 |  | `/join/:orgId` | no |
| `registro.ver_sedes_online` | Muestra por sede si la inscripción en línea (página Únete) está abierta. | «¿En qué sedes está abierta la inscripción en línea?»<br>«¿Está abierto el registro online en Caguas?» | `GET /v1/signup/locations` | R0 | owner, location_manager, front_desk, trainer, nutritionist, chef, clinician, accountant | `/staff/online-join` | sí |

<details><summary>Campos, servicio, auditoría, conocimiento y prueba</summary>

- **`registro.abrir_inscripcion_online`** — servicio `apps/api/src/modules/signup.ts:289 → app.set_join_location (0018_signup.sql:147)`; R1 reversible; roles por `0018_signup.sql:153 set_join_location (owner; location_manager de esa sede)`.
  Entrada: params IdParams, body SwitchBody.
  - `enabled` boolean (requerido)
  Auditoría: bus `registro.abrir_inscripcion_online`; hoy `join_location.set`. Conocimiento: sistema. Prueba: `apps/api/test/signup.test.ts`.
- **`registro.info_publica`** — servicio `apps/api/src/modules/signup.ts:180 → app_public.join_info (0022_join_hero.sql:5)`; R0 lectura; roles por `apps/api/src/app.ts:58 (sin token) + 0018_signup.sql:174 app_public.join_info`.
  Entrada: params OrgParams.
  Auditoría: bus `registro.info_publica`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/signup.test.ts`.
  Nota: La entrada no lista OrgParams (usa safeParse, signup.ts:181).
- **`registro.unirse_online`** — servicio `apps/api/src/modules/signup.ts:193 → app_public.join_submit (0018_signup.sql:244)`; R2 sensible; roles por `apps/api/src/app.ts:58 (sin token) + 0018_signup.sql:244 app_public.join_submit`.
  Entrada: body joinBodyFor(demo).
  - `org_id` uuid (requerido)
  - `location_id` uuid (requerido) — sede con inscripción abierta
  - `full_name` string (requerido) — trim, 2–120
  - `email` string (requerido) — minúsculas; demo: @demo.invalid; prod: REAL_EMAIL
  - `phone` string|null — demo +1-787/939-555-01xx; prod NANP +1-XXX-XXX-XXXX
  - `birth_date` string (requerido) — YYYY-MM-DD; <21 años → age_requires_guardian
  - `terms_version` string (requerido) — ≤20, debe ser la vigente
  - `waiver_version` string (requerido) — ≤20, debe ser la vigente
  - `accept_terms` boolean (requerido) — debe ser true
  - `accept_waiver` boolean (requerido) — debe ser true
  - `sms_reminders` boolean
  - `sms_marketing` boolean
  - `locale` enum (requerido)
  Auditoría: bus `registro.unirse_online`; hoy `member.join_online`. Conocimiento: socio. Prueba: `apps/api/test/signup.test.ts`.
  Nota: Audit escrito con INSERT directo en app.audit_log (0018_signup.sql:347), no con app.audit. La entrada no lista el esquema (joinBodyFor(opts.demo), signup.ts:178).
- **`registro.ver_sedes_online`** — servicio `apps/api/src/modules/signup.ts:276 → SELECT app.location LEFT JOIN app.join_location WHERE app.is_staff()`; R0 lectura; roles por `apps/api/src/modules/signup.ts:282 (app.is_staff()) + 0018_signup.sql:374 policy join_location_select`.
  Entrada: ninguna.
  Auditoría: bus `registro.ver_sedes_online`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/signup.test.ts`.

</details>

### reportes (17)

| Acción | Qué hace | Cómo lo diría el dueño | Ruta | Riesgo | Roles | Pantalla | Copiloto |
|---|---|---|---|---|---|---|---|
| `reportes.exportar_horas_pico` | Exporta a CSV los check-ins por día de la semana y hora. | «Exporta las horas pico a un CSV»<br>«Bájame el mapa de calor de entradas en Excel» | `GET /v1/reports/heatmap.csv` | R0 | owner, location_manager | `/staff/panel` | sí |
| `reportes.exportar_ivu` | Exporta a CSV el reporte de IVU de un mes por municipio y origen. | «Mándame el IVU de octubre en Excel para la contable»<br>«Exporta el IVU del mes pasado» | `GET /v1/reports/ivu.csv` | R0 | owner, location_manager, accountant | `/staff/reports/ivu` | sí |
| `reportes.exportar_saldos_vencidos` | Exporta a CSV las facturas vencidas con nombre y número de socio y saldo. | «Bájame en Excel la lista de los que deben»<br>«Exporta los saldos vencidos» | `GET /v1/reports/overdue.csv` | R3 | owner, location_manager, front_desk | `/staff/panel` | sí |
| `reportes.exportar_socios` | Exporta a CSV las altas y bajas de socios por mes. | «Exporta las altas y bajas de socios»<br>«Dame el CSV de socios por mes» | `GET /v1/reports/members.csv` | R0 | owner, location_manager | `/staff/reports/members` | sí |
| `reportes.exportar_vencimientos` | Exporta a CSV los créditos, pases y membresías que vencen en los próximos días, con nombre del socio. | «Exporta los vencimientos de esta semana»<br>«Bájame la lista de membresías que vencen en 15 días» | `GET /v1/reports/expiring.csv` | R3 | owner, location_manager | `/staff/panel` | sí |
| `reportes.exportar_ventas` | Exporta a CSV las ventas por producto, sede y vendedor de un rango de fechas. | «Exporta las ventas de septiembre»<br>«Bájame las ventas del año en Excel» | `GET /v1/reports/sales.csv` | R3 | owner, location_manager, accountant | `/staff/reports/sales` | sí |
| `reportes.guardar_municipio_ivu` | Registra o cambia si un municipio participa en SURI para el IVU municipal. | «Marca Bayamón como participante de SURI»<br>«Caguas no participa en SURI, anótalo» | `PUT /v1/reports/ivu-municipalities` | R1 | owner | `/staff/reports/ivu` | sí |
| `reportes.listar_municipios_ivu` | Lista los municipios registrados y si declaran el IVU municipal por SURI o no. | «¿Qué municipios tenemos para el IVU?»<br>«¿Toa Baja declara el IVU municipal por SURI?» | `GET /v1/reports/ivu-municipalities` | R0 | owner, location_manager, accountant | `/staff/reports/ivu` | sí |
| `reportes.listar_saldos_vencidos` | Lista las facturas vencidas con el socio, la sede, los días de atraso y el saldo pendiente. | «¿Quién me debe?»<br>«¿Cuánto hay en cobros vencidos?»<br>«Enséñame los socios atrasados más de 30 días» | `GET /v1/reports/overdue` | R0 | owner, location_manager, front_desk | `/staff/panel` | sí |
| `reportes.listar_vencimientos` | Lista lo que vence en los próximos días: créditos con sesiones, pases y membresías que terminan. | «¿A quién se le vence la membresía esta semana?»<br>«¿Qué paquetes vencen en los próximos 15 días?» | `GET /v1/reports/expiring` | R0 | owner, location_manager | `/staff/panel` | sí |
| `reportes.ver_ejecutivo` | Panel ejecutivo: KPIs con tendencia de 12 meses, ingresos vs gastos, altas vs bajas, socios por estado, tasa de renovación y mezcla de ventas. | «¿Cuánto hemos ganado este mes comparado con el pasado?»<br>«¿Cómo van los ingresos contra los gastos?»<br>«Dame el resumen ejecutivo del gimnasio» | `GET /v1/reports/executive` | R0 | owner, location_manager | `/staff/panel` | sí |
| `reportes.ver_horas_pico` | Mapa de horas pico: check-ins permitidos por día de la semana y hora en las últimas 4 u 8 semanas. | «¿Cuáles son las horas pico?»<br>«¿Qué día viene menos gente?»<br>«Enséñame el mapa de calor de las últimas 8 semanas» | `GET /v1/reports/heatmap` | R0 | owner, location_manager | `/staff/panel` | sí |
| `reportes.ver_hoy` | Vista 'Hoy' de recepción: check-ins (permitidos y denegados), clases del día con reservas y lista de espera, y socios con saldo vencido. | «¿Qué clases hay hoy y cuántos van?»<br>«¿Cuántos han entrado hoy?»<br>«¿Cuántos check-ins se denegaron hoy?» | `GET /v1/reports/today` | R0 | owner, location_manager, front_desk | `/staff/today` | sí |
| `reportes.ver_ivu` | Reporte de IVU de un mes por municipio y origen (facturación, tienda, devoluciones): base tributable, exenta e IVU estatal y municipal. | «¿Cuánto IVU cobramos en octubre?»<br>«Prepárame el IVU del mes pasado por municipio» | `GET /v1/reports/ivu` | R0 | owner, location_manager, accountant | `/staff/reports/ivu` | sí |
| `reportes.ver_panel` | Panel del día, semana y mes: socios activos/nuevos/bajas, check-ins, ocupación de clases, ventas, cobros, saldos vencidos, vencimientos, leads y existencias bajas. | «¿Cómo va el gimnasio hoy?»<br>«¿Cuántos socios activos tenemos?»<br>«¿Qué tal la ocupación de clases esta semana?» | `GET /v1/reports/dashboard` | R0 | owner, location_manager | `/staff/panel` | sí |
| `reportes.ver_socios` | Socios por estado y altas vs bajas por mes de los últimos meses. | «¿Cuántas altas y bajas tuvimos este año?»<br>«¿Cuántos socios se dieron de baja el mes pasado?» | `GET /v1/reports/members` | R0 | owner, location_manager | `/staff/reports/members` | sí |
| `reportes.ver_ventas` | Ventas por producto o plan, sede y vendedor en un rango de fechas (facturación y tienda), con unidades, subtotal, IVU y total. | «¿Cuánto vendimos este mes?»<br>«¿Qué productos se vendieron más en octubre?»<br>«¿Cuánto vendió cada empleado la semana pasada?» | `GET /v1/reports/sales` | R0 | owner, location_manager, accountant | `/staff/reports/sales` | sí |

<details><summary>Campos, servicio, auditoría, conocimiento y prueba</summary>

- **`reportes.exportar_horas_pico`** — servicio `apps/api/src/modules/reports.ts:324 → app.report_log_export (0014_reports.sql:472) + app.report_heatmap`; R0 lectura; roles por `0014_reports.sql:486 report_log_export role check (+ 0014_reports.sql:263 rpt_guard)`.
  Entrada: query csvOf(HeatmapQuery).
  - `location_id` uuid — sede; omitido = todas las sedes visibles para el rol
  - `weeks` enum — '4'\|'8'; default 4
  - `lang` enum — es\|en; default es (idioma de los encabezados)
  - `envelope` enum — json → responde {filename, csv} en vez de text/csv
  Auditoría: bus `reportes.exportar_horas_pico`; hoy `report.export`. Conocimiento: —. Prueba: `apps/api/test/reports.test.ts`.
  Nota: Esquema construido inline: csvOf(HeatmapQuery) = HeatmapQuery + {lang, envelope}. Audita report.export antes de leer filas. Agregado sin datos personales.
- **`reportes.exportar_ivu`** — servicio `apps/api/src/modules/reports.ts:337 → app.report_log_export (0014_reports.sql:472) + app.report_ivu`; R0 lectura; roles por `0014_reports.sql:486 report_log_export role check (+ 0014_reports.sql:335 rpt_guard)`.
  Entrada: query csvOf(IvuQuery).
  - `month` string (requerido) — YYYY-MM
  - `location_id` uuid — sede; omitido = todas las sedes visibles para el rol
  - `lang` enum — es\|en; default es (idioma de los encabezados)
  - `envelope` enum — json → responde {filename, csv} en vez de text/csv
  Auditoría: bus `reportes.exportar_ivu`; hoy `report.export`. Conocimiento: —. Prueba: `apps/api/test/reports.test.ts`.
  Nota: Esquema construido inline: csvOf(IvuQuery) = IvuQuery + {lang, envelope}. Audita report.export antes de leer filas. Agregado sin datos personales.
- **`reportes.exportar_saldos_vencidos`** — servicio `apps/api/src/modules/reports.ts:284 → app.report_log_export (0014_reports.sql:472) + app.report_overdue`; R3 irreversible / dinero externo; roles por `0014_reports.sql:486 report_log_export role check (+ 0014_reports.sql:208 rpt_guard)`.
  Entrada: query csvOf(LocQuery).
  - `location_id` uuid — sede; omitido = todas las sedes visibles para el rol
  - `lang` enum — es\|en; default es (idioma de los encabezados)
  - `envelope` enum — json → responde {filename, csv} en vez de text/csv
  Auditoría: bus `reportes.exportar_saldos_vencidos`; hoy `report.export`. Conocimiento: —. Prueba: `apps/api/test/reports.test.ts`.
  Nota: Esquema construido inline: csvOf(LocQuery) = LocQuery + {lang, envelope}. Audita report.export antes de leer filas. R3: exporta datos personales (nombre, número de socio, saldo).
- **`reportes.exportar_socios`** — servicio `apps/api/src/modules/reports.ts:383 → app.report_log_export (0014_reports.sql:472) + app.report_member_flow`; R0 lectura; roles por `0014_reports.sql:486 report_log_export role check (+ 0014_reports.sql:446 rpt_guard)`.
  Entrada: query csvOf(MembersQuery).
  - `location_id` uuid — sede; omitido = todas las sedes visibles para el rol
  - `months` integer — 1–24; default 12
  - `lang` enum — es\|en; default es (idioma de los encabezados)
  - `envelope` enum — json → responde {filename, csv} en vez de text/csv
  Auditoría: bus `reportes.exportar_socios`; hoy `report.export`. Conocimiento: —. Prueba: `apps/api/test/reports.test.ts`.
  Nota: Esquema construido inline: csvOf(MembersQuery) = MembersQuery + {lang, envelope}. Audita report.export antes de leer filas. Solo exporta el flujo mensual (no el desglose por estado ni nombres); agregado sin datos personales.
- **`reportes.exportar_vencimientos`** — servicio `apps/api/src/modules/reports.ts:305 → app.report_log_export (0014_reports.sql:472) + app.report_expiring`; R3 irreversible / dinero externo; roles por `0014_reports.sql:486 report_log_export role check (+ 0014_reports.sql:227 rpt_guard)`.
  Entrada: query csvOf(ExpiringQuery).
  - `location_id` uuid — sede; omitido = todas las sedes visibles para el rol
  - `days` integer — 1–31; default 7
  - `lang` enum — es\|en; default es (idioma de los encabezados)
  - `envelope` enum — json → responde {filename, csv} en vez de text/csv
  Auditoría: bus `reportes.exportar_vencimientos`; hoy `report.export`. Conocimiento: —. Prueba: `apps/api/test/reports.test.ts`.
  Nota: Esquema construido inline: csvOf(ExpiringQuery) = ExpiringQuery + {lang, envelope}. Audita report.export antes de leer filas. R3: exporta datos personales (nombre del socio).
- **`reportes.exportar_ventas`** — servicio `apps/api/src/modules/reports.ts:359 → app.report_log_export (0014_reports.sql:472) + app.report_sales`; R3 irreversible / dinero externo; roles por `0014_reports.sql:486 report_log_export role check (+ 0014_reports.sql:392 rpt_guard)`.
  Entrada: query csvOf(SalesQuery).
  - `from` date (requerido) — YYYY-MM-DD
  - `to` date (requerido) — YYYY-MM-DD; ≤366 días
  - `location_id` uuid — sede; omitido = todas las sedes visibles para el rol
  - `lang` enum — es\|en; default es (idioma de los encabezados)
  - `envelope` enum — json → responde {filename, csv} en vez de text/csv
  Auditoría: bus `reportes.exportar_ventas`; hoy `report.export`. Conocimiento: —. Prueba: `apps/api/test/reports.test.ts`.
  Nota: Esquema construido inline: csvOf(SalesQuery) = SalesQuery + {lang, envelope}. Audita report.export antes de leer filas. R3 por precaución: incluye el nombre del vendedor (persona del personal); si no se considera dato personal sería R0.
- **`reportes.guardar_municipio_ivu`** — servicio `apps/api/src/modules/reports.ts:408 → INSERT … ON CONFLICT DO UPDATE app.ivu_municipality`; R1 reversible; roles por `0014_reports.sql:530 policy ivu_municipality_insert; :532 ivu_municipality_update`.
  Entrada: body MunicipalityBody.
  - `municipality` string (requerido) — regex ^[A-Za-zÁÉÍÓÚÑÜáéíóúñü][A-Za-zÁÉÍÓÚÑÜáéíóúñü .'-]{1,59}$; único por org sin mayúsculas
  - `suri_status` enum (requerido) — participant\|non_participant
  - `note` string — 1–300, sin caracteres de control
  Auditoría: bus `reportes.guardar_municipio_ivu`; hoy `ivu_municipality.create|ivu_municipality.update`. Conocimiento: reporte. Prueba: `apps/api/test/reports.test.ts`.
  Nota: Upsert: escribe ivu_municipality.create o .update (trigger 0014_reports.sql:509). Decisión fiscal marcada [VERIFICAR · CPA] en el SQL; no está en la lista R2 pero conviene confirmarla antes de ejecutar.
- **`reportes.listar_municipios_ivu`** — servicio `apps/api/src/modules/reports.ts:397 → SELECT app.ivu_municipality`; R0 lectura; roles por `0014_reports.sql:528 policy ivu_municipality_select`.
  Entrada: query LocQuery.
  - `location_id` uuid — sede; omitido = todas las sedes visibles para el rol
  Auditoría: bus `reportes.listar_municipios_ivu`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/reports.test.ts`.
  Nota: Parsea LocQuery pero ignora location_id (la tabla es por organización).
- **`reportes.listar_saldos_vencidos`** — servicio `apps/api/src/modules/reports.ts:189 → app.report_overdue (0014_reports.sql:203)`; R0 lectura; roles por `0014_reports.sql:208 rpt_guard(owner, location_manager, front_desk)`.
  Entrada: query LocQuery.
  - `location_id` uuid — sede; omitido = todas las sedes visibles para el rol
  Auditoría: bus `reportes.listar_saldos_vencidos`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/reports.test.ts`.
  Nota: También en /staff/today. NUEVO: ingresos y cobros pendientes — este reporte solo cubre facturas ya vencidas; no existe un reporte de ingresos por período (facturado vs cobrado vs pendiente no vencido, por plan/método de pago). Lo más cercano: reportes.ver_ejecutivo (caja mensual), /v1/finance/pnl y reportes.ver_ventas.
- **`reportes.listar_vencimientos`** — servicio `apps/api/src/modules/reports.ts:202 → app.report_expiring (0014_reports.sql:222)`; R0 lectura; roles por `0014_reports.sql:227 rpt_guard(owner, location_manager)`.
  Entrada: query ExpiringQuery.
  - `location_id` uuid — sede; omitido = todas las sedes visibles para el rol
  - `days` integer — 1–31 días; default 7
  Auditoría: bus `reportes.listar_vencimientos`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/reports.test.ts`.
- **`reportes.ver_ejecutivo`** — servicio `apps/api/src/modules/reports.ts:425 → app.report_executive (0019_exec_dashboard.sql:120)`; R0 lectura; roles por `0019_exec_dashboard.sql:146 rpt_guard(owner, location_manager)`.
  Entrada: query LocQuery.
  - `location_id` uuid — sede; omitido = todas las sedes visibles para el rol
  Auditoría: bus `reportes.ver_ejecutivo`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/exec.test.ts`.
  Nota: Ingresos = caja cobrada (no devengado) [VERIFICAR · CPA en el SQL]. NUEVO: rendimiento por instructor — no existe reporte por instructor (clases dadas, asistencia/ocupación, no-shows, ventas o PT); app.class_session.instructor_id existe pero ningún read model lo agrega.
- **`reportes.ver_horas_pico`** — servicio `apps/api/src/modules/reports.ts:213 → app.report_heatmap (0014_reports.sql:259)`; R0 lectura; roles por `0014_reports.sql:263 rpt_guard(owner, location_manager)`.
  Entrada: query HeatmapQuery.
  - `location_id` uuid — sede; omitido = todas las sedes visibles para el rol
  - `weeks` enum — '4'\|'8' semanas; default 4
  Auditoría: bus `reportes.ver_horas_pico`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/reports.test.ts`.
  Nota: Cuenta entradas (check-ins), no asistencia a clases. NUEVO: asistencia por clase y franja — no existe reporte de asistencia (attended/no_show/cancelaciones) por tipo de clase, sesión y franja horaria en un rango de fechas; los datos existen (app.booking con /v1/schedule/bookings/:id/attendance).
- **`reportes.ver_hoy`** — servicio `apps/api/src/modules/reports.ts:171 → app.report_today (0014_reports.sql:283)`; R0 lectura; roles por `0014_reports.sql:289 rpt_guard(owner, location_manager, front_desk)`.
  Entrada: query LocQuery.
  - `location_id` uuid — sede; omitido = todas las sedes visibles para el rol
  Auditoría: bus `reportes.ver_hoy`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/reports.test.ts`.
  Nota: Sin cifras de ingresos (diseño para recepción).
- **`reportes.ver_ivu`** — servicio `apps/api/src/modules/reports.ts:233 → app.report_ivu (0014_reports.sql:327)`; R0 lectura; roles por `0014_reports.sql:335 rpt_guard(owner, location_manager, accountant)`.
  Entrada: query IvuQuery.
  - `month` string (requerido) — YYYY-MM (regex ^\d{4}-(0[1-9]\|1[0-2])$)
  - `location_id` uuid — sede; omitido = todas las sedes visibles para el rol
  Auditoría: bus `reportes.ver_ivu`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/reports.test.ts`.
  Nota: Cifras en centavos. El propio SQL marca [VERIFICAR · CPA] el tratamiento de devoluciones y el redondeo.
- **`reportes.ver_panel`** — servicio `apps/api/src/modules/reports.ts:161 → app.report_dashboard (0014_reports.sql:64)`; R0 lectura; roles por `0014_reports.sql:70 rpt_guard(owner, location_manager)`.
  Entrada: query LocQuery.
  - `location_id` uuid — sede; omitido = todas las sedes visibles para el rol
  Auditoría: bus `reportes.ver_panel`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/reports.test.ts`.
  Nota: points_liability solo para owner. NUEVO: ocupación histórica — hoy solo hay ocupación de clases de la semana en curso (class_occupancy_pct) y uso de equipos de hoy (equipos.ver_uso_en_vivo); falta ocupación por clase/sala/franja horaria y por equipo en un rango de fechas.
- **`reportes.ver_socios`** — servicio `apps/api/src/modules/reports.ts:271 → app.report_member_status (0014_reports.sql:428) + app.report_member_flow (0014_reports.sql:442)`; R0 lectura; roles por `0014_reports.sql:432 y :446 rpt_guard(owner, location_manager)`.
  Entrada: query MembersQuery.
  - `location_id` uuid — sede; omitido = todas las sedes visibles para el rol
  - `months` integer — 1–24 meses; default 12
  Auditoría: bus `reportes.ver_socios`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/reports.test.ts`.
  Nota: NUEVO: retención y bajas — solo hay conteos mensuales de altas/bajas y la tasa de renovación del ejecutivo; falta retención por cohorte, tasa de bajas (churn) y motivos de baja [VERIFICAR: no se encontró columna de motivo de cancelación en app.subscription].
- **`reportes.ver_ventas`** — servicio `apps/api/src/modules/reports.ts:251 → app.report_sales (0014_reports.sql:386)`; R0 lectura; roles por `0014_reports.sql:392 rpt_guard(owner, location_manager, accountant)`.
  Entrada: query SalesQuery.
  - `from` date (requerido) — YYYY-MM-DD (z.string().date())
  - `to` date (requerido) — YYYY-MM-DD; from ≤ to y rango ≤ 366 días (SQL 0014_reports.sql:393)
  - `location_id` uuid — sede; omitido = todas las sedes visibles para el rol
  Auditoría: bus `reportes.ver_ventas`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/reports.test.ts`.
  Nota: NUEVO: ventas e inventario — no hay reporte que una ventas con existencias (rotación, valor de inventario, quiebres, margen); hay listados operativos /v1/store/inventory y /v1/store/movements y el conteo low_stock_products del panel.

</details>

### retos (10)

| Acción | Qué hace | Cómo lo diría el dueño | Ruta | Riesgo | Roles | Pantalla | Copiloto |
|---|---|---|---|---|---|---|---|
| `retos.cambiar_preferencias` | Cambia si un participante aparece en la tabla de posiciones y si se compara solo consigo mismo o en ranking. | «Saca a Juan de la tabla pública del reto»<br>«Ponle a María modo ranking en el reto de verano» | `PUT /v1/engagement/challenges/:id/preferences` | R1 | owner, location_manager, front_desk, member | `/me/challenges` | sí |
| `retos.crear_equipo` | Crea un equipo dentro de un reto por equipos. | «Añade el equipo 'Los Coquíes' al reto de verano»<br>«Crea dos equipos, Azul y Rojo, en el reto de diciembre» | `POST /v1/engagement/challenges/:id/teams` | R1 | owner, location_manager | `/staff/engagement/challenges` | sí |
| `retos.crear_reto` | Crea un reto con su tipo, métrica (visitas, clases o puntos), meta y fechas, para toda la organización o una sede. | «Crea un reto de 20 visitas en noviembre para todos»<br>«Monta un reto por equipos de clases en Bayamón del 1 al 31 de diciembre con meta de 12» | `POST /v1/engagement/challenges` | R1 | owner, location_manager | `/staff/engagement/challenges` | sí |
| `retos.inscribir_socio` | Inscribe a un socio en un reto (con equipo si es por equipos) y calcula su progreso inicial. | «Apunta a Juan Pérez al reto de verano»<br>«Mete a María López en el equipo Azul del reto de diciembre» | `POST /v1/engagement/challenges/:id/join` | R1 | owner, location_manager, front_desk, member | `/staff/engagement/challenges` | sí |
| `retos.listar_equipos` | Lista los equipos de un reto por equipos. | «¿Qué equipos tiene el reto de octubre?»<br>«Enséñame los equipos del reto de pasos» | `GET /v1/engagement/challenges/:id/teams` | R0 | owner, location_manager, front_desk, trainer, member, guardian | `/staff/engagement/challenges` | sí |
| `retos.listar_participantes` | Lista los participantes de un reto con su equipo, progreso, si aparecen en la tabla y si llegaron a la meta. | «¿Quién va ganando en el reto de verano?»<br>«¿Cuántos se han apuntado al reto de noviembre?» | `GET /v1/engagement/challenges/:id/participants` | R0 | owner, location_manager, front_desk, member, guardian | `/staff/engagement/challenges` | sí |
| `retos.listar_retos` | Lista los retos (individuales, por equipos o por sede) con su métrica, meta y fechas. | «¿Qué retos tenemos activos?»<br>«¿Cuándo termina el reto de verano?» | `GET /v1/engagement/challenges` | R0 | owner, location_manager, front_desk, trainer, member, guardian | `/staff/engagement/challenges` | sí |
| `retos.reemplazar_beneficios` | Reemplaza la lista completa de beneficios de un reto (hasta 8 textos cortos). | «Ponle al reto de verano: entrenamiento guiado, camiseta y evaluación final»<br>«Quítale todos los beneficios al reto de noviembre» | `PUT /v1/portal/challenges/:id/perks` | R1 | owner, location_manager | — | sí |
| `retos.ver_beneficios` | Lista los beneficios que incluye un reto (lo que se muestra al socio en su panel). | «¿Qué premios tiene el reto de noviembre?»<br>«Muéstrame los beneficios del reto» | `GET /v1/portal/challenges/:id/perks` | R0 | owner, location_manager, front_desk, trainer, member, guardian | — | sí |
| `retos.ver_tabla_posiciones` | Muestra la tabla de posiciones de un reto (por persona, equipo o sede) solo con quienes aceptaron aparecer. | «¿Cómo va la tabla del reto de verano?»<br>«¿Qué equipo va primero?» | `GET /v1/engagement/challenges/:id/leaderboard` | R0 | owner, location_manager, front_desk, trainer, member, guardian | `/staff/engagement/challenges` | sí |

<details><summary>Campos, servicio, auditoría, conocimiento y prueba</summary>

- **`retos.cambiar_preferencias`** — servicio `apps/api/src/modules/engagement.ts:455 → app.set_challenge_preferences()`; R1 reversible; roles por `packages/db/migrations/0012_engagement.sql:550 set_challenge_preferences (eng_is_self OR eng_front_staff_for)`.
  Entrada: params IdParams, body PrefsBody.
  - `member_id` uuid (requerido) — participante
  - `show_on_leaderboard` boolean (requerido) — menores no pueden true
  - `compare_mode` enum (requerido) — modo
  Auditoría: bus `retos.cambiar_preferencias`; hoy `challenge.preferences`. Conocimiento: socio. Prueba: `apps/api/test/engagement.test.ts`.
  Nota: Es una preferencia de privacidad del socio; el personal puede cambiarla 'en su nombre' pero el copiloto debería hacerlo solo a pedido del socio. 409 not_participant.
- **`retos.crear_equipo`** — servicio `apps/api/src/modules/engagement.ts:415 → INSERT app.challenge_team (trigger eng_config_audit)`; R1 reversible; roles por `packages/db/migrations/0012_engagement.sql:892 policy challenge_team_insert (reto kind=team; location_manager solo su sede)`.
  Entrada: params IdParams, body TeamBody.
  - `name` string (requerido) — trim, 2–40, regex ^[A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9 &'.-]+$; único por reto sin distinguir mayúsculas
  Auditoría: bus `retos.crear_equipo`; hoy `challenge_team.insert`. Conocimiento: sistema. Prueba: `apps/api/test/route-gaps.test.ts`.
  Nota: Sin prueba HTTP. No hay ruta para renombrar/borrar equipos.
- **`retos.crear_reto`** — servicio `apps/api/src/modules/engagement.ts:383 → INSERT app.challenge (trigger eng_config_audit)`; R1 reversible; roles por `packages/db/migrations/0012_engagement.sql:877 policy challenge_insert (owner; location_manager solo su sede)`.
  Entrada: body ChallengeBody.
  - `name` string (requerido) — trim, 2–80, regex ^[A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9 &'.,()%+-]+$
  - `kind` enum (requerido) — tipo; 'location' exige location_id null (CHECK)
  - `metric` enum (requerido) — métrica
  - `location_id` uuid|null — null = toda la organización (solo owner); location_manager debe poner una sede suya
  - `starts_on` string(date) (requerido) — YYYY-MM-DD
  - `ends_on` string(date) (requerido) — YYYY-MM-DD; ≥ starts_on y ≤ 366 días (CHECK)
  - `goal` integer (requerido) — 1–100000
  - `leaderboard_opt_in_default` boolean — aparecer en la tabla por defecto
  Auditoría: bus `retos.crear_reto`; hoy `challenge.insert`. Conocimiento: sistema. Prueba: `apps/api/test/engagement.test.ts`.
  Nota: NUEVO: no hay ruta para editar/cerrar un reto aunque existe la policy challenge_update (0012:881). Un location_manager no puede crear retos 'location' (requieren location_id null). Premios en efectivo/rifas no implementados (pendiente de revisión legal según 0012:8).
- **`retos.inscribir_socio`** — servicio `apps/api/src/modules/engagement.ts:441 → app.join_challenge()`; R1 reversible; roles por `packages/db/migrations/0012_engagement.sql:508 join_challenge (eng_is_self OR eng_front_staff_for)`.
  Entrada: params IdParams, body JoinBody.
  - `member_id` uuid (requerido) — socio de la sede del reto (forbidden_location)
  - `team_id` uuid|null — obligatorio si y solo si el reto es por equipos (invalid_team)
  - `show_on_leaderboard` boolean — por defecto el del reto; menores siempre false (minor_not_listed)
  Auditoría: bus `retos.inscribir_socio`; hoy `challenge.join`. Conocimiento: socio. Prueba: `apps/api/test/engagement.test.ts`.
  Nota: 409 challenge_closed. No hay ruta para salir/quitar a alguien de un reto. La web solo lo ofrece al socio (/me/challenges).
- **`retos.listar_equipos`** — servicio `apps/api/src/modules/engagement.ts:404 → SELECT app.challenge_team`; R0 lectura; roles por `packages/db/migrations/0012_engagement.sql:890 policy challenge_team_select (visibilidad del reto)`.
  Entrada: params IdParams.
  Auditoría: bus `retos.listar_equipos`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/route-gaps.test.ts`.
  Nota: Sin prueba HTTP (la BD se prueba en packages/db/test/engagement.test.ts).
- **`retos.listar_participantes`** — servicio `apps/api/src/modules/engagement.ts:427 → SELECT app.challenge_participant`; R0 lectura; roles por `packages/db/migrations/0012_engagement.sql:863 policy participant_select (eng_can_view)`.
  Entrada: params IdParams.
  Auditoría: bus `retos.listar_participantes`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/engagement.test.ts`.
  Nota: Muestra nombres completos (incluye socios que NO optaron por la tabla). El trainer ve la pantalla pero RLS le devuelve vacío.
- **`retos.listar_retos`** — servicio `apps/api/src/modules/engagement.ts:376 → SELECT app.challenge`; R0 lectura; roles por `packages/db/migrations/0012_engagement.sql:872 policy challenge_select`.
  Entrada: ninguna.
  Auditoría: bus `retos.listar_retos`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/route-gaps.test.ts`.
  Nota: Sin filtro por estado (activos/terminados) y sin prueba HTTP (solo mock en apps/web/test/modules/engagement.test.tsx).
- **`retos.reemplazar_beneficios`** — servicio `apps/api/src/modules/portal.ts:604 → DELETE + INSERT app.challenge_perk`; R1 reversible; roles por `packages/db/migrations/0021_portal.sql:128 policy challenge_perk_insert / :136 challenge_perk_delete (owner; location_manager solo retos de su sede, nunca org-wide)`.
  Entrada: params IdParams, body PerksBody.
  - `perks` array<string> (requerido) — 0–8 textos; cada uno trim 2–80, sin \r\n<>{}; la BD rechaza enlaces/teléfonos/promesas de salud (has_forbidden_terms); el orden fija position 1..n
  Auditoría: bus `retos.reemplazar_beneficios`; hoy **sin auditoría**. Conocimiento: sistema. Prueba: `apps/api/test/portal.test.ts`.
  Nota: NUEVO: no deja auditoría (ni trigger ni app.audit) y no hay pantalla de personal para editarlo. Reemplazo total: lista vacía borra todo. Texto visible a todos los socios.
- **`retos.ver_beneficios`** — servicio `apps/api/src/modules/portal.ts:593 → SELECT app.challenge_perk`; R0 lectura; roles por `packages/db/migrations/0021_portal.sql:124 policy challenge_perk_select (misma visibilidad que el reto, packages/db/migrations/0012_engagement.sql:872)`.
  Entrada: params IdParams.
  Auditoría: bus `retos.ver_beneficios`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/portal.test.ts`.
  Nota: No hay pantalla de personal que la use; los beneficios se ven en /me/home (tarjeta del reto destacado).
- **`retos.ver_tabla_posiciones`** — servicio `apps/api/src/modules/engagement.ts:475 → app.leaderboard()`; R0 lectura; roles por `packages/db/migrations/0012_engagement.sql:580-582 leaderboard (role IN owner, location_manager, front_desk, trainer, member, guardian)`.
  Entrada: params IdParams.
  Auditoría: bus `retos.ver_tabla_posiciones`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/engagement.test.ts`.
  Nota: Etiquetas abreviadas (app.eng_label), no nombres completos.

</details>

### sala (15)

| Acción | Qué hace | Cómo lo diría el dueño | Ruta | Riesgo | Roles | Pantalla | Copiloto |
|---|---|---|---|---|---|---|---|
| `sala.crear_circuito` | Crea un circuito (rutina) vacío en una sede. | «Crea un circuito que se llame Piernas Express en Caguas»<br>«Haz una rutina nueva Full Body para la sede principal» | `POST /v1/floor/circuits` | R1 | owner, location_manager, trainer | `/staff/floor/circuits` | sí |
| `sala.crear_ejercicio` | Añade un ejercicio a la biblioteca con su patrón de movimiento, equipo y claves de técnica. | «Añade el ejercicio peso muerto rumano, patrón bisagra, con barra»<br>«Crea 'remo con mancuerna' para tirón horizontal» | `POST /v1/floor/exercises` | R1 | owner, location_manager, trainer | `/staff/floor/exercises` | sí |
| `sala.definir_pasos_circuito` | Reemplaza todos los pasos de un circuito por la lista ordenada dada. | «Ponle al circuito Full Body: sentadilla 4 por 10, press de banca 3 por 8 y remo 3 por 12»<br>«Añade un minuto de descanso entre ejercicios en la rutina de piernas» | `PUT /v1/floor/circuits/:id/steps` | R1 | owner, location_manager, trainer | `/staff/floor/circuits` | sí |
| `sala.editar_circuito` | Renombra un circuito o lo activa/desactiva. | «Desactiva el circuito Verano 2025»<br>«Cámbiale el nombre a la rutina de piernas a Piernas Pro» | `PATCH /v1/floor/circuits/:id` | R2 | owner, location_manager, trainer | `/staff/floor/circuits` | sí |
| `sala.editar_ejercicio` | Edita un ejercicio de la biblioteca o lo activa/desactiva. | «Desactiva el ejercicio press militar»<br>«Cambia las claves de técnica de la sentadilla goblet» | `PATCH /v1/floor/exercises/:id` | R2 | owner, location_manager, trainer | `/staff/floor/exercises` | sí |
| `sala.iniciar_rutina` | El socio empieza (o retoma) un circuito; cierra cualquier otra rutina abierta. | — | `POST /v1/floor/circuits/:id/runs` | R1 | member | `/me/circuits` | no |
| `sala.listar_circuitos` | Lista los circuitos (rutinas) por sede con su número de pasos. | «¿Qué circuitos tenemos en Bayamón?»<br>«Enséñame las rutinas activas» | `GET /v1/floor/circuits` | R0 | owner, location_manager, front_desk, trainer, nutritionist, chef, clinician, accountant, member, guardian | `/staff/floor/circuits` | sí |
| `sala.listar_ejercicios` | Lista la biblioteca de ejercicios de la organización con su patrón de movimiento y equipo. | «¿Qué ejercicios de sentadilla tenemos en la biblioteca?»<br>«Enséñame los ejercicios que se hacen con mancuernas» | `GET /v1/floor/exercises` | R0 | owner, location_manager, front_desk, trainer, nutritionist, chef, clinician, accountant, member, guardian | `/staff/floor/exercises` | sí |
| `sala.listar_rutinas_hechas` | Lista las últimas 50 rutinas iniciadas que el usuario puede ver, con su circuito y horas. | «¿Quién ha hecho circuitos hoy?»<br>«Enséñame las últimas rutinas que hicieron los socios» | `GET /v1/floor/runs` | R0 | owner, location_manager, trainer, member, guardian | — | sí |
| `sala.listar_series` | Lista las series registradas, propias del socio o de un socio dado si lo pide un entrenador. | «¿Qué series registró María esta semana?»<br>«¿Cuánto peso está levantando Juan en sentadilla?» | `GET /v1/floor/sets` | R0 | owner, location_manager, trainer, member, guardian | `/me/circuits` | sí |
| `sala.registrar_serie` | El socio registra una serie (repeticiones y peso) de un ejercicio, opcionalmente en un equipo y dentro de su rutina. | — | `POST /v1/floor/sets` | R1 | member | `/me/circuits` | no |
| `sala.sugerir_sustitutos` | Sugiere ejercicios sustitutos del mismo patrón con equipo disponible en la sede. | — | `GET /v1/floor/substitutes` | R0 | member, guardian | `/me/circuits` | no |
| `sala.terminar_rutina` | El socio da por terminada su rutina en curso. | — | `POST /v1/floor/runs/:id/finish` | R1 | member | `/me/circuits` | no |
| `sala.ver_circuito` | Muestra un circuito con sus pasos ordenados: ejercicio, estación, series, repeticiones y descanso. | «Enséñame los pasos del circuito Full Body»<br>«¿Qué lleva la rutina de piernas?» | `GET /v1/floor/circuits/:id` | R0 | owner, location_manager, front_desk, trainer, nutritionist, chef, clinician, accountant, member, guardian | `/staff/floor/circuits` | sí |
| `sala.ver_entrenamiento_socio` | Muestra el progreso de rutinas y el uso de equipos de un socio (últimas 10 rutinas, 20 usos y equipos más usados en 30 días). | «¿Cómo va Pedro con su rutina?»<br>«¿Qué máquinas usa más Ana?»<br>«¿Cuándo fue la última vez que entrenó Luis en sala?» | `GET /v1/floor/training` | R0 | owner, location_manager, trainer, member | `/staff/members/:id` | sí |

<details><summary>Campos, servicio, auditoría, conocimiento y prueba</summary>

- **`sala.crear_circuito`** — servicio `apps/api/src/modules/floor.ts:394 → INSERT app.circuit`; R1 reversible; roles por `0011_floor.sql:203 policy circuit_insert`.
  Entrada: body NewCircuit.
  - `location_id` uuid (requerido) — sede
  - `name` string (requerido) — FLOOR_SAFE_NAME 2–80
  - `active` boolean — default true
  Auditoría: bus `sala.crear_circuito`; hoy **sin auditoría**. Conocimiento: sistema. Prueba: `apps/api/test/floor.test.ts`.
  Nota: No audita. Los pasos se definen después con sala.definir_pasos_circuito.
- **`sala.crear_ejercicio`** — servicio `apps/api/src/modules/floor.ts:312 → INSERT app.exercise`; R1 reversible; roles por `0011_floor.sql:192 policy exercise_insert`.
  Entrada: body NewExercise.
  - `name` string (requerido) — FLOOR_SAFE_NAME ^[A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9 &'().,/+-]{2,80}$; único por org
  - `movement_pattern` enum (requerido) — squat\|hinge\|push_horizontal\|push_vertical\|pull_horizontal\|pull_vertical\|lunge\|carry\|core\|cardio
  - `equipment_type` enum (requerido) — barbell\|dumbbell\|kettlebell\|cable\|leg_press\|chest_press\|lat_pulldown\|row_machine\|treadmill\|bike\|rower\|bench\|rack\|smith\|bodyweight_station\|other\|none (none = sin equipo)
  - `cues` string — ≤1000, saltos de línea permitidos, sin <>{}; default ''; solo técnica, sin afirmaciones de salud
  - `active` boolean — default true
  Auditoría: bus `sala.crear_ejercicio`; hoy **sin auditoría**. Conocimiento: sistema. Prueba: `apps/api/test/floor.test.ts`.
  Nota: No audita.
- **`sala.definir_pasos_circuito`** — servicio `apps/api/src/modules/floor.ts:423 → DELETE + INSERT app.circuit_step (SELECT … FOR UPDATE app.circuit)`; R1 reversible; roles por `0011_floor.sql:217 policy circuit_step_insert; :221 circuit_step_delete; :207 circuit_update (FOR UPDATE)`.
  Entrada: params IdParams, body StepsBody.
  - `steps` array (requerido) — array ≤50 de {exercise_id uuid req; asset_id uuid\|null XOR equipment_type enum(barbell\|dumbbell\|kettlebell\|cable\|leg_press\|chest_press\|lat_pulldown\|row_machine\|treadmill\|bike\|rower\|bench\|rack\|smith\|bodyweight_station\|other\|none)\|null; sets int 1–20 req; reps int 1–100 req; rest_seconds int 0–900 segundos default 60}; reemplaza todos los pasos
  Auditoría: bus `sala.definir_pasos_circuito`; hoy **sin auditoría**. Conocimiento: sistema. Prueba: `apps/api/test/floor.test.ts`.
  Nota: Reemplazo total (borra los pasos previos); el copiloto debe leer sala.ver_circuito y reenviar la lista completa. No audita.
- **`sala.editar_circuito`** — servicio `apps/api/src/modules/floor.ts:406 → UPDATE app.circuit`; R2 sensible; roles por `0011_floor.sql:207 policy circuit_update`.
  Entrada: params IdParams, body CircuitPatch.
  - `name` string — FLOOR_SAFE_NAME 2–80
  - `active` boolean — false = desactivar (los socios dejan de verlo)
  Auditoría: bus `sala.editar_circuito`; hoy **sin auditoría**. Conocimiento: sistema. Prueba: `apps/api/test/route-gaps.test.ts`.
  Nota: R2 por la regla 'desactivar' (setCircuitActive es el uso de la web); renombrar sería R1. No audita. Sin prueba HTTP de esta URL.
- **`sala.editar_ejercicio`** — servicio `apps/api/src/modules/floor.ts:325 → UPDATE app.exercise`; R2 sensible; roles por `0011_floor.sql:194 policy exercise_update`.
  Entrada: params IdParams, body ExercisePatch.
  - `name` string — FLOOR_SAFE_NAME 2–80
  - `movement_pattern` enum — squat\|hinge\|push_horizontal\|push_vertical\|pull_horizontal\|pull_vertical\|lunge\|carry\|core\|cardio
  - `equipment_type` enum — barbell\|dumbbell\|kettlebell\|cable\|leg_press\|chest_press\|lat_pulldown\|row_machine\|treadmill\|bike\|rower\|bench\|rack\|smith\|bodyweight_station\|other\|none
  - `cues` string — ≤1000, sin <>{}
  - `active` boolean — false = desactivar
  Auditoría: bus `sala.editar_ejercicio`; hoy **sin auditoría**. Conocimiento: sistema. Prueba: `apps/api/test/route-gaps.test.ts`.
  Nota: R2 por la regla 'desactivar' (active=false es el uso principal en la web, setExerciseActive); renombrar o editar claves sería R1. Al menos un campo. No audita. Sin prueba HTTP de esta URL.
- **`sala.iniciar_rutina`** — servicio `apps/api/src/modules/floor.ts:459 → app.start_circuit_run (0011_floor.sql:412)`; R1 reversible; roles por `0011_floor.sql:420 start_circuit_run (app.floor_my_member_id :290 exige role member)`.
  Entrada: params IdParams.
  Auditoría: bus `sala.iniciar_rutina`; hoy **sin auditoría**. Conocimiento: socio. Prueba: `apps/api/test/floor.test.ts`.
  Nota: Solo socio (guardian y personal → 42501). También en apps/api/test/equipment.test.ts.
- **`sala.listar_circuitos`** — servicio `apps/api/src/modules/floor.ts:354 → SELECT app.circuit (+ conteo app.circuit_step)`; R0 lectura; roles por `0011_floor.sql:199 policy circuit_select (personal de su sede; member/guardian solo activos)`.
  Entrada: query CircuitQuery.
  - `location_id` uuid — sede; omitido = todas las sedes visibles para el rol
  Auditoría: bus `sala.listar_circuitos`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/floor.test.ts`.
  Nota: Límite 200.
- **`sala.listar_ejercicios`** — servicio `apps/api/src/modules/floor.ts:302 → SELECT app.exercise`; R0 lectura; roles por `0011_floor.sql:191 policy exercise_select (toda la org)`.
  Entrada: ninguna.
  Auditoría: bus `sala.listar_ejercicios`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/floor.test.ts`.
  Nota: Sin filtros en la API (límite 500); el filtrado por patrón/equipo lo tendría que hacer el copiloto.
- **`sala.listar_rutinas_hechas`** — servicio `apps/api/src/modules/floor.ts:481 → SELECT app.circuit_run JOIN app.circuit`; R0 lectura; roles por `0011_floor.sql:229 policy circuit_run_select`.
  Entrada: ninguna.
  Auditoría: bus `sala.listar_rutinas_hechas`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/route-gaps.test.ts`.
  Nota: [VERIFICAR] ui: ningún cliente web llama esta URL y no hay prueba HTTP. Sin filtros (ni sede, ni socio, ni fecha), fijo LIMIT 50; para el copiloto sirve mejor equipos.ver_uso_en_vivo o sala.ver_entrenamiento_socio.
- **`sala.listar_series`** — servicio `apps/api/src/modules/floor.ts:511 → SELECT app.set_log JOIN app.exercise`; R0 lectura; roles por `0011_floor.sql:237 policy set_log_select`.
  Entrada: query SetQuery.
  - `member_id` uuid — filtra por socio; omitido = todo lo visible
  - `limit` integer — 1–200; default 50
  Auditoría: bus `sala.listar_series`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/floor.test.ts`.
  Nota: En la web solo la usa el socio (mySets); el personal de coaching la puede leer por RLS (prueba con member_id). Sin filtro de fechas.
- **`sala.registrar_serie`** — servicio `apps/api/src/modules/floor.ts:492 → app.log_set (reemplazada en 0029_equipment_use.sql:171)`; R1 reversible; roles por `0029_equipment_use.sql:179 log_set (floor_my_member_id) — antes 0011_floor.sql:457`.
  Entrada: body SetBody.
  - `exercise_id` uuid (requerido) — ejercicio
  - `location_id` uuid (requerido) — sede
  - `asset_id` uuid — equipo de esa sede; mantiene vivo el uso abierto (0029)
  - `circuit_run_id` uuid — rutina abierta del mismo socio y sede
  - `reps` integer (requerido) — 0–1000
  - `weight_kg` number (requerido) — 0–1000 kg, múltiplo de 0.01
  Auditoría: bus `sala.registrar_serie`; hoy **sin auditoría**. Conocimiento: socio. Prueba: `apps/api/test/floor.test.ts`.
  Nota: Solo socio (trainer → 403 en la prueba). También en apps/api/test/equipment.test.ts; la web también la llama desde /s/:code.
- **`sala.sugerir_sustitutos`** — servicio `apps/api/src/modules/floor.ts:341 → app.substitute_exercise (0011_floor.sql:479, SECURITY INVOKER)`; R0 lectura; roles por `0011_floor.sql:479 substitute_exercise invoker (RLS asset_select :167 + exercise_select :191)`.
  Entrada: query SubstituteQuery.
  - `exercise_id` uuid (requerido) — ejercicio original
  - `location_id` uuid (requerido) — sede
  - `exclude_asset_id` uuid — equipo ocupado/dañado a excluir
  Auditoría: bus `sala.sugerir_sustitutos`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/floor.test.ts`.
  Nota: Función invoker: el personal también puede llamarla (RLS lo permite), pero la web solo la usa en la pantalla del socio.
- **`sala.terminar_rutina`** — servicio `apps/api/src/modules/floor.ts:470 → app.finish_circuit_run (0011_floor.sql:433)`; R1 reversible; roles por `0011_floor.sql:439 finish_circuit_run (floor_my_member_id)`.
  Entrada: params IdParams.
  Auditoría: bus `sala.terminar_rutina`; hoy **sin auditoría**. Conocimiento: socio. Prueba: `apps/api/test/floor.test.ts`.
  Nota: Solo socio.
- **`sala.ver_circuito`** — servicio `apps/api/src/modules/floor.ts:369 → SELECT app.circuit + app.circuit_step JOIN app.exercise/app.asset`; R0 lectura; roles por `0011_floor.sql:199 policy circuit_select; :214 circuit_step_select`.
  Entrada: params IdParams.
  Auditoría: bus `sala.ver_circuito`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/floor.test.ts`.
  Nota: Lo usan tanto /staff/floor/circuits como /me/circuits.
- **`sala.ver_entrenamiento_socio`** — servicio `apps/api/src/modules/equipment.ts:307 → SELECT app.circuit_run, app.circuit_step, app.set_log, app.equipment_use`; R0 lectura; roles por `apps/api/src/modules/equipment.ts:310 chequeo de rol (member_id → COACHES; sin member_id → member) + RLS 0029_equipment_use.sql:87, 0011_floor.sql:229`.
  Entrada: query TrainingQuery.
  - `member_id` uuid — obligatorio para personal (coach); omitido = el propio socio
  Auditoría: bus `sala.ver_entrenamiento_socio`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/equipment.test.ts`.
  Nota: Pestaña 'training' del perfil del socio (memberTabs) y /me/station para el propio socio.

</details>

### salud (17)

| Acción | Qué hace | Cómo lo diría el dueño | Ruta | Riesgo | Roles | Pantalla | Copiloto |
|---|---|---|---|---|---|---|---|
| `salud.aprobar_plan` | Aprueba un plan en revisión: entrenamiento por trainer o gerente; nutrición solo por nutricionista con licencia verificada; tratamiento solo por clínico con licencia verificada. | «Aprueba el plan de entrenamiento de Pedro»<br>«Aprueba el plan de nutrición de Carmen, ya vi la referencia médica» | `POST /v1/health/plans/:id/approve` | R2 | trainer, location_manager, nutritionist, clinician | `/staff/health/plans` | no |
| `salud.archivar_plan` | Archiva un plan aprobado o publicado (deja de estar vigente). | «Archiva el plan viejo de Pedro»<br>«Retira el plan de nutrición publicado de Carmen» | `POST /v1/health/plans/:id/archive` | R2 | owner, location_manager, trainer, nutritionist, clinician | `/staff/health/plans` | sí |
| `salud.consultar_mi_perfil_clinico` | Devuelve el rol del usuario, su ficha de personal y si su licencia profesional está verificada (decide qué botones de salud se ofrecen). | «¿Tengo permisos para firmar evaluaciones?»<br>«¿Qué rol de salud tengo yo?» | `GET /v1/health/whoami` | R0 | owner, location_manager, front_desk, trainer, nutritionist, chef, clinician, accountant, member, guardian | `/staff/health/assessments` | sí |
| `salud.crear_evaluacion` | Crea un borrador de evaluación de salud de un socio (PAR-Q, condiciones, signos vitales, medidas y pruebas físicas). | «Registra la evaluación de Luis Torres: presión 120 sobre 80, pulso 70, peso 82 kilos»<br>«Empieza una evaluación PAR-Q para Ana Colón, todo negativo» | `POST /v1/health/assessments` | R2 | owner, location_manager, trainer, nutritionist, clinician | `/staff/health/assessments` | sí |
| `salud.crear_plan` | Crea el borrador (versión 1) de un plan de cuidado de entrenamiento, nutrición o tratamiento para un socio. | «Crea un borrador de plan de entrenamiento para Pedro con tres días de fuerza»<br>«Empieza un plan de nutrición para Carmen» | `POST /v1/health/plans` | R2 | trainer, location_manager, nutritionist, clinician | `/staff/health/plans` | no |
| `salud.devolver_plan` | Devuelve a borrador un plan que estaba en revisión para corregirlo. | «Devuelve el plan de Pedro a borrador»<br>«Regresa el plan de nutrición de Carmen para corrección» | `POST /v1/health/plans/:id/return` | R2 | trainer, location_manager, nutritionist, clinician | `/staff/health/plans` | no |
| `salud.editar_evaluacion` | Corrige campos de una evaluación de salud que sigue en borrador. | «Corrige el peso de la evaluación de Luis a 80 kilos»<br>«Marca que el seguimiento del PAR-Q de Ana quedó resuelto» | `PATCH /v1/health/assessments/:id` | R2 | owner, location_manager, trainer, nutritionist, clinician | `/staff/health/assessments` | sí |
| `salud.editar_plan` | Edita título, contenido o justificación de un plan de cuidado que sigue en borrador. | «Cambia el título del plan de Pedro a 'Fuerza fase 2'»<br>«Añade una sección de movilidad al borrador de Carmen» | `PATCH /v1/health/plans/:id` | R2 | trainer, location_manager, nutritionist, clinician | `/staff/health/plans` | no |
| `salud.enviar_plan_revision` | Envía un plan en borrador a revisión para su aprobación. | «Manda a revisión el plan de entrenamiento de Pedro»<br>«Envía el borrador de Carmen para que lo aprueben» | `POST /v1/health/plans/:id/submit` | R2 | trainer, location_manager, nutritionist, clinician | `/staff/health/plans` | no |
| `salud.firmar_evaluacion` | Firma una evaluación en borrador: la vuelve inmutable y calcula y guarda su triaje. | «Firma la evaluación de Luis Torres»<br>«Cierra y firma la evaluación de Ana para que salga el triaje» | `POST /v1/health/assessments/:id/sign` | R2 | owner, location_manager, trainer, nutritionist, clinician | `/staff/health/assessments` | sí |
| `salud.listar_evaluaciones` | Lista hasta 200 evaluaciones de salud (PAR-Q, condiciones, signos vitales, medidas, pruebas físicas y triaje) visibles para el usuario, opcionalmente de un socio. | «Enséñame las evaluaciones de salud de María Rivera»<br>«¿Qué evaluaciones se han hecho esta semana?»<br>«¿Cuáles evaluaciones están en borrador sin firmar?» | `GET /v1/health/assessments` | R0 | owner, location_manager, trainer, nutritionist, clinician, member, guardian | `/staff/health/assessments` | sí |
| `salud.listar_planes` | Lista hasta 300 planes de cuidado (entrenamiento, nutrición, tratamiento) con su versión, estado y aprobador, filtrables por socio, tipo y estado. | «¿Qué planes de nutrición están esperando aprobación?»<br>«Enséñame los planes de entrenamiento de Pedro»<br>«¿Cuántos planes aprobados faltan por publicar?» | `GET /v1/health/plans` | R0 | owner, location_manager, trainer, nutritionist, clinician, member, guardian | `/staff/health/plans` | sí |
| `salud.nueva_version_plan` | Crea una nueva versión en borrador copiando un plan aprobado, publicado o archivado (los aprobados son inmutables). | «Haz una nueva versión del plan de Pedro para ajustarlo»<br>«Abre la versión 2 del plan de nutrición de Carmen» | `POST /v1/health/plans/:id/new-version` | R2 | trainer, location_manager, nutritionist, clinician | `/staff/health/plans` | no |
| `salud.previsualizar_triaje` | Calcula sin guardar el triaje (verde/ámbar/rojo de ejercicio y nutrición, derivación médica, emergencia) a partir de PAR-Q, condiciones declaradas y síntomas. | «¿Qué triaje le saldría a un socio con diabetes y PAR-Q positivo?»<br>«Previsualiza el triaje con síntomas agudos» | `POST /v1/health/triage-preview` | R0 | owner, location_manager, front_desk, trainer, nutritionist, chef, clinician, accountant, member, guardian | `/staff/health/assessments` | sí |
| `salud.publicar_plan` | Publica un plan aprobado para que el socio lo vea; archiva la versión publicada anterior de la misma serie. | «Publica el plan aprobado de Pedro»<br>«Pon visible para Carmen su plan de nutrición aprobado» | `POST /v1/health/plans/:id/publish` | R2 | owner, location_manager, trainer, nutritionist, clinician | `/staff/health/plans` | sí |
| `salud.ver_evaluacion` | Muestra una evaluación de salud concreta con su triaje. | «Ábreme la última evaluación de Juan Pérez»<br>«¿Qué triaje salió en la evaluación de Carmen?» | `GET /v1/health/assessments/:id` | R0 | owner, location_manager, trainer, nutritionist, clinician, member, guardian | `/staff/health/assessments` | sí |
| `salud.ver_plan` | Muestra un plan de cuidado concreto con su contenido, justificación y datos de aprobación. | «Ábreme el plan de nutrición de Carmen»<br>«¿Quién aprobó el plan de entrenamiento de Pedro?» | `GET /v1/health/plans/:id` | R0 | owner, location_manager, trainer, nutritionist, clinician, member, guardian | `/staff/health/plans` | sí |

<details><summary>Campos, servicio, auditoría, conocimiento y prueba</summary>

- **`salud.aprobar_plan`** — servicio `apps/api/src/modules/health.ts:350 transition('approve') (registrada en apps/api/src/modules/health.ts:372) → app.approve_care_plan (0010_health.sql:532)`; R2 sensible; roles por `0010_health.sql:539 health_can_approve(kind) (0010_health.sql:497) + licencia verificada para nutrition/treatment (0010_health.sql:542) + triaje (training/nutrition) ; trigger care_plan_guard 0010_health.sql:337`.
  Entrada: params IdParams, body ApproveBody.
  - `referral_acknowledged` boolean — obligatorio true si el último triaje nutricional es ámbar o requiere derivación médica
  Auditoría: bus `salud.aprobar_plan`; hoy `care_plan.approved`. Conocimiento: socio. Prueba: `apps/api/test/health.test.ts`.
  Nota: Body ApproveBody (referral_acknowledged boolean, default false; obligatorio true si triaje nutricional ámbar o con derivación). Bloquea con triaje rojo. Guarda nombre y n.º de licencia del aprobador. El OWNER NUNCA aprueba (probado packages/db/test/health.test.ts:613). Aprobación clínica: el copiloto del dueño no debe ofrecerla. La entrada de extracción no listaba parses: la ruta parsea IdParams + ApproveBody (health.ts:352-354).
- **`salud.archivar_plan`** — servicio `apps/api/src/modules/health.ts:350 transition('archive') (registrada en apps/api/src/modules/health.ts:374) → app.archive_care_plan (0010_health.sql:580)`; R2 sensible; roles por `0010_health.sql:585 health_can_approve(kind) OR app.role() IN ('owner','location_manager')`.
  Entrada: params IdParams, body EmptyBody.
  Auditoría: bus `salud.archivar_plan`; hoy `care_plan.archived`. Conocimiento: socio. Prueba: `apps/api/test/route-gaps.test.ts`.
  Nota: El OWNER puede archivar (desactivar → R2). Sin vuelta atrás: archivado no tiene transición de salida (care_plan_guard) — para reponerlo hay que crear nueva versión (que el owner no puede crear). Sin prueba HTTP ni SQL directa de archive_care_plan (grep); solo el auto-archivado al publicar. La entrada de extracción no listaba parses: la ruta parsea IdParams + EmptyBody (health.ts:352-354).
- **`salud.consultar_mi_perfil_clinico`** — servicio `apps/api/src/modules/health.ts:182 → SELECT app.staff_member WHERE id = app.health_staff_id() (0010_health.sql:96)`; R0 lectura; roles por `apps/api/src/modules/health.ts:182 sin chequeo de rol (solo JWT, apps/api/src/app.ts:54); staff_member RLS deja ver la propia fila`.
  Entrada: ninguna.
  Auditoría: bus `salud.consultar_mi_perfil_clinico`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/health.test.ts`.
  Nota: Cualquier usuario autenticado puede llamarla; a socios/tutores devuelve staff=null. La UI solo la usa para HEALTH_STAFF (apps/web/src/modules/health/api.ts:158). Útil al copiloto para saber si el owner tiene fila de personal activa (health_staff_id), requisito para crear/firmar evaluaciones.
- **`salud.crear_evaluacion`** — servicio `apps/api/src/modules/health.ts:238 → INSERT app.assessment (evaluator_staff_id DEFAULT app.health_staff_id())`; R2 sensible; roles por `0010_health.sql:632 policy assessment_insert (evaluator_staff_id = health_staff_id() AND health_staff_can_see); owner probado en packages/db/test/health.test.ts:289-294`.
  Entrada: body AssessmentBody.
  - `member_id` uuid (requerido) — socio visible por health_staff_can_see (RLS assessment_insert)
  - `taken_at` datetime (ISO con offset) — no más de 5 min en el futuro (refine notFuture)
  - `parq` object (requerido) — objeto estricto con q1..q7 (PARQ_KEYS) todos boolean obligatorios; CHECK app.health_parq_valid
  - `parq_followup_resolved` boolean — seguimiento PAR-Q resuelto (baja triaje de ejercicio a verde)
  - `declared_conditions` array<enum> — máx 10, sin texto libre (HEALTH_CONDITIONS)
  - `resting_hr` integer|null — 25–250
  - `bp_sys` integer|null — 60–260; CHECK BD bp_sys > bp_dia
  - `bp_dia` integer|null — 30–160
  - `height_cm` number|null — 50–250, numeric(5,1)
  - `weight_kg` number|null — 20–350, numeric(5,1)
  - `waist_cm` number|null — 30–250, numeric(5,1)
  - `fitness_tests` object — parcial estricto: pushups, plank_seconds, sit_reach_cm, chair_stand_30s, step_test_hr, walk_6min_m (cada uno 0–10000)
  - `acute_symptoms` boolean — true → triaje emergency ('Llama al 911')
  Auditoría: bus `salud.crear_evaluacion`; hoy `health.assessment.create`. Conocimiento: socio. Prueba: `apps/api/test/health.test.ts`.
  Nota: Datos de salud → R2 (confirmación explícita). El owner PUEDE crearla (org-wide) siempre que tenga fila staff_member activa con rol owner (health_staff_id); quedará como evaluador. Auditoría por trigger health_audit_trigger (0010_health.sql:417), sin contenido clínico en meta. knowledge 'socio': no volcar valores clínicos al documento del socio, solo que existe una evaluación.
- **`salud.crear_plan`** — servicio `apps/api/src/modules/health.ts:319 → INSERT app.care_plan (created_by DEFAULT app.health_staff_id())`; R2 sensible; roles por `0010_health.sql:649 policy care_plan_insert (health_can_author(kind) 0010_health.sql:216 AND health_staff_can_see)`.
  Entrada: body PlanCreate.
  - `member_id` uuid (requerido) — visible por health_staff_can_see
  - `kind` enum (requerido) — training: trainer/location_manager; nutrition: nutritionist; treatment: clinician
  - `title` string (requerido) — SafeText 1–120; trim, sin < > { } ni caracteres de control; en BD health_text_safe también veta enlaces y términos 'nutricionista/dietista/garantizado/cura'
  - `body` object (requerido) — {sections:[{heading SafeText ≤120, items: SafeText ≤500 (máx 30)}] (máx 20 secciones)}; CHECK health_plan_body_valid
  - `rationale` string — máx 2000; trim, sin < > { } ni caracteres de control; en BD health_text_safe también veta enlaces y términos 'nutricionista/dietista/garantizado/cura'
  Auditoría: bus `salud.crear_plan`; hoy `care_plan.create`. Conocimiento: socio. Prueba: `apps/api/test/health.test.ts`.
  Nota: El OWNER NO puede crear planes (health_can_author lo excluye para los 3 tipos; Ley 82: solo el rol licenciado redacta nutrición, clinician tratamiento). copilot=false para el dueño. Rol no autor → 403 por RLS.
- **`salud.devolver_plan`** — servicio `apps/api/src/modules/health.ts:350 transition('return') (registrada en apps/api/src/modules/health.ts:371) → app.return_care_plan (0010_health.sql:516)`; R2 sensible; roles por `0010_health.sql:521 health_can_approve(kind) OR health_can_author(kind)`.
  Entrada: params IdParams, body EmptyBody.
  Auditoría: bus `salud.devolver_plan`; hoy `care_plan.draft`. Conocimiento: socio. Prueba: `apps/api/test/route-gaps.test.ts`.
  Nota: Sin prueba HTTP (grep); el SQL está cubierto en packages/db/test/health.test.ts:911. Owner excluido. Nota: el evento de auditoría es 'care_plan.draft' (concatenación del estado nuevo). La entrada de extracción no listaba parses: la ruta parsea IdParams + EmptyBody (health.ts:352-354).
- **`salud.editar_evaluacion`** — servicio `apps/api/src/modules/health.ts:253 → UPDATE app.assessment (solo columnas ASSESSMENT_WRITABLE; trigger assessment_guard 0010_health.sql:302)`; R2 sensible; roles por `0010_health.sql:636 policy assessment_update (status='draft' AND health_staff_can_see)`.
  Entrada: params IdParams, body AssessmentPatch.
  - `taken_at` datetime (ISO con offset) — no más de 5 min en el futuro (refine notFuture)
  - `parq` object — objeto estricto con q1..q7 (PARQ_KEYS) todos boolean obligatorios; CHECK app.health_parq_valid
  - `parq_followup_resolved` boolean — seguimiento PAR-Q resuelto (baja triaje de ejercicio a verde)
  - `declared_conditions` array<enum> — máx 10, sin texto libre (HEALTH_CONDITIONS)
  - `resting_hr` integer|null — 25–250
  - `bp_sys` integer|null — 60–260; CHECK BD bp_sys > bp_dia
  - `bp_dia` integer|null — 30–160
  - `height_cm` number|null — 50–250, numeric(5,1)
  - `weight_kg` number|null — 20–350, numeric(5,1)
  - `waist_cm` number|null — 30–250, numeric(5,1)
  - `fitness_tests` object — parcial estricto: pushups, plank_seconds, sit_reach_cm, chair_stand_30s, step_test_hr, walk_6min_m (cada uno 0–10000)
  - `acute_symptoms` boolean — true → triaje emergency ('Llama al 911')
  - `(cualquiera)` - (requerido) — al menos un campo; si no, 400 invalid_input (health.ts:257)
  Auditoría: bus `salud.editar_evaluacion`; hoy `health.assessment.update`. Conocimiento: socio. Prueba: `apps/api/test/health.test.ts`.
  Nota: Solo borradores: una firmada, ajena o invisible responde 404 (health.ts:266). El owner puede editar borradores de cualquier sede (no exige ser el evaluador original).
- **`salud.editar_plan`** — servicio `apps/api/src/modules/health.ts:332 → UPDATE app.care_plan SET title\|body\|rationale (trigger care_plan_guard 0010_health.sql:337)`; R2 sensible; roles por `0010_health.sql:653 policy care_plan_update (status='draft' AND health_can_author(kind) AND health_staff_can_see)`.
  Entrada: params IdParams, body PlanPatch.
  - `title` string — SafeText 1–120; trim, sin < > { } ni caracteres de control; en BD health_text_safe también veta enlaces y términos 'nutricionista/dietista/garantizado/cura'
  - `body` object — {sections:[{heading SafeText ≤120, items: SafeText ≤500 (máx 30)}] (máx 20 secciones)}; CHECK health_plan_body_valid
  - `rationale` string|null — máx 2000; null la borra; trim, sin < > { } ni caracteres de control; en BD health_text_safe también veta enlaces y términos 'nutricionista/dietista/garantizado/cura'
  - `(cualquiera)` - (requerido) — al menos uno; si no, 400 invalid_input
  Auditoría: bus `salud.editar_plan`; hoy `care_plan.update`. Conocimiento: socio. Prueba: `apps/api/test/health.test.ts`.
  Nota: La entrada de extracción lista también ApproveBody/EmptyBody: es un arrastre del helper transition() (health.ts:350); esta ruta solo parsea IdParams + PlanPatch. Solo borradores (otro estado → 404). Owner sin permiso (health_can_author).
- **`salud.enviar_plan_revision`** — servicio `apps/api/src/modules/health.ts:350 transition('submit') (registrada en apps/api/src/modules/health.ts:370) → app.submit_care_plan (0010_health.sql:505)`; R2 sensible; roles por `0010_health.sql:510 health_can_author(p.kind) tras health_plan_for_update (0010_health.sql:481, health_staff_can_see)`.
  Entrada: params IdParams, body EmptyBody.
  Auditoría: bus `salud.enviar_plan_revision`; hoy `care_plan.review`. Conocimiento: socio. Prueba: `apps/api/test/health.test.ts`.
  Nota: Solo autores del tipo. Owner excluido (health_can_author) → 403. Una vez en revisión el contenido queda congelado (plan_immutable). La entrada de extracción no listaba parses: la ruta parsea IdParams + EmptyBody (health.ts:352-354).
- **`salud.firmar_evaluacion`** — servicio `apps/api/src/modules/health.ts:271 → app.sign_assessment (0010_health.sql:447) → UPDATE assessment status='signed' + INSERT app.triage_result`; R2 sensible; roles por `0010_health.sql:457 app.role() IN (owner, location_manager, trainer, nutritionist, clinician) + health_staff_id no nulo + health_staff_can_see`.
  Entrada: params IdParams, body EmptyBody.
  Auditoría: bus `salud.firmar_evaluacion`; hoy `health.assessment.signed`. Conocimiento: socio. Prueba: `apps/api/test/health.test.ts`.
  Nota: IRREVERSIBLE en la práctica: firmada = inmutable (assessment_signed_immutable, sin borrado: health_no_delete); una corrección exige nueva evaluación. Se deja R2 por la regla 'datos de salud' (R3 está reservado a dinero/borrado/exportación) [VERIFICAR si se quiere tratar como R3]. El triaje resultante bloquea o habilita planes de nutrición/entrenamiento. Auditoría por trigger 'health.assessment.' \|\| status (0010_health.sql:419). El owner puede firmar (queda signed_by = su fila de personal); un clínico podría preferir que firme el evaluador real [VERIFICAR · política del negocio].
- **`salud.listar_evaluaciones`** — servicio `apps/api/src/modules/health.ts:212 → SELECT app.assessment + triage_result (RLS)`; R0 lectura; roles por `0010_health.sql:629 policy assessment_select (health_staff_can_see 0010_health.sql:199 OR status='signed' AND health_self_or_guardian)`.
  Entrada: query ListQuery.
  - `member_id` uuid — filtra por socio
  - `kind` enum — aceptado por ListQuery pero IGNORADO en esta ruta
  - `status` enum — aceptado pero IGNORADO en esta ruta (las evaluaciones usan draft\|signed)
  Auditoría: bus `salud.listar_evaluaciones`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/health.test.ts`.
  Nota: RLS salud: health_staff_can_see (0010_health.sql:199) = owner, location_manager, trainer, nutritionist, clinician de la sede del socio; el OWNER ve TODA la organización (staff_can_see_member + org_wide). front_desk, chef y accountant reciben lista vacía. Socio/tutor solo ven lo firmado/publicado. El owner ve borradores y firmadas con datos clínicos completos (PA, FC, peso, condiciones, triaje). Datos de salud sensibles: el copiloto debe mostrarlos solo al owner y no copiarlos a otros documentos. ListQuery comparte kind/status con planes pero aquí no filtran (no hay filtro por fecha ni por estado draft/signed). Socio/tutor también la usan (/me/health/assessment).
- **`salud.listar_planes`** — servicio `apps/api/src/modules/health.ts:294 → SELECT app.care_plan (RLS)`; R0 lectura; roles por `0010_health.sql:646 policy care_plan_select (health_staff_can_see OR status='published' AND health_self_or_guardian)`.
  Entrada: query ListQuery.
  - `member_id` uuid
  - `kind` enum
  - `status` enum
  Auditoría: bus `salud.listar_planes`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/health.test.ts`.
  Nota: RLS salud: health_staff_can_see (0010_health.sql:199) = owner, location_manager, trainer, nutritionist, clinician de la sede del socio; el OWNER ve TODA la organización (staff_can_see_member + org_wide). front_desk, chef y accountant reciben lista vacía. Socio/tutor solo ven lo firmado/publicado. El owner ve los planes en TODOS los estados y de los 3 tipos (incl. nutrición y tratamiento clínico, con nombre y n.º de licencia del aprobador). Socio/tutor: solo publicados (/me/health/plan).
- **`salud.nueva_version_plan`** — servicio `apps/api/src/modules/health.ts:376 → app.new_care_plan_version (0010_health.sql:596) → INSERT app.care_plan version=max+1`; R2 sensible; roles por `0010_health.sql:603 health_can_author(p.kind) AND health_staff_id no nulo`.
  Entrada: params IdParams, body EmptyBody.
  Auditoría: bus `salud.nueva_version_plan`; hoy `care_plan.create`. Conocimiento: socio. Prueba: `apps/api/test/health.test.ts`.
  Nota: 409 open_version_exists si ya hay draft/review en la serie. Owner excluido (health_can_author).
- **`salud.previsualizar_triaje`** — servicio `apps/api/src/modules/health.ts:194 → SELECT app.health_triage(...) (0010_health.sql:239, pura, rule_version v0-propuesta)`; R0 lectura; roles por `apps/api/src/modules/health.ts:194 sin chequeo de rol; app.health_triage concedida a app_authenticated (0010_health.sql:701-705)`.
  Entrada: body PreviewBody.
  - `member_id` uuid — solo para marcar menor (existe guardian_link visible al llamante)
  - `parq` object (requerido) — objeto estricto con q1..q7 (PARQ_KEYS) todos boolean obligatorios; CHECK app.health_parq_valid
  - `parq_followup_resolved` boolean
  - `declared_conditions` array<enum> — máx 10
  - `acute_symptoms` boolean
  Auditoría: bus `salud.previsualizar_triaje`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/health.test.ts`.
  Nota: Sin escritura: solo calcula el triaje; usa POST porque recibe los datos de la evaluación. POST pero de solo cálculo (no escribe) → R0. Reglas de triaje marcadas [VERIFICAR · equipo clínico] en la migración (0010_health.sql:235). El copiloto no debe presentarlo como diagnóstico. Sin chequeo de rol: cualquier autenticado puede llamarla; la UI solo la ofrece a HEALTH_STAFF.
- **`salud.publicar_plan`** — servicio `apps/api/src/modules/health.ts:350 transition('publish') (registrada en apps/api/src/modules/health.ts:373) → app.publish_care_plan (0010_health.sql:565)`; R2 sensible; roles por `0010_health.sql:570 health_can_approve(kind) OR app.role() IN ('owner','location_manager'); health_plan_for_update exige health_staff_can_see`.
  Entrada: params IdParams, body EmptyBody.
  Auditoría: bus `salud.publicar_plan`; hoy `care_plan.published|care_plan.archived`. Conocimiento: socio. Prueba: `apps/api/test/health.test.ts`.
  Nota: El OWNER SÍ puede publicar cualquier tipo ya aprobado por el profesional (incluye nutrición/tratamiento clínicos); no puede aprobar. Expone el plan al socio → R2, confirmar. También archiva la versión publicada previa (care_plan.archived). trainer solo puede publicar training, nutritionist solo nutrition, clinician solo treatment. La entrada de extracción no listaba parses: la ruta parsea IdParams + EmptyBody (health.ts:352-354).
- **`salud.ver_evaluacion`** — servicio `apps/api/src/modules/health.ts:225 → SELECT app.assessment + triage_result WHERE a.id=$1 (RLS)`; R0 lectura; roles por `0010_health.sql:629 policy assessment_select`.
  Entrada: params IdParams.
  Auditoría: bus `salud.ver_evaluacion`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/health.test.ts`.
  Nota: RLS salud: health_staff_can_see (0010_health.sql:199) = owner, location_manager, trainer, nutritionist, clinician de la sede del socio; el OWNER ve TODA la organización (staff_can_see_member + org_wide). front_desk, chef y accountant reciben lista vacía. Socio/tutor solo ven lo firmado/publicado. 404 si no visible. La web no llama esta ruta (usa la lista); el copiloto necesita el id (resolver socio→evaluación con la lista).
- **`salud.ver_plan`** — servicio `apps/api/src/modules/health.ts:309 → SELECT app.care_plan WHERE p.id=$1 (RLS)`; R0 lectura; roles por `0010_health.sql:646 policy care_plan_select`.
  Entrada: params IdParams.
  Auditoría: bus `salud.ver_plan`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/health.test.ts`.
  Nota: RLS salud: health_staff_can_see (0010_health.sql:199) = owner, location_manager, trainer, nutritionist, clinician de la sede del socio; el OWNER ve TODA la organización (staff_can_see_member + org_wide). front_desk, chef y accountant reciben lista vacía. Socio/tutor solo ven lo firmado/publicado. La web no llama esta ruta (usa la lista).

</details>

### sesion (8)

| Acción | Qué hace | Cómo lo diría el dueño | Ruta | Riesgo | Roles | Pantalla | Copiloto |
|---|---|---|---|---|---|---|---|
| `sesion.cambiar_contrasena` | El empleado cambia su contraseña (con la actual) y entra; revoca sus otras sesiones. | — | `POST /v1/public/auth/password/change` | R2 |  | `/account/password` | no |
| `sesion.cambiar_rol` | Cambia el rol activo de la sesión a otro rol de personal de la misma persona (emite tokens nuevos). | «Cámbiame a gerente de sede»<br>«Entra como recepción» | `POST /v1/auth/switch` | R1 | owner, location_manager, front_desk, trainer, nutritionist, chef, clinician, accountant | — | no |
| `sesion.entrar_contrasena` | Inicio de sesión del personal con correo y contraseña. | — | `POST /v1/public/auth/password` | R2 |  | — | no |
| `sesion.mis_roles` | Lista los roles de personal que tiene la persona en la organización y el rol activo. | «¿Qué roles tengo en el sistema?»<br>«¿Puedo entrar también como gerente?» | `GET /v1/auth/roles` | R0 | owner, location_manager, front_desk, trainer, nutritionist, chef, clinician, accountant | — | sí |
| `sesion.pedir_codigo` | Pide un código de acceso de 6 dígitos para el correo de un socio (solo en modo demo). | — | `POST /v1/public/login/start` | R1 |  | — | no |
| `sesion.quien_soy` | Devuelve la organización, su plan SaaS, la persona, el rol y las sedes de la sesión actual. | «¿Con qué rol estoy conectado?»<br>«¿Qué plan tiene mi gimnasio?» | `GET /v1/me` | R0 | owner, location_manager, front_desk, trainer, nutritionist, chef, clinician, accountant, member, guardian | `/staff/org` | sí |
| `sesion.renovar` | Rota el token de refresco y devuelve una sesión nueva. | — | `POST /v1/public/session/refresh` | R1 |  | — | no |
| `sesion.verificar_codigo` | Verifica el código del socio y abre su sesión (token + refresh). | — | `POST /v1/public/login/verify` | R1 |  | — | no |

<details><summary>Campos, servicio, auditoría, conocimiento y prueba</summary>

- **`sesion.cambiar_contrasena`** — servicio `apps/api/src/modules/auth.ts:116 → app_public.password_change (0026_staff_login.sql:140)`; R2 sensible; roles por `apps/api/src/app.ts:58 (sin token; requiere contraseña actual)`.
  Entrada: body inline {email, password, new_password}.
  - `email` string (requerido) — trim, 3–254
  - `password` string (requerido) — 1–128 (actual)
  - `new_password` string (requerido) — 1–128; política app.password_ok, distinta a la actual
  Auditoría: bus `sesion.cambiar_contrasena`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/auth.test.ts`.
  Nota: Sin app.audit del cambio de contraseña.
- **`sesion.cambiar_rol`** — servicio `apps/api/src/modules/auth.ts:239 → app.switch_role (0028_protected_accounts.sql:113)`; R1 reversible; roles por `0028_protected_accounts.sql:117 switch_role (solo roles de staff propios vía session_claims)`.
  Entrada: body inline {role}.
  - `role` enum (requerido) — un rol activo propio
  Auditoría: bus `sesion.cambiar_rol`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/auth.test.ts`.
  Nota: Devuelve tokens de sesión: fuera del copiloto. UI: AccountExtras (Layout.tsx:394).
- **`sesion.entrar_contrasena`** — servicio `apps/api/src/modules/auth.ts:104 → app_public.password_login (0026_staff_login.sql:98)`; R2 sensible; roles por `apps/api/src/app.ts:58 (sin token); bloqueo 15 min tras 5 fallos (0026_staff_login.sql:124)`.
  Entrada: body inline {email, password}.
  - `email` string (requerido) — trim, 3–254
  - `password` string (requerido) — 1–128
  Auditoría: bus `sesion.entrar_contrasena`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/auth.test.ts`.
  Nota: UI: StaffSignIn (pantalla de entrada). Credenciales: fuera del copiloto.
- **`sesion.mis_roles`** — servicio `apps/api/src/modules/auth.ts:233 → app.my_roles (0028_protected_accounts.sql:105)`; R0 lectura; roles por `0028_protected_accounts.sql:105 my_roles (filas staff_member activas de la persona)`.
  Entrada: ninguna.
  Auditoría: bus `sesion.mis_roles`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/auth.test.ts`.
  Nota: UI: menú de cuenta (AccountExtras en apps/web/src/components/Layout.tsx:394), sin ruta propia. Un socio recibe lista vacía.
- **`sesion.pedir_codigo`** — servicio `apps/api/src/modules/access.ts:294 → app_public.login_start (0024_access.sql:276)`; R1 reversible; roles por `apps/api/src/app.ts:58 (sin token)`.
  Entrada: body LoginStart.
  - `org_id` uuid (requerido)
  - `email` string (requerido) — trim, 3–254
  Auditoría: bus `sesion.pedir_codigo`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/access.test.ts`.
  Nota: Fuera de demo responde 503 login_delivery_unavailable (no hay proveedor de correo/SMS). UI: componente CodeSignIn (apps/web/src/modules/access/SignIn.tsx).
- **`sesion.quien_soy`** — servicio `apps/api/src/routes/org.ts:4 → SELECT app.organization + app.org_saas_plan(); SELECT app.person WHERE id = app.person_id()`; R0 lectura; roles por `0002_rls.sql:21 policy org_select (cualquier sesión de la org; sin chequeo de rol)`.
  Entrada: ninguna.
  Auditoría: bus `sesion.quien_soy`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/api.test.ts`.
  Nota: Audiencia mixta: también la usa el socio (apps/web/src/session/SessionContext.tsx). Útil como contexto del copiloto.
- **`sesion.renovar`** — servicio `apps/api/src/modules/auth.ts:133 → app_public.session_refresh (0026_staff_login.sql:160)`; R1 reversible; roles por `apps/api/src/app.ts:58 (sin token; el refresh token es la credencial)`.
  Entrada: body inline {refresh}.
  - `refresh` string (requerido) — ^[0-9a-f]{64}$
  Auditoría: bus `sesion.renovar`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/auth.test.ts`.
  Nota: Usado por apps/web/src/api/client.ts:179. Reutilizar un refresh revocado cierra todas las sesiones de la persona.
- **`sesion.verificar_codigo`** — servicio `apps/api/src/modules/access.ts:319 → app_public.login_verify (0026_staff_login.sql:183)`; R1 reversible; roles por `apps/api/src/app.ts:58 (sin token)`.
  Entrada: body LoginVerify.
  - `org_id` uuid (requerido)
  - `email` string (requerido) — trim, 3–254
  - `code` string (requerido) — ^[0-9]{6}$; 5 intentos por código
  Auditoría: bus `sesion.verificar_codigo`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/access.test.ts`.
  Nota: Emite tokens.

</details>

### sistema (4)

| Acción | Qué hace | Cómo lo diría el dueño | Ruta | Riesgo | Roles | Pantalla | Copiloto |
|---|---|---|---|---|---|---|---|
| `sistema.demo_personas` | Lista las personas sintéticas del modo demo para entrar sin proveedor de identidad. | — | `GET /v1/demo/personas` | R0 |  | — | no |
| `sistema.demo_sesion` | Emite un token de 15 min para una persona del modo demo. | — | `POST /v1/demo/session` | R1 |  | — | no |
| `sistema.salud` | Comprueba que la API está viva (responde {ok:true}). | — | `GET /health` | R0 |  | — | no |
| `sistema.ver_auditoria` | Muestra las últimas 200 entradas del registro de auditoría (quién hizo qué, cuándo y en qué sede). | «¿Quién canceló la clase de spinning ayer?»<br>«Enséñame los últimos cambios que se hicieron en el sistema» | `GET /v1/audit-log` | R0 | owner, location_manager | `/staff/audit` | sí |

<details><summary>Campos, servicio, auditoría, conocimiento y prueba</summary>

- **`sistema.demo_personas`** — servicio `apps/api/src/routes/demo.ts:32 → DEMO_PERSONAS (constante, sin BD)`; R0 lectura; roles por `apps/api/src/app.ts:56 (sin token en demo) + app.ts:126 (solo se registra si deps.demo)`.
  Entrada: ninguna.
  Auditoría: bus `sistema.demo_personas`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/netlify.test.ts`.
  Nota: Solo modo demo. UI: EntryScreen.
- **`sistema.demo_sesion`** — servicio `apps/api/src/routes/demo.ts:34 → SignJWT`; R1 reversible; roles por `apps/api/src/app.ts:56 + app.ts:126 (solo deps.demo)`.
  Entrada: body SessionBody.
  - `persona_id` string (requerido) — 1–40; debe existir en DEMO_PERSONAS
  Auditoría: bus `sistema.demo_sesion`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/netlify.test.ts`.
  Nota: Solo modo demo; emite tokens. SessionBody aquí es el de routes/demo.ts, no el de schedule.ts.
- **`sistema.salud`** — servicio `apps/api/src/app.ts:91 → respuesta fija, sin BD`; R0 lectura; roles por `apps/api/src/app.ts:55 (onRequest omite la autenticación para /health)`.
  Entrada: ninguna.
  Auditoría: bus `sistema.salud`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/api.test.ts`.
  Nota: La entrada indica app.ts:83; en el código actual la ruta está en app.ts:91.
- **`sistema.ver_auditoria`** — servicio `apps/api/src/routes/org.ts:38 → SELECT app.audit_log ORDER BY at DESC LIMIT 200`; R0 lectura; roles por `0002_rls.sql:114 policy audit_select (owner todo; location_manager sus sedes)`.
  Entrada: ninguna.
  Auditoría: bus `sistema.ver_auditoria`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/api.test.ts`.
  Nota: Sin filtros (acción, entidad, fecha) ni paginación: el copiloto solo ve las últimas 200.

</details>

### socios (4)

| Acción | Qué hace | Cómo lo diría el dueño | Ruta | Riesgo | Roles | Pantalla | Copiloto |
|---|---|---|---|---|---|---|---|
| `socios.cambiar_estado` | Cambia el estado de un socio (lead, prueba, activo, congelado, moroso, cancelado). | «Congela la membresía de Pedro Santiago»<br>«Pon a Ana López como activa» | `PATCH /v1/members/:id` | R2 | owner, location_manager, front_desk | `/staff/members` | sí |
| `socios.listar` | Lista los socios visibles (estado, número, sede de casa, nombre y correo), opcionalmente de una sede. | «¿Cuántos socios tengo en Bayamón?»<br>«Enséñame la lista de socios» | `GET /v1/members` | R0 | owner, location_manager, front_desk, trainer, nutritionist, chef, clinician, accountant | `/staff/members` | sí |
| `socios.registrar` | Registra un socio nuevo (correo, nombre, teléfono y sede de casa); entra con estado 'lead'. | «Registra a María Rivera, maria@correo.com, en la sede de Caguas»<br>«Añade un socio nuevo: Juan Pérez, teléfono 787-555-0123, en Bayamón» | `POST /v1/members` | R1 | owner, location_manager, front_desk | `/staff/members` | sí |
| `socios.ver_acuerdos` | Lista los acuerdos que aceptó un socio (términos, relevo) con versión, idioma y fecha. | «¿Firmó Pedro el relevo de responsabilidad?»<br>«¿Qué versión de los términos aceptó Ana?» | `GET /v1/members/:id/agreements` | R0 | owner, location_manager, front_desk, trainer, nutritionist, chef, clinician, accountant, member, guardian | `/staff/members/:id` | sí |

<details><summary>Campos, servicio, auditoría, conocimiento y prueba</summary>

- **`socios.cambiar_estado`** — servicio `apps/api/src/routes/members.ts:43 → UPDATE app.member SET status (RLS member_update; trigger member_audit)`; R2 sensible; roles por `0002_rls.sql:58 policy member_update (owner, location_manager, front_desk de la sede de casa)`.
  Entrada: params IdParams, body PatchBody.
  - `status` enum (requerido) — uno de la lista
  Auditoría: bus `socios.cambiar_estado`; hoy `member.update`. Conocimiento: socio. Prueba: `apps/api/test/api.test.ts`.
  Nota: R2 porque pasar a frozen/cancelled equivale a desactivar y afecta acceso y reservas (access_decision). [VERIFICAR] fijar 'past_due' a mano puede chocar con billing, que también escribe status (0006_billing.sql:986 GRANT UPDATE(status) a app_definer). Audit vía trigger 0003_definer_functions.sql:109.
- **`socios.listar`** — servicio `apps/api/src/routes/members.ts:17 → SELECT app.member JOIN app.person (máx. 500)`; R0 lectura; roles por `0002_rls.sql:50 policy member_select (staff de la sede de casa; owner/accountant toda la org)`.
  Entrada: query ListQuery.
  - `location_id` uuid — uuid; filtra por sede de casa
  Auditoría: bus `socios.listar`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/netlify.test.ts`.
  Nota: También ejercitada en apps/api/test/crm.test.ts:193; api.test.ts solo prueba POST. Un socio/guardian que la llame ve solo su fila/la del menor. Sin búsqueda por nombre, filtro por estado ni paginación (tope 500). ListQuery no es .strict().
- **`socios.registrar`** — servicio `apps/api/src/routes/members.ts:31 → app.register_member (0003_definer_functions.sql:36) → INSERT app.person/app.member`; R1 reversible; roles por `0003_definer_functions.sql:45 register_member (role IN owner, location_manager, front_desk)`.
  Entrada: body RegisterBody.
  - `email` string (requerido) — z.email(), ≤254; SQL exige ^[^@\s]+@[^@\s]+\.[^@\s]+$
  - `full_name` string (requerido) — 1–200 caracteres
  - `phone` string — ≤32 caracteres; sin validación de formato en API
  - `home_location_id` uuid (requerido) — sede de la org visible para el que llama
  Auditoría: bus `socios.registrar`; hoy `member.register`. Conocimiento: socio. Prueba: `apps/api/test/api.test.ts`.
  Nota: RegisterBody no es .strict(). El teléfono no se valida como en el registro público (signup.ts REAL_PHONE).
- **`socios.ver_acuerdos`** — servicio `apps/api/src/modules/signup.ts:298 → SELECT app.member_agreement`; R0 lectura; roles por `0018_signup.sql:379 policy member_agreement_select → app.can_act_for_member (0004_messaging_consent.sql:163)`.
  Entrada: params IdParams.
  Auditoría: bus `socios.ver_acuerdos`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/signup.test.ts`.
  Nota: La pestaña de la ficha solo se muestra a FOH (apps/web/src/modules/signup/index.ts:24), pero RLS deja leer a cualquier staff que vea al socio.

</details>

### suscripciones (5)

| Acción | Qué hace | Cómo lo diría el dueño | Ruta | Riesgo | Roles | Pantalla | Copiloto |
|---|---|---|---|---|---|---|---|
| `suscripciones.cancelar` | Pide la cancelación de una membresía al final del período (o al final de la permanencia si es más tarde). | «Cancela la membresía de Roberto»<br>«Da de baja a Sofía al final de su mes» | `POST /v1/subscriptions/:id/cancel` | R2 | owner, location_manager, front_desk, member, guardian | `/staff/members/:id` | sí |
| `suscripciones.congelar` | Congela la membresía de un socio entre dos fechas y corre el fin del período y de la permanencia esos días. | «Congela la membresía de Luis del 1 al 15 de diciembre porque se va de viaje»<br>«Pausa a Carmen dos semanas desde el lunes por lesión» | `POST /v1/subscriptions/:id/freeze` | R2 | owner, location_manager, front_desk | `/staff/members/:id` | sí |
| `suscripciones.crear` | Inscribe a un socio en una membresía recurrente (con cuota de inscripción opcional) y emite la primera factura con IVU. | «Inscribe a María Rivera en la membresía mensual»<br>«Pon a Pedro en el plan anual desde el 1 de diciembre con la cuota de inscripción»<br>«Suscribe a Ana al plan básico» | `POST /v1/members/:id/subscriptions` | R2 | owner, location_manager, front_desk | `/staff/members/:id` | sí |
| `suscripciones.ver_cuenta_socio` | Muestra todo lo de facturación de un socio: suscripciones, congelaciones, facturas, pagos, créditos y pases. | «¿Cómo está la cuenta de María Rivera?»<br>«¿Cuántas clases le quedan a Pedro en su paquete?»<br>«¿Juan debe algo?» | `GET /v1/members/:id/billing` | R0 | owner, location_manager, front_desk, accountant | `/staff/members/:id` | sí |
| `suscripciones.ver_politica` | Muestra las reglas de facturación: permanencia máxima, días para pagar una factura y días máximos de congelación, por sede. | «¿Cuántos días de congelación permitimos?»<br>«¿En cuántos días vence una factura?» | `GET /v1/billing/policy` | R0 | owner, location_manager, front_desk | — | sí |

<details><summary>Campos, servicio, auditoría, conocimiento y prueba</summary>

- **`suscripciones.cancelar`** — servicio `apps/api/src/modules/billing.ts:326 → app.cancel_subscription (0006_billing.sql:587)`; R2 sensible; roles por `0006_billing.sql:595 cancel_subscription (billing_staff_at OR billing_is_self)`.
  Entrada: params IdParams, body CancelBody.
  - `confirm` boolean (requerido) — literal true (confirmación explícita)
  Auditoría: bus `suscripciones.cancelar`; hoy `subscription.cancel_request, subscription.update`. Conocimiento: socio. Prueba: `apps/api/test/billing.test.ts`.
  Nota: El socio también la usa desde /me/membership. Idempotente. NUEVO: no hay ruta para revertir la solicitud de cancelación ni para cambiar de plan.
- **`suscripciones.congelar`** — servicio `apps/api/src/modules/billing.ts:309 → app.freeze_subscription (0006_billing.sql:533)`; R2 sensible; roles por `0006_billing.sql:542 freeze_subscription (role IN owner, location_manager, front_desk + billing_staff_at)`.
  Entrada: params IdParams, body FreezeBody.
  - `start_date` string (requerido) — YYYY-MM-DD (regex ^\d{4}-\d{2}-\d{2}$); ≥ hoy y dentro del período actual
  - `end_date` string (requerido) — YYYY-MM-DD (regex ^\d{4}-\d{2}-\d{2}$); > start_date; días acumulados en 365 días ≤ billing_policy.max_freeze_days; sin solaparse
  - `reason` string — ≤300
  Auditoría: bus `suscripciones.congelar`; hoy `subscription.freeze, subscription.update`. Conocimiento: socio. Prueba: `apps/api/test/billing.test.ts`.
  Nota: NUEVO: no existe descongelar/anular una congelación; un error del copiloto no se deshace por API.
- **`suscripciones.crear`** — servicio `apps/api/src/modules/billing.ts:296 → app.create_subscription (0006_billing.sql:468) → app.billing_issue_invoice`; R2 sensible; roles por `0006_billing.sql:485 y :489 create_subscription (role IN owner, location_manager, front_desk + billing_staff_at sede del socio)`.
  Entrada: params IdParams, body SubscribeBody.
  - `price_id` uuid (requerido) — precio activo de un producto membership/addon con intervalo month\|year, de la sede del socio u org-wide
  - `start_date` string — YYYY-MM-DD (regex ^\d{4}-\d{2}-\d{2}$); entre hoy−31 y hoy+90 días
  - `enrollment_price_id` uuid — precio activo de producto enrollment_fee
  Auditoría: bus `suscripciones.crear`; hoy `subscription.create, invoice.issue`. Conocimiento: socio. Prueba: `apps/api/test/billing.test.ts`.
  Nota: Emite factura (no cobra): el cobro va aparte por POST /v1/invoices/:id/payments. Permanencia limitada por billing_policy.
- **`suscripciones.ver_cuenta_socio`** — servicio `apps/api/src/modules/billing.ts:287 → billingFor(): SELECT app.subscription, subscription_freeze, invoice, invoice_line, payment, credit_balance, access_pass (RLS)`; R0 lectura; roles por `0006_billing.sql:930 subscription_select / 0006_billing.sql:940 invoice_select / 0006_billing.sql:945 payment_select (billing_staff_at 0006_billing.sql:279; accountant solo facturas y pagos)`.
  Entrada: params IdParams.
  Auditoría: bus `suscripciones.ver_cuenta_socio`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/billing.test.ts`.
  Nota: El accountant ve facturas/pagos pero listas vacías de suscripciones, créditos y pases (no tienen política para accountant).
- **`suscripciones.ver_politica`** — servicio `apps/api/src/modules/billing.ts:276 → SELECT app.billing_policy`; R0 lectura; roles por `0006_billing.sql:892 policy billing_policy_select`.
  Entrada: ninguna.
  Auditoría: bus `suscripciones.ver_politica`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/route-gaps.test.ts`.
  Nota: Ninguna pantalla web la llama y no hay prueba HTTP. NUEVO: no existe ruta para CAMBIAR billing_policy aunque RLS lo permite al owner (0006:895-898); si el dueño pide 'sube la congelación a 60 días' hace falta crearla (R2).

</details>

### usuarios (3)

| Acción | Qué hace | Cómo lo diría el dueño | Ruta | Riesgo | Roles | Pantalla | Copiloto |
|---|---|---|---|---|---|---|---|
| `usuarios.crear_cuenta` | Crea la cuenta de un empleado nuevo con rol, sede y contraseña inicial que deberá cambiar. | «Crea una cuenta de recepcionista para Marta en Caguas»<br>«Añade a José como entrenador en Bayamón» | `POST /v1/staff/accounts` | R2 | owner | `/staff/team` | sí |
| `usuarios.exigir_cambio_contrasena` | Obliga (o deja de obligar) a un empleado a cambiar su contraseña en el próximo acceso. | «Obliga a Carla a cambiar su contraseña la próxima vez»<br>«Quítale a Luis el cambio obligatorio de contraseña» | `PUT /v1/staff/accounts/:id/change-required` | R2 | owner | `/staff/team` | sí |
| `usuarios.listar_cuentas` | Lista el equipo con su rol, si está activo, si tiene contraseña y si debe cambiarla. | «¿Quién de mi equipo tiene que cambiar la contraseña?»<br>«Dame la lista de cuentas del personal» | `GET /v1/staff/accounts` | R0 | owner | `/staff/team` | sí |

<details><summary>Campos, servicio, auditoría, conocimiento y prueba</summary>

- **`usuarios.crear_cuenta`** — servicio `apps/api/src/modules/auth.ts:197 → app.create_staff_account (0026_staff_login.sql:216)`; R2 sensible; roles por `0026_staff_login.sql:225 create_staff_account (role = owner)`.
  Entrada: body inline {email, full_name, role, location_id, password}.
  - `email` string (requerido) — trim, minúsculas, email, ≤254; solo correos sin cuenta (409 account_exists)
  - `full_name` string (requerido) — trim, 2–120
  - `role` enum (requerido)
  - `location_id` uuid|null — obligatorio salvo owner/accountant (location_required)
  - `password` string (requerido) — 8–128; temporal, se exige cambio al primer acceso
  Auditoría: bus `usuarios.crear_cuenta`; hoy `staff_account.create`. Conocimiento: sistema. Prueba: `apps/api/test/auth.test.ts`.
  Nota: [VERIFICAR] la contraseña inicial no debería dictarse por voz ni quedar en el historial del copiloto; considerar que el copiloto la genere y la muestre una sola vez. No hay ruta para desactivar ni cambiar rol de un empleado (RLS staff_update existe, 0002_rls.sql:91).
- **`usuarios.exigir_cambio_contrasena`** — servicio `apps/api/src/modules/auth.ts:179 → app.set_password_change_required (0028_protected_accounts.sql:63)`; R2 sensible; roles por `0028_protected_accounts.sql:67 set_password_change_required (role = owner; cuenta protegida → 403)`.
  Entrada: params inline {id}, body inline {required}.
  - `required` boolean (requerido)
  Auditoría: bus `usuarios.exigir_cambio_contrasena`; hoy `staff_account.change_required`. Conocimiento: sistema. Prueba: `apps/api/test/auth.test.ts`.
  Nota: Params y body con zod en línea (auth.ts:180-181).
- **`usuarios.listar_cuentas`** — servicio `apps/api/src/modules/auth.ts:171 → app.staff_accounts (0028_protected_accounts.sql:86)`; R0 lectura; roles por `0028_protected_accounts.sql:91 staff_accounts (role = owner)`.
  Entrada: ninguna.
  Auditoría: bus `usuarios.listar_cuentas`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/auth.test.ts`.

</details>

### ventas (8)

| Acción | Qué hace | Cómo lo diría el dueño | Ruta | Riesgo | Roles | Pantalla | Copiloto |
|---|---|---|---|---|---|---|---|
| `ventas.cancelar_pedido` | Cancela un pedido en línea pendiente de recoger y libera el inventario reservado. | «Cancela el pedido de Ana, no vino a buscarlo»<br>«Anula los pedidos viejos de Pedro» | `POST /v1/store/orders/:id/cancel` | R1 | owner, location_manager, front_desk, member | `/staff/store/sales` | sí |
| `ventas.cotizar` | Calcula el total de un carrito con IVU estatal y municipal sin registrar nada. | «¿Cuánto saldrían dos proteínas y una botella de agua con IVU?»<br>«Cotízame tres camisetas» | `POST /v1/store/quote` | R0 | owner, location_manager, front_desk, accountant, member, guardian | `/staff/store/pos` | sí |
| `ventas.entregar_pedido` | Entrega en recepción un pedido en línea: cobra, verifica edad si hace falta y descuenta el inventario. | «Entrega el pedido de Ana, pagó en efectivo»<br>«Marca como recogido el pedido de Carlos con tarjeta, ya verifiqué su edad» | `POST /v1/store/orders/:id/pickup` | R2 | owner, location_manager, front_desk | `/staff/store/sales` | sí |
| `ventas.listar` | Lista las últimas 200 ventas y pedidos de la tienda con filtros por sede, socio o estado. | «¿Cuánto vendimos hoy en la tienda?»<br>«Enséñame los pedidos pendientes de recoger»<br>«¿Qué ha comprado Ana en la tienda?» | `GET /v1/store/sales` | R0 | owner, location_manager, front_desk, accountant | `/staff/store/sales` | sí |
| `ventas.pedir_en_linea` | El socio hace un pedido en línea para recoger en una sede; se reserva el inventario. | — | `POST /v1/store/orders` | R1 | member | `/me/store` | no |
| `ventas.reembolsar` | Reembolsa por completo una venta completada y devuelve todas las unidades al inventario de la sede. | «Reembolsa la venta de la proteína de esta mañana, vino abierta»<br>«Devuélvele a Luis la compra de la camiseta» | `POST /v1/store/sales/:id/refund` | R2 | owner, location_manager | `/staff/store/sales` | sí |
| `ventas.registrar` | Registra una venta de mostrador (POS) en una sede: calcula IVU, descuenta inventario y guarda el método de pago. | «Vende dos aguas en efectivo en Bayamón»<br>«Cóbrale a Carlos una proteína con tarjeta»<br>«Registra la venta de una camiseta y un shaker» | `POST /v1/store/sales` | R2 | owner, location_manager, front_desk | `/staff/store/pos` | sí |
| `ventas.ver` | Muestra el recibo de una venta o pedido con sus líneas e IVU. | «Enséñame el recibo de la última venta»<br>«¿Qué llevaba el pedido de Carlos?» | `GET /v1/store/sales/:id` | R0 | owner, location_manager, front_desk, accountant | `/staff/store/sales` | sí |

<details><summary>Campos, servicio, auditoría, conocimiento y prueba</summary>

- **`ventas.cancelar_pedido`** — servicio `apps/api/src/modules/store.ts:424 → app.cancel_online_order (0009_store.sql:474)`; R1 reversible; roles por `0009_store.sql:482 cancel_online_order (store_can_sell o el socio dueño del pedido)`.
  Entrada: params IdParams.
  Auditoría: bus `ventas.cancelar_pedido`; hoy `store.order.cancel`. Conocimiento: producto. Prueba: `apps/api/test/store.test.ts`.
  Nota: El socio también la usa desde /me/store. No se cobró nada, por eso R1. No existe la limpieza automática app.release_stale_orders() citada en 0009:393.
- **`ventas.cotizar`** — servicio `apps/api/src/modules/store.ts:222 → app.store_quote (0009_store.sql:680, invoker rights, no escribe)`; R0 lectura; roles por `0009_store.sql:680 store_quote corre como el caller: solo productos legibles por 0009_store.sql:752 product_select`.
  Entrada: body QuoteBody.
  - `lines` array<{product_id: uuid, qty: int}> (requerido) — 1–50 líneas (STORE_MAX_LINES); qty entero 1–999 (STORE_MAX_LINE_QTY); objetos .strict()
  Auditoría: bus `ventas.cotizar`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/store.test.ts`.
  Nota: Sin escritura: solo calcula el total con IVU; usa POST porque recibe el carrito.
- **`ventas.entregar_pedido`** — servicio `apps/api/src/modules/store.ts:409 → app.complete_pickup (0009_store.sql:431)`; R2 sensible; roles por `0009_store.sql:442 y :444 complete_pickup (store_caller_staff_id + store_can_sell)`.
  Entrada: params IdParams, body PickupBody.
  - `payment_method` enum (requerido) — solo se registra; sin pasarela
  - `age_verified` boolean — obligatorio true si alguna línea es age_restricted
  Auditoría: bus `ventas.entregar_pedido`; hoy `store.order.pickup`. Conocimiento: producto, reporte. Prueba: `apps/api/test/store.test.ts`.
  Nota: Cobrar = R2; card_simulated sin pasarela (sería R3 con Stripe).
- **`ventas.listar`** — servicio `apps/api/src/modules/store.ts:358 → SELECT app.sale LIMIT 200`; R0 lectura; roles por `0009_store.sql:787 policy sale_select (vendedores de la sede, accountant; socio/tutor sus compras)`.
  Entrada: query SalesQuery.
  - `location_id` uuid
  - `member_id` uuid
  - `status` enum
  Auditoría: bus `ventas.listar`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/store.test.ts`.
  Nota: Sin filtro de fechas: 'ventas de hoy' exige filtrar en el cliente sobre las últimas 200.
- **`ventas.pedir_en_linea`** — servicio `apps/api/src/modules/store.ts:395 → app.place_online_order (0009_store.sql:374)`; R1 reversible; roles por `0009_store.sql:382 place_online_order (role = 'member'; tutores excluidos)`.
  Entrada: body OrderBody.
  - `location_id` uuid (requerido) — sede de recogida de la org
  - `lines` array<{product_id: uuid, qty: int}> (requerido) — 1–50 líneas; ≤5 unidades por producto por pedido, ≤10 entre pedidos abiertos, ≤5 pedidos abiertos
  Auditoría: bus `ventas.pedir_en_linea`; hoy `store.order.place`. Conocimiento: —. Prueba: `apps/api/test/store.test.ts`.
  Nota: Ruta solo-socio. El comentario 0009:393 menciona app.release_stale_orders() (liberar pedidos >48 h) pero esa función no existe en ninguna migración.
- **`ventas.reembolsar`** — servicio `apps/api/src/modules/store.ts:384 → app.refund_sale (0009_store.sql:501)`; R2 sensible; roles por `0009_store.sql:509 refund_sale (store_can_manage; front_desk no reembolsa)`.
  Entrada: params IdParams, body RefundBody.
  - `reason` string (requerido) — trim, 3–200, sin caracteres de control (Text(3,200))
  Auditoría: bus `ventas.reembolsar`; hoy `store.sale.refund`. Conocimiento: producto, reporte. Prueba: `apps/api/test/store.test.ts`.
  Nota: Solo reembolso total, sin parciales. No devuelve dinero por ninguna pasarela (la devolución física/tarjeta queda fuera del sistema); si se conecta Stripe sería R3. Irreversible.
- **`ventas.registrar`** — servicio `apps/api/src/modules/store.ts:338 → app.record_sale (0009_store.sql:331)`; R2 sensible; roles por `0009_store.sql:341 record_sale (store_caller_staff_id + store_can_sell 0009_store.sql:220)`.
  Entrada: body SaleBody.
  - `location_id` uuid (requerido) — sede donde vende el caller
  - `lines` array<{product_id: uuid, qty: int}> (requerido) — 1–50 líneas (STORE_MAX_LINES); qty entero 1–999 (STORE_MAX_LINE_QTY); objetos .strict()
  - `payment_method` enum (requerido) — solo se registra; no pasa por PaymentGateway
  - `member_id` uuid — socio visible para el caller
  - `age_verified` boolean — obligatorio true si alguna línea es age_restricted
  Auditoría: bus `ventas.registrar`; hoy `store.sale.record`. Conocimiento: producto, reporte. Prueba: `apps/api/test/store.test.ts`.
  Nota: Registrar venta = R2. card_simulated NO llama a ninguna pasarela (a diferencia de billing): si se conecta Stripe aquí pasaría a R3. Requiere fila activa en staff_member para el rol del token.
- **`ventas.ver`** — servicio `apps/api/src/modules/store.ts:377 → loadSale(): SELECT app.sale + sale_line`; R0 lectura; roles por `0009_store.sql:787 sale_select; 0009_store.sql:793 sale_line_select`.
  Entrada: params IdParams.
  Auditoría: bus `ventas.ver`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/store.test.ts`.

</details>

### voz (2)

| Acción | Qué hace | Cómo lo diría el dueño | Ruta | Riesgo | Roles | Pantalla | Copiloto |
|---|---|---|---|---|---|---|---|
| `voz.token_live` | Emite un token efímero de Gemini Live (una sesión, 15 min) para el asistente de voz del navegador. | «Activa el asistente de voz»<br>«Quiero hablar con el asistente» | `POST /v1/live/token` | R1 | owner, location_manager, front_desk, trainer, nutritionist, chef, clinician, accountant, member, guardian | — | no |
| `voz.token_live_publico` | Emite un token de Gemini Live para el asistente de voz de la página pública Únete. | — | `POST /v1/public/live/token` | R1 |  | `/join/:orgId` | no |

<details><summary>Campos, servicio, auditoría, conocimiento y prueba</summary>

- **`voz.token_live`** — servicio `apps/api/src/modules/live.ts:233 → mintToken (POST auth_tokens a Google); sin BD`; R1 reversible; roles por `apps/api/src/modules/live.ts:233 (cualquier sesión firmada; sin chequeo de rol; límite 30/10 min por usuario)`.
  Entrada: ninguna.
  Auditoría: bus `voz.token_live`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/photo-live.test.ts`.
  Nota: Es el canal del propio copiloto de voz (LiveAgentProvider en apps/web/src/main.tsx), no una acción. [VERIFICAR] riesgo: no es lectura pero consume cuota de Gemini; 503 live_unavailable sin clave.
- **`voz.token_live_publico`** — servicio `apps/api/src/modules/live.ts:248 → app_public.join_info + mintToken`; R1 reversible; roles por `apps/api/src/app.ts:58 (sin token; límite 6/10 min por IP)`.
  Entrada: body PublicBody.
  - `org_id` uuid (requerido) — org con página Únete abierta
  Auditoría: bus `voz.token_live_publico`; hoy **sin auditoría**. Conocimiento: —. Prueba: `apps/api/test/photo-live.test.ts`.
  Nota: La entrada indica live.ts:109; el handler público está en live.ts:248. [VERIFICAR] riesgo (consume cuota).

</details>

## NUEVO — requiere aprobación antes de construir

| Acción | Qué hace | Cómo lo diría el dueño | Riesgo | Roles | Por qué falta |
|---|---|---|---|---|---|
| `clases.editar_tipo` | Edita una clase del catálogo: nombre, descripción, duración y cupo por defecto. | «Cambia la duración de spinning a 50 minutos»<br>«Sube el cupo de yoga a 18» | R1 | owner, location_manager | NUEVO: la RLS ya permite UPDATE (0007_schedule.sql:696) pero no hay ruta ni pantalla. Hoy no existe forma de corregir una clase creada. |
| `clases.desactivar_tipo` | Desactiva (o reactiva) una clase del catálogo sin borrar su historial. | «Desactiva la clase de zumba»<br>«Vuelve a activar pilates» | R2 | owner, location_manager | NUEVO: la columna class_type.active existe, pero ninguna ruta la cambia. Desactivar es R2 según la tabla de riesgo. |
| `clases.duplicar_tipo` | Crea una clase nueva copiando otra del catálogo con un nombre distinto. | «Duplica spinning como spinning intermedio»<br>«Haz una copia de yoga para la tarde» | R1 | owner, location_manager | NUEVO: no existe; es una composición de leer + crear tipo. |
| `clases.definir_detalles` | Asigna a una clase del catálogo instructor(es), sala, color y el plan que la incluye (o su precio). | «Spinning la da Luis en el salón 2»<br>«Ponle color verde a yoga» | R2 | owner, location_manager | NUEVO: class_type no tiene instructor, sala, color ni precio/plan (0007_schedule.sql:17). Requiere columnas o tabla nueva (decisión humana). Precio/plan = regla de cobro → R2 y aprobación. |
| `agenda.programar_recurrente` | Programa una serie de sesiones de una clase con una regla de recurrencia (p. ej. lunes y miércoles a las 6 p. m. por 8 semanas). | «Programa spinning lunes y miércoles a las seis por dos meses»<br>«Pon yoga todos los sábados a las nueve» | R1 | owner, location_manager | NUEVO: solo existe crear una sesión suelta (POST /v1/schedule/sessions). class_session no tiene regla de recurrencia; propuesta: tabla class_series + generación de sesiones. |
| `agenda.reprogramar_sesion` | Cambia hora, instructor, sala o cupo de una sesión programada y avisa a los reservados. | «Mueve el spinning de hoy a las siete»<br>«Cambia el instructor de yoga del jueves a Ana» | R1 | owner, location_manager | NUEVO: solo existen crear y cancelar sesión; class_session no tiene ruta de edición. El aviso a socios reservados usaría la mensajería existente (consentimiento y horario). |
| `socios.buscar` | Busca socios por nombre, número, correo o estado, con paginación. | «Busca a la socia Ana Rivera»<br>«¿Qué socios están morosos?» | R0 | owner, location_manager | NUEVO: GET /v1/members no filtra por nombre ni estado y corta en 500 filas; el copiloto necesita desambiguar homónimos con un dato distintivo. |
| `usuarios.cambiar_rol` | Cambia el rol o la sede de una cuenta de personal. | «Pasa a Luis de recepción a entrenador»<br>«Asigna a Nilda a la sede de Toa Baja» | R2 | owner | NUEVO: la RLS staff_update lo permitiría pero no hay ruta. Respeta las cuentas protegidas (0028). |
| `usuarios.desactivar` | Desactiva (o reactiva) una cuenta de personal sin borrar su historial. | «Desactiva la cuenta de Pedro»<br>«Vuelve a activar a Carmen» | R2 | owner | NUEVO: no hay ruta; las cuentas protegidas no se pueden desactivar (trigger de 0028). |
| `suscripciones.cambiar_plan` | Cambia el plan de una suscripción activa, con prorrateo según la política de cobro. | «Pásale a Ana el plan premium»<br>«Baja a Juan al plan básico desde el mes que viene» | R2 | owner, location_manager | NUEVO: hoy solo existen crear, congelar y cancelar. Regla de cobro nueva → decisión humana. |
| `suscripciones.descongelar` | Termina antes de tiempo la congelación de una suscripción. | «Descongela la membresía de Ana»<br>«Ana volvió, reactívale la suscripción» | R2 | owner, location_manager | NUEVO: no hay ruta para deshacer una congelación. |
| `suscripciones.deshacer_cancelacion` | Revierte una cancelación programada antes de su fecha efectiva. | «Cancela la baja de Juan, se queda»<br>«Revierte la cancelación de Ana» | R2 | owner, location_manager | NUEVO: no hay ruta. |
| `suscripciones.editar_politica_cobro` | Edita la política de cobro de la organización (días de gracia, reintentos, recargos). | «Dale cinco días de gracia a los pagos»<br>«Cambia los reintentos de cobro a tres» | R2 | owner | NUEVO: la base permite al dueño cambiar billing_policy pero no hay ruta ni pantalla. Regla de cobro → decisión humana. |
| `facturas.reembolsar_pago` | Reembolsa total o parcialmente un pago de factura. | «Devuélvele a Ana los 40 dólares del pago de ayer»<br>«Reembolsa la factura 1023» | R3 | owner | NUEVO: hoy solo se puede anular una factura sin pagos. Con tarjeta toca la pasarela (hoy simulada, Stripe sin conectar) → R3 e integración de pagos reales: decisión humana. |
| `inventario.recibir_de_proveedor` | Registra una entrada de mercancía con su proveedor y costo unitario. | «Llegaron 24 botellas de agua de Distribuidora Caribe a 50 centavos»<br>«Recibe 10 proteínas del proveedor» | R1 | owner, location_manager | NUEVO: la recepción de stock no guarda proveedor ni costo; sin eso el P&L no tiene costo de ventas. |
| `mensajes.enviar_segmento` | Envía un mensaje a un segmento de socios (por estado, plan, clase o sede), respetando consentimiento y horario. | «Avísale a todos los de spinning que mañana no hay clase»<br>«Mándale un recordatorio a los morosos» | R2 | owner, location_manager | NUEVO: POST /v1/messages envía a un solo socio; no existe envío masivo ni por segmento. |
| `mensajes.cancelar_en_cola` | Cancela un mensaje programado que todavía no ha salido. | «Cancela el recordatorio que programé para mañana»<br>«No envíes el mensaje a Juan» | R1 | owner, location_manager | NUEVO: no hay ruta para cancelar mensajes en cola. |
| `mensajes.configurar_horario` | Configura la ventana horaria permitida para recordatorios y mercadeo. | «No mandes mensajes antes de las nueve»<br>«Cambia el horario de mensajes hasta las ocho de la noche» | R2 | owner | NUEVO: message_policy solo se cambia por SQL. |
| `mensajes.crear_plantilla` | Crea una plantilla de mensaje propia del gimnasio. | «Crea una plantilla de bienvenida»<br>«Guarda este mensaje como plantilla de cumpleaños» | R1 | owner, location_manager | NUEVO: hoy hay 5 plantillas fijas de la plataforma. |
| `mensajes.marcar_atendido` | Marca como atendido un mensaje entrante de la bandeja. | «Marca como atendido el mensaje de Ana»<br>«Ya contesté lo de Juan, ciérralo» | R1 | owner, location_manager | NUEVO: el permiso existe en la base pero no hay ruta. |
| `retos.editar` | Edita o cierra un reto (nombre, fechas, sede). | «Extiende el reto de pasos una semana»<br>«Cierra el reto de octubre» | R1 | owner, location_manager | NUEVO: la política de base existe pero no hay ruta. |
| `retos.retirar_participante` | Saca a un socio de un reto. | «Saca a Juan del reto de pasos»<br>«Retira a Ana del reto» | R1 | owner, location_manager | NUEVO: no hay ruta. |
| `coach.ver_escalaciones_resumen` | Muestra al dueño un resumen sin contenido clínico de las escalaciones abiertas por sede. | «¿Cuántos casos de seguimiento hay abiertos?»<br>«¿Hay socios esperando que un entrenador los llame?» | R0 | owner | NUEVO: hoy el dueño no tiene acceso a datos del coach por diseño (0016:138). Exponer siquiera un agregado es una decisión sobre datos de salud → humana. |
| `bitacora.filtrar` | Muestra la bitácora filtrada por origen (copiloto, manual, automatización, portal del socio, sistema), módulo, usuario y fecha, con el antes y después. | «Enséñame lo que hizo el copiloto hoy»<br>«¿Quién cambió el precio del plan básico?» | R0 | owner | NUEVO: audit_log no guarda origen, antes/después, sesión ni tool_call (0001_tenancy.sql:192); la pantalla /staff/audit no filtra por origen. Propuesta: extender audit_log (no tabla nueva). |
| `copiloto.editar_instrucciones` | Edita y versiona la instrucción de sistema del copiloto. | «Dile al copiloto que siempre me hable de usted»<br>«Vuelve a la versión anterior de las instrucciones» | R2 | owner | NUEVO: no existe almacenamiento de instrucciones versionadas. |
| `conocimiento.consultar` | Responde preguntas sobre cómo funciona el gimnasio y su operación usando la base de conocimiento (File Search), con citas. | «¿Cuál es la política de cancelación de clases?»<br>«¿Qué sabemos de la socia Ana Rivera?» | R0 | owner | NUEVO: no hay File Search stores ni clave de Gemini Developer API para RAG. Live API no soporta File Search como herramienta: se expone como función del servidor. |
| `conocimiento.reindexar_todo` | Regenera y vuelve a subir todos los documentos de conocimiento del gimnasio. | «Reindexa todo el conocimiento»<br>«Vuelve a cargar la información del gimnasio al copiloto» | R1 | owner | NUEVO: requiere knowledge_outbox, trabajador programado y panel de salud. |
| `conocimiento.ver_salud` | Muestra el retraso de sincronización y los eventos pendientes o fallidos del conocimiento. | «¿Está al día el conocimiento del copiloto?»<br>«¿Hay errores de sincronización?» | R0 | owner | NUEVO: depende de knowledge_outbox. |
| `reportes.generar` | Genera un reporte determinista guardado con sus parámetros y hash de datos (ingresos y cobros pendientes, asistencia por clase y franja, retención y bajas, ocupación, ventas e inventario, rendimiento por instructor). | «Genera el reporte de ingresos de octubre»<br>«Hazme el de asistencia por clase de esta semana» | R1 | owner | NUEVO: hoy los reportes son lecturas en pantalla sin guardar parámetros ni hash; faltan tipos (ver hallazgos del módulo reportes). |
| `reportes.analizar` | Redacta hallazgos y recomendaciones solo a partir del JSON de un reporte guardado. | «Analiza el reporte de ingresos»<br>«¿Qué me recomiendas según el reporte de asistencia?» | R0 | owner | NUEVO. |
| `reportes.auditar` | Verificador separado: recalcula desde la base cada cifra citada y marca cifras sin fuente, contradicciones y periodos mal aplicados. | «Audita el análisis de ingresos»<br>«Verifica las cifras del reporte» | R0 | owner | NUEVO. |
| `reportes.enviar` | Envía un reporte auditado sin hallazgos críticos por los canales del app, respetando consentimiento y horario. | «Mándale el reporte de ingresos a Nilda»<br>«Envía el resumen semanal a los gerentes» | R2 | owner | NUEVO: bloqueado si la auditoría tiene un hallazgo crítico. |
