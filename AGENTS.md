# AGENTS.md — standing instructions for every agent and every loop cycle

Product: white-label multi-tenant SaaS for gyms (Puerto Rico / Hispanic US). Source of truth: spec v0.5
(https://claude.ai/artifact/NDtd6W5pUFoZvLVCT3q78C). F1 backlog: `docs/backlog.md`. Loop: `docs/loop.md`. Memory: `STATE.md`.

## Non-negotiables (a violation fails review even if the gate is green)
1. **Tenancy.** Every org-scoped table has `org_id`, RLS ENABLED + FORCED, composite FK `(org_id, id)` to its parents,
   and a row in the isolation matrix test (`packages/db/test/rls.test.ts`). New table without matrix coverage = reject.
2. **No privileged paths in request traffic.** API and agents touch tables only through `withClaims()` as
   `app_authenticated`. Cross-RLS needs go in an audited `SECURITY DEFINER` function owned by `app_definer` that
   re-checks claims. `app_owner` runs migrations only. Agents call the API with the invoking user's JWT.
3. **Money.** Stripe TEST mode only (`sk_test_`). Fees computed server-side (`applicationFeeAmount`, basis points).
   Direct charges on the connected account; `metadata.location_id` on every payment; idempotency key on every write;
   freezes via Subscription Schedule or `trial_end`, never `pause_collection`. No billing logic in the frontend.
4. **Health and legal.** AI is never called "nutricionista"/"dietista" (Ley 82). No health claims, no plan published
   without a licensed signature. Consent (`Consent` entity) before any marketing message.
5. **Data.** Demo organisations: synthetic data only, marked "Demo" and `@demo.invalid`. Since 2026-11-05 the owner
   authorised PRODUCTION on gym-saas-f1.netlify.app: the real organisation "Fitness R Us" (Toa Baja) holds real
   personal data (demo mode off, PII guard off; `docs/production.md`). Tests and fixtures stay synthetic. No secrets
   in the repo.
6. **Tests.** Never skip, disable or weaken a test to get green. Fix the code or report the blocker.
7. **Done** = gate green + independent review + ES/EN strings + WCAG 2.2 AA on UI + audit rows + `data-tour-id` on
   critical UI flows + short doc in `docs/`.

## Master prompt
Every loop cycle is driven by `docs/prompts/loop-architect.md` (role, 11-step cycle protocol, defect taxonomy,
bug-fix protocol, hard stops, report format). Reviewers are always separate agents that never see the maker's
self-assessment.

## Commands
- `pnpm install` · `bash scripts/pg-local.sh start` (Postgres 16 on :54329, no Docker) · `pnpm gate` (the loop gate).
