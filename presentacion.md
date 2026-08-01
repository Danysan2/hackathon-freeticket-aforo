# Presentación — calidad de datos FreeTicket y Boom

## Qué encontramos

Las dos plataformas hablan de las mismas personas, pero sus llaves no están listas para un `JOIN` directo. La limpieza resolvió formato; no inventó identidad.

### Nombres

- Venían en mayúsculas, minúsculas, sin tildes, con apellido primero, segundo apellido o inicial.
- Se estandarizaron en **MAYÚSCULAS** y se añadieron claves sin tildes y por tokens para comparar orden distinto.
- Una clave parecida no prueba que sean la misma persona: el resultado final necesita score de confianza.

### Emails

- Se encontraron mayúsculas, alias `+eventos`, y errores `gmial`, `hotmial` y `outlok`.
- Se corrigieron **338** dominios y se removieron **380** alias.
- Una letra faltante o el correo de la pareja no se puede corregir de forma determinista; se conserva para matching probabilístico.

### Teléfonos

- Había cinco formatos, prefijo `57`, espacios, guiones y vacíos.
- Se normalizaron **4589** valores al formato colombiano de 10 dígitos.
- Dos dígitos transpuestos o el teléfono de otra persona no se “arreglan” sin evidencia.

## Error temporal que puede alterar el modelo

El brief fija el corte en **1 de agosto de 2026**, pero Boom ya marca como usados **666 tickets posteriores**, pertenecientes a **634 usuarios**. La fecha más lejana es **2026-08-26T12:13:00+00:00**.

Ejemplo comprobable: `bm_tkt_0002608` fue creado el 27 de julio pero aparece usado el 26 de agosto. Al agregarse en `boom_profile.csv`, esa asistencia futura aumenta `tickets_used`, `use_rate` y `last_used_at`; el modelo podría aprender usando una respuesta que todavía no existía al momento del pronóstico.

### Decisión aplicada

- `raw/` queda intacto.
- `clean/boom_tickets.csv` marca `future_used_leak` y `eligible_for_training`.
- `model_ready/boom_tickets_history.csv` usa solamente tickets creados hasta el 1 de julio, una cohorte que ya maduró al corte según la ventana de 30 días del generador.
- `model_ready/boom_profile.csv` utiliza tasas recalculadas sobre esa historia segura.

### `false` no siempre significa que la persona faltó

Al reconstruir el estado del 1 de agosto, es correcto decir que un ticket futuro tenía `used=false`: hasta ese momento todavía no había sido utilizado. El problema aparece si el modelo interpreta ese valor como un resultado final de inasistencia.

| Pregunta al 1 de agosto | Respuesta para un ticket del 26 de agosto |
|---|---|
| ¿Ya fue utilizado? | `false` |
| ¿La persona finalmente asistirá? | `desconocido` |
| ¿Podemos clasificarla como no-show? | No |

Por eso se deben separar tres estados:

```text
used_as_of_cutoff = false
outcome_observed = false
final_used = null / desconocido
```

Ejemplo: si existen 100 tickets, 60 usados, 20 vencidos sin uso y 20 correspondientes a fechas futuras, calcular `60 / 100 = 60 %` trataría incorrectamente los 20 futuros como ausencias. Para entrenar se utilizan solamente los 80 resultados ya observados: `60 / 80 = 75 %`. Los 20 futuros quedan como casos pendientes para predecir.

En una pantalla operativa pueden mostrarse como “todavía no usados”. En el entrenamiento no deben entrar como ejemplos de inasistencia hasta que su resultado sea observable.

## Cómo leer cortesías y entradas pagadas en FreeTicket

`ft_events.csv` describe la función completa y `ft_tickets.csv` describe cada entrada. Por eso `is_paid=true` no significa que todas las entradas de esa función fueran pagadas: significa que la función admitió ventas.

En julio, las cuatro funciones de **Micrófono Suelto** se ven así:

| Fecha | Mezcla de entradas emitidas | Asistencia total |
|---|---:|---:|
| 7 de julio | 82 pagadas + 44 cortesías | 83 / 126 = 65,87 % |
| 14 de julio | 140 pagadas + 65 cortesías | 142 / 205 = 69,27 % |
| 21 de julio | 122 cortesías | 34 / 122 = 27,87 % |
| 28 de julio | 138 cortesías | 37 / 138 = 26,81 % |

Las dos primeras cifras no son la asistencia exclusiva de compradores. Al separar los tipos, los tickets pagados asistieron **71/82 = 86,59 %** y **128/140 = 91,43 %**, mientras las cortesías de esas mismas fechas asistieron **12/44 = 27,27 %** y **14/65 = 21,54 %**.

El modelo debe calcular variables por función como `paid_tickets`, `courtesy_tickets`, `courtesy_share` y las tasas históricas de asistencia de cada tipo. No debe promediar solamente por artista. El CSV permite saber cuántas entradas de precio cero se emitieron, pero no prueba si existía una cuota fija de sillas reservadas para regalos ni quién recibió cada cortesía.

## Cruce de compradores FreeTicket con usuarios Boom

El cruce usa únicamente identidad: email, teléfono y nombre normalizados. FreeTicket no contiene la ciudad del comprador, por lo que la ciudad del evento no se utiliza como sustituto. Un nombre por sí solo nunca crea un match.

Resultados sobre 6.383 ventas:

| Resultado | Ventas |
|---|---:|
| Match aceptado | 3.951 (61,90 %) |
| Confianza alta (≥ 0,90) | 3.929 |
| Match probable | 22 |
| Sin match | 2.432 |
| Nuevo o sin evidencia de identidad | 2.362 |
| Identidad existente pero ambigua | 70 |

Se encontraron 441 ventas donde el email exacto y el teléfono exacto apuntaban a usuarios Boom diferentes. El cruce directo resolvió 388 y el aprendizaje controlado de alias recuperó 17 casos adicionales. Las 36 restantes quedaron sin asignar. Esta abstención es intencional: inventar un usuario contaminaría sus variables históricas y la predicción.

Los alias se aprenden únicamente desde ventas con match directo ≥ 0,95 y nombre fuerte, usando la combinación `nombre + email` o `nombre + teléfono`; un contacto nunca se propaga globalmente porque puede pertenecer a una pareja o familiar.

La salida contractual es `matches.csv` con `sale_id, boom_user_id, confidence`. `match_candidates.csv` conserva todos los candidatos y una probabilidad relativa, siempre incluyendo `SIN_MATCH`. Los matches recuperados por alias tienen un peso máximo de 0,35 para incorporar su historial Boom sin darle la misma influencia que a una identidad directa. `new_or_unmatched_buyers.csv` guarda los casos como `NEW_OR_UNKNOWN` o `UNRESOLVED_IDENTITY`, siempre con `boom_user_id=SIN_MATCH`.

## Tabla de entrenamiento por ticket

Cada fila representa una entrada individual. Julio aporta **6.722 tickets etiquetados** de 32 eventos y agosto aporta **5.209 tickets** de 30 eventos para predecir. Ambos archivos comparten las mismas 56 variables; únicamente julio contiene el objetivo `checked_in`.

Las variables se organizan en cuatro grupos:

- Ticket: tipo, precio y condición pagada/cortesía.
- Venta: cantidad, subtotal, canal y horas de anticipación.
- Evento: artista, sede, horario, aforo y mezcla General/Preferencial/VIP/Cortesía.
- Identidad: estado del match, incertidumbre e historial Boom ponderado.

Cuando una venta contiene varios tickets, el historial Boom corresponde al comprador, no necesariamente a sus acompañantes. Por eso su influencia por ticket se divide entre `qty`. La parte de identidad desconocida se reemplaza por el promedio seguro de la población, y se conserva un peso explícito para que el modelo distinga evidencia fuerte de una imputación.

No se incluyen como predictores `checked_in_at`, `checked_in_count`, `attendance_rate`, `date_used`, `last_used_at` ni variables Boom posteriores al corte. La validación debe separar eventos completos usando `event_id`; tickets del mismo show nunca pueden quedar simultáneamente en entrenamiento y prueba.

## Nulos: qué se eliminó y qué no

- Filas sin llave primaria, referencias válidas o casi ninguna señal de identidad se eliminan y quedan en cuarentena.
- Vacíos legítimos se convierten en estados explícitos: `NO_APLICA`, `NO_OBSERVADO`, `SIN_DATO`.
- Los check-ins de agosto **no se imputan**: son el objetivo del modelo. En scoring, la columna se retira.

## Entrenamiento y selección del modelo

Se compararon cuatro enfoques sobre los **6.722 tickets de julio**. La validación se hizo en 5 particiones separando funciones completas por `event_id`: todos los tickets de un show quedan juntos en entrenamiento o en validación, nunca en ambos.

El criterio principal es el **MAE por evento**, es decir, cuántas personas se desvía en promedio el pronóstico final de asistentes de una función.

| Puesto | Modelo | Error medio por función | WAPE | Brier por ticket |
|---:|---|---:|---:|---:|
| 1 | **CatBoost** | **6,24 personas** | **4,02 %** | **0,1201** |
| 2 | XGBoost | 7,23 personas | 4,66 % | 0,1218 |
| 3 | Promedio por tipo de ticket | 7,87 personas | 5,07 % | 0,1224 |
| 4 | Regresión logística | 9,28 personas | 5,97 % | 0,1215 |

### Modelo escogido: CatBoost

CatBoost tuvo el menor error por evento, el mejor WAPE y el mejor Brier. Superó a XGBoost en **19 de las 32 funciones**. Su ventaja media fue de 0,99 asistentes de error por función; en el bootstrap por evento el intervalo del 95 % fue de 0,10 a 1,89 asistentes a favor de CatBoost.

No se escogió solamente porque sea el algoritmo más complejo. Se escogió porque ganó con predicciones fuera de muestra y también superó al promedio simple, que funciona como línea base obligatoria.

Las variables con mayor influencia fueron el valor de la venta, el subtotal, el precio relativo de la entrada, si era cortesía o pagada, el historial Boom ponderado y la anticipación de compra. Esta influencia ayuda a entender el modelo, pero no prueba causalidad.

### Pronóstico de agosto

El modelo ganador calcula una probabilidad de asistencia por ticket y luego suma esas probabilidades por función. `forecast.csv` entrega, para cada uno de los 30 eventos de agosto:

- `expected_attendance`: asistencia esperada con los tickets adquiridos al corte.
- `p10`: escenario bajo calibrado con los errores observados en validación.
- `p90`: escenario alto calibrado con los errores observados en validación.

Los rangos siempre se limitan entre cero y los tickets ya adquiridos. El pronóstico **no anticipa ventas futuras**; debe recalcularse cuando entren nuevas compras. Como solo hay 32 funciones históricas, conviene reentrenar y recalibrar el modelo al incorporar cada nuevo mes.

## Resultado

| Capa | Uso |
|---|---|
| raw/ | Fuente original inmutable |
| clean/ | Datos normalizados, validados y trazables |
| model_ready/ | Entrenamiento de julio y scoring de agosto sin fuga ni nulos ambiguos |
| reports/ | Perfilado antes/después, outliers, integridad y cuarentena |
