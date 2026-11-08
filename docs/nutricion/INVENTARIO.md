# Nutrición — Fase 0: inventario (2026-11-08)

Fuente de verdad: el código. Las tablas pedidas como posibles (`nutrition_logs`, `nutrition_goals`, `coach_alerts`,
`workout_logs`) **no existen** (búsqueda en `packages/` y `apps/`: 0 coincidencias).

## 1. Lo que ya existe y se reutiliza
| Pieza | Dónde | Uso en el módulo |
|---|---|---|
| Evaluación firmada (peso, estatura, cintura, PA, FC, PAR-Q, condiciones declaradas, pruebas físicas) | `app.assessment` (`packages/db/migrations/0010_health.sql:104`); se firma y queda inmutable | Peso y estatura **medidos**; condiciones → bloqueos |
| Triaje determinista (verde/ámbar/rojo para ejercicio y **nutrición**, derivación médica, `no_calorie_counting` para menores) | `app.triage_result` (`0010:138`), regla `v0-propuesta` [VERIFICAR · equipo clínico] | Bloqueo: nutrición roja o derivación → «Requiere evaluación profesional» |
| Lista cerrada de condiciones | `app.health_conditions()` (`0010:31`): diabetes, ckd, cvd, pregnancy, lactation, glp1, eating_disorder_screen_positive, advanced_ckd, active_ed, high_risk_pregnancy | Bloqueos del pedido (diabetes, renal, cardiovascular, TCA, embarazo, lactancia, GLP-1) |
| Plan de cuidado de nutrición con versiones y aprobación licenciada (Ley 82) | `app.care_plan` kind `nutrition` (`0010:158`), guardián que exige licencia verificada (`0010:384`), autoría solo del rol `nutritionist` (`0010:215`) | Publicación al socio en modo A: el plan estructurado se publica como `care_plan` aprobado por el licenciado |
| Borrador de energía del coach (Mifflin con fecha de nacimiento por llamada, rechazos por triaje, menor, déficit en embarazo/TCA) | `app.coach_nutrition_draft` (`0016_coach.sql:444`); `mifflinStJeor`, `activityFactor` en `packages/shared/src/modules/coach.ts:470` | Se reutilizan las reglas de rechazo; los cálculos nuevos van en un módulo puro con pruebas de referencia |
| Portal del socio «Nutrición» (plan publicado + «aprobado por [nombre, licencia]») | `apps/web/src/modules/portal/NutritionScreen.tsx` | Se extiende con el plan semanal estructurado |
| Rutinas (circuitos con pasos: series, repeticiones, descanso; sede) | `app.circuit`, `app.circuit_step`, `app.circuit_run` (`0011_floor.sql`) | Sesiones planificadas → duración estimada → METs |
| Ejercicio realizado | `app.set_log`, `app.circuit_run` (inicio/fin), `app.equipment_use` (minutos por equipo, `0029`), `app.booking` (asistió), `app.check_in` (entrada/salida) | Gasto **real** del día frente al planificado |
| Clases (duración por sesión) | `app.class_session` (`0007_schedule.sql`) | Sesión planificada; el tipo de clase **no** tiene MET → mapeo nuevo |
| Mensajería con consentimiento por canal y propósito, ventana horaria | `app.outbound_message`, `app.consent`, `message_policy` (`0004_messaging_consent.sql`), canales `whatsapp`, `sms`, `email` | Plantillas y envíos de 3G |
| Auditoría solo de inserción | `app.audit_log`, `app.audit()` (`0001`, `0003`) | Toda generación, edición, aprobación, acceso y alerta |
| Proveedor de IA intercambiable (OpenAI, Anthropic) por variables de entorno | `resolveProvider` en `apps/api/src/modules/coach.ts:187` (en producción: deshabilitado) | Se añade Gemini y la interfaz común |
| Clave de Gemini en producción | `GEMINI_LIVE_API_KEY` (el token efímero de voz funciona en producción, verificado 2026-11-08) | Llamadas `generateContent` del servidor |
| Licencia del personal | `staff_member.license_no`, `license_verified_at` (`0001_tenancy.sql:152`) | Aprobación licenciada en modo A |

## 2. Tabla por dato requerido
| Dato | Fuente actual | Procedencia | Propuesta |
|---|---|---|---|
| Peso | `assessment.weight_kg` (última firmada) | medido | Usar la última evaluación firmada; si el socio declara un peso más reciente, guardarlo como «declarado» con fecha y mostrar ambos |
| Estatura | `assessment.height_cm` | medido | Igual que el peso |
| IMC | NO EXISTE (se puede calcular) | calculado | `peso / estatura²`, clasificación OMS |
| % de grasa | NO EXISTE (`fitness_tests` solo admite pushups, plank, sit-reach, chair-stand, step-test, walk-6min) | — | Campo nuevo `body_fat_pct` + `body_fat_method` en una tabla de mediciones de nutrición (medido); si falta, Deurenberg 1991 (estimado, con margen declarado) |
| Edad | NO EXISTE (el registro en línea **nunca guarda** la fecha de nacimiento, `0018_signup.sql:10`) | — | Fecha de nacimiento en el perfil nutricional (declarada, dato de salud con consentimiento); sin ella no se calcula Mifflin ni se descarta minoría de edad → bloqueo «datos insuficientes» |
| Sexo para las ecuaciones | NO EXISTE | — | Campo en el perfil («sexo usado en las ecuaciones: femenino/masculino», declarado, explicado) |
| Ingesta actual | NO EXISTE | — | Registro de comidas (3C) y, antes, una estimación declarada en el cuestionario |
| Objetivo corporal, ritmo y fecha meta | NO EXISTE estructurado (`member_goal` es solo entrenamientos por semana; memoria del coach es texto libre) | — | Perfil nutricional: objetivo (perder grasa, ganar masa, mantener, rendimiento), ritmo (% peso/semana), fecha meta |
| Plan de ejercicio de la semana | Circuitos (pasos con series/reps/descanso), clases reservadas (inicio/fin), plan de entrenamiento `care_plan` (texto) | planificado | Sesiones de la semana desde reservas de clase + circuito abierto + días declarados; duración del circuito estimada por fórmula documentada; MET por tipo de clase/equipo (Compendium 2011) con mapeo editable |
| Ejercicio realizado | `set_log`, `circuit_run`, `equipment_use`, `booking` asistida, `check_in` | medido | Minutos reales por día → ajuste del gasto real |
| Condiciones y medicamentos | `assessment.declared_conditions` (incluye GLP-1) + triaje | declarado (evaluación) | + cuestionario de salud del perfil (otros medicamentos que afectan apetito/peso, TCA pasado) con fecha |
| Alergias e intolerancias | NO EXISTE (solo texto libre en memoria del coach) | — | Perfil: lista cerrada de alérgenos (8 principales + intolerancias) → exclusión dura por grupo de alimento |
| Preferencias (gustos, estilo, cadenas, horario, meal prep, presupuesto) | NO EXISTE | — | Formulario 3B |
| Alimentos y valores | NO EXISTE | — | Tabla de alimentos sembrada desde USDA FDC SR Legacy (fdc_id, macros, medidas caseras oficiales) |
| Platos de cadenas de comida rápida | NO EXISTE | — | Catálogo con URL oficial y fecha de consulta; sin fuente, no entra |
| Fotos de comida | NO EXISTE (solo foto de perfil `member_photo`, `0023`) | — | Tabla nueva con consentimiento y borrado |
| Entrenador asignado | NO EXISTE (el entrenador ve por sede; `crm_task.assigned_staff_id` es por tarea) | — | Asignación socio↔entrenador (nueva) |
| Tiempo real | NO EXISTE (sondeo en pantallas existentes) | — | Sondeo cada 3 s con verificación de permiso en cada consulta |
| Costos de IA | NO EXISTE | — | Registro por llamada + topes |
| Widgets del dashboard | NO EXISTE (panel fijo) | — | Diseño guardado por usuario |
| Alertas con estado | Parcial: `crm_task`, `coach_escalation` | — | Bandeja de alertas de nutrición con estado y cierre automático |
| Tareas programadas | NO EXISTE en Netlify | — | Netlify Scheduled Function (cada hora) |
| Entrega de mensajes | NO EXISTE (la cola se llena pero nadie envía; sin credenciales Twilio/SendGrid) | — | Adaptador con fallback WhatsApp→SMS→correo, simulado hasta tener credenciales |

## 3. Enlace a cada socio existente
Migración que crea, para **cada socio de cada organización**, un perfil nutricional vacío en estado
`incompleto` (sin plan, sin datos de salud), y un disparador que lo crea al dar de alta un socio nuevo. Idempotente
(`ON CONFLICT DO NOTHING`). Los datos de salud del perfil solo se llenan con el consentimiento y el aviso aceptados.

## 4. Riesgos y límites detectados
- Ley 82 (Puerto Rico): prescribir un plan alimentario es facultad del licenciado; el guardián de la base ya lo
  refleja. Ver la decisión 4 en `STATE.md`.
- La fecha de nacimiento no se guardaba por diseño (minimización de datos en el registro). El módulo la pide como dato
  de salud con consentimiento y finalidad específica.
- Producción tiene 0 evaluaciones y 0 socios activos de Fitness R Us conocidos [VERIFICAR antes de la migración]: el
  enlace crea perfiles vacíos; no se genera nada sin datos.
