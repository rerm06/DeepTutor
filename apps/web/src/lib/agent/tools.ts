import { type ScreenInfo, describeScreen, fillField, press, resolveModule } from "./bridge";
import type { FunctionDecl } from "./live";

/** The function declarations the Live model may call. One set for every screen: the bridge reads the DOM. */
export const TOOLS: FunctionDecl[] = [
  {
    name: "describe_screen",
    description:
      "Lee la pantalla actual: título, campos (id, etiqueta, tipo, valor, opciones, estado de validación, si es solo manual), acciones (botones) y módulos a los que se puede navegar. Llámala antes de actuar y después de navegar.",
  },
  {
    name: "fill_field",
    description:
      "Escribe un valor en un campo. 'field' es el id de describe_screen (preferido) o la etiqueta. Para listas y opciones usa el texto de la opción; para casillas 'true'/'false'. Devuelve el valor aplicado y si quedó válido o el mensaje de error.",
    parameters: {
      type: "OBJECT",
      properties: {
        field: { type: "STRING", description: "id del campo o su etiqueta" },
        value: { type: "STRING", description: "valor a escribir, tal como lo confirmó la persona" },
      },
      required: ["field", "value"],
    },
  },
  {
    name: "press",
    description:
      "Presiona un botón, pestaña o enlace de la pantalla por su nombre visible. Para enviar un formulario pasa user_confirmed=true SOLO si la persona dijo que sí en este turno. Las acciones de dinero, borrado, envío o firma nunca se ejecutan: el botón queda resaltado para que la persona lo toque.",
    parameters: {
      type: "OBJECT",
      properties: {
        action: { type: "STRING", description: "nombre visible del botón" },
        user_confirmed: {
          type: "BOOLEAN",
          description: "true únicamente si la persona confirmó explícitamente enviar",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "navigate",
    description:
      "Abre un módulo del sistema (Socios, Agenda, Pagos y POS, Tienda, CRM, Reportes, Mi Plan, Progreso…).",
    parameters: {
      type: "OBJECT",
      properties: { destination: { type: "STRING", description: "nombre del módulo o su ruta" } },
      required: ["destination"],
    },
  },
];

export function systemInstruction(lang: "es" | "en", brand: string): string {
  const es = `Eres el asistente de voz de ${brand || "el gimnasio"} dentro de su sistema de gestión. Hablas español de Puerto Rico, claro y breve (máximo dos oraciones por turno). Al empezar di una vez que eres un asistente de inteligencia artificial.
Puedes operar cualquier módulo con tus herramientas: describe_screen, fill_field, press y navigate.
Reglas:
1. Llama describe_screen antes de actuar y después de cada navegación. Usa los ids de campo que devuelve.
2. Pregunta UN dato a la vez, en el orden de la pantalla. Nunca inventes ni supongas datos: si no lo sabes, pregunta.
3. Después de escribir, lee el resultado: si el estado es "invalid", explica el mensaje en palabras sencillas y vuelve a pedir el dato. Deletrea correos y confirma números leyéndolos dígito a dígito.
4. Los campos con manual=true (consentimientos, términos, relevo, mensajes, contraseñas) NO los marcas: pide a la persona que los marque con su propia mano y espera.
5. Antes de enviar un formulario resume los datos y pide un "sí" explícito; solo entonces llama press con user_confirmed=true.
6. Si press devuelve needs_user_tap, di que el botón quedó resaltado y que la persona debe tocarlo. Nunca intentes cobrar, borrar, enviar mensajes ni firmar.
7. La persona puede corregir cualquier campo a mano; si cambia algo, respétalo.
8. No pidas ni comentes datos de salud, diagnósticos o medicamentos salvo que un campo de la pantalla lo pida, y nunca des consejo médico.
9. Si la persona dice "para" o "detente", deja de actuar y confirma.`;
  const en = `You are the voice assistant of ${brand || "the gym"} inside its management system. Speak clear, brief English (two sentences per turn at most). At the start say once that you are an AI assistant.
You can operate any module with your tools: describe_screen, fill_field, press and navigate.
Rules:
1. Call describe_screen before acting and after every navigation. Use the field ids it returns.
2. Ask for ONE item at a time, in screen order. Never invent or assume data: if you don't know, ask.
3. After writing, read the result: if the state is "invalid", explain the message plainly and ask again. Spell emails back and read numbers digit by digit.
4. Fields with manual=true (consents, terms, waiver, messaging, passwords) you do NOT tick: ask the person to tick them by hand and wait.
5. Before submitting a form, summarise the data and ask for an explicit "yes"; only then call press with user_confirmed=true.
6. If press returns needs_user_tap, say the button is highlighted and the person must tap it. Never try to charge, delete, send messages or sign.
7. The person may correct any field by hand; respect their edits.
8. Do not ask about or discuss health data, diagnoses or medication unless a field on screen asks for it, and never give medical advice.
9. If the person says "stop", stop acting and confirm.`;
  return lang === "en" ? en : es;
}

export const INTERVIEW_PROMPT: Record<"es" | "en", string> = {
  es: "Modo entrevista: llama describe_screen y completa TODOS los campos de esta pantalla preguntándome uno a uno. Confirma cada dato, corrige lo que salga inválido, pídeme marcar yo los campos manuales y al final resume y pregúntame si envío.",
  en: "Interview mode: call describe_screen and fill in EVERY field on this screen by asking me one at a time. Confirm each item, fix anything invalid, ask me to tick the manual fields myself and at the end summarise and ask whether to submit.",
};

export interface ToolLog {
  tool: string;
  label: string;
  ok: boolean;
  detail?: string;
}

/** Run one tool call against the live DOM. */
export async function runTool(
  name: string,
  args: Record<string, unknown>,
  navigate: (path: string) => void,
  log: (l: ToolLog) => void,
): Promise<unknown> {
  const str = (k: string) => (typeof args[k] === "string" ? (args[k] as string) : "");
  if (name === "describe_screen") {
    const s: ScreenInfo = describeScreen();
    log({ tool: name, label: s.title || s.path, ok: true });
    return s;
  }
  if (name === "fill_field") {
    const r = await fillField(str("field"), str("value"));
    log({
      tool: name,
      label: r.field ?? str("field"),
      ok: r.ok && r.state !== "invalid",
      detail: r.ok ? (r.state === "invalid" ? r.message : r.value) : r.error,
    });
    return r;
  }
  if (name === "press") {
    const r = await press(str("action"), args.user_confirmed === true);
    log({
      tool: name,
      label: r.action ?? str("action"),
      ok: r.ok,
      detail: r.ok ? undefined : r.error,
    });
    return r;
  }
  if (name === "navigate") {
    const m = resolveModule(str("destination"));
    if (!m) {
      log({ tool: name, label: str("destination"), ok: false, detail: "not_found" });
      return {
        ok: false,
        error: "module_not_found",
        modules: describeScreen().modules.map((x) => x.name),
      };
    }
    navigate(m.path);
    await new Promise((r) => setTimeout(r, 350));
    log({ tool: name, label: m.name, ok: true });
    return { ok: true, module: m.name, path: m.path };
  }
  return { ok: false, error: "unknown_tool" };
}
