"""Publica el forecast entrenado en el contrato estático de la app web."""

from __future__ import annotations

import csv
import json
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FORECAST = ROOT / "forecast.csv"
OUTPUT = ROOT / "web" / "src" / "data" / "model.json"
Z90 = 1.2816


def main() -> None:
    events: dict[str, dict[str, float]] = {}
    with FORECAST.open(encoding="utf-8-sig", newline="") as source:
        for row in csv.DictReader(source):
            expected = float(row["expected_attendance"])
            p10 = float(row["p10"])
            p90 = float(row["p90"])
            # La interfaz usa una desviación simétrica; conservamos el ancho total
            # del intervalo p10-p90 calibrado por el pipeline de entrenamiento.
            sd = max((p90 - p10) / (2 * Z90), 0.1)
            events[row["event_id"]] = {
                "baseline": round(expected, 1),
                "sd": round(sd, 2),
            }

    payload = {
        "version": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "rates": {},
        "events": events,
    }
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Modelo web publicado: {len(events)} eventos -> {OUTPUT}")


if __name__ == "__main__":
    main()
