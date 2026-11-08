-- Demo org A (Fitness R Us) runs its console dark by default, with the olive gold of the client design for dark surfaces, plus the home hero and agent-card images
-- (#C3B444, sampled from the client's dashboard design: 8.9:1 with #111111 text, 8.3:1 on the dark surface). Idempotent; lifts FORCE RLS only on brand.
DO $modes$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.brand WHERE id = 'a0000000-0000-4000-8000-000000000003') THEN RETURN; END IF;
  ALTER TABLE app.brand NO FORCE ROW LEVEL SECURITY;
  UPDATE app.brand
     SET theme = jsonb_set(theme || '{"mode":"dark","hero_url":"/brand/fitnessrus-hero.jpg","promo_url":"/brand/fitnessrus-agent.jpg"}'::jsonb, '{colors}',
                           coalesce(theme -> 'colors', '{}'::jsonb)
                             || '{"accent_dark":"#C3B444","accent_dark_text":"#111111"}'::jsonb)
   WHERE id = 'a0000000-0000-4000-8000-000000000003';
  ALTER TABLE app.brand FORCE ROW LEVEL SECURITY;
END $modes$;
