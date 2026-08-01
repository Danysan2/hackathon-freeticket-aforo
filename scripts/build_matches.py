"""Construye un cruce conservador FreeTicket -> Boom.

Entradas:
  clean/ft_sales.csv
  clean/boom_users.csv

Salidas:
  matches.csv                         (contrato del reto)
  match_candidates.csv               (candidatos probabilísticos y pesos)
  new_or_unmatched_buyers.csv         (nuevos o no identificados)
  reports/matches_diagnostics.csv     (trazabilidad por venta)
  reports/matches_review.csv          (casos no resueltos/ambiguos)
  reports/matching_report.json
  reports/matching_report.md

El algoritmo nunca usa comportamiento de asistencia. Solo compara identidad.
Un nombre por sí solo no genera un match automático.
"""

from __future__ import annotations

import json
import math
import unicodedata
from collections import Counter, defaultdict
from difflib import SequenceMatcher
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
BOOM_PATH = ROOT / "clean" / "boom_users.csv"
SALES_PATH = ROOT / "clean" / "ft_sales.csv"
MATCHES_PATH = ROOT / "matches.csv"
MATCH_CANDIDATES_PATH = ROOT / "match_candidates.csv"
UNMATCHED_BUYERS_PATH = ROOT / "new_or_unmatched_buyers.csv"
REPORTS_DIR = ROOT / "reports"

NO_MATCH = "SIN_MATCH"
MIN_ACCEPTED_CONFIDENCE = 0.70
MIN_WINNER_MARGIN = 0.08


def compact(value: object) -> str:
    """Mayúsculas, sin tildes y solo caracteres alfanuméricos."""
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return "".join(ch for ch in text.upper() if ch.isalnum())


def is_true(value: object) -> bool:
    return str(value).strip().lower() == "true"


def tokens(value: object) -> list[str]:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    token = ""
    result: list[str] = []
    for ch in text.upper():
        if ch.isalnum():
            token += ch
        elif token:
            result.append(token)
            token = ""
    if token:
        result.append(token)
    return result


def deletion_signatures(value: str) -> set[str]:
    """Firmas para encontrar edición simple sin comparar el producto cartesiano."""
    if not value:
        return set()
    return {value} | {value[:i] + value[i + 1 :] for i in range(len(value))}


def distance_at_most_one(left: str, right: str) -> bool:
    """Distancia Damerau-Levenshtein <= 1, incluyendo una transposición adyacente."""
    if left == right:
        return True
    if abs(len(left) - len(right)) > 1:
        return False
    if len(left) == len(right):
        diffs = [i for i, (a, b) in enumerate(zip(left, right)) if a != b]
        if len(diffs) == 1:
            return True
        if len(diffs) == 2:
            i, j = diffs
            return j == i + 1 and left[i] == right[j] and left[j] == right[i]
        return False
    short, long = (left, right) if len(left) < len(right) else (right, left)
    i = j = differences = 0
    while i < len(short) and j < len(long):
        if short[i] == long[j]:
            i += 1
            j += 1
        else:
            differences += 1
            j += 1
            if differences > 1:
                return False
    return True


def phone_swap_variants(value: str) -> set[str]:
    """Variantes producidas al intercambiar cualquier pareja de dígitos."""
    result: set[str] = set()
    chars = list(value)
    for i in range(len(chars)):
        for j in range(i + 1, len(chars)):
            if chars[i] == chars[j]:
                continue
            swapped = chars.copy()
            swapped[i], swapped[j] = swapped[j], swapped[i]
            result.add("".join(swapped))
    return result


def name_similarity(sale_name: str, first_name: str, last_name: str) -> float:
    sale_tokens = tokens(sale_name)
    boom_tokens = tokens(f"{first_name} {last_name}")
    if not sale_tokens or not boom_tokens:
        return 0.0

    sale_set, boom_set = set(sale_tokens), set(boom_tokens)
    first = compact(first_name)
    last = compact(last_name)

    # Cubre orden invertido y segundo apellido adicional.
    if first in sale_set and last in sale_set:
        return 1.0

    sale_sorted = "".join(sorted(sale_tokens))
    boom_sorted = "".join(sorted(boom_tokens))
    sequence = SequenceMatcher(None, sale_sorted, boom_sorted).ratio()

    # Inicial + apellido, por ejemplo A. CASTRO frente a ANDRÉS CASTRO.
    if last in sale_set and any(len(t) == 1 and first.startswith(t) for t in sale_tokens):
        sequence = max(sequence, 0.84)

    # Nombre completo con una letra ausente o cambiada.
    if distance_at_most_one(compact(sale_name), compact(f"{first_name}{last_name}")):
        sequence = max(sequence, 0.95)

    overlap = len(sale_set & boom_set) / max(len(boom_set), 1)
    if last in sale_set:
        sequence = max(sequence, 0.55 + 0.40 * overlap)
    return round(min(sequence, 1.0), 4)


def contact_label(score: float) -> str:
    if score >= 1.0:
        return "EXACTO"
    if score >= 0.89:
        return "APROX_1_EDICION"
    return "SIN_EVIDENCIA"


def candidate_confidence(email_score: float, phone_score: float, name_score: float) -> float:
    contacts = sum(score > 0 for score in (email_score, phone_score))
    exact_contacts = sum(score >= 1.0 for score in (email_score, phone_score))

    if contacts == 2:
        if exact_contacts == 2:
            if name_score >= 0.90:
                return 0.995
            if name_score >= 0.75:
                return 0.970
            if name_score >= 0.50:
                return 0.900
            return 0.780
        if name_score >= 0.90:
            return 0.970
        if name_score >= 0.75:
            return 0.940
        if name_score >= 0.50:
            return 0.860
        return 0.720

    if exact_contacts == 1:
        if name_score >= 0.95:
            return 0.960
        if name_score >= 0.82:
            return 0.910
        if name_score >= 0.65:
            return 0.800
        return 0.580

    if contacts == 1:  # contacto aproximado
        if name_score >= 0.95:
            return 0.920
        if name_score >= 0.82:
            return 0.860
        if name_score >= 0.65:
            return 0.740
        return 0.450

    return 0.0


def build_indices(boom: pd.DataFrame) -> dict[str, object]:
    email_exact: dict[str, str] = {}
    phone_exact: dict[str, str] = {}
    email_deletions: defaultdict[str, set[str]] = defaultdict(set)

    for row in boom.itertuples(index=False):
        user_id = row.boom_user_id
        email = str(row.email_match_key)
        phone = str(row.phone_match_key)
        if email and is_true(row.email_valid):
            email_exact[email] = user_id
            for signature in deletion_signatures(email):
                email_deletions[signature].add(user_id)
        if phone and is_true(row.phone_valid):
            phone_exact[phone] = user_id

    return {
        "email_exact": email_exact,
        "phone_exact": phone_exact,
        "email_deletions": email_deletions,
    }


def match_all(boom: pd.DataFrame, sales: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    boom_by_id = boom.set_index("boom_user_id", drop=False)
    indices = build_indices(boom)
    email_exact: dict[str, str] = indices["email_exact"]  # type: ignore[assignment]
    phone_exact: dict[str, str] = indices["phone_exact"]  # type: ignore[assignment]
    email_deletions: dict[str, set[str]] = indices["email_deletions"]  # type: ignore[assignment]

    output_rows: list[dict[str, object]] = []
    diagnostics: list[dict[str, object]] = []
    candidate_rows: list[dict[str, object]] = []

    for sale in sales.itertuples(index=False):
        sale_email = str(sale.buyer_email_match_key)
        sale_phone = str(sale.buyer_phone_match_key)
        candidate_ids: set[str] = set()
        email_scores: defaultdict[str, float] = defaultdict(float)
        phone_scores: defaultdict[str, float] = defaultdict(float)
        exact_email_user = ""
        exact_phone_user = ""

        if sale_email and is_true(sale.buyer_email_valid):
            exact_user = email_exact.get(sale_email)
            if exact_user:
                exact_email_user = exact_user
                email_scores[exact_user] = 1.0
                candidate_ids.add(exact_user)
            for signature in deletion_signatures(sale_email):
                for user_id in email_deletions.get(signature, set()):
                    candidate_email = str(boom_by_id.at[user_id, "email_match_key"])
                    if distance_at_most_one(sale_email, candidate_email):
                        email_scores[user_id] = max(email_scores[user_id], 0.90)
                        candidate_ids.add(user_id)

        if sale_phone and is_true(sale.buyer_phone_valid):
            exact_user = phone_exact.get(sale_phone)
            if exact_user:
                exact_phone_user = exact_user
                phone_scores[exact_user] = 1.0
                candidate_ids.add(exact_user)
            for variant in phone_swap_variants(sale_phone):
                user_id = phone_exact.get(variant)
                if user_id:
                    phone_scores[user_id] = max(phone_scores[user_id], 0.90)
                    candidate_ids.add(user_id)

        scored: list[dict[str, object]] = []
        for user_id in candidate_ids:
            person = boom_by_id.loc[user_id]
            name_score = name_similarity(sale.buyer_name, person.first_name, person.last_name)
            email_score = email_scores[user_id]
            phone_score = phone_scores[user_id]
            confidence = candidate_confidence(email_score, phone_score, name_score)
            method_parts = []
            if email_score:
                method_parts.append(f"EMAIL_{contact_label(email_score)}")
            if phone_score:
                method_parts.append(f"TELEFONO_{contact_label(phone_score)}")
            if name_score >= 0.90:
                method_parts.append("NOMBRE_FUERTE")
            elif name_score >= 0.65:
                method_parts.append("NOMBRE_PARCIAL")
            else:
                method_parts.append("NOMBRE_CONTRADICE")
            scored.append({
                "boom_user_id": user_id,
                "confidence": confidence,
                "email_score": email_score,
                "phone_score": phone_score,
                "name_score": name_score,
                "method": "+".join(method_parts),
            })

        for candidate in scored:
            candidate_rows.append({
                "sale_id": sale.sale_id,
                "boom_user_id": candidate["boom_user_id"],
                "evidence_confidence": candidate["confidence"],
                "candidate_source": "DIRECT_IDENTITY",
                "match_method": candidate["method"],
                "email_score": candidate["email_score"],
                "phone_score": candidate["phone_score"],
                "name_score": candidate["name_score"],
            })

        scored.sort(key=lambda item: (item["confidence"], item["name_score"], item["email_score"] + item["phone_score"]), reverse=True)  # type: ignore[operator]
        top = scored[0] if scored else None
        runner = scored[1] if len(scored) > 1 else None
        top_confidence = float(top["confidence"]) if top else 0.0
        runner_confidence = float(runner["confidence"]) if runner else 0.0
        margin = top_confidence - runner_confidence

        top_exact_contacts = sum(float(top[key]) >= 1.0 for key in ("email_score", "phone_score")) if top else 0
        runner_exact_contacts = sum(float(runner[key]) >= 1.0 for key in ("email_score", "phone_score")) if runner else 0
        # Una llave exacta corroborada por nombre domina una alternativa que
        # solo apareció por una edición aproximada. Dos llaves exactas que
        # apuntan a personas distintas siguen siendo ambiguas.
        exact_dominates_fuzzy = bool(
            top
            and runner
            and top_confidence >= 0.95
            and float(top["name_score"]) >= 0.90
            and top_exact_contacts > runner_exact_contacts
        )

        accepted = bool(
            top
            and top_confidence >= MIN_ACCEPTED_CONFIDENCE
            and (runner is None or margin >= MIN_WINNER_MARGIN or exact_dominates_fuzzy)
        )
        if accepted:
            matched_user = str(top["boom_user_id"])
            confidence = round(top_confidence, 4)
            decision = "MATCH"
            method = str(top["method"])
            match_weight = 1.0 if confidence >= 0.95 else 0.80 if confidence >= 0.90 else 0.60
        else:
            matched_user = NO_MATCH
            confidence = 0.0
            if not scored:
                decision = "SIN_CANDIDATO_DE_CONTACTO"
            elif top_confidence < MIN_ACCEPTED_CONFIDENCE:
                decision = "EVIDENCIA_INSUFICIENTE"
            else:
                decision = "AMBIGUO"
            method = decision
            match_weight = 0.0

        output_rows.append({
            "sale_id": sale.sale_id,
            "boom_user_id": matched_user,
            "confidence": confidence,
        })
        diagnostics.append({
            "sale_id": sale.sale_id,
            "boom_user_id": matched_user,
            "confidence": confidence,
            "match_method": method,
            "match_weight": match_weight,
            "decision": decision,
            "candidate_count": len(scored),
            "exact_email_candidate": exact_email_user or NO_MATCH,
            "exact_phone_candidate": exact_phone_user or NO_MATCH,
            "exact_contact_conflict": bool(exact_email_user and exact_phone_user and exact_email_user != exact_phone_user),
            "top_candidate": str(top["boom_user_id"]) if top else NO_MATCH,
            "top_raw_confidence": round(top_confidence, 4),
            "runner_up_candidate": str(runner["boom_user_id"]) if runner else NO_MATCH,
            "runner_up_confidence": round(runner_confidence, 4),
            "runner_up_email_score": float(runner["email_score"]) if runner else 0.0,
            "runner_up_phone_score": float(runner["phone_score"]) if runner else 0.0,
            "runner_up_name_score": float(runner["name_score"]) if runner else 0.0,
            "confidence_margin": round(margin, 4),
            "email_score": float(top["email_score"]) if top else 0.0,
            "phone_score": float(top["phone_score"]) if top else 0.0,
            "name_score": float(top["name_score"]) if top else 0.0,
        })

    return pd.DataFrame(output_rows), pd.DataFrame(diagnostics), pd.DataFrame(candidate_rows)


def _unique_alias_map(seed: pd.DataFrame, key_columns: list[str]) -> dict[tuple[str, ...], str]:
    usable = seed.copy()
    for column in key_columns:
        usable = usable[usable[column].ne("") & usable[column].ne("SIN_DATO")]
    grouped = usable.groupby(key_columns).boom_user_id.agg(lambda values: sorted(set(values)))
    return {key if isinstance(key, tuple) else (key,): users[0] for key, users in grouped.items() if len(users) == 1}


def apply_learned_aliases(
    matches: pd.DataFrame,
    diagnostics: pd.DataFrame,
    candidates: pd.DataFrame,
    sales: pd.DataFrame,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, dict[str, int]]:
    """Propaga alias nombre+contacto aprendidos solo desde matches muy seguros."""
    matches = matches.copy()
    diagnostics = diagnostics.copy()
    candidates = candidates.copy()
    diagnostics["alias_signals"] = 0
    diagnostics["alias_source"] = "NO_APLICA"

    seed = (
        sales.merge(matches, on="sale_id", validate="one_to_one")
        .merge(diagnostics[["sale_id", "decision", "name_score"]], on="sale_id", validate="one_to_one")
    )
    seed = seed[
        seed.decision.eq("MATCH")
        & pd.to_numeric(seed.confidence).ge(0.95)
        & pd.to_numeric(seed.name_score).ge(0.95)
    ]
    email_aliases = _unique_alias_map(seed[seed.buyer_email_valid.map(is_true)], ["buyer_name_tokens_key", "buyer_email_match_key"])
    phone_aliases = _unique_alias_map(seed[seed.buyer_phone_valid.map(is_true)], ["buyer_name_tokens_key", "buyer_phone_match_key"])

    match_index = matches.set_index("sale_id")
    diag_index = diagnostics.set_index("sale_id")
    direct_by_sale = candidates.groupby("sale_id").boom_user_id.agg(set).to_dict() if not candidates.empty else {}
    alias_rows: list[dict[str, object]] = []
    recovered = conflicts = rejected = 0

    for sale in sales.itertuples(index=False):
        if match_index.at[sale.sale_id, "boom_user_id"] != NO_MATCH:
            continue
        votes: list[tuple[str, str]] = []
        name_key = str(sale.buyer_name_tokens_key)
        if is_true(sale.buyer_email_valid):
            user_id = email_aliases.get((name_key, str(sale.buyer_email_match_key)))
            if user_id:
                votes.append(("NOMBRE+EMAIL_ALIAS", user_id))
        if is_true(sale.buyer_phone_valid):
            user_id = phone_aliases.get((name_key, str(sale.buyer_phone_match_key)))
            if user_id:
                votes.append(("NOMBRE+TELEFONO_ALIAS", user_id))
        if not votes:
            continue

        users = {user_id for _, user_id in votes}
        if len(users) != 1:
            conflicts += 1
            diag_index.at[sale.sale_id, "alias_source"] = "ALIAS_CONTRADICTORIOS"
            diag_index.at[sale.sale_id, "alias_signals"] = len(votes)
            continue

        user_id = next(iter(users))
        sources = sorted(source for source, _ in votes)
        signals = len(sources)
        evidence_confidence = 0.90 if signals >= 2 else 0.82
        base_weight = 0.55 if signals >= 2 else 0.35
        alias_rows.append({
            "sale_id": sale.sale_id,
            "boom_user_id": user_id,
            "evidence_confidence": evidence_confidence,
            "candidate_source": "LEARNED_ALIAS",
            "match_method": "+".join(sources),
            "email_score": 0.0,
            "phone_score": 0.0,
            "name_score": 1.0,
            "source_reliability": base_weight,
        })

        previous_candidates = direct_by_sale.get(sale.sale_id, set())
        previous_decision = str(diag_index.at[sale.sale_id, "decision"])
        compatible = previous_decision == "SIN_CANDIDATO_DE_CONTACTO" or user_id in previous_candidates
        if not compatible:
            rejected += 1
            diag_index.at[sale.sale_id, "alias_source"] = "ALIAS_NO_COMPATIBLE_CON_CANDIDATOS"
            diag_index.at[sale.sale_id, "alias_signals"] = signals
            continue

        match_index.at[sale.sale_id, "boom_user_id"] = user_id
        match_index.at[sale.sale_id, "confidence"] = evidence_confidence
        diag_index.at[sale.sale_id, "boom_user_id"] = user_id
        diag_index.at[sale.sale_id, "confidence"] = evidence_confidence
        diag_index.at[sale.sale_id, "match_method"] = "+".join(sources)
        diag_index.at[sale.sale_id, "decision"] = "MATCH_ALIAS"
        diag_index.at[sale.sale_id, "match_weight"] = base_weight
        diag_index.at[sale.sale_id, "alias_signals"] = signals
        diag_index.at[sale.sale_id, "alias_source"] = "+".join(sources)
        diag_index.at[sale.sale_id, "top_candidate"] = user_id
        diag_index.at[sale.sale_id, "top_raw_confidence"] = evidence_confidence
        recovered += 1

    if alias_rows:
        candidates = pd.concat([candidates, pd.DataFrame(alias_rows)], ignore_index=True)
    if "source_reliability" not in candidates.columns:
        candidates["source_reliability"] = 1.0
    candidates["source_reliability"] = pd.to_numeric(candidates["source_reliability"], errors="coerce").fillna(1.0)

    stats = {
        "safe_seed_sales": int(len(seed)),
        "learned_email_aliases": int(len(email_aliases)),
        "learned_phone_aliases": int(len(phone_aliases)),
        "alias_matches_recovered": int(recovered),
        "alias_conflicts": int(conflicts),
        "alias_candidates_rejected": int(rejected),
    }
    return match_index.reset_index(), diag_index.reset_index(), candidates, stats


def build_probabilistic_candidates(
    candidates: pd.DataFrame,
    sales: pd.DataFrame,
    diagnostics: pd.DataFrame,
) -> pd.DataFrame:
    """Convierte evidencia de candidatos en probabilidades relativas conservadoras."""
    rows: list[dict[str, object]] = []
    grouped = {sale_id: frame for sale_id, frame in candidates.groupby("sale_id")}
    diagnostic_by_sale = diagnostics.set_index("sale_id")

    for sale_id in sales.sale_id:
        frame = grouped.get(sale_id, pd.DataFrame())
        collapsed: list[dict[str, object]] = []
        if not frame.empty:
            for user_id, group in frame.groupby("boom_user_id"):
                best = group.sort_values(["evidence_confidence", "source_reliability"], ascending=False).iloc[0]
                confidence = float(best.evidence_confidence)
                reliability = float(group.source_reliability.max())
                sources = "+".join(sorted(set(group.candidate_source)))
                # Evidencias independientes se suman. Un alias aprendido
                # inclina una contradicción, pero su confiabilidad reducida
                # evita que domine por sí solo.
                strength = sum(
                    math.exp(12.0 * (float(row.evidence_confidence) - 0.75)) * float(row.source_reliability)
                    for row in group.itertuples(index=False)
                )
                collapsed.append({
                    "boom_user_id": user_id,
                    "strength": strength,
                    "evidence_confidence": confidence,
                    "source_reliability": reliability,
                    "candidate_source": sources,
                    "match_method": str(best.match_method),
                    "email_score": float(best.email_score),
                    "phone_score": float(best.phone_score),
                    "name_score": float(best.name_score),
                })

        # El estado SIN_MATCH siempre compite; evita forzar un candidato débil.
        collapsed.append({
            "boom_user_id": NO_MATCH,
            "strength": 1.0,
            "evidence_confidence": 0.0,
            "source_reliability": 0.0,
            "candidate_source": "NO_MATCH_PRIOR",
            "match_method": "NUEVO_O_NO_IDENTIFICADO",
            "email_score": 0.0,
            "phone_score": 0.0,
            "name_score": 0.0,
        })
        total = sum(float(item["strength"]) for item in collapsed)
        collapsed.sort(key=lambda item: float(item["strength"]), reverse=True)
        decision = str(diagnostic_by_sale.at[sale_id, "decision"])
        if str(diagnostic_by_sale.at[sale_id, "boom_user_id"]) != NO_MATCH:
            sale_history_cap = float(diagnostic_by_sale.at[sale_id, "match_weight"])
        elif decision == "AMBIGUO":
            sale_history_cap = 0.20
        elif decision == "EVIDENCIA_INSUFICIENTE":
            sale_history_cap = 0.10
        else:
            sale_history_cap = 0.0
        for rank, item in enumerate(collapsed, start=1):
            probability = float(item["strength"]) / total
            rows.append({
                "sale_id": sale_id,
                "candidate_rank": rank,
                "boom_user_id": item["boom_user_id"],
                "candidate_probability": round(probability, 6),
                "evidence_confidence": round(float(item["evidence_confidence"]), 4),
                "model_history_weight": round(probability * sale_history_cap if item["boom_user_id"] != NO_MATCH else 0.0, 6),
                "candidate_source": item["candidate_source"],
                "match_method": item["match_method"],
                "email_score": item["email_score"],
                "phone_score": item["phone_score"],
                "name_score": item["name_score"],
            })
    return pd.DataFrame(rows)


def build_unmatched_buyers(
    matches: pd.DataFrame,
    diagnostics: pd.DataFrame,
    candidates: pd.DataFrame,
    sales: pd.DataFrame,
) -> pd.DataFrame:
    unresolved = sales.merge(matches[matches.boom_user_id.eq(NO_MATCH)], on="sale_id", validate="one_to_one")
    unresolved = unresolved.merge(diagnostics[["sale_id", "decision", "top_candidate", "top_raw_confidence"]], on="sale_id", validate="one_to_one")
    sin_probability = candidates[candidates.boom_user_id.eq(NO_MATCH)][["sale_id", "candidate_probability"]].rename(columns={"candidate_probability": "sin_match_probability"})
    unresolved = unresolved.merge(sin_probability, on="sale_id", validate="one_to_one")
    unresolved["buyer_status"] = unresolved.decision.map(
        lambda value: "NEW_OR_UNKNOWN" if value == "SIN_CANDIDATO_DE_CONTACTO" else "UNRESOLVED_IDENTITY"
    )
    return unresolved[[
        "sale_id", "buyer_name", "buyer_email", "buyer_phone", "buyer_status",
        "boom_user_id", "confidence", "sin_match_probability", "top_candidate",
        "top_raw_confidence", "decision",
    ]]


def validate(
    matches: pd.DataFrame,
    diagnostics: pd.DataFrame,
    probabilistic: pd.DataFrame,
    unmatched_buyers: pd.DataFrame,
    sales: pd.DataFrame,
    boom: pd.DataFrame,
) -> list[dict[str, object]]:
    valid_users = set(boom.boom_user_id) | {NO_MATCH}
    probability_sums = probabilistic.groupby("sale_id").candidate_probability.sum()
    checks = [
        {"check": "una fila por venta", "passed": len(matches) == len(sales), "evidence": len(matches)},
        {"check": "sale_id único", "passed": matches.sale_id.is_unique, "evidence": int(matches.sale_id.duplicated().sum())},
        {"check": "todas las ventas cubiertas", "passed": set(matches.sale_id) == set(sales.sale_id), "evidence": len(set(sales.sale_id) - set(matches.sale_id))},
        {"check": "usuarios existentes o SIN_MATCH", "passed": set(matches.boom_user_id).issubset(valid_users), "evidence": len(set(matches.boom_user_id) - valid_users)},
        {"check": "cero nulos", "passed": int(matches.isna().sum().sum()) == 0, "evidence": int(matches.isna().sum().sum())},
        {"check": "confianza válida", "passed": bool(matches.confidence.between(0, 1).all()), "evidence": [float(matches.confidence.min()), float(matches.confidence.max())]},
        {"check": "SIN_MATCH tiene confianza cero", "passed": bool(matches.loc[matches.boom_user_id.eq(NO_MATCH), "confidence"].eq(0).all()), "evidence": int(matches.loc[matches.boom_user_id.eq(NO_MATCH), "confidence"].ne(0).sum())},
        {"check": "match supera umbral", "passed": bool(matches.loc[matches.boom_user_id.ne(NO_MATCH), "confidence"].ge(MIN_ACCEPTED_CONFIDENCE).all()), "evidence": MIN_ACCEPTED_CONFIDENCE},
        {"check": "diagnóstico uno a uno", "passed": len(diagnostics) == len(matches) and diagnostics.sale_id.is_unique, "evidence": len(diagnostics)},
        {"check": "candidatos cubren todas las ventas", "passed": set(probabilistic.sale_id) == set(sales.sale_id), "evidence": len(set(sales.sale_id) - set(probabilistic.sale_id))},
        {"check": "candidato único por venta y usuario", "passed": not probabilistic.duplicated(["sale_id", "boom_user_id"]).any(), "evidence": int(probabilistic.duplicated(["sale_id", "boom_user_id"]).sum())},
        {"check": "toda venta conserva SIN_MATCH", "passed": probabilistic[probabilistic.boom_user_id.eq(NO_MATCH)].sale_id.nunique() == len(sales), "evidence": int(probabilistic[probabilistic.boom_user_id.eq(NO_MATCH)].sale_id.nunique())},
        {"check": "probabilidades suman uno", "passed": bool((probability_sums.sub(1).abs() < 1e-5).all()), "evidence": float(probability_sums.sub(1).abs().max())},
        {"check": "pesos del modelo válidos", "passed": bool(probabilistic.model_history_weight.between(0, 1).all()), "evidence": [float(probabilistic.model_history_weight.min()), float(probabilistic.model_history_weight.max())]},
        {"check": "compradores no resueltos permanecen SIN_MATCH", "passed": unmatched_buyers.boom_user_id.eq(NO_MATCH).all() and len(unmatched_buyers) == matches.boom_user_id.eq(NO_MATCH).sum(), "evidence": len(unmatched_buyers)},
    ]
    for check in checks:
        check["passed"] = bool(check["passed"])
    if not all(check["passed"] for check in checks):
        failed = [check for check in checks if not check["passed"]]
        raise AssertionError(f"Falló la validación del cruce: {failed}")
    return checks


def write_reports(
    matches: pd.DataFrame,
    diagnostics: pd.DataFrame,
    checks: list[dict[str, object]],
    sales: pd.DataFrame,
    alias_stats: dict[str, int],
    unmatched_buyers: pd.DataFrame,
) -> dict[str, object]:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    matched = matches.boom_user_id.ne(NO_MATCH)
    high = matches.confidence.ge(0.90)
    probable = matches.confidence.between(0.70, 0.8999)

    decision_counts = diagnostics.decision.value_counts().to_dict()
    method_counts = diagnostics.loc[diagnostics.boom_user_id.ne(NO_MATCH), "match_method"].value_counts().to_dict()

    # Conflicto directo: email y teléfono exactos apuntaron a candidatos distintos.
    exact_conflicts = diagnostics[diagnostics.exact_contact_conflict]

    report: dict[str, object] = {
        "inputs": {"sales": len(sales), "boom_users": 6000},
        "thresholds": {"minimum_confidence": MIN_ACCEPTED_CONFIDENCE, "minimum_margin": MIN_WINNER_MARGIN},
        "results": {
            "matched": int(matched.sum()),
            "unmatched": int((~matched).sum()),
            "coverage_rate": round(float(matched.mean()), 4),
            "high_confidence": int((matched & high).sum()),
            "probable": int((matched & probable).sum()),
            "unique_boom_users_matched": int(matches.loc[matched, "boom_user_id"].nunique()),
            "new_or_unknown": int(unmatched_buyers.buyer_status.eq("NEW_OR_UNKNOWN").sum()),
            "unresolved_identity": int(unmatched_buyers.buyer_status.eq("UNRESOLVED_IDENTITY").sum()),
        },
        "learned_aliases": alias_stats,
        "decisions": {str(k): int(v) for k, v in decision_counts.items()},
        "methods": {str(k): int(v) for k, v in method_counts.items()},
        "exact_email_phone_conflicts": {
            "total": int(len(exact_conflicts)),
            "resolved": int(exact_conflicts.boom_user_id.ne(NO_MATCH).sum()),
            "unresolved": int(exact_conflicts.boom_user_id.eq(NO_MATCH).sum()),
        },
        "validation": checks,
        "limitations": [
            "FreeTicket no incluye ciudad del comprador; la ciudad del evento no se usa como identidad.",
            "Un nombre por sí solo nunca crea un match automático.",
            "La identidad corresponde al comprador de la venta, no necesariamente a sus acompañantes.",
            "Email o teléfono de pareja/familiar se descarta cuando el nombre contradice y no hay corroboración.",
        ],
    }

    diagnostics.to_csv(REPORTS_DIR / "matches_diagnostics.csv", index=False, encoding="utf-8")
    diagnostics.loc[diagnostics.boom_user_id.eq(NO_MATCH)].to_csv(REPORTS_DIR / "matches_review.csv", index=False, encoding="utf-8")
    (REPORTS_DIR / "matching_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# Reporte del cruce FreeTicket → Boom",
        "",
        f"- Ventas procesadas: **{len(matches):,}**",
        f"- Matches aceptados: **{int(matched.sum()):,} ({float(matched.mean()):.2%})**",
        f"- Confianza alta (≥ 0,90): **{int((matched & high).sum()):,}**",
        f"- Matches probables (0,70–0,8999): **{int((matched & probable).sum()):,}**",
        f"- Sin match: **{int((~matched).sum()):,}**",
        f"- Usuarios Boom distintos conectados: **{int(matches.loc[matched, 'boom_user_id'].nunique()):,}**",
        f"- Recuperados por alias seguros: **{alias_stats['alias_matches_recovered']:,}**",
        f"- Nuevos o sin evidencia de identidad: **{int(unmatched_buyers.buyer_status.eq('NEW_OR_UNKNOWN').sum()):,}**",
        f"- Identidades ambiguas no resueltas: **{int(unmatched_buyers.buyer_status.eq('UNRESOLVED_IDENTITY').sum()):,}**",
        "",
        "## Reglas",
        "",
        "- Email exacto o con una sola edición conocida.",
        "- Teléfono exacto o con dos dígitos intercambiados.",
        "- El nombre resuelve contradicciones y debe corroborar contactos aislados.",
        "- El nombre solo no produce match.",
        "- Si los dos candidatos quedan demasiado cerca, el resultado es `SIN_MATCH`.",
        "- No se usa asistencia pasada ni futura para decidir identidad.",
        "- Los alias se aprenden como nombre+contacto desde matches directos ≥ 0,95.",
        "- Los matches por alias reciben peso reducido para el modelo.",
        "",
        "## Validación",
        "",
        "| Check | Estado | Evidencia |",
        "|---|---|---|",
    ]
    for check in checks:
        lines.append(f"| {check['check']} | {'PASS' if check['passed'] else 'FAIL'} | {check['evidence']} |")
    lines += [
        "",
        "## Limitaciones",
        "",
        "- FreeTicket no trae ciudad del comprador; no se sustituye con la ciudad del evento.",
        "- Una venta con varios tickets identifica al comprador, no a cada acompañante.",
        "- Los casos sin evidencia suficiente quedan disponibles en `matches_review.csv`.",
    ]
    (REPORTS_DIR / "matching_report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return report


def main() -> None:
    boom = pd.read_csv(BOOM_PATH, dtype=str, keep_default_na=False)
    sales = pd.read_csv(SALES_PATH, dtype=str, keep_default_na=False)

    matches, diagnostics, raw_candidates = match_all(boom, sales)
    matches, diagnostics, raw_candidates, alias_stats = apply_learned_aliases(matches, diagnostics, raw_candidates, sales)
    probabilistic = build_probabilistic_candidates(raw_candidates, sales, diagnostics)
    unmatched_buyers = build_unmatched_buyers(matches, diagnostics, probabilistic, sales)
    checks = validate(matches, diagnostics, probabilistic, unmatched_buyers, sales, boom)
    report = write_reports(matches, diagnostics, checks, sales, alias_stats, unmatched_buyers)
    matches.to_csv(MATCHES_PATH, index=False, encoding="utf-8")
    probabilistic.to_csv(MATCH_CANDIDATES_PATH, index=False, encoding="utf-8")
    unmatched_buyers.to_csv(UNMATCHED_BUYERS_PATH, index=False, encoding="utf-8")
    print(json.dumps({
        "output": str(MATCHES_PATH),
        "candidates": str(MATCH_CANDIDATES_PATH),
        "unmatched_buyers": str(UNMATCHED_BUYERS_PATH),
        **report["results"],
        **alias_stats,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
