# Registro de compuertas — Nutrición

Puntos: 1 build/typecheck/lint · 2 pruebas (unidad, e2e, dorado) · 3 fallos simulados · 4 preview con prueba de humo ·
5 permisos · 6 costos · 7 cero bugs bloqueantes · 8 revisor independiente · 9 aprobación del dueño.

| Fase | Fecha | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | Notas |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 Inventario | 2026-11-08 | n/a | n/a | n/a | n/a | n/a | n/a | PASA | n/a | delegada | Sin código de producto |
| 1 Datos | 2026-11-08 | PASA | PASA (db 811; nutrition.test 21) | PASA (bloqueos, alérgenos, catálogo ausente, ítems inmutables) | PASA (migraciones aplicadas en BD de preview local como rol no superusuario) | PASA (RLS: recepción/chef/contable 0 filas; otra org 0; socio solo «enviado») | n/a (sin IA) | PASA | **FALLA** (5 revisiones; última: A1 alto, M1–M2 medios) | no aplica (parada dura) | Parada dura: escalado al dueño (ver STATE.md) |
| 2 Cálculos | 2026-11-08 | PASA | PASA (14 pruebas con valores de referencia calculados a mano) | n/a | n/a | n/a | n/a | PASA | **FALLA** (A1 alto, M3 medio en piso y ritmo) | no aplica (parada dura) | Parada dura: escalado al dueño |
