# Module signup — "Únete": registro público en línea (spec E7, §11)

Migration `packages/db/migrations/0018_signup.sql` · seed `packages/db/seed/0018_signup.sql` · fixtures
`packages/db/src/fixtures/signup.ts` · API `apps/api/src/modules/signup.ts` · UI `apps/web/src/modules/signup/` · tests
`packages/db/test/signup.test.ts`, `apps/api/test/signup.test.ts`, `apps/web/test/modules/signup.test.tsx`.

A visitor with no session opens `/join/:orgId` (also linked from the entry screen per demo org), sees the gym's brand
(logo, colours, tagline from `brand.theme`, sanitised twice), the business model in plain words, picks a home location,
fills name, e-mail, optional mobile and birth date, accepts the terms and the liability release (required, versioned),
optionally ticks SMS reminders and SMS marketing (unticked by default, separate boxes, full TCPA text visible), and
submits. A brand-new person lands on `/me/account` signed in, with a one-time welcome note and three next steps
(`/me/membership`, `/me/classes`, `/me/credential`).

## Business model

Read from the billing catalogue, never typed: `pay_per_session` = no active recurring price and no active
`enrollment_fee`, and at least one active `drop_in`/`day_pass` price (`session_from_cents` = cheapest, shown "+ IVU").
Demo org A (Fitness R Us) is pay-per-session; org B (monthly membership) shows "choose your plan at the location".

## Data model

| Table | Purpose | Written by |
|---|---|---|
| `agreement_text` (global) | Versioned texts: `terms`, `waiver`, `sms_reminder`, `sms_marketing` × es/en; one `is_current` per kind+locale. Draft wording. | migration only |
| `join_location` | Per-location switch for online sign-up (core `location` has no active flag). No row = closed. | `app.set_join_location` |
| `member_agreement` | (member, kind terms\|waiver, version, locale, source, accepted_by, evidence, accepted_at). Append-only. | `app_public.join_submit` (seed: front desk paper) |
| `join_attempt` | Each sign-up that reached the identity step: `created` (with member) or `existing`; no PII. Feeds the rate cap. | `app_public.join_submit` |

Org-scoped tables: `org_id` + composite FKs, RLS ENABLE + FORCE, `definer_all`, SELECT-only grants (no write grants).

Records on a successful sign-up: `person` (e-mail lower-case), `member` with status **`lead`** (billing semantics:
`billing_refresh` promotes lead → active on the first paid session or pack; a pay-per-session client owes nothing yet,
and `trial` would imply a free trial), two `member_agreement` rows, one `consent` + `consent_event` per ticked box
(channel `sms`, purpose `reminder`/`marketing`, source `member_portal` — the titular acting through the brand portal,
so no enum change was needed; evidence names the form, the consent-text version and the locale), one `join_attempt`
and one `audit_log` row (`member.join_online`, actor = the new person, role member). Birth date is never stored.

## Visibility (RLS)

- `member_agreement`: the member, their guardian, staff of the home location (owner/accountant org-wide) via
  `app.can_act_for_member`. Not health data, so front desk reads it.
- `join_location`: staff who can see the location. `join_attempt`: owner, and the location manager of that location.
- `agreement_text`: any signed-in caller.

## Public entry points (no claims)

Schema `app_public` holds exactly two `SECURITY DEFINER` functions owned by `app_definer`
(`search_path = app, pg_temp`). Only the API login role may use the schema and execute them: `app_api` locally
(NOINHERIT; still cannot read any table), and on Netlify the owner connection (which is the API login there). Never
PUBLIC or `app_authenticated` (tested). With no claims, `join_submit` validates everything itself, in this order:
org exists (404) → location of that org and open → locale → name → e-mail → phone → birth date → age → agreements +
current versions → SMS needs a phone → per-org cap (advisory lock) → identity.

- **PII guard [VERIFICAR · lift only with a real identity provider, e-mail verification and a privacy notice]:**
  e-mail must match `^[a-z0-9][a-z0-9._+-]{0,63}@demo\.invalid$`; phone must be `+1-787-555-01xx` or `+1-939-555-01xx`.
  Enforced in SQL (`app.join_email_ok`, `app.join_phone_ok`), in the API schema and in the form.
- **Age [VERIFICAR · legal]:** Puerto Rico age of majority is 21. Under 21 (including under 13) is refused with
  `age_requires_guardian` ("visit your location with a parent or legal guardian"); the transaction ends, nothing is
  stored, and the API never logs the body.
- **Names:** letters (Latin + Spanish), spaces, apostrophe, hyphen, a dot only at the end of a word; 2–120 chars.
  Markup, `{{…}}`, digits, links, newlines and other scripts are refused (names reach rendered messages).
- **Identity:** a session is issued ONLY when a brand-new Person was created. An e-mail that exists in any org (any
  case) creates nothing, attaches nothing, and gets `202 {session: null, message: generic}` — the same body a new
  person gets when demo mode is off. A concurrent registration of the same e-mail is caught (unique violation →
  generic answer).
- **Remaining distinguishability (demo only):** in demo mode "session issued" vs "no session" tells a visitor whether
  the e-mail was new, and timing differs slightly. Production needs e-mail verification (send a link; same answer for
  every e-mail) before any session.
- **Abuse:** ≤ 30 attempts per organisation per hour (`created` and `existing` both count) under
  `pg_advisory_xact_lock`; 429 `rate_limited`. In the API, an in-memory fixed window of 10 POSTs per 15 min per
  client address (`x-nf-client-connection-ip` behind Netlify [VERIFICAR · that the edge overwrites a client-supplied
  value], else the socket address); per instance, so the SQL cap is the hard limit.

## Endpoints

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/v1/public/join/:orgId` | anyone | `{org_id, org_name, brand{id,name,theme}, locations[{id,name,municipality,brand_id}], agreements[{kind,version,locale,title,body}], model{pay_per_session, session_from_cents}}`; 404 unknown org or no open location |
| POST | `/v1/public/join` | anyone | zod `.strict()`; `{org_id, location_id, full_name, email, phone?, birth_date, terms_version, waiver_version, accept_terms, accept_waiver, sms_reminders?, sms_marketing?, locale}` → 202 `{session: {token, expires_in: 900, persona} \| null, message}`; 400 `{error: invalid_email \| invalid_phone \| invalid_name \| invalid_birth_date \| age_requires_guardian \| invalid_location \| agreements_required \| agreement_outdated \| phone_required_for_sms \| invalid_input}`; 404; 429 `rate_limited` |
| GET | `/v1/signup/locations` | staff | locations the caller sees, with `enabled` |
| PUT | `/v1/signup/locations/:id` | owner; manager of that location | `{enabled}`; audited `join_location.set` |
| GET | `/v1/members/:id/agreements` | RLS | member, guardian, home-location staff |

Session: same signing as `/v1/demo/session` (issuer, audience, 900 s, role `member`, `location_ids: []`), only when
the app runs in demo mode. The web stores it under the client's session key and reloads into `/me/account`; there is
no persona to renew it, so after 15 minutes the member is sent back to the start screen [S].

## UI

- `/join/:orgId` (public, outside the shell): brand header + ES/EN switch, model list, location radio cards, inline
  validation on blur, error summary (`role=alert`, focused, links to fields), `aria-invalid` + `aria-describedby`,
  24 px checkboxes in 44 px rows, `data-tour-id="join-submit"`, 360 px safe.
- Entry screen: "Únete a {org}" per demo org (`data-tour-id="entry-join"`).
- `/me/account`: one-time welcome note (dismissible) with the three next steps.
- `/staff/online-join` (owner, location manager): open/close each location; shows the public link.
- Member record tab "Acuerdos" (front of house).

## [VERIFICAR]

1. Lift the PII guard only with a real identity provider, e-mail verification and a published privacy notice.
2. Legal: age of majority 21 for gym contracts and liability releases in PR; guardian flow at the location.
3. Legal: wording of terms, liability release and the TCPA consent texts (drafts, versioned `v2026-11`).
4. Netlify: `x-nf-client-connection-ip` cannot be forged by the client.
5. COPPA: nothing is stored for under-13 visitors; confirm no analytics capture the form either.
