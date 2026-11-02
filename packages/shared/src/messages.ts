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

/**
 * Template keys of the platform catalogue. The catalogue itself (purpose and ES/EN bodies) lives in
 * app.message_template (migration 0004) and the DATABASE renders every message: the API only forwards a key
 * and pattern-checked variables. Brand, first name, location and payment link are filled server-side.
 */
export const TEMPLATE_KEYS = [
  "class.reminder",
  "membership.renewal_notice",
  "payment.failed",
  "card.expiring",
  "promo.generic",
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

/** Client-supplied variables (all others are server-side). Patterns mirror app.template_variable. */
export const TEMPLATE_VARIABLES = [
  "class_name",
  "plan",
  "date",
  "time",
  "amount",
  "last4",
  "discount",
] as const;
