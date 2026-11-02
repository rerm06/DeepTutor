Especificación de producto · v0.5 · 2 nov 2026

# SaaS integral para centros de fitness con agentes de IA

BORRADOR · REQUIERE REVISIÓN LEGAL, FISCAL Y CLÍNICA Multi-tenant · marca blanca · multi-sede · Stripe Connect · Puerto Rico / EE. UU.

Evidencia: V verificado V-sec fuente secundaria I inferencia S supuesto P propuesta VERIFICAR pendiente legal/fiscal/proveedor

Secciones

- [0. Tesis del producto](#0-tesis-del-producto)
- [1. Lectura del mercado](#1-lectura-del-mercado)
- [2. Matriz de paridad competitiva (con KPI verificable)](#2-matriz-de-paridad-competitiva-con-kpi-verificable)
- [3. Arquitectura funcional](#3-arquitectura-funcional)
- [4. Stack técnico recomendado](#4-stack-tecnico-recomendado-p)
- [5. Pagos, facturación y suscripciones (Stripe)](#5-pagos-facturacion-y-suscripciones-stripe)
- [6. Onboarding y plan holístico (hueco H1)](#6-onboarding-y-plan-holistico-hueco-h1)
- [7. Sistema de agentes](#7-sistema-de-agentes)
- [8. Finanzas, gastos y cuentas por pagar (hueco H6)](#8-finanzas-gastos-y-cuentas-por-pagar-hueco-h6)
- [9. Comunidad, retos y fidelización (basado en evidencia)](#9-comunidad-retos-y-fidelizacion-basado-en-evidencia)
- [10. Marca blanca: 3 niveles y matriz de capacidades](#10-marca-blanca-3-niveles-y-matriz-de-capacidades)
- [11. Cumplimiento y riesgos regulatorios (borrador; requiere abogado y CPA)](#11-cumplimiento-y-riesgos-regulatorios-borrador-requiere-abogado-y-cpa)
- [12. Hoja de ruta (equipo de 6–8 personas; duraciones estimadas)](#12-hoja-de-ruta-p-equipo-de-68-personas-duraciones-estimadas)
- [13. Métricas de éxito](#13-metricas-de-exito)
- [14. Decisiones y riesgos](#14-decisiones-y-riesgos)
- [15. Backlog de F1: núcleo operativo](#15-backlog-de-f1-nucleo-operativo)
- [16. Lecciones de apoyo generadas con IA (microaprendizaje inmersivo)](#16-lecciones-de-apoyo-generadas-con-ia-microaprendizaje-inmersivo)
- [Anexo — Fuentes principales](#anexo-fuentes-principales)

Historial:

- **v0.2:** incorpora los 27 hallazgos de una auditoría adversaria independiente de la v0.1.
- **v0.3:** incorpora las 3 decisiones del cliente (comisión porcentual, equipo de nutrición y cocina como agentes de IA, Stripe Express en *public preview*) y el backlog de F1 (§15).
- **v0.4:** añade el módulo de lecciones de apoyo generadas con IA, con tutor de voz y simulación 3D (§16), basado en dos investigaciones adicionales (R5 y R6).
- **v0.5:** las lecciones de apoyo cubren dos audiencias (socios y personal) y se añaden los tutoriales de producto generados automáticamente (§16.11, épica E14). Se incorporan 3 detalles de panel observados en un tutorial de referencia: mapa de calor de horas pico, indicadores de vencimiento y saldo pendiente, y check-in rápido.

Convención de etiquetas:

- **V** verificado con fuente (anexo e informes de investigación R1–R4).
- **I** inferencia.
- **S** supuesto.
- **P** propuesta a validar.
- **VERIFICAR** requiere confirmación legal, fiscal o del proveedor.

---

## 0. Tesis del producto

El mercado está fragmentado en cuatro categorías que ningún proveedor une: (1) software de gestión de gimnasios, (2) apps de entrenamiento con IA, (3) apps y herramientas de nutrición, (4) hardware conectado. La plataforma cierra el ciclo completo en un solo producto multi-tenant con marca blanca:

**Evaluación profesional → plan holístico (entrenamiento + nutrición + tratamiento opcional) generado por IA y firmado por un profesional → ejecución en sala con el equipo real del club → coach diario con IA → retención en ciclo cerrado → agenda, acceso, facturación, finanzas y tienda.**

Mercado inicial S: Puerto Rico y EE. UU. hispano, en español latinoamericano nativo e inglés, con WhatsApp como canal de primera clase.

---

## 1. Lectura del mercado

### 1.1 Consolidación V

- ABC Fitness: Evo, Trainerize (2020), Glofox (2022) y Replify, plataforma de agentes de IA (27-jul-2026).
- Playlist (Mindbody, ClassPass, Booker) + EGYM, fusión cerrada el 31-mar-2026 por USD 7.500 M.
- Xplor Fitness & Leisure: Mariana Tek, Momence, Exerp, Resamania, ClubReady, TrueCoach.
- Sport Alliance (Magicline, PerfectGym); Daxko (Zen Planner); Zenoti entra en fitness (feb-2026).

Implicación I: los grandes compiten agregando piezas compradas. Su debilidad es la integración entre módulos, no la amplitud.

### 1.2 Hacia dónde va la IA del sector V

- **Recepción y ventas:** ABC AI Agents con Replify (voz, texto, email, chat, salientes); Mindbody AI Concierge (24/7); Evo con IA de ventas por WhatsApp.
- **Operar el negocio con lenguaje natural:** PushPress AI Assistant ejecuta acciones; Ask Wodify y GymMaster Gymmy analizan datos.
- **Abandono:** Wodify Retain (2022) y Glofox Members at Risk (beta).
- **Plan con IA revisado por un profesional:** EGYM Genius (editable por el entrenador, usa el inventario de la sede, exige al menos 3 máquinas Smart Strength) y Trainerize FitMetrics (borradores para el coach).
- **Coach para el socio:**
  - En consumidor: Google Health Coach, WHOOP Coach con memoria editable y Oura Advisor.
  - **En gimnasios:** Zing Coach ya se vende en marca blanca (FitActive, 192 clubes; NYSC "Myco", USD 15/mes) y Virtuagym ofrece MAX AI Coach para entrenadores.

### 1.3 Huecos del mercado

| # | Hueco | Evidencia |
| --- | --- | --- |
| H1 | Nadie une en un solo flujo evaluación inicial → plan de entrenamiento + nutrición con IA → aprobación profesional → seguimiento | EGYM: evaluación + entrenamiento sin nutrición. Trainerize: entrenamiento + nutrición sin evaluación física ni gestión del club. Virtuagym: nutrición con IA solo en su app de consumo V · R1 |
| H2 | Existen coaches IA en marca blanca (Zing, Virtuagym), pero no un coach **nativo de la plataforma de gestión** que use asistencia, evaluación presencial y plan firmado, adapte el plan y escale a un humano asignado | Los agentes de los grandes atienden recepción y ventas V · R1; Zing es un producto aparte que se integra I |
| H3 | Predicen el abandono, pero la intervención sigue siendo manual o una campaña genérica | V · R1 |
| H4 | Español latinoamericano nativo y WhatsApp para EE. UU. hispano y Puerto Rico | Glofox ofrece solo español de España; Evo es fuerte en LatAm V; no encontramos plataforma con foco en Puerto Rico I |
| H5 | Costos de IA ocultos | GymMaster exige clave API propia; Wodify cobra por créditos; Mindbody, Zen Planner y FitMetrics la limitan a planes superiores o add-ons V · R1 |
| H6 | No encontramos software de gimnasio con módulo de gastos o cuentas por pagar | V · R4 |
| H7 | Ninguna herramienta profesional de nutrición demuestra una base de alimentos caribeña; Fitia cubre lo latino en consumidor, según sus propias afirmaciones | V · R3 |
| H8 | Las apps de consumidor no tienen la señal de asistencia real, el inventario de equipos del club ni la evaluación presencial | V · R2 |

### 1.4 Datos de referencia V

- **Retención anual media:** 66,4 % en 2024 y crecimiento neto de socios del 5,5 % (HFA 2025 Benchmarking Report).
- **Clases vs. solo sala:** los socios que solo usan sala tienen 56 % más riesgo de baja que los de clases; 26 % ajustado (TRP 10,000, 2014; dato antiguo).
- **Microrecompensas** (Milkman et al., *Nature* 2021; 61.293 socios, 54 intervenciones de 4 semanas):
  - Alrededor del 45 % de las intervenciones subió las visitas entre 9 % y 27 %.
  - La mejor fueron microrecompensas con bono por volver tras faltar.
  - Solo alrededor del 8 % de los efectos persistió después del programa.
- **Gamificación competitiva** (STEP UP, *JAMA Intern Med* 2019, 602 adultos): fue la más eficaz y la única que mantuvo su efecto en el seguimiento.
- **Registro de comidas por foto:** subestima la energía alrededor de 33 % por comida (resumen preliminar de NIDDK/NIH, NUTRITION 2026). Se usará como herramienta de adherencia, nunca como medición.

---

## 2. Matriz de paridad competitiva (con KPI verificable)

**Política:** en cada módulo se debe **igualar** al mejor de su clase o **superarlo** con un diferenciador medible. La compuerta de lanzamiento (§7.3) usa la columna KPI.

| Módulo | Mejor del mercado hoy | Objetivo | Diferenciador | KPI de verificación P |
| --- | --- | --- | --- | --- |
| Agenda y acceso | Mindbody (reservas), GymMaster (acceso 24/7) | Paridad | Reserva, pago y acceso en un solo flujo por WhatsApp | Reservar una clase en 3 toques o menos; el acceso se activa en menos de 5 s tras el pago |
| Membresías y facturación | Glofox Intelligent Billing; precios públicos de PushPress | Paridad | Smart Retries + cobranza conversacional en español + cancelación fácil | Recuperación de cobros fallidos ≥ referencia medida en el piloto; 0 errores de IVU |
| CRM y leads | ABC AI Agents (Replify), Mindbody AI Concierge | Paridad | Agente de ventas que conoce disponibilidad, precios y evaluación por sede | Respuesta a un lead en menos de 60 s, 24/7; conversión de lead a prueba medida frente a la línea base |
| Operación por lenguaje natural | PushPress AI Assistant | Superar | Cubre finanzas, gastos e inventario; las acciones requieren confirmación | 20 tareas de referencia del dueño resueltas sin salir del chat |
| Retención | Wodify Retain, Glofox Members at Risk | Superar | Ciclo cerrado: predicción → intervención → tarea humana → medición contra control | Lift de retención a 90 días frente a un grupo de control agregado de la plataforma (§7.3) |
| Evaluación física | EGYM (seca, BioAge) | Paridad, integrando dispositivos | Evaluación multidisciplinaria con informe firmado que alimenta el plan | Informe entregado en menos de 24 h; 100 % firmado |
| Plan de entrenamiento con IA | EGYM Genius (usa el inventario; exige hardware EGYM), Trainerize | Superar | **Cualquier marca de equipo, sin hardware propietario**; ajuste diario por preparación del socio | Planes generados para sedes sin hardware conectado; el entrenador aprueba al menos el 80 % sin cambios mayores |
| Nutrición | Trainerize, That Clean Life, MacroFactor; Fitia (latino) | Superar | Flujo IA → chef → nutricionista licenciado + biblioteca caribeña analizada y firmada (§6.5) | Al menos 300 recetas caribeñas y latinas firmadas antes de lanzar F2; plan firmado en 72 h o menos |
| Coach diario | Google Health Coach, WHOOP; Zing Coach (B2B) | Paridad en conversación, superar en contexto | Usa asistencia, evaluación, plan firmado y entrenador asignado | Escalado humano correcto ≥ 95 % en el set de pruebas; uso semanal activo |
| Sala y equipos | EGYM, Technogym Mywellness | Paridad sin hardware | QR (y NFC en app nativa), circuitos y sustitución por taxonomía | Completar un circuito con 0 pasos manuales fuera de la app |
| Comunidad y retos | Hevy Gym Profiles, Mariana Tek, Hapana | Paridad | Retos por equipo y sede según la evidencia (§9) | Visitas por semana frente a control |
| Fidelización | Perkville, Virtuagym (puntos) | Superar | Puntos canjeables en la tienda propia + medición causal | Lift medido frente a control |
| Tienda y punto de venta | ABC Ignite (POS), Mindbody (online + inventario por sede) | Superar | Transferencias entre sedes, órdenes de compra, Terminal | Cuadre de inventario por sede sin hojas externas |
| Finanzas, gastos y cuentas por pagar | Nadie con gastos; Wodify con QuickBooks nativo | Superar (H6) | Gastos, cuentas por pagar, P&L por sede, ingresos diferidos | Cierre mensual de un piloto sin hojas de cálculo |
| Marca blanca | PushPress (más de 1.500 apps, una sola base de código) | Paridad | 3 niveles con matriz de capacidades (§10) | Alta de una marca nueva en PWA en menos de 1 día |
| Lecciones de apoyo y tutor de voz | Muscle & Motion (más de 1.200 ejercicios en 3D), Freeletics (video en 3 ángulos + Coach+), Zing (corrección por cámara, B2B) | Superar | Lecciones ligadas al plan firmado y a las **máquinas reales del club**; práctica verificada en sala por QR; tutor de voz en español (§16) | Finalización ≥ 70 % por lección; aciertos en el quiz de recuperación; práctica en sala dentro de 7 días de la lección |
| Precio de la IA | — | Superar (H5) | Coach, borradores y retención incluidos en **todos** los planes; solo la telefonía de voz se cobra aparte por su costo variable | Sin claves API del cliente ni créditos ocultos |

---

## 3. Arquitectura funcional

### 3.1 Multi-tenancy, identidad y permisos

Jerarquía: **Plataforma → Organización (cliente) → Entidad legal → Marca → Sede → Sala o zona → Activo**.

**Identidad:**

- Una cuenta global (`Person`) por ser humano.
- Un `Member` por organización, porque una misma persona puede ser socia de dos gimnasios sin que se crucen datos.
- El personal se modela con `StaffMember` por organización.

**Aislamiento de datos:**

- Toda fila lleva `org_id`; las tablas de una sede, además, `location_id`.
- Postgres aplica seguridad por fila (RLS) con un JWT por petición que lleva `org_id`, `location_ids` y `role`.
- **Los agentes y servicios internos usan el JWT del usuario que los invoca, nunca la clave de servicio.** La clave de servicio se limita a migraciones y tareas del sistema auditadas.
- Índices vectoriales y cachés particionados por `org_id`.
- Prueba automática en CI: matriz de roles × sedes × organizaciones donde cada acceso indebido debe fallar.

**Roles (RBAC por sede):**

- Dueño
- Gerente de sede
- Recepción
- Entrenador
- Nutricionista (licencia verificada)
- Chef
- Clínico (licencia verificada, módulo clínico)
- Contador (solo lectura de finanzas)
- Socio
- Tutor de un menor

**Tema por marca:** logo, colores, tipografía, dominio, remitente de email, número de WhatsApp (una WABA por marca) y número de SMS (registro A2P 10DLC por marca, §11).

**Cuenta de Stripe:** una cuenta conectada por entidad legal (§5.1).

### 3.2 Módulos (16)

1. **Clientes, marcas y sedes:** alta autoservicio del gimnasio y migración desde otro software (CSV de socios, planes, saldos e historial).
2. **CRM:** leads con origen, embudo, tours, pruebas gratis, ficha 360° y puntuación de riesgo de abandono.
3. **Agenda y acceso:**
   - Clases con aforo, lista de espera, reglas de cancelación y no-show (penalidad configurable).
   - Citas de entrenamiento personal, evaluación, nutrición y clínico.
   - Disponibilidad del personal.
   - Credenciales de acceso (QR dinámico en la app, tarjeta o llavero RFID) y check-in por puerta, app o recepción.
   - Conectores a 1–2 sistemas de control de acceso en F1 P · proveedores a elegir en F0.
   - Pase diario o entrada única: crea una credencial válida durante una ventana configurable.
4. **Membresías y facturación:** ver §5.
5. **Pagos:** ver §5.
6. **Finanzas, gastos y cuentas por pagar:** ver §8.
7. **Evaluación profesional:**
   - PAR-Q+, signos vitales básicos, antropometría y composición corporal (manual o por integración).
   - Pruebas de fuerza, movilidad y cardio; historial y objetivos.
   - Informe para el socio en PDF y web, firmado por el evaluador.
   - Reevaluación cada 8–12 semanas P.
8. **Planes:** entrenamiento, nutrición y tratamiento. Cada uno con versiones, estados (borrador → revisión → aprobado → publicado → archivado), firma y justificación.
9. **Módulo clínico (activable por organización):** ver §6.6.
10. **Sala y equipos:** ver §6.4.
11. **Progreso:** métricas, comparación con la evaluación base e informes mensuales que revisa el entrenador.
12. **Retos y comunidad:** muro de logros moderado, retos, clasificaciones opcionales y privacidad por defecto para principiantes.
13. **Fidelización:** puntos por eventos, niveles, referidos con crédito y canje en la tienda. El saldo de puntos se registra como pasivo (§8).
14. **Contenido, lecciones y tutor (literatura e información):** lecciones de microaprendizaje generadas con IA, tutor de voz y simulación 3D (§16). - Artículos, videos de ejercicios y recetas, cada pieza con autor, revisor profesional, fecha de revisión y citas en formato APA. - Solo contenido propio, con licencia o de fuentes que permiten reproducción. Si no, se publica resumen y enlace.
15. **Tienda:** - Catálogo único, inventario por sede y tienda online como "sede virtual". - Transferencias entre sedes, órdenes de compra, reorden y comisión por venta. - Política de suplementos en §11.
16. **Agentes de IA:** ver §7.

### 3.3 Entidades principales

- **Organización e identidad:** `Organization, LegalEntity(stripe_account_id), Brand, Location, Zone, Asset, Person, Member(org_id, person_id), StaffMember(role, license), Guardian, Lead`
- **Agenda y acceso:** `Class, ClassSession, Booking, Waitlist, Appointment, StaffAvailability, AccessCredential, CheckIn(source)`
- **Cobros:** `PlanProduct(kind: membership|class_pack|day_pass|drop_in|pt_package|addon), Subscription, Invoice, Payment, Refund, CreditBalance, StripeCustomerLink(member_id, stripe_account_id, customer_id)`
- **Planes y evaluación:** `Assessment, TriageResult(rule_version), CarePlan(kind, version, status, approved_by), ClinicalNote, Consent(channel, purpose, granted_at, source)`
- **Entrenamiento:** `Exercise(movement_pattern, equipment_type), Workout, Circuit, CircuitStep(asset_id|equipment_type), SetLog`
- **Nutrición:** `MealPlan, Recipe(cuisine, allergens, cost, nutrient_source, approved_by_chef, approved_by_rd), FoodLog`
- **Comunidad y fidelización:** `Challenge, PointsLedger, Referral, Post, Achievement`
- **Tienda:** `Product(category, age_restricted), InventoryLot, StockTransfer, PurchaseOrder, Sale`
- **Finanzas:** `Vendor, Bill, BillApproval, Expense, Commission, DeferredRevenueSchedule, JournalExport`
- **IA:** `AgentRun(agent, acting_user, inputs_ref, outputs_ref, human_gate, approved_by)`

---

## 4. Stack técnico recomendado P

| Capa | Decisión | Por qué | Descartado |
| --- | --- | --- | --- |
| Base de datos | PostgreSQL gestionado con RLS (Supabase o equivalente) | Aislamiento multi-tenant en la capa de datos | Una base por cliente: costo operativo alto con cientos de gimnasios |
| Backend | TypeScript (Node) para el dominio y la API; servicio Python para los agentes, que llama a la API con el JWT del usuario | Tipos compartidos con el frontend; ecosistema de IA en Python; los agentes no saltan los permisos | Agentes con acceso directo a la base |
| Clientes | Next.js + PWA con tema por marca; app nativa (React Native o Expo) para el socio y una **app nativa de personal** (POS, check-in, NFC) | La PWA no accede a HealthKit, NFC en iOS ni Tap to Pay (§10) | Solo PWA |
| Pagos | Stripe Connect + Billing + Terminal + Tax | §5 | — |
| Mensajería | WhatsApp Business API, SMS y email, con gestión de consentimientos | Hueco H4; TCPA (§11) | — |
| IA | Modelo de frontera por API con retención cero de datos y BAA disponible para el módulo clínico; registro de auditoría y evaluaciones automáticas | §7, §11 | Clave API del cliente (H5) |
| Contabilidad | Conectores a QuickBooks Online y Xero; exportación de nómina a Gusto o ADP | §8 | Procesar nómina |

---

## 5. Pagos, facturación y suscripciones (Stripe)

### 5.1 Configuración de Connect (decidida con el cliente)

- **Cargos directos** a la cuenta conectada de cada **entidad legal**. El gimnasio es el vendedor oficial: su nombre aparece en el estado de cuenta y gestiona reembolsos y disputas.
- **Tarifas de Stripe:** las paga el gimnasio (`fees_collector: "stripe"`).
- **Riesgo de saldo negativo:** a cargo de Stripe (`losses_collector: "stripe"`, Managed Risk), con Radar for Platforms activo.
- **Panel:** Express más componentes integrados en el panel de marca blanca.
  - Siempre: `account_onboarding`, `notification_banner`, `account_management`.
  - Además: `payments`, `payouts`, `balance_report`, `payout_reconciliation_report`.
- **Decisión del cliente: se acepta la *public preview*** (panel Express con tarifas y riesgo a cargo de Stripe). Condiciones de uso:
  - Todas las llamadas de Connect usan la versión preliminar de la API indicada en el [changelog de previews](https://docs.stripe.com/changelog.md?preview=true). La versión se fija en la configuración y se revisa en cada versión del producto.
  - Solo aplica a cuentas **nuevas**. Ningún gimnasio se migra desde una cuenta existente: si ya tiene una cuenta de Stripe, se crea una cuenta conectada nueva.
  - El tipo de panel es **permanente** por cuenta.
  - En F0 se confirma por escrito con Stripe la elegibilidad de la plataforma y se registra la fecha prevista de disponibilidad general.
  - **Plan de contingencia:** si la preview cambia de términos o se retira, las cuentas nuevas pasan a panel completo de Stripe (`dashboard: "full"`), con tarifas y riesgo a cargo de Stripe y cargos directos. El código aísla el tipo de panel en un solo módulo de configuración para que el cambio no toque los flujos de cobro.
- **Modelo de cuentas (Accounts v2):** `configuration.merchant`, más `configuration.customer` para que la plataforma cobre al gimnasio su suscripción SaaS (`customer_account` en SetupIntent y Subscription).

**Comisión de la plataforma: porcentaje** (el cliente delegó la decisión; v0.3).

Por qué porcentaje y no monto fijo:

- **Soporte nativo en Billing.** Las suscripciones aceptan `application_fee_percent`. No hace falta interceptar cada factura con el webhook `invoice.created`, que añade un punto de falla en cada renovación.
- **Proporcional al ticket.** Un monto fijo pesa demasiado en un pase diario de USD 10 y es irrelevante en un paquete de entrenamiento de USD 600.
- **Reembolsos simples.** La parte proporcional de la comisión se devuelve con `refund_application_fee: true`.

Mecánica:

- **Tasa por plan del SaaS** P: Esencial 1,0 %, Pro 0,75 %, Élite 0,5 %. La tasa baja al subir de plan, lo que incentiva el cambio a planes superiores. Se valida en las entrevistas de F0.
- **Suscripciones:** `application_fee_percent` con la tasa del plan del gimnasio. Si el gimnasio cambia de plan, un proceso actualiza las suscripciones activas en el siguiente ciclo.
- **Pagos únicos, Checkout y Terminal:** `application_fee_amount = round(monto × tasa)`, calculado en el servidor.
- **La base de la comisión incluye el IVU**, porque Stripe la calcula sobre el total cobrado I. Si se quiere excluir, se calcula el monto sin impuesto y se usa `application_fee_amount` también en suscripciones (opción descartada por complejidad).
- **Reembolsos:** la comisión se devuelve proporcionalmente con `refund_application_fee: true` P.
- **Disputas:** la comisión no se devuelve automáticamente; la regla se publica en los términos del SaaS P.

**Varias sedes:**

- Cada pago lleva `metadata.location_id` obligatorio, para el P&L por sede dentro de una misma cuenta.
- Con cargos directos, el `Customer` y sus métodos de pago existen **por cuenta conectada**. Si un socio usa sedes de dos entidades legales distintas (franquicias), tiene un `Customer` en cada cuenta (`StripeCustomerLink`) y vuelve a ingresar la tarjeta.
- Las membresías válidas en varias sedes se permiten solo dentro de una misma entidad legal. Entre entidades se requiere un acuerdo de reparto **fuera de Stripe** P.

**Robustez:**

- Webhooks de Connect con encabezado `Stripe-Account`.
- Claves de idempotencia en toda escritura.
- Reconciliación diaria del estado de Stripe contra la base de datos.
- VERIFICAR qué ajustes de Billing (Smart Retries, emails al cliente, portal) puede configurar la plataforma en cuentas Express mediante la API frente a los que requieren el panel del gimnasio.

### 5.2 Productos de cobro (en la cuenta del gimnasio)

| Producto | Mecanismo | Reglas |
| --- | --- | --- |
| Membresía con renovación automática | Billing Subscriptions | Prorrateo, cambios de plan, cuota de inscripción como cargo inicial. **Congelamiento:** `pause_collection` solo detiene el cobro y no mueve el periodo; para congelar de verdad se usa Subscription Schedule o se reajusta el ancla de facturación con `trial_end`, y se extiende la permanencia. La permanencia mínima solo se aplica donde la ley lo permita (§11) |
| Pase diario o entrada única | Checkout o PaymentIntent | Emite `AccessCredential` con ventana configurable |
| Clase suelta o paquete de N sesiones | PaymentIntent + `CreditBalance` | Vencimiento según la política de la sede; el ingreso se difiere hasta el uso (§8) |
| Paquete de entrenamiento personal | Invoice o Subscription | Comisión del entrenador asociada |
| Facturas automáticas | Invoicing | Numeración por entidad, IVU desglosado, PDF con la marca |
| Recordatorios | Webhooks de Billing (`invoice.upcoming`, `invoice.payment_failed`, `customer.subscription.trial_will_end`) + motor de mensajes | Aviso previo a la renovación; tarjeta por vencer; recordatorio de cita 24 h y 2 h antes P; siempre con consentimiento (§11) |
| Cobros fallidos | Smart Retries + agente de cobranza | Escala a recepción tras N intentos P; suspender el acceso lo decide un humano |
| Venta presencial | Stripe Terminal: lectores inteligentes desde el servidor (WisePOS E, S700) en la **app web de recepción**; M2 y Tap to Pay en la **app nativa de personal** | M2 documentado para PR V; Tap to Pay en PR VERIFICAR · con Stripe por escrito |
| Tienda online | Checkout con inventario de la sede virtual | Bienes físicos fuera del sistema de compras de Apple y Google |

### 5.3 Impuestos en Puerto Rico

- **Tasas:** IVU de 11,5 % (10,5 % estatal + 1 % municipal) V; 4 % para servicios entre comerciantes y servicios profesionales designados V.
- **Qué tributa:**
  - Las cuotas de gimnasios con fines de lucro. Están exentos los gimnasios sin fines de lucro y los operados por hospitales V.
  - Los suplementos, excluidos de "alimento" V.
  - El entrenamiento personal, probablemente tributable VERIFICAR.
  - La exención para pequeños proveedores de servicios (ventas hasta USD 50.000) VERIFICAR.
- **Declaración:**
  - Desde julio de 2026, 73 municipios declaran el IVU municipal junto al estatal en SURI (SC 2915).
  - Los municipios no participantes siguen su propio proceso V.
  - El reporte de la plataforma separa estatal y municipal **por municipio** y marca los no participantes.
- **Motor de cálculo:** Stripe Tax V. Que genere el formato SC 2915 está VERIFICAR. Si no lo hace, la plataforma produce el reporte.
- **En el alta del gimnasio:** número de registro de comerciante de Hacienda y certificado de exención si aplica.
- **IVU de la propia plataforma:** sobre la cuota SaaS y la comisión que cobra a los gimnasios (posible 4 % entre comerciantes) VERIFICAR · con CPA.

### 5.4 Ingresos de la plataforma P (validar con 10–15 entrevistas a dueños en F0)

Referencias de precio V: PushPress Pro USD 159 y Max USD 229; Zen Planner USD 99–348; GymMaster USD 89–209; Gymdesk USD 75–200; Mindbody desde USD 79 por sede.

| Plan | Por sede al mes P | Incluye |
| --- | --- | --- |
| Esencial | USD 149 | Agenda y acceso, membresías, facturación, CRM, PWA de marca, coach IA, retención, tienda |
| Pro | USD 279 | + evaluación, planes de nutrición con flujo profesional, sala y equipos, retos, fidelización, finanzas y cuentas por pagar |
| Élite | USD 449 | + agentes de voz (telefonía con costo variable), inteligencia de mercado, módulo clínico (con BAA), API |

Complementos:

- App nativa con la marca del gimnasio en las tiendas.
- Comisión porcentual por transacción según el plan (§5.1), además de las tarifas de Stripe que paga el gimnasio.

---

## 6. Onboarding y plan holístico (hueco H1)

### 6.1 Flujo

1. **Pre-onboarding** (IA, conversacional, en la app o por WhatsApp con consentimiento): objetivos, horario, experiencia, lesiones, preferencias, cultura alimentaria, presupuesto, alergias y medicación. **No se recopilan datos clínicos por WhatsApp** (§11). Los datos de salud se capturan en la app o la web.
2. **Triaje de seguridad (determinista, §6.2).**
3. **Evaluación presencial (especialista):** calibra las cargas desde el día 1 y evita el arranque en frío de 10–15 sesiones que necesitan apps como Fitbod V.
4. **Borradores con IA:**
   - Entrenamiento: con la taxonomía de ejercicios y el inventario de la sede.
   - Nutrición: metas y plan de 7 días desde la biblioteca firmada (§6.5).
   - Tratamiento: solo con el módulo clínico.
5. **Agente chef (minutos, no días):** viabilidad, porciones, costo y adaptación local. No toca las metas.
6. **Aprobación (§6.7):**
   - El entrenador firma el entrenamiento.
   - La nutrición sigue el **modo operativo** de la organización. En el modo por defecto la aprueba en lote un nutricionista licenciado supervisor. Ámbar y rojo siempre requieren licenciado y referido médico.
   - El clínico firma el tratamiento.
7. **Publicación en el portal:** plan holístico, informe de evaluación, metas a 4, 8 y 12 semanas y entrenador asignado.
8. **Seguimiento:**
   - Check-in diario.
   - Ajustes semanales: dentro de rangos preaprobados se aprueban en lote; fuera de ellos, uno a uno.
   - Consulta de nutrición cada 4 semanas y reevaluación cada 8–12 semanas P.

### 6.2 Tabla de decisión de triaje

Es **determinista**: no la decide un modelo generativo. Está versionada (`rule_version`) y la firma el equipo clínico antes de F2. Esta propuesta la debe validar el equipo clínico.

| Señal | Ejercicio | Nutrición |
| --- | --- | --- |
| PAR-Q+ sin respuestas positivas | Verde | Verde |
| PAR-Q+ positiva, resuelta con las preguntas de seguimiento del propio PAR-Q+ | Verde con modificaciones | Verde |
| PAR-Q+ positiva no resuelta | **Ámbar:** autorización médica o ePARmed-X+ antes de un programa vigoroso P | Según la condición |
| Diabetes, ERC, enfermedad cardiovascular conocida | Ámbar (autorización médica) | **Ámbar:** referido médico obligatorio en PR (Ley 82) V; plan solo por licenciado |
| Embarazo o lactancia | Ámbar | Ámbar; sin déficit calórico P |
| Uso de GLP-1 u otra medicación que afecte el apetito o la glucosa | Verde/ámbar según el PAR-Q+ | **Ámbar**; coordinación con el médico tratante |
| Tamizaje de trastorno alimentario positivo | Verde/ámbar | **Rojo:** no se genera plan con conteo de calorías; se deriva a un profesional |
| Menor de 18 | Requiere tutor; programa juvenil | **Sin conteo de calorías**; solo educación nutricional general P |
| ERC avanzada, TCA activo, embarazo de alto riesgo | Rojo si lo indica el médico | **Rojo:** se deriva, no se genera plan |

**Protocolo de emergencia** (síntomas agudos reportados en el onboarding o en el chat: dolor torácico, síncope, falta de aire grave):

- El agente detiene la conversación y muestra **"Llama al 911"** junto con el número de la sede.
- Notifica al gerente de turno, con confirmación de recibo exigida en un plazo de 15 minutos P.
- Fuera de horario: solo instrucción de emergencia, y queda registrado.
- El personal de sala sigue el plan de emergencia de la sede (RCP y DEA). La plataforma registra que el plan está cargado y vigente.

### 6.3 Coach diario (hueco H2)

- **Check-in diario:**
  - En la app nativa: HealthKit o Health Connect más 3 preguntas (sueño, dolor, energía).
  - En la PWA: solo las 3 preguntas (§10).
- **Ajuste de la sesión:** solo dentro de los rangos que aprobó el entrenador. Por ejemplo, ±10 % de carga o cambiar por un ejercicio del mismo patrón de movimiento P.
- **Memoria del socio:** visible, editable y borrable, compartida con el entrenador.
- **Cada ajuste se explica** en una línea.
- **Rutinas pedidas por el socio** (texto, voz o captura): se generan **solo desde plantillas aprobadas por el entrenador** o quedan como borrador hasta que él las apruebe. Si el socio pide algo fuera de su plan, el coach lo marca para el entrenador.
- **Escalera de acompañamiento:** IA incluida → grupo con coach → 1:1 híbrido.
  - Escala automáticamente a un humano por dolor, 14 días sin asistir P o estancamiento.
  - **Ante una señal de trastorno alimentario:** pausa el déficit y los ajustes automáticos de nutrición, oculta los números y exige revisión de la nutricionista antes de reanudar.
- **El socio sabe que habla con una IA:** aviso visible, "no es un dispositivo médico" y botón "hablar con una persona".

### 6.4 Sala, equipos y circuitos

- **Inventario de activos por sede:** tipo, marca, ubicación, estado y mantenimiento.
- **Taxonomía de ejercicios:** cada ejercicio tiene un patrón de movimiento (empuje horizontal, bisagra, etc.) y un tipo de equipo. Un paso del circuito puede apuntar a un activo concreto o a un tipo de equipo.
- **Etiqueta por máquina:** QR en todas las versiones; NFC solo en la app nativa, porque iOS no tiene Web NFC.
  - Al escanear se abre el ejercicio y su video, se registran las series, se avanza en el circuito y se marca la estación como completada.
- **Si una máquina no está disponible:**
  - "Fuera de servicio": lo marca el personal o lo reportan los socios, y se confirma.
  - "Ocupada": la reporta el socio con un toque, y se le ofrece un sustituto del mismo patrón con otro equipo disponible.
  - La ocupación de cada máquina **no se detecta**. Solo se infiere de escaneos recientes y se muestra como estimación.
- **Ocupación de la sede:** check-ins menos salidas estimadas, con conector opcional a sensores.
- **Conectores opcionales** a EGYM y Mywellness en F5 I · sus APIs pueden ser cerradas o de pago.

### 6.5 Biblioteca de recetas latinas y caribeñas (hueco H7)

- **Responsable:** agente chef y agente de planificación alimentaria producen las recetas. Un nutricionista licenciado contratado por la plataforma valida una vez el análisis nutricional de cada receta y la biblioteca; no hace falta revisar cada plan.
- **Meta:** al menos 300 recetas antes de F2 P, con más de 25 alimentos base caribeños sin datos fiables documentados.
- **Datos nutricionales:** USDA FoodData Central como base. Para los alimentos que faltan (viandas o preparaciones locales), análisis por receta estándar y, si hace falta, laboratorio P.
- **Etiquetas:** alérgenos (los 9 principales de EE. UU.), costo, tiempo y equipo de cocina.
- **Validación:** el análisis nutricional lo firma un licenciado de la plataforma; se revisa cada 12 meses.
- **Presupuesto:** a estimar en F0 P.

### 6.6 Módulo clínico (decisión del cliente: activable por organización; núcleo en F2)

- **Activación:**
  - El gimnasio declara qué profesiones ejerce (fisioterapia, nutrición clínica, otras) y en qué jurisdicción.
  - La plataforma verifica las licencias contra el registro de la junta correspondiente P.
- **Funciones:** consentimiento informado, plantillas por profesión, notas de sesión (SOAP), plan de tratamiento con objetivos y sesiones, seguimiento de adherencia, informes al médico referente y referidos entrantes y salientes.
- **Telesalud:** sujeta al Reglamento 9518 de PR V · existe; requisitos a VERIFICAR.
- **Datos:**
  - Separados del resto de la plataforma, con cifrado por campo y registro de cada acceso.
  - Mínimo necesario; no se usan para entrenar modelos.
  - El proveedor de IA debe tener BAA y retención cero.
  - **Ningún dato clínico va por WhatsApp**: Meta no ofrece BAA para WhatsApp I · VERIFICAR. Solo se envían notificaciones genéricas ("tienes un mensaje en tu portal").
- **HIPAA:** su aplicación depende de si el gimnasio o el profesional es entidad cubierta VERIFICAR · con abogado por cliente. La plataforma opera el módulo **como si HIPAA aplicara**.

### 6.7 Equipo de nutrición y cocina: agentes de IA configurados (decisión del cliente, v0.3)

**Agentes** (configurables por organización: cocina, presupuesto, tono, idioma, biblioteca de recetas y reglas):

- **Agente de planificación alimentaria:** calcula rangos de energía y macros con fórmulas estándar (p. ej., Mifflin-St Jeor), arma el plan de 7 días desde la biblioteca, propone ajustes semanales y detecta alertas.
- **Agente chef:** recetas, sustituciones, porciones, lista de compras con costo y adaptación cultural.
- **Agente de seguimiento nutricional:** check-ins, registro de comidas por foto como apoyo a la adherencia, y escalado.

**Límite legal en Puerto Rico** (Ley 82, texto oficial revisado el 2-nov-2026) V:

- El Art. 1(c) atribuye al profesional licenciado la facultad de "prescribir un plan alimentario" a personas en condiciones óptimas de salud, y en casos de enfermedad **solo con referido médico**.
- El Art. 9 tipifica como delito menos grave practicar la profesión **o anunciarse como** nutricionista o dietista sin licencia: multa de USD 100–500 y/o reclusión de 1 a 6 meses.
- Consecuencias para el producto:
  - Los agentes **nunca se llaman ni se presentan como "nutricionista" o "dietista"**, ni en la interfaz, ni en el marketing del gimnasio, ni en lo que responden.
  - Si un plan individualizado generado solo por IA, sin un licenciado, constituye "práctica" de la profesión **no está resuelto** VERIFICAR · opinión legal formal en F0. Por eso el diseño no depende de esa respuesta.

**Modos operativos** (la organización elige; el modo por defecto es A):

| Modo | Quién aprueba | Para quién | Qué ve el socio |
| --- | --- | --- | --- |
| **A · IA con supervisión licenciada** (por defecto) | Un nutricionista licenciado revisa en una cola. Los planes verdes dentro de parámetros se aprueban **en lote**; solo las excepciones se revisan una a una | Verde. Ámbar con referido médico, con revisión individual | "Plan alimentario aprobado por \[nombre, n.º de licencia\]" |
| **B · Orientación general automática** | Nadie; solo si la opinión legal de F0 es favorable | Solo verde | "Orientación general de alimentación; no es un plan alimentario prescrito". Sin lenguaje terapéutico |
| Ámbar o rojo | Siempre un licenciado y referido médico; en rojo no se genera plan | — | — |

**Quién es el licenciado supervisor en el modo A** (elige el gimnasio):

1. Su propio nutricionista, de planilla o por contrato.
2. Un nutricionista de una **red supervisora** de la plataforma, cobrado como complemento por socio activo P. Esto cambia la responsabilidad profesional y requiere seguro de mala práctica. El cobro sigue siendo un cargo directo del gimnasio y el profesional factura a la plataforma P · validar con abogado.

**Economía unitaria a medir en F2** P: minutos de revisión por plan verde (objetivo de diseño: 5 o menos), socios por supervisor y costo por socio al mes. La ventaja de este modelo frente a la competencia: el trabajo del profesional pasa de **crear** el plan a **aprobarlo**.

**Fuera de Puerto Rico:** las reglas de terapia médica nutricional varían por estado (§11). El modo B se desactiva por defecto donde no haya opinión legal.

---

## 7. Sistema de agentes

### 7.1 Agentes del producto

| Agente | Usuario | Puede | Compuerta humana |
| --- | --- | --- | --- |
| Coach diario | Socio | Conversar, ajustar dentro de rangos, registrar | Metas y planes nuevos los aprueba el entrenador o el nutricionista |
| Planificación alimentaria | Socio y supervisor | Calcular rangos y armar planes desde la biblioteca; ajustes semanales | Según el modo (§6.7). Nunca se presenta como "nutricionista" |
| Chef | Socio | Sustituciones, recetas, porciones y lista de compras con costo | No cambia metas; los alérgenos los valida un filtro determinista |
| Seguimiento nutricional | Socio | Check-ins, registro de comidas y alertas | Ante una señal de TCA, pausa y escala al licenciado |
| Evaluación | Especialista | Resumir pruebas y redactar el informe | Firma del especialista |
| Guardián de seguridad | Todos | Aplicar la tabla de triaje y detectar banderas en cualquier conversación | **Veto**; no se puede desactivar |
| Retención | Gerente y entrenador | Calcular el riesgo, proponer la intervención y crear la tarea | Descuentos solo dentro de la política |
| Cobranza | Recepción | Mensajes de cobro fallido y enlace para actualizar la tarjeta | Suspender el acceso lo decide un humano |
| Ventas y recepción | Leads | Responder, agendar tours y vender pases | Sin promesas de salud; solo con consentimiento |
| Analista y operador | Dueño y gerente | Consultar y preparar acciones | Reembolsos, precios y pagos requieren confirmación |
| Moderador | Sistema | Filtrar el muro | Bloquear usuarios requiere revisión humana |

### 7.2 Contrato de orquestación ("agentes en colaboración")

- **Orquestador por evento** (onboarding, check-in, cobro fallido, mensaje entrante). Cada evento tiene un agente dueño. Los demás actúan como herramientas con entradas y salidas tipadas.
- **Memoria compartida:** la ficha del socio y su plan vigente son la única fuente de verdad.
  - Los agentes escriben **propuestas** (`CarePlan` en borrador, tareas).
  - Solo los humanos con rol escriben estados aprobados.
- **Precedencia ante conflictos:**
  1. Guardián de seguridad.
  2. Plan firmado por el profesional.
  3. Política de la sede.
  4. Preferencia del socio.
  5. Sugerencia de la IA.
- **Veto del guardián:**
  - Se evalúa **antes y después** de cada respuesta de cualquier agente que toque salud (pre-check del mensaje y post-check de la salida).
  - Un resultado rojo bloquea la respuesta y dispara el protocolo de §6.2.
- **Permisos:** cada agente actúa con el JWT del usuario que lo invocó (§3.1). Ningún agente tiene más permisos que su usuario.
- **Defensa contra inyección de instrucciones:**
  - El contenido externo (mensajes de leads, documentos, recibos) se trata como dato, nunca como instrucción.
  - Las herramientas que escriben datos o mueven dinero exigen confirmación humana.
  - Hay listas de herramientas permitidas por agente.
- **Calidad:**
  - Set de evaluaciones automáticas por agente (casos en español e inglés, seguridad clínica, intentos de inyección).
  - Umbral por versión P y red-teaming trimestral.

### 7.3 Agentes de investigación, planificación y validación (gobierno competitivo)

Pipeline mensual y obligatorio antes de cada versión mayor:

1. **Investigación.**
   - Vigila a unos 40 competidores en 4 categorías: notas de prensa, changelogs, precios, App Store y reseñas.
   - Produce el *Radar competitivo*. Cada hallazgo lleva fuente, fecha y V o NV.
   - Limitación declarada: un agente no puede probar productos cerrados.
2. **Análisis humano complementario.** Un analista de producto prueba trimestralmente los 5 competidores principales con cuentas de demostración y registra evidencia (capturas, flujos).
3. **Planificación.** Convierte el radar en cambios a la matriz §2 y propuestas de hoja de ruta. Cada propuesta indica impacto, esfuerzo, referencia del mejor de su clase, KPI e hipótesis.
4. **Validación.**
   - Auditoría sin puntajes previos. Mide los KPI de §2 sobre la versión candidata.
   - Devuelve, por módulo, **Paridad / Superior / Por debajo**, con evidencia.
   - Revisa además cumplimiento (§11), seguridad clínica, accesibilidad (WCAG 2.2 AA) e idioma.
5. **Compuerta de lanzamiento:**
   - Ningún módulo marcado "Superar" puede quedar "Por debajo" en su KPI.
   - Si queda, la versión se bloquea o el módulo se publica como beta.
   - Los efectos de retención y fidelización se miden con **experimentos agregados a nivel de plataforma** (asignación aleatoria por socio entre varios gimnasios), porque un solo gimnasio no tiene potencia estadística.
6. **Decisión humana.** El responsable de producto aprueba el radar y la hoja de ruta.

Para el dueño (plan Élite):

- *Benchmark* de su sede contra datos agregados y anonimizados.
- Solo con al menos N organizaciones por grupo P.
- Requiere consentimiento de uso de datos agregados en el contrato SaaS.

---

## 8. Finanzas, gastos y cuentas por pagar (hueco H6)

- **Base contable:** devengo P, con conciliación a caja.
  - Membresías: ingreso diferido y reconocimiento lineal en el periodo.
  - Paquetes y créditos: ingreso diferido hasta el uso o el vencimiento.
  - Puntos de fidelización: pasivo hasta el canje o la caducidad.
- **Ingresos:** por producto, sede y entrenador; IVU; comisiones (sesión, venta de tienda, membresía vendida) y propinas.
- **Cuentas por pagar:**
  - Proveedores, facturas de proveedor con vencimiento y flujo de aprobación por monto y rol.
  - Registro del pago (fuera de la plataforma en F4 P).
  - Gastos sueltos con recibo y extracción por IA, que confirma un humano.
  - Gastos recurrentes (renta, utilidades).
- **Reportes:** P&L por sede y consolidado, flujo de caja y conciliación de depósitos de Stripe (comisiones, reembolsos, disputas) e inventario.
- **Exportación diaria de asientos resumidos:**
  - QuickBooks Online: Location o Class; requiere los planes Plus o Advanced V.
  - Xero: *tracking categories*, máximo 2 V.
- **Nómina:** exportación a Gusto o ADP; **no se procesa nómina**.

---

## 9. Comunidad, retos y fidelización (basado en evidencia)

- **Motor de reglas por eventos:** visita, clase, escaneo, compra, reto → puntos.
- **Mecánicas por defecto:**
  - **Microrecompensas con bono por volver tras faltar.** Fue la mejor intervención en Milkman 2021 V.
  - **Rachas semanales en lugar de diarias.** Patrón tomado de Strava V; que cause menos presión es inferencia I.
  - **Retos por equipo o por sede con componente competitivo.** Fue el formato más eficaz y el único sostenido en STEP UP V.
- **Clasificaciones:** opcionales y por divisiones. Para principiantes, comparación consigo mismos por defecto.
- **Referidos:** con crédito en la cuenta.
- **Puntos:** canjeables en la tienda, pero **no** en suplementos para menores.
- **Medición:** todo programa nuevo se mide contra un control agregado (§7.3), porque la mayoría de los efectos no persisten V.
- **Sorteos y premios en efectivo:** desactivados hasta revisión legal VERIFICAR · para PR.

---

## 10. Marca blanca: 3 niveles y matriz de capacidades

| Capacidad | PWA con marca (todos los planes) | App contenedora en tiendas (picker, 4.2.6) | App nativa con marca (complemento) |
| --- | --- | --- | --- |
| Reservas, pagos web, portal, plan, chat del coach | Sí | Sí | Sí |
| Notificaciones push | Sí (iOS 16.4 o posterior, tras instalar en la pantalla de inicio) V | Sí | Sí |
| Escanear QR de máquina | Sí (cámara) | Sí | Sí |
| NFC | No en iOS | Sí | Sí |
| HealthKit o Health Connect | No | Sí | Sí |
| Credencial de acceso en el wallet | Limitada I | Sí | Sí |
| Tap to Pay y M2 (personal) | No | — | App nativa de personal de la plataforma |

**Publicación de la app nativa con marca:**

- Desde la **cuenta de desarrollador de la organización cliente**, con la plataforma como administrador invitado (patrón de PushPress y Wodify) V.
- Publicación automatizada y actualizaciones OTA.
- Riesgo: si el cliente deja vencer su cuenta, la app desaparece de la tienda.

**Clasificación de cada producto frente a las reglas de pago de Apple (3.1.1 y 3.1.3)** \[V sobre el texto; la clasificación concreta es P y debe validarse con un especialista en tiendas\]:

| Producto | Vía |
| --- | --- |
| Membresía de uso presencial, pase diario, clases presenciales, suplementos | Pago fuera de las compras de Apple (servicio o bien físico consumido fuera de la app) |
| Entrenamiento personal 1:1 **en tiempo real** | Puede cobrarse fuera de las compras de Apple |
| Niveles digitales de coach IA, "grupo con coach" asíncrono, 1:1 asíncrono, planes o retos digitales vendidos sueltos | **Requieren compras de Apple** si se venden dentro de la app |

Mitigación P: incluir esos productos digitales en la membresía presencial, o venderlos solo en la web. En el storefront de EE. UU. Apple permite enlaces a pago externo V; si Puerto Rico usa ese storefront está VERIFICAR.

**Clases en vivo uno a varios por streaming:** requieren compras de Apple. Quedan fuera de F1–F4.

---

## 11. Cumplimiento y riesgos regulatorios (borrador; requiere abogado y CPA)

| Tema | Regla | Control |
| --- | --- | --- |
| Mensajes y llamadas salientes | TCPA y consentimiento previo expreso; la voz generada por IA se trata como voz artificial I · VERIFICAR alcance. Registro A2P 10DLC para SMS; WABA y verificación de Meta por marca | Entidad `Consent` por canal y propósito; baja con "STOP" o "BAJA"; horarios permitidos; el agente de voz solo llama con consentimiento escrito; alta de A2P y WABA en el onboarding del gimnasio (plazo a medir en F0) |
| Datos de salud | FTC Health Breach Notification Rule, vigente desde el 29-jul-2024 V; leyes estatales como la Washington My Health My Data Act I | Inventario de datos, consentimiento explícito, sin uso publicitario, plan de respuesta a brechas, matriz por estado antes de expandirse |
| Módulo clínico | HIPAA según el caso VERIFICAR; Reglamento 9518 de telesalud en PR | §6.6 |
| Nutrición en PR | Ley 82 de 1972 enmendada: licencia, referido médico en casos de enfermedad, sanciones por ejercer o anunciarse sin licencia V; colegiación VERIFICAR; si un plan solo de IA constituye práctica VERIFICAR | Agentes sin título profesional; modos A/B (§6.7); verificación de licencia del supervisor; triaje §6.2; lista de términos prohibidos en el marketing del gimnasio |
| Nutrición en EE. UU. | Terapia médica nutricional regulada estado por estado V | Matriz de alcance por estado antes de expandirse |
| Claims de salud | Guías de la FDA de ene-2026 sobre bienestar general y software de apoyo a decisiones: el claim define la clasificación V | Lista de frases prohibidas en contenido y agentes; aviso de "no es un dispositivo médico" |
| Suplementos | DSHEA y FTC: claims de estructura y función con el aviso obligatorio, sin claims de enfermedad I; restricciones de edad estatales en algunos productos (p. ej., NY) VERIFICAR | **La IA no recomienda productos de la tienda.** Las recomendaciones profesionales de suplementos llevan una divulgación de conflicto de interés. Se cruzan los suplementos con la medicación del onboarding y se alerta al profesional. Control de edad en la compra. Validar con Stripe la categoría de negocio VERIFICAR |
| Contratos de gimnasio | Leyes estatales de servicios de salud y gimnasios (ventanas de cancelación, plazo máximo, fianzas); DACO en PR VERIFICAR | Matriz de reglas por jurisdicción que limita la permanencia, las cuotas de cancelación y la renovación automática |
| Suscripciones | Renovación automática: Noom pagó USD 56 M + 6 M en créditos en una demanda colectiva V | Cancelación en línea igual de fácil que el alta, avisos previos y recibos claros |
| Menores | COPPA para menores de 13 I | Cuenta de tutor y consentimiento verificable; sin conteo de calorías; sin comunidad pública |
| Transparencia de la IA | Aviso de interacción con IA P | §6.3 |
| Pagos | PCI DSS | Solo elementos de Stripe; la plataforma nunca toca el número de tarjeta |
| Impuestos | IVU (§5.3) | Configuración por artículo y validación con CPA |
| Tiendas de apps | Apple 4.2.6, 4.3, 3.1.1 y 3.1.3; política de contenido repetitivo de Google V | §10 |
| Patentes de video | Pool AVC/H.264 de Via LA: título a título de 12 min o menos, USD 0; streaming por suscripción desde USD 100.000/año en el escalón más bajo; nuevos términos desde 2026 V | Opinión legal sobre si el video incluido en la membresía cuenta como suscripción de streaming; entregar AV1 donde haya soporte (§16.8) |
| Divulgación de bots | California SB 1001 (bots que incentivan ventas) y SB 243 (bots "acompañantes", vigente desde el 1-ene-2026) V-sec | Aviso "IA" en la voz y en la interfaz; el tutor no vende; reglas para menores (§16.5) |
| Accesibilidad | WCAG 2.2 AA P | Compuerta de validación |

---

## 12. Hoja de ruta P (equipo de 6–8 personas; duraciones estimadas)

| Fase | Alcance | Criterio de salida |
| --- | --- | --- |
| **F0 Validación** (4–6 semanas) | 10–15 entrevistas a dueños en PR; prototipo navegable; prueba de precios. Confirmación escrita de Stripe (preview y Tap to Pay en PR); validación de las tasas de comisión; proveedores de control de acceso. **Opinión legal sobre el modo B de nutrición**, más TCPA, contratos de gimnasio y DACO; asesoría fiscal (IVU). Reclutamiento de la red supervisora de nutrición (si se ofrece). Arranque de la biblioteca de recetas | Al menos 3 cartas de intención; decisiones de §14 cerradas |
| **F1 Núcleo operativo** (\~4 meses) | Multi-tenancy y RBAC, CRM, agenda y acceso, membresías, Connect y Billing, pases, facturas, cobros fallidos, consentimientos y mensajería, PWA de marca, IVU, tienda y **POS con lectores inteligentes desde la web de recepción**, agentes de ventas y cobranza por texto (§15) | 2 pilotos cobrando 30 días sin incidentes graves de facturación; 0 accesos indebidos entre organizaciones en las pruebas |
| **F2 Plan holístico + núcleo clínico** (\~3–4 meses) | Reproductor de lecciones y primeras 50 lecciones de técnica con demostración 3D pre-renderizada (§16.10); evaluación, tabla de triaje firmada, agentes de planificación alimentaria, chef y seguimiento, cola de aprobación en lote del supervisor (modo A), biblioteca de al menos 300 recetas, portal del socio, coach diario v1, app nativa del socio (HealthKit), **núcleo del módulo clínico** (consentimiento, notas, plan de tratamiento, BAA) | 90 % de planes firmados en 72 h o menos; 0 planes publicados sin firma; set de seguridad clínica al 100 % |
| **F3 Sala y comunidad** (\~3 meses) | QR/NFC, taxonomía, circuitos, ocupación, retos, puntos, referidos, muro, **tutor de voz v1**, rutas de lecciones con gamificación y visor 3D inspeccionable (§16.10) | Experimento agregado de visitas por semana en curso |
| **F4 Finanzas y escala** (\~3 meses) | Cuentas por pagar, gastos, comisiones, P&L por sede, ingresos diferidos, QuickBooks y Xero, inventario entre sedes, M2 y Tap to Pay en la app de personal, app nativa con marca | Cierre mensual de un piloto sin hojas de cálculo |
| **F5 Diferenciación** | Agentes de voz, inteligencia de mercado, módulo clínico completo (informes al referente, telesalud), conectores EGYM y Mywellness | Compuerta de paridad en verde en todos los módulos |

---

## 13. Métricas de éxito

- **Para el gimnasio:**
  - Retención anual por encima del 66,4 % de referencia HFA, con meta de +5 puntos en el primer año del piloto P.
  - Recuperación de cobros fallidos.
  - Tiempo de alta de un socio.
  - Ingresos de tienda por socio.
- **Para el socio:** porcentaje con plan firmado a 7 días del alta, adherencia semanal, visitas por semana y NPS.
- **Para la IA:**
  - Escalado correcto ≥ 95 %.
  - Porcentaje de borradores aprobados sin cambios mayores.
  - Costo de IA por socio activo al mes.
  - **Incidente clínico:** cualquier respuesta o plan publicado que contradiga la tabla de triaje, un plan firmado o una alergia registrada, o que no escale una bandera roja. Meta: 0; cada incidente se revisa con causa raíz en 72 h.
- **Para la plataforma:** MRR, retención neta de ingresos, tiempo de alta de un gimnasio y cancelación de clientes.

---

## 14. Decisiones y riesgos

**Decisiones cerradas (v0.3):**

1. **Comisión:** porcentaje por plan, decidido por el equipo por delegación del cliente (§5.1).
2. **Nutrición y cocina:** agentes de IA configurados, con modos A/B y licenciado supervisor (§6.7).
3. **Stripe:** Express en *public preview* aceptado, con plan de contingencia (§5.1).

**Pendiente que bloquea el modo B de nutrición:** opinión legal en F0. El modo A no depende de ella.

**Riesgos:**

4. **Validaciones externas:**
   - Legal: TCPA, Ley 82 (modo B y colegiación), HIPAA, contratos de gimnasio y DACO, suplementos.
   - Fiscal: IVU del entrenamiento personal, pequeño proveedor e IVU de la plataforma.
   - Stripe: Tap to Pay en PR.
5. **Competencia:** ABC (con Replify) y Playlist-EGYM tienen capital y distribución; Zing ya vende coach IA a cadenas. La defensa está en el flujo integrado firmado (H1), el español y Puerto Rico (H4), la independencia del hardware y los datos del club.
6. **Costo de la IA incluida:** se controla con límites de uso por socio, caché y modelos pequeños para tareas simples.
7. **Dependencias:** la preview de Stripe, las APIs de fabricantes de equipos y las políticas de las tiendas pueden cambiar.

---

## 15. Backlog de F1: núcleo operativo

Objetivo de F1: dos gimnasios piloto operan en producción, con cobros, acceso, ventas y tienda, sin hojas de cálculo ni otro software de gestión.

Estimaciones en semanas-persona P, para un equipo de 6–8 personas. Las épicas E1 y E12 son transversales y empiezan en la semana 1.

| Épica | Historias clave | Criterios de aceptación | Depende de | Estimación P |
| --- | --- | --- | --- | --- |
| **E1 Identidad, multi-tenancy y RBAC** | `Person` global + `Member`/`StaffMember` por organización; JWT con `org_id`, `location_ids` y `role`; RLS en todas las tablas; 10 roles con permisos por sede; registro de auditoría de accesos | La matriz de CI roles × sedes × organizaciones pasa al 100 %; ningún endpoint usa la clave de servicio fuera de migraciones y tareas del sistema; una persona puede ser socia de 2 organizaciones sin ver datos cruzados | — | 6 |
| **E2 Alta del gimnasio (self-serve)** | Asistente de alta: organización → entidad legal → marca (logo, colores, dominio) → sedes → horarios e impuestos; alta en Stripe con el componente integrado `account_onboarding` (Accounts v2, versión preview); registro de comerciante de Hacienda; importación CSV de socios, planes y saldos | Un gimnasio de prueba queda listo para cobrar en menos de 1 día hábil, sin ayuda del equipo; la importación valida y reporta filas con error sin cargar datos parciales; `notification_banner` visible cuando Stripe pide requisitos | E1 | 5 |
| **E3 Catálogo y precios** | Productos: membresía, pase diario, entrada única, clase suelta, paquete de N sesiones, paquete de entrenamiento personal, cuota de inscripción; precios por sede; reglas (permanencia, congelamiento, vencimiento de créditos, penalidad por no-show); tipo de IVU por producto | Cada producto se sincroniza como Product/Price en la cuenta conectada; un cambio de precio no altera las suscripciones activas salvo que se indique; la permanencia se bloquea donde la regla jurisdiccional lo prohíbe | E2 | 4 |
| **E4 Suscripciones, facturación y cobranza** | Alta y cambio de plan con prorrateo; congelamiento real (Subscription Schedule o reajuste del ancla con `trial_end`); facturas con IVU desglosado y PDF de marca; `application_fee_percent` según el plan; Smart Retries; recordatorios previos a la renovación y de tarjeta por vencer; cancelación en línea en 3 pasos o menos | Pruebas de extremo a extremo con relojes de prueba de Stripe (test clocks) para renovación, congelamiento, cobro fallido, recuperación y cancelación; la comisión de cada factura coincide con la tasa del plan; webhooks idempotentes; la reconciliación diaria marca discrepancias en menos de 24 h | E3, E8 | 8 |
| **E5 Pagos únicos y POS** | Checkout para pases y paquetes; `application_fee_amount` calculado en el servidor; reembolso con devolución proporcional de la comisión; Terminal con lectores inteligentes desde el servidor (WisePOS E o S700) en la web de recepción; recibos | Un pase diario cobrado en recepción activa la credencial en menos de 5 s; un reembolso parcial devuelve la comisión proporcional; el pago presencial queda conciliado con el inventario | E3, E7 | 5 |
| **E6 Agenda y acceso** | Clases con aforo y lista de espera; citas (entrenamiento personal, evaluación); cancelación y no-show; credencial QR dinámica; check-in por app, recepción y 1 conector de puerta; **barra de check-in rápido en el panel** (tarjeta, código o teléfono) con botones de "Nuevo socio" y "Pase diario" | Check-in desde la barra en 2 toques o menos; la lista de espera promueve automáticamente y avisa; el QR rota cada 30 s o menos P y no funciona en captura de pantalla vieja; una membresía impaga deniega el acceso solo tras la decisión humana configurada (§5.2) | E3, E1 | 7 |
| **E7 Portal del socio (PWA de marca)** | Tema por marca; registro e inicio de sesión; compra de pases y planes; reservas; credencial; facturas y método de pago (portal de Stripe o propio); cancelación; push en iOS 16.4 o posterior; español e inglés | Lighthouse ≥ 90 en rendimiento y accesibilidad en un teléfono de gama media; WCAG 2.2 AA en los flujos de compra, reserva y cancelación; cambiar de marca no requiere desplegar | E4, E6 | 7 |
| **E8 Mensajería y consentimientos** | Entidad `Consent` por canal y propósito; WhatsApp (una WABA por marca), SMS (A2P 10DLC por marca) y email; plantillas en español e inglés; baja con "STOP" o "BAJA"; horarios permitidos; bandeja unificada para recepción | Ningún mensaje de marketing sale sin consentimiento registrado (prueba automática); una baja se aplica en menos de 1 min en todos los canales de esa marca; los plazos de alta de WABA y A2P quedan medidos y documentados | E1 | 5 |
| **E9 CRM y leads** | Captura de leads (web, WhatsApp, Instagram por formulario); embudo; tours y pruebas; conversión a socio; ficha 360°; tareas | Lead → socio sin volver a escribir datos; los reportes de embudo por sede y origen coinciden con los registros | E1, E8 | 4 |
| **E10 Agentes de ventas y cobranza (texto)** | Orquestador por evento; agente de ventas y recepción (preguntas, horarios, precios, agendar tour, vender pase por enlace); agente de cobranza (aviso de fallo, enlace de actualización); guardián base (frases de salud prohibidas, escalado); `AgentRun`; set de evaluaciones automáticas | Set de evaluaciones (≥ 150 casos en español e inglés, incluidas inyecciones de instrucciones) ≥ 95 % P; respuesta a un lead en menos de 60 s; el agente nunca promete resultados de salud ni ofrece descuentos fuera de la política; toda acción con dinero requiere confirmación humana | E8, E9, E4 | 7 |
| **E11 Tienda e inventario básico** | Catálogo; inventario por sede y sede virtual online; venta en POS y online; alertas de reorden; IVU por artículo; control de edad en productos restringidos | El inventario cuadra tras 100 ventas mixtas (POS y online) en pruebas; un producto restringido por edad no se vende sin verificación | E5 | 4 |
| **E12 Plataforma, seguridad y operación** | CI/CD; entornos (dev, staging, prod); observabilidad (logs, trazas, alertas de webhooks y pagos); copias de seguridad y restauración probadas; alcance PCI SAQ A (solo elementos de Stripe); prueba de penetración externa antes de los pilotos | Restauración probada (RPO ≤ 1 h, RTO ≤ 4 h) P; 0 hallazgos críticos o altos abiertos en el pentest; alertas de pagos con guardia definida | — | 6 |
| **E13 Reportes operativos y exportación** | Ventas por producto, sede y entrenador; IVU estatal y municipal por municipio; socios activos, altas y bajas; panel con indicadores de **saldo pendiente** y **membresías que vencen en 7 días** (enlazado al agente de retención) y **mapa de calor de horas pico** (día × hora, desde los check-ins); exportación CSV, PDF e impresión | El reporte de IVU de un mes coincide con las facturas emitidas; los números del panel coinciden con Stripe en la reconciliación | E4, E5, E11 | 4 |
| **E14 Ayuda contextual y academia del personal** | Pipeline de tutoriales de producto (§16.11) para los flujos de F1; botón "?" contextual en cada pantalla; checklist de alta del gimnasio con progreso; academia por rol con insignias; tutoriales para socios (reservar, pagar, credencial) | Cada flujo crítico de F1 tiene un tutorial de 90 s o menos en español e inglés; si el script de un tour falla en CI, el despliegue queda bloqueado; un gimnasio piloto completa su alta sin una llamada de soporte | E2, E7, E12 | 5 |

**Total estimado P:** unas 77 semanas-persona. Con 6–8 personas efectivas en paralelo y las dependencias, cabe en unos 4 meses de calendario; la compresión depende de E4 y E6, que forman la ruta crítica.

**Definición de terminado (todas las historias):**

- Pruebas automáticas.
- Pruebas de aislamiento entre organizaciones cuando la historia toca datos.
- Textos en español e inglés.
- Accesibilidad AA.
- Registro de auditoría.
- Documentación de soporte.
- Demo con datos de un piloto.

**Fuera de F1 a propósito:** evaluación y planes (F2), app nativa (F2), circuitos y comunidad (F3), cuentas por pagar y finanzas (F4), M2 y Tap to Pay (F4).

---

## 16. Lecciones de apoyo generadas con IA (microaprendizaje inmersivo)

**Requisito del cliente** (v0.4):

- Lecciones generadas por IA, en microaprendizaje, con gamificación, diseño inmersivo y ejecutables en la plataforma.
- Tutores de IA por voz conversacional en tiempo real.
- Videos con *motion graphics*, *B-roll*, voz en off y animación con Remotion o HyperFrames, montados con ffmpeg.
- Música y efectos de sonido, transiciones, efectos visuales y texto animado con resaltado.
- Simulaciones 3D realistas.
- **Dos audiencias** (decisión del cliente, v0.5):
  - **Socios:** técnica, nutrición, hábitos y uso de la app (§16.1–16.10).
  - **Personal y dueños:** cómo operar la plataforma (§16.11).

### 16.1 Unidad de contenido

Una **lección** dura de 3 a 6 minutos en total P y se compone de:

1. **Cápsula de video** de 60–180 s.
2. **Interacciones ejecutables:** pausas con pregunta, arrastrar y soltar, simulación 3D inspeccionable.
3. **Quiz de recuperación** de 3–5 ítems.
4. **"Pruébalo en sala":** abre el circuito o pide escanear la máquina (§6.4).
5. **Botón "Pregúntale al tutor"** (voz).

Las lecciones se agrupan en **rutas**: onboarding del socio, técnica por patrón de movimiento, uso de las máquinas del club, nutrición y cocina (agente chef), y hábitos.

### 16.2 Diseño pedagógico (decisiones con evidencia)

| Decisión | Evidencia | Regla de producción |
| --- | --- | --- |
| Segmentación y microcápsulas | Metaanálisis de microaprendizaje: mejora de 12,6 puntos en la prueba final (IC 1,2–23,9; 5 estudios) V-sec. La "duración ideal" es convención, no evidencia | Una idea por cápsula; capítulos de ≤ 45 s P |
| Señalización | Principios multimedia de Mayer V-sec | El texto animado con resaltado marca **solo palabras clave**, nunca la narración completa (principio de redundancia) |
| Coherencia | Principio de coherencia de Mayer V-sec; que la música de fondo distrae del contenido explicativo es inferencia I | Música solo en intro, outro y transiciones, con *ducking* bajo la voz; el socio puede desactivarla. Sin efectos visuales decorativos durante la explicación |
| Demostración por modelo | Observar un modelo mejora sobre todo la **forma** del movimiento: efecto 0,77 en forma frente a 0,17 en resultado (Ashford et al.) V-sec | Demostración 3D desde 3–4 ángulos y en cámara lenta, con los puntos clave señalados |
| Práctica de recuperación | Los tests de práctica superan a releer (Adesope et al. 2017, 272 tamaños de efecto) V | Quiz al final de cada lección y preguntas dentro del video |
| Repetición espaciada | El intervalo óptimo crece con el horizonte de retención (Cepeda et al. 2006) V | Repasos programados a los 2, 7 y 21 días P |
| Gamificación | Sailer & Homner 2020: g = 0,49 cognitivo, 0,36 motivacional, 0,25 conductual; la modulan la ficción narrativa y la interacción social V | XP, insignias, rutas con narrativa por temporadas y retos por equipo, integrados con el sistema de puntos (§9) |
| Elección del usuario | El efecto de dar control al aprendiz casi desaparece al corregir el sesgo de publicación (g ≈ 0,11; McKay et al. 2022) V-sec | No se vende la "elección" como mejora del aprendizaje |

### 16.3 Pipeline de producción con agentes

Las lecciones **maestras** se producen una vez por idioma y se reutilizan en todos los gimnasios. La marca del gimnasio se aplica **en el reproductor**: marco, colores, cortina de entrada y salida, y nombre del entrenador. Así no hay que volver a renderizar por cliente.

1. **Agente curricular:** decide qué lección falta, a partir del mapa de competencias, el plan firmado del socio, las preguntas frecuentes al coach y las máquinas del club.
2. **Agente guionista:**
   - Objetivo de aprendizaje, guion con **descripción integrada** (la voz describe lo que se ve, lo que cubre la audiodescripción de WCAG 1.2.5) y fuentes citadas.
   - Pasa por el filtro de frases de salud prohibidas.
3. **Revisión profesional (compuerta humana):**
   - Técnica: entrenador certificado.
   - Nutrición: licenciado supervisor (§6.7).
   - Hábitos: revisor de contenido.

Sin aprobación no se renderiza. 4. **Agente director de arte:** convierte el guion en un **storyboard estructurado** (JSON de escenas) que usa plantillas de la biblioteca de diseño: - Títulos y *lower thirds*. - Texto cinético con resaltado. - Diagramas animados. - Transiciones (sin destellos, WCAG 2.3.1). - Encuadres de *B-roll*. - Clips 3D. 5. **Agente de assets:** - **Voz en off:** ElevenLabs para español latino e inglés. Las voces nativas es-PR de Azure (Karina y Victor) entran en una prueba ciega con socios V · existen; calidad a medir. - **Música y efectos de sonido:** Epidemic Sound Partner API (permite sublicenciar a los usuarios; licencia global y perpetua) V. La música generada por IA solo con plan Enterprise, porque los planes *self-serve* prohíben crear bibliotecas para terceros V. - **B-roll:** biblioteca curada con licencia para el usuario final (Storyblocks API o Shutterstock Platform License) V y guardada en caché. El video generativo (p. ej., Gen-4 Turbo a USD 0,05/s) **solo para planos ambientales sin personas ejecutando ejercicios** V · precio. - **3D:** §16.6. 6. **Render:** - **HyperFrames** (Apache 2.0, sin costo por render) V. Las composiciones en HTML, GSAP, Lottie y Three.js se capturan cuadro a cuadro en Chrome headless y se codifican con FFmpeg. - **Remotion** queda como alternativa: el plan Automators cuesta USD 0,01 por render con un mínimo de USD 100/mes, y requiere confirmar por escrito el uso en marca blanca V. - **FFmpeg con build LGPL** en *workers* propios (sin `--enable-gpl`; libx264 es GPL) V, con cola por prioridad. - Salidas: - H.264 y **AV1**. - HLS adaptativo. - Subtítulos **WebVTT bilingües** con los tiempos del TTS. - Miniatura. - Transcripción. 7. **Agente de QA (automático) + muestreo humano:** - Volumen normalizado a −16 LUFS P. - Detección de destellos. - Sincronía de subtítulos. - Contraste del texto. - Duración. - Frases prohibidas. - Coincidencia entre el ejercicio mostrado y el guion.

Un humano revisa 1 de cada 10 lecciones P. 8. **Publicación y analítica:** finalización, aciertos en el quiz, repasos y, lo más importante, **la conducta**: si el socio practicó en sala (escaneo QR) en los 7 días siguientes.

### 16.4 Reproductor ejecutable en la plataforma

- Video con capítulos y puntos de pausa interactivos.
- Controles de velocidad.
- Música desactivable (WCAG 1.4.2).
- Transcripción siempre visible.
- Modo de movimiento reducido (`prefers-reduced-motion`, WCAG 2.3.3).
- Interacciones nativas (quiz, ordenar pasos, marcar el error en una imagen).
- Visor 3D inspeccionable.
- Botón "Pruébalo en sala".
- Funciona en la PWA y en la app nativa. Las lecciones descargadas sirven sin conexión en la app nativa P.

### 16.5 Tutor de IA por voz en tiempo real

**Arquitectura recomendada** (por piezas, para poder usar Claude como cerebro):

| Pieza | Elección | Costo |
| --- | --- | --- |
| Transporte | LiveKit Agents (WebRTC, SDK para web, iOS y Android; plugin oficial de Anthropic) | USD 0,01/min de agente V |
| Voz a texto | Deepgram Flux Multilingual (español con detección automática) | USD 0,0078/min V |
| Razonamiento | Claude: modelo pequeño para el diálogo, mediano para preguntas complejas | — |
| Texto a voz | Cartesia Sonic o ElevenLabs Flash | — |
| **Total por piezas** |  | **≈ USD 0,035–0,06/min (cálculo)** |

Un adaptador permite cambiar a un modelo de voz a voz (OpenAI Realtime mini o Gemini Live) para un modo de latencia ultra baja; por debajo de USD 0,015/min sin contar el contexto acumulado (cálculo). **Hume EVI queda excluido**: se descontinúa el 13-nov-2026 V.

**Contexto del tutor:** la lección actual, el plan firmado, la memoria del socio y las máquinas de la sede. No accede a datos clínicos salvo con el módulo clínico y proveedores con BAA (OpenAI, ElevenLabs Enterprise, Deepgram, Cartesia y LiveKit ofrecen BAA V; el del proveedor del LLM está VERIFICAR).

**Reglas:**

- Mismo guardián de seguridad que el coach (§7.2).
- Al iniciar dice "Soy un asistente de IA".
- Interrupción natural (*barge-in*).
- Transcripción guardada y visible.
- No vende membresías ni servicios (CA SB 1001).
- Persona no "acompañante" y restricciones para menores (CA SB 243) VERIFICAR · alcance.

**Metas:**

- Latencia de voz a voz p50 \< 800 ms P.
- Escalado correcto ≥ 95 % en el set de pruebas de seguridad.

**Cupos por plan** P (por socio activo al mes, con costo calculado):

| Plan | Minutos de tutor | Costo |
| --- | --- | --- |
| Esencial | 10 | ≈ USD 0,35–0,60 |
| Pro | 20 | ≈ USD 0,70–1,20 |
| Élite | 30 | ≈ USD 1,05–1,80 |

Los cupos se ajustan con datos de uso real en F3.

### 16.6 Simulaciones 3D realistas

**Decisión de seguridad:** la técnica se demuestra **solo con 3D basado en captura de movimiento real, revisado por un entrenador certificado**. **No** se usa video generativo, porque los modelos actuales fallan en anatomía y física:

- VBench-2.0 reporta dificultades en anatomía humana y física V.
- Un trabajo de 2026 mide a Wan2.2 con 86,10 en fidelidad humana pero 40,19 en física V.

Enseñar mala técnica es un riesgo de lesión.

**Avatares:** MetaHuman (uso fuera de Unreal sin regalías; licencia de puesto si la empresa factura más de USD 1 M y renderiza fuera de Unreal) V-sec, o Character Creator con Extended License V. **No** Ready Player Me, que cerró el 31-ene-2026 V-sec.

**Movimiento:**

- Paquetes de mocap con licencia comercial por entidad (p. ej., Unity Asset Store, Fab).
- Capturas propias de entrenadores con mocap por video (Move One, USD 15/mes en el plan de entrada con uso comercial) V.
- Cada animación se valida contra la ficha del ejercicio.

**Entrega:**

- **Pre-renderizado** desde 3–4 ángulos con cámara lenta (lo que se ve en el video).
- **Visor inspeccionable** opcional en React Three Fiber, con WebGPU y respaldo en WebGL2, glTF ligero e imagen estática como último respaldo.
- Cámara fija por defecto; rotación solo cuando el usuario la pide. Sin órbita automática, para prevenir mareo V-sec.
- El rendimiento en móviles de gama media se mide con benchmarks propios en F2 VERIFICAR.

**Fuera de alcance hasta F5:** corrección de técnica por cámara en vivo (como Zing Vision) V · que existe. Requiere validación propia de seguridad y precisión.

### 16.7 Costos de producción (cálculo con precios publicados; R5)

| Escenario | Por lección de 90 s, un idioma | Catálogo de 300 lecciones, bilingüe |
| --- | --- | --- |
| Básico: TTS Flash, B-roll de biblioteca, HyperFrames | ≈ USD 0,10 + contratos fijos de música y B-roll | ≈ USD 60 + contratos |
| Premium: TTS v3, música IA Enterprise, 15 s de B-roll generativo | ≈ USD 1,91 (≈ USD 2,07 bilingüe, reutilizando música y B-roll) | ≈ USD 621 + contratos |

- El costo dominante **no es el render**, sino:
  - la revisión profesional;
  - la captura y validación de mocap;
  - los contratos de música y B-roll (precios por negociar).
- Como las lecciones maestras se reutilizan entre gimnasios, ese costo fijo se amortiza en toda la base de clientes.

### 16.8 Licencias y cumplimiento específicos

| Tema | Riesgo | Control |
| --- | --- | --- |
| Patentes H.264 (Via LA) | El video incluido en la membresía podría clasificarse como suscripción de streaming (desde USD 100.000/año en el escalón más bajo) V | **Opinión legal en F0**; entregar AV1 donde el dispositivo lo soporte (AOMedia sin regalías; Sisvel reclama un pool aparte) V |
| Remotion | Licencia *source-available*; marca blanca no mencionada V | Motor principal HyperFrames (Apache 2.0); Remotion solo con confirmación escrita |
| Música | Planes *self-serve* de música IA prohíben bibliotecas para terceros V | Contrato Partner o Enterprise con cláusula de marca blanca |
| Derechos de autor | El material generado solo por IA no es registrable (U.S. Copyright Office, ene-2025) V | La exclusividad se protege por contrato y técnica (DRM ligero, URLs firmadas); la aportación humana se documenta |
| Clonación de voz | Requiere derechos del dueño de la voz V | Consentimiento escrito, alcance multi-tenant, revocable; sin clonar voces de entrenadores sin contrato |
| Accesibilidad | WCAG 1.2.2, 1.2.3, 1.2.5, 1.4.2, 2.2.2, 2.3.1 y 2.3.3 V | Subtítulos, descripción integrada, transcripción, música desactivable, sin destellos, movimiento reducido |
| Bots | CA SB 1001 y SB 243 V-sec | §16.5 |

### 16.9 Posición competitiva

| Competidor | Qué hace (fuentes R6) | Nuestra diferencia |
| --- | --- | --- |
| Muscle & Motion | Más de 1.200 ejercicios con anatomía 3D | Lecciones ligadas al plan del socio y a las máquinas de su sede, con práctica verificada en sala |
| Freeletics | Video en 3 ángulos y coach IA conversacional (Coach+) | Tutor por **voz** en español, con contexto del gimnasio y escalado a un entrenador humano |
| Zing | Corrección por cámara y oferta B2B para gimnasios | Integrado en la plataforma de gestión (no es un add-on); flujo profesional firmado |
| Combine Fitness / Active&Fit | Más de 2.000 demostraciones 3D | Rutas pedagógicas con recuperación, repaso espaciado y gamificación medida |

### 16.10 Fases y entregables

| Fase | Entregable | Criterio de salida |
| --- | --- | --- |
| F0 | Opinión legal sobre H.264; contratos de música y B-roll; prueba ciega de voces es-PR; selección de avatar | Contratos firmados o alternativas decididas |
| F2 | Pipeline de producción (pasos 1–8), reproductor, **50 lecciones de técnica** con 3D pre-renderizado y quiz, ruta de onboarding | 100 % de las lecciones con revisión profesional; QA automático en verde; finalización ≥ 70 % en los pilotos P |
| F3 | Tutor de voz v1, visor 3D inspeccionable, gamificación de rutas, repaso espaciado, 150 lecciones más (máquinas, nutrición, hábitos) | Latencia p50 \< 800 ms; 0 incidentes de seguridad; lift de práctica en sala frente al grupo de control (§7.3) |
| F1 | Tutoriales de producto y ayuda contextual para los flujos de F1 (E14, §16.11) | Ver E14 |
| F5 | Evaluar la corrección de técnica por cámara | Estudio de precisión propio antes de lanzar |

### 16.11 Tutoriales de producto generados automáticamente (personal, dueños y socios)

**Objetivo:** que la ayuda nunca quede desactualizada. Cada vez que cambia la interfaz, los videos de "cómo se usa" se regeneran solos.

**Referencia de estilo:** tutoriales de grabación de pantalla con texto cinético resaltado. Lo que se adopta y lo que no:

- **Se adopta:** el resaltado palabra por palabra como señalización.
- **No se adopta:**
  - Subtítulos grabados en la imagen: se usa WebVTT y el resaltado va como capa aparte.
  - Banners o sellos fijos durante la explicación: violan el principio de coherencia.

**Pipeline:**

1. **Tour como código.** Cada flujo (p. ej., "Cobrar un pase diario", "Congelar una membresía", "Registrar un gasto", "Reservar una clase") es un script de Playwright con:
   - pasos;
   - selectores estables (`data-tour-id`);
   - texto de narración por paso;
   - rol del usuario.
2. **Entorno de demostración** con **datos sintéticos**, nunca de socios reales, y con el tema de marca neutral o el de la organización.
3. **Grabación.** Playwright graba la pantalla y registra la posición y el momento de cada clic y de cada campo que se escribe.
4. **Composición con HyperFrames:**
   - Zoom y paneo automáticos hacia cada acción.
   - Cursor resaltado con onda en cada clic.
   - Llamadas y flechas.
   - Texto cinético con palabra clave resaltada.
   - Voz en off TTS bilingüe desde la narración del script.
   - Música baja solo en intro y outro.
   - Cortinas con la marca.
5. **FFmpeg** (build LGPL) con WebVTT, transcripción y capítulos.
6. **QA automático:**
   - Si un selector no existe o el flujo falla, **el despliegue se bloquea** hasta corregir el tour.
   - Una comparación visual detecta los tours afectados por un cambio de interfaz y solo regenera esos.
7. **Distribución:**
   - **Botón "?" contextual** que abre el tutorial de esa pantalla.
   - **Guías interactivas dentro de la app** (tooltips paso a paso) generadas desde el mismo script: la versión "ejecutable" del tutorial.
   - Agente de soporte por texto o voz que responde "¿cómo hago…?" y enlaza el minuto exacto del tutorial.

**Academia del personal:**

- **Rutas por rol:** dueño, gerente, recepción, entrenador, supervisor de nutrición, contador.
- **Insignias**, por ejemplo "Recepción certificada" tras completar la ruta y un ejercicio práctico en el entorno de demostración.
- **Progreso visible para el dueño**, que es la evidencia de capacitación de su equipo.

**Para socios:** tutoriales cortos de la app (reservar, pagar, usar la credencial QR, escanear una máquina, hablar con el coach), integrados en el onboarding del socio.

**Marca blanca:**

- Por defecto se renderiza con tema neutral, con un solo render por idioma.
- En el plan Élite se renderiza con el tema de la organización P; el costo es solo de cómputo, porque HyperFrames no cobra por render.

**Métricas:**

- Tickets de soporte por gimnasio al mes.
- Tiempo de alta del gimnasio (meta de E2: menos de 1 día hábil).
- Porcentaje del personal certificado por rol.
- Tutoriales vistos antes de abrir un ticket.

---

## Anexo — Fuentes principales

Las listas completas de URLs están en los informes R1–R4. Selección:

- HFA 2025 Benchmarking: [https://www.healthandfitness.org/2025-fitness-industry-benchmarking-report/](https://www.healthandfitness.org/2025-fitness-industry-benchmarking-report/)
- ABC adquiere Replify: [https://athletechnews.com/abc-fitness-acquires-agentic-ai-platform-replify/](https://athletechnews.com/abc-fitness-acquires-agentic-ai-platform-replify/)
- Mindbody AI Concierge: [https://www.playlist.com/press/playlist-launches-ai-concierge-247-front-desk-assistant-fitness-and-wellness-operators](https://www.playlist.com/press/playlist-launches-ai-concierge-247-front-desk-assistant-fitness-and-wellness-operators)
- Fusión EGYM–Playlist: [https://insider.fitt.co/egym-merges-with-mindbody-classpass-parent-in-7-5b-deal/](https://insider.fitt.co/egym-merges-with-mindbody-classpass-parent-in-7-5b-deal/)
- EGYM Genius: [https://egym.com/us/blog/egym-genius-faq](https://egym.com/us/blog/egym-genius-faq) · inventario: [https://knowledge.egym.com/en/genius/egym-genius--gym-inventory-guide](https://knowledge.egym.com/en/genius/egym-genius--gym-inventory-guide)
- Precios de PushPress: [https://www.pushpress.com/pricing](https://www.pushpress.com/pricing) · Zen Planner: [https://zenplanner.com/pricing/](https://zenplanner.com/pricing/) · GymMaster: [https://www.gymmaster.com/pricing/](https://www.gymmaster.com/pricing/) · Gymdesk: [https://www.gymdesk.com/pricing](https://www.gymdesk.com/pricing) · Trainerize: [https://www.trainerize.com/pricing/](https://www.trainerize.com/pricing/)
- Google Health Coach: [https://blog.google/products/fitbit/fitbit-ai-personal-health-coach-preview/](https://blog.google/products/fitbit/fitbit-ai-personal-health-coach-preview/)
- Zing Coach en FitActive: [https://athletechnews.com/italy-biggest-gym-brand-fit-active-ai-personal-training-zing-coach/](https://athletechnews.com/italy-biggest-gym-brand-fit-active-ai-personal-training-zing-coach/) · NYSC: [https://athletechnews.com/nysc-adds-ai-coaching-in-retention-play/](https://athletechnews.com/nysc-adds-ai-coaching-in-retention-play/)
- Exactitud del registro por foto: [https://www.healio.com/news/primary-care/20260804/ai-photobased-calorietracking-tools-underestimate-them-by-33](https://www.healio.com/news/primary-care/20260804/ai-photobased-calorietracking-tools-underestimate-them-by-33)
- Ley 82 de PR: [https://www.salud.pr.gov/CMS/DOWNLOAD/6308](https://www.salud.pr.gov/CMS/DOWNLOAD/6308)
- FTC HBNR: [https://www.federalregister.gov/documents/2024/05/30/2024-10855/health-breach-notification-rule](https://www.federalregister.gov/documents/2024/05/30/2024-10855/health-breach-notification-rule)
- Guías de Apple para la App Store: [https://developer.apple.com/app-store/review/guidelines/](https://developer.apple.com/app-store/review/guidelines/)
- Web Push en iOS: [https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- Stripe M2 en PR: [https://docs.stripe.com/terminal/payments/setup-reader/stripe-m2.md](https://docs.stripe.com/terminal/payments/setup-reader/stripe-m2.md) · Tap to Pay: [https://developer.apple.com/tap-to-pay/regions/](https://developer.apple.com/tap-to-pay/regions/)
- Reglamento del IVU: [https://hacienda.pr.gov/sites/default/files/reglamento_del_ivu_actualizado_0.pdf](https://hacienda.pr.gov/sites/default/files/reglamento_del_ivu_actualizado_0.pdf) · CC RI 26-13: [https://hacienda.pr.gov/sites/default/files/publicaciones/2026/06/cc_ri_26-13\_-\_integracion_cofim_y_nueva_planilla_mensual_ivu_signed.pdf](https://hacienda.pr.gov/sites/default/files/publicaciones/2026/06/cc_ri_26-13_-_integracion_cofim_y_nueva_planilla_mensual_ivu_signed.pdf)
- Stripe Tax en PR: [https://docs.stripe.com/tax/supported-countries/united-states/puerto-rico](https://docs.stripe.com/tax/supported-countries/united-states/puerto-rico)
- QuickBooks por Location o Class: [https://quickbooks.intuit.com/learn-support/en-us/do-more-with-quickbooks/class-and-location-tracking-in-payroll-and-other-p-l-items/00/1512315](https://quickbooks.intuit.com/learn-support/en-us/do-more-with-quickbooks/class-and-location-tracking-in-payroll-and-other-p-l-items/00/1512315)
- Licencia de HyperFrames: [https://github.com/heygen-com/hyperframes](https://github.com/heygen-com/hyperframes) · licencia de Remotion: [https://www.remotion.dev/docs/license/faq](https://www.remotion.dev/docs/license/faq) · legal de FFmpeg: [https://ffmpeg.org/legal.html](https://ffmpeg.org/legal.html)
- Via LA AVC/H.264: [https://www.via-la.com/licensing-programs/avc-h-264/](https://www.via-la.com/licensing-programs/avc-h-264/)
- Epidemic Sound Partner API: [https://www.epidemicsound.com/business/developers/](https://www.epidemicsound.com/business/developers/) · términos de ElevenLabs Music: [https://elevenlabs.io/music-terms](https://elevenlabs.io/music-terms)
- VBench-2.0: [https://arxiv.org/abs/2503.21755](https://arxiv.org/abs/2503.21755) · U.S. Copyright Office (IA): [https://copyright.gov/newsnet/2025/1060.html](https://copyright.gov/newsnet/2025/1060.html)
- Precios de LiveKit: [https://livekit.com/pricing](https://livekit.com/pricing) · Deepgram: [https://deepgram.com/pricing](https://deepgram.com/pricing) · Hume EVI (descontinuado): [https://dev.hume.ai/docs/speech-to-speech-evi/overview](https://dev.hume.ai/docs/speech-to-speech-evi/overview)
- Sailer & Homner 2020: [https://link.springer.com/article/10.1007/s10648-019-09498-w](https://link.springer.com/article/10.1007/s10648-019-09498-w) · Adesope et al. 2017: [https://journals.sagepub.com/doi/10.3102/0034654316689306](https://journals.sagepub.com/doi/10.3102/0034654316689306) · Cepeda et al. 2006: [https://pubmed.ncbi.nlm.nih.gov/16719566/](https://pubmed.ncbi.nlm.nih.gov/16719566/)
- WCAG 2.2: [https://www.w3.org/WAI/WCAG22/quickref/](https://www.w3.org/WAI/WCAG22/quickref/)
- Milkman et al., *Nature* 2021, DOI 10.1038/s41586-021-04128-4 · STEP UP: [https://pennmedicine.org/news/news-releases/2019/september/using-a-wearable-device-to-exercise-more-add-competition-to-improve-your-results](https://pennmedicine.org/news/news-releases/2019/september/using-a-wearable-device-to-exercise-more-add-competition-to-improve-your-results)