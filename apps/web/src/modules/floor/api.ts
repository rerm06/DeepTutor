import type { ApiClient } from "../../api/client";
import type { ListOf } from "../../api/types";

// Module floor client. Mirrors packages/shared/src/modules/floor.ts (the web app does not depend on @gym/shared).
export const ASSET_TYPES = [
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
export const EQUIPMENT_TYPES = [...ASSET_TYPES, "none"] as const;
export const MOVEMENT_PATTERNS = [
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
export const ASSET_STATUSES = ["ok", "out_of_service", "maintenance"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];
export const STATION_CODE = /^[A-Z0-9][A-Z0-9-]{2,23}$/;
export const SAFE_NAME = /^[A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9 &'().,/+-]{2,80}$/;

export const FLOOR_MANAGERS = ["owner", "location_manager", "trainer"];
export const FLOOR_ISSUE_STAFF = ["owner", "location_manager", "trainer", "front_desk"];

export const normalizeCode = (raw: string) => raw.trim().toUpperCase();

export interface Asset {
  id: string;
  location_id: string;
  equipment_type: string;
  brand: string | null;
  model: string | null;
  station_code: string;
  status: AssetStatus;
  notes: string | null;
  open_issues: number;
}
export interface Issue {
  id: string;
  asset_id: string;
  station_code: string;
  equipment_type: string;
  asset_status: AssetStatus;
  location_id: string;
  kind: "out_of_service" | "busy";
  status: "reported" | "confirmed" | "resolved";
  note: string | null;
  reported_at: string;
  mine: boolean;
}
export interface Exercise {
  id: string;
  name: string;
  movement_pattern: string;
  equipment_type: string;
  cues: string;
  active: boolean;
}
export interface Circuit {
  id: string;
  location_id: string;
  name: string;
  active: boolean;
  steps: number;
}
export interface CircuitStep {
  id: string;
  position: number;
  exercise_id: string;
  exercise_name: string;
  movement_pattern: string;
  cues: string;
  asset_id: string | null;
  station_code: string | null;
  asset_status: AssetStatus | null;
  equipment_type: string;
  sets: number;
  reps: number;
  rest_seconds: number;
}
export interface CircuitDetail {
  id: string;
  location_id: string;
  name: string;
  active: boolean;
  steps: CircuitStep[];
}
export interface StepInput {
  exercise_id: string;
  asset_id?: string | null;
  equipment_type?: string | null;
  sets: number;
  reps: number;
  rest_seconds: number;
}
export interface Substitute {
  exercise_id: string;
  name: string;
  movement_pattern: string;
  equipment_type: string;
  cues: string;
  asset_id: string | null;
  station_code: string | null;
  same_exercise: boolean;
}
export interface SetLog {
  id: string;
  exercise_id: string;
  exercise_name: string;
  location_id: string;
  reps: number;
  weight_kg: number;
  at: string;
}
export interface StationCard {
  asset: {
    id: string;
    location_id: string;
    location_name: string;
    equipment_type: string;
    brand: string | null;
    model: string | null;
    station_code: string;
    status: AssetStatus;
  };
  exercises: Array<Pick<Exercise, "id" | "name" | "movement_pattern" | "equipment_type" | "cues">>;
  circuit_steps: Array<{ circuit_id: string; circuit_name: string; position: number }>;
}

export interface RoutineStep {
  position: number;
  exercise_id: string;
  exercise_name: string;
  sets: number;
  reps: number;
  rest_seconds: number;
  station_code: string | null;
  equipment_type: string | null;
  done: number;
}
export interface Routine {
  run_id: string;
  circuit_id: string;
  circuit_name: string;
  location_id: string;
  started_at: string;
  finished_at: string | null;
  sets_done: number;
  sets_planned: number;
  pct: number;
}
export interface EquipmentUse {
  id: string;
  asset_id: string;
  station_code: string;
  equipment_type: string;
  location_id: string;
  location_name: string;
  exercise_id: string | null;
  exercise_name: string | null;
  circuit_run_id: string | null;
  started_at: string;
  ended_at: string | null;
}
export interface UseView {
  use: EquipmentUse | null;
  routine: (Routine & { steps: RoutineStep[] }) | null;
}
export interface LiveAsset {
  id: string;
  station_code: string;
  equipment_type: string;
  status: AssetStatus;
  location_id: string;
  uses_today: number;
  members_today: number;
  minutes_today: number;
  sets_today: number;
  in_use: Array<{
    use_id: string;
    member_id: string;
    name: string | null;
    since: string;
    last_activity_at: string;
    exercise_name: string | null;
    circuit_name: string | null;
  }>;
}
export interface LiveBoard {
  at: string;
  totals: {
    stations: number;
    in_use: number;
    members_now: number;
    uses_today: number;
    down: number;
  };
  assets: LiveAsset[];
  training: Array<{
    run_id: string;
    member_id: string;
    name: string | null;
    circuit_name: string;
    started_at: string;
    sets_done: number;
    sets_planned: number;
    pct: number;
    station_code: string | null;
  }>;
}
export interface Training {
  member_id: string;
  open: (Routine & { steps: RoutineStep[] }) | null;
  routines: Routine[];
  uses: Array<{
    id: string;
    station_code: string;
    equipment_type: string;
    exercise_name: string | null;
    circuit_name: string | null;
    started_at: string;
    ended_at: string | null;
    active: boolean;
    minutes: number;
  }>;
  by_equipment: Array<{ equipment_type: string; uses: number }>;
}

/** The URL printed in a station's QR: a phone camera opens it straight on the station page. */
export const stationUrl = (code: string, origin = globalThis.location?.origin ?? "") =>
  `${origin}/s/${encodeURIComponent(code)}`;
/** A station code from a scanned QR (our URL, or a bare code on older labels); null otherwise. */
export function codeFromScan(raw: string): string | null {
  const v = raw.trim();
  const fromUrl = v.match(/\/s\/([A-Za-z0-9-]{3,24})(?:[?#/]|$)/)?.[1];
  const code = normalizeCode(fromUrl ?? v);
  return STATION_CODE.test(code) ? code : null;
}

function qs(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
}
const enc = encodeURIComponent;

export function floorApi(api: ApiClient) {
  const r = api.request;
  return {
    assets: (locationId?: string) =>
      r<ListOf<Asset>>("GET", `/floor/assets${qs({ location_id: locationId })}`),
    createAsset: (a: {
      location_id: string;
      equipment_type: string;
      station_code?: string;
      quantity?: number;
      brand?: string;
      model?: string;
      notes?: string;
    }) =>
      r<{ id: string; station_code: string; created: Array<{ id: string; station_code: string }> }>(
        "POST",
        "/floor/assets",
        a,
      ),
    setAssetStatus: (id: string, status: AssetStatus) =>
      r<{ id: string; status: AssetStatus }>("PATCH", `/floor/assets/${enc(id)}`, { status }),
    station: (code: string) => r<StationCard>("GET", `/floor/stations/${enc(code)}`),
    issues: (locationId?: string, status?: string) =>
      r<ListOf<Issue>>("GET", `/floor/issues${qs({ location_id: locationId, status })}`),
    report: (assetId: string, kind: "busy" | "out_of_service") =>
      r<{ id: string }>("POST", `/floor/assets/${enc(assetId)}/issues`, { kind }),
    confirm: (id: string) =>
      r<{ asset_status: AssetStatus }>("POST", `/floor/issues/${enc(id)}/confirm`),
    resolve: (id: string) =>
      r<{ asset_status: AssetStatus }>("POST", `/floor/issues/${enc(id)}/resolve`, {
        restore_asset: true,
      }),
    exercises: () => r<ListOf<Exercise>>("GET", "/floor/exercises"),
    createExercise: (e: Omit<Exercise, "id">) => r<{ id: string }>("POST", "/floor/exercises", e),
    setExerciseActive: (id: string, active: boolean) =>
      r<{ id: string }>("PATCH", `/floor/exercises/${enc(id)}`, { active }),
    substitutes: (exerciseId: string, locationId: string, excludeAssetId?: string | null) =>
      r<ListOf<Substitute>>(
        "GET",
        `/floor/substitutes${qs({
          exercise_id: exerciseId,
          location_id: locationId,
          exclude_asset_id: excludeAssetId ?? undefined,
        })}`,
      ),
    circuits: (locationId?: string) =>
      r<ListOf<Circuit>>("GET", `/floor/circuits${qs({ location_id: locationId })}`),
    circuit: (id: string) => r<CircuitDetail>("GET", `/floor/circuits/${enc(id)}`),
    createCircuit: (c: { location_id: string; name: string }) =>
      r<{ id: string }>("POST", "/floor/circuits", c),
    setCircuitActive: (id: string, active: boolean) =>
      r<{ id: string }>("PATCH", `/floor/circuits/${enc(id)}`, { active }),
    saveSteps: (id: string, steps: StepInput[]) =>
      r<{ id: string; steps: number }>("PUT", `/floor/circuits/${enc(id)}/steps`, { steps }),
    startRun: (circuitId: string) =>
      r<{ id: string }>("POST", `/floor/circuits/${enc(circuitId)}/runs`),
    finishRun: (runId: string) => r<{ id: string }>("POST", `/floor/runs/${enc(runId)}/finish`),
    logSet: (s: {
      exercise_id: string;
      location_id: string;
      asset_id?: string;
      circuit_run_id?: string;
      reps: number;
      weight_kg: number;
    }) => r<{ id: string }>("POST", "/floor/sets", s),
    mySets: () => r<ListOf<SetLog>>("GET", "/floor/sets?limit=20"),
    startUse: (code: string, source: "scan" | "code" = "scan") =>
      r<UseView>("POST", `/floor/stations/${enc(code)}/use`, { source }),
    endUse: (id: string) =>
      r<{ id: string; ended_at: string }>("POST", `/floor/uses/${enc(id)}/end`),
    myUse: () => r<UseView>("GET", "/floor/me/use"),
    live: (locationId?: string) =>
      r<LiveBoard>("GET", `/floor/live${qs({ location_id: locationId })}`),
    training: (memberId?: string) =>
      r<Training>("GET", `/floor/training${qs({ member_id: memberId })}`),
  };
}
export type FloorApi = ReturnType<typeof floorApi>;
