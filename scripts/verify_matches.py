"""Verificación independiente de matches.csv y su diagnóstico."""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
NO_MATCH = "SIN_MATCH"


def add(checks: list[dict[str, object]], name: str, passed: bool, evidence: object) -> None:
    checks.append({"check": name, "passed": bool(passed), "evidence": evidence})


def main() -> None:
    matches = pd.read_csv(ROOT / "matches.csv", dtype=str, keep_default_na=False)
    diagnostics = pd.read_csv(ROOT / "reports" / "matches_diagnostics.csv", dtype=str, keep_default_na=False)
    candidates = pd.read_csv(ROOT / "match_candidates.csv", dtype=str, keep_default_na=False)
    unmatched_buyers = pd.read_csv(ROOT / "new_or_unmatched_buyers.csv", dtype=str, keep_default_na=False)
    sales = pd.read_csv(ROOT / "clean" / "ft_sales.csv", dtype=str, keep_default_na=False)
    boom = pd.read_csv(ROOT / "clean" / "boom_users.csv", dtype=str, keep_default_na=False)
    confidence = pd.to_numeric(matches.confidence, errors="coerce")

    checks: list[dict[str, object]] = []
    add(checks, "esquema contractual exacto", list(matches.columns) == ["sale_id", "boom_user_id", "confidence"], list(matches.columns))
    add(checks, "una fila por venta", len(matches) == len(sales), len(matches))
    add(checks, "sale_id único", matches.sale_id.is_unique, int(matches.sale_id.duplicated().sum()))
    add(checks, "mismo conjunto de ventas", set(matches.sale_id) == set(sales.sale_id), len(set(matches.sale_id) ^ set(sales.sale_id)))
    add(checks, "cero celdas vacías", int(matches.eq("").sum().sum()) == 0, int(matches.eq("").sum().sum()))
    add(checks, "confianza numérica 0..1", confidence.notna().all() and confidence.between(0, 1).all(), [float(confidence.min()), float(confidence.max())])

    valid_users = set(boom.boom_user_id) | {NO_MATCH}
    add(checks, "usuarios Boom válidos", set(matches.boom_user_id).issubset(valid_users), len(set(matches.boom_user_id) - valid_users))
    add(checks, "SIN_MATCH con confianza cero", confidence[matches.boom_user_id.eq(NO_MATCH)].eq(0).all(), int(confidence[matches.boom_user_id.eq(NO_MATCH)].ne(0).sum()))
    add(checks, "matches con confianza mínima", confidence[matches.boom_user_id.ne(NO_MATCH)].ge(0.70).all(), float(confidence[matches.boom_user_id.ne(NO_MATCH)].min()))

    joined = matches.merge(diagnostics, on="sale_id", how="left", suffixes=("", "_diag"), validate="one_to_one")
    add(checks, "diagnóstico completo", len(joined) == len(matches) and joined.decision.ne("").all(), len(joined))
    match_decision = joined.decision.isin(["MATCH", "MATCH_ALIAS"])
    add(checks, "decisión coincide con salida", ((joined.boom_user_id.ne(NO_MATCH)) == match_decision).all(), int(((joined.boom_user_id.ne(NO_MATCH)) != match_decision).sum()))
    add(checks, "usuario coincide con diagnóstico", joined.boom_user_id.eq(joined.boom_user_id_diag).all(), int(joined.boom_user_id.ne(joined.boom_user_id_diag).sum()))
    add(checks, "ningún match por nombre solamente", ~((joined.decision.eq("MATCH")) & pd.to_numeric(joined.email_score).eq(0) & pd.to_numeric(joined.phone_score).eq(0)).any(), int(((joined.decision.eq("MATCH")) & pd.to_numeric(joined.email_score).eq(0) & pd.to_numeric(joined.phone_score).eq(0)).sum()))

    candidate_probability = pd.to_numeric(candidates.candidate_probability, errors="coerce")
    history_weight = pd.to_numeric(candidates.model_history_weight, errors="coerce")
    probability_sums = candidates.assign(p=candidate_probability).groupby("sale_id").p.sum()
    add(checks, "candidatos probabilísticos cubren ventas", set(candidates.sale_id) == set(sales.sale_id), len(set(sales.sale_id) - set(candidates.sale_id)))
    add(checks, "probabilidades suman uno", bool((probability_sums.sub(1).abs() < 1e-5).all()), float(probability_sums.sub(1).abs().max()))
    add(checks, "toda venta conserva candidato SIN_MATCH", candidates[candidates.boom_user_id.eq(NO_MATCH)].sale_id.nunique() == len(sales), int(candidates[candidates.boom_user_id.eq(NO_MATCH)].sale_id.nunique()))
    add(checks, "pesos probabilísticos válidos", history_weight.notna().all() and history_weight.between(0, 1).all(), [float(history_weight.min()), float(history_weight.max())])
    add(checks, "archivo de nuevos/no identificados coincide", len(unmatched_buyers) == matches.boom_user_id.eq(NO_MATCH).sum() and unmatched_buyers.boom_user_id.eq(NO_MATCH).all(), len(unmatched_buyers))
    alias_weights = pd.to_numeric(joined.loc[joined.decision.eq("MATCH_ALIAS"), "match_weight"], errors="coerce")
    add(checks, "alias tienen peso reducido", alias_weights.le(0.55).all(), float(alias_weights.max()) if len(alias_weights) else 0.0)
    alias_sales = set(joined.loc[joined.decision.eq("MATCH_ALIAS"), "sale_id"])
    alias_candidate_weight = candidates[candidates.sale_id.isin(alias_sales)].assign(weight=history_weight[candidates.sale_id.isin(alias_sales)]).groupby("sale_id").weight.sum()
    add(checks, "peso probabilístico total de alias limitado", alias_candidate_weight.le(0.35001).all(), float(alias_candidate_weight.max()) if len(alias_candidate_weight) else 0.0)

    # La misma identidad de venta exacta debe recibir siempre la misma decisión.
    identity = sales[["sale_id", "buyer_name_match_key", "buyer_email_match_key", "buyer_phone_match_key"]].merge(matches, on="sale_id", validate="one_to_one")
    inconsistent = (
        identity.groupby(["buyer_name_match_key", "buyer_email_match_key", "buyer_phone_match_key"], dropna=False)
        .boom_user_id.nunique()
        .gt(1)
        .sum()
    )
    add(checks, "identidades repetidas son consistentes", int(inconsistent) == 0, int(inconsistent))

    failures = [check for check in checks if not check["passed"]]
    report = {"status": "PASS" if not failures else "FAIL", "checks_total": len(checks), "checks_passed": len(checks) - len(failures), "failures": failures, "checks": checks}
    report_path = ROOT / "reports" / "matching_verification.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# Verificación del cruce FreeTicket → Boom",
        "",
        f"Estado: **{report['status']}**",
        f"Checks aprobados: **{report['checks_passed']}/{report['checks_total']}**",
        "",
        "| Check | Estado | Evidencia |",
        "|---|---|---|",
    ]
    for check in checks:
        lines.append(f"| {check['check']} | {'PASS' if check['passed'] else 'FAIL'} | {check['evidence']} |")
    (ROOT / "reports" / "matching_verification.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({key: report[key] for key in ("status", "checks_total", "checks_passed", "failures")}, ensure_ascii=False, indent=2))
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
