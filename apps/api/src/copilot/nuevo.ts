import type { ActionDef } from "./registry.js";

// Operations the owner's request needs that do not exist in the code today. Each one is a proposal: nothing here
// is built until a human approves it (see docs/copiloto/STATE.md). They have no route and no test yet.

type Nuevo = Pick<
  ActionDef,
  "id" | "description" | "examples" | "risk" | "ui" | "knowledge" | "notes"
> & {
  fields?: ActionDef["fields"];
  roles?: ActionDef["roles"];
};

const OWNER_MANAGER: ActionDef["roles"] = ["owner", "location_manager"];

function nuevo(n: Nuevo): ActionDef {
  return {
    id: n.id,
    module: n.id.split(".")[0] ?? "",
    description: n.description,
    examples: n.examples,
    route: null,
    input: { params: null, query: null, body: null },
    fields: n.fields ?? [],
    service: "(por construir)",
    ui: n.ui,
    audience: "staff",
    roles: n.roles ?? OWNER_MANAGER,
    rolesEvidence: "propuesta: mismas reglas RLS que el recurso relacionado (por aprobar)",
    risk: n.risk,
    auditEvent: n.id,
    auditExisting: null,
    knowledge: n.knowledge,
    test: null,
    copilot: true,
    status: "nuevo",
    notes: n.notes,
  };
}

export const NUEVO: ActionDef[] = [
  // ── Clases (bloqueo reportado)
  nuevo({
    id: "clases.editar_tipo",
    description: "Edita una clase del catálogo: nombre, descripción, duración y cupo por defecto.",
    examples: ["Cambia la duración de spinning a 50 minutos", "Sube el cupo de yoga a 18"],
    risk: "R1",
    ui: "/staff/schedule",
    knowledge: ["clase"],
    notes:
      "NUEVO: la RLS ya permite UPDATE (0007_schedule.sql:696) pero no hay ruta ni pantalla. Hoy no existe forma de corregir una clase creada.",
  }),
  nuevo({
    id: "clases.desactivar_tipo",
    description: "Desactiva (o reactiva) una clase del catálogo sin borrar su historial.",
    examples: ["Desactiva la clase de zumba", "Vuelve a activar pilates"],
    risk: "R2",
    ui: "/staff/schedule",
    knowledge: ["clase"],
    notes:
      "NUEVO: la columna class_type.active existe, pero ninguna ruta la cambia. Desactivar es R2 según la tabla de riesgo.",
  }),
  nuevo({
    id: "clases.duplicar_tipo",
    description: "Crea una clase nueva copiando otra del catálogo con un nombre distinto.",
    examples: ["Duplica spinning como spinning intermedio", "Haz una copia de yoga para la tarde"],
    risk: "R1",
    ui: "/staff/schedule",
    knowledge: ["clase"],
    notes: "NUEVO: no existe; es una composición de leer + crear tipo.",
  }),
  nuevo({
    id: "clases.definir_detalles",
    description:
      "Asigna a una clase del catálogo instructor(es), sala, color y el plan que la incluye (o su precio).",
    examples: ["Spinning la da Luis en el salón 2", "Ponle color verde a yoga"],
    risk: "R2",
    ui: "/staff/schedule",
    knowledge: ["clase"],
    notes:
      "NUEVO: class_type no tiene instructor, sala, color ni precio/plan (0007_schedule.sql:17). Requiere columnas o tabla nueva (decisión humana). Precio/plan = regla de cobro → R2 y aprobación.",
  }),
  nuevo({
    id: "agenda.programar_recurrente",
    description:
      "Programa una serie de sesiones de una clase con una regla de recurrencia (p. ej. lunes y miércoles a las 6 p. m. por 8 semanas).",
    examples: [
      "Programa spinning lunes y miércoles a las seis por dos meses",
      "Pon yoga todos los sábados a las nueve",
    ],
    risk: "R1",
    ui: "/staff/schedule",
    knowledge: ["clase"],
    fields: [
      { name: "class_type_id", type: "uuid", required: true },
      { name: "location_id", type: "uuid", required: true },
      {
        name: "rrule",
        type: "string",
        required: true,
        rule: "RFC 5545 RRULE con COUNT o UNTIL (máx. 26 semanas, por definir)",
      },
      { name: "start_time", type: "HH:MM", required: true, rule: "hora local de la sede" },
    ],
    notes:
      "NUEVO: solo existe crear una sesión suelta (POST /v1/schedule/sessions). class_session no tiene regla de recurrencia; propuesta: tabla class_series + generación de sesiones.",
  }),
  nuevo({
    id: "agenda.reprogramar_sesion",
    description:
      "Cambia hora, instructor, sala o cupo de una sesión programada y avisa a los reservados.",
    examples: [
      "Mueve el spinning de hoy a las siete",
      "Cambia el instructor de yoga del jueves a Ana",
    ],
    risk: "R1",
    ui: "/staff/schedule",
    knowledge: ["clase"],
    notes:
      "NUEVO: solo existen crear y cancelar sesión; class_session no tiene ruta de edición. El aviso a socios reservados usaría la mensajería existente (consentimiento y horario).",
  }),

  // ── Hallazgos del inventario (Fase 0): operaciones que el dueño pedirá y no existen
  nuevo({
    id: "socios.buscar",
    description: "Busca socios por nombre, número, correo o estado, con paginación.",
    examples: ["Busca a la socia Ana Rivera", "¿Qué socios están morosos?"],
    risk: "R0",
    ui: "/staff/members",
    knowledge: [],
    notes:
      "NUEVO: GET /v1/members no filtra por nombre ni estado y corta en 500 filas; el copiloto necesita desambiguar homónimos con un dato distintivo.",
  }),
  nuevo({
    id: "usuarios.cambiar_rol",
    description: "Cambia el rol o la sede de una cuenta de personal.",
    examples: ["Pasa a Luis de recepción a entrenador", "Asigna a Nilda a la sede de Toa Baja"],
    risk: "R2",
    ui: "/staff/team",
    knowledge: [],
    roles: ["owner"],
    notes:
      "NUEVO: la RLS staff_update lo permitiría pero no hay ruta. Respeta las cuentas protegidas (0028).",
  }),
  nuevo({
    id: "usuarios.desactivar",
    description: "Desactiva (o reactiva) una cuenta de personal sin borrar su historial.",
    examples: ["Desactiva la cuenta de Pedro", "Vuelve a activar a Carmen"],
    risk: "R2",
    ui: "/staff/team",
    knowledge: [],
    roles: ["owner"],
    notes: "NUEVO: no hay ruta; las cuentas protegidas no se pueden desactivar (trigger de 0028).",
  }),
  nuevo({
    id: "suscripciones.cambiar_plan",
    description:
      "Cambia el plan de una suscripción activa, con prorrateo según la política de cobro.",
    examples: ["Pásale a Ana el plan premium", "Baja a Juan al plan básico desde el mes que viene"],
    risk: "R2",
    ui: "/staff/members",
    knowledge: ["socio"],
    notes:
      "NUEVO: hoy solo existen crear, congelar y cancelar. Regla de cobro nueva → decisión humana.",
  }),
  nuevo({
    id: "suscripciones.descongelar",
    description: "Termina antes de tiempo la congelación de una suscripción.",
    examples: ["Descongela la membresía de Ana", "Ana volvió, reactívale la suscripción"],
    risk: "R2",
    ui: "/staff/members",
    knowledge: ["socio"],
    notes: "NUEVO: no hay ruta para deshacer una congelación.",
  }),
  nuevo({
    id: "suscripciones.deshacer_cancelacion",
    description: "Revierte una cancelación programada antes de su fecha efectiva.",
    examples: ["Cancela la baja de Juan, se queda", "Revierte la cancelación de Ana"],
    risk: "R2",
    ui: "/staff/members",
    knowledge: ["socio"],
    notes: "NUEVO: no hay ruta.",
  }),
  nuevo({
    id: "suscripciones.editar_politica_cobro",
    description:
      "Edita la política de cobro de la organización (días de gracia, reintentos, recargos).",
    examples: ["Dale cinco días de gracia a los pagos", "Cambia los reintentos de cobro a tres"],
    risk: "R2",
    ui: null,
    knowledge: ["sistema"],
    roles: ["owner"],
    notes:
      "NUEVO: la base permite al dueño cambiar billing_policy pero no hay ruta ni pantalla. Regla de cobro → decisión humana.",
  }),
  nuevo({
    id: "facturas.reembolsar_pago",
    description: "Reembolsa total o parcialmente un pago de factura.",
    examples: ["Devuélvele a Ana los 40 dólares del pago de ayer", "Reembolsa la factura 1023"],
    risk: "R3",
    ui: null,
    knowledge: ["socio"],
    roles: ["owner"],
    notes:
      "NUEVO: hoy solo se puede anular una factura sin pagos. Con tarjeta toca la pasarela (hoy simulada, Stripe sin conectar) → R3 e integración de pagos reales: decisión humana.",
  }),
  nuevo({
    id: "inventario.recibir_de_proveedor",
    description: "Registra una entrada de mercancía con su proveedor y costo unitario.",
    examples: [
      "Llegaron 24 botellas de agua de Distribuidora Caribe a 50 centavos",
      "Recibe 10 proteínas del proveedor",
    ],
    risk: "R1",
    ui: null,
    knowledge: ["producto", "proveedor"],
    notes:
      "NUEVO: la recepción de stock no guarda proveedor ni costo; sin eso el P&L no tiene costo de ventas.",
  }),
  nuevo({
    id: "mensajes.enviar_segmento",
    description:
      "Envía un mensaje a un segmento de socios (por estado, plan, clase o sede), respetando consentimiento y horario.",
    examples: [
      "Avísale a todos los de spinning que mañana no hay clase",
      "Mándale un recordatorio a los morosos",
    ],
    risk: "R2",
    ui: "/staff/inbox",
    knowledge: [],
    notes:
      "NUEVO: POST /v1/messages envía a un solo socio; no existe envío masivo ni por segmento.",
  }),
  nuevo({
    id: "mensajes.cancelar_en_cola",
    description: "Cancela un mensaje programado que todavía no ha salido.",
    examples: ["Cancela el recordatorio que programé para mañana", "No envíes el mensaje a Juan"],
    risk: "R1",
    ui: "/staff/inbox",
    knowledge: [],
    notes: "NUEVO: no hay ruta para cancelar mensajes en cola.",
  }),
  nuevo({
    id: "mensajes.configurar_horario",
    description: "Configura la ventana horaria permitida para recordatorios y mercadeo.",
    examples: [
      "No mandes mensajes antes de las nueve",
      "Cambia el horario de mensajes hasta las ocho de la noche",
    ],
    risk: "R2",
    ui: null,
    knowledge: ["sistema"],
    roles: ["owner"],
    notes: "NUEVO: message_policy solo se cambia por SQL.",
  }),
  nuevo({
    id: "mensajes.crear_plantilla",
    description: "Crea una plantilla de mensaje propia del gimnasio.",
    examples: [
      "Crea una plantilla de bienvenida",
      "Guarda este mensaje como plantilla de cumpleaños",
    ],
    risk: "R1",
    ui: null,
    knowledge: ["sistema"],
    notes: "NUEVO: hoy hay 5 plantillas fijas de la plataforma.",
  }),
  nuevo({
    id: "mensajes.marcar_atendido",
    description: "Marca como atendido un mensaje entrante de la bandeja.",
    examples: ["Marca como atendido el mensaje de Ana", "Ya contesté lo de Juan, ciérralo"],
    risk: "R1",
    ui: "/staff/inbox",
    knowledge: [],
    notes: "NUEVO: el permiso existe en la base pero no hay ruta.",
  }),
  nuevo({
    id: "retos.editar",
    description: "Edita o cierra un reto (nombre, fechas, sede).",
    examples: ["Extiende el reto de pasos una semana", "Cierra el reto de octubre"],
    risk: "R1",
    ui: null,
    knowledge: [],
    notes: "NUEVO: la política de base existe pero no hay ruta.",
  }),
  nuevo({
    id: "retos.retirar_participante",
    description: "Saca a un socio de un reto.",
    examples: ["Saca a Juan del reto de pasos", "Retira a Ana del reto"],
    risk: "R1",
    ui: null,
    knowledge: [],
    notes: "NUEVO: no hay ruta.",
  }),
  nuevo({
    id: "coach.ver_escalaciones_resumen",
    description:
      "Muestra al dueño un resumen sin contenido clínico de las escalaciones abiertas por sede.",
    examples: [
      "¿Cuántos casos de seguimiento hay abiertos?",
      "¿Hay socios esperando que un entrenador los llame?",
    ],
    risk: "R0",
    ui: null,
    knowledge: [],
    roles: ["owner"],
    notes:
      "NUEVO: hoy el dueño no tiene acceso a datos del coach por diseño (0016:138). Exponer siquiera un agregado es una decisión sobre datos de salud → humana.",
  }),

  // ── Bitácora y copiloto
  nuevo({
    id: "bitacora.filtrar",
    description:
      "Muestra la bitácora filtrada por origen (copiloto, manual, automatización, portal del socio, sistema), módulo, usuario y fecha, con el antes y después.",
    examples: ["Enséñame lo que hizo el copiloto hoy", "¿Quién cambió el precio del plan básico?"],
    risk: "R0",
    ui: "/staff/audit",
    knowledge: [],
    roles: ["owner"],
    notes:
      "NUEVO: audit_log no guarda origen, antes/después, sesión ni tool_call (0001_tenancy.sql:192); la pantalla /staff/audit no filtra por origen. Propuesta: extender audit_log (no tabla nueva).",
  }),
  nuevo({
    id: "copiloto.editar_instrucciones",
    description: "Edita y versiona la instrucción de sistema del copiloto.",
    examples: [
      "Dile al copiloto que siempre me hable de usted",
      "Vuelve a la versión anterior de las instrucciones",
    ],
    risk: "R2",
    ui: null,
    knowledge: ["sistema"],
    roles: ["owner"],
    notes: "NUEVO: no existe almacenamiento de instrucciones versionadas.",
  }),
  nuevo({
    id: "conocimiento.consultar",
    description:
      "Responde preguntas sobre cómo funciona el gimnasio y su operación usando la base de conocimiento (File Search), con citas.",
    examples: [
      "¿Cuál es la política de cancelación de clases?",
      "¿Qué sabemos de la socia Ana Rivera?",
    ],
    risk: "R0",
    ui: null,
    knowledge: [],
    roles: ["owner"],
    notes:
      "NUEVO: no hay File Search stores ni clave de Gemini Developer API para RAG. Live API no soporta File Search como herramienta: se expone como función del servidor.",
  }),
  nuevo({
    id: "conocimiento.reindexar_todo",
    description: "Regenera y vuelve a subir todos los documentos de conocimiento del gimnasio.",
    examples: [
      "Reindexa todo el conocimiento",
      "Vuelve a cargar la información del gimnasio al copiloto",
    ],
    risk: "R1",
    ui: null,
    knowledge: ["sistema", "socio", "clase", "producto", "proveedor", "reporte"],
    roles: ["owner"],
    notes: "NUEVO: requiere knowledge_outbox, trabajador programado y panel de salud.",
  }),
  nuevo({
    id: "conocimiento.ver_salud",
    description:
      "Muestra el retraso de sincronización y los eventos pendientes o fallidos del conocimiento.",
    examples: ["¿Está al día el conocimiento del copiloto?", "¿Hay errores de sincronización?"],
    risk: "R0",
    ui: null,
    knowledge: [],
    roles: ["owner"],
    notes: "NUEVO: depende de knowledge_outbox.",
  }),

  // ── Reportes: generar → analizar → auditar → informar
  nuevo({
    id: "reportes.generar",
    description:
      "Genera un reporte determinista guardado con sus parámetros y hash de datos (ingresos y cobros pendientes, asistencia por clase y franja, retención y bajas, ocupación, ventas e inventario, rendimiento por instructor).",
    examples: [
      "Genera el reporte de ingresos de octubre",
      "Hazme el de asistencia por clase de esta semana",
    ],
    risk: "R1",
    ui: "/staff/reports",
    knowledge: ["reporte"],
    roles: ["owner"],
    notes:
      "NUEVO: hoy los reportes son lecturas en pantalla sin guardar parámetros ni hash; faltan tipos (ver hallazgos del módulo reportes).",
  }),
  nuevo({
    id: "reportes.analizar",
    description:
      "Redacta hallazgos y recomendaciones solo a partir del JSON de un reporte guardado.",
    examples: [
      "Analiza el reporte de ingresos",
      "¿Qué me recomiendas según el reporte de asistencia?",
    ],
    risk: "R0",
    ui: "/staff/reports",
    knowledge: ["reporte"],
    roles: ["owner"],
    notes: "NUEVO.",
  }),
  nuevo({
    id: "reportes.auditar",
    description:
      "Verificador separado: recalcula desde la base cada cifra citada y marca cifras sin fuente, contradicciones y periodos mal aplicados.",
    examples: ["Audita el análisis de ingresos", "Verifica las cifras del reporte"],
    risk: "R0",
    ui: "/staff/reports",
    knowledge: ["reporte"],
    roles: ["owner"],
    notes: "NUEVO.",
  }),
  nuevo({
    id: "reportes.enviar",
    description:
      "Envía un reporte auditado sin hallazgos críticos por los canales del app, respetando consentimiento y horario.",
    examples: ["Mándale el reporte de ingresos a Nilda", "Envía el resumen semanal a los gerentes"],
    risk: "R2",
    ui: "/staff/reports",
    knowledge: ["reporte"],
    roles: ["owner"],
    notes: "NUEVO: bloqueado si la auditoría tiene un hallazgo crítico.",
  }),
];
