-- A brand may set the console's default colour mode ("light" | "dark"); people can still switch on their device.
-- Colours stay governed by app.theme_colors_ok (0015): the dark-mode accent pair (accent_dark, accent_dark_text)
-- is just two more #RRGGBB values; contrast is enforced in the web client (lib/brandTheme.ts) before use.
ALTER TABLE app.brand ADD CONSTRAINT brand_theme_mode CHECK (
  NOT (theme ? 'mode') OR (jsonb_typeof(theme -> 'mode') = 'string' AND theme ->> 'mode' IN ('light', 'dark'))
);
