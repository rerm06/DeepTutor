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

## Decisions awaiting the human
- Destination repository (create e.g. `rerm06/gym-saas`, empty, and say its name).
- Identity provider: Supabase Auth (recommended, JWT-compatible) vs Auth0 vs Clerk.
