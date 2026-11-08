# Spec v0.5 → build coverage (source: docs/spec/especificacion-v0.5.md)

Status: ☑ built and gated · ◐ in progress (swarm agent) · ◔ planned (wave B) · ⛔ blocked on an external input · ✗ out of scope for now.

## §3.2 — the 16 modules
| # | Module (spec) | Status | Where / blocker |
|---|---|---|---|
| 1 | Clientes, marcas y sedes (alta autoservicio, migración CSV) | ◐ partial | Tenancy, brands, locations, white-label theme ☑. Self-serve onboarding wizard, CSV import ◔ (E2). Stripe onboarding ⛔ test key |
| 2 | CRM (leads, embudo, tours, pruebas, ficha 360°, riesgo de abandono) | ◐ | crm agent. Churn risk score ◔ (needs check-ins + billing → wave B) |
| 3 | Agenda y acceso (clases, lista de espera, citas, credenciales, check-in, pase diario) | ◐ | schedule agent (+ day pass in billing). Door-controller connector ⛔ vendor choice (F0) |
| 4 | Membresías y facturación | ◐ | billing agent (pay-per-session first for Fitness R Us). Stripe Billing ⛔ test key |
| 5 | Pagos (Connect, Terminal, Checkout) | ⛔ | Adapter stub in billing; needs Stripe test key + Express preview confirmation |
| 6 | Finanzas, gastos y cuentas por pagar | ◔ | wave B finance agent |
| 7 | Evaluación profesional | ◐ | health agent |
| 8 | Planes (entrenamiento, nutrición, tratamiento) con firma | ◐ | health agent (licensed sign-off enforced in SQL; no AI drafting) |
| 9 | Módulo clínico (SOAP, telesalud, referidos) | ✗ / ⛔ | Needs BAA provider + legal (HIPAA, Reglamento 9518). Only triage + plans now |
| 10 | Sala y equipos (QR/NFC, circuitos, sustitución) | ◐ | floor agent (QR codes; NFC needs native app ✗) |
| 11 | Progreso (métricas vs. evaluación base, informes mensuales) | ◔ | after health + floor merge |
| 12 | Retos y comunidad | ◐ | engagement agent |
| 13 | Fidelización (puntos, niveles, referidos, canje) | ◐ | engagement agent (store redemption link ◔ wave B) |
| 14 | Contenido, lecciones y tutor | ◐ partial | Lesson + tutorial video prototypes exist (scratchpad/proto). Player, voice tutor ⛔ (LiveKit/Deepgram/TTS keys) |
| 15 | Tienda (catálogo, inventario por sede, online, transferencias) | ◐ | store agent |
| 16 | Agentes de IA (coach, ventas, cobranza, retención, guardián…) | ⛔ | Needs an Anthropic API key; guardian rules + evaluations harness ◔ |

## Cross-cutting
| Area | Status |
|---|---|
| Multi-tenancy, RLS, roles, audit (E1) | ☑ (2 independent security reviews) |
| Messaging and consent (E8) | ◐ slice 1 ☑; 3 open findings awaiting decision; providers ⛔ Twilio test credentials |
| Reports and dashboard (E13) | ◔ wave B |
| Help, tutorials, academy (E14) | ◔ (tour-as-code prototype exists) |
| Platform, CI, deploy (E12) | ☑ CI + gate + Netlify demo; observability/backups/pentest ◔ |
| Identity provider | ⛔ choice pending (Supabase Auth recommended); demo sessions meanwhile |
| Native apps (member, staff POS/NFC/Tap to Pay) | ✗ F2/F4 |
| Competitive governance agents (§7.3) | ✗ (needs LLM key; process documented) |
