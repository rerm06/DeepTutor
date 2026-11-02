-- Module store · E5 POS, E11 store & inventory, §11 supplements. Owned by the store module (docs/modules.md).
-- Rules:
--   * Stock is per (product, location). on_hand only changes together with an append-only stock_movement row, so
--     on_hand = Σ movement.qty at all times (spec E11 acceptance). `reserved` holds units promised to online
--     orders awaiting pickup; sellable stock is on_hand − reserved.
--   * Every write except product maintenance goes through an audited SECURITY DEFINER function owned by
--     app_definer that re-checks claims and location scope and locks the inventory rows it changes (FOR UPDATE,
--     in product order, so two sales of the last unit cannot both succeed and concurrent sales cannot deadlock).
--   * IVU (PR sales and use tax): 10.5 % state + 1 % municipal on taxable lines, rounded half-up PER LINE
--     [VERIFICAR · CPA: per-line vs per-invoice rounding, municipal rate per municipality, taxability per category].
--   * Age-restricted products (some supplements) need the seller to confirm ID; the verifying staff member is
--     recorded. Minimum age per state/territory [VERIFICAR · legal].
--   * The platform never recommends supplements; it stores no health claims (names are screened).

CREATE TYPE app.store_category AS ENUM ('supplement', 'apparel', 'drink', 'accessory', 'other');
CREATE TYPE app.store_movement_kind AS ENUM ('receive', 'sale', 'return', 'transfer_out', 'transfer_in', 'adjust');
CREATE TYPE app.store_sale_channel AS ENUM ('pos', 'online');
CREATE TYPE app.store_sale_status AS ENUM ('completed', 'pending_pickup', 'refunded', 'cancelled');
CREATE TYPE app.store_payment_method AS ENUM ('cash', 'card_simulated');
CREATE TYPE app.store_transfer_status AS ENUM ('completed');

-- ── Tables
CREATE TABLE app.product (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id() REFERENCES app.organization (id),
  sku text NOT NULL CHECK (sku ~ '^[A-Z0-9][A-Z0-9-]{1,31}$'),
  -- Names show up in receipts and the member catalogue: no links, phones, braces, health promises or titles.
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120 AND NOT app.has_forbidden_terms(name)),
  category app.store_category NOT NULL,
  age_restricted boolean NOT NULL DEFAULT false,
  taxable boolean NOT NULL DEFAULT true,
  price_cents integer NOT NULL CHECK (price_cents BETWEEN 0 AND 100000),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, sku),
  UNIQUE (org_id, id)
);

CREATE TABLE app.inventory_level (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  product_id uuid NOT NULL,
  location_id uuid NOT NULL,
  on_hand integer NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  reserved integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  reorder_point integer NOT NULL DEFAULT 0 CHECK (reorder_point BETWEEN 0 AND 100000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (reserved <= on_hand),
  UNIQUE (org_id, product_id, location_id),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, product_id) REFERENCES app.product (org_id, id),
  FOREIGN KEY (org_id, location_id) REFERENCES app.location (org_id, id)
);

CREATE TABLE app.sale (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  location_id uuid NOT NULL,
  channel app.store_sale_channel NOT NULL,
  member_id uuid,
  status app.store_sale_status NOT NULL,
  subtotal_cents integer NOT NULL CHECK (subtotal_cents >= 0),
  ivu_state_cents integer NOT NULL CHECK (ivu_state_cents >= 0),
  ivu_municipal_cents integer NOT NULL CHECK (ivu_municipal_cents >= 0),
  total_cents integer NOT NULL,
  payment_method app.store_payment_method,
  age_verified_by uuid,                 -- staff_member who checked ID for age-restricted lines
  created_by uuid NOT NULL REFERENCES app.person (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_by uuid REFERENCES app.person (id),
  completed_at timestamptz,
  refunded_by uuid REFERENCES app.person (id),
  refunded_at timestamptz,
  refund_reason text CHECK (length(refund_reason) BETWEEN 3 AND 200 AND refund_reason !~ '[[:cntrl:]]'),
  cancelled_by uuid REFERENCES app.person (id),
  cancelled_at timestamptz,
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, location_id) REFERENCES app.location (org_id, id),
  FOREIGN KEY (org_id, member_id) REFERENCES app.member (org_id, id),
  FOREIGN KEY (org_id, age_verified_by) REFERENCES app.staff_member (org_id, id),
  CHECK (total_cents = subtotal_cents + ivu_state_cents + ivu_municipal_cents),
  CHECK (channel = 'pos' OR member_id IS NOT NULL),
  CHECK (channel = 'online' OR status IN ('completed', 'refunded')),
  CHECK (status NOT IN ('completed', 'refunded') OR (payment_method IS NOT NULL AND completed_at IS NOT NULL)),
  CHECK ((status = 'refunded') = (refunded_at IS NOT NULL AND refund_reason IS NOT NULL)),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);
CREATE INDEX sale_org_loc_created_idx ON app.sale (org_id, location_id, created_at DESC);
CREATE INDEX sale_member_idx ON app.sale (member_id) WHERE member_id IS NOT NULL;

CREATE TABLE app.sale_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  sale_id uuid NOT NULL,
  product_id uuid NOT NULL,
  qty integer NOT NULL CHECK (qty BETWEEN 1 AND 999),
  unit_price_cents integer NOT NULL CHECK (unit_price_cents >= 0),
  taxable boolean NOT NULL,              -- snapshot at sale time
  age_restricted boolean NOT NULL,       -- snapshot at sale time
  subtotal_cents integer NOT NULL,
  ivu_state_cents integer NOT NULL,
  ivu_municipal_cents integer NOT NULL,
  total_cents integer NOT NULL,
  UNIQUE (org_id, id),
  UNIQUE (sale_id, product_id),
  FOREIGN KEY (org_id, sale_id) REFERENCES app.sale (org_id, id),
  FOREIGN KEY (org_id, product_id) REFERENCES app.product (org_id, id),
  CHECK (subtotal_cents = qty * unit_price_cents),
  CHECK (total_cents = subtotal_cents + ivu_state_cents + ivu_municipal_cents),
  CHECK (taxable OR (ivu_state_cents = 0 AND ivu_municipal_cents = 0))
);
CREATE INDEX sale_line_sale_idx ON app.sale_line (sale_id);

CREATE TABLE app.stock_transfer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  from_location_id uuid NOT NULL,
  to_location_id uuid NOT NULL,
  status app.store_transfer_status NOT NULL DEFAULT 'completed',
  note text CHECK (length(note) <= 200 AND note !~ '[[:cntrl:]]'),
  created_by uuid NOT NULL REFERENCES app.person (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, from_location_id) REFERENCES app.location (org_id, id),
  FOREIGN KEY (org_id, to_location_id) REFERENCES app.location (org_id, id),
  CHECK (from_location_id <> to_location_id)
);

CREATE TABLE app.stock_transfer_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  transfer_id uuid NOT NULL,
  product_id uuid NOT NULL,
  qty integer NOT NULL CHECK (qty BETWEEN 1 AND 999),
  UNIQUE (org_id, id),
  UNIQUE (transfer_id, product_id),
  FOREIGN KEY (org_id, transfer_id) REFERENCES app.stock_transfer (org_id, id),
  FOREIGN KEY (org_id, product_id) REFERENCES app.product (org_id, id)
);

-- Append-only ledger. qty is signed: in > 0 (receive, return, transfer_in), out < 0 (sale, transfer_out),
-- adjust either way. on_hand of a (product, location) always equals the sum of its movements.
CREATE TABLE app.stock_movement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL DEFAULT app.org_id(),
  product_id uuid NOT NULL,
  location_id uuid NOT NULL,
  kind app.store_movement_kind NOT NULL,
  qty integer NOT NULL,
  ref text CHECK (ref ~ '^[A-Za-z0-9 ._/#-]{1,60}$'),
  reason text CHECK (length(reason) BETWEEN 3 AND 200 AND reason !~ '[[:cntrl:]]'),
  sale_id uuid,
  transfer_id uuid,
  by_person_id uuid NOT NULL REFERENCES app.person (id),
  at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, product_id) REFERENCES app.product (org_id, id),
  FOREIGN KEY (org_id, location_id) REFERENCES app.location (org_id, id),
  FOREIGN KEY (org_id, sale_id) REFERENCES app.sale (org_id, id),
  FOREIGN KEY (org_id, transfer_id) REFERENCES app.stock_transfer (org_id, id),
  CHECK (CASE kind
           WHEN 'receive' THEN qty > 0
           WHEN 'return' THEN qty > 0 AND sale_id IS NOT NULL
           WHEN 'transfer_in' THEN qty > 0 AND transfer_id IS NOT NULL
           WHEN 'sale' THEN qty < 0 AND sale_id IS NOT NULL
           WHEN 'transfer_out' THEN qty < 0 AND transfer_id IS NOT NULL
           WHEN 'adjust' THEN qty <> 0 AND reason IS NOT NULL
         END)
);
CREATE INDEX stock_movement_level_idx ON app.stock_movement (org_id, product_id, location_id, at DESC);

-- ── Pure helpers (no table access)
-- One line's money, PR IVU rounded half-up per line [VERIFICAR · CPA]. Rates in basis points: 1050 + 100.
CREATE FUNCTION app.store_line_amounts(p_qty integer, p_unit_cents integer, p_taxable boolean,
  OUT subtotal_cents integer, OUT ivu_state_cents integer, OUT ivu_municipal_cents integer, OUT total_cents integer)
LANGUAGE sql IMMUTABLE AS $$
  SELECT s, st, mu, s + st + mu
    FROM (SELECT p_qty * p_unit_cents AS s) a,
         LATERAL (SELECT CASE WHEN p_taxable THEN round(a.s::numeric * 1050 / 10000)::integer ELSE 0 END AS st,
                         CASE WHEN p_taxable THEN round(a.s::numeric * 100 / 10000)::integer ELSE 0 END AS mu) b
$$;

-- Validate a cart: a JSON array of 1–50 {product_id: uuid, qty: 1..999} objects with no other keys. Duplicate
-- products are merged (the merged quantity is capped too). Anything else → 22023 invalid_lines.
CREATE FUNCTION app.store_parse_lines(p_lines jsonb) RETURNS TABLE (l_product uuid, l_qty integer)
LANGUAGE plpgsql IMMUTABLE SET search_path = app, pg_temp AS $$
DECLARE
  e jsonb;
  r record;
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array'
     OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'invalid_lines' USING ERRCODE = '22023';
  END IF;
  FOR e IN SELECT x FROM jsonb_array_elements(p_lines) x LOOP
    IF jsonb_typeof(e) <> 'object' OR NOT (e ?& ARRAY['product_id', 'qty'])
       OR (SELECT count(*) FROM jsonb_object_keys(e)) <> 2
       OR jsonb_typeof(e -> 'product_id') <> 'string' OR jsonb_typeof(e -> 'qty') <> 'number'
       OR (e ->> 'product_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR (e ->> 'qty') !~ '^[1-9][0-9]{0,2}$' THEN
      RAISE EXCEPTION 'invalid_lines' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  FOR r IN SELECT (x ->> 'product_id')::uuid AS p, sum((x ->> 'qty')::integer)::integer AS q
             FROM jsonb_array_elements(p_lines) x GROUP BY 1 ORDER BY 1 LOOP
    IF r.q > 999 THEN RAISE EXCEPTION 'invalid_lines' USING ERRCODE = '22023'; END IF;
    l_product := r.p;
    l_qty := r.q;
    RETURN NEXT;
  END LOOP;
END $$;

CREATE FUNCTION app.store_text_ok(p text, p_min integer, p_max integer) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p IS NOT NULL AND length(btrim(p)) BETWEEN p_min AND p_max AND p !~ '[[:cntrl:]]'
$$;

-- ── Claim helpers (owned by app_definer; read only what the rule needs, always within the caller's org)
-- Staff who sell at a location: owner (any location), location_manager and front_desk (assigned locations).
CREATE FUNCTION app.store_can_sell(p_location uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT coalesce(app.role() IN ('owner', 'location_manager', 'front_desk')
     AND app.can_see_location(p_location)
     AND EXISTS (SELECT 1 FROM app.location l WHERE l.id = p_location AND l.org_id = app.org_id()), false)
$$;
-- Staff who manage stock at a location: owner, location_manager.
CREATE FUNCTION app.store_can_manage(p_location uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT coalesce(app.role() IN ('owner', 'location_manager')
     AND app.can_see_location(p_location)
     AND EXISTS (SELECT 1 FROM app.location l WHERE l.id = p_location AND l.org_id = app.org_id()), false)
$$;
CREATE FUNCTION app.store_location_in_org(p_location uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM app.location l WHERE l.id = p_location AND l.org_id = app.org_id())
$$;
-- The caller's own staff row for the role in the token (who verified age, who sold).
CREATE FUNCTION app.store_caller_staff_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT s.id FROM app.staff_member s
   WHERE s.org_id = (SELECT app.org_id()) AND s.person_id = (SELECT app.person_id())
     AND s.role = (SELECT app.role()) AND s.active
   LIMIT 1
$$;
-- Member rows a member/guardian caller acts for (self and wards). Empty for staff. Evaluated once per statement
-- by the sale policy (initplan).
CREATE FUNCTION app.store_my_member_ids() RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT CASE WHEN app.org_id() IS NULL OR app.is_staff() THEN '{}'::uuid[] ELSE coalesce(array(
    SELECT m.id FROM app.member m
     WHERE m.org_id = (SELECT app.org_id())
       AND (m.person_id = (SELECT app.person_id())
            OR EXISTS (SELECT 1 FROM app.guardian_link g
                        WHERE g.member_id = m.id AND g.org_id = m.org_id
                          AND g.guardian_person_id = (SELECT app.person_id())))), '{}'::uuid[]) END
$$;

-- ── Internal building blocks (owned by app_definer, NOT executable by request traffic)
-- Lock the inventory rows of these products at this location (product order: no deadlocks) and check that
-- sellable stock (on_hand − reserved) covers every quantity. Rows are re-read after the lock, so a sale that
-- waited for another one sees the committed result.
CREATE FUNCTION app.store_lock_available(p_org uuid, p_location uuid, p_products uuid[], p_qtys integer[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  PERFORM 1 FROM app.inventory_level i
    WHERE i.org_id = p_org AND i.location_id = p_location AND i.product_id = ANY (p_products)
    ORDER BY i.product_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM unnest(p_products, p_qtys) l(pid, qty)
               LEFT JOIN app.inventory_level i
                 ON i.org_id = p_org AND i.location_id = p_location AND i.product_id = l.pid
              WHERE coalesce(i.on_hand - i.reserved, 0) < l.qty) THEN
    RAISE EXCEPTION 'insufficient_stock' USING ERRCODE = '23514';
  END IF;
END $$;

-- Insert a sale and its lines (prices, taxability and age flag snapshotted from active products of the org).
CREATE FUNCTION app.store_insert_sale(p_org uuid, p_location uuid, p_channel app.store_sale_channel,
  p_member uuid, p_status app.store_sale_status, p_payment app.store_payment_method, p_age_verified_by uuid,
  p_products uuid[], p_qtys integer[]) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_id uuid := gen_random_uuid();
  v_sub bigint;
  v_st bigint;
  v_mu bigint;
BEGIN
  SELECT sum(a.subtotal_cents), sum(a.ivu_state_cents), sum(a.ivu_municipal_cents)
    INTO v_sub, v_st, v_mu
    FROM unnest(p_products, p_qtys) l(pid, qty)
    JOIN app.product p ON p.id = l.pid AND p.org_id = p_org,
    LATERAL app.store_line_amounts(l.qty, p.price_cents, p.taxable) a;
  IF v_sub + v_st + v_mu > 2000000000 THEN RAISE EXCEPTION 'amount_too_large' USING ERRCODE = '22023'; END IF;
  INSERT INTO app.sale (id, org_id, location_id, channel, member_id, status, subtotal_cents, ivu_state_cents,
                        ivu_municipal_cents, total_cents, payment_method, age_verified_by, created_by,
                        completed_by, completed_at)
  VALUES (v_id, p_org, p_location, p_channel, p_member, p_status, v_sub, v_st, v_mu, v_sub + v_st + v_mu,
          p_payment, p_age_verified_by, app.person_id(),
          CASE WHEN p_status = 'completed' THEN app.person_id() END,
          CASE WHEN p_status = 'completed' THEN now() END);
  INSERT INTO app.sale_line (org_id, sale_id, product_id, qty, unit_price_cents, taxable, age_restricted,
                             subtotal_cents, ivu_state_cents, ivu_municipal_cents, total_cents)
  SELECT p_org, v_id, p.id, l.qty, p.price_cents, p.taxable, p.age_restricted,
         a.subtotal_cents, a.ivu_state_cents, a.ivu_municipal_cents, a.total_cents
    FROM unnest(p_products, p_qtys) l(pid, qty)
    JOIN app.product p ON p.id = l.pid AND p.org_id = p_org,
    LATERAL app.store_line_amounts(l.qty, p.price_cents, p.taxable) a;
  RETURN v_id;
END $$;

-- Parse and validate a cart against the org's ACTIVE products. Returns parallel arrays and whether any line is
-- age-restricted. Unknown, inactive or other-org products → 22023 invalid_product (no cross-org oracle).
CREATE FUNCTION app.store_cart(p_org uuid, p_lines jsonb,
  OUT products uuid[], OUT qtys integer[], OUT restricted boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_found integer;
BEGIN
  SELECT array_agg(l.l_product ORDER BY l.l_product), array_agg(l.l_qty ORDER BY l.l_product)
    INTO products, qtys FROM app.store_parse_lines(p_lines) l;
  SELECT count(*), coalesce(bool_or(p.age_restricted), false) INTO v_found, restricted
    FROM app.product p WHERE p.org_id = p_org AND p.active AND p.id = ANY (products);
  IF v_found <> cardinality(products) THEN
    RAISE EXCEPTION 'invalid_product' USING ERRCODE = '22023';
  END IF;
END $$;

-- ── Request entry points (audited SECURITY DEFINER; each re-checks claims and location scope)

-- POS sale at a location, paid now. Sellers only, at their locations. Any age-restricted line requires
-- p_age_verified = true and records the caller's staff row as verifier [VERIFICAR · minimum age per state].
CREATE FUNCTION app.record_sale(p_location uuid, p_lines jsonb, p_payment app.store_payment_method,
                                p_member uuid, p_age_verified boolean) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
  v_staff uuid := app.store_caller_staff_id();
  v_cart record;
  v_sale uuid;
  v_verifier uuid;
BEGIN
  IF v_org IS NULL OR v_staff IS NULL OR NOT app.store_can_sell(p_location) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_payment IS NULL THEN RAISE EXCEPTION 'invalid_payment' USING ERRCODE = '22023'; END IF;
  IF p_member IS NOT NULL AND NOT app.staff_can_see_member(p_member) THEN
    RAISE EXCEPTION 'forbidden_member' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_cart FROM app.store_cart(v_org, p_lines);
  IF v_cart.restricted THEN
    IF p_age_verified IS NOT TRUE THEN
      RAISE EXCEPTION 'age_verification_required' USING ERRCODE = '22023';
    END IF;
    v_verifier := v_staff;
  END IF;

  PERFORM app.store_lock_available(v_org, p_location, v_cart.products, v_cart.qtys);
  v_sale := app.store_insert_sale(v_org, p_location, 'pos', p_member, 'completed', p_payment, v_verifier,
                                  v_cart.products, v_cart.qtys);
  UPDATE app.inventory_level i SET on_hand = i.on_hand - l.qty, updated_at = now()
    FROM unnest(v_cart.products, v_cart.qtys) l(pid, qty)
   WHERE i.org_id = v_org AND i.location_id = p_location AND i.product_id = l.pid;
  INSERT INTO app.stock_movement (org_id, product_id, location_id, kind, qty, ref, sale_id, by_person_id)
  SELECT v_org, l.pid, p_location, 'sale', -l.qty, 'POS', v_sale, app.person_id()
    FROM unnest(v_cart.products, v_cart.qtys) l(pid, qty);

  PERFORM app.audit('store.sale.record', 'sale', v_sale::text, p_location,
    (SELECT jsonb_build_object('total_cents', s.total_cents, 'channel', 'pos', 'payment_method', p_payment,
                               'age_verified_by', v_verifier, 'member_id', p_member)
       FROM app.sale s WHERE s.id = v_sale));
  RETURN v_sale;
END $$;

-- Online order for pickup, placed by the member for themself. Stock is reserved (not yet moved).
CREATE FUNCTION app.place_online_order(p_location uuid, p_lines jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
  v_member uuid;
  v_cart record;
  v_sale uuid;
BEGIN
  IF v_org IS NULL OR app.role() IS DISTINCT FROM 'member' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT m.id INTO v_member FROM app.member m
   WHERE m.org_id = v_org AND m.person_id = app.person_id() AND m.status <> 'cancelled';
  IF v_member IS NULL OR NOT app.store_location_in_org(p_location) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_cart FROM app.store_cart(v_org, p_lines);
  PERFORM app.store_lock_available(v_org, p_location, v_cart.products, v_cart.qtys);
  v_sale := app.store_insert_sale(v_org, p_location, 'online', v_member, 'pending_pickup', NULL, NULL,
                                  v_cart.products, v_cart.qtys);
  UPDATE app.inventory_level i SET reserved = i.reserved + l.qty, updated_at = now()
    FROM unnest(v_cart.products, v_cart.qtys) l(pid, qty)
   WHERE i.org_id = v_org AND i.location_id = p_location AND i.product_id = l.pid;
  PERFORM app.audit('store.order.place', 'sale', v_sale::text, p_location,
    (SELECT jsonb_build_object('total_cents', s.total_cents, 'channel', 'online', 'member_id', v_member)
       FROM app.sale s WHERE s.id = v_sale));
  RETURN v_sale;
END $$;

-- Lock a sale of the caller's org (or fail as forbidden without revealing whether it exists elsewhere).
CREATE FUNCTION app.store_lock_sale(p_sale uuid) RETURNS app.sale
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v app.sale;
BEGIN
  SELECT * INTO v FROM app.sale s WHERE s.id = p_sale AND s.org_id = app.org_id() FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  RETURN v;
END $$;

-- Front desk hands over an online order: payment now, ID check now for age-restricted lines, stock moves now.
CREATE FUNCTION app.complete_pickup(p_sale uuid, p_payment app.store_payment_method, p_age_verified boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
  v_staff uuid := app.store_caller_staff_id();
  v app.sale;
  v_products uuid[];
  v_qtys integer[];
  v_restricted boolean;
  v_verifier uuid;
BEGIN
  IF v_org IS NULL OR v_staff IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  v := app.store_lock_sale(p_sale);
  IF NOT app.store_can_sell(v.location_id) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF v.status <> 'pending_pickup' THEN RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023'; END IF;
  IF p_payment IS NULL THEN RAISE EXCEPTION 'invalid_payment' USING ERRCODE = '22023'; END IF;
  SELECT array_agg(sl.product_id ORDER BY sl.product_id), array_agg(sl.qty ORDER BY sl.product_id),
         bool_or(sl.age_restricted)
    INTO v_products, v_qtys, v_restricted FROM app.sale_line sl WHERE sl.sale_id = v.id;
  IF v_restricted THEN
    IF p_age_verified IS NOT TRUE THEN
      RAISE EXCEPTION 'age_verification_required' USING ERRCODE = '22023';
    END IF;
    v_verifier := v_staff;
  END IF;
  PERFORM 1 FROM app.inventory_level i
    WHERE i.org_id = v_org AND i.location_id = v.location_id AND i.product_id = ANY (v_products)
    ORDER BY i.product_id FOR UPDATE;
  UPDATE app.inventory_level i
     SET on_hand = i.on_hand - l.qty, reserved = i.reserved - l.qty, updated_at = now()
    FROM unnest(v_products, v_qtys) l(pid, qty)
   WHERE i.org_id = v_org AND i.location_id = v.location_id AND i.product_id = l.pid;
  INSERT INTO app.stock_movement (org_id, product_id, location_id, kind, qty, ref, sale_id, by_person_id)
  SELECT v_org, l.pid, v.location_id, 'sale', -l.qty, 'PICKUP', v.id, app.person_id()
    FROM unnest(v_products, v_qtys) l(pid, qty);
  UPDATE app.sale SET status = 'completed', payment_method = p_payment, age_verified_by = v_verifier,
                      completed_by = app.person_id(), completed_at = now()
   WHERE id = v.id;
  PERFORM app.audit('store.order.pickup', 'sale', v.id::text, v.location_id,
    jsonb_build_object('total_cents', v.total_cents, 'payment_method', p_payment, 'age_verified_by', v_verifier));
END $$;

-- Cancel an online order before pickup: the member who placed it, or a seller at the pickup location.
CREATE FUNCTION app.cancel_online_order(p_sale uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
  v app.sale;
BEGIN
  IF v_org IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  v := app.store_lock_sale(p_sale);
  IF NOT coalesce(app.store_can_sell(v.location_id)
          OR (app.role() = 'member' AND v.member_id = ANY (app.store_my_member_ids())), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v.status <> 'pending_pickup' THEN RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM app.inventory_level i
    WHERE i.org_id = v_org AND i.location_id = v.location_id
      AND i.product_id IN (SELECT sl.product_id FROM app.sale_line sl WHERE sl.sale_id = v.id)
    ORDER BY i.product_id FOR UPDATE;
  UPDATE app.inventory_level i SET reserved = i.reserved - sl.qty, updated_at = now()
    FROM app.sale_line sl
   WHERE sl.sale_id = v.id AND i.org_id = v_org AND i.location_id = v.location_id AND i.product_id = sl.product_id;
  UPDATE app.sale SET status = 'cancelled', cancelled_by = app.person_id(), cancelled_at = now() WHERE id = v.id;
  PERFORM app.audit('store.order.cancel', 'sale', v.id::text, v.location_id,
    jsonb_build_object('total_cents', v.total_cents));
END $$;

-- Full refund of a completed sale; every unit goes back to stock at the sale's location. Owner and the
-- location's manager only (front desk sells but does not refund) — [S] confirm with operations.
CREATE FUNCTION app.refund_sale(p_sale uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
  v app.sale;
BEGIN
  IF v_org IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  v := app.store_lock_sale(p_sale);
  IF NOT app.store_can_manage(v.location_id) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT app.store_text_ok(p_reason, 3, 200) THEN RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023'; END IF;
  IF v.status <> 'completed' THEN RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM app.inventory_level i
    WHERE i.org_id = v_org AND i.location_id = v.location_id
      AND i.product_id IN (SELECT sl.product_id FROM app.sale_line sl WHERE sl.sale_id = v.id)
    ORDER BY i.product_id FOR UPDATE;
  UPDATE app.inventory_level i SET on_hand = i.on_hand + sl.qty, updated_at = now()
    FROM app.sale_line sl
   WHERE sl.sale_id = v.id AND i.org_id = v_org AND i.location_id = v.location_id AND i.product_id = sl.product_id;
  INSERT INTO app.stock_movement (org_id, product_id, location_id, kind, qty, ref, sale_id, by_person_id)
  SELECT v_org, sl.product_id, v.location_id, 'return', sl.qty, 'REFUND', v.id, app.person_id()
    FROM app.sale_line sl WHERE sl.sale_id = v.id;
  UPDATE app.sale SET status = 'refunded', refunded_by = app.person_id(), refunded_at = now(),
                      refund_reason = btrim(p_reason)
   WHERE id = v.id;
  PERFORM app.audit('store.sale.refund', 'sale', v.id::text, v.location_id,
    jsonb_build_object('total_cents', v.total_cents, 'reason', btrim(p_reason)));
END $$;

-- Receive stock from a supplier at a location (owner / location manager there).
CREATE FUNCTION app.receive_stock(p_location uuid, p_product uuid, p_qty integer, p_ref text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
BEGIN
  IF v_org IS NULL OR NOT app.store_can_manage(p_location) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_qty IS NULL OR p_qty NOT BETWEEN 1 AND 100000 THEN RAISE EXCEPTION 'invalid_qty' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM app.product p WHERE p.id = p_product AND p.org_id = v_org) THEN
    RAISE EXCEPTION 'invalid_product' USING ERRCODE = '22023';
  END IF;
  INSERT INTO app.inventory_level AS i (org_id, product_id, location_id, on_hand)
  VALUES (v_org, p_product, p_location, p_qty)
  ON CONFLICT (org_id, product_id, location_id) DO UPDATE SET on_hand = i.on_hand + EXCLUDED.on_hand, updated_at = now();
  INSERT INTO app.stock_movement (org_id, product_id, location_id, kind, qty, ref, by_person_id)
  VALUES (v_org, p_product, p_location, 'receive', p_qty, coalesce(nullif(btrim(p_ref), ''), 'RECEIVE'), app.person_id());
  PERFORM app.audit('store.stock.receive', 'product', p_product::text, p_location,
                    jsonb_build_object('qty', p_qty, 'ref', p_ref));
END $$;

-- Manual correction (count, damage, expiry). Reason required; cannot go below what online orders reserved.
CREATE FUNCTION app.adjust_stock(p_location uuid, p_product uuid, p_delta integer, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
  v_level app.inventory_level;
BEGIN
  IF v_org IS NULL OR NOT app.store_can_manage(p_location) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_delta IS NULL OR p_delta = 0 OR abs(p_delta) > 100000 THEN
    RAISE EXCEPTION 'invalid_qty' USING ERRCODE = '22023';
  END IF;
  IF NOT app.store_text_ok(p_reason, 3, 200) THEN RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM app.product p WHERE p.id = p_product AND p.org_id = v_org) THEN
    RAISE EXCEPTION 'invalid_product' USING ERRCODE = '22023';
  END IF;
  INSERT INTO app.inventory_level (org_id, product_id, location_id) VALUES (v_org, p_product, p_location)
  ON CONFLICT (org_id, product_id, location_id) DO NOTHING;
  SELECT * INTO v_level FROM app.inventory_level i
   WHERE i.org_id = v_org AND i.location_id = p_location AND i.product_id = p_product FOR UPDATE;
  IF v_level.on_hand + p_delta < v_level.reserved THEN
    RAISE EXCEPTION 'insufficient_stock' USING ERRCODE = '23514';
  END IF;
  UPDATE app.inventory_level SET on_hand = on_hand + p_delta, updated_at = now() WHERE id = v_level.id;
  INSERT INTO app.stock_movement (org_id, product_id, location_id, kind, qty, reason, ref, by_person_id)
  VALUES (v_org, p_product, p_location, 'adjust', p_delta, btrim(p_reason), 'ADJUST', app.person_id());
  PERFORM app.audit('store.stock.adjust', 'product', p_product::text, p_location,
                    jsonb_build_object('delta', p_delta, 'reason', btrim(p_reason)));
END $$;

-- Move stock between two locations of the caller's org, atomically (transfer_out + transfer_in in one
-- transaction). The caller must manage the SOURCE location; the destination only has to be in the same org.
CREATE FUNCTION app.transfer_stock(p_from uuid, p_to uuid, p_lines jsonb, p_note text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
  v_products uuid[];
  v_qtys integer[];
  v_id uuid;
BEGIN
  IF v_org IS NULL OR NOT app.store_can_manage(p_from) OR NOT app.store_location_in_org(p_to) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_from = p_to THEN RAISE EXCEPTION 'same_location' USING ERRCODE = '22023'; END IF;
  IF p_note IS NOT NULL AND NOT app.store_text_ok(p_note, 0, 200) THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(l.l_product ORDER BY l.l_product), array_agg(l.l_qty ORDER BY l.l_product)
    INTO v_products, v_qtys FROM app.store_parse_lines(p_lines) l;
  IF (SELECT count(*) FROM app.product p WHERE p.org_id = v_org AND p.id = ANY (v_products))
     <> cardinality(v_products) THEN
    RAISE EXCEPTION 'invalid_product' USING ERRCODE = '22023';
  END IF;
  INSERT INTO app.inventory_level (org_id, product_id, location_id)
  SELECT v_org, pid, p_to FROM unnest(v_products) pid
  ON CONFLICT (org_id, product_id, location_id) DO NOTHING;
  -- One lock order for both ends (location, product) so opposite transfers cannot deadlock.
  PERFORM 1 FROM app.inventory_level i
    WHERE i.org_id = v_org AND i.location_id IN (p_from, p_to) AND i.product_id = ANY (v_products)
    ORDER BY i.location_id, i.product_id FOR UPDATE;
  PERFORM app.store_lock_available(v_org, p_from, v_products, v_qtys);

  INSERT INTO app.stock_transfer (org_id, from_location_id, to_location_id, note, created_by)
  VALUES (v_org, p_from, p_to, nullif(btrim(p_note), ''), app.person_id()) RETURNING id INTO v_id;
  INSERT INTO app.stock_transfer_line (org_id, transfer_id, product_id, qty)
  SELECT v_org, v_id, l.pid, l.qty FROM unnest(v_products, v_qtys) l(pid, qty);
  UPDATE app.inventory_level i SET on_hand = i.on_hand - l.qty, updated_at = now()
    FROM unnest(v_products, v_qtys) l(pid, qty)
   WHERE i.org_id = v_org AND i.location_id = p_from AND i.product_id = l.pid;
  UPDATE app.inventory_level i SET on_hand = i.on_hand + l.qty, updated_at = now()
    FROM unnest(v_products, v_qtys) l(pid, qty)
   WHERE i.org_id = v_org AND i.location_id = p_to AND i.product_id = l.pid;
  INSERT INTO app.stock_movement (org_id, product_id, location_id, kind, qty, ref, transfer_id, by_person_id)
  SELECT v_org, l.pid, p_from, 'transfer_out'::app.store_movement_kind, -l.qty, 'TRANSFER', v_id, app.person_id()
    FROM unnest(v_products, v_qtys) l(pid, qty)
  UNION ALL
  SELECT v_org, l.pid, p_to, 'transfer_in'::app.store_movement_kind, l.qty, 'TRANSFER', v_id, app.person_id()
    FROM unnest(v_products, v_qtys) l(pid, qty);
  PERFORM app.audit('store.stock.transfer', 'stock_transfer', v_id::text, p_from,
                    jsonb_build_object('to_location_id', p_to, 'units', (SELECT sum(q) FROM unnest(v_qtys) q)));
  RETURN v_id;
END $$;

-- Reorder point per (product, location), used by the low-stock list.
CREATE FUNCTION app.set_reorder_point(p_location uuid, p_product uuid, p_point integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
BEGIN
  IF v_org IS NULL OR NOT app.store_can_manage(p_location) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_point IS NULL OR p_point NOT BETWEEN 0 AND 100000 THEN RAISE EXCEPTION 'invalid_qty' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM app.product p WHERE p.id = p_product AND p.org_id = v_org) THEN
    RAISE EXCEPTION 'invalid_product' USING ERRCODE = '22023';
  END IF;
  INSERT INTO app.inventory_level AS i (org_id, product_id, location_id, reorder_point)
  VALUES (v_org, p_product, p_location, p_point)
  ON CONFLICT (org_id, product_id, location_id) DO UPDATE SET reorder_point = EXCLUDED.reorder_point, updated_at = now();
  PERFORM app.audit('store.stock.reorder_point', 'product', p_product::text, p_location,
                    jsonb_build_object('reorder_point', p_point));
END $$;

-- Online catalogue with sellable units at a pickup location: members/guardians (any location of their org)
-- and sellers (their locations). Members never read inventory_level directly.
CREATE FUNCTION app.store_catalogue(p_location uuid)
RETURNS TABLE (product_id uuid, sku text, name text, category app.store_category, age_restricted boolean,
               taxable boolean, price_cents integer, available integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
BEGIN
  IF v_org IS NULL OR NOT coalesce(
       (app.role() IN ('member', 'guardian') AND app.store_location_in_org(p_location))
       OR app.store_can_sell(p_location), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT p.id, p.sku, p.name, p.category, p.age_restricted, p.taxable, p.price_cents,
         greatest(coalesce(i.on_hand - i.reserved, 0), 0)
    FROM app.product p
    LEFT JOIN app.inventory_level i ON i.product_id = p.id AND i.location_id = p_location AND i.org_id = p.org_id
   WHERE p.org_id = v_org AND p.active
   ORDER BY p.category, p.name;
END $$;

-- Price a cart without writing anything (server-side IVU for the POS and the member cart). Runs as the
-- CALLER: only products the caller can read under RLS can be priced.
CREATE FUNCTION app.store_quote(p_lines jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = app, pg_temp AS $$
DECLARE
  v_org uuid := app.org_id();
  v_n integer;
  v jsonb;
BEGIN
  SELECT count(*) INTO v_n FROM app.store_parse_lines(p_lines);
  SELECT jsonb_build_object(
           'lines', coalesce(jsonb_agg(jsonb_build_object(
              'product_id', p.id, 'sku', p.sku, 'name', p.name, 'qty', l.l_qty, 'unit_price_cents', p.price_cents,
              'taxable', p.taxable, 'age_restricted', p.age_restricted, 'subtotal_cents', a.subtotal_cents,
              'ivu_state_cents', a.ivu_state_cents, 'ivu_municipal_cents', a.ivu_municipal_cents,
              'total_cents', a.total_cents) ORDER BY p.name), '[]'::jsonb),
           'subtotal_cents', coalesce(sum(a.subtotal_cents), 0),
           'ivu_state_cents', coalesce(sum(a.ivu_state_cents), 0),
           'ivu_municipal_cents', coalesce(sum(a.ivu_municipal_cents), 0),
           'total_cents', coalesce(sum(a.total_cents), 0),
           'age_restricted', coalesce(bool_or(p.age_restricted), false),
           'n', count(*))
    INTO v
    FROM app.store_parse_lines(p_lines) l
    JOIN app.product p ON p.id = l.l_product AND p.active AND p.org_id = v_org,
    LATERAL app.store_line_amounts(l.l_qty, p.price_cents, p.taxable) a;
  IF (v ->> 'n')::integer <> v_n THEN RAISE EXCEPTION 'invalid_product' USING ERRCODE = '22023'; END IF;
  RETURN v - 'n';
END $$;

-- Product catalogue writes are direct (policies + column grants); every insert and change is audited here.
CREATE FUNCTION app.store_product_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF app.org_id() IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM app.audit('store.product.create', 'product', NEW.id::text, NULL,
      jsonb_build_object('sku', NEW.sku, 'price_cents', NEW.price_cents, 'taxable', NEW.taxable,
                         'age_restricted', NEW.age_restricted, 'active', NEW.active));
  ELSE
    PERFORM app.audit('store.product.update', 'product', NEW.id::text, NULL, jsonb_strip_nulls(jsonb_build_object(
      'sku', NEW.sku,
      'price_cents', CASE WHEN NEW.price_cents IS DISTINCT FROM OLD.price_cents THEN NEW.price_cents END,
      'old_price_cents', CASE WHEN NEW.price_cents IS DISTINCT FROM OLD.price_cents THEN OLD.price_cents END,
      'taxable', CASE WHEN NEW.taxable IS DISTINCT FROM OLD.taxable THEN NEW.taxable END,
      'age_restricted', CASE WHEN NEW.age_restricted IS DISTINCT FROM OLD.age_restricted THEN NEW.age_restricted END,
      'active', CASE WHEN NEW.active IS DISTINCT FROM OLD.active THEN NEW.active END)));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER product_audit AFTER INSERT OR UPDATE ON app.product
  FOR EACH ROW EXECUTE FUNCTION app.store_product_audit();

-- ── RLS
ALTER TABLE app.product             ENABLE ROW LEVEL SECURITY; ALTER TABLE app.product             FORCE ROW LEVEL SECURITY;
ALTER TABLE app.inventory_level     ENABLE ROW LEVEL SECURITY; ALTER TABLE app.inventory_level     FORCE ROW LEVEL SECURITY;
ALTER TABLE app.sale                ENABLE ROW LEVEL SECURITY; ALTER TABLE app.sale                FORCE ROW LEVEL SECURITY;
ALTER TABLE app.sale_line           ENABLE ROW LEVEL SECURITY; ALTER TABLE app.sale_line           FORCE ROW LEVEL SECURITY;
ALTER TABLE app.stock_transfer      ENABLE ROW LEVEL SECURITY; ALTER TABLE app.stock_transfer      FORCE ROW LEVEL SECURITY;
ALTER TABLE app.stock_transfer_line ENABLE ROW LEVEL SECURITY; ALTER TABLE app.stock_transfer_line FORCE ROW LEVEL SECURITY;
ALTER TABLE app.stock_movement      ENABLE ROW LEVEL SECURITY; ALTER TABLE app.stock_movement      FORCE ROW LEVEL SECURITY;

-- app_definer reaches these rows through role-targeted policies (0005 ran before these tables existed).
CREATE POLICY definer_all ON app.product             TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.inventory_level     TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.sale                TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.sale_line           TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.stock_transfer      TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.stock_transfer_line TO app_definer USING (true) WITH CHECK (true);
CREATE POLICY definer_all ON app.stock_movement      TO app_definer USING (true) WITH CHECK (true);

-- product: front of house and the accountant read the whole catalogue; members and guardians read active
-- products (online catalogue). Owner and location managers create and edit (column grants below).
-- Trainers, nutrition, chef and clinical roles have no store access.
CREATE POLICY product_select ON app.product FOR SELECT USING (
  org_id = (SELECT app.org_id()) AND (
    (SELECT app.role()) IN ('owner', 'location_manager', 'front_desk', 'accountant')
    OR ((SELECT app.role()) IN ('member', 'guardian') AND active)));
CREATE POLICY product_insert ON app.product FOR INSERT WITH CHECK (
  org_id = (SELECT app.org_id()) AND (SELECT app.role()) IN ('owner', 'location_manager'));
CREATE POLICY product_update ON app.product FOR UPDATE
  USING (org_id = (SELECT app.org_id()) AND (SELECT app.role()) IN ('owner', 'location_manager'))
  WITH CHECK (org_id = (SELECT app.org_id()));

-- inventory_level: sellers of the location (owner: every location).
CREATE POLICY inventory_select ON app.inventory_level FOR SELECT USING (
  org_id = (SELECT app.org_id())
  AND (SELECT app.role()) IN ('owner', 'location_manager', 'front_desk')
  AND ((SELECT app.org_wide()) OR location_id = ANY ((SELECT app.location_ids())::uuid[])));

-- stock_movement and transfers: stock managers of the location (either end for transfers).
CREATE POLICY movement_select ON app.stock_movement FOR SELECT USING (
  org_id = (SELECT app.org_id())
  AND (SELECT app.role()) IN ('owner', 'location_manager')
  AND ((SELECT app.org_wide()) OR location_id = ANY ((SELECT app.location_ids())::uuid[])));
CREATE POLICY transfer_select ON app.stock_transfer FOR SELECT USING (
  org_id = (SELECT app.org_id())
  AND (SELECT app.role()) IN ('owner', 'location_manager')
  AND ((SELECT app.org_wide())
       OR from_location_id = ANY ((SELECT app.location_ids())::uuid[])
       OR to_location_id = ANY ((SELECT app.location_ids())::uuid[])));
CREATE POLICY transfer_line_select ON app.stock_transfer_line FOR SELECT USING (
  org_id = (SELECT app.org_id())
  AND EXISTS (SELECT 1 FROM app.stock_transfer t WHERE t.id = stock_transfer_line.transfer_id));

-- sale: sellers of the location, the accountant (read-only, org-wide), and members/guardians for their own
-- (or their ward's) purchases.
CREATE POLICY sale_select ON app.sale FOR SELECT USING (
  org_id = (SELECT app.org_id()) AND (
    ((SELECT app.role()) IN ('owner', 'location_manager', 'front_desk')
      AND ((SELECT app.org_wide()) OR location_id = ANY ((SELECT app.location_ids())::uuid[])))
    OR (SELECT app.role()) = 'accountant'
    OR (member_id IS NOT NULL AND member_id = ANY ((SELECT app.store_my_member_ids())::uuid[]))));
CREATE POLICY sale_line_select ON app.sale_line FOR SELECT USING (
  org_id = (SELECT app.org_id())
  AND EXISTS (SELECT 1 FROM app.sale s WHERE s.id = sale_line.sale_id));

-- ── Grants. Request traffic reads through RLS and writes products column by column; everything else is
--    written only by the definer functions above.
REVOKE ALL ON app.product, app.inventory_level, app.sale, app.sale_line, app.stock_transfer,
  app.stock_transfer_line, app.stock_movement FROM PUBLIC;
GRANT SELECT ON app.product, app.inventory_level, app.sale, app.sale_line, app.stock_transfer,
  app.stock_transfer_line, app.stock_movement TO app_authenticated;
GRANT INSERT (sku, name, category, age_restricted, taxable, price_cents, active) ON app.product TO app_authenticated;
GRANT UPDATE (name, category, age_restricted, taxable, price_cents, active) ON app.product TO app_authenticated;

GRANT SELECT ON app.product TO app_definer;
GRANT SELECT, INSERT, UPDATE ON app.inventory_level, app.sale TO app_definer;
GRANT SELECT, INSERT ON app.sale_line, app.stock_transfer, app.stock_transfer_line, app.stock_movement TO app_definer;

ALTER FUNCTION app.store_can_sell(uuid) OWNER TO app_definer;
ALTER FUNCTION app.store_can_manage(uuid) OWNER TO app_definer;
ALTER FUNCTION app.store_location_in_org(uuid) OWNER TO app_definer;
ALTER FUNCTION app.store_caller_staff_id() OWNER TO app_definer;
ALTER FUNCTION app.store_my_member_ids() OWNER TO app_definer;
ALTER FUNCTION app.store_lock_available(uuid, uuid, uuid[], integer[]) OWNER TO app_definer;
ALTER FUNCTION app.store_insert_sale(uuid, uuid, app.store_sale_channel, uuid, app.store_sale_status,
  app.store_payment_method, uuid, uuid[], integer[]) OWNER TO app_definer;
ALTER FUNCTION app.store_cart(uuid, jsonb) OWNER TO app_definer;
ALTER FUNCTION app.store_lock_sale(uuid) OWNER TO app_definer;
ALTER FUNCTION app.record_sale(uuid, jsonb, app.store_payment_method, uuid, boolean) OWNER TO app_definer;
ALTER FUNCTION app.place_online_order(uuid, jsonb) OWNER TO app_definer;
ALTER FUNCTION app.complete_pickup(uuid, app.store_payment_method, boolean) OWNER TO app_definer;
ALTER FUNCTION app.cancel_online_order(uuid) OWNER TO app_definer;
ALTER FUNCTION app.refund_sale(uuid, text) OWNER TO app_definer;
ALTER FUNCTION app.receive_stock(uuid, uuid, integer, text) OWNER TO app_definer;
ALTER FUNCTION app.adjust_stock(uuid, uuid, integer, text) OWNER TO app_definer;
ALTER FUNCTION app.transfer_stock(uuid, uuid, jsonb, text) OWNER TO app_definer;
ALTER FUNCTION app.set_reorder_point(uuid, uuid, integer) OWNER TO app_definer;
ALTER FUNCTION app.store_catalogue(uuid) OWNER TO app_definer;
ALTER FUNCTION app.store_product_audit() OWNER TO app_definer;

REVOKE ALL ON FUNCTION
  app.store_line_amounts(integer, integer, boolean), app.store_parse_lines(jsonb),
  app.store_text_ok(text, integer, integer), app.store_quote(jsonb),
  app.store_can_sell(uuid), app.store_can_manage(uuid), app.store_location_in_org(uuid),
  app.store_caller_staff_id(), app.store_my_member_ids(),
  app.store_lock_available(uuid, uuid, uuid[], integer[]),
  app.store_insert_sale(uuid, uuid, app.store_sale_channel, uuid, app.store_sale_status, app.store_payment_method,
                        uuid, uuid[], integer[]),
  app.store_cart(uuid, jsonb), app.store_lock_sale(uuid),
  app.record_sale(uuid, jsonb, app.store_payment_method, uuid, boolean), app.place_online_order(uuid, jsonb),
  app.complete_pickup(uuid, app.store_payment_method, boolean), app.cancel_online_order(uuid),
  app.refund_sale(uuid, text), app.receive_stock(uuid, uuid, integer, text),
  app.adjust_stock(uuid, uuid, integer, text), app.transfer_stock(uuid, uuid, jsonb, text),
  app.set_reorder_point(uuid, uuid, integer), app.store_catalogue(uuid), app.store_product_audit()
FROM PUBLIC;

-- Pure helpers and claim predicates used by policies and by the invoker-rights quote.
GRANT EXECUTE ON FUNCTION app.store_line_amounts(integer, integer, boolean), app.store_parse_lines(jsonb),
  app.store_text_ok(text, integer, integer), app.store_my_member_ids()
  TO app_authenticated, app_definer;
-- Entry points. The internal building blocks (store_lock_available, store_insert_sale, store_cart,
-- store_lock_sale, store_caller_staff_id) stay callable only by their owner, app_definer.
GRANT EXECUTE ON FUNCTION
  app.store_quote(jsonb), app.store_catalogue(uuid),
  app.store_can_sell(uuid), app.store_can_manage(uuid),
  app.record_sale(uuid, jsonb, app.store_payment_method, uuid, boolean), app.place_online_order(uuid, jsonb),
  app.complete_pickup(uuid, app.store_payment_method, boolean), app.cancel_online_order(uuid),
  app.refund_sale(uuid, text), app.receive_stock(uuid, uuid, integer, text),
  app.adjust_stock(uuid, uuid, integer, text), app.transfer_stock(uuid, uuid, jsonb, text),
  app.set_reorder_point(uuid, uuid, integer)
  TO app_authenticated;
