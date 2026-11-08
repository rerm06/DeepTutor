# Nutrición con IA — estado del loop

Reléelo al empezar cada sesión. Fase actual: **0 → 1** (inventario terminado; decisiones tomadas por delegación del dueño
el 2026-11-08: «No me preguntes nada ni pidas aprobación de nada»).

## Especificación del loop (design-a-loop)
| Pieza | Valor |
|---|---|
| Prueba de 4 condiciones | Repite: sí (14 fases con la misma forma build→gate). Verificación automática: sí (`scripts/gate.sh` + pruebas por fase + dorado). Presupuesto: sí, con topes abajo. Herramientas: sí (Postgres local, preview local, Playwright, Netlify MCP). |
| Disparador | Cierre de la fase anterior (compuerta verde) en esta sesión. |
| Conocimiento que se relee | Este archivo, `INVENTARIO.md`, `COMPUERTAS.md`, `AGENTS.md`, `docs/spec/especificacion-v0.5.md` §6.2 y §6.7. |
| Estado | Este archivo + `COMPUERTAS.md` (una fila por fase y punto). |
| Compuerta | `scripts/gate.sh` (secretos, términos prohibidos, migraciones, lint, build, typecheck, db/api/web) + pruebas de la fase + dorado de la fase + fallos simulados + preview local con Playwright (consola sin errores) + revisor separado (subagente que no escribió el código). |
| Separación maker/checker | El código lo escribe el agente de la fase; la compuerta la firma un subagente revisor distinto; en el producto, el verificador de nutrición es un módulo distinto del generador. |
| Parada dura | 5 iteraciones por compuerta (cambio de enfoque obligatorio tras la 3.ª); 2 h de reloj por fase; costo de IA de pruebas reales ≤ USD 5 por fase. Si se alcanza: revertir al último estado verde, documentar y escalar. |
| Humano en el loop | Ningún plan llega al socio sin aprobación humana (en el producto). Aprobación del dueño por fase: delegada por el dueño el 2026-11-08; queda anotada en `COMPUERTAS.md`. |
| Métrica | Costo por cambio aceptado (compuertas verdes / iteraciones). Si < 50 % de iteraciones pasan, se para y se cambia el enfoque. |

## Decisiones tomadas (por delegación)
1. **Base de alimentos:** USDA FoodData Central, conjunto *SR Legacy* (abril 2018, dominio público CC0), descargado el
   2026-11-08 de fdc.nal.usda.gov (sha256 del zip `b80817294b88…6fd0`). Se siembra un subconjunto curado de alimentos
   comunes en Puerto Rico con su `fdc_id`, kcal, proteína, carbohidratos, grasa, fibra, sodio, azúcares y sus medidas
   caseras oficiales. Un alimento que no está en la tabla no entra al plan. Búsqueda en la API de FDC solo si se
   configura `FDC_API_KEY` (la `DEMO_KEY` está limitada por tasa).
2. **LLM por defecto:** Gemini, interfaz intercambiable. Generador, redactor, foto y explicador: `gemini-3.8-flash`;
   verificador de tono y redactor de mensajes: `gemini-3.1-flash-lite`. Precios confirmados en la página oficial el
   2026-11-08: 3.8 Flash USD 0.75 / 3.75 por millón (entrada/salida) hasta 2026-12-31 y 1.50 / 7.50 desde 2027-01-01;
   3.1 Flash-Lite 0.25 / 1.50. Clave: `GEMINI_API_KEY`, o la existente `GEMINI_LIVE_API_KEY`.
3. **Pisos y límites (valores por defecto, editables por el dueño):** kcal diarias ≥ gasto basal (Mifflin-St Jeor);
   pérdida ≤ 1 % del peso por semana; ganancia ≤ 0.5 % por semana; proteína 1.4–2.0 g/kg (ISSN 2017); grasa ≥ 20 % de
   las kcal (AMDR, DRI 2005); tolerancia del día ±5 %; un plan con un día fuera de tolerancia no se muestra.
4. **Quién revisa:** el borrador lo revisa y aprueba el dueño (o gerente). Para que **llegue al socio** se aplica el
   modo de la organización definido en la especificación §6.7:
   - **Modo A (por defecto):** además del dueño, lo aprueba un nutricionista o dietista **licenciado** (Ley 82 de 1972,
     Art. 1(c) y Art. 9; el guardián de la base ya exige licencia verificada para planes de nutrición).
   - **Modo B (opcional):** «orientación general», sin lenguaje terapéutico, solo para socios en verde; el dueño lo
     activa declarando que tiene opinión legal favorable (se guarda quién, cuándo y el texto). No se activa solo.
   Motivo: el dueño delegó las decisiones, pero no puede delegar en el sistema la interpretación de la Ley 82; el modo
   B queda disponible para cuando el dueño decida asumirlo.
5. **Fuentes:** solo la lista cerrada del pedido. Los 5 DOI se comprobaron el 2026-11-08 (redirigen a Elsevier/AJCN,
   Cambridge/BJN, Ovid/MSSE ×2 y Taylor & Francis/JISSN); dietaryguidelines.gov, nap.edu (cat. 10490), who.int y
   fdc.nal.usda.gov responden 200. Información de cadenas: solo con URL oficial y fecha.
6. **Tiempo real:** el stack (Netlify Functions) no mantiene WebSockets; se usa sondeo cada 3 s con `ETag`/`since`
   (objetivo < 5 s) y el corte de acceso se verifica en cada consulta.
7. **Mensajería:** existe la cola `app.outbound_message` (WhatsApp/SMS/correo, consentimiento, ventana horaria) pero
   **no** hay proceso de entrega ni credenciales de Twilio/SendGrid: se construye el adaptador y el reintento con un
   proveedor simulado; el envío real queda pendiente de credenciales.

## Progreso por fase
| Fase | Estado |
|---|---|
| 0 Inventario | hecho (ver `INVENTARIO.md`) |
| 1 Datos | hecho, compuerta 1–7 PASA; revisor en curso |
| 2 Cálculos | hecho, compuerta 1–7 PASA; revisor en curso |
| 3 Generación | pendiente |
| 4 Verificador | pendiente |
| 3I Agentes, costos y fallos | pendiente |
| 3B Formulario del socio | pendiente |
| 3C Foto y comida rápida | pendiente |
| 3H Integración con rutina | pendiente |
| 3D Entrenador | pendiente |
| 3E Dueño y desempeño | pendiente |
| 3F Dashboard y alertas | pendiente |
| 3G Mensajes | pendiente |
| 5 Interfaz final | pendiente |

## Bitácora de iteraciones
- F1 it.1: `r := r || 'texto'` en plpgsql se interpretó como literal de arreglo → `malformed array literal`. Causa raíz:
  ambigüedad de tipos en `text[] || unknown`. Corrección: `array_append`. Resultado: 21/21.
- F1 it.1: el rol de migración de Netlify no es superusuario y `FORCE RLS` ocultaría a los socios al enlazar perfiles y
  bloquearía la siembra del catálogo. Corrección: `NO FORCE`/`FORCE` alrededor de esas lecturas/escrituras (mismo patrón
  que las siembras existentes); verificado aplicando las migraciones como `nf_owner`.
- F2 it.1: verde a la primera.

## Decisiones técnicas de las fases 1–2
- Ejercicio **neto** de reposo: (MET − 1) × kg × h, porque el reposo ya está en basal × factor; con METs brutos se
  contaría dos veces. Valores MET de la edición 2024 del Compendium (Herrmann 2024, permitida por la lista: «o la
  edición más reciente»), verificados en pacompendium.com el 2026-11-08.
- Katch-McArdle: el pedido pide ofrecerla con masa magra medida, pero **no está en la lista cerrada de fuentes**; no
  se usa ni se cita hasta que se agregue su fuente a la lista.
- 7,700 kcal por kg y el superávit del 10 % para ganar masa son SUPUESTOS (no están en la lista); se usan para el
  cálculo y nunca se citan como fuente.

