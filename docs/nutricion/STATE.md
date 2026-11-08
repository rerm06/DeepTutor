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
4. **Quién revisa:** el borrador lo aprueba el dueño (o gerente) y, para que **llegue al socio**, además un
   nutricionista o dietista con **licencia verificada** (Ley 82 de 1972, Art. 1(c) y 9; `AGENTS.md` regla 4: «ningún
   plan se publica sin firma licenciada»). El modo B de la especificación §6.7 (solo dueño, «orientación general») se
   **retiró del código** en la iteración 1 porque contradice `AGENTS.md`; volver a activarlo requiere que el dueño
   cambie esa regla y una opinión legal.
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
- F1–F2 compuerta punto 8 (revisor independiente), it.1: **NO FIRMA** — 2 críticos, 4 altos, 8 medios, 6 bajos.
  - C1 fuga de datos de salud por funciones DEFINER sin chequeo → `nutrition_assert_reader` en cada lectura.
  - C2 aprobar/licenciar/enviar no re-chequeaban bloqueos ni alergias → `nutrition_plan_check` en las tres
    transiciones; cambios de perfil marcan planes desactualizados.
  - A1 cuestionario vacío = «todo no» → el CHECK exige las 8 respuestas; los parciales se fusionan.
  - A2 piso y tolerancia no aplicados en la base → recalculados en SQL (Mifflin, 7 días, ±tolerancia);
    el borrador creado por el socio no lleva resultado de verificador.
  - A3 etiquetas de alimentos → retirados sofrito (receta con posible jamón), yuca y panapén crudos; alérgenos
    conservadores en panes, galletas y tortilla de harina; procedencia documentada en `foods-pr.json`.
  - A4 un peso declarado levantaba el bloqueo de IMC medido → se usa el más conservador de los últimos 365 días.
  - M1 guardián de inmutabilidad del plan; M2 respuestas de salud solo del socio o nutricionista/clínico, con
    auditoría de campos; M3 estado recalculado al medir; M4 `bodyFat` con procedencia; M5 tope de proteína 35 %
    (AMDR); M6 clasificación OMS con el IMC exacto; M7 rangos de la organización dentro de las fuentes; M8 modelo y
    versión obligatorios en planes de IA; B1 archivar solo la misma serie; B2 ritmo 0 sin superávit; B3 comentario
    del factor; B4 semana y alimentos preferidos validados; B6 permiso innecesario retirado. B5 cubierto por A3.
  - Resultado it.1: compuerta 1–7 verde (db 815, api 362, web 179).
- F1–F2 revisión de cierre (it.2): **NO FIRMA** — 20 hallazgos previos cerrados salvo A4 y M3 parciales; 10 nuevos.
  - N1 (alto) el dueño podía quitar una alergia → quitar alérgenos o exclusiones solo el socio o nutricionista/clínico;
    la auditoría guarda los códigos añadidos y quitados.
  - N2 (alto) una estatura declarada levantaba el bloqueo de IMC medido → el peso medido se divide por la estatura
    MÁS ALTA registrada (primer intento con `greatest(medida, última)` falló la prueba: la última declarada ganaba).
  - N3 enviar exige la licencia vigente en ese momento; N4 un bloqueo nuevo archiva el plan enviado y la política del
    socio oculta planes desactualizados; N5 meta 0 → `meta_ausente`; N6 etiquetas de dieta derivadas de alérgenos;
    N7 CHECK «enviado solo con licencia» y prohibición de borrar historial; N8 `plan_check` solo para personal;
    N9 aviso `protein_below_min`; N10 misma base (edad hoy y cuerpo más reciente) documentada en calc y SQL;
    M3 completo: un triaje nuevo marca los planes desactualizados.
  - Resultado it.2: compuerta 1–7 verde (db 822, api 362, web 179).
- F1–F2 revisión it.3 (auditor de seguridad): **NO FIRMA** — 1 alto (H1: el dueño reescribía la fecha de nacimiento
  y levantaba `menor_de_edad`), 3 medios, 3 bajos.
- **Cambio de enfoque obligatorio tras la 3.ª iteración.**
  - Hipótesis descartadas (enfoque A, «proteger campo por campo»): N1 alergias, N2 estatura, H1 fecha de nacimiento,
    M2 peso del personal. Cada revisión encontró otro campo editable que levantaba un bloqueo: el problema no es un
    campo, es que cualquier entrada de seguridad era editable y los bloqueos se recalculaban sin memoria.
  - Enfoque B1 (elegido) — **trinquete de seguridad**: cada escritura al perfil o a las mediciones compara los
    bloqueos de seguridad antes y después; si alguno desaparece y quien escribe no es el propio socio ni un
    nutricionista o clínico de su sede, la escritura se rechaza (`forbidden_block_removal`), y todo levantamiento
    queda auditado (`nutrition.block_lifted`). Una sola regla cubre los campos actuales y los futuros.
  - Enfoque B2 (descartado) — bitácora de eventos de seguridad que el licenciado debe reconocer antes de firmar:
    depende de que una persona lo note, añade interfaz y no detiene el cambio en origen.
  - Además: estatura máxima registrada para todo cálculo de IMC (B3); vínculo de tutor, triaje nuevo y bajada de un
    límite retiran el plan enviado (M1, B2); el ritmo implícito por las metas (tdee − meta) se valida en SQL (M3); el
    socio no ve planes retirados por seguridad (B1); quien aprueba por el gimnasio y quien firma con licencia deben ser
    personas distintas.
  - Resultado it.4 (enfoque B): compuerta 1–7 verde (db 828, api 362, web 179).
- F1–F2 revisión it.4 (auditor de seguridad, 4.ª revisión): **NO FIRMA** — 1 alto (N1: firmar una evaluación en el
  módulo de salud — entrenador, dueño o gerente — cambiaba el triaje y el peso que leen los bloqueos sin pasar por el
  trinquete); H1, M1, M2, M3, B2 y B3 cerrados; B1 abierto (bajo); residuales R1 (bajo) y R2 (medio).
- **Iteración 5 (última permitida; mismo enfoque B, llevado de comprobación a estado).** La causa raíz de N1 es la
  misma que la del enfoque A a otra escala: el trinquete solo existía en las escrituras de este módulo. Ahora los
  bloqueos de seguridad se **retienen** (`nutrition_profile.held_blocks`): entran en cuanto cualquier entrada los
  levanta (perfil, medición, triaje, vínculo de tutor, ajustes, y los datos previos al migrar) y solo salen por
  `app.nutrition_sync` cuando las entradas ya no los levantan **y** quien actúa puede liberarlos: nutricionista o
  clínico de la sede (cualquiera; también al firmar una evaluación, o con `nutrition_release_blocks` y un motivo), el
  propio socio (solo las respuestas de su cuestionario). Toda liberación queda auditada. `ritmo_inseguro` no se
  retiene: compara dos valores vivos y se comprueba en cada plan.
  - B1: un plan retirado por seguridad queda siempre con `outdated_reason = 'requiere_profesional'` y oculto al socio.
  - R1: bajar un límite retira (y oculta, `limites_cambio`) todo plan enviado que ya no pasa la comprobación completa.
  - R2: para la pérdida, el gasto que declara quien llama no se cree por debajo de reposo × factor de actividad
    diaria (1.2/1.3/1.4).
  - Pruebas nuevas (6) verificadas por mutación: cada una falla al quitar su corrección.
  - Resultado it.5: compuerta 1–7 verde (db 834, api 362, web 179). Revisión: en curso. Si no firma: parada dura.

## Decisiones técnicas de las fases 1–2
- Ejercicio **neto** de reposo: (MET − 1) × kg × h, porque el reposo ya está en basal × factor; con METs brutos se
  contaría dos veces. Valores MET de la edición 2024 del Compendium (Herrmann 2024, permitida por la lista: «o la
  edición más reciente»), verificados en pacompendium.com el 2026-11-08.
- Katch-McArdle: el pedido pide ofrecerla con masa magra medida, pero **no está en la lista cerrada de fuentes**; no
  se usa ni se cita hasta que se agregue su fuente a la lista.
- 7,700 kcal por kg y el superávit del 10 % para ganar masa son SUPUESTOS (no están en la lista); se usan para el
  cálculo y nunca se citan como fuente.

