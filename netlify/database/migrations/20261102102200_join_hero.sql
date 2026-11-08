-- Public join page: also pass the brand's own hero photo (theme.hero_url, same /brand/ rule as the logo and as the
-- brand_theme_images CHECK from 0020), so the page needs no per-tenant hard-coding. 0018 is applied in production
-- and is never edited: the function is replaced here with its 0018 body plus that one key. Ownership, grants and
-- SECURITY DEFINER are preserved by CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION app_public.join_info(p_org uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'pg_temp'
AS $function$
DECLARE
  v_brand app.brand;
  v_theme jsonb;
  v_colors jsonb;
  v_locs jsonb;
  v_texts jsonb;
  v_recurring boolean;
  v_session_cents integer;
BEGIN
  IF p_org IS NULL THEN RETURN NULL; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'municipality', l.municipality,
                                               'brand_id', l.brand_id) ORDER BY l.name, l.id), '[]'::jsonb)
    INTO v_locs
    FROM app.location l JOIN app.join_location j ON j.location_id = l.id AND j.org_id = l.org_id
   WHERE l.org_id = p_org AND j.enabled;
  IF jsonb_array_length(v_locs) = 0 THEN RETURN NULL; END IF;

  -- Display brand: the oldest brand that owns an open location.
  SELECT b.* INTO v_brand FROM app.brand b
   WHERE b.org_id = p_org AND EXISTS (
     SELECT 1 FROM app.location l JOIN app.join_location j ON j.location_id = l.id AND j.enabled
      WHERE l.brand_id = b.id AND l.org_id = p_org)
   ORDER BY b.created_at, b.id LIMIT 1;

  -- Theme: only the keys the UI understands, re-validated here (defence in depth over brand_theme_safe).
  SELECT coalesce(jsonb_object_agg(c.key, c.value), '{}'::jsonb) INTO v_colors
    FROM jsonb_each(CASE WHEN jsonb_typeof(v_brand.theme -> 'colors') = 'object'
                         THEN v_brand.theme -> 'colors' ELSE '{}'::jsonb END) c
   WHERE c.key IN ('accent', 'accent_hover', 'accent_text', 'header_bg', 'header_text', 'highlight',
                   'accent_dark', 'accent_dark_text')
     AND jsonb_typeof(c.value) = 'string' AND c.value #>> '{}' ~ '^#[0-9A-Fa-f]{6}$';
  v_theme := jsonb_strip_nulls(jsonb_build_object(
    'logo_url', CASE WHEN v_brand.theme ->> 'logo_url' ~ '^/brand/[a-z0-9@._-]{1,80}$' THEN v_brand.theme ->> 'logo_url' END,
    'hero_url', CASE WHEN v_brand.theme ->> 'hero_url' ~ '^/brand/[a-z0-9@._-]{1,80}$' THEN v_brand.theme ->> 'hero_url' END,
    'logo_alt', CASE WHEN v_brand.theme ->> 'logo_alt' ~ '^[A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9 &''.-]{1,80}$' THEN v_brand.theme ->> 'logo_alt' END,
    'tagline_es', left(regexp_replace(v_brand.theme ->> 'tagline_es', '[[:cntrl:]<>{}]', '', 'g'), 120),
    'tagline_en', left(regexp_replace(v_brand.theme ->> 'tagline_en', '[[:cntrl:]<>{}]', '', 'g'), 120),
    'mode', CASE WHEN v_brand.theme ->> 'mode' IN ('light', 'dark') THEN v_brand.theme ->> 'mode' END,
    'colors', CASE WHEN v_colors = '{}'::jsonb THEN NULL ELSE v_colors END));

  SELECT coalesce(jsonb_agg(jsonb_build_object('kind', a.kind, 'version', a.version, 'locale', a.locale,
                                               'title', a.title, 'body', replace(a.body, '{brand}', v_brand.name))
                            ORDER BY a.kind, a.locale), '[]'::jsonb)
    INTO v_texts FROM app.agreement_text a WHERE a.is_current;

  -- Business model, read from the billing catalogue (never typed by a caller): pay-per-session when no recurring
  -- membership and no enrolment fee is on sale, and a single session is.
  SELECT EXISTS (SELECT 1 FROM app.price pr JOIN app.plan_product p ON p.id = pr.product_id AND p.org_id = pr.org_id
                  WHERE pr.org_id = p_org AND pr.active AND p.active
                    AND (pr.billing_interval <> 'none' OR p.kind = 'enrollment_fee'))
    INTO v_recurring;
  SELECT min(pr.amount_cents) INTO v_session_cents
    FROM app.price pr JOIN app.plan_product p ON p.id = pr.product_id AND p.org_id = pr.org_id
   WHERE pr.org_id = p_org AND pr.active AND p.active AND p.kind IN ('drop_in', 'day_pass');

  RETURN jsonb_build_object(
    'org_id', p_org,
    'org_name', (SELECT o.name FROM app.organization o WHERE o.id = p_org),
    'brand', jsonb_build_object('id', v_brand.id, 'name', v_brand.name, 'theme', v_theme),
    'locations', v_locs,
    'agreements', v_texts,
    'model', jsonb_build_object('pay_per_session', NOT v_recurring AND v_session_cents IS NOT NULL,
                                'session_from_cents', v_session_cents));
END $function$
;
