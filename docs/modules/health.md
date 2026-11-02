# Module health — assessment, triage and care plans (spec §6.1–6.2, §6.6–6.7)

**Regulated domain.** This module is a *draft workflow for licensed professionals*. It never generates content
with AI, makes no health claims and gives no diagnosis. The triage is a deterministic screening aid,
`rule_version = 'v0-propuesta'` **[VERIFICAR · equipo clínico]**. Member views always show
"No es un dispositivo médico; consulta a un profesional de la salud". The nutrition role is only ever called
"Especialista en nutrición con licencia" (Ley 82).

## Data model (migration `0010_health.sql`)

| Table | Purpose | Written by |
|---|---|---|
| `assessment` | Onboarding: member, evaluator (`staff_member`), `taken_at`, `parq` (exactly `q1..q7` booleans, PAR-Q+ general section), `parq_followup_resolved`, `declared_conditions` (fixed list, see below), vitals (`resting_hr`, `bp_sys`, `bp_dia`), anthropometrics (`height_cm`, `weight_kg`, `waist_cm`), `fitness_tests` (known numeric keys), `acute_symptoms`, `status draft|signed`, `signed_by`, `signed_at` | INSERT/UPDATE of draft columns (column grants + RLS); signing only via `app.sign_assessment()` |
| `triage_result` | One per signed assessment: `rule_version`, `exercise_level`, `nutrition_level` (green/amber/red), `requires_medical_referral`, `emergency`, `no_calorie_counting`, `reasons[]` | `app.sign_assessment()` only; append-only |
| `care_plan` | `kind training|nutrition|treatment`, `series_id` + `version`, `status draft|review|approved|published|archived`, `title`, `body` (`{"sections":[{"heading","items"}]}`), `rationale`, `created_by`, `approved_by`, `approved_at`, snapshots `approver_name`, `approver_license_no`, `triage_result_id`, `referral_acknowledged`, `published_at`, `archived_at` | INSERT/UPDATE of draft content (column grants + RLS); every transition via definer functions |

Declared conditions (no free text): `diabetes, ckd, cvd, pregnancy, lactation, glp1,
eating_disorder_screen_positive, advanced_ckd, active_ed, high_risk_pregnancy`.

All tables: `org_id` + composite FKs, RLS ENABLE + FORCE, `definer_all` policy for `app_definer`, no DELETE
(trigger), column-level grants only. Every create and status change is audited by trigger (`health.assessment.*`,
`care_plan.*`) with the real actor; audit `meta` never carries clinical data.

## Triage (`app.health_triage`, pure, IMMUTABLE)

| Input | Exercise | Nutrition | Flags |
|---|---|---|---|
| PAR-Q+ all no | green | green | |
| PAR-Q+ yes, follow-up resolved | green | | |
| PAR-Q+ yes, unresolved | amber | | |
| diabetes / ckd / cvd | amber | amber | medical referral |
| pregnancy / lactation | amber | amber | |
| glp1 | | amber | |
| eating_disorder_screen_positive | | red | |
| advanced_ckd / active_ed / high_risk_pregnancy | | red | |
| minor (a guardian link exists) | | | `no_calorie_counting` |
| acute symptoms | | | `emergency` → UI "Llama al 911" + location staff |

Each axis takes the most severe level of every rule that fires. Conservative readings **[VERIFICAR · equipo
clínico]**: `advanced_ckd` also fires the ckd row and `high_risk_pregnancy` the pregnancy row; every nutrition red
and every emergency also set `requires_medical_referral`; acute symptoms set exercise red.

## Sign-off rules (definer functions + `care_plan_guard` trigger, which no path can skip)

- State machine: draft → review → (draft | approved) → published → archived; approved → archived. Content is
  editable only in draft. Approved/published/archived rows are immutable: changes are a new version
  (`app.new_care_plan_version`, one open draft/review per series); publishing a version archives the previously
  published one.
- **Training**: drafted and approved by `trainer` or `location_manager`; needs a signed assessment; blocked if the
  latest exercise triage is red.
- **Nutrition**: drafted only by `nutritionist`; approved ONLY by a `nutritionist` staff row with
  `license_verified_at` and `license_no`; NEVER while the member's latest nutrition triage is red; amber (or any
  referral) requires `referral_acknowledged = true`; licence and triage are snapshotted.
- **Treatment**: drafted and approved only by a `clinician` with a verified licence.
- Publish/archive: approver roles of the kind, plus `owner`/`location_manager`.
- Triage signing and plan transitions serialise per member (`pg_advisory_xact_lock`), so a red triage signed
  concurrently always wins over a nutrition approval.

## Visibility

Member: own **signed** assessments (+ triage) and **published** plans. Guardian: the ward's. Trainer,
nutritionist, clinician, location_manager: members of their locations, every state. Owner: org-wide.
**Never** front_desk, chef or accountant (they see zero rows; navigation hides the screens).

## Endpoints (`/api/v1`, zod `.strict()`)

| Method | Path | Notes |
|---|---|---|
| GET | `/health/whoami` | caller's staff row, `license_no`, `license_verified` |
| POST | `/health/triage-preview` | `{ member_id?, parq, parq_followup_resolved, declared_conditions, acute_symptoms }` → same SQL function |
| GET | `/health/assessments?member_id=` | RLS-filtered, with `triage` |
| GET | `/health/assessments/:id` | 404 when not visible |
| POST | `/health/assessments` | draft → 201 `{ id }` |
| PATCH | `/health/assessments/:id` | draft only (404 otherwise) |
| POST | `/health/assessments/:id/sign` | → `{ id, status, triage }` |
| GET | `/health/plans?member_id=&kind=&status=` | RLS-filtered |
| GET | `/health/plans/:id` | |
| POST | `/health/plans` | `{ member_id, kind, title, body, rationale? }` → 201 draft |
| PATCH | `/health/plans/:id` | draft only |
| POST | `/health/plans/:id/{submit,return,approve,publish,archive}` | approve body `{ referral_acknowledged }` |
| POST | `/health/plans/:id/new-version` | 201; 409 if an open version exists |

Refusals are `403 { error: "forbidden", reason }` with `reason` ∈ `license_not_verified`,
`triage_red_blocks_nutrition`, `triage_red_blocks_training`, `triage_required`, `referral_ack_required`,
`invalid_transition`, `plan_immutable`, `assessment_signed_immutable`, `approver_role`.

## UI (`apps/web/src/modules/health`)

Staff: **Evaluaciones** (`/staff/health/assessments`: PAR-Q+ yes/no, conditions, vitals, measures, tests, triage
preview, sign; coloured plates + reasons; emergency banner) and **Planes** (`/staff/health/plans`: drafts from
templates, submit, return, approve with licence shown, publish, archive, new version). Member/guardian:
**Mi evaluación** and **Mi plan** (nutrition shows "Plan alimentario aprobado por {name}, licencia {no}").
Member record tab "Salud" for health roles.

## Demo seed (`seed/0010_health.sql`)

Adds the licensed nutrition specialist (person `a0000000-0000-4000-8000-000000000107`, staff `…0507`, licence
`DEMO-N-0001`, verified) and clinician (person `…0108`, staff `…0508`, licence `DEMO-C-0001`, verified) at Demo
Sede San Juan, plus signed assessments for Ana (green), Pedro (diabetes → amber + referral), Sofía (ED screen →
nutrition red), Miguel (acute → emergency), Diego (minor → no calorie counting), plans in every state, and one
signed assessment in org B.

## [VERIFICAR]

- Triage rules and the conservative readings above — equipo clínico (`v0-propuesta`).
- PAR-Q+ wording is a paraphrase; use the official PAR-Q+ text and confirm its licence of use.
- Whether trainers should see nutrition/treatment plans (spec lists them among health viewers; kept).
- Whether a signed assessment is required before training approval (kept: required).
- Term screen for plan text (`app.health_text_safe`) — legal review to extend.
- HIPAA/Ley de privacidad applicability for this data in PR — legal review.
