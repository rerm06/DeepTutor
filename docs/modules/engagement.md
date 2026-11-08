# Module engagement — community, challenges and loyalty (spec §9)

Migration `packages/db/migrations/0012_engagement.sql` · seed `packages/db/seed/0012_engagement.sql` ·
API `apps/api/src/modules/engagement.ts` · UI `apps/web/src/modules/engagement/` · tests
`packages/db/test/engagement.test.ts`, `apps/api/test/engagement.test.ts`, `apps/web/test/modules/engagement.test.tsx`.

## Evidence-based defaults
- **Weekly streaks**, not daily: consecutive ISO weeks (Monday start, member's location time zone) with ≥ 1 visit.
  The current week does not break a streak until it ends.
- **Opt-in leaderboards** (default off), split by challenge kind (individual · team · location). Beginners
  (< 4 recorded visits) default to **self-comparison** (`compare_mode = 'self'`). Minors are never listed.
- **Comeback bonus** for a visit after ≥ 14 days without visits [P].
- **Moderated wall**: every post is pending until front of house approves it.
- **No cash prizes, raffles or sweepstakes** (CHECK on reward name/description) [VERIFICAR · legal PR].

## Data model (all `org_id`-scoped, RLS ENABLE + FORCE, composite FKs, `definer_all` for `app_definer`)
| Table | Notes |
|---|---|
| `points_rule` | one per (org, event): `visit, class, purchase, challenge_goal, referral, comeback_bonus`; points 1–10 000; `active` |
| `points_ledger` | **append-only** (trigger refuses UPDATE/DELETE/TRUNCATE for every role); `delta`, `reason`, `ref` (idempotency: unique per member+reason+ref), `note` (manual only), `location_id`, `created_by`, `at`. Balance = Σ delta; it is a **liability** |
| `reward` | `name`, `description`, `points_cost`, `restricted_for_minors`, `active` |
| `redemption` | `requested → fulfilled | cancelled` (cancel refunds with a `redemption_refund` row) |
| `challenge` | `kind`, `metric (visits|classes|points)`, optional `location_id` (NULL = all; `location` kind is always org-wide), dates, `goal`, `leaderboard_opt_in_default` (false) |
| `challenge_team` | teams of a `team` challenge; FK `(org_id, challenge_id, id)` keeps a participant's team inside its challenge |
| `challenge_participant` | `show_on_leaderboard` (false), `compare_mode`, `progress` (recomputed from the ledger), `goal_reached_at` |
| `referral` | `referred_email` (third-party data: referrer + staff only), `pending → joined | credited`, `credit_points`, `joined_member_id` (unique: one credit per new member) |
| `achievement` | `first_visit, streak_4, streak_12, comeback, challenge_goal, first_referral` (unique per member+code+ref) |
| `community_post` | `body` ≤ 500, `author_label` ("Ana R.", computed server-side), `location_id` (moderation scope), `status`, `moderated_by` (not readable by request traffic), `moderated_at` |

## Who can do what (enforced in RLS + definer functions; the UI mirrors it)
| Role | Rights |
|---|---|
| owner | everything below, org-wide; configures rules, rewards, any challenge; reads liability |
| location_manager | configures rules and rewards; challenges only for own locations; front-of-house rights at own locations |
| front_desk | award (rules/manual with reason), redeem at the counter, fulfil/cancel, credit referrals, moderate — **own locations only** |
| trainer | sees challenges, teams and the opt-in leaderboard (no member rows) |
| accountant | `points_liability()` total only (no ledger rows) |
| member | own points/streak/history, redeem, join, leaderboard preferences, refer, post (pending) |
| guardian | read-only: ward's points, streak, challenges (own-ward rows only) |
| nutritionist, chef, clinician | nothing in this module |

Minors (= members with a `guardian_link`): refused restricted rewards (`restricted_for_minors`), cannot post
(`minor_cannot_post`), cannot refer (`minor_not_allowed`), never on a leaderboard (`minor_not_listed`).

## Functions (`SECURITY DEFINER`, owner `app_definer`, `search_path = app, pg_temp`, claims re-checked, audited)
`award_points(member, event, ref)` · `award_manual_points(member, delta, note)` · `redeem_reward(member, reward)` ·
`set_redemption_status(id, status)` · `join_challenge(challenge, member, team, show)` ·
`set_challenge_preferences(challenge, member, show, mode)` · `leaderboard(challenge)` · `create_referral(member, email)` ·
`credit_referral(id)` · `create_post(member, body)` · `moderate_post(id, approve|reject)` · `points_balance(member)` ·
`weekly_streak(member)` · `points_liability()`. Internal helpers (`eng_*`) are not executable by request traffic.

Concurrency: every balance-changing call takes `pg_advisory_xact_lock` per member before reading the balance, so two
simultaneous redemptions cannot both spend the same points (tested with two real connections).

Audit: `points.award`, `points.manual`, `reward.redeem`, `redemption.fulfilled|cancelled`, `challenge.join`,
`challenge.preferences`, `referral.create|joined|credited` (no invitee email in the audit), `post.create`,
`post.approved|rejected`, and every INSERT/UPDATE of rules, rewards, challenges and teams (trigger).

## Endpoints (`/v1/engagement/*`, zod `.strict()`, all via `app.asCaller`)
| Method | Path | Body / query |
|---|---|---|
| GET/POST | `/rules` · PATCH `/rules/:id` | `{event, points, active?}` · `{points?, active?}` |
| GET/POST | `/rewards` · PATCH `/rewards/:id` | `{name, description?, points_cost, restricted_for_minors?, active?}` |
| GET | `/members/:id/points` | → `{balance, weekly_streak, history[], achievements[]}` |
| POST | `/members/:id/award` · `/members/:id/manual` | `{event: visit|class|purchase, ref?}` · `{delta, note}` |
| GET | `/ledger?member_id&limit` · `/liability` | |
| POST/GET | `/redemptions` · PATCH `/redemptions/:id` | `{member_id, reward_id}` · `?member_id&status` · `{status: fulfilled|cancelled}` |
| GET/POST | `/challenges` · `/challenges/:id/teams` | `{name, kind, metric, location_id?, starts_on, ends_on, goal, leaderboard_opt_in_default?}` · `{name}` |
| GET | `/challenges/:id/participants` · `/challenges/:id/leaderboard` | |
| POST | `/challenges/:id/join` · PUT `/challenges/:id/preferences` | `{member_id, team_id?, show_on_leaderboard?}` · `{member_id, show_on_leaderboard, compare_mode}` |
| GET/POST | `/referrals` · POST `/referrals/:id/credit` | `{member_id, email}` |
| GET/POST | `/posts?status` · POST `/posts/:id/moderate` | `{member_id, body}` · `{decision: approve|reject}` |

Known refusals are returned as `{ error, reason }` (e.g. 409 `insufficient_points`, 403 `restricted_for_minors`,
400 `forbidden_content`); everything else follows `errors.ts`.

## UI
Staff: **Retos** (`/staff/engagement/challenges`), **Puntos** (`/staff/engagement/points`: liability, rules, manual award,
ledger, referrals to credit), **Recompensas** (catalogue + redemptions to hand over), **Comunidad** (moderation queue),
plus a **Puntos** tab in the member record. Member: **Mis puntos**, **Retos**, **Muro**, **Referir**, **Canjear**
(guardians: Mis puntos and Retos, read-only). `data-tour-id`: `eng-manual-award`, `eng-rule-save`,
`eng-challenge-create|open|join|prefs`, `eng-leaderboard-optin`, `eng-reward-create`, `eng-redemption-fulfil`,
`eng-post-approve|reject`, `eng-wall-post`, `eng-refer-send`, `eng-redeem`, `eng-referral-credit`, `eng-award-visit|class`.

## Open questions
- [VERIFICAR · legal PR] Cash prizes, raffles and sweepstakes are excluded (PR games-of-chance rules); confirm before
  ever adding prize draws.
- [VERIFICAR · CPA] Cash value per point for the liability (finance module, wave B) and breakage policy.
- [VERIFICAR · legal] Is a guardian link the right proxy for "minor"? (Spec has no birth date in core.)
- [P] 14-day comeback window, beginner threshold (< 4 visits), 3 pending posts and 10 referrals / 30 days caps.
- [S] Visits come from `award_points('visit')` until the schedule module's check-in calls it (wave B); referral credit
  requires the invitee to be an **active** member of the org.
- [S] The client drops the `reason` field of errors (shared `api/client.ts`), so the UI shows generic per-status copy.
