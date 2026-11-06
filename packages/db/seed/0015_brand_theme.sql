-- Demo org A wears the client's brand: Fitness R Us (logo and colours supplied by the client). Members, staff and
-- locations stay synthetic. Idempotent; lifts FORCE RLS only on the two tables it touches and restores it.
DO $brand$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.organization WHERE id = 'a0000000-0000-4000-8000-000000000001') THEN RETURN; END IF;
  ALTER TABLE app.organization NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.brand NO FORCE ROW LEVEL SECURITY;
  UPDATE app.organization SET name = 'Fitness R Us' WHERE id = 'a0000000-0000-4000-8000-000000000001';
  UPDATE app.brand SET name = 'Fitness R Us', theme = jsonb_build_object(
      'logo_url', '/brand/fitnessrus-logo.png',
      'icon_url', '/brand/fitnessrus-icon.png',
      'logo_alt', 'Fitness R Us',
      'colors', jsonb_build_object('accent', '#6D6128', 'accent_hover', '#544A1C', 'accent_text', '#FFFFFF',
                                   'header_bg', '#000000', 'header_text', '#FFFFFF', 'highlight', '#387333'),
      'tagline_es', 'Solo pagas tu sesión de entrenamiento',
      'tagline_en', 'You only pay for your training session')
   WHERE id = 'a0000000-0000-4000-8000-000000000003';
  ALTER TABLE app.organization FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.brand FORCE ROW LEVEL SECURITY;
END $brand$;
