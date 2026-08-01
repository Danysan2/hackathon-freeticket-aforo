# Reporte del cruce FreeTicket → Boom

- Ventas procesadas: **6,383**
- Matches aceptados: **3,951 (61.90%)**
- Confianza alta (≥ 0,90): **3,929**
- Matches probables (0,70–0,8999): **22**
- Sin match: **2,432**
- Usuarios Boom distintos conectados: **2,789**
- Recuperados por alias seguros: **17**
- Nuevos o sin evidencia de identidad: **2,362**
- Identidades ambiguas no resueltas: **70**

## Reglas

- Email exacto o con una sola edición conocida.
- Teléfono exacto o con dos dígitos intercambiados.
- El nombre resuelve contradicciones y debe corroborar contactos aislados.
- El nombre solo no produce match.
- Si los dos candidatos quedan demasiado cerca, el resultado es `SIN_MATCH`.
- No se usa asistencia pasada ni futura para decidir identidad.
- Los alias se aprenden como nombre+contacto desde matches directos ≥ 0,95.
- Los matches por alias reciben peso reducido para el modelo.

## Validación

| Check | Estado | Evidencia |
|---|---|---|
| una fila por venta | PASS | 6383 |
| sale_id único | PASS | 0 |
| todas las ventas cubiertas | PASS | 0 |
| usuarios existentes o SIN_MATCH | PASS | 0 |
| cero nulos | PASS | 0 |
| confianza válida | PASS | [0.0, 0.995] |
| SIN_MATCH tiene confianza cero | PASS | 0 |
| match supera umbral | PASS | 0.7 |
| diagnóstico uno a uno | PASS | 6383 |
| candidatos cubren todas las ventas | PASS | 0 |
| candidato único por venta y usuario | PASS | 0 |
| toda venta conserva SIN_MATCH | PASS | 6383 |
| probabilidades suman uno | PASS | 1.0000000000287557e-06 |
| pesos del modelo válidos | PASS | [0.0, 0.949789] |
| compradores no resueltos permanecen SIN_MATCH | PASS | 2432 |

## Limitaciones

- FreeTicket no trae ciudad del comprador; no se sustituye con la ciudad del evento.
- Una venta con varios tickets identifica al comprador, no a cada acompañante.
- Los casos sin evidencia suficiente quedan disponibles en `matches_review.csv`.
