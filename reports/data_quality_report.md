# Reporte de calidad y limpieza de datos

Fecha de corte analítica: **2026-08-01 00:00 America/Bogota**.

## Resumen por archivo

| Archivo | Filas raw | Filas clean | Duplicados eliminados | Cuarentena | Vacíos raw | Vacíos clean |
|---|---|---|---|---|---|---|
| boom_users | 6000 | 6000 | 0 | 0 | 4674 | 0 |
| boom_profile | 6000 | 6000 | 0 | 0 | 5031 | 0 |
| boom_tickets | 22325 | 22325 | 0 | 0 | 7887 | 0 |
| boom_social | 6000 | 6000 | 0 | 0 | 0 | 0 |
| ft_artists | 14 | 14 | 0 | 0 | 25 | 0 |
| ft_events | 62 | 62 | 0 | 0 | 96 | 0 |
| ft_sales | 6383 | 6383 | 0 | 0 | 591 | 0 |
| ft_tickets | 11931 | 11931 | 0 | 0 | 12171 | 0 |

## Normalizaciones aplicadas

- Nombres de personas, artistas, ciudades, venues y títulos: mayúsculas y espacios compactados.
- Emails: minúsculas, alias `+...` removidos y dominios conocidos corregidos (`gmial`, `hotmial`, `outlok`).
- Teléfonos: solo 10 dígitos colombianos, removiendo formatos y prefijo `57`.
- Fechas: ISO 8601 UTC; cumpleaños en `YYYY-MM-DD`.
- Vacíos semánticos: `SIN_DATO`, `NO_APLICA` o `NO_OBSERVADO` según el caso.
- No se inventaron letras faltantes, dígitos transpuestos ni identidades de pareja/amigo.

| Cambio | Cantidad |
|---|---|
| email_domain_typo | 338 |
| email_invalid | 0 |
| email_plus_alias | 380 |
| email_uppercase | 288 |
| future_used_leak_flagged | 666 |
| mature_training_rows | 20056 |
| names_uppercased | 30010 |
| phone_formatted | 4589 |
| phone_invalid | 0 |
| phone_missing | 591 |

## Duplicados e integridad referencial

Los duplicados exactos se eliminan. Una llave primaria repetida o una referencia huérfana se envía a `reports/quarantine/` en vez de escoger arbitrariamente una identidad.

```json
{
  "boom_profile.boom_user_id": {
    "invalid_references": 0,
    "rule": "ORPHAN_USER"
  },
  "boom_social.boom_user_id": {
    "invalid_references": 0,
    "rule": "ORPHAN_USER"
  },
  "boom_tickets.boom_user_id": {
    "invalid_references": 0,
    "rule": "ORPHAN_USER"
  },
  "ft_events.artist_id": {
    "invalid_references": 0,
    "rule": "ORPHAN_ARTIST"
  },
  "ft_sales.event_id": {
    "invalid_references": 0,
    "rule": "ORPHAN_EVENT"
  },
  "ft_tickets.event_id": {
    "invalid_references": 0,
    "rule": "ORPHAN_EVENT"
  },
  "ft_tickets.sale_id": {
    "invalid_references": 0,
    "rule": "ORPHAN_SALE"
  },
  "ft_tickets.sale_event_consistency": {
    "mismatches": 0
  },
  "ft_sales.ticket_reconciliation": {
    "qty_mismatches_corrected": 0,
    "subtotal_mismatches_corrected": 0
  },
  "ft_events.summary_reconciliation": {}
}
```

## Valores atípicos

El IQR se usa como detector, no como borrador automático. Precios, cantidades y aforos extremos se conservan si respetan las reglas del negocio; negativos, tasas fuera de `[0,1]` o llaves inválidas se rechazan. El detalle por columna está en `data_quality_report.json`.

## Nulos y datasets para el modelo

Un `null` no siempre es un error. En agosto, `checked_in` es la variable que todavía se debe predecir. Por eso `model_ready/` separa:

- `*_train_july.csv`: etiquetas observadas, sin nulos.
- `*_score_august.csv`: columnas objetivo retiradas, no imputadas.
- `boom_tickets_history.csv`: solo cohorte madura al corte, sin fuga futura.

## Fuga temporal de Boom

Se marcaron **666** tickets usados después del corte, para **634** usuarios; la fecha máxima es **2026-08-26T12:13:00+00:00**. `boom_profile.csv` limpio conserva los agregados originales para auditoría y agrega métricas `model_*` recalculadas con historia madura.
