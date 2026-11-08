-- PRODUCTION data (not demo): a starter exercise library for Fitness R Us, so a station scanned in Toa Baja always
-- offers at least one exercise for its equipment type. Idempotent (existing names are left as the owner edited
-- them); the owner and trainers can edit or deactivate every row in Sala → Ejercicios. Technique cues only, no
-- health claims. No equipment is created: the owner adds it and the station codes are generated then.
DO $prod$
DECLARE
  v_org constant uuid := 'f1000000-0000-4000-8000-000000000001';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.organization o WHERE o.id = v_org) THEN
    RETURN;
  END IF;
  ALTER TABLE app.exercise NO FORCE ROW LEVEL SECURITY;
  INSERT INTO app.exercise (org_id, name, movement_pattern, equipment_type, cues)
  SELECT v_org, x.name, x.pattern::app.movement_pattern, x.equipment::app.equipment_type, x.cues
    FROM (VALUES
      ('Sentadilla con barra', 'squat', 'barbell', 'Pies al ancho de hombros, espalda neutra, rodillas en la línea de los pies.'),
      ('Peso muerto rumano', 'hinge', 'barbell', 'Cadera hacia atrás, barra pegada a las piernas, espalda neutra.'),
      ('Press de banca', 'push_horizontal', 'bench', 'Escápulas juntas, pies firmes en el piso, bajar controlado al pecho.'),
      ('Remo con mancuerna', 'pull_horizontal', 'dumbbell', 'Espalda plana, codo pegado al cuerpo, subir hacia la cadera.'),
      ('Press de hombros con mancuernas', 'push_vertical', 'dumbbell', 'Abdomen firme, subir sin arquear la espalda baja.'),
      ('Sentadilla goblet', 'squat', 'kettlebell', 'Pesa al pecho, codos adentro, bajar con el torso erguido.'),
      ('Swing con pesa rusa', 'hinge', 'kettlebell', 'El movimiento sale de la cadera, brazos relajados.'),
      ('Jalón en polea', 'pull_vertical', 'cable', 'Pecho arriba, bajar la barra hacia la clavícula sin balancearse.'),
      ('Prensa de piernas', 'squat', 'leg_press', 'Espalda apoyada, no bloquear las rodillas al extender.'),
      ('Press de pecho en máquina', 'push_horizontal', 'chest_press', 'Ajustar el asiento a la altura del pecho, empujar sin bloquear codos.'),
      ('Jalón al pecho', 'pull_vertical', 'lat_pulldown', 'Muslos fijos bajo el soporte, bajar hacia el pecho con control.'),
      ('Remo en máquina', 'pull_horizontal', 'row_machine', 'Pecho contra el soporte, juntar escápulas al final.'),
      ('Caminata en caminadora', 'cardio', 'treadmill', 'Postura erguida, empezar a ritmo suave y subir de forma gradual.'),
      ('Bicicleta estacionaria', 'cardio', 'bike', 'Ajustar el asiento a la altura de la cadera, pedaleo constante.'),
      ('Remo ergómetro', 'cardio', 'rower', 'Piernas, luego tronco, luego brazos; regresar en orden inverso.'),
      ('Sentadilla en rack', 'squat', 'rack', 'Ajustar los topes de seguridad antes de empezar.'),
      ('Sentadilla en máquina Smith', 'squat', 'smith', 'Pies un poco al frente, bajar controlado.'),
      ('Fondos en estación', 'push_vertical', 'bodyweight_station', 'Hombros abajo, bajar solo hasta donde mantengas control.'),
      ('Flexiones', 'push_horizontal', 'none', 'Cuerpo en línea recta, manos bajo los hombros.'),
      ('Plancha', 'core', 'none', 'Codos bajo los hombros, cadera alineada, respirar normal.')
    ) AS x(name, pattern, equipment, cues)
  ON CONFLICT (org_id, name) DO NOTHING;
  ALTER TABLE app.exercise FORCE ROW LEVEL SECURITY;
END
$prod$;
