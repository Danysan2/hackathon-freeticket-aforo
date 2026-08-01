"""Verificación independiente de las tablas ticket-level del modelo."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / "model_ready"
REPORTS_DIR = ROOT / "reports"


def add(checks: list[dict[str, object]], name: str, passed: object, evidence: object) -> None:
    checks.append({"check": name, "passed": bool(passed), "evidence": evidence})


def main() -> None:
    train = pd.read_csv(MODEL_DIR / "training_tickets.csv")
    score = pd.read_csv(MODEL_DIR / "scoring_tickets.csv")
    source_train = pd.read_csv(MODEL_DIR / "ft_tickets_train_july.csv")
    source_score = pd.read_csv(MODEL_DIR / "ft_tickets_score_august.csv")
    source_sales = pd.read_csv(MODEL_DIR / "ft_sales.csv")
    config = json.loads((MODEL_DIR / "training_features.json").read_text(encoding="utf-8"))

    checks: list[dict[str, object]] = []
    add(checks, "filas de entrenamiento preservadas", len(train) == len(source_train), len(train))
    add(checks, "filas de scoring preservadas", len(score) == len(source_score), len(score))
    add(checks, "ticket_id train único", train.ticket_id.is_unique, int(train.ticket_id.duplicated().sum()))
    add(checks, "ticket_id score único", score.ticket_id.is_unique, int(score.ticket_id.duplicated().sum()))
    add(checks, "mismos tickets de julio", set(train.ticket_id) == set(source_train.ticket_id), len(set(train.ticket_id) ^ set(source_train.ticket_id)))
    add(checks, "mismos tickets de agosto", set(score.ticket_id) == set(source_score.ticket_id), len(set(score.ticket_id) ^ set(source_score.ticket_id)))
    add(checks, "objetivo solo en train", "checked_in" in train and "checked_in" not in score, ["checked_in" in train, "checked_in" in score])
    add(checks, "objetivo binario completo", train.checked_in.isin([0, 1]).all() and train.checked_in.notna().all(), train.checked_in.value_counts().to_dict())
    add(checks, "esquema train/score compatible", [c for c in train.columns if c != "checked_in"] == list(score.columns), len(score.columns))
    add(checks, "cero nulos", int(train.isna().sum().sum() + score.isna().sum().sum()) == 0, int(train.isna().sum().sum() + score.isna().sum().sum()))
    add(checks, "cero textos vacíos", int(train.astype(str).eq("").sum().sum() + score.astype(str).eq("").sum().sum()) == 0, int(train.astype(str).eq("").sum().sum() + score.astype(str).eq("").sum().sum()))

    forbidden = set(config["forbidden_leakage_columns"])
    present_forbidden = sorted(forbidden & (set(train.columns) | set(score.columns)))
    add(checks, "columnas de fuga excluidas", not present_forbidden, present_forbidden)
    add(checks, "objetivo no figura como predictor", "checked_in" not in config["categorical_features"] + config["numeric_features"], "checked_in")
    add(checks, "56 variables declaradas", len(config["categorical_features"]) + len(config["numeric_features"]) == 56, len(config["categorical_features"]) + len(config["numeric_features"]))
    add(checks, "variables declaradas existen", set(config["categorical_features"] + config["numeric_features"]).issubset(train.columns), len(set(config["categorical_features"] + config["numeric_features"]) - set(train.columns)))

    numeric_columns = config["numeric_features"]
    train_numeric = train[numeric_columns].apply(pd.to_numeric, errors="coerce")
    score_numeric = score[numeric_columns].apply(pd.to_numeric, errors="coerce")
    add(checks, "predictores numéricos válidos", np.isfinite(train_numeric.to_numpy()).all() and np.isfinite(score_numeric.to_numpy()).all(), int(train_numeric.isna().sum().sum() + score_numeric.isna().sum().sum()))

    weight_columns = [
        "sale_boom_identity_weight", "sale_boom_history_weight",
        "ticket_boom_identity_weight", "ticket_boom_history_weight",
        "boom_top_candidate_probability", "boom_sin_match_probability",
    ]
    weights = pd.concat([train[weight_columns], score[weight_columns]], ignore_index=True)
    add(checks, "probabilidades y pesos entre 0 y 1", weights.ge(0).all().all() and weights.le(1).all().all(), [float(weights.min().min()), float(weights.max().max())])
    add(checks, "tasas Boom entre 0 y 1", train.boom_use_rate_expected.between(0, 1).all() and score.boom_use_rate_expected.between(0, 1).all(), [float(train.boom_use_rate_expected.min()), float(train.boom_use_rate_expected.max())])
    add(checks, "membresía esperada entre 0 y 1", train.boom_membership_probability.between(0, 1).all() and score.boom_membership_probability.between(0, 1).all(), [float(train.boom_membership_probability.min()), float(train.boom_membership_probability.max())])

    all_table = pd.concat([train.drop(columns=["checked_in"]), score], ignore_index=True)
    source_qty = source_sales.set_index("sale_id").qty.astype(float)
    expected_qty = all_table.sale_id.map(source_qty)
    add(checks, "cantidad de venta reconciliada", all_table.sale_qty.eq(expected_qty).all(), int(all_table.sale_qty.ne(expected_qty).sum()))
    add(checks, "anticipación no negativa", all_table.purchase_lead_hours.ge(0).all(), float(all_table.purchase_lead_hours.min()))
    add(checks, "cortesía + pagada = 1", np.allclose(all_table.event_courtesy_share + all_table.event_paid_share, 1), float((all_table.event_courtesy_share + all_table.event_paid_share - 1).abs().max()))
    add(checks, "mezcla de tipos suma 1", np.allclose(all_table[["event_courtesy_share", "event_general_share", "event_preferential_share", "event_vip_share"]].sum(axis=1), 1), float((all_table[["event_courtesy_share", "event_general_share", "event_preferential_share", "event_vip_share"]].sum(axis=1) - 1).abs().max()))
    add(checks, "aforo restante no negativo", all_table.event_remaining_capacity.ge(0).all(), float(all_table.event_remaining_capacity.min()))

    expected_ticket_weight = all_table.sale_boom_identity_weight / all_table.sale_qty
    add(checks, "peso de comprador atenuado por qty", np.allclose(all_table.ticket_boom_identity_weight, expected_ticket_weight, atol=1e-6), float((all_table.ticket_boom_identity_weight - expected_ticket_weight).abs().max()))
    expected_history_weight = all_table.sale_boom_history_weight / all_table.sale_qty
    add(checks, "peso histórico atenuado por qty", np.allclose(all_table.ticket_boom_history_weight, expected_history_weight, atol=1e-6), float((all_table.ticket_boom_history_weight - expected_history_weight).abs().max()))

    unresolved_statuses = ["NEW_OR_UNKNOWN", "UNRESOLVED_IDENTITY"]
    add(checks, "no resueltos conservan SIN_MATCH", all_table.loc[all_table.match_status.isin(unresolved_statuses), "matched_boom_user_id"].eq("SIN_MATCH").all(), int(all_table.loc[all_table.match_status.isin(unresolved_statuses), "matched_boom_user_id"].ne("SIN_MATCH").sum()))
    resolved_statuses = ["DIRECT_HIGH", "DIRECT_PROBABLE", "ALIAS_PROBABLE"]
    add(checks, "resueltos tienen usuario Boom", all_table.loc[all_table.match_status.isin(resolved_statuses), "matched_boom_user_id"].ne("SIN_MATCH").all(), int(all_table.loc[all_table.match_status.isin(resolved_statuses), "matched_boom_user_id"].eq("SIN_MATCH").sum()))
    add(checks, "julio solo en entrenamiento", train.split_month.eq("JULIO").all(), train.split_month.value_counts().to_dict())
    add(checks, "agosto solo en scoring", score.split_month.eq("AGOSTO").all(), score.split_month.value_counts().to_dict())

    for table_name, table in [("train", train), ("score", score)]:
        source = source_train if table_name == "train" else source_score
        expected_counts = source.groupby("event_id").size()
        actual_counts = table.groupby("event_id").event_ticket_count.first()
        mismatch = int(actual_counts.ne(expected_counts).sum())
        add(checks, f"conteo de tickets por evento {table_name}", mismatch == 0, mismatch)

    failures = [check for check in checks if not check["passed"]]
    report = {
        "status": "PASS" if not failures else "FAIL",
        "checks_total": len(checks),
        "checks_passed": len(checks) - len(failures),
        "failures": failures,
        "checks": checks,
    }
    (REPORTS_DIR / "training_table_verification.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [
        "# Verificación de las tablas del modelo", "",
        f"Estado: **{report['status']}**", f"Checks aprobados: **{report['checks_passed']}/{report['checks_total']}**", "",
        "| Check | Estado | Evidencia |", "|---|---|---|",
    ]
    for check in checks:
        lines.append(f"| {check['check']} | {'PASS' if check['passed'] else 'FAIL'} | {check['evidence']} |")
    (REPORTS_DIR / "training_table_verification.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({key: report[key] for key in ["status", "checks_total", "checks_passed", "failures"]}, ensure_ascii=False, indent=2))
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
