-- E1 · Identity, multi-tenancy and RBAC (spec §3.1, §3.3).
-- Hierarchy: Organization → LegalEntity → Brand → Location. Person is global; Member and StaffMember are per org.
CREATE SCHEMA IF NOT EXISTS app;

CREATE TYPE app.role_name AS ENUM (
  'owner', 'location_manager', 'front_desk', 'trainer', 'nutritionist',
  'chef', 'clinician', 'accountant', 'member', 'guardian'
);
CREATE TYPE app.saas_plan AS ENUM ('esencial', 'pro', 'elite');
CREATE TYPE app.member_status AS ENUM ('lead', 'trial', 'active', 'frozen', 'past_due', 'cancelled');

-- ── Claims helpers. Claims come from the verified JWT, set per transaction by the API with
--    set_config('request.jwt.claims', <json>, true). Missing claims resolve to NULL → every policy denies.
CREATE FUNCTION app.claims() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
CREATE FUNCTION app.org_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(app.claims() ->> 'org_id', '')::uuid
$$;
CREATE FUNCTION app.person_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(app.claims() ->> 'sub', '')::uuid
$$;
CREATE FUNCTION app.role() RETURNS app.role_name LANGUAGE sql STABLE AS $$
  SELECT nullif(app.claims() ->> 'app_role', '')::app.role_name
$$;
CREATE FUNCTION app.location_ids() RETURNS uuid[] LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    array(SELECT jsonb_array_elements_text(coalesce(app.claims() -> 'location_ids', '[]'::jsonb))::uuid),
    '{}'::uuid[])
$$;
CREATE FUNCTION app.is_staff() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(app.role() NOT IN ('member', 'guardian'), false)
$$;
-- Owner and accountant are organisation-wide; every other staff role is scoped to its assigned locations.
CREATE FUNCTION app.org_wide() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(app.role() IN ('owner', 'accountant'), false)
$$;
CREATE FUNCTION app.can_see_location(loc uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT app.org_wide() OR loc = ANY (app.location_ids())
$$;

-- ── Tables. Every org-scoped row carries org_id; composite FKs (org_id, id) make cross-org references
--    impossible even for a buggy writer.
CREATE TABLE app.organization (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  saas_plan app.saas_plan NOT NULL DEFAULT 'esencial',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.legal_entity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id() REFERENCES app.organization (id),
  legal_name text NOT NULL,
  stripe_account_id text UNIQUE,
  hacienda_merchant_no text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id)
);

CREATE TABLE app.brand (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  legal_entity_id uuid NOT NULL,
  name text NOT NULL,
  theme jsonb NOT NULL DEFAULT '{}'::jsonb,
  custom_domain text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, legal_entity_id) REFERENCES app.legal_entity (org_id, id)
);

CREATE TABLE app.location (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  brand_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'America/Puerto_Rico',
  municipality text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, brand_id) REFERENCES app.brand (org_id, id),
  FOREIGN KEY (org_id, legal_entity_id) REFERENCES app.legal_entity (org_id, id)
);

CREATE TABLE app.person (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  full_name text NOT NULL,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX person_email_lower_uq ON app.person (lower(email));

CREATE TABLE app.member (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  person_id uuid NOT NULL REFERENCES app.person (id),
  home_location_id uuid NOT NULL,
  member_no text,
  status app.member_status NOT NULL DEFAULT 'lead',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, person_id),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, home_location_id) REFERENCES app.location (org_id, id)
);
CREATE INDEX member_org_location_idx ON app.member (org_id, home_location_id);

CREATE TABLE app.staff_member (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  person_id uuid NOT NULL REFERENCES app.person (id),
  role app.role_name NOT NULL CHECK (role NOT IN ('member', 'guardian')),
  license_no text,
  license_verified_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, person_id, role),
  UNIQUE (org_id, id),
  -- Licensed roles cannot be marked verified without a licence number (spec §3.1, §6.7).
  CHECK (license_verified_at IS NULL OR license_no IS NOT NULL)
);

CREATE TABLE app.staff_location (
  org_id uuid NOT NULL DEFAULT app.org_id(),
  staff_member_id uuid NOT NULL,
  location_id uuid NOT NULL,
  PRIMARY KEY (staff_member_id, location_id),
  FOREIGN KEY (org_id, staff_member_id) REFERENCES app.staff_member (org_id, id),
  FOREIGN KEY (org_id, location_id) REFERENCES app.location (org_id, id)
);

CREATE TABLE app.guardian_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  guardian_person_id uuid NOT NULL REFERENCES app.person (id),
  member_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guardian_person_id, member_id),
  FOREIGN KEY (org_id, member_id) REFERENCES app.member (org_id, id)
);

-- Append-only audit trail (definition of done: "registro de auditoría").
CREATE TABLE app.audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id uuid NOT NULL DEFAULT app.org_id() REFERENCES app.organization (id),
  actor_person_id uuid NOT NULL DEFAULT app.person_id(),
  actor_role app.role_name NOT NULL DEFAULT app.role(),
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  location_id uuid,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_org_at_idx ON app.audit_log (org_id, at DESC);
