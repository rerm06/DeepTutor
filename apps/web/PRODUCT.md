---
register: product
---

# Product: white-label gym console (spec v0.5)

## What it is
A multi-tenant, white-label SaaS that runs a gym chain in Puerto Rico and the Hispanic US: members, check-in,
classes and appointments, pay-per-session billing, store and POS, health assessments and plans (licensed staff
only), floor circuits, loyalty, CRM, finance and reports. Each organisation wears its own brand (logo, colours,
tagline) through `GET /v1/brand`. Source of truth: `docs/spec/especificacion-v0.5.md`.

The reference tenant in the demo is **Fitness R Us**: black and gold identity, business model "0 mensualidad,
0 contrato, 0 matrícula, 0 mantenimiento: solo pagas tu sesión de entrenamiento".

## Users and their scene
| Role | Scene | What they need from the screen |
| --- | --- | --- |
| Owner / location manager | Laptop in the office or at the counter, fluorescent light, interrupted every few minutes | Today's numbers, what is overdue, what needs a decision; one glance, then act |
| Front desk | Tablet or desktop at the counter with a member waiting | Find a member, check in, sell a session, in seconds; big targets, no hunting |
| Trainer / nutrition / clinician | Tablet on the floor or in a consult room | The member's plan, assessment and circuit; health data only for licensed roles |
| Accountant | Desktop, end of month | Tables, exports, P&L by location |
| Member / guardian | Phone between sets, one hand, uneven gym light | Credential (QR), next class, sessions left, points |

Spanish first (Puerto Rico), English second; every string is bilingual.

## Desired outcome
Staff trust it like Linear or Stripe: dense where it should be, calm, consistent, fast. Members feel the gym's
brand, not the vendor's. The console disappears into the task.

## Brand personality
Disciplined, direct, strong. Gym-floor confidence without gym-bro noise. The tenant's colours carry identity on
the chrome; content stays restrained so numbers and states read first.

## References (supplied by the client)
IronBoard dark-gold executive dashboard (hierarchy of KPIs, gold on black chrome), MuscleTrack / VITA /
PaceFuel (member mobile patterns: bottom tab bar, progress first), set logging over an exercise photo, a lime gym
UI kit, Salesforce-style invoices (clean document tables).

## Anti-references
Neon "fitness app" gradients, glassmorphism, hero-metric templates, uppercase condensed labels everywhere,
dashboards made of identical cards, colour without meaning.

## Hard constraints
- WCAG 2.2 AA: text ≥4.5:1, 44 px targets on touch, visible focus, reduced motion respected, forced colours.
- Health data never shown to front_desk, chef or accountant. The AI is never called "nutricionista" or "dietista".
- Demo data only (`@demo.invalid`); the DEMO banner stays visible.
- Tenant theme values are sanitised (hex only, contrast ≥4.5) before they reach CSS.
