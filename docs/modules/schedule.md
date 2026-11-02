# Module schedule — Agenda, reservas y acceso (spec §3.2, E6)

Migration `packages/db/migrations/0007_schedule.sql` · demo seed `packages/db/seed/0007_schedule.sql` ·
API `apps/api/src/modules/schedule.ts` · UI `apps/web/src/modules/schedule/`.

## Data model (all org-scoped, RLS ENABLE + FORCE, composite `(org_id, …)` FKs, `definer_all` policy)

| Table | Purpose | Direct writes by request traffic |
|---|---|---|
| `class_type` | Org-wide class catalogue (name validated: letters/digits/light punctuation, no domains) | INSERT/UPDATE of `name, description, duration_min, default_capacity, active` by owner / location manager |
| `class_session` | One occurrence: location, type, instructor (trainer, nullable = "por asignar"), room, start/end (≤ 8 h), capacity 1–500, cancelled | none (definer functions) |
| `booking` | `booked · waitlisted · cancelled · attended · no_show`, `waitlist_position`, `late_cancel`. Partial unique index: one live booking per (session, member) | none |
| `location_policy` | `cancel_window_hours` (0–72, default 12), `no_show_penalty`, `deny_past_due` (default **false**) | none |
| `appointment` | `personal_training · assessment · nutrition · clinical`, staff, member, start/end, `scheduled · cancelled`. No free-text notes | none |
| `check_in` | Every access attempt: member (NULL if the token could not be attributed), location, source `qr · front_desk · app · door`, result, reason, recorder, time | none |
| `app_private.qr_key` | Per-database HMAC key, generated in the migration, readable only by `app_definer` | — |

## Rules (enforced in SECURITY DEFINER functions owned by `app_definer`, `search_path = app, pg_temp`, claims re-checked, no PUBLIC EXECUTE)

- **Access** (`access_decision`): `active|trial` → allowed; `past_due` → allowed unless the location's
  `deny_past_due` is true (reason `past_due_denied`); `frozen|cancelled|lead` → denied with the status as reason.
  Only the **owner** may change `deny_past_due` (`set_location_policy`); managers tune the window and the no-show flag.
- **Check-in** (`check_in(location, member_id | token)`): front of house at the location only. Every attempt by an
  authorised caller is recorded (allowed or denied, including `invalid_token` and `expired_token`); unauthorised
  callers get 403 and nothing is written.
- **QR credential**: token `v1.<member>.<30-second window>.<HMAC-SHA256(org|member|window)[:32 hex]>`.
  `my_qr_token(member)` is for the member or their guardian only (staff cannot mint). Verification accepts the
  current and the previous window; older (a screenshot) or future windows → `expired_token`; a forged or other-org
  token → `invalid_token`. The member UI refreshes every 25 s.
- **Booking** (`book_class`): the member, their guardian, or front of house at the session's location. The session
  row is locked `FOR UPDATE`, so two bookings for the last seat serialise: exactly one is `booked`, the other
  `waitlisted`. Frozen/cancelled/lead members (and past_due where denied) cannot book. Same member twice → 409.
- **Cancel** (`cancel_booking`): member, guardian or front of house. A booked seat cancelled inside the location's
  window is `late_cancel`. Freeing a seat promotes the first waitlisted booking automatically; the waitlist is
  renumbered 1..n. Not after the class starts.
- **Attendance** (`mark_attendance`): front of house at the location or the session's own trainer, from 30 min before
  start. `no_show` with `no_show_penalty` is flagged in the audit row; the charge itself belongs to billing.
- **Sessions** (`create_class_session`, `cancel_class_session`): owner (any location) or location manager (own).
  Instructor must be an active trainer assigned to the location. Cancelling cancels its live bookings.
- **Appointments** (`create_appointment`, `cancel_appointment`): front of house schedules personal training for a
  trainer of the location; health-related kinds only by the licensed/clinical staff member for themself.
  A staff member's time is serialised with an advisory lock: no overlapping appointments, and no appointment
  overlapping a class they teach (and vice versa) → 409.
- **Visibility**: sessions — staff of the location (members: whole org). Bookings — member/guardian, front of house of
  the location, the session's trainer. Check-ins — front of house of the location, member/guardian. Appointments —
  member/guardian, the assigned staff, front of house for personal training only, nutritionist/clinician of the
  location for health-related kinds. Front desk, chef and accountant never see health-related appointments.
- **Audit**: `class_session.create/cancel`, `booking.create/cancel/promote/attendance`, `appointment.create/cancel`
  (health-related kinds logged as `restricted`), `location_policy.update` (with the previous `deny_past_due`).

## Endpoints (`/api/v1`, zod `.strict()`, all through `app.asCaller`)

| Method | Path | Notes |
|---|---|---|
| GET/POST | `/schedule/class-types` | POST `{name, description?, duration_min?, default_capacity?}` |
| GET | `/schedule/sessions?location_id&from&to` | ≤ 62 days; includes `booked`, `waitlisted` counts |
| POST | `/schedule/sessions` | `{location_id, class_type_id, instructor_id?, room?, starts_at, ends_at, capacity}` |
| POST | `/schedule/sessions/:id/cancel` | → `{bookings_cancelled}` |
| GET | `/schedule/sessions/:id/roster` | front of house / own trainer |
| POST | `/schedule/bookings` | `{session_id, member_id}` → 201 `{id, status, waitlist_position}`; 409 if already booked |
| GET | `/schedule/bookings?member_id=` | history with class and session data |
| POST | `/schedule/bookings/:id/cancel` | → `{status, late_cancel, promoted_booking_id}` |
| POST | `/schedule/bookings/:id/attendance` | `{status: attended|no_show}` |
| GET / PUT | `/schedule/location-policies[/:location_id]` | PUT `{cancel_window_hours, no_show_penalty, deny_past_due}` |
| GET/POST | `/schedule/appointments` | GET `?location_id&member_id&from&to`; 409 on overlap |
| POST | `/schedule/appointments/:id/cancel` | |
| GET | `/schedule/staff?location_id` | trainers / licensed staff for pickers |
| GET | `/schedule/my-members` | member: self; guardian: wards (403 for staff) |
| GET | `/schedule/qr-token?member_id=` | `{token, expires_at, window_seconds: 30}` |
| POST | `/schedule/check-ins` | `{location_id, member_id}` **or** `{location_id, token}` → 201 `{id, result, reason, member_id, full_name, member_no, member_status}` |
| GET | `/schedule/check-ins?location_id&member_id&limit` | |

## UI

Staff: **Agenda** (`/staff/schedule`: week view per location, roster with book / attended / no-show, new session for
owner and manager), **Check-in rápido** (`/staff/check-in`: search by name, email or member number → one tap; token
field for scanners; large allowed/denied verdict with reason), **Citas** (`/staff/appointments`), and a member-record
tab with bookings and check-ins. Member/guardian: **Clases** (`/me/classes`: book, cancel, waitlist position,
late-cancel warning, history) and **Mi credencial** (`/me/credential`: QR rendered with `qrcode` as SVG, refreshed
every 25 s, screenshot warning).

## [VERIFICAR]

- Whether owners/managers may see (redacted) health-related appointments, and whether front desk may schedule them;
  currently they cannot see or create them.
- No-show penalty amount and how it is charged (billing module); here it is only a flag in the audit trail.
- Default cancellation window (12 h) and attendance marking from 30 min before start.
- Multi-location access: any active member of the org may enter any of its locations; plan-based restrictions belong
  to billing.
- Door hardware and member self-check-in (`door`, `app` sources) are reserved but not exposed.
- Instructor names are not shown to members (staff directory RLS is core); expose public display names if wanted.
- QR verification compares the HMAC with `<>` inside Postgres (not constant-time); acceptable over the network but
  noted for review.
