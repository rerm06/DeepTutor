-- Demo seed for module floor (Sala, equipos y circuitos). Synthetic data only ("Demo"); idempotent.
-- Runs as the schema owner after the core demo seed. FORCE RLS is lifted only on this module's tables, only for the
-- duration of the seed, and restored at the end. References core demo UUIDs (packages/shared/src/demo.ts).
DO $seed$
DECLARE
  org_a constant uuid := 'a0000000-0000-4000-8000-000000000001';
  org_b constant uuid := 'b0000000-0000-4000-8000-000000000001';
  loc_a1 constant uuid := 'a0000000-0000-4000-8000-000000000011';
  loc_a2 constant uuid := 'a0000000-0000-4000-8000-000000000012';
  loc_b1 constant uuid := 'b0000000-0000-4000-8000-000000000011';
  ana_member constant uuid := 'a0000000-0000-4000-8000-000000000210';   -- Ana Rivera Demo (A1)
  ana_person constant uuid := 'a0000000-0000-4000-8000-000000000110';
  jose_member constant uuid := 'a0000000-0000-4000-8000-000000000215';  -- José Marrero Demo (A2)
  jose_person constant uuid := 'a0000000-0000-4000-8000-000000000115';
  front_a2_person constant uuid := 'a0000000-0000-4000-8000-000000000104'; -- Javier Colón (front desk A2)
  b_member constant uuid := 'b0000000-0000-4000-8000-000000000210';
  c_a1 uuid;
  c_a2 uuid;
  c_b1 uuid;
  run_a uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.organization WHERE id = org_a) THEN RETURN; END IF;  -- core demo seed absent
  IF EXISTS (SELECT 1 FROM app.exercise WHERE org_id = org_a) THEN RETURN; END IF;       -- already seeded

  ALTER TABLE app.asset NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.asset_issue NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.exercise NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.circuit NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.circuit_step NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.circuit_run NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.set_log NO FORCE ROW LEVEL SECURITY;

  -- Exercise library (org A): 22 exercises across all ten movement patterns. Technique cues only.
  INSERT INTO app.exercise (org_id, name, movement_pattern, equipment_type, cues)
  SELECT org_a, x.name, x.pattern::app.movement_pattern, x.equipment::app.equipment_type, x.cues
  FROM (VALUES
    ('Sentadilla con barra', 'squat', 'barbell', E'Pies al ancho de hombros.\nPecho arriba y rodillas siguiendo la punta del pie.'),
    ('Prensa de piernas', 'squat', 'leg_press', E'Espalda baja apoyada en el respaldo.\nNo bloquees las rodillas al extender.'),
    ('Sentadilla goblet', 'squat', 'kettlebell', E'Pesa pegada al pecho.\nBaja controlado entre las piernas.'),
    ('Sentadilla en Smith', 'squat', 'smith', E'Pies un poco adelante de la barra.\nBaja hasta donde mantengas la espalda neutra.'),
    ('Sentadilla al aire', 'squat', 'none', E'Brazos al frente para equilibrio.\nPeso en los talones.'),
    ('Peso muerto rumano', 'hinge', 'barbell', E'Barra cerca de las piernas.\nCadera atrás, espalda neutra.'),
    ('Swing con pesa rusa', 'hinge', 'kettlebell', E'El impulso sale de la cadera, no de los brazos.\nGlúteos firmes arriba.'),
    ('Puente de glúteos', 'hinge', 'none', E'Talones cerca de la cadera.\nSube sin arquear la espalda baja.'),
    ('Press de banca', 'push_horizontal', 'barbell', E'Escápulas juntas y pies firmes en el piso.\nBaja la barra a la parte media del pecho.'),
    ('Press de pecho en máquina', 'push_horizontal', 'chest_press', E'Ajusta el asiento: agarres a la altura del pecho.\nEmpuja sin despegar la espalda.'),
    ('Flexiones', 'push_horizontal', 'none', E'Cuerpo en línea recta.\nCodos a unos 45 grados del torso.'),
    ('Press militar con mancuernas', 'push_vertical', 'dumbbell', E'Abdomen firme.\nSube sin arquear la espalda.'),
    ('Jalón al pecho', 'pull_vertical', 'lat_pulldown', E'Lleva la barra a la parte alta del pecho.\nHombros lejos de las orejas.'),
    ('Dominadas asistidas', 'pull_vertical', 'bodyweight_station', E'Agarre un poco más ancho que los hombros.\nSube con control y baja lento.'),
    ('Remo sentado en máquina', 'pull_horizontal', 'row_machine', E'Pecho contra el apoyo.\nJunta las escápulas al final.'),
    ('Remo con polea baja', 'pull_horizontal', 'cable', E'Espalda neutra.\nCodos pegados al cuerpo.'),
    ('Remo con mancuerna', 'pull_horizontal', 'dumbbell', E'Mano libre apoyada.\nLleva el codo hacia la cadera.'),
    ('Zancadas con mancuernas', 'lunge', 'dumbbell', E'Paso largo.\nRodilla trasera cerca del piso sin tocarlo.'),
    ('Paseo del granjero', 'carry', 'dumbbell', E'Hombros atrás.\nPasos cortos y firmes.'),
    ('Plancha frontal', 'core', 'none', E'Codos bajo los hombros.\nAbdomen y glúteos firmes.'),
    ('Pallof en polea', 'core', 'cable', E'De lado a la polea.\nResiste la rotación al extender los brazos.'),
    ('Caminata en caminadora', 'cardio', 'treadmill', E'Ritmo en el que puedas conversar.\nUsa la parada de seguridad.'),
    ('Bicicleta estática', 'cardio', 'bike', E'Ajusta el asiento a la altura de la cadera.'),
    ('Remo ergómetro', 'cardio', 'rower', E'Piernas, luego tronco, luego brazos.\nRegresa en orden inverso.')
  ) AS x(name, pattern, equipment, cues);

  -- Equipment: 14 stations at San Juan (A1), 12 at Bayamón (A2). Codes are what the QR labels carry.
  INSERT INTO app.asset (org_id, location_id, equipment_type, brand, model, station_code, status, notes)
  SELECT org_a, x.loc, x.equipment::app.equipment_type, 'Demo Equipos', x.model, x.code,
         x.status::app.asset_status, x.notes
  FROM (VALUES
    (loc_a1, 'barbell', 'Barra olímpica 20 kg', 'A1-BAR-01', 'ok', NULL),
    (loc_a1, 'barbell', 'Barra olímpica 20 kg', 'A1-BAR-02', 'ok', NULL),
    (loc_a1, 'rack', 'Rack de potencia', 'A1-RACK-01', 'ok', NULL),
    (loc_a1, 'bench', 'Banco ajustable', 'A1-BN-01', 'ok', NULL),
    (loc_a1, 'dumbbell', 'Mancuernas 2-40 kg', 'A1-DB-01', 'ok', NULL),
    (loc_a1, 'kettlebell', 'Pesas rusas 8-24 kg', 'A1-KB-01', 'ok', NULL),
    (loc_a1, 'cable', 'Polea doble', 'A1-CB-01', 'ok', NULL),
    (loc_a1, 'leg_press', 'Prensa 45', 'A1-LP-01', 'ok', NULL),
    (loc_a1, 'chest_press', 'Press de pecho', 'A1-CP-01', 'ok', NULL),
    (loc_a1, 'lat_pulldown', 'Jalón', 'A1-LAT-01', 'ok', NULL),
    (loc_a1, 'row_machine', 'Remo sentado', 'A1-ROW-01', 'ok', NULL),
    (loc_a1, 'treadmill', 'Caminadora T1', 'A1-TM-01', 'maintenance', 'Demo: banda en revisión'),
    (loc_a1, 'treadmill', 'Caminadora T1', 'A1-TM-02', 'ok', NULL),
    (loc_a1, 'bike', 'Bicicleta B1', 'A1-BK-01', 'ok', NULL),
    (loc_a2, 'barbell', 'Barra olímpica 20 kg', 'A2-BAR-01', 'ok', NULL),
    (loc_a2, 'dumbbell', 'Mancuernas 2-30 kg', 'A2-DB-01', 'ok', NULL),
    (loc_a2, 'kettlebell', 'Pesas rusas 8-20 kg', 'A2-KB-01', 'ok', NULL),
    (loc_a2, 'cable', 'Polea simple', 'A2-CB-01', 'ok', NULL),
    (loc_a2, 'leg_press', 'Prensa 45', 'A2-LP-01', 'out_of_service', 'Demo: pasador del respaldo roto'),
    (loc_a2, 'smith', 'Smith', 'A2-SM-01', 'ok', NULL),
    (loc_a2, 'lat_pulldown', 'Jalón', 'A2-LAT-01', 'ok', NULL),
    (loc_a2, 'row_machine', 'Remo sentado', 'A2-ROW-01', 'ok', NULL),
    (loc_a2, 'bodyweight_station', 'Estación de dominadas', 'A2-BW-01', 'ok', NULL),
    (loc_a2, 'treadmill', 'Caminadora T1', 'A2-TM-01', 'ok', NULL),
    (loc_a2, 'bike', 'Bicicleta B1', 'A2-BK-01', 'ok', NULL),
    (loc_a2, 'rower', 'Remo de aire', 'A2-RW-01', 'ok', NULL)
  ) AS x(loc, equipment, model, code, status, notes);

  -- Issues: a confirmed out-of-service leg press at Bayamón, and a pending report at San Juan for the queue.
  INSERT INTO app.asset_issue (org_id, location_id, asset_id, reported_by, kind, status, note, reported_at,
                               confirmed_by, confirmed_at)
  SELECT org_a, loc_a2, a.id, jose_person, 'out_of_service', 'confirmed', 'Demo: el respaldo no traba',
         now() - interval '2 days', front_a2_person, now() - interval '2 days' + interval '1 hour'
    FROM app.asset a WHERE a.org_id = org_a AND a.station_code = 'A2-LP-01';
  INSERT INTO app.asset_issue (org_id, location_id, asset_id, reported_by, kind, note, reported_at)
  SELECT org_a, loc_a1, a.id, ana_person, 'out_of_service', 'Demo: el cable hace ruido', now() - interval '3 hours'
    FROM app.asset a WHERE a.org_id = org_a AND a.station_code = 'A1-CP-01';

  -- Circuits: one per location of org A. Steps use a concrete station or just an equipment type.
  INSERT INTO app.circuit (org_id, location_id, name) VALUES (org_a, loc_a1, 'Circuito Fuerza Total')
    RETURNING id INTO c_a1;
  INSERT INTO app.circuit (org_id, location_id, name) VALUES (org_a, loc_a2, 'Circuito Express 20')
    RETURNING id INTO c_a2;
  INSERT INTO app.circuit_step (org_id, circuit_id, location_id, position, exercise_id, asset_id, equipment_type,
                                sets, reps, rest_seconds)
  SELECT org_a, x.circuit, x.loc, x.pos, e.id, a.id, x.equipment::app.equipment_type, x.sets, x.reps, x.rest
  FROM (VALUES
    (c_a1, loc_a1, 1, 'Sentadilla con barra', 'A1-BAR-01', NULL, 3, 8, 90),
    (c_a1, loc_a1, 2, 'Press de pecho en máquina', 'A1-CP-01', NULL, 3, 10, 60),
    (c_a1, loc_a1, 3, 'Jalón al pecho', 'A1-LAT-01', NULL, 3, 10, 60),
    (c_a1, loc_a1, 4, 'Remo sentado en máquina', 'A1-ROW-01', NULL, 3, 12, 60),
    (c_a1, loc_a1, 5, 'Plancha frontal', NULL, 'none', 3, 30, 45),
    (c_a2, loc_a2, 1, 'Prensa de piernas', 'A2-LP-01', NULL, 3, 12, 60),
    (c_a2, loc_a2, 2, 'Swing con pesa rusa', NULL, 'kettlebell', 3, 15, 45),
    (c_a2, loc_a2, 3, 'Remo ergómetro', NULL, 'rower', 1, 20, 60),
    (c_a2, loc_a2, 4, 'Flexiones', NULL, 'none', 3, 12, 45)
  ) AS x(circuit, loc, pos, exercise, code, equipment, sets, reps, rest)
  JOIN app.exercise e ON e.org_id = org_a AND e.name = x.exercise
  LEFT JOIN app.asset a ON a.org_id = org_a AND a.station_code = x.code;

  -- Ana's finished run yesterday at San Juan, with her sets; José logged one set at Bayamón.
  INSERT INTO app.circuit_run (org_id, member_id, circuit_id, location_id, started_at, finished_at)
  VALUES (org_a, ana_member, c_a1, loc_a1, now() - interval '1 day', now() - interval '1 day' + interval '40 minutes')
  RETURNING id INTO run_a;
  INSERT INTO app.set_log (org_id, member_id, location_id, exercise_id, asset_id, circuit_run_id, reps, weight_kg, at)
  SELECT org_a, ana_member, loc_a1, e.id, a.id, run_a, x.reps, x.kg, now() - interval '1 day' + x.after
  FROM (VALUES
    ('Sentadilla con barra', 'A1-BAR-01', 8, 40.0, interval '5 minutes'),
    ('Sentadilla con barra', 'A1-BAR-01', 8, 42.5, interval '8 minutes'),
    ('Press de pecho en máquina', 'A1-CP-01', 10, 25.0, interval '15 minutes'),
    ('Jalón al pecho', 'A1-LAT-01', 10, 30.0, interval '22 minutes'),
    ('Remo sentado en máquina', 'A1-ROW-01', 12, 27.5, interval '30 minutes')
  ) AS x(exercise, code, reps, kg, after)
  JOIN app.exercise e ON e.org_id = org_a AND e.name = x.exercise
  JOIN app.asset a ON a.org_id = org_a AND a.station_code = x.code;
  INSERT INTO app.set_log (org_id, member_id, location_id, exercise_id, asset_id, reps, weight_kg, at)
  SELECT org_a, jose_member, loc_a2, e.id, a.id, 15, 16, now() - interval '2 days'
    FROM app.exercise e JOIN app.asset a ON a.org_id = org_a AND a.station_code = 'A2-KB-01'
   WHERE e.org_id = org_a AND e.name = 'Swing con pesa rusa';

  -- Org B (Demo Club Sur, Ponce): a small library, four stations and one circuit.
  IF EXISTS (SELECT 1 FROM app.organization WHERE id = org_b) THEN
    INSERT INTO app.exercise (org_id, name, movement_pattern, equipment_type, cues) VALUES
      (org_b, 'Sentadilla con barra', 'squat', 'barbell', E'Pies al ancho de hombros.\nPecho arriba.'),
      (org_b, 'Prensa de piernas', 'squat', 'leg_press', 'No bloquees las rodillas.'),
      (org_b, 'Remo con mancuerna', 'pull_horizontal', 'dumbbell', 'Lleva el codo hacia la cadera.'),
      (org_b, 'Caminata en caminadora', 'cardio', 'treadmill', 'Ritmo cómodo.');
    INSERT INTO app.asset (org_id, location_id, equipment_type, brand, model, station_code) VALUES
      (org_b, loc_b1, 'barbell', 'Demo Equipos', 'Barra 20 kg', 'B1-BAR-01'),
      (org_b, loc_b1, 'dumbbell', 'Demo Equipos', 'Mancuernas', 'B1-DB-01'),
      (org_b, loc_b1, 'leg_press', 'Demo Equipos', 'Prensa', 'B1-LP-01'),
      (org_b, loc_b1, 'treadmill', 'Demo Equipos', 'Caminadora', 'B1-TM-01');
    INSERT INTO app.circuit (org_id, location_id, name) VALUES (org_b, loc_b1, 'Circuito Sur Base')
      RETURNING id INTO c_b1;
    INSERT INTO app.circuit_step (org_id, circuit_id, location_id, position, exercise_id, asset_id, equipment_type,
                                  sets, reps, rest_seconds)
    SELECT org_b, c_b1, loc_b1, x.pos, e.id, a.id, NULL, 3, 10, 60
      FROM (VALUES (1, 'Sentadilla con barra', 'B1-BAR-01'), (2, 'Remo con mancuerna', 'B1-DB-01')) AS x(pos, exercise, code)
      JOIN app.exercise e ON e.org_id = org_b AND e.name = x.exercise
      JOIN app.asset a ON a.org_id = org_b AND a.station_code = x.code;
    IF EXISTS (SELECT 1 FROM app.member WHERE id = b_member) THEN
      INSERT INTO app.set_log (org_id, member_id, location_id, exercise_id, asset_id, reps, weight_kg, at)
      SELECT org_b, b_member, loc_b1, e.id, a.id, 10, 50, now() - interval '1 day'
        FROM app.exercise e JOIN app.asset a ON a.org_id = org_b AND a.station_code = 'B1-LP-01'
       WHERE e.org_id = org_b AND e.name = 'Prensa de piernas';
    END IF;
  END IF;

  ALTER TABLE app.asset FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.asset_issue FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.exercise FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.circuit FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.circuit_step FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.circuit_run FORCE ROW LEVEL SECURITY;
  ALTER TABLE app.set_log FORCE ROW LEVEL SECURITY;
END $seed$;
