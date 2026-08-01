# Verificación de las tablas del modelo

Estado: **PASS**
Checks aprobados: **32/32**

| Check | Estado | Evidencia |
|---|---|---|
| filas de entrenamiento preservadas | PASS | 6722 |
| filas de scoring preservadas | PASS | 5209 |
| ticket_id train único | PASS | 0 |
| ticket_id score único | PASS | 0 |
| mismos tickets de julio | PASS | 0 |
| mismos tickets de agosto | PASS | 0 |
| objetivo solo en train | PASS | [True, False] |
| objetivo binario completo | PASS | {1: 4969, 0: 1753} |
| esquema train/score compatible | PASS | 64 |
| cero nulos | PASS | 0 |
| cero textos vacíos | PASS | 0 |
| columnas de fuga excluidas | PASS | [] |
| objetivo no figura como predictor | PASS | checked_in |
| 56 variables declaradas | PASS | 56 |
| variables declaradas existen | PASS | 0 |
| predictores numéricos válidos | PASS | 0 |
| probabilidades y pesos entre 0 y 1 | PASS | [0.0, 1.0] |
| tasas Boom entre 0 y 1 | PASS | [0.025372, 0.989148] |
| membresía esperada entre 0 y 1 | PASS | [0.006261, 0.971782] |
| cantidad de venta reconciliada | PASS | 0 |
| anticipación no negativa | PASS | 0.0 |
| cortesía + pagada = 1 | PASS | 0.0 |
| mezcla de tipos suma 1 | PASS | 1.000000000139778e-06 |
| aforo restante no negativo | PASS | 0.0 |
| peso de comprador atenuado por qty | PASS | 5.000000000143778e-07 |
| peso histórico atenuado por qty | PASS | 5.000000000143778e-07 |
| no resueltos conservan SIN_MATCH | PASS | 0 |
| resueltos tienen usuario Boom | PASS | 0 |
| julio solo en entrenamiento | PASS | {'JULIO': 6722} |
| agosto solo en scoring | PASS | {'AGOSTO': 5209} |
| conteo de tickets por evento train | PASS | 0 |
| conteo de tickets por evento score | PASS | 0 |
