# Module floor — Sala, equipos y circuitos (spec §6.4)

Migration `packages/db/migrations/0011_floor.sql` · seed `packages/db/seed/0011_floor.sql` · API
`apps/api/src/modules/floor.ts` · UI `apps/web/src/modules/floor/`. No hardware integration: a station code is a
printed QR label that encodes only the code (no URL).

## Data model
| Table | Purpose | Key rules |
|---|---|---|
| `asset` | Equipment at a location | `equipment_type` enum (not `none`), `station_code` `^[A-Z0-9][A-Z0-9-]{2,23}$` unique per org, `status` ok · out_of_service · maintenance |
| `asset_issue` | Reports on an asset | `kind` out_of_service · busy; `status` reported · confirmed · resolved; one open report per (asset, person, kind); `busy` carries `expires_at` (+15 min) |
| `exercise` | Org library | `movement_pattern` (10 patterns), `equipment_type` (asset types + `none`), `cues` (≤1000, no `<>{}` or control chars except newline) |
| `circuit` / `circuit_step` | Ordered routine per location | step has `asset_id` XOR `equipment_type`; composite FK `(org_id, location_id, asset_id)` forces the asset to be at the circuit's location |
| `circuit_run` | A member's run of a circuit | one open run per member (partial unique index + advisory lock) |
| `set_log` | One set: reps, `weight_kg numeric(6,2)` 0–1000 | composite FKs: asset at the set's location; run of the same member and location |

All tables: `org_id` + RLS ENABLE/FORCE + `definer_all` for `app_definer`, composite `(org_id, …)` FKs, column-level
INSERT/UPDATE grants only where request traffic writes directly.

## Who can do what
| | owner | location_manager / trainer | front_desk | member | guardian | accountant / chef / clinician / nutritionist |
|---|---|---|---|---|---|---|
| Read equipment | org | assigned locations | assigned | all org locations | all org locations | assigned (read only) |
| Add/edit equipment, status toggle | ✓ | ✓ (their locations) | – | – | – | – |
| Report issue | ✓ | ✓ | ✓ | ✓ (any org location) | – | – |
| Read issues queue | ✓ | ✓ | ✓ | own reports | – | – |
| Confirm out-of-service | ✓ | ✓ | ✓ | – | – | – |
| Resolve | ✓ | ✓ | – | – | – | – |
| Exercise library write | ✓ | ✓ | – | – | – | – |
| Circuits / steps write | ✓ | ✓ (their locations) | – | – | – | – |
| Run circuits, log sets | – | – | – | own | – | – |
| Read runs / set logs | org | logs made at their locations | – | own only | ward (read) | none |

## Functions (SECURITY DEFINER, owner `app_definer`, `search_path = app, pg_temp`, claims re-checked, no PUBLIC)
- `report_asset_issue(asset, kind, note)` → id. Idempotent per open report. Expires stale busy signals and deletes
  busy rows older than 1 day (never kept as occupancy history). Out-of-service reports are audited; busy ones are not.
- `confirm_asset_issue(issue)` → asset status. Out-of-service kind only (`22023` otherwise); locks the issue
  `FOR UPDATE` (second confirm → `55000` / HTTP 409); asset `ok` → `out_of_service`.
- `resolve_asset_issue(issue, restore)` → asset status. Restores `ok` when no other confirmed out-of-service issue
  remains on that asset.
- `start_circuit_run(circuit)` / `finish_circuit_run(run)` / `log_set(exercise, location, asset, run, reps, kg)` — member
  only (`floor_my_member_id()`); open run required for a set inside a run.
- `substitute_exercise(exercise, location, exclude_asset)` — SECURITY INVOKER (caller's RLS applies). Same movement
  pattern; equipment present at the location with status `ok`, excluding the reported asset; `none` exercises always
  qualify; the original exercise is returned (`same_exercise`) when another station of its type is free.
- Audit: trigger `asset_audit` logs every asset status change (`asset.status`, from/to) with the real actor;
  functions log `asset_issue.report|confirm|resolve`.

## Endpoints (`/api/v1`)
`GET/POST /floor/assets` · `PATCH /floor/assets/:id` · `GET /floor/stations/:code` (code trimmed + uppercased; 404 if
not in the caller's org) · `GET /floor/issues?location_id&status` · `POST /floor/assets/:id/issues {kind, note?}` ·
`POST /floor/issues/:id/confirm` · `POST /floor/issues/:id/resolve {restore_asset?}` · `GET/POST /floor/exercises` ·
`PATCH /floor/exercises/:id` · `GET /floor/substitutes?exercise_id&location_id&exclude_asset_id` ·
`GET/POST /floor/circuits` · `GET/PATCH /floor/circuits/:id` · `PUT /floor/circuits/:id/steps {steps:[…]}` (replaces
all steps in one transaction, circuit row locked) · `POST /floor/circuits/:id/runs` · `POST /floor/runs/:id/finish` ·
`GET /floor/runs` · `POST /floor/sets` · `GET /floor/sets?member_id&limit`. All bodies are zod `.strict()`.

## UI
Staff: **Equipos** (`/staff/floor/equipment`: filter by location, status select for managers, issues queue with
confirm/resolve, printable code list with SVG QR), **Ejercicios** (`/staff/floor/exercises`), **Circuitos**
(`/staff/floor/circuits`: create, activate, ordered step builder). Member: **Mis circuitos** (`/me/circuits`: run step
by step, log sets, "Máquina ocupada" → substitutes, "Fuera de servicio"), **Escanear estación** (`/me/station`).

## [VERIFICAR]
- Weight unit: stored in kg; many PR gyms think in lb. Display toggle pending product decision.
- Busy-signal lifetime (15 min) and purge window (1 day) are product guesses.
- Members may report and log at any location of their org (core policy). Confirm with operations whether a member
  with a frozen/cancelled membership may still log sets (today: allowed).
- Station codes are unique per org, so a duplicate on another location returns 409 (codes are printed labels, not
  secrets).
- Guardians can read a ward's training log but cannot write it. Confirm with legal for minors.
