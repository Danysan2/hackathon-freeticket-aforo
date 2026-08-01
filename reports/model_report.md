# Comparación de modelos de asistencia

Modelo seleccionado: **catboost**

Criterio principal: menor MAE de asistentes por evento en predicciones fuera de muestra agrupadas por `event_id`.

| Rank | Modelo | MAE evento | RMSE evento | WAPE evento | Brier ticket | Log-loss | AUC |
|---:|---|---:|---:|---:|---:|---:|---:|
| 1 | catboost | 6.243 | 9.205 | 4.020% | 0.1201 | 0.3817 | 0.8551 |
| 2 | xgboost | 7.233 | 10.982 | 4.658% | 0.1218 | 0.3875 | 0.8459 |
| 3 | ticket_type_baseline | 7.869 | 11.017 | 5.068% | 0.1224 | 0.3880 | 0.8213 |
| 4 | logistic_regression | 9.277 | 15.314 | 5.974% | 0.1215 | 0.3879 | 0.8516 |

## Interpretación

Las probabilidades se suman por evento para obtener `expected_attendance`. El rango p10–p90 se construye con la distribución de errores por evento observada en validación cruzada, centrada en cero y limitada entre 0 y los tickets adquiridos.
El ganador superó a xgboost en **19 de 32 eventos**. La diferencia media de MAE ganador−segundo fue -0.990; bootstrap 95 % [-1.891, -0.102].

## Variables con mayor influencia del ganador

- `sale_unit_value`: 23.3311
- `sale_subtotal`: 14.8574
- `ticket_price_to_event_average`: 13.7822
- `ticket_is_courtesy`: 10.3491
- `ticket_price`: 9.8139
- `ticket_is_paid`: 9.5750
- `boom_tickets_used_expected`: 2.0713
- `purchase_lead_hours`: 1.6838
- `event_residency_weekday`: 1.5666
- `purchase_lead_days`: 1.1799

## Limitaciones

- Solo hay 32 eventos históricos; no debe interpretarse una diferencia pequeña como una verdad permanente.
- La proyección corresponde a los tickets adquiridos al corte y no anticipa ventas nuevas.
- Los rangos deben recalibrarse cuando haya varios meses adicionales.
