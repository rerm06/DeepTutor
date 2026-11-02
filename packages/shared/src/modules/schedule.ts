/** Shared types and constants for module schedule (E6 · Agenda, reservas y acceso). Mirror migration 0007. */
export const MODULE_SCHEDULE = "schedule" as const;

export const BOOKING_STATUSES = [
  "booked",
  "waitlisted",
  "cancelled",
  "attended",
  "no_show",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
export const ATTENDANCE_STATUSES = ["attended", "no_show"] as const;

export const APPOINTMENT_KINDS = [
  "personal_training",
  "assessment",
  "nutrition",
  "clinical",
] as const;
export type AppointmentKind = (typeof APPOINTMENT_KINDS)[number];

export const CHECKIN_RESULTS = ["allowed", "denied"] as const;
export const CHECKIN_REASONS = [
  "active",
  "trial",
  "past_due",
  "past_due_denied",
  "frozen",
  "cancelled",
  "lead",
  "invalid_token",
  "expired_token",
] as const;
export type CheckinReason = (typeof CHECKIN_REASONS)[number];

/** QR credential: one HMAC window lasts 30 s; verification accepts the current and the previous window. */
export const QR_WINDOW_SECONDS = 30;
/** Class names: letters, digits and light punctuation (same rule as the database CHECK). */
export const CLASS_NAME_PATTERN = /^[A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9 &'.-]{1,60}$/;
