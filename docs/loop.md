# Build loop spec (design-a-loop)

## 4-condition test
| Condition | Verdict |
|---|---|
| Repeats | Yes: 14 epics, same shape (schema → API → UI → tests → docs). |
| Automated verification | Yes: `scripts/gate.sh` (secrets scan, forbidden terms, lint, build, typecheck, Postgres-backed tests) + CI. |
| Budget absorbs waste | Bounded by the hard stops below. |
| Senior tools | Yes: real Postgres 16, Node 22, test runner, logs; Stripe only in test mode (needs a test key from the human). |

## Spec
| Element | Value |
|---|---|
| Trigger | `/loop` self-paced in the Claude Code session; one cycle = one epic slice. |
| Skill (standing knowledge) | `AGENTS.md` + spec v0.5 + `docs/backlog.md`. |
| State file | `STATE.md` (read first, update last). |
| Maker | Architect → implementer agents (DB/RLS, API, payments, frontend), each owning disjoint files. |
| Checker | `scripts/gate.sh` (objective) + an independent reviewer agent that never sees the maker's self-assessment. |
| Safety in the gate | Isolation matrix, secrets scan, live-key refusal, forbidden health terms. |
| Hard stops | 1 epic slice per cycle · max 3 fix attempts per gate failure · stop after 2 cycles without progress · stop on any missing credential, legal/tax question, or live-money action. |
| Human-on-the-loop | Merges, Stripe live mode, legal/tax/clinical content, new third-party services, architecture changes. |
| Escalation owner | Repository owner (rerm06). |
| Metric | Cost per accepted change = cycle tokens ÷ slices that pass gate + review. Below 50 % acceptance → fix the gate or stop. |
