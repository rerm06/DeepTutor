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
| Maker | `loop-architect` (master prompt, `docs/prompts/loop-architect.md`): plans the slice, writes tests first, builds (or dispatches builders on disjoint files), runs the gate, mutation-checks every new control, self-reviews against the defect taxonomy. |
| Checker | `scripts/gate.sh` (objective) + an independent reviewer agent that never sees the maker's self-assessment. |
| Safety in the gate | Isolation matrix, secrets scan, live-key refusal, forbidden health terms. |
| Hard stops | 1 epic slice per cycle · max 3 fix attempts per gate failure · stop after 2 cycles without progress · stop on any missing credential, legal/tax question, or live-money action. |
| Human-on-the-loop | Merges, Stripe live mode, legal/tax/clinical content, new third-party services, architecture changes. |
| Escalation owner | Repository owner (rerm06). |
| Metric | Cost per accepted change = cycle tokens ÷ slices that pass gate + review. Below 50 % acceptance → fix the gate or stop. |

## Canonical `/loop` prompt (self-paced)

```
/loop Ciclo del build loop de gym-saas. Despacha al agente loop-architect (docs/prompts/loop-architect.md) y sigue su
protocolo de 11 pasos. Si STATE.md dice STOPPED, no construyas: resume el bloqueo y detén el loop.
```

## Lessons that shaped the master prompt (cycles 1–2)
- Cycle 1: 8 + 3 security findings that 71 green tests did not catch → column grants, signed and transaction-bound claims,
  audit by trigger, matrix rows must be seeded. Mutation checks added to the protocol.
- Cycle 2: template-variable injection (critical) survived one fix because free text was narrowed instead of removed;
  opt-out semantics produced new holes in each round → "remove the free-text channel", "decide compliance from the
  append-only history", and "per-entity locks when two operations compete" are now explicit rules.
- Acceptance metric so far: cycle 1 accepted after 2 review rounds; cycle 2 stopped after 3 (not accepted).
