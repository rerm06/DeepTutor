# F1 backlog — status (spec §15)

Legend: ☐ not started · ◐ in progress · ☑ done (gate + review). Estimates are spec [P] person-weeks.

| Epic | Status | Done | Remaining | Depends |
|---|---|---|---|---|
| E1 Identity, multi-tenancy, RBAC (6) | ◐ | Schema, RLS, 10 roles, JWT verify, audit, isolation matrix (59 cases) | IdP + token issuance, org switcher, staff admin API | — |
| E12 Platform, security, ops (6) | ◐ | Monorepo, gate, CI, local PG, secrets scan, live-key refusal | Envs, observability, backups drill, pentest | — |
| E8 Messaging & consent (5) | ☐ | | Consent entity, channels, STOP/BAJA, quiet hours, inbox | E1 |
| E2 Gym self-serve onboarding (5) | ☐ | | Wizard, Stripe Accounts v2 + embedded onboarding (test), CSV import | E1 |
| E3 Catalog & pricing (4) | ☐ | | Products/prices synced to connected account, rules, IVU type | E2 |
| E4 Subscriptions & billing (8) | ☐ | | Billing, freeze, IVU invoices, fee %, retries, test clocks | E3, E8 |
| E6 Schedule & access (7) | ☐ | | Classes, waitlist, rotating QR, check-in bar | E1, E3 |
| E5 One-off payments & POS (5) | ☐ | | Checkout, fee amount, refunds, Terminal (simulated) | E3, E7 |
| E7 Member PWA (7) | ☐ | | Next.js PWA, brand theme, ES/EN, push | E4, E6 |
| E9 CRM & leads (4) | ☐ | | Leads, funnel, 360 profile | E1, E8 |
| E11 Store & inventory (4) | ☐ | | Catalog, stock per location, age check | E5 |
| E10 Sales & collections agents (7) | ☐ | | Orchestrator, guardian, evals ≥150 | E8, E9, E4 |
| E13 Reports (4) | ☐ | | IVU by municipality, heatmap, exports | E4, E5, E11 |
| E14 Help & academy (5) | ☐ | | Tour-as-code tutorials, CI gate | E2, E7, E12 |
