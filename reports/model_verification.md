# Verificación de modelos y forecast

Estado: **PASS**
Checks aprobados: **22/22**

| Check | Estado | Evidencia |
|---|---|---|
| cuatro modelos comparados | PASS | ['catboost', 'xgboost', 'ticket_type_baseline', 'logistic_regression'] |
| ranks únicos 1..4 | PASS | [1, 2, 3, 4] |
| ranking sigue criterio declarado | PASS | ['catboost', 'xgboost', 'ticket_type_baseline', 'logistic_regression'] |
| ganador consistente en metadatos | PASS | ['catboost', 'catboost', 'catboost'] |
| OOF cubre todos los tickets | PASS | 6722 |
| OOF probabilidades completas | PASS | 0 |
| OOF probabilidades válidas | PASS | [0.0729148124914093, 0.9963877884574788] |
| OOF evento contiene 32 por modelo | PASS | {'catboost': 32, 'logistic_regression': 32, 'ticket_type_baseline': 32, 'xgboost': 32} |
| total real OOF reconciliado | PASS | 4969.0 |
| predicción OOF ticket/evento reconciliada | PASS | 0.0 |
| artefactos de los cuatro modelos existen | PASS | {'ticket_type_baseline.json': 224, 'logistic_regression.joblib': 11457, 'catboost.cbm': 71032, 'xgboost.joblib': 399276, 'environment.json': 166} |
| predicciones agosto cubren tickets | PASS | 5209 |
| predicciones agosto válidas | PASS | [0.0688597410639778, 0.9919967297629334] |
| modelo ganador serializado reproduce probabilidades | PASS | 1.1102230246251565e-16 |
| forecast contiene 30 eventos | PASS | 30 |
| contrato forecast exacto | PASS | ['event_id', 'expected_attendance', 'p10', 'p90'] |
| intervalos ordenados | PASS | 0 |
| forecast limitado a tickets adquiridos | PASS | [15.2, 0.0] |
| expected attendance suma probabilidades | PASS | 0.04881916029160038 |
| eventos train y score no se cruzan | PASS | 0 |
| folds cubren cada evento una vez | PASS | 32 |
| estabilidad compara 32 eventos | PASS | {'runner_up': 'xgboost', 'winner_better_events': 19, 'events_compared': 32, 'mean_mae_difference_winner_minus_runner': -0.9902743839072747, 'bootstrap_95_ci': [-1.8913444587987696, -0.10151424043194128]} |
