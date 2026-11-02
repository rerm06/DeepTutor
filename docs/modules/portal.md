# Module portal — member portal (Progreso, Mis Programas, Nutrición, Documentos)

Migration `0021_portal.sql` · seed `0021_portal.sql` · API `apps/api/src/modules/portal.ts` · UI
`apps/web/src/modules/portal/`. The member **home screen** is built elsewhere against `GET /v1/me/home`.

## Data model
The portal mostly **reads** other modules' tables under the caller's RLS (schedule check-ins and bookings, billing
subscriptions/credits/passes/invoices, floor circuit runs and set logs, health published care plans, engagement
challenges, signup agreements, messaging consents). It owns two tables:

| Table | Purpose | Visibility (SELECT) | Writes |
|---|---|---|---|
| `member_goal` (`member_id` PK, `weekly_trainings` 1–14, `updated_by`, `updated_at`) | Weekly training goal; **4** when no row | member and their guardian; staff of the member's home location (owner/accountant org-wide); never the other org | only `app.set_member_goal()` (no table grants) |
| `challenge_perk` (`challenge_id`, `position` 1–8, `label`) | What a challenge includes, shown on the home | same as the challenge (engagement RLS) | owner (any challenge), location manager (challenges of own locations); column grants `challenge_id, position, label`; `created_by` forced from claims; content CHECK `app.has_forbidden_terms` |

Functions (all `app_definer`, `search_path = app, pg_temp`, `REVOKE … FROM PUBLIC`):
- `app.portal_self_or_ward(member)` — caller is that member (role `member`) or their guardian (role `guardian`).
- `app.portal_acting_member(member|null)` — member → own row; guardian → named ward or first ward; staff / no claims →
  `42501`; someone else → `NULL` (API 404).
- `app.set_member_goal(n)` — role `member` only, 1–14 (`22023 invalid_goal`), upsert under row lock, audit
  `member_goal.set` with `{weekly_trainings, from}`.

## Rules
- **Local time** = the member's home location time zone. Days and ISO weeks (Monday–Sunday) are local.
- **Streak**: consecutive local days with an *allowed* check-in, ending today or yesterday (looked back 400 days).
  `last7` = 7 booleans, oldest → today.
- **Week**: `trainings` = local days this ISO week with an allowed check-in (several check-ins on one day = one
  training); `classes_booked` = bookings booked/attended/no-show on non-cancelled sessions starting this week;
  `classes_attended` = attended; `active_minutes` = attended class durations, or **60** for a check-in day without
  an attended class (labelled *estimated* in the UI); `pct = min(100, round(trainings/goal·100))`.
- **Membership**: live subscription (status active/frozen/past_due; `renews_on` = period end unless cancelling at
  period end, then `expires_on`) → else live session credits (class packs before personal training, earliest
  expiry) → else an unexpired pass (`credits_left` null) → else the last credits/pass/subscription as `expired` →
  `none`.
- **next_class**: earliest future `booked` booking on a non-cancelled session.
- **Programs**: open circuit runs (`pct` = sets logged / sets planned) → `/me/circuits`; published training plans
  (`weeks` = highest week number in headings starting "Semana(s)"/"Week(s)", `week` = weeks since publication + 1,
  `pct` = elapsed days / plan days) → `/me/health/plan`.
- **Challenge**: running today (local), org-wide or at the home location; with perks first, then newest start.
- **coach.enabled**: the AI coach provider is configured (coach module) and the caller is the member.
- **documents**: signed agreements + non-void invoices.
- **Nutrition**: only the member's **published** nutrition care plan (approved by the licensed professional; the
  approver name and licence come from the approval snapshot). No generated advice anywhere; empty state invites an
  appointment with the licensed nutrition specialist.
- Staff never get portal data (403): health data stays with the member and guardian.

## Endpoints (all `/v1`, token required)
| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/me/home?member_id=` | member, guardian | exact contract (member, membership, next_class, streak, week, programs, challenge, coach, documents) |
| GET | `/me/progress?member_id=` | member, guardian | `{member_id, goal, weeks[12]{week_start,trainings,classes_attended,active_minutes}, recent[≤20]{at,kind,label}}` |
| PUT | `/me/goal` `{weekly_trainings}` | member | 1–14; guardian/staff 403 |
| GET | `/me/documents?member_id=` | member, guardian | `{member_id, agreements[], consents[], invoices[]{id,number,issued_on,total_cents,status,href:"/me/membership"}}` |
| GET | `/me/nutrition?member_id=` | member, guardian | `{member_id, plan|null, appointment|null}` |
| GET / PUT | `/portal/challenges/:id/perks` `{perks: string[≤8]}` | read: challenge viewers; write: owner, location manager | replaces the list; 404 if the challenge is not visible |

Errors: 400 invalid input (zod `.strict()`, CHECK), 403 staff / not allowed, 404 member_id not actable.

## UI
`/me/progress` (12-week bars + data table, recent activity, goal editor — members only), `/me/programs`,
`/me/nutrition`, `/me/documents`; nav entries for the member audience. ES/EN, tokens only, 360 px safe,
`data-tour-id` on the goal editor, program links, invoice and consent links.

## Demo seed
Ana Rivera (A-member): 12-day streak, goal 5, class booked within 36 h, her 10-session pack (billing seed), an open
circuit run (7/15 sets), training plan v2 of 8 weeks in week 3 (v1 archived), challenge "8 semanas de
transformación" with four perks, not joined. Isabel Rosario (B): goal 3, 5-day streak, perks on the club challenge.

## [VERIFICAR]
- Members cannot book appointments themselves (`app.create_appointment` is staff-only), so the nutrition empty state
  says to ask at the front desk. When schedule adds member self-booking, link it from `/me/nutrition`.
- Whether staff of the home location should read a member's weekly goal (spec asked for it; it is not health data).
- The 60-minute estimate per visit and "trainings = days with a visit" are product assumptions [S].
- The training-plan week count is read from section headings; a structured `weeks` field on care plans (health
  module) would be sturdier.
- Seed dates are relative to the deploy day: the streak and the open circuit run age with the demo.
