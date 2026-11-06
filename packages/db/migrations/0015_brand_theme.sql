-- White-label brand theme guard. brand.theme drives the UI (logo, colours, tagline), so only safe values are stored:
-- logos are served from the app's own /brand/ path (no third-party URLs → no tracking pixels or script vectors) and
-- colours are #RRGGBB. Contrast for text-on-accent is checked in the UI layer [P: WCAG 2.2 AA].
CREATE FUNCTION app.theme_colors_ok(p_colors jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_colors IS NULL
      OR (jsonb_typeof(p_colors) = 'object'
          AND NOT EXISTS (SELECT 1 FROM jsonb_each(p_colors) c
                          WHERE jsonb_typeof(c.value) <> 'string' OR c.value #>> '{}' !~ '^#[0-9A-Fa-f]{6}$'))
$$;

ALTER TABLE app.brand ADD CONSTRAINT brand_theme_safe CHECK (
  jsonb_typeof(theme) = 'object'
  AND (theme ->> 'logo_url' IS NULL OR theme ->> 'logo_url' ~ '^/brand/[a-z0-9@._-]{1,80}$')
  AND (theme ->> 'icon_url' IS NULL OR theme ->> 'icon_url' ~ '^/brand/[a-z0-9@._-]{1,80}$')
  AND app.theme_colors_ok(theme -> 'colors')
  AND coalesce(length(theme ->> 'tagline_es'), 0) <= 120
  AND coalesce(length(theme ->> 'tagline_en'), 0) <= 120
);
