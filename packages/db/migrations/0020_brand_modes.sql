-- A brand may set the console's default colour mode ("light" | "dark"); people can still switch on their device.
-- Colours stay governed by app.theme_colors_ok (0015): the dark-mode accent pair (accent_dark, accent_dark_text)
-- is just two more #RRGGBB values; contrast is enforced in the web client (lib/brandTheme.ts) before use.
ALTER TABLE app.brand ADD CONSTRAINT brand_theme_mode CHECK (
  NOT (theme ? 'mode') OR (jsonb_typeof(theme -> 'mode') = 'string' AND theme ->> 'mode' IN ('light', 'dark'))
);
-- Home hero photo and AI-agent card image: same rule as the logo (own /brand/ assets only, no third-party URLs).
ALTER TABLE app.brand ADD CONSTRAINT brand_theme_images CHECK (
  (theme ->> 'hero_url' IS NULL OR theme ->> 'hero_url' ~ '^/brand/[a-z0-9@._-]{1,80}$')
  AND (theme ->> 'promo_url' IS NULL OR theme ->> 'promo_url' ~ '^/brand/[a-z0-9@._-]{1,80}$')
);
