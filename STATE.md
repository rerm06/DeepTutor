# STATE — loop memory (read first, update last, every cycle)

| Field | Value |
|---|---|
| Branch | `claude/gym-saas-f1` (orphan; move to its own repo when created) |
| Last cycle | 1 — 2026-11-02 |
| Gate | PASS (lint, build, typecheck, 82 tests: 68 DB/RLS + 14 API) |
| Gate spot-check | Weakening 2 policies → 27 failures; undoing 3 review fixes → 3 failures. Gate is live. |
| Consecutive cycles without progress | 0 |
| Next epic | E8 Messaging & consent (then E2 → E3 → E4) |

## Cycle log
### Cycle 1 — E12 (partial) + E1 (core)
- Monorepo (pnpm, TS strict, Biome), Postgres schema `app`, 3 least-privilege roles + `app_definer`.
- Tenancy tables, RLS on all, composite FKs, append-only audit log, `register_member` definer function.
- Fastify API: HS256 JWT verification, zod claims, `/v1/me`, `/v1/locations`, `/v1/members` (GET/POST/PATCH), `/v1/audit-log`.
- Isolation matrix: 2 orgs × 10 roles × read/write, location scope, guardian, shared global person.
- Independent security review: 8 findings (4 high, 3 medium, 1 low), all reproduced by the reviewer, all fixed with
  regression tests (see ADR 0001 amendment). Acceptance pending the reviewer's re-check.
- Open in E1: identity provider + token issuance (claims derived from `staff_location`), org switcher, staff admin endpoints.
- Open in E12: staging/prod environments, observability, backups/restore drill, pentest.

## Decisions awaiting the human
- Destination repository (create e.g. `rerm06/gym-saas`, empty, and say its name).
- Identity provider: Supabase Auth (recommended, JWT-compatible) vs Auth0 vs Clerk.
