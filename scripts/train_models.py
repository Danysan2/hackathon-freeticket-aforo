"""Entrena, compara y selecciona modelos de asistencia por ticket.

Selección primaria: MAE de asistentes por evento en predicciones OOF.
Desempates: WAPE por evento y Brier por ticket.
"""

from __future__ import annotations

import json
import math
import sys
from importlib.metadata import version
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / ".python_packages"))

import joblib  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from catboost import CatBoostClassifier  # noqa: E402
from sklearn.compose import ColumnTransformer  # noqa: E402
from sklearn.linear_model import LogisticRegression  # noqa: E402
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score  # noqa: E402
from sklearn.model_selection import GroupKFold  # noqa: E402
from sklearn.pipeline import Pipeline  # noqa: E402
from sklearn.preprocessing import OneHotEncoder, StandardScaler  # noqa: E402
from xgboost import XGBClassifier  # noqa: E402


MODEL_DIR = ROOT / "model_ready"
OUTPUT_DIR = ROOT / "outputs" / "models"
REPORTS_DIR = ROOT / "reports"
FORECAST_PATH = ROOT / "forecast.csv"
RANDOM_SEED = 42
N_SPLITS = 5
MODEL_NAMES = ["ticket_type_baseline", "logistic_regression", "catboost", "xgboost"]


def prepare_xy(frame: pd.DataFrame, categorical: list[str], numeric: list[str]) -> pd.DataFrame:
    result = frame[categorical + numeric].copy()
    result[categorical] = result[categorical].astype(str)
    result[numeric] = result[numeric].astype(float)
    return result


def clip_probability(values: np.ndarray) -> np.ndarray:
    return np.clip(np.asarray(values, dtype=float), 1e-6, 1 - 1e-6)


def fit_baseline(train: pd.DataFrame, alpha: float = 30.0) -> dict[str, object]:
    global_rate = float(train.checked_in.mean())
    grouped = train.groupby("ticket_type").checked_in.agg(["sum", "count"])
    rates = ((grouped["sum"] + alpha * global_rate) / (grouped["count"] + alpha)).to_dict()
    return {"global_rate": global_rate, "alpha": alpha, "rates": {str(k): float(v) for k, v in rates.items()}}


def predict_baseline(model: dict[str, object], frame: pd.DataFrame) -> np.ndarray:
    rates = model["rates"]
    global_rate = float(model["global_rate"])
    return clip_probability(frame.ticket_type.map(rates).fillna(global_rate).to_numpy(dtype=float))


def make_preprocessor(categorical: list[str], numeric: list[str], scale_numeric: bool) -> ColumnTransformer:
    numeric_transformer = StandardScaler() if scale_numeric else "passthrough"
    return ColumnTransformer(
        transformers=[
            ("categorical", OneHotEncoder(handle_unknown="ignore", sparse_output=True), categorical),
            ("numeric", numeric_transformer, numeric),
        ],
        remainder="drop",
    )


def make_logistic(categorical: list[str], numeric: list[str]) -> Pipeline:
    return Pipeline([
        ("preprocess", make_preprocessor(categorical, numeric, scale_numeric=True)),
        ("model", LogisticRegression(C=0.35, max_iter=2500, solver="lbfgs", random_state=RANDOM_SEED)),
    ])


def make_xgboost(categorical: list[str], numeric: list[str]) -> Pipeline:
    return Pipeline([
        ("preprocess", make_preprocessor(categorical, numeric, scale_numeric=False)),
        ("model", XGBClassifier(
            n_estimators=350,
            max_depth=3,
            learning_rate=0.035,
            min_child_weight=12,
            subsample=0.85,
            colsample_bytree=0.85,
            reg_alpha=0.2,
            reg_lambda=6.0,
            objective="binary:logistic",
            eval_metric="logloss",
            random_state=RANDOM_SEED,
            n_jobs=4,
            tree_method="hist",
        )),
    ])


def make_catboost(iterations: int = 450) -> CatBoostClassifier:
    return CatBoostClassifier(
        iterations=iterations,
        depth=4,
        learning_rate=0.035,
        l2_leaf_reg=8.0,
        random_strength=0.5,
        loss_function="Logloss",
        eval_metric="Logloss",
        random_seed=RANDOM_SEED,
        verbose=False,
        allow_writing_files=False,
        thread_count=4,
    )


def model_metrics(y: np.ndarray, probabilities: np.ndarray, events: pd.Series) -> tuple[dict[str, float], pd.DataFrame]:
    p = clip_probability(probabilities)
    ticket_metrics = {
        "ticket_log_loss": float(log_loss(y, p)),
        "ticket_brier": float(brier_score_loss(y, p)),
        "ticket_auc": float(roc_auc_score(y, p)),
    }
    event = pd.DataFrame({"event_id": events.to_numpy(), "actual": y, "predicted": p}).groupby("event_id").agg(
        actual_attendance=("actual", "sum"),
        predicted_attendance=("predicted", "sum"),
        tickets=("actual", "size"),
    ).reset_index()
    event["residual_actual_minus_predicted"] = event.actual_attendance - event.predicted_attendance
    event["absolute_error"] = event.residual_actual_minus_predicted.abs()
    event["squared_error"] = event.residual_actual_minus_predicted.pow(2)
    event_metrics = {
        "event_mae": float(event.absolute_error.mean()),
        "event_rmse": float(math.sqrt(event.squared_error.mean())),
        "event_wape": float(event.absolute_error.sum() / event.actual_attendance.sum()),
        "event_bias_pred_minus_actual": float((event.predicted_attendance - event.actual_attendance).mean()),
        "predicted_total": float(event.predicted_attendance.sum()),
        "actual_total": float(event.actual_attendance.sum()),
    }
    return {**event_metrics, **ticket_metrics}, event


def cross_validate_models(
    train: pd.DataFrame,
    categorical: list[str],
    numeric: list[str],
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, dict[str, list[int]]]:
    X = prepare_xy(train, categorical, numeric)
    y = train.checked_in.to_numpy(dtype=int)
    groups = train.event_id
    splitter = GroupKFold(n_splits=N_SPLITS, shuffle=True, random_state=RANDOM_SEED)
    folds = list(splitter.split(X, y, groups))
    oof = {name: np.full(len(train), np.nan, dtype=float) for name in MODEL_NAMES}
    cat_iterations: list[int] = []
    fold_rows: list[dict[str, object]] = []
    fold_events: dict[str, list[int]] = {}

    for fold, (train_idx, valid_idx) in enumerate(folds, start=1):
        train_fold = train.iloc[train_idx]
        valid_fold = train.iloc[valid_idx]
        X_train, X_valid = X.iloc[train_idx], X.iloc[valid_idx]
        y_train, y_valid = y[train_idx], y[valid_idx]
        fold_events[str(fold)] = sorted(valid_fold.event_id.unique().tolist())

        baseline = fit_baseline(train_fold)
        oof["ticket_type_baseline"][valid_idx] = predict_baseline(baseline, valid_fold)

        logistic = make_logistic(categorical, numeric)
        logistic.fit(X_train, y_train)
        oof["logistic_regression"][valid_idx] = logistic.predict_proba(X_valid)[:, 1]

        cat = make_catboost()
        cat.fit(
            X_train,
            y_train,
            cat_features=categorical,
            eval_set=(X_valid, y_valid),
            early_stopping_rounds=60,
            use_best_model=True,
            verbose=False,
        )
        oof["catboost"][valid_idx] = cat.predict_proba(X_valid)[:, 1]
        best_iteration = int(cat.get_best_iteration()) + 1
        cat_iterations.append(max(best_iteration, 25))

        xgb = make_xgboost(categorical, numeric)
        xgb.fit(X_train, y_train)
        oof["xgboost"][valid_idx] = xgb.predict_proba(X_valid)[:, 1]

        for model_name in MODEL_NAMES:
            metrics, _ = model_metrics(y_valid, oof[model_name][valid_idx], valid_fold.event_id)
            fold_rows.append({"fold": fold, "model": model_name, "validation_events": valid_fold.event_id.nunique(), **metrics})

    comparison_rows: list[dict[str, object]] = []
    event_frames: list[pd.DataFrame] = []
    oof_frame = train[["ticket_id", "sale_id", "event_id", "ticket_type", "checked_in"]].copy()
    for model_name in MODEL_NAMES:
        if np.isnan(oof[model_name]).any():
            raise ValueError(f"Predicciones OOF incompletas para {model_name}")
        oof_frame[f"p_{model_name}"] = clip_probability(oof[model_name])
        metrics, event = model_metrics(y, oof[model_name], train.event_id)
        comparison_rows.append({"model": model_name, **metrics})
        event.insert(0, "model", model_name)
        event_frames.append(event)

    comparison = pd.DataFrame(comparison_rows).sort_values(
        ["event_mae", "event_wape", "ticket_brier"], ascending=True
    ).reset_index(drop=True)
    comparison.insert(0, "rank", np.arange(1, len(comparison) + 1))
    return comparison, oof_frame, pd.concat(event_frames, ignore_index=True), {
        "fold_events": fold_events,
        "catboost_best_iterations": cat_iterations,
        "fold_metrics": fold_rows,
    }


def fit_all_models(
    train: pd.DataFrame,
    score: pd.DataFrame,
    categorical: list[str],
    numeric: list[str],
    cat_iterations: list[int],
) -> tuple[dict[str, np.ndarray], dict[str, object]]:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    X_train = prepare_xy(train, categorical, numeric)
    X_score = prepare_xy(score, categorical, numeric)
    y = train.checked_in.to_numpy(dtype=int)
    predictions: dict[str, np.ndarray] = {}
    models: dict[str, object] = {}

    baseline = fit_baseline(train)
    predictions["ticket_type_baseline"] = predict_baseline(baseline, score)
    (OUTPUT_DIR / "ticket_type_baseline.json").write_text(json.dumps(baseline, ensure_ascii=False, indent=2), encoding="utf-8")
    models["ticket_type_baseline"] = baseline

    logistic = make_logistic(categorical, numeric)
    logistic.fit(X_train, y)
    predictions["logistic_regression"] = clip_probability(logistic.predict_proba(X_score)[:, 1])
    joblib.dump(logistic, OUTPUT_DIR / "logistic_regression.joblib")
    models["logistic_regression"] = logistic

    final_iterations = int(np.median(cat_iterations)) if cat_iterations else 250
    cat = make_catboost(iterations=max(final_iterations, 25))
    cat.fit(X_train, y, cat_features=categorical, verbose=False)
    predictions["catboost"] = clip_probability(cat.predict_proba(X_score)[:, 1])
    cat.save_model(str(OUTPUT_DIR / "catboost.cbm"))
    models["catboost"] = cat

    xgb = make_xgboost(categorical, numeric)
    xgb.fit(X_train, y)
    predictions["xgboost"] = clip_probability(xgb.predict_proba(X_score)[:, 1])
    joblib.dump(xgb, OUTPUT_DIR / "xgboost.joblib")
    models["xgboost"] = xgb
    return predictions, {"models": models, "catboost_final_iterations": final_iterations}


def build_forecasts(
    score: pd.DataFrame,
    predictions: dict[str, np.ndarray],
    winner: str,
    oof_events: pd.DataFrame,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    ticket_predictions = score[["ticket_id", "sale_id", "event_id", "ticket_type"]].copy()
    for model_name, values in predictions.items():
        ticket_predictions[f"p_{model_name}"] = values

    event_comparison = score[["event_id", "event_title", "event_artist_name", "event_starts_at", "event_ticket_count"]].drop_duplicates("event_id")
    for model_name in MODEL_NAMES:
        sums = ticket_predictions.groupby("event_id")[f"p_{model_name}"].sum()
        event_comparison[f"expected_{model_name}"] = event_comparison.event_id.map(sums)

    winner_events = oof_events[oof_events.model.eq(winner)]
    residuals = winner_events.residual_actual_minus_predicted.to_numpy(dtype=float)
    residuals = residuals - residuals.mean()
    lower_residual, upper_residual = np.quantile(residuals, [0.10, 0.90])
    expected_column = f"expected_{winner}"
    forecast = event_comparison[["event_id", "event_ticket_count", expected_column]].copy()
    forecast.rename(columns={expected_column: "expected_attendance"}, inplace=True)
    forecast["p10"] = np.minimum(forecast.expected_attendance, forecast.expected_attendance + lower_residual)
    forecast["p90"] = np.maximum(forecast.expected_attendance, forecast.expected_attendance + upper_residual)
    for column in ["expected_attendance", "p10", "p90"]:
        forecast[column] = forecast[column].clip(lower=0, upper=forecast.event_ticket_count).round(1)
    forecast = forecast[["event_id", "expected_attendance", "p10", "p90"]].sort_values("event_id")
    interval = pd.DataFrame([{
        "winner": winner,
        "oof_event_residual_p10_centered": float(lower_residual),
        "oof_event_residual_p90_centered": float(upper_residual),
        "oof_event_residual_sd": float(np.std(residuals, ddof=1)),
    }])
    return forecast, event_comparison.sort_values("event_id"), ticket_predictions, interval


def feature_importance(winner: str, fitted: dict[str, object], categorical: list[str], numeric: list[str]) -> pd.DataFrame:
    model = fitted["models"][winner]
    if winner == "catboost":
        values = model.get_feature_importance()
        names = categorical + numeric
        return pd.DataFrame({"feature": names, "importance": values}).sort_values("importance", ascending=False)
    if winner == "logistic_regression":
        pipeline = model
        names = pipeline.named_steps["preprocess"].get_feature_names_out()
        values = np.abs(pipeline.named_steps["model"].coef_[0])
        return pd.DataFrame({"feature": names, "importance": values}).sort_values("importance", ascending=False)
    if winner == "xgboost":
        pipeline = model
        names = pipeline.named_steps["preprocess"].get_feature_names_out()
        values = pipeline.named_steps["model"].feature_importances_
        return pd.DataFrame({"feature": names, "importance": values}).sort_values("importance", ascending=False)
    baseline = fitted["models"][winner]
    return pd.DataFrame({"feature": list(baseline["rates"]), "importance": list(baseline["rates"].values())}).sort_values("importance", ascending=False)


def write_report(
    comparison: pd.DataFrame,
    winner: str,
    cv_meta: dict[str, object],
    interval: pd.DataFrame,
    importance: pd.DataFrame,
    train: pd.DataFrame,
    score: pd.DataFrame,
    oof_events: pd.DataFrame,
) -> None:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    winner_row = comparison[comparison.model.eq(winner)].iloc[0]
    runner_up = str(comparison.iloc[1].model)
    paired = oof_events.pivot(index="event_id", columns="model", values="absolute_error")
    paired_difference = (paired[winner] - paired[runner_up]).to_numpy(dtype=float)
    rng = np.random.default_rng(RANDOM_SEED)
    bootstrap = np.mean(
        rng.choice(paired_difference, size=(10000, len(paired_difference)), replace=True),
        axis=1,
    )
    stability = {
        "runner_up": runner_up,
        "winner_better_events": int((paired_difference < 0).sum()),
        "events_compared": int(len(paired_difference)),
        "mean_mae_difference_winner_minus_runner": float(paired_difference.mean()),
        "bootstrap_95_ci": [float(value) for value in np.quantile(bootstrap, [0.025, 0.975])],
    }
    report = {
        "winner": winner,
        "selection_rule": "minimum event_mae; tie-break event_wape then ticket_brier",
        "training_rows": len(train),
        "training_events": int(train.event_id.nunique()),
        "scoring_rows": len(score),
        "scoring_events": int(score.event_id.nunique()),
        "cross_validation": {"method": "GroupKFold", "n_splits": N_SPLITS, **cv_meta},
        "comparison": comparison.to_dict("records"),
        "winner_metrics": winner_row.to_dict(),
        "paired_selection_stability": stability,
        "interval_method": interval.iloc[0].to_dict(),
        "top_features": importance.head(15).to_dict("records"),
        "limitations": [
            "Solo existen 32 eventos etiquetados; las métricas tienen incertidumbre alta.",
            "Los intervalos p10-p90 usan residuales OOF empíricos y deben recalibrarse con más meses.",
            "La predicción cubre únicamente tickets adquiridos al corte, no ventas futuras.",
        ],
    }
    (REPORTS_DIR / "model_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# Comparación de modelos de asistencia", "",
        f"Modelo seleccionado: **{winner}**", "",
        "Criterio principal: menor MAE de asistentes por evento en predicciones fuera de muestra agrupadas por `event_id`.", "",
        "| Rank | Modelo | MAE evento | RMSE evento | WAPE evento | Brier ticket | Log-loss | AUC |",
        "|---:|---|---:|---:|---:|---:|---:|---:|",
    ]
    for row in comparison.itertuples(index=False):
        lines.append(
            f"| {row.rank} | {row.model} | {row.event_mae:.3f} | {row.event_rmse:.3f} | "
            f"{row.event_wape:.3%} | {row.ticket_brier:.4f} | {row.ticket_log_loss:.4f} | {row.ticket_auc:.4f} |"
        )
    lines += [
        "", "## Interpretación", "",
        "Las probabilidades se suman por evento para obtener `expected_attendance`. El rango p10–p90 se construye con la distribución de errores por evento observada en validación cruzada, centrada en cero y limitada entre 0 y los tickets adquiridos.",
        f"El ganador superó a {runner_up} en **{stability['winner_better_events']} de {stability['events_compared']} eventos**. La diferencia media de MAE ganador−segundo fue {stability['mean_mae_difference_winner_minus_runner']:.3f}; bootstrap 95 % [{stability['bootstrap_95_ci'][0]:.3f}, {stability['bootstrap_95_ci'][1]:.3f}].",
        "", "## Variables con mayor influencia del ganador", "",
    ]
    for row in importance.head(10).itertuples(index=False):
        lines.append(f"- `{row.feature}`: {row.importance:.4f}")
    lines += [
        "", "## Limitaciones", "",
        "- Solo hay 32 eventos históricos; no debe interpretarse una diferencia pequeña como una verdad permanente.",
        "- La proyección corresponde a los tickets adquiridos al corte y no anticipa ventas nuevas.",
        "- Los rangos deben recalibrarse cuando haya varios meses adicionales.",
    ]
    (REPORTS_DIR / "model_report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    train = pd.read_csv(MODEL_DIR / "training_tickets.csv")
    score = pd.read_csv(MODEL_DIR / "scoring_tickets.csv")
    config = json.loads((MODEL_DIR / "training_features.json").read_text(encoding="utf-8"))
    categorical = config["categorical_features"]
    numeric = config["numeric_features"]

    comparison, oof_tickets, oof_events, cv_meta = cross_validate_models(train, categorical, numeric)
    winner = str(comparison.iloc[0].model)
    predictions, fitted = fit_all_models(train, score, categorical, numeric, cv_meta["catboost_best_iterations"])
    forecast, event_comparison, ticket_predictions, interval = build_forecasts(score, predictions, winner, oof_events)
    importance = feature_importance(winner, fitted, categorical, numeric)

    comparison.to_csv(REPORTS_DIR / "model_comparison.csv", index=False, encoding="utf-8")
    pd.DataFrame(cv_meta["fold_metrics"]).to_csv(REPORTS_DIR / "model_fold_metrics.csv", index=False, encoding="utf-8")
    oof_tickets.to_csv(REPORTS_DIR / "oof_ticket_predictions.csv", index=False, encoding="utf-8")
    oof_events.to_csv(REPORTS_DIR / "oof_event_predictions.csv", index=False, encoding="utf-8")
    event_comparison.to_csv(REPORTS_DIR / "forecast_comparison_august.csv", index=False, encoding="utf-8")
    ticket_predictions.to_csv(OUTPUT_DIR / "ticket_predictions_august.csv", index=False, encoding="utf-8")
    importance.to_csv(REPORTS_DIR / "winner_feature_importance.csv", index=False, encoding="utf-8")
    forecast.to_csv(FORECAST_PATH, index=False, encoding="utf-8")
    interval.to_csv(REPORTS_DIR / "forecast_interval_calibration.csv", index=False, encoding="utf-8")
    (OUTPUT_DIR / "winner.json").write_text(json.dumps({
        "winner": winner,
        "selection_rule": "event_mae, event_wape, ticket_brier",
        "features_config": str(MODEL_DIR / "training_features.json"),
        "catboost_final_iterations": fitted["catboost_final_iterations"],
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUTPUT_DIR / "environment.json").write_text(json.dumps({
        package: version(package)
        for package in ["pandas", "numpy", "scipy", "scikit-learn", "catboost", "xgboost", "joblib"]
    }, indent=2), encoding="utf-8")
    write_report(comparison, winner, cv_meta, interval, importance, train, score, oof_events)
    print(json.dumps({
        "winner": winner,
        "comparison": comparison[["rank", "model", "event_mae", "event_wape", "ticket_brier"]].to_dict("records"),
        "forecast": str(FORECAST_PATH),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
