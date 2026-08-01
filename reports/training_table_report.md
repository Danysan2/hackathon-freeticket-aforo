# Tabla de entrenamiento por ticket

- Julio: **6,722 tickets**, 32 eventos, objetivo `checked_in` completo.
- Agosto: **5,209 tickets**, 30 eventos, sin columna objetivo.
- Variables del modelo: **11 categóricas + 45 numéricas**.
- Validación futura: agrupar por `event_id`, nunca dividir tickets del mismo show entre train y test.

## Protección contra fuga

No entran como variables: `checked_in_at`, `checked_in_count`, `attendance_rate`, `date_used`, `last_used_at` ni tickets Boom posteriores al corte seguro.

## Identidad y acompañantes

Las características Boom son promedios ponderados por `model_history_weight`. La parte desconocida se suaviza hacia el promedio poblacional. Si una venta tiene `qty > 1`, la desviación del perfil del comprador se reduce por `1/qty` porque no conocemos a los acompañantes.

## Grupos de variables

- Ticket: tipo, precio y condición pagada/cortesía.
- Venta: cantidad, subtotal, canal y anticipación.
- Evento: artista, sede, horario, aforo y mezcla de tipos.
- Identidad: estado del match, candidatos, incertidumbre e historial Boom ponderado.
