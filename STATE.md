# STATE — loop memory (read first, update last, every cycle)

| Field | Value |
|---|---|
| Branch | `claude/gym-saas-f1` (orphan; move to its own repo when created) |
| Last cycle | 2 — 2026-11-02 |
| Gate | PASS (lint, build, typecheck, 153 tests: 114 DB/RLS + 39 API) |
| Gate spot-check | Weakening 2 policies → 27 failures; undoing 3 review fixes → 3 failures. Gate is live. |
| Consecutive cycles without progress | 0 |
| Loop status | **STOPPED** — hard stop: 3 fix attempts used in cycle 2 with findings still open. Awaiting human decision. |
| Next epic | E8 slice 2 (provider adapters + inbound webhook + delivery worker), then E2 → E3 → E4 |

## Cycle log
### Cycle 1 — E12 (partial) + E1 (core)
- Monorepo (pnpm, TS strict, Biome), Postgres schema `app`, 3 least-privilege roles + `app_definer`.
- Tenancy tables, RLS on all, composite FKs, append-only audit log, `register_member` definer function.
- Fastify API: HS256 JWT verification, zod claims, `/v1/me`, `/v1/locations`, `/v1/members` (GET/POST/PATCH), `/v1/audit-log`.
- Isolation matrix: 2 orgs × 10 roles × read/write, location scope, guardian, shared global person.
- Independent security review: 8 findings (4 high, 3 medium, 1 low), all reproduced by the reviewer, all fixed with
  regression tests (see ADR 0001 amendment). Re-check: 7/8 closed, N1 (replay, high), N2, N3 found and fixed (commit bdf40f0). Cycle 1 accepted.
- Open in E1: identity provider + token issuance (claims derived from `staff_location`), org switcher, staff admin endpoints.
- Open in E12: staging/prod environments, observability, backups/restore drill, pentest.

### Cycle 2 — E8 slice 1 (consent and queue, no providers yet)
- Schema: consent per member/brand/channel/purpose with evidence and source tied to the caller; message window
  (default 08:00–21:00 local, [VERIFICAR] legal); outbound/inbound messages; full opt-out across all channels of a
  brand that also blocks queued messages; STOP/BAJA keyword detector.
- API (builder agent): consents GET/PUT, opt-out, POST /messages (server-side templates ES/EN, purpose from the
  template), inbox. 29 API tests.
- Found during the cycle: COMMIT on an aborted transaction silently rolls back; withClaims now raises.
- Independent review of E8: 1 critical (template-variable injection: marketing, forbidden terms and phishing links
  inside a reminder), 4 high (single revoke left queue, non-FOH staff could grant, staff could override a member's
  opt-out, enqueue/opt-out race), 2 medium, 2 low. All fixed (attempt 1/3): the DATABASE now renders every message
  from a catalogue with server-side brand/name/location/link and pattern-checked variables, then screens the body
  for forbidden terms and foreign links; consent history is append-only; consent row read FOR SHARE.
  Mutation check: disabling the pattern/forbidden check fails 2 tests.
- Re-verification (attempt 2/3): 7/9 closed; critical narrowed but open via free-text class_name/plan; new N2
  (staff revoke launders a member revocation), N3 (opt-out did not cover pairs without rows), N4 (consent_event
  missing from matrix, non-composite FKs), N5 (unchecked brand/location names). Fixed: no free-text variables at
  all, content screen covers plurals/bare domains/phones/non-Latin scripts, member-revocation rule reads the
  append-only history, brand-level opt-out marker, composite FKs, names validated on write.
- Final check (attempt 3/3): every earlier finding CLOSED. New, OPEN:
  - N-A (high): a member opting back in to ONE pair deletes the brand opt-out marker, so staff can then grant
    pairs the member never chose (e.g. WhatsApp marketing).
  - N-B (medium): a staff grant racing a member opt-out can commit after the opt-out (no shared per-member lock);
    enqueue does not look at the opt-out marker.
  - N-C (low): owner-entered names accept 7+ digit runs and bare domains (the latter silently breaks messaging).
  - Proposed fix (needs approval for a 4th attempt): explicit brand-level opt-in action as the only way to lift
    the marker; per-member advisory lock in set_consent/opt_out/enqueue; enqueue blocks while a marker stands;
    name CHECK rejects domains and 7+ digit runs.
  - Legal question behind N-A: after a full opt-out, does a member's re-consent to one channel/purpose restore
    anything else? Proposed default: no — each pair needs its own new consent from the member. [VERIFICAR · TCPA]
- Cycle 2 NOT accepted.
- Carry to slice 2: the delivery worker must re-check consent at send time.

### Tooling — master prompt added
- `docs/prompts/loop-architect.md`: master prompt (senior architect + loop engineer + senior full-stack) with the
  defect taxonomy learned in cycles 1–2 and a 7-step bug-fix protocol (reproduce → root cause → minimal fix in the
  right layer → regression → mutation → sweep → record). Used by the next cycle once the loop restarts.

### Deployment — Netlify (demo), 2026-11-02
- 2026-11-05 06:45 UTC, deploy 6aec25ea9072447914594c43 (commit 06a2224): staff e-mail + password sign-in (0026),
  forced first change, 12-hour rotating sessions, owner "Equipo y accesos". 1 migration applied; 43 pinned. Two owner
  accounts of org A created from the app (initial password, change required at first sign-in). QA crawl: 500 + 236
  page visits across 12 personas at 1280/390 px — no JS errors, overflow, error notes or blank pages; Netlify served
  0 × 5xx (6 × 502 seen by the crawler came from the sandbox egress proxy).
- 2026-11-03 05:55 UTC, deploy 6ae9751e360bfacd5156f024 (commit adff93c): Wyze/RTSP — review-only cameras (0025),
  agent CAMERA_PROFILE=wyze + --probe. 1 migration applied; 42 pinned. Verified in production: a 0.99 match from a
  review-only camera goes to the front-desk queue (demo tidied afterwards: event dismissed, device revoked, face off).
- 2026-11-03 05:35 UTC, deploy 6ae9717b836e809630a14ed3 (commit 1c281cd): access — sign-in by code, door QR
  entry/exit kiosk, check-out, opt-in face recognition backbone + reference camera agent. 1 migration applied;
  41 pinned. Verified in production: code sign-in → exit → entry → exit by door QR.
- 2026-11-03 04:25 UTC, deploy 6ae960c1f6698da08a914da4 (commit 3589022): live agent (Gemini Live + local fallback)
  that fills and drives every screen, live field validation, member photo (0023), design v3. 1 migration applied;
  40 pinned. Gemini Live needs GEMINI_LIVE_API_KEY (the AI Gateway's injected GEMINI_API_KEY is ignored).
- 2026-11-03 00:16 UTC, deploy 6ae927bb40f62b017da62210 (commit a22fdaf): member portal (Mi Panel, Progreso,
  Mis Programas, Nutrición, Documentos, PWA), every module restyled by the design swarm (9 branches), join hero
  from the theme (0022). 3 migrations applied; 39 pinned.
- 23:13 UTC, deploy 6ae918fe92cb0b15cb3ea764 (commit 10a3974): home/shell matched to the client's Fitness R Us
  design, dark gold brand mode, executive dashboard data with 12 months of synthetic history, public "Únete"
  sign-up, Agentes IA and Ayuda y Academia pages. 6 migrations applied (0018 signup, 0019 exec, 0020 brand modes);
  36 migrations now pinned.
- 17:24 UTC, deploy 6ae8c71917b5852830c6fdc4 (commit 543ab97): all 10 modules + coach + brand + security
  hardening; 23 migrations applied. New web shell (grouped sidebar, drawer, member quick bar).
- Rule learned: an earlier upload failed because 0002 had been edited after being applied. Applied migrations are
  pinned by SHA-256 in netlify/database/applied-migrations.sha256 and checked by the gate; add lines after
  every deploy that applies migrations.
- Live: https://gym-saas-f1.netlify.app (site id bb60191b-2229-45a9-b6e0-b91233307fdd). SPA + API function (/api/*,
  pre-bundled with esbuild) + Netlify Database with the mirrored migrations and the synthetic demo seed.
- Verified live: personas, demo sessions, isolation (A front desk 6 members, A owner 9, B owner 2, member 1),
  401 without token, reminder queued with consent, marketing blocked without consent.
- Deploy fixes: functions could not require() ESM-only cookie@2 → server pre-bundled; AWS_LAMBDA_JS_RUNTIME=nodejs22.x set.
- Known gaps: public demo is writable by anyone (synthetic data, no rate limiting, no password); guardian persona shows
  "Todas las sedes"; brand name shown generically (no brands endpoint); E8 open findings N-A/N-B/N-C still apply.

## Decisions awaiting the human
- Destination repository (create e.g. `rerm06/gym-saas`, empty, and say its name).
- Identity provider: Supabase Auth (recommended, JWT-compatible) vs Auth0 vs Clerk.
