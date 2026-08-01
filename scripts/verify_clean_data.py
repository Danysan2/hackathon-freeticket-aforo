#!/usr/bin/env python3
"""Verificación independiente de las capas clean/ y model_ready/."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
CLEAN = ROOT / "clean"
MODEL = ROOT / "model_ready"
REPORTS = ROOT / "reports"
NO_DATA = "SIN_DATO"
NOT_OBSERVED = "NO_OBSERVADO"
AS_OF = pd.Timestamp("2026-08-01T05:00:00Z")
MATURE = pd.Timestamp("2026-07-01T23:59:59Z")

PRIMARY_KEYS = {
    "boom_users.csv": "boom_user_id",
    "boom_profile.csv": "boom_user_id",
    "boom_tickets.csv": "boom_ticket_id",
    "boom_social.csv": "boom_user_id",
    "ft_artists.csv": "artist_id",
    "ft_events.csv": "event_id",
    "ft_sales.csv": "sale_id",
    "ft_tickets.csv": "ticket_id",
}


class Validator:
    def __init__(self) -> None:
        self.checks: list[dict[str, Any]] = []
        self.failures: list[str] = []

    def check(self, condition: bool, name: str, evidence: Any) -> None:
        status = "PASS" if condition else "FAIL"
        self.checks.append({"check": name, "status": status, "evidence": evidence})
        if not condition:
            self.failures.append(f"{name}: {evidence}")


def load_folder(folder: Path) -> dict[str, pd.DataFrame]:
    return {
        path.name: pd.read_csv(path, dtype=str, keep_default_na=False, encoding="utf-8-sig")
        for path in sorted(folder.glob("*.csv"))
    }


def blank_cells(df: pd.DataFrame) -> int:
    return sum(int(df[col].fillna("").astype(str).str.strip().eq("").sum()) for col in df.columns)


def uppercase_violations(series: pd.Series) -> int:
    valid = series[series != NO_DATA]
    return int((valid != valid.str.upper()).sum())


def main() -> None:
    v = Validator()
    clean = load_folder(CLEAN)
    model = load_folder(MODEL)

    expected_clean = set(PRIMARY_KEYS)
    expected_model = {
        "boom_users.csv", "boom_profile.csv", "boom_tickets_history.csv", "boom_social.csv",
        "ft_artists.csv", "ft_sales.csv", "ft_events_train_july.csv", "ft_events_score_august.csv",
        "ft_tickets_train_july.csv", "ft_tickets_score_august.csv",
    }
    v.check(set(clean) == expected_clean, "archivos clean completos", sorted(clean))
    # Las etapas posteriores agregan training_tickets.csv y scoring_tickets.csv a
    # esta capa. Exigimos las salidas mínimas de limpieza sin rechazar artefactos
    # válidos producidos más adelante por el pipeline.
    missing_model = sorted(expected_model - set(model))
    v.check(not missing_model, "archivos model_ready mínimos completos", missing_model)

    for file, pk in PRIMARY_KEYS.items():
        if file not in clean:
            continue
        df = clean[file]
        v.check(blank_cells(df) == 0, f"{file}: cero celdas vacías", blank_cells(df))
        v.check(int(df.duplicated().sum()) == 0, f"{file}: cero duplicados exactos", int(df.duplicated().sum()))
        v.check(int(df[pk].duplicated().sum()) == 0, f"{file}: llave primaria única", int(df[pk].duplicated().sum()))

    for file, df in model.items():
        v.check(blank_cells(df) == 0, f"model_ready/{file}: cero celdas vacías", blank_cells(df))
        v.check(int(df.duplicated().sum()) == 0, f"model_ready/{file}: cero duplicados exactos", int(df.duplicated().sum()))

    upper_columns = {
        "boom_users.csv": ["first_name", "last_name", "full_name", "city", "country"],
        "boom_profile.csv": ["first_name", "last_name", "full_name", "city", "country"],
        "ft_artists.csv": ["name", "home_city", "residency_venue", "residency_weekday"],
        "ft_events.csv": ["title", "artist_name", "city", "venue", "weekday", "month"],
        "ft_sales.csv": ["buyer_name", "channel"],
        "ft_tickets.csv": ["ticket_type"],
    }
    for file, columns in upper_columns.items():
        for col in columns:
            violations = uppercase_violations(clean[file][col])
            v.check(violations == 0, f"{file}.{col}: mayúsculas", violations)

    for file, email_col, phone_col in [
        ("boom_users.csv", "email", "phone"),
        ("boom_profile.csv", "email", "phone"),
        ("ft_sales.csv", "buyer_email", "buyer_phone"),
    ]:
        df = clean[file]
        emails = df[email_col]
        bad_email = emails[(emails != NO_DATA) & (
            (emails != emails.str.lower())
            | emails.str.split("@", n=1).str[0].str.contains(r"\+", regex=True)
            | emails.str.endswith(("@gmial.com", "@hotmial.com", "@outlok.com"))
        )]
        phones = df[phone_col]
        bad_phone = phones[(phones != NO_DATA) & ~phones.str.fullmatch(r"3\d{9}")]
        v.check(len(bad_email) == 0, f"{file}.{email_col}: formato canónico", len(bad_email))
        v.check(len(bad_phone) == 0, f"{file}.{phone_col}: formato canónico", len(bad_phone))

    v.check(int((pd.to_numeric(clean["boom_users.csv"]["identity_fields_available"]) < 2).sum()) == 0,
            "boom_users: identidad mínima", int((pd.to_numeric(clean["boom_users.csv"]["identity_fields_available"]) < 2).sum()))
    v.check(int((pd.to_numeric(clean["ft_sales.csv"]["identity_fields_available"]) < 1).sum()) == 0,
            "ft_sales: identidad mínima", int((pd.to_numeric(clean["ft_sales.csv"]["identity_fields_available"]) < 1).sum()))

    users = set(clean["boom_users.csv"]["boom_user_id"])
    artists = set(clean["ft_artists.csv"]["artist_id"])
    events = set(clean["ft_events.csv"]["event_id"])
    sales = set(clean["ft_sales.csv"]["sale_id"])
    refs = [
        ("boom_profile.csv", "boom_user_id", users),
        ("boom_social.csv", "boom_user_id", users),
        ("boom_tickets.csv", "boom_user_id", users),
        ("ft_events.csv", "artist_id", artists),
        ("ft_sales.csv", "event_id", events),
        ("ft_tickets.csv", "event_id", events),
        ("ft_tickets.csv", "sale_id", sales),
    ]
    for file, col, valid in refs:
        invalid = int((~clean[file][col].isin(valid)).sum())
        v.check(invalid == 0, f"{file}.{col}: integridad referencial", invalid)

    sale_event = clean["ft_sales.csv"].set_index("sale_id")["event_id"]
    tickets = clean["ft_tickets.csv"]
    mismatch = int((tickets["sale_id"].map(sale_event) != tickets["event_id"]).sum())
    v.check(mismatch == 0, "ft_tickets: sale_id y event_id consistentes", mismatch)

    grouped = tickets.groupby("sale_id").agg(qty=("ticket_id", "size"), subtotal=("price", lambda x: pd.to_numeric(x).sum()))
    sales_df = clean["ft_sales.csv"].set_index("sale_id")
    qty_mismatch = int((pd.to_numeric(sales_df["qty"]) != grouped["qty"]).sum())
    subtotal_mismatch = int((pd.to_numeric(sales_df["subtotal"]) != grouped["subtotal"]).sum())
    v.check(qty_mismatch == 0, "ft_sales.qty reconcilia con tickets", qty_mismatch)
    v.check(subtotal_mismatch == 0, "ft_sales.subtotal reconcilia con tickets", subtotal_mismatch)

    boom = clean["boom_tickets.csv"]
    future_count = int((boom["future_used_leak"] == "TRUE").sum())
    v.check(future_count == 666, "boom_tickets: fuga futura detectada y marcada", future_count)
    history = model["boom_tickets_history.csv"]
    created = pd.to_datetime(history["created_at"], utc=True, errors="coerce")
    used_dates = pd.to_datetime(history["date_used"].replace("NO_APLICA", pd.NA), utc=True, errors="coerce")
    future_history = int((used_dates > AS_OF).sum())
    immature_history = int((created > MATURE).sum())
    v.check(future_history == 0, "model_ready Boom: cero resultados futuros", future_history)
    v.check(immature_history == 0, "model_ready Boom: solo cohorte madura", immature_history)

    train_events = model["ft_events_train_july.csv"]
    score_events = model["ft_events_score_august.csv"]
    train_tickets = model["ft_tickets_train_july.csv"]
    score_tickets = model["ft_tickets_score_august.csv"]
    v.check(set(train_events["month"]) == {"JULIO"}, "eventos train son julio", sorted(train_events["month"].unique()))
    v.check(set(score_events["month"]) == {"AGOSTO"}, "eventos score son agosto", sorted(score_events["month"].unique()))
    v.check("attendance_rate" not in score_events.columns and "checked_in_count" not in score_events.columns,
            "eventos score no contienen objetivos", list(score_events.columns))
    v.check(set(train_tickets["checked_in"]).issubset({"TRUE", "FALSE"}), "tickets train tienen etiquetas", sorted(train_tickets["checked_in"].unique()))
    v.check("checked_in" not in score_tickets.columns and "checked_in_at" not in score_tickets.columns,
            "tickets score no contienen objetivos", list(score_tickets.columns))

    invalid_rates = 0
    for file, cols in {
        "boom_profile.csv": ["use_rate", "model_use_rate"],
        "ft_artists.csv": ["attendance_rate_july"],
        "ft_events_train_july.csv": ["attendance_rate", "fill_rate"],
    }.items():
        df = clean[file] if file in clean else model[file]
        for col in cols:
            values = pd.to_numeric(df[col], errors="coerce")
            invalid_rates += int((values.isna() | (values < 0) | (values > 1.5 if col == "fill_rate" else values > 1)).sum())
    v.check(invalid_rates == 0, "tasas dentro de rangos válidos", invalid_rates)

    result = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "status": "PASS" if not v.failures else "FAIL",
        "checks_total": len(v.checks),
        "checks_passed": sum(c["status"] == "PASS" for c in v.checks),
        "failures": v.failures,
        "checks": v.checks,
    }
    REPORTS.mkdir(parents=True, exist_ok=True)
    (REPORTS / "verification_report.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [
        "# Verificación de datos limpios",
        "",
        f"Estado: **{result['status']}**",
        f"Checks aprobados: **{result['checks_passed']}/{result['checks_total']}**",
        "",
        "| Check | Estado | Evidencia |",
        "|---|---|---|",
    ]
    for check in v.checks:
        evidence = str(check["evidence"]).replace("|", "\\|")
        lines.append(f"| {check['check']} | {check['status']} | {evidence} |")
    (REPORTS / "verification_report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({k: result[k] for k in ["status", "checks_total", "checks_passed", "failures"]}, ensure_ascii=False, indent=2))
    if v.failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
