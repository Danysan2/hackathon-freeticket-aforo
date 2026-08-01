"""Verifica comparación, modelos serializados y forecast final."""

from __future__ import annotations

import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / ".python_packages"))

import joblib  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from catboost import CatBoostClassifier  # noqa: E402


MODEL_DIR = ROOT / "model_ready"
ARTIFACT_DIR = ROOT / "outputs" / "models"
REPORTS_DIR = ROOT / "reports"
MODEL_NAMES = ["ticket_type_baseline", "logistic_regression", "catboost", "xgboost"]


def add(checks: list[dict[str, object]], name: str, passed: object, evidence: object) -> None:
    checks.append({"check": name, "passed": bool(passed), "evidence": evidence})


def winner_predict(winner: str, score: pd.DataFrame, categorical: list[str], numeric: list[str]) -> np.ndarray:
    X = score[categorical + numeric].copy()
    X[categorical] = X[categorical].astype(str)
    X[numeric] = X[numeric].astype(float)
    if winner == "catboost":
        model = CatBoostClassifier()
        model.load_model(str(ARTIFACT_DIR / "catboost.cbm"))
        return model.predict_proba(X)[:, 1]
    if winner in {"logistic_regression", "xgboost"}:
        model = joblib.load(ARTIFACT_DIR / f"{winner}.joblib")
        return model.predict_proba(X)[:, 1]
    baseline = json.loads((ARTIFACT_DIR / "ticket_type_baseline.json").read_text(encoding="utf-8"))
    return score.ticket_type.map(baseline["rates"]).fillna(baseline["global_rate"]).to_numpy(dtype=float)


def main() -> None:
    comparison = pd.read_csv(REPORTS_DIR / "model_comparison.csv")
    oof_ticket = pd.read_csv(REPORTS_DIR / "oof_ticket_predictions.csv")
    oof_event = pd.read_csv(REPORTS_DIR / "oof_event_predictions.csv")
    forecast = pd.read_csv(ROOT / "forecast.csv")
    forecast_comparison = pd.read_csv(REPORTS_DIR / "forecast_comparison_august.csv")
    ticket_predictions = pd.read_csv(ARTIFACT_DIR / "ticket_predictions_august.csv")
    train = pd.read_csv(MODEL_DIR / "training_tickets.csv")
    score = pd.read_csv(MODEL_DIR / "scoring_tickets.csv")
    config = json.loads((MODEL_DIR / "training_features.json").read_text(encoding="utf-8"))
    winner_meta = json.loads((ARTIFACT_DIR / "winner.json").read_text(encoding="utf-8"))
    report = json.loads((REPORTS_DIR / "model_report.json").read_text(encoding="utf-8"))
    winner = str(comparison.sort_values("rank").iloc[0].model)

    checks: list[dict[str, object]] = []
    add(checks, "cuatro modelos comparados", set(comparison.model) == set(MODEL_NAMES) and len(comparison) == 4, comparison.model.tolist())
    add(checks, "ranks únicos 1..4", sorted(comparison["rank"].tolist()) == [1, 2, 3, 4], comparison["rank"].tolist())
    ordered = comparison.sort_values(["event_mae", "event_wape", "ticket_brier"]).model.tolist()
    add(checks, "ranking sigue criterio declarado", ordered == comparison.sort_values("rank").model.tolist(), ordered)
    add(checks, "ganador consistente en metadatos", winner == winner_meta["winner"] == report["winner"], [winner, winner_meta["winner"], report["winner"]])

    probability_columns = [f"p_{name}" for name in MODEL_NAMES]
    add(checks, "OOF cubre todos los tickets", len(oof_ticket) == len(train) and set(oof_ticket.ticket_id) == set(train.ticket_id), len(oof_ticket))
    add(checks, "OOF probabilidades completas", oof_ticket[probability_columns].notna().all().all(), int(oof_ticket[probability_columns].isna().sum().sum()))
    add(checks, "OOF probabilidades válidas", oof_ticket[probability_columns].ge(0).all().all() and oof_ticket[probability_columns].le(1).all().all(), [float(oof_ticket[probability_columns].min().min()), float(oof_ticket[probability_columns].max().max())])
    add(checks, "OOF evento contiene 32 por modelo", oof_event.groupby("model").event_id.nunique().eq(32).all(), oof_event.groupby("model").event_id.nunique().to_dict())

    actual_total = float(train.checked_in.sum())
    add(checks, "total real OOF reconciliado", oof_event.groupby("model").actual_attendance.sum().eq(actual_total).all(), actual_total)
    winner_ticket_sum = oof_ticket[f"p_{winner}"].sum()
    winner_event_sum = oof_event.loc[oof_event.model.eq(winner), "predicted_attendance"].sum()
    add(checks, "predicción OOF ticket/evento reconciliada", np.isclose(winner_ticket_sum, winner_event_sum), float(abs(winner_ticket_sum - winner_event_sum)))

    artifact_paths = [
        ARTIFACT_DIR / "ticket_type_baseline.json",
        ARTIFACT_DIR / "logistic_regression.joblib",
        ARTIFACT_DIR / "catboost.cbm",
        ARTIFACT_DIR / "xgboost.joblib",
        ARTIFACT_DIR / "environment.json",
    ]
    add(checks, "artefactos de los cuatro modelos existen", all(path.exists() and path.stat().st_size > 0 for path in artifact_paths), {path.name: path.stat().st_size if path.exists() else 0 for path in artifact_paths})

    add(checks, "predicciones agosto cubren tickets", len(ticket_predictions) == len(score) and set(ticket_predictions.ticket_id) == set(score.ticket_id), len(ticket_predictions))
    add(checks, "predicciones agosto válidas", ticket_predictions[probability_columns].ge(0).all().all() and ticket_predictions[probability_columns].le(1).all().all(), [float(ticket_predictions[probability_columns].min().min()), float(ticket_predictions[probability_columns].max().max())])
    reloaded = winner_predict(winner, score, config["categorical_features"], config["numeric_features"])
    saved = ticket_predictions[f"p_{winner}"].to_numpy(dtype=float)
    add(checks, "modelo ganador serializado reproduce probabilidades", np.allclose(reloaded, saved, atol=1e-8), float(np.max(np.abs(reloaded - saved))))

    add(checks, "forecast contiene 30 eventos", len(forecast) == 30 and forecast.event_id.is_unique, len(forecast))
    add(checks, "contrato forecast exacto", list(forecast.columns) == ["event_id", "expected_attendance", "p10", "p90"], list(forecast.columns))
    add(checks, "intervalos ordenados", (forecast.p10.le(forecast.expected_attendance) & forecast.expected_attendance.le(forecast.p90)).all(), int((~(forecast.p10.le(forecast.expected_attendance) & forecast.expected_attendance.le(forecast.p90))).sum()))
    ticket_counts = score.groupby("event_id").size()
    limits = forecast.event_id.map(ticket_counts)
    add(checks, "forecast limitado a tickets adquiridos", forecast.p10.ge(0).all() and forecast.p90.le(limits).all(), [float(forecast.p10.min()), float((forecast.p90 - limits).max())])
    expected_from_tickets = ticket_predictions.groupby("event_id")[f"p_{winner}"].sum()
    expected_saved = forecast.set_index("event_id").expected_attendance
    add(checks, "expected attendance suma probabilidades", np.allclose(expected_saved, expected_from_tickets.loc[expected_saved.index], atol=0.051), float(np.max(np.abs(expected_saved - expected_from_tickets.loc[expected_saved.index]))))
    add(checks, "eventos train y score no se cruzan", set(train.event_id).isdisjoint(set(score.event_id)), len(set(train.event_id) & set(score.event_id)))

    fold_events = report["cross_validation"]["fold_events"]
    flattened = [event for events in fold_events.values() for event in events]
    add(checks, "folds cubren cada evento una vez", len(flattened) == len(set(flattened)) == train.event_id.nunique(), len(flattened))
    stability = report["paired_selection_stability"]
    add(checks, "estabilidad compara 32 eventos", stability["events_compared"] == 32, stability)

    failures = [check for check in checks if not check["passed"]]
    verification = {
        "status": "PASS" if not failures else "FAIL",
        "checks_total": len(checks),
        "checks_passed": len(checks) - len(failures),
        "failures": failures,
        "checks": checks,
    }
    (REPORTS_DIR / "model_verification.json").write_text(json.dumps(verification, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = [
        "# Verificación de modelos y forecast", "",
        f"Estado: **{verification['status']}**", f"Checks aprobados: **{verification['checks_passed']}/{verification['checks_total']}**", "",
        "| Check | Estado | Evidencia |", "|---|---|---|",
    ]
    for check in checks:
        lines.append(f"| {check['check']} | {'PASS' if check['passed'] else 'FAIL'} | {check['evidence']} |")
    (REPORTS_DIR / "model_verification.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({key: verification[key] for key in ["status", "checks_total", "checks_passed", "failures"]}, ensure_ascii=False, indent=2))
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
