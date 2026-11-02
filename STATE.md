# STATE — loop memory (read first, update last, every cycle)

| Field | Value |
|---|---|
| Branch | `claude/gym-saas-f1` (orphan; move to its own repo when created) |
| Last cycle | 2 — 2026-11-02 |
| Gate | PASS (lint, build, typecheck, 139 tests: 96 DB/RLS + 43 API) |
| Gate spot-check | Weakening 2 policies → 27 failures; undoing 3 review fixes → 3 failures. Gate is live. |
| Consecutive cycles without progress | 0 |
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
- Independent review of E8: in progress.

## Decisions awaiting the human
- Destination repository (create e.g. `rerm06/gym-saas`, empty, and say its name).
- Identity provider: Supabase Auth (recommended, JWT-compatible) vs Auth0 vs Clerk.
