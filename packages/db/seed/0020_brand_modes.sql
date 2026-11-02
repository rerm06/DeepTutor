-- Demo org A (Fitness R Us) runs its console dark by default, with a bright gold for dark surfaces
-- (#D4A63E: 8.4:1 with #111111 text, 7.7:1 against the dark surface). Idempotent; lifts FORCE RLS only on brand.
DO $modes$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.brand WHERE id = 'a0000000-0000-4000-8000-000000000003') THEN RETURN; END IF;
  ALTER TABLE app.brand NO FORCE ROW LEVEL SECURITY;
  UPDATE app.brand
     SET theme = jsonb_set(theme || '{"mode":"dark"}'::jsonb, '{colors}',
                           coalesce(theme -> 'colors', '{}'::jsonb)
                             || '{"accent_dark":"#D4A63E","accent_dark_text":"#111111"}'::jsonb)
   WHERE id = 'a0000000-0000-4000-8000-000000000003';
  ALTER TABLE app.brand FORCE ROW LEVEL SECURITY;
END $modes$;
