/**
 * Punto de intercambio entre el modelo local y el modelo entrenado.
 *
 * Mientras el modelo se entrena, `predict()` corre en el navegador con la calibración
 * de julio. Cuando exista el endpoint, basta con definir VITE_FORECAST_API en Vercel:
 * la app llama al servicio y usa el local sólo como respaldo si falla.
 *
 * Contrato esperado del endpoint (POST):
 *   { event_id, levers: { cortesia, boomMembresia, boomConsumo, convertirCortesias } }
 *   -> { expected_attendance, p10, p90, overflow_risk?, lift? }
 */
import { predictLocal, type Forecast, type Levers } from './model';
import type { EventRow } from './types';

const API = import.meta.env.VITE_FORECAST_API as string | undefined;

export const hasRemote = Boolean(API);

export async function predict(ev: EventRow, levers: Levers): Promise<Forecast> {
  const local = predictLocal(ev, levers);
  if (!API) return local;

  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_id: ev.id, levers }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as {
      expected_attendance: number;
      p10: number;
      p90: number;
      overflow_risk?: number;
      lift?: number;
    };
    return {
      ...local,
      expected: Math.round(json.expected_attendance),
      demand: Math.round(json.expected_attendance),
      p10: Math.round(json.p10),
      p90: Math.round(json.p90),
      overflowRisk: json.overflow_risk ?? local.overflowRisk,
      lift: json.lift ?? local.lift,
      source: 'api',
    };
  } catch {
    // El modelo remoto no responde: seguimos con la calibración local, sin romper la puerta.
    return local;
  }
}
