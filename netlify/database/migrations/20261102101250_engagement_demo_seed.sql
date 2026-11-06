-- DEMO seed for module engagement (spec §9). Synthetic data only ("Demo", @demo.invalid). Runs as the schema owner
-- after the core demo seed; uses its UUIDs (packages/shared/src/demo.ts, packages/db/seed/demo.sql).
-- Idempotent: does nothing when the demo org is missing or this module was already seeded. FORCE RLS is lifted only
-- on this module's tables for the duration of the seed and restored at the end.
-- Module UUID namespace: ...-8012-... (org A: a0000000-…, org B: b0000000-…).
DO $seed$
DECLARE
  oa constant uuid := 'a0000000-0000-4000-8000-000000000001';
  ob constant uuid := 'b0000000-0000-4000-8000-000000000001';
  la1 constant uuid := 'a0000000-0000-4000-8000-000000000011';
  la2 constant uuid := 'a0000000-0000-4000-8000-000000000012';
  lb1 constant uuid := 'b0000000-0000-4000-8000-000000000011';
  a_owner constant uuid := 'a0000000-0000-4000-8000-000000000101';
  a_front constant uuid := 'a0000000-0000-4000-8000-000000000103';
  b_owner constant uuid := 'b0000000-0000-4000-8000-000000000101';
  b_front constant uuid := 'b0000000-0000-4000-8000-000000000103';
  ana constant uuid := 'a0000000-0000-4000-8000-000000000210';
  pedro constant uuid := 'a0000000-0000-4000-8000-000000000211';
  sofia constant uuid := 'a0000000-0000-4000-8000-000000000212';
  jose constant uuid := 'a0000000-0000-4000-8000-000000000215';
  andres constant uuid := 'a0000000-0000-4000-8000-000000000217';
  diego constant uuid := 'a0000000-0000-4000-8000-000000000230';  -- minor (guardian link)
  isabel constant uuid := 'b0000000-0000-4000-8000-000000000210';
  tomas constant uuid := 'b0000000-0000-4000-8000-000000000211';
  -- module rows
  rw_shake constant uuid := 'a0000000-0000-4000-8012-000000000101';
  rw_towel constant uuid := 'a0000000-0000-4000-8012-000000000102';
  rw_shirt constant uuid := 'a0000000-0000-4000-8012-000000000103';
  rw_suppl constant uuid := 'a0000000-0000-4000-8012-000000000104';
  rw_guest constant uuid := 'a0000000-0000-4000-8012-000000000105';
  rw_b constant uuid := 'b0000000-0000-4000-8012-000000000101';
  rd_ana constant uuid := 'a0000000-0000-4000-8012-000000000201';
  rd_pedro constant uuid := 'a0000000-0000-4000-8012-000000000202';
  ch_nov constant uuid := 'a0000000-0000-4000-8012-000000000301';
  ch_team constant uuid := 'a0000000-0000-4000-8012-000000000302';
  ch_loc constant uuid := 'a0000000-0000-4000-8012-000000000303';
  ch_b constant uuid := 'b0000000-0000-4000-8012-000000000301';
  tm_red constant uuid := 'a0000000-0000-4000-8012-000000000311';
  tm_blue constant uuid := 'a0000000-0000-4000-8012-000000000312';
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.organization WHERE id = oa)
     OR EXISTS (SELECT 1 FROM app.points_rule WHERE org_id = oa) THEN
    RETURN;
  END IF;
  FOREACH t IN ARRAY ARRAY['points_rule', 'points_ledger', 'reward', 'redemption', 'challenge', 'challenge_team',
                           'challenge_participant', 'referral', 'achievement', 'community_post'] LOOP
    EXECUTE format('ALTER TABLE app.%I NO FORCE ROW LEVEL SECURITY', t);
  END LOOP;

  -- ── Rules (both orgs)
  INSERT INTO app.points_rule (org_id, event, points, active) VALUES
    (oa, 'visit', 10, true), (oa, 'class', 15, true), (oa, 'purchase', 5, true),
    (oa, 'challenge_goal', 100, true), (oa, 'referral', 200, true), (oa, 'comeback_bonus', 50, true),
    (ob, 'visit', 10, true), (ob, 'class', 10, true), (ob, 'purchase', 5, false),
    (ob, 'challenge_goal', 75, true), (ob, 'referral', 150, true), (ob, 'comeback_bonus', 40, true);

  -- ── Rewards (no cash, raffles or sweepstakes)
  INSERT INTO app.reward (id, org_id, name, description, points_cost, restricted_for_minors) VALUES
    (rw_shake, oa, 'Batido Demo', 'Un batido de frutas en la barra de la sede.', 150, false),
    (rw_towel, oa, 'Toalla Demo', 'Toalla de microfibra con el logo.', 300, false),
    (rw_shirt, oa, 'Camiseta Demo', 'Camiseta de entrenamiento, tallas S a XL.', 500, false),
    (rw_suppl, oa, 'Suplemento Demo', 'Proteína en polvo, envase pequeño. Solo adultos.', 400, true),
    (rw_guest, oa, 'Pase de invitado Demo', 'Un día gratis para un amigo.', 200, false),
    (rw_b, ob, 'Botella Demo', 'Botella de agua reutilizable.', 200, false);

  -- ── Ledger: Ana visits every week for five weeks (weekly streak 5), Pedro irregular, José at Bayamón, Isabel in B
  INSERT INTO app.points_ledger (org_id, member_id, delta, reason, ref, note, location_id, created_by, at) VALUES
    (oa, ana, 200, 'manual', NULL, 'Demo: bono de bienvenida', la1, a_front, now() - interval '40 days'),
    (oa, ana, 10, 'visit', NULL, NULL, la1, a_front, now() - interval '28 days'),
    (oa, ana, 10, 'visit', NULL, NULL, la1, a_front, now() - interval '21 days'),
    (oa, ana, 15, 'class', 'demo-class-1001', NULL, la1, a_front, now() - interval '21 days'),
    (oa, ana, 10, 'visit', NULL, NULL, la1, a_front, now() - interval '14 days'),
    (oa, ana, 10, 'visit', NULL, NULL, la1, a_front, now() - interval '7 days'),
    (oa, ana, 15, 'class', 'demo-class-1002', NULL, la1, a_front, now() - interval '7 days'),
    (oa, ana, 10, 'visit', NULL, NULL, la1, a_front, now() - interval '1 hour'),
    (oa, ana, -150, 'redemption', rd_ana::text, NULL, la1, a_front, now() - interval '2 days'),
    (oa, pedro, 10, 'visit', NULL, NULL, la1, a_front, now() - interval '30 days'),
    (oa, pedro, 10, 'visit', NULL, NULL, la1, a_front, now() - interval '3 days'),
    (oa, pedro, 50, 'comeback_bonus', 'comeback:demo', NULL, la1, a_front, now() - interval '3 days'),
    (oa, pedro, 300, 'manual', NULL, 'Demo: ayuda en el evento de la comunidad', la1, a_front, now() - interval '20 days'),
    (oa, pedro, -300, 'redemption', rd_pedro::text, NULL, la1, a_front, now() - interval '10 days'),
    (oa, sofia, 10, 'visit', NULL, NULL, la1, a_front, now() - interval '2 days'),
    (oa, jose, 10, 'visit', NULL, NULL, la2, a_owner, now() - interval '5 days'),
    (oa, jose, 15, 'class', 'demo-class-2001', NULL, la2, a_owner, now() - interval '5 days'),
    (oa, diego, 10, 'visit', NULL, NULL, la1, a_front, now() - interval '4 days'),
    (ob, isabel, 10, 'visit', NULL, NULL, lb1, b_front, now() - interval '6 days'),
    (ob, isabel, 10, 'class', 'demo-b-class-1', NULL, lb1, b_front, now() - interval '6 days');

  INSERT INTO app.redemption (id, org_id, member_id, reward_id, points, status, requested_by, handled_by, handled_at, created_at) VALUES
    (rd_ana, oa, ana, rw_shake, 150, 'requested', 'a0000000-0000-4000-8000-000000000110', NULL, NULL, now() - interval '2 days'),
    (rd_pedro, oa, pedro, rw_towel, 300, 'fulfilled', a_front, a_front, now() - interval '9 days', now() - interval '10 days');

  -- ── Challenges: opt-in leaderboards (default off), weekly-friendly goals
  INSERT INTO app.challenge (id, org_id, name, kind, metric, location_id, starts_on, ends_on, goal, leaderboard_opt_in_default, created_by) VALUES
    (ch_nov, oa, 'Reto de visitas Demo', 'individual', 'visits', NULL, current_date - 7, current_date + 23, 12, false, a_owner),
    (ch_team, oa, 'Equipos de clases Demo', 'team', 'classes', la1, current_date - 7, current_date + 23, 30, false, a_owner),
    (ch_loc, oa, 'Sedes en movimiento Demo', 'location', 'points', NULL, current_date - 7, current_date + 23, 1000, false, a_owner),
    (ch_b, ob, 'Reto Sur Demo', 'individual', 'visits', NULL, current_date - 7, current_date + 23, 8, false, b_owner);
  INSERT INTO app.challenge_team (id, org_id, challenge_id, name) VALUES
    (tm_red, oa, ch_team, 'Rojo Demo'), (tm_blue, oa, ch_team, 'Azul Demo');
  INSERT INTO app.challenge_participant (org_id, challenge_id, member_id, team_id, show_on_leaderboard, compare_mode, progress) VALUES
    (oa, ch_nov, ana, NULL, true, 'ranked', 2),
    (oa, ch_nov, pedro, NULL, true, 'ranked', 1),
    (oa, ch_nov, sofia, NULL, false, 'self', 1),
    (oa, ch_nov, diego, NULL, false, 'self', 1),
    (oa, ch_team, ana, tm_red, true, 'ranked', 1),
    (oa, ch_team, pedro, tm_blue, true, 'ranked', 0),
    (oa, ch_loc, ana, NULL, true, 'ranked', 25),
    (oa, ch_loc, jose, NULL, true, 'ranked', 25),
    (oa, ch_loc, andres, NULL, false, 'self', 0),
    (ob, ch_b, isabel, NULL, true, 'ranked', 1),
    (ob, ch_b, tomas, NULL, false, 'self', 0);

  -- ── Referrals: nothing is ever sent; front desk credits once the invitee is an active member
  INSERT INTO app.referral (org_id, referrer_member_id, referred_email, status, created_at) VALUES
    (oa, ana, 'amiga.demo@demo.invalid', 'pending', now() - interval '6 days'),
    (oa, pedro, 'vecino.demo@demo.invalid', 'pending', now() - interval '1 day'),
    (ob, isabel, 'prima.demo@demo.invalid', 'pending', now() - interval '3 days');

  INSERT INTO app.achievement (org_id, member_id, code, ref, earned_at) VALUES
    (oa, ana, 'first_visit', NULL, now() - interval '28 days'),
    (oa, ana, 'streak_4', NULL, now() - interval '7 days'),
    (oa, pedro, 'first_visit', NULL, now() - interval '30 days'),
    (oa, pedro, 'comeback', 'demo', now() - interval '3 days'),
    (ob, isabel, 'first_visit', NULL, now() - interval '6 days');

  -- ── Wall: approved posts are public to members; pending ones only to the author and moderators
  INSERT INTO app.community_post (org_id, author_member_id, location_id, author_label, body, status, moderated_by, moderated_at, created_at) VALUES
    (oa, ana, la1, 'Ana R.', '¡Cinco semanas seguidas! Gracias al grupo de las 6 a. m. por la motivación.', 'approved', a_front, now() - interval '1 day', now() - interval '1 day'),
    (oa, pedro, la1, 'Pedro M.', 'Volví después de un mes. Poco a poco, sin prisa.', 'approved', a_front, now() - interval '3 days', now() - interval '3 days'),
    (oa, sofia, la1, 'Sofía D.', '¿Alguien para la clase de yoga del sábado?', 'pending', NULL, NULL, now() - interval '2 hours'),
    (oa, jose, la2, 'José M.', 'La sede de Bayamón tiene nueva música en spinning.', 'pending', NULL, NULL, now() - interval '5 hours'),
    (ob, isabel, lb1, 'Isabel R.', 'Primera semana completa en el club.', 'approved', b_front, now() - interval '5 days', now() - interval '5 days');

  FOREACH t IN ARRAY ARRAY['points_rule', 'points_ledger', 'reward', 'redemption', 'challenge', 'challenge_team',
                           'challenge_participant', 'referral', 'achievement', 'community_post'] LOOP
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END
$seed$;
