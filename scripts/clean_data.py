#!/usr/bin/env python3
"""Pipeline reproducible de calidad para los datos de la hackathon FreeTicket.

Capas producidas:
  raw/         fuente inmutable descargada desde la API
  clean/       datos canónicos, sin vacíos ambiguos y con claves normalizadas
  model_ready/ tablas separadas para entrenamiento (julio) y scoring (agosto)
  reports/     perfilado, reglas, cuarentena y trazabilidad

El pipeline evita inventar identidades: normaliza, valida y marca. Las
correcciones semánticamente ambiguas (letra faltante, correo/teléfono de otra
persona, dígitos transpuestos) se resuelven después con matching probabilístico.
"""

from __future__ import annotations

import json
import math
import re
import shutil
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "raw"
CLEAN = ROOT / "clean"
MODEL = ROOT / "model_ready"
REPORTS = ROOT / "reports"
QUARANTINE = REPORTS / "quarantine"
PROGRESS_FILE = ROOT / ".clean_data_progress.log"

# El brief fija hoy en 2026-08-01. Medianoche en America/Bogota = 05:00 UTC.
AS_OF_UTC = pd.Timestamp("2026-08-01T05:00:00Z")
# El generador de Boom usa created_at + 1..30 dias para date_used. Esta cohorte
# ya maduro completamente al corte y evita clasificar reservas futuras como no-show.
MATURE_CREATED_CUTOFF = pd.Timestamp("2026-07-01T23:59:59Z")

NO_DATA = "SIN_DATO"
NOT_APPLICABLE = "NO_APLICA"
NOT_OBSERVED = "NO_OBSERVADO"

FILES = {
    "boom_users": {"file": "boom_users.csv", "pk": "boom_user_id"},
    "boom_profile": {"file": "boom_profile.csv", "pk": "boom_user_id"},
    "boom_tickets": {"file": "boom_tickets.csv", "pk": "boom_ticket_id"},
    "boom_social": {"file": "boom_social.csv", "pk": "boom_user_id"},
    "ft_artists": {"file": "ft_artists.csv", "pk": "artist_id"},
    "ft_events": {"file": "ft_events.csv", "pk": "event_id"},
    "ft_sales": {"file": "ft_sales.csv", "pk": "sale_id"},
    "ft_tickets": {"file": "ft_tickets.csv", "pk": "ticket_id"},
}

NUMERIC_COLUMNS = {
    "boom_users": ["points"],
    "boom_profile": ["points", "tickets_total", "tickets_used", "use_rate", "friends_count"],
    "boom_social": ["friends_count"],
    "ft_artists": ["events_total", "events_past", "events_upcoming", "tickets_sold", "checked_in_count", "attendance_rate_july"],
    "ft_events": ["capacity", "tickets_sold", "checked_in_count", "attendance_rate", "fill_rate", "gross_revenue"],
    "ft_sales": ["qty", "subtotal"],
    "ft_tickets": ["price"],
}

DOMAIN_TYPOS = {
    "gmial.com": "gmail.com",
    "hotmial.com": "hotmail.com",
    "outlok.com": "outlook.com",
}

VALID_CATEGORIES = {
    "boom_tickets.type": {"MEMBRESIA", "CONSUMO_MINIMO"},
    "boom_tickets.source": {"APP", "WEB", "REFERRAL", "BOX_OFFICE"},
    "ft_sales.channel": {"WEB", "BOX_OFFICE", "ADMIN", "RRPP"},
    "ft_tickets.ticket_type": {"GENERAL", "PREFERENCIAL", "VIP", "CORTESÍA"},
}


def progress(message: str) -> None:
    stamp = datetime.now(timezone.utc).isoformat()
    line = f"{stamp} {message}"
    print(line, flush=True)
    with PROGRESS_FILE.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")


@dataclass
class ChangeLog:
    rows_raw: int = 0
    rows_clean: int = 0
    exact_duplicates_removed: int = 0
    duplicate_primary_keys_removed: int = 0
    rows_quarantined: int = 0
    rows_dropped_insufficient_identity: int = 0
    blanks_raw: int = 0
    blanks_clean: int = 0
    transformations: Counter = field(default_factory=Counter)
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "rows_raw": self.rows_raw,
            "rows_clean": self.rows_clean,
            "exact_duplicates_removed": self.exact_duplicates_removed,
            "duplicate_primary_keys_removed": self.duplicate_primary_keys_removed,
            "rows_quarantined": self.rows_quarantined,
            "rows_dropped_insufficient_identity": self.rows_dropped_insufficient_identity,
            "blanks_raw": self.blanks_raw,
            "blanks_clean": self.blanks_clean,
            "transformations": dict(self.transformations),
            "notes": self.notes,
        }


def scalar_text(value: Any) -> str:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return ""
    text = unicodedata.normalize("NFC", str(value)).replace("\u00a0", " ")
    return re.sub(r"\s+", " ", text).strip()


def upper_text(value: Any) -> str:
    return scalar_text(value).upper()


def match_key(value: Any) -> str:
    text = unicodedata.normalize("NFD", upper_text(value))
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^A-Z0-9]", "", text)


def token_key(value: Any) -> str:
    text = unicodedata.normalize("NFD", upper_text(value))
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    tokens = re.findall(r"[A-Z0-9]+", text)
    return " ".join(sorted(tokens))


def normalize_email(value: Any) -> tuple[str, dict[str, bool]]:
    raw = scalar_text(value)
    flags = {"uppercase": False, "plus_alias": False, "domain_typo": False, "invalid": False}
    if not raw:
        flags["invalid"] = True
        return NO_DATA, flags
    flags["uppercase"] = raw != raw.lower()
    email = raw.lower().replace(" ", "")
    if email.startswith("mailto:"):
        email = email[7:]
    if email.count("@") != 1:
        flags["invalid"] = True
        return NO_DATA, flags
    local, domain = email.split("@", 1)
    if "+" in local:
        local = local.split("+", 1)[0]
        flags["plus_alias"] = True
    if domain in DOMAIN_TYPOS:
        domain = DOMAIN_TYPOS[domain]
        flags["domain_typo"] = True
    email = f"{local}@{domain}"
    if not re.fullmatch(r"[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+", email):
        flags["invalid"] = True
        return NO_DATA, flags
    return email, flags


def normalize_phone(value: Any) -> tuple[str, dict[str, bool]]:
    raw = scalar_text(value)
    flags = {"formatted": False, "missing": False, "invalid": False}
    if not raw:
        flags["missing"] = True
        return NO_DATA, flags
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 12 and digits.startswith("57"):
        digits = digits[2:]
    flags["formatted"] = raw != digits
    if len(digits) != 10 or not digits.startswith("3"):
        flags["invalid"] = True
        return NO_DATA, flags
    return digits, flags


def normalize_bool(value: Any, missing: str = NO_DATA) -> str:
    text = scalar_text(value).lower()
    if text in {"true", "1", "si", "sí", "yes"}:
        return "TRUE"
    if text in {"false", "0", "no"}:
        return "FALSE"
    return missing


def normalize_datetime(value: Any, missing: str = NO_DATA, date_only: bool = False) -> str:
    text = scalar_text(value)
    if not text:
        return missing
    ts = pd.to_datetime(text, utc=True, errors="coerce")
    if pd.isna(ts):
        return missing
    if date_only:
        return ts.strftime("%Y-%m-%d")
    return ts.strftime("%Y-%m-%dT%H:%M:%S+00:00")


def normalize_datetime_series(series: pd.Series, missing: str = NO_DATA, date_only: bool = False) -> pd.Series:
    cleaned = series.fillna("").astype(str).str.strip().replace("", pd.NA)
    parsed = pd.to_datetime(cleaned, utc=True, errors="coerce", format="mixed")
    fmt = "%Y-%m-%d" if date_only else "%Y-%m-%dT%H:%M:%S+00:00"
    return parsed.dt.strftime(fmt).fillna(missing)


def numeric_series(series: pd.Series, integer: bool = False, default: float | int | None = None) -> pd.Series:
    result = pd.to_numeric(series.replace({"": np.nan, NO_DATA: np.nan}), errors="coerce")
    if default is not None:
        result = result.fillna(default)
    if integer:
        return result.round().astype("Int64")
    return result.astype("Float64")


def count_blanks(df: pd.DataFrame) -> int:
    if df.empty:
        return 0
    total = 0
    for col in df.columns:
        total += int(df[col].fillna("").astype(str).str.strip().eq("").sum())
    return total


def json_value(value: Any) -> Any:
    if value is None or value is pd.NA or (isinstance(value, float) and math.isnan(value)):
        return None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return float(value)
    if isinstance(value, (pd.Timestamp, datetime)):
        return value.isoformat()
    return value


def profile_frame(name: str, df: pd.DataFrame, pk: str) -> dict[str, Any]:
    missing = {
        col: int(df[col].fillna("").astype(str).str.strip().eq("").sum())
        for col in df.columns
    }
    duplicate_pk = int(df.duplicated(subset=[pk], keep=False).sum()) if pk in df else None
    numeric = {}
    for col in NUMERIC_COLUMNS.get(name, []):
        if col not in df:
            continue
        values = pd.to_numeric(df[col], errors="coerce").dropna()
        if values.empty:
            numeric[col] = {"valid": 0, "missing_or_invalid": len(df), "outliers_iqr": 0}
            continue
        q1, median, q3 = values.quantile([0.25, 0.5, 0.75]).tolist()
        iqr = q3 - q1
        low, high = q1 - 1.5 * iqr, q3 + 1.5 * iqr
        numeric[col] = {
            "valid": int(values.size),
            "missing_or_invalid": int(len(df) - values.size),
            "min": json_value(values.min()),
            "q1": json_value(q1),
            "median": json_value(median),
            "q3": json_value(q3),
            "max": json_value(values.max()),
            "outliers_iqr": int(((values < low) | (values > high)).sum()),
            "iqr_low": json_value(low),
            "iqr_high": json_value(high),
        }
    categories = {}
    for col in df.columns:
        nunique = df[col].nunique(dropna=False)
        if 1 < nunique <= 20:
            categories[col] = {str(k) if scalar_text(k) else "<BLANK>": int(v) for k, v in df[col].value_counts(dropna=False).items()}
    return {
        "rows": int(len(df)),
        "columns": list(df.columns),
        "column_count": int(len(df.columns)),
        "exact_duplicate_rows": int(df.duplicated(keep=False).sum()),
        "duplicate_primary_key_rows": duplicate_pk,
        "missing_by_column": missing,
        "blank_cells": sum(missing.values()),
        "unique_by_column": {col: int(df[col].nunique(dropna=False)) for col in df.columns},
        "numeric": numeric,
        "categories": categories,
    }


def clean_base(name: str, df: pd.DataFrame, pk: str, log: ChangeLog) -> pd.DataFrame:
    df = df.copy()
    df.columns = [scalar_text(c) for c in df.columns]
    log.rows_raw = len(df)
    log.blanks_raw = count_blanks(df)
    before = len(df)
    df = df.drop_duplicates(keep="first").copy()
    log.exact_duplicates_removed = before - len(df)

    if pk not in df.columns:
        raise ValueError(f"{name}: falta llave primaria {pk}")
    missing_pk = df[pk].map(lambda x: scalar_text(x) == "")
    if missing_pk.any():
        quarantine_rows(name, df[missing_pk], "MISSING_PRIMARY_KEY")
        log.rows_quarantined += int(missing_pk.sum())
        df = df[~missing_pk].copy()
    df[pk] = df[pk].map(scalar_text)

    duplicate_pk = df.duplicated(subset=[pk], keep="first")
    if duplicate_pk.any():
        quarantine_rows(name, df[duplicate_pk], "DUPLICATE_PRIMARY_KEY")
        log.duplicate_primary_keys_removed += int(duplicate_pk.sum())
        log.rows_quarantined += int(duplicate_pk.sum())
        df = df[~duplicate_pk].copy()
    return df.reset_index(drop=True)


def quarantine_rows(name: str, rows: pd.DataFrame, reason: str) -> None:
    if rows.empty:
        return
    QUARANTINE.mkdir(parents=True, exist_ok=True)
    path = QUARANTINE / f"{name}.csv"
    out = rows.copy()
    out.insert(0, "quality_issue", reason)
    out.to_csv(path, mode="a", header=not path.exists(), index=False, encoding="utf-8-sig")


def add_email_columns(df: pd.DataFrame, column: str, prefix: str, log: ChangeLog) -> None:
    normalized = df[column].map(normalize_email)
    df[column] = normalized.map(lambda x: x[0])
    df[f"{prefix}_match_key"] = df[column].where(df[column] != NO_DATA, NO_DATA)
    df[f"{prefix}_valid"] = normalized.map(lambda x: "FALSE" if x[1]["invalid"] else "TRUE")
    for flag in ["uppercase", "plus_alias", "domain_typo", "invalid"]:
        log.transformations[f"email_{flag}"] += int(normalized.map(lambda x: x[1][flag]).sum())


def add_phone_columns(df: pd.DataFrame, column: str, prefix: str, log: ChangeLog) -> None:
    normalized = df[column].map(normalize_phone)
    df[column] = normalized.map(lambda x: x[0])
    df[f"{prefix}_match_key"] = df[column]
    df[f"{prefix}_valid"] = normalized.map(lambda x: "FALSE" if x[1]["invalid"] or x[1]["missing"] else "TRUE")
    for flag in ["formatted", "missing", "invalid"]:
        log.transformations[f"phone_{flag}"] += int(normalized.map(lambda x: x[1][flag]).sum())


def clean_people(df: pd.DataFrame, log: ChangeLog, profile: bool = False) -> pd.DataFrame:
    for col in ["first_name", "last_name", "city", "country"]:
        if col in df:
            original = df[col].map(scalar_text)
            df[col] = original.map(upper_text).replace("", NO_DATA)
            if col in {"first_name", "last_name"}:
                log.transformations["names_uppercased"] += int((original != df[col]).sum())
    add_email_columns(df, "email", "email", log)
    add_phone_columns(df, "phone", "phone", log)
    full = df["first_name"].replace(NO_DATA, "") + " " + df["last_name"].replace(NO_DATA, "")
    df["full_name"] = full.map(scalar_text).replace("", NO_DATA)
    df["name_match_key"] = df["full_name"].map(match_key).replace("", NO_DATA)
    df["name_tokens_key"] = df["full_name"].map(token_key).replace("", NO_DATA)
    df["birthday"] = normalize_datetime_series(df["birthday"], NO_DATA, date_only=True)
    df["created_at"] = normalize_datetime_series(df["created_at"])
    df["has_membership"] = df["has_membership"].map(normalize_bool)
    df["membership_since"] = normalize_datetime_series(df["membership_since"])
    df.loc[(df["has_membership"] == "FALSE") & (df["membership_since"] == NO_DATA), "membership_since"] = NOT_APPLICABLE
    df["points"] = numeric_series(df["points"], integer=True, default=0).clip(lower=0)

    identity_score = (
        (df["full_name"] != NO_DATA).astype(int)
        + (df["email"] != NO_DATA).astype(int)
        + (df["phone"] != NO_DATA).astype(int)
        + (df["city"] != NO_DATA).astype(int)
    )
    df["identity_fields_available"] = identity_score
    insufficient = identity_score < 2
    if insufficient.any():
        quarantine_rows("boom_profile" if profile else "boom_users", df[insufficient], "INSUFFICIENT_IDENTITY")
        log.rows_dropped_insufficient_identity += int(insufficient.sum())
        log.rows_quarantined += int(insufficient.sum())
        df = df[~insufficient].copy()

    if profile:
        for col in ["tickets_total", "tickets_used", "friends_count"]:
            df[col] = numeric_series(df[col], integer=True, default=0).clip(lower=0)
        df["use_rate"] = numeric_series(df["use_rate"], default=0).clip(lower=0, upper=1)
        df["last_used_at"] = normalize_datetime_series(df["last_used_at"], NOT_APPLICABLE)
    return df.reset_index(drop=True)


def clean_boom_tickets(df: pd.DataFrame, log: ChangeLog) -> pd.DataFrame:
    for col in ["boom_user_id", "event_id"]:
        df[col] = df[col].map(scalar_text)
    df["type"] = df["type"].map(upper_text)
    df["source"] = df["source"].map(upper_text)
    df["created_at"] = normalize_datetime_series(df["created_at"])
    df["used"] = df["used"].map(normalize_bool)
    df["date_used"] = normalize_datetime_series(df["date_used"])
    df.loc[(df["used"] == "FALSE") & (df["date_used"] == NO_DATA), "date_used"] = NOT_APPLICABLE
    required_bad = (
        df[["boom_user_id", "event_id", "type", "source", "created_at", "used"]]
        .isin(["", NO_DATA]).any(axis=1)
        | ((df["used"] == "TRUE") & (df["date_used"] == NO_DATA))
        | ~df["type"].isin(VALID_CATEGORIES["boom_tickets.type"])
        | ~df["source"].isin(VALID_CATEGORIES["boom_tickets.source"])
    )
    if required_bad.any():
        quarantine_rows("boom_tickets", df[required_bad], "INVALID_REQUIRED_FIELD")
        log.rows_quarantined += int(required_bad.sum())
        df = df[~required_bad].copy()

    created = pd.to_datetime(df["created_at"], utc=True, errors="coerce")
    date_used = pd.to_datetime(df["date_used"].replace(NOT_APPLICABLE, pd.NA), utc=True, errors="coerce")
    future = (df["used"] == "TRUE") & (date_used > AS_OF_UTC)
    df["future_used_leak"] = np.where(future, "TRUE", "FALSE")
    eligible = (created <= MATURE_CREATED_CUTOFF) & ~future
    df["eligible_for_training"] = np.where(eligible, "TRUE", "FALSE")
    log.transformations["future_used_leak_flagged"] += int(future.sum())
    log.transformations["mature_training_rows"] += int(eligible.sum())
    return df.reset_index(drop=True)


def clean_social(df: pd.DataFrame) -> pd.DataFrame:
    df["boom_user_id"] = df["boom_user_id"].map(scalar_text)
    df["friends_count"] = numeric_series(df["friends_count"], integer=True, default=0).clip(lower=0)
    return df


def clean_artists(df: pd.DataFrame) -> pd.DataFrame:
    for col in ["name", "home_city", "residency_venue", "residency_weekday"]:
        df[col] = df[col].map(upper_text)
    df["has_residency"] = df["has_residency"].map(normalize_bool)
    for idx in df.index:
        if df.at[idx, "has_residency"] == "FALSE":
            df.at[idx, "residency_venue"] = NOT_APPLICABLE
            df.at[idx, "residency_weekday"] = NOT_APPLICABLE
    for col in ["events_total", "events_past", "events_upcoming", "tickets_sold", "checked_in_count"]:
        df[col] = numeric_series(df[col], integer=True, default=0).clip(lower=0)
    df["attendance_rate_july"] = numeric_series(df["attendance_rate_july"], default=0).clip(lower=0, upper=1)
    return df


def clean_events(df: pd.DataFrame) -> pd.DataFrame:
    for col in ["title", "artist_name", "residency_venue", "residency_weekday", "city", "venue", "weekday", "month"]:
        df[col] = df[col].map(upper_text)
    for col in ["is_residency", "is_paid", "is_upcoming"]:
        df[col] = df[col].map(normalize_bool)
    for idx in df.index:
        if df.at[idx, "is_residency"] == "FALSE":
            df.at[idx, "residency_venue"] = NOT_APPLICABLE
            df.at[idx, "residency_weekday"] = NOT_APPLICABLE
    df["starts_at"] = normalize_datetime_series(df["starts_at"])
    for col in ["capacity", "tickets_sold", "gross_revenue"]:
        df[col] = numeric_series(df[col], integer=True, default=0).clip(lower=0)
    for col in ["checked_in_count", "attendance_rate"]:
        values = pd.to_numeric(df[col], errors="coerce")
        df[col] = [NOT_OBSERVED if month == "AGOSTO" else (0 if pd.isna(v) else v) for v, month in zip(values, df["month"])]
    df["fill_rate"] = numeric_series(df["fill_rate"], default=0).clip(lower=0)
    return df


def clean_sales(df: pd.DataFrame, log: ChangeLog) -> pd.DataFrame:
    df["event_id"] = df["event_id"].map(scalar_text)
    original_names = df["buyer_name"].map(scalar_text)
    df["buyer_name"] = original_names.map(upper_text).replace("", NO_DATA)
    log.transformations["names_uppercased"] += int((original_names != df["buyer_name"]).sum())
    df["buyer_name_match_key"] = df["buyer_name"].map(match_key).replace("", NO_DATA)
    df["buyer_name_tokens_key"] = df["buyer_name"].map(token_key).replace("", NO_DATA)
    add_email_columns(df, "buyer_email", "buyer_email", log)
    add_phone_columns(df, "buyer_phone", "buyer_phone", log)
    df["qty"] = numeric_series(df["qty"], integer=True)
    df["subtotal"] = numeric_series(df["subtotal"], integer=True)
    df["channel"] = df["channel"].map(upper_text)
    df["purchased_at"] = normalize_datetime_series(df["purchased_at"])
    identity_score = (
        (df["buyer_name"] != NO_DATA).astype(int)
        + (df["buyer_email"] != NO_DATA).astype(int)
        + (df["buyer_phone"] != NO_DATA).astype(int)
    )
    df["identity_fields_available"] = identity_score
    bad = (
        (identity_score == 0)
        | df["qty"].isna()
        | (df["qty"] < 1)
        | df["subtotal"].isna()
        | (df["subtotal"] < 0)
        | ~df["channel"].isin(VALID_CATEGORIES["ft_sales.channel"])
        | (df["event_id"] == "")
        | (df["purchased_at"] == NO_DATA)
    )
    if bad.any():
        quarantine_rows("ft_sales", df[bad], "INVALID_OR_INSUFFICIENT_SALE")
        log.rows_dropped_insufficient_identity += int(((identity_score == 0) & bad).sum())
        log.rows_quarantined += int(bad.sum())
        df = df[~bad].copy()
    return df.reset_index(drop=True)


def clean_ft_tickets(df: pd.DataFrame, log: ChangeLog) -> pd.DataFrame:
    for col in ["sale_id", "event_id"]:
        df[col] = df[col].map(scalar_text)
    df["ticket_type"] = df["ticket_type"].map(upper_text)
    df["price"] = numeric_series(df["price"], integer=True)
    df["checked_in"] = df["checked_in"].map(lambda x: normalize_bool(x, NOT_OBSERVED))
    df["checked_in_at"] = normalize_datetime_series(df["checked_in_at"])
    df.loc[(df["checked_in"] == NOT_OBSERVED) & (df["checked_in_at"] == NO_DATA), "checked_in_at"] = NOT_OBSERVED
    df.loc[(df["checked_in"] == "FALSE") & (df["checked_in_at"] == NO_DATA), "checked_in_at"] = NOT_APPLICABLE
    bad = (
        df[["sale_id", "event_id"]].eq("").any(axis=1)
        | ~df["ticket_type"].isin(VALID_CATEGORIES["ft_tickets.ticket_type"])
        | df["price"].isna()
        | (df["price"] < 0)
        | ((df["checked_in"] == "TRUE") & df["checked_in_at"].isin([NO_DATA, NOT_APPLICABLE, NOT_OBSERVED]))
    )
    if bad.any():
        quarantine_rows("ft_tickets", df[bad], "INVALID_TICKET")
        log.rows_quarantined += int(bad.sum())
        df = df[~bad].copy()
    return df.reset_index(drop=True)


def ensure_references(frames: dict[str, pd.DataFrame], logs: dict[str, ChangeLog], integrity: dict[str, Any]) -> None:
    users = set(frames["boom_users"]["boom_user_id"])
    artists = set(frames["ft_artists"]["artist_id"])
    events = set(frames["ft_events"]["event_id"])
    sales = set(frames["ft_sales"]["sale_id"])

    checks = [
        ("boom_profile", "boom_user_id", users, "ORPHAN_USER"),
        ("boom_social", "boom_user_id", users, "ORPHAN_USER"),
        ("boom_tickets", "boom_user_id", users, "ORPHAN_USER"),
        ("ft_events", "artist_id", artists, "ORPHAN_ARTIST"),
        ("ft_sales", "event_id", events, "ORPHAN_EVENT"),
        ("ft_tickets", "event_id", events, "ORPHAN_EVENT"),
        ("ft_tickets", "sale_id", sales, "ORPHAN_SALE"),
    ]
    for name, col, valid, reason in checks:
        df = frames[name]
        invalid = ~df[col].isin(valid)
        count = int(invalid.sum())
        integrity[f"{name}.{col}"] = {"invalid_references": count, "rule": reason}
        if count:
            quarantine_rows(name, df[invalid], reason)
            logs[name].rows_quarantined += count
            frames[name] = df[~invalid].reset_index(drop=True)

    sale_event = frames["ft_sales"].set_index("sale_id")["event_id"]
    tickets = frames["ft_tickets"]
    expected_event = tickets["sale_id"].map(sale_event)
    mismatch = expected_event.notna() & (expected_event != tickets["event_id"])
    integrity["ft_tickets.sale_event_consistency"] = {"mismatches": int(mismatch.sum())}
    if mismatch.any():
        quarantine_rows("ft_tickets", tickets[mismatch], "SALE_EVENT_MISMATCH")
        logs["ft_tickets"].rows_quarantined += int(mismatch.sum())
        frames["ft_tickets"] = tickets[~mismatch].reset_index(drop=True)


def reconcile_summaries(frames: dict[str, pd.DataFrame], integrity: dict[str, Any], logs: dict[str, ChangeLog]) -> None:
    tickets = frames["ft_tickets"]
    sales = frames["ft_sales"].copy()
    ticket_summary = tickets.groupby("sale_id").agg(qty_calc=("ticket_id", "size"), subtotal_calc=("price", "sum"))
    sales = sales.join(ticket_summary, on="sale_id")
    sales["qty_calc"] = sales["qty_calc"].fillna(0).astype("Int64")
    sales["subtotal_calc"] = sales["subtotal_calc"].fillna(0).astype("Int64")
    qty_diff = sales["qty"].astype("Int64") != sales["qty_calc"]
    subtotal_diff = sales["subtotal"].astype("Int64") != sales["subtotal_calc"]
    integrity["ft_sales.ticket_reconciliation"] = {
        "qty_mismatches_corrected": int(qty_diff.sum()),
        "subtotal_mismatches_corrected": int(subtotal_diff.sum()),
    }
    if qty_diff.any():
        logs["ft_sales"].transformations["qty_reconciled_from_tickets"] += int(qty_diff.sum())
        sales.loc[qty_diff, "qty"] = sales.loc[qty_diff, "qty_calc"]
    if subtotal_diff.any():
        logs["ft_sales"].transformations["subtotal_reconciled_from_tickets"] += int(subtotal_diff.sum())
        sales.loc[subtotal_diff, "subtotal"] = sales.loc[subtotal_diff, "subtotal_calc"]
    frames["ft_sales"] = sales.drop(columns=["qty_calc", "subtotal_calc"])

    events = frames["ft_events"].copy()
    t = tickets.copy()
    t["is_checked"] = (t["checked_in"] == "TRUE").astype(int)
    t_summary = t.groupby("event_id").agg(
        tickets_calc=("ticket_id", "size"),
        checked_calc=("is_checked", "sum"),
        revenue_calc=("price", "sum"),
        observed=("checked_in", lambda s: int((s != NOT_OBSERVED).all())),
    )
    events = events.join(t_summary, on="event_id")
    event_mismatch = Counter()
    for idx in events.index:
        sold = int(events.at[idx, "tickets_calc"] or 0)
        checked = int(events.at[idx, "checked_calc"] or 0)
        revenue = int(events.at[idx, "revenue_calc"] or 0)
        if int(events.at[idx, "tickets_sold"]) != sold:
            event_mismatch["tickets_sold"] += 1
        if int(events.at[idx, "gross_revenue"]) != revenue:
            event_mismatch["gross_revenue"] += 1
        events.at[idx, "tickets_sold"] = sold
        events.at[idx, "gross_revenue"] = revenue
        events.at[idx, "fill_rate"] = round(sold / int(events.at[idx, "capacity"]), 4) if int(events.at[idx, "capacity"]) else 0
        if events.at[idx, "month"] == "JULIO":
            current_checked = pd.to_numeric(pd.Series([events.at[idx, "checked_in_count"]]), errors="coerce").iloc[0]
            if pd.isna(current_checked) or int(current_checked) != checked:
                event_mismatch["checked_in_count"] += 1
            events.at[idx, "checked_in_count"] = checked
            events.at[idx, "attendance_rate"] = round(checked / sold, 4) if sold else 0
        else:
            events.at[idx, "checked_in_count"] = NOT_OBSERVED
            events.at[idx, "attendance_rate"] = NOT_OBSERVED
    integrity["ft_events.summary_reconciliation"] = dict(event_mismatch)
    frames["ft_events"] = events.drop(columns=["tickets_calc", "checked_calc", "revenue_calc", "observed"])

    artists = frames["ft_artists"].copy()
    events = frames["ft_events"]
    for idx in artists.index:
        aid = artists.at[idx, "artist_id"]
        ae = events[events["artist_id"] == aid]
        past = ae[ae["month"] == "JULIO"]
        artists.at[idx, "events_total"] = len(ae)
        artists.at[idx, "events_past"] = len(past)
        artists.at[idx, "events_upcoming"] = len(ae) - len(past)
        artists.at[idx, "tickets_sold"] = int(ae["tickets_sold"].astype(int).sum())
        checked = int(pd.to_numeric(past["checked_in_count"], errors="coerce").fillna(0).sum())
        past_tickets = int(past["tickets_sold"].astype(int).sum())
        artists.at[idx, "checked_in_count"] = checked
        artists.at[idx, "attendance_rate_july"] = round(checked / past_tickets, 4) if past_tickets else 0
    frames["ft_artists"] = artists


def add_safe_boom_profile(frames: dict[str, pd.DataFrame]) -> None:
    profile = frames["boom_profile"].copy()
    tickets = frames["boom_tickets"].copy()
    eligible = tickets[tickets["eligible_for_training"] == "TRUE"].copy()
    eligible["used_num"] = (eligible["used"] == "TRUE").astype(int)
    safe = eligible.groupby("boom_user_id").agg(
        model_tickets_total=("boom_ticket_id", "size"),
        model_tickets_used=("used_num", "sum"),
    )
    safe["model_use_rate"] = (safe["model_tickets_used"] / safe["model_tickets_total"]).round(4)
    used = eligible[eligible["used"] == "TRUE"].copy()
    last = used.groupby("boom_user_id")["date_used"].max().rename("model_last_used_at")
    safe = safe.join(last)
    leaks = (
        tickets[tickets["future_used_leak"] == "TRUE"]
        .groupby("boom_user_id").size().rename("future_used_leak_count")
    )
    profile = profile.join(safe, on="boom_user_id").join(leaks, on="boom_user_id")
    for col in ["model_tickets_total", "model_tickets_used", "future_used_leak_count"]:
        profile[col] = profile[col].fillna(0).astype("Int64")
    profile["model_use_rate"] = profile["model_use_rate"].fillna(0).astype(float)
    profile["model_last_used_at"] = profile["model_last_used_at"].fillna(NOT_APPLICABLE)
    profile["model_history_available"] = np.where(profile["model_tickets_total"] > 0, "TRUE", "FALSE")
    profile["model_history_cutoff"] = MATURE_CREATED_CUTOFF.strftime("%Y-%m-%dT%H:%M:%S+00:00")
    frames["boom_profile"] = profile


def replace_remaining_blanks(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    for col in df.columns:
        if pd.api.types.is_numeric_dtype(df[col]):
            # Missing numerics that survive validation receive 0 plus are documented in the report.
            df[col] = df[col].fillna(0)
        else:
            df[col] = df[col].map(lambda x: NO_DATA if scalar_text(x) == "" else x)
    return df


def write_csv(df: pd.DataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(path, index=False, encoding="utf-8-sig", lineterminator="\n")


def build_model_ready(frames: dict[str, pd.DataFrame]) -> dict[str, int]:
    if MODEL.exists():
        shutil.rmtree(MODEL)
    MODEL.mkdir(parents=True)
    counts = {}

    exports: dict[str, pd.DataFrame] = {
        "boom_users.csv": frames["boom_users"],
        "boom_social.csv": frames["boom_social"],
        "ft_artists.csv": frames["ft_artists"],
        "ft_sales.csv": frames["ft_sales"],
    }
    p = frames["boom_profile"].copy()
    drop_raw_metrics = ["tickets_total", "tickets_used", "use_rate", "last_used_at"]
    p = p.drop(columns=[c for c in drop_raw_metrics if c in p])
    p = p.rename(columns={
        "model_tickets_total": "tickets_total",
        "model_tickets_used": "tickets_used",
        "model_use_rate": "use_rate",
        "model_last_used_at": "last_used_at",
    })
    exports["boom_profile.csv"] = p
    exports["boom_tickets_history.csv"] = frames["boom_tickets"][frames["boom_tickets"]["eligible_for_training"] == "TRUE"].copy()

    events = frames["ft_events"]
    exports["ft_events_train_july.csv"] = events[events["month"] == "JULIO"].copy()
    exports["ft_events_score_august.csv"] = events[events["month"] == "AGOSTO"].drop(columns=["checked_in_count", "attendance_rate"]).copy()
    tickets = frames["ft_tickets"]
    exports["ft_tickets_train_july.csv"] = tickets[tickets["checked_in"] != NOT_OBSERVED].copy()
    exports["ft_tickets_score_august.csv"] = tickets[tickets["checked_in"] == NOT_OBSERVED].drop(columns=["checked_in", "checked_in_at"]).copy()

    for file, df in exports.items():
        df = replace_remaining_blanks(df)
        write_csv(df, MODEL / file)
        counts[file] = len(df)
    return counts


def markdown_table(headers: list[str], rows: list[list[Any]]) -> str:
    result = ["| " + " | ".join(headers) + " |", "|" + "|".join(["---"] * len(headers)) + "|"]
    result.extend("| " + " | ".join(str(v) for v in row) + " |" for row in rows)
    return "\n".join(result)


def write_reports(report: dict[str, Any]) -> None:
    REPORTS.mkdir(parents=True, exist_ok=True)
    (REPORTS / "data_quality_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    summary_rows = []
    for name, item in report["files"].items():
        log = item["changes"]
        summary_rows.append([
            name,
            log["rows_raw"],
            log["rows_clean"],
            log["exact_duplicates_removed"] + log["duplicate_primary_keys_removed"],
            log["rows_quarantined"],
            log["blanks_raw"],
            log["blanks_clean"],
        ])

    fixes = report["format_fixes"]
    quality_md = f"""# Reporte de calidad y limpieza de datos

Fecha de corte analítica: **2026-08-01 00:00 America/Bogota**.

## Resumen por archivo

{markdown_table(["Archivo", "Filas raw", "Filas clean", "Duplicados eliminados", "Cuarentena", "Vacíos raw", "Vacíos clean"], summary_rows)}

## Normalizaciones aplicadas

- Nombres de personas, artistas, ciudades, venues y títulos: mayúsculas y espacios compactados.
- Emails: minúsculas, alias `+...` removidos y dominios conocidos corregidos (`gmial`, `hotmial`, `outlok`).
- Teléfonos: solo 10 dígitos colombianos, removiendo formatos y prefijo `57`.
- Fechas: ISO 8601 UTC; cumpleaños en `YYYY-MM-DD`.
- Vacíos semánticos: `SIN_DATO`, `NO_APLICA` o `NO_OBSERVADO` según el caso.
- No se inventaron letras faltantes, dígitos transpuestos ni identidades de pareja/amigo.

{markdown_table(["Cambio", "Cantidad"], [[k, v] for k, v in sorted(fixes.items())])}

## Duplicados e integridad referencial

Los duplicados exactos se eliminan. Una llave primaria repetida o una referencia huérfana se envía a `reports/quarantine/` en vez de escoger arbitrariamente una identidad.

```json
{json.dumps(report['integrity'], ensure_ascii=False, indent=2)}
```

## Valores atípicos

El IQR se usa como detector, no como borrador automático. Precios, cantidades y aforos extremos se conservan si respetan las reglas del negocio; negativos, tasas fuera de `[0,1]` o llaves inválidas se rechazan. El detalle por columna está en `data_quality_report.json`.

## Nulos y datasets para el modelo

Un `null` no siempre es un error. En agosto, `checked_in` es la variable que todavía se debe predecir. Por eso `model_ready/` separa:

- `*_train_july.csv`: etiquetas observadas, sin nulos.
- `*_score_august.csv`: columnas objetivo retiradas, no imputadas.
- `boom_tickets_history.csv`: solo cohorte madura al corte, sin fuga futura.

## Fuga temporal de Boom

Se marcaron **{report['future_leak']['rows']}** tickets usados después del corte, para **{report['future_leak']['users']}** usuarios; la fecha máxima es **{report['future_leak']['max_date_used']}**. `boom_profile.csv` limpio conserva los agregados originales para auditoría y agrega métricas `model_*` recalculadas con historia madura.
"""
    (REPORTS / "data_quality_report.md").write_text(quality_md, encoding="utf-8")

    presentation = f"""# Presentación — calidad de datos FreeTicket y Boom

## Qué encontramos

Las dos plataformas hablan de las mismas personas, pero sus llaves no están listas para un `JOIN` directo. La limpieza resolvió formato; no inventó identidad.

### Nombres

- Venían en mayúsculas, minúsculas, sin tildes, con apellido primero, segundo apellido o inicial.
- Se estandarizaron en **MAYÚSCULAS** y se añadieron claves sin tildes y por tokens para comparar orden distinto.
- Una clave parecida no prueba que sean la misma persona: el resultado final necesita score de confianza.

### Emails

- Se encontraron mayúsculas, alias `+eventos`, y errores `gmial`, `hotmial` y `outlok`.
- Se corrigieron **{fixes.get('email_domain_typo', 0)}** dominios y se removieron **{fixes.get('email_plus_alias', 0)}** alias.
- Una letra faltante o el correo de la pareja no se puede corregir de forma determinista; se conserva para matching probabilístico.

### Teléfonos

- Había cinco formatos, prefijo `57`, espacios, guiones y vacíos.
- Se normalizaron **{fixes.get('phone_formatted', 0)}** valores al formato colombiano de 10 dígitos.
- Dos dígitos transpuestos o el teléfono de otra persona no se “arreglan” sin evidencia.

## Error temporal que puede alterar el modelo

El brief fija el corte en **1 de agosto de 2026**, pero Boom ya marca como usados **{report['future_leak']['rows']} tickets posteriores**, pertenecientes a **{report['future_leak']['users']} usuarios**. La fecha más lejana es **{report['future_leak']['max_date_used']}**.

Ejemplo comprobable: `bm_tkt_0002608` fue creado el 27 de julio pero aparece usado el 26 de agosto. Al agregarse en `boom_profile.csv`, esa asistencia futura aumenta `tickets_used`, `use_rate` y `last_used_at`; el modelo podría aprender usando una respuesta que todavía no existía al momento del pronóstico.

### Decisión aplicada

- `raw/` queda intacto.
- `clean/boom_tickets.csv` marca `future_used_leak` y `eligible_for_training`.
- `model_ready/boom_tickets_history.csv` usa solamente tickets creados hasta el 1 de julio, una cohorte que ya maduró al corte según la ventana de 30 días del generador.
- `model_ready/boom_profile.csv` utiliza tasas recalculadas sobre esa historia segura.

## Nulos: qué se eliminó y qué no

- Filas sin llave primaria, referencias válidas o casi ninguna señal de identidad se eliminan y quedan en cuarentena.
- Vacíos legítimos se convierten en estados explícitos: `NO_APLICA`, `NO_OBSERVADO`, `SIN_DATO`.
- Los check-ins de agosto **no se imputan**: son el objetivo del modelo. En scoring, la columna se retira.

## Resultado

{markdown_table(["Capa", "Uso"], [
    ["raw/", "Fuente original inmutable"],
    ["clean/", "Datos normalizados, validados y trazables"],
    ["model_ready/", "Entrenamiento de julio y scoring de agosto sin fuga ni nulos ambiguos"],
    ["reports/", "Perfilado antes/después, outliers, integridad y cuarentena"],
])}
"""
    (ROOT / "presentacion.md").write_text(presentation, encoding="utf-8")


def main() -> None:
    PROGRESS_FILE.write_text("", encoding="utf-8")
    for directory in [CLEAN, MODEL, REPORTS]:
        if directory.exists():
            shutil.rmtree(directory)
    CLEAN.mkdir(parents=True)
    QUARANTINE.mkdir(parents=True)

    raw_frames: dict[str, pd.DataFrame] = {}
    raw_profiles: dict[str, Any] = {}
    frames: dict[str, pd.DataFrame] = {}
    logs = {name: ChangeLog() for name in FILES}

    for name, spec in FILES.items():
        progress(f"[1/6] inicio perfil raw: {name}")
        path = RAW / spec["file"]
        if not path.exists():
            raise FileNotFoundError(f"Falta {path}. Ejecuta primero ft-hack pull.")
        df = pd.read_csv(path, dtype=str, keep_default_na=False, encoding="utf-8-sig")
        raw_frames[name] = df.copy()
        raw_profiles[name] = profile_frame(name, df, spec["pk"])
        frames[name] = clean_base(name, df, spec["pk"], logs[name])
        progress(f"[1/6] fin perfil raw: {name}")

    progress("[2/6] boom_users")
    frames["boom_users"] = clean_people(frames["boom_users"], logs["boom_users"])
    progress("[2/6] boom_profile")
    frames["boom_profile"] = clean_people(frames["boom_profile"], logs["boom_profile"], profile=True)
    progress("[2/6] boom_tickets")
    frames["boom_tickets"] = clean_boom_tickets(frames["boom_tickets"], logs["boom_tickets"])
    progress("[2/6] boom_social")
    frames["boom_social"] = clean_social(frames["boom_social"])
    progress("[2/6] ft_artists")
    frames["ft_artists"] = clean_artists(frames["ft_artists"])
    progress("[2/6] ft_events")
    frames["ft_events"] = clean_events(frames["ft_events"])
    progress("[2/6] ft_sales")
    frames["ft_sales"] = clean_sales(frames["ft_sales"], logs["ft_sales"])
    progress("[2/6] ft_tickets")
    frames["ft_tickets"] = clean_ft_tickets(frames["ft_tickets"], logs["ft_tickets"])

    progress("[3/6] integridad referencial")
    integrity: dict[str, Any] = {}
    ensure_references(frames, logs, integrity)
    progress("[3/6] reconciliación resúmenes")
    reconcile_summaries(frames, integrity, logs)
    progress("[3/6] perfil Boom seguro")
    add_safe_boom_profile(frames)

    # Orden estable para diffs reproducibles.
    progress("[4/6] escritura clean")
    for name, spec in FILES.items():
        df = replace_remaining_blanks(frames[name])
        df = df.sort_values(spec["pk"], kind="stable").reset_index(drop=True)
        frames[name] = df
        logs[name].rows_clean = len(df)
        logs[name].blanks_clean = count_blanks(df)
        write_csv(df, CLEAN / spec["file"])

    progress("[5/6] model_ready")
    model_counts = build_model_ready(frames)
    progress("[5/6] perfil clean")
    clean_profiles = {name: profile_frame(name, df, FILES[name]["pk"]) for name, df in frames.items()}

    boom_tickets = frames["boom_tickets"]
    future = boom_tickets[boom_tickets["future_used_leak"] == "TRUE"]
    future_dates = pd.to_datetime(future["date_used"], utc=True, errors="coerce")
    format_fixes = Counter()
    for log in logs.values():
        format_fixes.update(log.transformations)

    report = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "as_of_utc": AS_OF_UTC.isoformat(),
        "mature_created_cutoff": MATURE_CREATED_CUTOFF.isoformat(),
        "rules": {
            "names": "uppercase NFC plus match keys without accents and sorted tokens",
            "emails": {"lowercase": True, "remove_plus_alias": True, "domain_typo_map": DOMAIN_TYPOS, "ambiguous_local_typo": "flag/do not invent"},
            "phones": "Colombia 10 digits; strip +57/57 and formatting; transpositions remain probabilistic",
            "dates": "ISO 8601 UTC; birthdays YYYY-MM-DD",
            "missing_text": [NO_DATA, NOT_APPLICABLE, NOT_OBSERVED],
            "duplicates": "remove exact; quarantine conflicting primary keys",
            "outliers": "IQR detect; retain if domain-valid; reject impossible negatives/rates",
        },
        "files": {
            name: {
                "raw_profile": raw_profiles[name],
                "clean_profile": clean_profiles[name],
                "changes": logs[name].as_dict(),
            }
            for name in FILES
        },
        "format_fixes": dict(format_fixes),
        "integrity": integrity,
        "future_leak": {
            "rows": int(len(future)),
            "users": int(future["boom_user_id"].nunique()),
            "min_date_used": None if future.empty else future_dates.min().isoformat(),
            "max_date_used": None if future.empty else future_dates.max().isoformat(),
            "example_ticket_ids": future["boom_ticket_id"].head(10).tolist(),
        },
        "model_ready_rows": model_counts,
    }
    progress("[6/6] reportes y presentación")
    write_reports(report)
    print(json.dumps({
        "clean_rows": {name: len(df) for name, df in frames.items()},
        "model_ready_rows": model_counts,
        "future_leak": report["future_leak"],
        "blanks_clean": {name: logs[name].blanks_clean for name in FILES},
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
