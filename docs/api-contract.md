# API contract (v1) — consumed by apps/web

Base URL: `/api/v1` (same origin on Netlify). Auth: `Authorization: Bearer <jwt>`; tokens live 15 minutes.
Errors: `{ "error": "<code>" }` with 400 invalid_input · 401 unauthenticated · 403 forbidden · 404 not_found · 409 conflict.

## Demo session (DEMO MODE only; synthetic data)
`GET  /demo/personas` → `{ data: [{ id, org: "A"|"B", org_name, role, display_name, home: string|null }] }`
`POST /demo/session` body `{ persona_id }` → `{ token, expires_in: 900, persona: {...same shape} }`
When any call returns 401, the client silently requests a new session for the same persona once, then retries.

## Identity and org
`GET /me` → `{ organization: {id,name,saas_plan}, person: {id,email}, role, location_ids }`
`GET /locations` → `{ data: [{ id, name, brand_id, timezone, municipality }] }`
`GET /audit-log` (owner; managers for their locations) → `{ data: [{ id, actor_person_id, actor_role, action, entity, entity_id, location_id, at }] }`

## Members
`GET  /members?location_id=` → `{ data: [{ id, status, member_no, home_location_id, full_name, email }] }`
`POST /members` body `{ email, full_name, phone?, home_location_id }` → 201 `{ id }` (owner, location_manager, front_desk)
`PATCH /members/:id` body `{ status: lead|trial|active|frozen|past_due|cancelled }` → `{ id, status }`

## Consent and messaging
`GET  /members/:id/consents` → `{ data: [{ id, brand_id, channel, purpose, status, source, evidence, granted_at, revoked_at, updated_at }] }`
`PUT  /members/:id/consents` body `{ brand_id, channel: whatsapp|sms|email, purpose: transactional|reminder|marketing, granted: boolean, source: front_desk|member_portal|web_form|import, evidence? }` → `{ id }`
  - Staff use source `front_desk` (or `web_form`); members/guardians use `member_portal`. Grants need evidence.
`POST /members/:id/opt-out` body `{ brand_id, source }` → `{ revoked }`
`GET  /templates` → `{ data: [{ key, locale, purpose, body }] }` (catalogue; `{{var}}` placeholders)
`POST /messages` body `{ member_id, brand_id, channel, template_key, locale: es|en, vars: { date?: "YYYY-MM-DD", time?: "HH:MM", amount?: "$12.34", last4?: "1234", discount?: "15%" } }`
  → 201 `{ id, status: queued|blocked, block_reason, scheduled_for }`
  - Variables needed per template: class.reminder {date,time} · membership.renewal_notice {date,amount} ·
    payment.failed {amount} · card.expiring {last4,date} · promo.generic {discount,date}
`GET  /messages?member_id=` → `{ data: [{ id, channel, purpose, template_key, body, status, block_reason, scheduled_for, created_at }] }`
`GET  /inbox?location_id=` → `{ data: [{ id, brand_id, location_id, member_id, channel, from_address, body, received_at, handled }] }`
