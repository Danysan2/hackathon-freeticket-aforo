# Verificación del cruce FreeTicket → Boom

Estado: **PASS**
Checks aprobados: **21/21**

| Check | Estado | Evidencia |
|---|---|---|
| esquema contractual exacto | PASS | ['sale_id', 'boom_user_id', 'confidence'] |
| una fila por venta | PASS | 6383 |
| sale_id único | PASS | 0 |
| mismo conjunto de ventas | PASS | 0 |
| cero celdas vacías | PASS | 0 |
| confianza numérica 0..1 | PASS | [0.0, 0.995] |
| usuarios Boom válidos | PASS | 0 |
| SIN_MATCH con confianza cero | PASS | 0 |
| matches con confianza mínima | PASS | 0.8 |
| diagnóstico completo | PASS | 6383 |
| decisión coincide con salida | PASS | 0 |
| usuario coincide con diagnóstico | PASS | 0 |
| ningún match por nombre solamente | PASS | 0 |
| candidatos probabilísticos cubren ventas | PASS | 0 |
| probabilidades suman uno | PASS | 1.0000000000287557e-06 |
| toda venta conserva candidato SIN_MATCH | PASS | 6383 |
| pesos probabilísticos válidos | PASS | [0.0, 0.949789] |
| archivo de nuevos/no identificados coincide | PASS | 2432 |
| alias tienen peso reducido | PASS | 0.35 |
| peso probabilístico total de alias limitado | PASS | 0.33981300000000003 |
| identidades repetidas son consistentes | PASS | 0 |
