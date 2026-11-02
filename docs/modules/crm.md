# Module crm — leads, pipeline, tasks, lead → member conversion (E9, §7 retention)

Migration `packages/db/migrations/0008_crm.sql` · seed `packages/db/seed/0008_crm.sql` · API `apps/api/src/modules/crm.ts`
· UI `apps/web/src/modules/crm/` · tests `packages/db/test/crm.test.ts`, `apps/api/test/crm.test.ts`,
`apps/web/test/modules/crm.test.tsx`.

## Data model

| Table | Purpose | Key columns |
|---|---|---|
| `app.lead` | A prospect at one location | `location_id`, `source` (web · whatsapp · instagram · referral · walk_in · other), `stage` (new · contacted · tour_booked · trial · won · lost), `lost_reason`, `owner_staff_id` → staff_member, `full_name`, `email`, `phone`, `notes`, `member_id` (set only by conversion), `created_by`, `stage_changed_at` |
| `app.lead_activity` | Append-only timeline | `lead_id`, `kind` (call · message · tour · note · stage_change), `body`, `from_stage`/`to_stage`, `at`, `by_person_id` |
| `app.crm_task` | Follow-up task | `location_id`, `title`, `due_at`, `status` (open · done · cancelled), `assigned_staff_id`, `lead_id` **or** `member_id`, `completed_at` |

All three: `org_id` default from claims, `UNIQUE (org_id, id)`, composite FKs `(org_id, …)`, RLS ENABLE + FORCE,
`definer_all` policy for `app_definer`, column-level INSERT/UPDATE grants, nothing for PUBLIC, no DELETE for anyone.

## Rules (enforced in Postgres)

- **Who.** owner (whole org), location_manager and front_desk (their locations) read and write leads, activities and
  tasks. Trainers read only tasks assigned to them and may only change their status. accountant, chef, nutrition and
  clinical roles, members and guardians: no rows at all.
- **Consent.** Capturing or converting a lead never creates messaging consent; consent stays in the E8 model
  (`app.consent` via `set_consent`, with evidence). The capture form and the lead record say so.
- **Stages.** Any manual move between new · contacted · tour_booked · trial · lost. `lost` requires a reason (cleared
  when leaving `lost`). `won` is only reachable through `app.convert_lead` (CHECK `stage = 'won' ⇔ member_id IS NOT
  NULL`, and `member_id` is not writable by request traffic). A won lead cannot be moved back.
- **Automatic logging.** The `lead_log` trigger writes a `stage_change` activity (actor = caller) and an audit row
  `lead.stage` on every stage change; `lead.create` on insert. Request traffic can add call/message/tour/note only,
  with actor and time forced server-side. Task creation and status/assignee changes are audited (`crm_task.*`).
- **Integrity guards** (BEFORE triggers, definer, same error whether the target is missing or out of scope so nothing
  leaks): a lead owner must be active front-of-house staff of that location (or an owner); a task assignee the same or a
  trainer there (chef, accountant and clinical roles never own or receive CRM work); a task's lead must be at the
  task's location; a task's member must be visible to the caller.
- **Conversion** `app.convert_lead(lead) → member_id` (definer, owned by `app_definer`, `search_path = app, pg_temp`,
  claims re-checked): locks the lead `FOR UPDATE`, refuses if already converted (`23505 already_converted` → 409),
  needs an email (`22023` → 400), calls `app.register_member(email, name, phone, location)` (which re-checks role and
  location), links `member_id`, sets `won` (the trigger logs the activity) and audits `lead.convert`. An email that is
  already a member of the org → `23505` → 409; nothing is linked.
- **Funnel** `app.crm_funnel(from, to, location?)` — SECURITY INVOKER, so lead RLS decides what is counted; owner and
  location_manager only. Cohort = leads created in `[from, to]` (local date of the lead's location), grouped by
  location and source, with each lead's CURRENT stage; `conversion_pct = won / total × 100` (1 decimal). Max 366 days.

## Endpoints (`/api/v1`)

| Method | Path | Body / query | Notes |
|---|---|---|---|
| GET | `/crm/leads` | `?location_id&stage` | RLS-scoped list |
| POST | `/crm/leads` | `{ location_id, source, full_name, email?, phone?, notes?, owner_staff_id? }` | 201 `{ id }`; email or phone required |
| GET | `/crm/leads/:id` | — | lead + `activities[]`; 404 if not visible |
| PATCH | `/crm/leads/:id` | `{ stage?, lost_reason?, source?, full_name?, email?, phone?, notes?, owner_staff_id? }` | `won`, `member_id` → 400 |
| POST | `/crm/leads/:id/activities` | `{ kind: call\|message\|tour\|note, body }` | 201 |
| POST | `/crm/leads/:id/convert` | — | 201 `{ member_id }`; 409 twice; 400 without email |
| GET | `/crm/tasks` | `?mine=true&member_id&lead_id&location_id&status` | trainers: own only |
| POST | `/crm/tasks` | `{ location_id, title, due_at (ISO with offset), assigned_staff_id, lead_id? \| member_id? }` | 201 |
| PATCH | `/crm/tasks/:id` | `{ status?, title?, due_at?, assigned_staff_id? }` | trainers: status only (else 403) |
| GET | `/crm/funnel` | `?from=YYYY-MM-DD&to=YYYY-MM-DD&location_id` | owner / location_manager; 403 otherwise |
| GET | `/crm/staff` | `?location_id&purpose=lead\|task` | lead owners / task assignees (managers only; empty otherwise) |

All bodies are zod `.strict()`; every query runs through `app.asCaller` (claims + RLS).

## UI

Staff nav: **Leads** (board with one column per stage; each card has a labelled "Mover a etapa" select + button, a
reason field for `lost`; no drag), lead detail (data, timeline, add call/tour/note/message, convert with confirmation),
**Tareas** (my tasks grouped vencidas / hoy / próximas / cerradas; managers can widen to their locations and create),
**Embudo** (date range + location, table with totals and text-labelled CSS bars). Member record tab: tasks related
to that member. `data-tour-id`: `crm-lead-new`, `crm-board`, `crm-lead-stage`, `crm-lead-move`, `crm-consent-note`,
`crm-lead-save`, `crm-lead-convert`, `crm-lead-convert-confirm`, `crm-activity-add`, `crm-task-new`, `crm-task-done`,
`crm-funnel-apply`, `crm-funnel-table`.

## Open questions [VERIFICAR]

- [VERIFICAR · legal] Retention and deletion of lead personal data (lost leads, access/deletion requests). There is no
  DELETE path yet; leads are kept and closed as `lost`.
- [VERIFICAR · producto] Member status after conversion stays what `register_member` sets (`lead`) until a membership
  or trial is sold (billing). Should conversion from `trial` set the member to `trial`?
- Conversion inherits `register_member`'s property that a 409 tells a front desk the email is already a member
  somewhere in the same organisation (never across organisations).
- [VERIFICAR · producto] Duplicate detection (same email/phone captured twice) is not enforced; conversion of a
  duplicate whose email is already a member fails with 409.
- [VERIFICAR · legal] Calling or messaging a lead (activities of kind call/message) is logged only; any outbound
  marketing to a lead still needs E8 consent once the lead is a member (TCPA/A2P). No messaging path exists for
  leads that are not members.
- [S] Task due dates from the UI are interpreted in Puerto Rico time (UTC−4, no DST); other time zones need the
  location's zone.
