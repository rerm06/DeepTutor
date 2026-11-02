/** Shared types and constants for module floor (Sala, equipos y circuitos, spec §6.4). */
export const MODULE_FLOOR = "floor" as const;

/** Equipment types an asset can have. Must match `app.equipment_type` in packages/db/migrations/0011_floor.sql. */
export const FLOOR_ASSET_TYPES = [
  "barbell",
  "dumbbell",
  "kettlebell",
  "cable",
  "leg_press",
  "chest_press",
  "lat_pulldown",
  "row_machine",
  "treadmill",
  "bike",
  "rower",
  "bench",
  "rack",
  "smith",
  "bodyweight_station",
  "other",
] as const;
export type FloorAssetType = (typeof FLOOR_ASSET_TYPES)[number];
/** Exercise equipment: any asset type, or "none" (needs no equipment; always available as a substitute). */
export const FLOOR_EQUIPMENT_TYPES = [...FLOOR_ASSET_TYPES, "none"] as const;
export type FloorEquipmentType = (typeof FLOOR_EQUIPMENT_TYPES)[number];

export const FLOOR_MOVEMENT_PATTERNS = [
  "squat",
  "hinge",
  "push_horizontal",
  "push_vertical",
  "pull_horizontal",
  "pull_vertical",
  "lunge",
  "carry",
  "core",
  "cardio",
] as const;
export type FloorMovementPattern = (typeof FLOOR_MOVEMENT_PATTERNS)[number];

export const FLOOR_ASSET_STATUSES = ["ok", "out_of_service", "maintenance"] as const;
export type FloorAssetStatus = (typeof FLOOR_ASSET_STATUSES)[number];
export const FLOOR_ISSUE_KINDS = ["out_of_service", "busy"] as const;
export type FloorIssueKind = (typeof FLOOR_ISSUE_KINDS)[number];
export const FLOOR_ISSUE_STATUSES = ["reported", "confirmed", "resolved"] as const;
export type FloorIssueStatus = (typeof FLOOR_ISSUE_STATUSES)[number];

/** Station code on the QR label: uppercase letters, digits and dashes (mirrors the SQL CHECK). */
export const FLOOR_STATION_CODE = /^[A-Z0-9][A-Z0-9-]{2,23}$/;
/** Names of exercises, circuits, brands and models (mirrors the SQL CHECK). */
export const FLOOR_SAFE_NAME = /^[A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9 &'().,/+-]{2,80}$/;

/** Roles that manage equipment, the exercise library and circuits (at their locations). */
export const FLOOR_MANAGERS = ["owner", "location_manager", "trainer"] as const;
/** Roles that work the issues queue (front desk can confirm, not resolve). */
export const FLOOR_ISSUE_STAFF = ["owner", "location_manager", "trainer", "front_desk"] as const;

/** Normalise what a member typed or pasted from a QR label into a station code (trim, uppercase). */
export function normalizeStationCode(raw: string): string {
  return raw.trim().toUpperCase();
}
