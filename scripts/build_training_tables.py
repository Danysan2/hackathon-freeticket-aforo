"""Construye tablas ticket-level para entrenamiento (julio) y scoring (agosto).

La tabla combina ticket, venta, evento y señales Boom ponderadas por la
incertidumbre del cruce. Nunca usa agregados de asistencia del propio evento.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / "model_ready"
REPORTS_DIR = ROOT / "reports"
TRAIN_OUTPUT = MODEL_DIR / "training_tickets.csv"
SCORE_OUTPUT = MODEL_DIR / "scoring_tickets.csv"
FEATURES_OUTPUT = MODEL_DIR / "training_features.json"

NO_MATCH = "SIN_MATCH"

METADATA_COLUMNS = [
    "ticket_id", "sale_id", "event_id", "matched_boom_user_id",
    "event_title", "event_artist_name", "event_starts_at", "split_month",
]

CATEGORICAL_FEATURES = [
    "ticket_type", "sales_channel", "event_artist_id", "event_city",
    "event_venue", "event_weekday", "event_is_residency", "event_is_paid",
    "event_residency_venue", "event_residency_weekday", "match_status",
]

NUMERIC_FEATURES = [
    "ticket_price", "ticket_is_courtesy", "ticket_is_paid",
    "sale_qty", "sale_subtotal", "sale_unit_value", "sale_is_multi_ticket",
    "purchase_lead_hours", "purchase_lead_days",
    "event_capacity", "event_tickets_sold", "event_fill_rate",
    "event_gross_revenue", "event_hour", "event_day_of_month",
    "event_week_of_month", "event_is_weekend", "event_ticket_count",
    "event_courtesy_count", "event_general_count", "event_preferential_count",
    "event_vip_count", "event_paid_count", "event_courtesy_share",
    "event_general_share", "event_preferential_share", "event_vip_share",
    "event_paid_share", "event_average_ticket_price",
    "ticket_price_to_event_average", "event_remaining_capacity",
    "hard_match_confidence", "boom_candidate_count",
    "boom_top_candidate_probability", "boom_sin_match_probability",
    "sale_boom_identity_weight", "sale_boom_history_weight",
    "ticket_boom_identity_weight", "ticket_boom_history_weight",
    "boom_use_rate_expected", "boom_tickets_total_expected",
    "boom_tickets_used_expected", "boom_membership_probability",
    "boom_points_expected", "boom_friends_count_expected",
]

FORBIDDEN_COLUMNS = [
    "checked_in_at", "checked_in_count", "attendance_rate", "date_used",
    "last_used_at", "future_used_leak_count",
]


def as_bool(series: pd.Series) -> pd.Series:
    return series.astype(str).str.upper().eq("TRUE")


def numeric(series: pd.Series) -> pd.Series:
    return pd.to_numeric(series, errors="raise")


def build_identity_features(
    sales: pd.DataFrame,
    candidates: pd.DataFrame,
    matches: pd.DataFrame,
    boom: pd.DataFrame,
) -> tuple[pd.DataFrame, dict[str, float]]:
    profiles = boom.copy()
    for column in ["tickets_total", "tickets_used", "use_rate", "points", "friends_count"]:
        profiles[column] = numeric(profiles[column])
    profiles["has_membership_num"] = as_bool(profiles.has_membership).astype(float)
    profiles["history_available_num"] = as_bool(profiles.model_history_available).astype(float)

    historical = profiles[profiles.history_available_num.eq(1)]
    priors = {
        "use_rate": float(historical.use_rate.mean()),
        "tickets_total": float(profiles.tickets_total.mean()),
        "tickets_used": float(profiles.tickets_used.mean()),
        "membership": float(profiles.has_membership_num.mean()),
        "points": float(profiles.points.mean()),
        "friends_count": float(profiles.friends_count.mean()),
    }

    weighted = candidates[candidates.boom_user_id.ne(NO_MATCH)].copy()
    weighted["candidate_probability"] = numeric(weighted.candidate_probability)
    weighted["model_history_weight"] = numeric(weighted.model_history_weight)
    weighted = weighted.merge(
        profiles[[
            "boom_user_id", "tickets_total", "tickets_used", "use_rate",
            "has_membership_num", "points", "friends_count", "history_available_num",
        ]],
        on="boom_user_id",
        how="left",
        validate="many_to_one",
    )
    if weighted[["tickets_total", "tickets_used", "use_rate"]].isna().any().any():
        raise ValueError("Hay candidatos que no existen en boom_profile.csv")

    weighted["history_weight"] = weighted.model_history_weight * weighted.history_available_num
    for column in ["tickets_total", "tickets_used", "has_membership_num", "points", "friends_count"]:
        weighted[f"weighted_{column}"] = weighted.model_history_weight * weighted[column]
    weighted["weighted_use_rate"] = weighted.history_weight * weighted.use_rate

    aggregated = weighted.groupby("sale_id").agg(
        boom_candidate_count=("boom_user_id", "nunique"),
        boom_top_candidate_probability=("candidate_probability", "max"),
        sale_boom_identity_weight=("model_history_weight", "sum"),
        sale_boom_history_weight=("history_weight", "sum"),
        weighted_use_rate=("weighted_use_rate", "sum"),
        weighted_tickets_total=("weighted_tickets_total", "sum"),
        weighted_tickets_used=("weighted_tickets_used", "sum"),
        weighted_membership=("weighted_has_membership_num", "sum"),
        weighted_points=("weighted_points", "sum"),
        weighted_friends=("weighted_friends_count", "sum"),
    ).reset_index()

    sin_match = candidates[candidates.boom_user_id.eq(NO_MATCH)][["sale_id", "candidate_probability"]].copy()
    sin_match["boom_sin_match_probability"] = numeric(sin_match.candidate_probability)
    sin_match = sin_match[["sale_id", "boom_sin_match_probability"]]

    identity = sales[["sale_id"]].merge(aggregated, on="sale_id", how="left", validate="one_to_one")
    identity = identity.merge(sin_match, on="sale_id", how="left", validate="one_to_one")
    zero_columns = [
        "boom_candidate_count", "boom_top_candidate_probability",
        "sale_boom_identity_weight", "sale_boom_history_weight",
        "weighted_use_rate", "weighted_tickets_total", "weighted_tickets_used",
        "weighted_membership", "weighted_points", "weighted_friends",
    ]
    identity[zero_columns] = identity[zero_columns].fillna(0.0)
    identity["boom_sin_match_probability"] = identity.boom_sin_match_probability.fillna(1.0)

    identity["sale_boom_identity_weight"] = identity.sale_boom_identity_weight.clip(0, 1)
    identity["sale_boom_history_weight"] = identity.sale_boom_history_weight.clip(0, 1)
    identity["boom_use_rate_expected"] = (
        identity.weighted_use_rate
        + (1 - identity.sale_boom_history_weight) * priors["use_rate"]
    )
    identity["boom_tickets_total_expected"] = (
        identity.weighted_tickets_total
        + (1 - identity.sale_boom_identity_weight) * priors["tickets_total"]
    )
    identity["boom_tickets_used_expected"] = (
        identity.weighted_tickets_used
        + (1 - identity.sale_boom_identity_weight) * priors["tickets_used"]
    )
    identity["boom_membership_probability"] = (
        identity.weighted_membership
        + (1 - identity.sale_boom_identity_weight) * priors["membership"]
    )
    identity["boom_points_expected"] = (
        identity.weighted_points
        + (1 - identity.sale_boom_identity_weight) * priors["points"]
    )
    identity["boom_friends_count_expected"] = (
        identity.weighted_friends
        + (1 - identity.sale_boom_identity_weight) * priors["friends_count"]
    )

    identity = identity.merge(matches, on="sale_id", how="left", validate="one_to_one")
    identity.rename(columns={"boom_user_id": "matched_boom_user_id", "confidence": "hard_match_confidence"}, inplace=True)
    identity["hard_match_confidence"] = numeric(identity.hard_match_confidence)

    source_for_hard = candidates.merge(
        matches[matches.boom_user_id.ne(NO_MATCH)],
        on=["sale_id", "boom_user_id"],
        how="inner",
    ).groupby("sale_id").candidate_source.agg(lambda values: "+".join(sorted(set(values)))).to_dict()

    def status(row: pd.Series) -> str:
        if row.matched_boom_user_id == NO_MATCH:
            return "NEW_OR_UNKNOWN" if row.boom_candidate_count == 0 else "UNRESOLVED_IDENTITY"
        source = source_for_hard.get(row.sale_id, "")
        if "LEARNED_ALIAS" in source:
            return "ALIAS_PROBABLE"
        return "DIRECT_HIGH" if row.hard_match_confidence >= 0.90 else "DIRECT_PROBABLE"

    identity["match_status"] = identity.apply(status, axis=1)
    keep = [
        "sale_id", "matched_boom_user_id", "hard_match_confidence", "match_status",
        "boom_candidate_count", "boom_top_candidate_probability",
        "boom_sin_match_probability", "sale_boom_identity_weight",
        "sale_boom_history_weight", "boom_use_rate_expected",
        "boom_tickets_total_expected", "boom_tickets_used_expected",
        "boom_membership_probability", "boom_points_expected",
        "boom_friends_count_expected",
    ]
    return identity[keep], priors


def event_mix(tickets: pd.DataFrame) -> pd.DataFrame:
    work = tickets.copy()
    work["price_num"] = numeric(work.price)
    counts = work.groupby(["event_id", "ticket_type"]).size().unstack(fill_value=0)
    for ticket_type in ["CORTESÍA", "GENERAL", "PREFERENCIAL", "VIP"]:
        if ticket_type not in counts.columns:
            counts[ticket_type] = 0
    counts = counts[["CORTESÍA", "GENERAL", "PREFERENCIAL", "VIP"]].reset_index()
    counts.rename(columns={
        "CORTESÍA": "event_courtesy_count",
        "GENERAL": "event_general_count",
        "PREFERENCIAL": "event_preferential_count",
        "VIP": "event_vip_count",
    }, inplace=True)
    stats = work.groupby("event_id").agg(
        event_ticket_count=("ticket_id", "size"),
        event_average_ticket_price=("price_num", "mean"),
    ).reset_index()
    result = counts.merge(stats, on="event_id", validate="one_to_one")
    result["event_paid_count"] = result[["event_general_count", "event_preferential_count", "event_vip_count"]].sum(axis=1)
    for prefix in ["courtesy", "general", "preferential", "vip", "paid"]:
        result[f"event_{prefix}_share"] = result[f"event_{prefix}_count"] / result.event_ticket_count
    return result


def build_split(
    tickets: pd.DataFrame,
    events: pd.DataFrame,
    sales: pd.DataFrame,
    identity: pd.DataFrame,
    priors: dict[str, float],
    month: str,
    include_target: bool,
) -> pd.DataFrame:
    ticket = tickets.copy()
    ticket.rename(columns={"price": "ticket_price"}, inplace=True)
    ticket["ticket_price"] = numeric(ticket.ticket_price)
    ticket["ticket_is_courtesy"] = ticket.ticket_type.eq("CORTESÍA").astype(int)
    ticket["ticket_is_paid"] = 1 - ticket.ticket_is_courtesy

    if include_target:
        ticket["checked_in"] = as_bool(ticket.checked_in).astype(int)
        ticket.drop(columns=["checked_in_at"], inplace=True)

    mix = event_mix(tickets)
    event = events.copy()
    event_columns = {
        "title": "event_title", "artist_id": "event_artist_id",
        "artist_name": "event_artist_name", "residency_venue": "event_residency_venue",
        "residency_weekday": "event_residency_weekday", "city": "event_city",
        "venue": "event_venue", "capacity": "event_capacity",
        "starts_at": "event_starts_at", "weekday": "event_weekday",
        "is_residency": "event_is_residency", "is_paid": "event_is_paid",
        "tickets_sold": "event_tickets_sold", "fill_rate": "event_fill_rate",
        "gross_revenue": "event_gross_revenue",
    }
    event = event[["event_id", *event_columns]].rename(columns=event_columns)
    for column in ["event_capacity", "event_tickets_sold", "event_fill_rate", "event_gross_revenue"]:
        event[column] = numeric(event[column])

    sale = sales.copy()
    sale.rename(columns={"event_id": "sale_event_id", "qty": "sale_qty", "subtotal": "sale_subtotal", "channel": "sales_channel"}, inplace=True)
    sale["sale_qty"] = numeric(sale.sale_qty)
    sale["sale_subtotal"] = numeric(sale.sale_subtotal)
    sale = sale[["sale_id", "sale_event_id", "sale_qty", "sale_subtotal", "sales_channel", "purchased_at"]]

    table = ticket.merge(sale, on="sale_id", how="left", validate="many_to_one")
    if not table.event_id.eq(table.sale_event_id).all():
        raise ValueError("Un ticket quedó unido a una venta de otro evento")
    table.drop(columns=["sale_event_id"], inplace=True)
    table = table.merge(event, on="event_id", how="left", validate="many_to_one")
    table = table.merge(mix, on="event_id", how="left", validate="many_to_one")
    table = table.merge(identity, on="sale_id", how="left", validate="many_to_one")
    if table[["event_title", "sales_channel", "matched_boom_user_id"]].isna().any().any():
        raise ValueError("Un JOIN dejó filas sin venta, evento o identidad")

    starts = pd.to_datetime(table.event_starts_at, utc=True)
    purchased = pd.to_datetime(table.purchased_at, utc=True)
    table["purchase_lead_hours"] = (starts - purchased).dt.total_seconds() / 3600
    table["purchase_lead_days"] = table.purchase_lead_hours / 24
    table["sale_unit_value"] = table.sale_subtotal / table.sale_qty
    table["sale_is_multi_ticket"] = table.sale_qty.gt(1).astype(int)
    table["event_hour"] = starts.dt.hour + starts.dt.minute / 60
    table["event_day_of_month"] = starts.dt.day
    table["event_week_of_month"] = ((starts.dt.day - 1) // 7 + 1).astype(int)
    table["event_is_weekend"] = starts.dt.dayofweek.ge(5).astype(int)
    table["event_remaining_capacity"] = table.event_capacity - table.event_ticket_count
    table["ticket_price_to_event_average"] = np.where(
        table.event_average_ticket_price.gt(0),
        table.ticket_price / table.event_average_ticket_price,
        0.0,
    )

    # El perfil corresponde al comprador; al comprar varias entradas se reduce
    # su influencia porque no conocemos la identidad de los acompañantes.
    companion_factor = 1 / table.sale_qty
    table["ticket_boom_identity_weight"] = table.sale_boom_identity_weight * companion_factor
    table["ticket_boom_history_weight"] = table.sale_boom_history_weight * companion_factor
    shrink_columns = {
        "boom_use_rate_expected": priors["use_rate"],
        "boom_tickets_total_expected": priors["tickets_total"],
        "boom_tickets_used_expected": priors["tickets_used"],
        "boom_membership_probability": priors["membership"],
        "boom_points_expected": priors["points"],
        "boom_friends_count_expected": priors["friends_count"],
    }
    for column, prior in shrink_columns.items():
        table[column] = prior + (table[column] - prior) * companion_factor

    table["split_month"] = month
    table.drop(columns=["purchased_at"], inplace=True)

    ordered = [*METADATA_COLUMNS, *CATEGORICAL_FEATURES, *NUMERIC_FEATURES]
    if include_target:
        ordered.append("checked_in")
    table = table[ordered]
    for column in CATEGORICAL_FEATURES + METADATA_COLUMNS:
        table[column] = table[column].astype(str).replace("", "SIN_DATO")
    table[NUMERIC_FEATURES] = table[NUMERIC_FEATURES].astype(float).round(6)
    return table


def write_documentation(train: pd.DataFrame, score: pd.DataFrame, priors: dict[str, float]) -> None:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    config = {
        "metadata_columns": METADATA_COLUMNS,
        "categorical_features": CATEGORICAL_FEATURES,
        "numeric_features": NUMERIC_FEATURES,
        "target": "checked_in",
        "group_validation_column": "event_id",
        "forbidden_leakage_columns": FORBIDDEN_COLUMNS,
        "boom_population_priors": {key: round(value, 6) for key, value in priors.items()},
    }
    FEATURES_OUTPUT.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")

    report = {
        "training": {
            "rows": len(train), "events": int(train.event_id.nunique()),
            "sales": int(train.sale_id.nunique()), "attendance_rate": round(float(train.checked_in.mean()), 6),
        },
        "scoring": {
            "rows": len(score), "events": int(score.event_id.nunique()),
            "sales": int(score.sale_id.nunique()),
        },
        "features": {
            "categorical": len(CATEGORICAL_FEATURES), "numeric": len(NUMERIC_FEATURES),
            "total_model_features": len(CATEGORICAL_FEATURES) + len(NUMERIC_FEATURES),
        },
        "match_status_training": {str(key): int(value) for key, value in train.match_status.value_counts().items()},
        "match_status_scoring": {str(key): int(value) for key, value in score.match_status.value_counts().items()},
        "boom_population_priors": config["boom_population_priors"],
        "leakage_excluded": FORBIDDEN_COLUMNS,
    }
    (REPORTS_DIR / "training_table_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# Tabla de entrenamiento por ticket",
        "",
        f"- Julio: **{len(train):,} tickets**, {train.event_id.nunique()} eventos, objetivo `checked_in` completo.",
        f"- Agosto: **{len(score):,} tickets**, {score.event_id.nunique()} eventos, sin columna objetivo.",
        f"- Variables del modelo: **{len(CATEGORICAL_FEATURES)} categóricas + {len(NUMERIC_FEATURES)} numéricas**.",
        "- Validación futura: agrupar por `event_id`, nunca dividir tickets del mismo show entre train y test.",
        "",
        "## Protección contra fuga",
        "",
        "No entran como variables: `checked_in_at`, `checked_in_count`, `attendance_rate`, `date_used`, `last_used_at` ni tickets Boom posteriores al corte seguro.",
        "",
        "## Identidad y acompañantes",
        "",
        "Las características Boom son promedios ponderados por `model_history_weight`. La parte desconocida se suaviza hacia el promedio poblacional. Si una venta tiene `qty > 1`, la desviación del perfil del comprador se reduce por `1/qty` porque no conocemos a los acompañantes.",
        "",
        "## Grupos de variables",
        "",
        "- Ticket: tipo, precio y condición pagada/cortesía.",
        "- Venta: cantidad, subtotal, canal y anticipación.",
        "- Evento: artista, sede, horario, aforo y mezcla de tipos.",
        "- Identidad: estado del match, candidatos, incertidumbre e historial Boom ponderado.",
    ]
    (REPORTS_DIR / "training_table_report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    sales = pd.read_csv(MODEL_DIR / "ft_sales.csv", dtype=str, keep_default_na=False)
    candidates = pd.read_csv(ROOT / "match_candidates.csv", dtype=str, keep_default_na=False)
    matches = pd.read_csv(ROOT / "matches.csv", dtype=str, keep_default_na=False)
    boom = pd.read_csv(MODEL_DIR / "boom_profile.csv", dtype=str, keep_default_na=False)
    identity, priors = build_identity_features(sales, candidates, matches, boom)

    train_tickets = pd.read_csv(MODEL_DIR / "ft_tickets_train_july.csv", dtype=str, keep_default_na=False)
    score_tickets = pd.read_csv(MODEL_DIR / "ft_tickets_score_august.csv", dtype=str, keep_default_na=False)
    train_events = pd.read_csv(MODEL_DIR / "ft_events_train_july.csv", dtype=str, keep_default_na=False)
    score_events = pd.read_csv(MODEL_DIR / "ft_events_score_august.csv", dtype=str, keep_default_na=False)

    train = build_split(train_tickets, train_events, sales, identity, priors, "JULIO", include_target=True)
    score = build_split(score_tickets, score_events, sales, identity, priors, "AGOSTO", include_target=False)
    train.to_csv(TRAIN_OUTPUT, index=False, encoding="utf-8")
    score.to_csv(SCORE_OUTPUT, index=False, encoding="utf-8")
    write_documentation(train, score, priors)
    print(json.dumps({
        "training_output": str(TRAIN_OUTPUT), "training_rows": len(train),
        "scoring_output": str(SCORE_OUTPUT), "scoring_rows": len(score),
        "features": len(CATEGORICAL_FEATURES) + len(NUMERIC_FEATURES),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
