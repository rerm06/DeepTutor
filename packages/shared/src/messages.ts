/**
 * E8 · Outbound message templates (spec §11, §15 E8). The API renders every message server-side from this
 * catalogue: callers pick a template key, a locale and plain-string variables, never a body or a purpose.
 * Purpose drives the consent check in app.enqueue_message, so it must come from here and nowhere else.
 *
 * Copy rules: no health promises, and the AI or staff are never called "nutricionista"/"dietista" (Ley 82).
 * Every marketing template ends with the opt-out line of its locale.
 */

/** Must match the SQL enums in packages/db/migrations/0004_messaging_consent.sql. */
export const MESSAGE_CHANNELS = ["whatsapp", "sms", "email"] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];
export const MESSAGE_PURPOSES = ["transactional", "reminder", "marketing"] as const;
export type MessagePurpose = (typeof MESSAGE_PURPOSES)[number];
export const CONSENT_SOURCES = [
  "front_desk",
  "member_portal",
  "web_form",
  "import",
  "keyword",
] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];
export const MESSAGE_LOCALES = ["es", "en"] as const;
export type MessageLocale = (typeof MESSAGE_LOCALES)[number];

/** Opt-out line appended to every marketing message (keywords handled by app.is_opt_out_keyword). */
export const OPT_OUT_LINE: Readonly<Record<MessageLocale, string>> = {
  es: "Responde BAJA para no recibir más mensajes.",
  en: "Reply STOP to unsubscribe.",
};

export interface MessageTemplate {
  purpose: MessagePurpose;
  body: Readonly<Record<MessageLocale, string>>;
}

const marketing = (es: string, en: string): MessageTemplate => ({
  purpose: "marketing",
  body: { es: `${es} ${OPT_OUT_LINE.es}`, en: `${en} ${OPT_OUT_LINE.en}` },
});

export const MESSAGE_TEMPLATES = {
  "class.reminder": {
    purpose: "reminder",
    body: {
      es: "{{brand}}: Hola {{name}}, te recordamos tu clase de {{class_name}} en {{location}} el {{date}} a las {{time}}.",
      en: "{{brand}}: Hi {{name}}, a reminder of your {{class_name}} class at {{location}} on {{date}} at {{time}}.",
    },
  },
  "membership.renewal_notice": {
    purpose: "transactional",
    body: {
      es: "{{brand}}: Hola {{name}}, tu membresía {{plan}} se renueva el {{date}} por {{amount}}.",
      en: "{{brand}}: Hi {{name}}, your {{plan}} membership renews on {{date}} for {{amount}}.",
    },
  },
  "payment.failed": {
    purpose: "transactional",
    body: {
      es: "{{brand}}: Hola {{name}}, no pudimos procesar tu pago de {{amount}}. Actualiza tu método de pago en {{link}}.",
      en: "{{brand}}: Hi {{name}}, we could not process your payment of {{amount}}. Update your payment method at {{link}}.",
    },
  },
  "card.expiring": {
    purpose: "transactional",
    body: {
      es: "{{brand}}: Hola {{name}}, tu tarjeta terminada en {{last4}} vence el {{date}}. Actualízala en {{link}}.",
      en: "{{brand}}: Hi {{name}}, your card ending in {{last4}} expires on {{date}}. Update it at {{link}}.",
    },
  },
  "promo.generic": marketing(
    "{{brand}}: Hola {{name}}, este mes tenemos {{offer}} en {{location}} hasta el {{date}}. Pregunta en recepción.",
    "{{brand}}: Hi {{name}}, this month we have {{offer}} at {{location}} until {{date}}. Ask at the front desk.",
  ),
} as const satisfies Record<string, MessageTemplate>;

export type TemplateKey = keyof typeof MESSAGE_TEMPLATES;
export const TEMPLATE_KEYS = Object.keys(MESSAGE_TEMPLATES) as TemplateKey[];

export type TemplateErrorCode = "unknown_template" | "unknown_locale" | "missing_variable";
export class TemplateError extends Error {
  constructor(
    readonly code: TemplateErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TemplateError";
  }
}

export interface RenderedMessage {
  templateKey: TemplateKey;
  locale: MessageLocale;
  purpose: MessagePurpose;
  body: string;
}

export function isTemplateKey(key: string): key is TemplateKey {
  return Object.hasOwn(MESSAGE_TEMPLATES, key);
}

const PLACEHOLDER = /\{\{([a-z][a-z0-9_]*)\}\}/g;

/** Placeholder names used by a template body, in order of first appearance. */
export function templateVariables(key: TemplateKey, locale: MessageLocale): string[] {
  return [
    ...new Set(
      Array.from(MESSAGE_TEMPLATES[key].body[locale].matchAll(PLACEHOLDER), (m) => m[1] ?? ""),
    ),
  ];
}

/**
 * Render a catalogue template as plain text (nothing is escaped). Single pass: a variable value that looks
 * like a placeholder is inserted literally, never expanded. Throws TemplateError on an unknown key or locale,
 * or when a placeholder has no (non-blank) value. Extra variables are ignored.
 */
export function renderTemplate(
  key: string,
  locale: string,
  vars: Readonly<Record<string, string>>,
): RenderedMessage {
  if (!isTemplateKey(key)) throw new TemplateError("unknown_template", `unknown template: ${key}`);
  if (!(MESSAGE_LOCALES as readonly string[]).includes(locale))
    throw new TemplateError("unknown_locale", `unknown locale: ${locale}`);
  const loc = locale as MessageLocale;
  const tpl: MessageTemplate = MESSAGE_TEMPLATES[key];
  const body = tpl.body[loc].replace(PLACEHOLDER, (_m, name: string) => {
    const value = Object.hasOwn(vars, name) ? vars[name] : undefined;
    if (typeof value !== "string" || value.trim() === "")
      throw new TemplateError("missing_variable", `missing variable: ${name}`);
    return value;
  });
  return { templateKey: key, locale: loc, purpose: tpl.purpose, body };
}
