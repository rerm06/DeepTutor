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
