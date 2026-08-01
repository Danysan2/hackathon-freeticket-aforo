/**
 * Motor de proyección de asistencia.
 *
 * Idea en una línea: no importa cuántas entradas se emitieron, importa CUÁLES.
 * Cada tipo de entrada tiene una tasa de show-up medida sobre los 32 shows de julio,
 * y el show aporta un factor propio (residencia, artista, venue) encogido hacia 1.
 *
 * Todo lo calibrable vive en dataset.json (lo produce scripts/build-webapp-data.mjs).
 * Cuando el modelo entrenado esté listo, `predict()` sigue siendo el contrato:
 * misma entrada, misma salida. Ver lib/api.ts para el intercambio local <-> remoto.
 */
import dataRaw from '../data/dataset.json';
import trainedRaw from '../data/model.json';
import type { Dataset, EventRow, TicketType } from './types';

export const data = dataRaw as unknown as Dataset;

/**
 * Salida del modelo entrenado. Vive en `web/src/data/model.json` y arranca vacío:
 * mientras no tenga eventos, la app usa la calibración de julio. El pipeline del
 * modelo sobreescribe ese archivo y la app lo toma sola, sin tocar código.
 *
 *   baseline — asistencia esperada de las entradas YA emitidas (con su factor aplicado)
 *   lift     — factor propio del show; sd — desviación de esa proyección
 *
 * Las palancas se suman encima con las tasas de `rates`: el efecto de repartir
 * entradas es lineal (ver la dilución residual, ~0), así que no hace falta
 * volver a llamar al modelo por cada movimiento del slider.
 */
export interface TrainedEvent {
  baseline: number;
  lift?: number;
  sd?: number;
}

export interface TrainedModel {
  version: string | null;
  rates?: Partial<Record<string, number>>;
  events?: Record<string, TrainedEvent>;
}

const trained = trainedRaw as TrainedModel;

/** Versión del modelo entrenado, o null si la app corre con la calibración de julio. */
export const modelVersion = trained.version;

/** Cuantil 0.10 / 0.90 de la normal estándar. */
const Z90 = 1.2816;

export type LeverKey = 'cortesia' | 'boomMembresia' | 'boomConsumo';

export interface Levers {
  /** Cortesías adicionales a repartir (además de las que ya salieron). */
  cortesia: number;
  /** Entradas liberadas a miembros Boom (membresía). */
  boomMembresia: number;
  /** Entradas liberadas por consumo mínimo Boom. */
  boomConsumo: number;
  /** Cortesías YA emitidas que se recuperan y se venden como pagas. */
  convertirCortesias: number;
}

export const emptyLevers: Levers = {
  cortesia: 0,
  boomMembresia: 0,
  boomConsumo: 0,
  convertirCortesias: 0,
};

export interface Bucket {
  label: string;
  count: number;
  rate: number;
  /** Asistentes que aporta este tipo, sin factor de show. */
  expected: number;
  /** Aporte final a la proyección: ya con factor del show y ajuste del modelo. */
  contribution: number;
  kind: 'paga' | 'gratis';
  seriesIndex: number;
}

export interface Forecast {
  eventId: string;
  /** Asistencia esperada, ya limitada por el aforo. */
  expected: number;
  /** Demanda esperada sin limitar por aforo (para ver el sobrecupo). */
  demand: number;
  p10: number;
  p90: number;
  sd: number;
  /** Probabilidad de que la demanda supere el aforo. */
  overflowRisk: number;
  emitted: number;
  capacity: number;
  fillRate: number;
  /** Entradas emitidas por cada asistente real. */
  ticketsPerHead: number;
  lift: number;
  buckets: Bucket[];
  staff: Staffing;
  /** local = calibración de julio · modelo = model.json · api = endpoint en vivo */
  source: 'local' | 'modelo' | 'api';
}

export interface Staffing {
  scanners: number;
  security: number;
  total: number;
  peakPerQuarter: number;
  doorsOpen: number;
}

const RATES = Object.fromEntries(data.calibration.byTicketType.map((r) => [r.type, r.rate])) as Record<
  TicketType,
  number
>;
const BOOM = Object.fromEntries(data.calibration.boomByType.map((r) => [r.type, r.rate])) as Record<
  string,
  number
>;

/** Si el modelo entrenado trae su propia tasa para un tipo, esa manda. */
const rateOf = (key: string, fallback: number) => trained.rates?.[key] ?? fallback;

export const RATE = {
  General: rateOf('General', RATES.General),
  Preferencial: rateOf('Preferencial', RATES.Preferencial),
  VIP: rateOf('VIP', RATES.VIP),
  Cortesía: rateOf('Cortesía', RATES['Cortesía']),
  boomMembresia: rateOf('boom_membresia', BOOM['membresia'] ?? 0.5),
  boomConsumo: rateOf('boom_consumo', BOOM['consumo_minimo'] ?? 0.75),
};

/** Tasa de entrada de cada palanca de entradas gratis. */
export const LEVER_RATE: Record<LeverKey, number> = {
  cortesia: RATE['Cortesía'],
  boomMembresia: RATE.boomMembresia,
  boomConsumo: RATE.boomConsumo,
};

/** Tasa media de las entradas pagas del evento; es la que aplica al convertir cortesías. */
function paidRateOf(ev: EventRow) {
  const paid: TicketType[] = ['General', 'Preferencial', 'VIP'];
  const n = paid.reduce((s, t) => s + ev.mix[t], 0);
  if (!n) return RATE.General;
  return paid.reduce((s, t) => s + ev.mix[t] * RATES[t], 0) / n;
}

/** Factor propio del show: artista y venue, encogidos hacia 1 y combinados. */
export function liftFor(ev: EventRow) {
  const byArtist = data.calibration.liftByArtist.find((l) => l.key === ev.artistId)?.lift;
  const byVenue = data.calibration.liftByVenue.find((l) => l.key === ev.venue)?.lift;
  const parts = [byArtist, byVenue].filter((v): v is number => typeof v === 'number');
  if (!parts.length) return 1;
  return parts.reduce((s, v) => s + v, 0) / parts.length;
}

const normalCdf = (z: number) => {
  // Aproximación de Abramowitz-Stegun; sobra para un rango operativo.
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (1.330274 * t ** 4 - 1.821256 * t ** 3 + 1.781478 * t ** 2 - 0.356538 * t + 0.3193815);
  return z > 0 ? 1 - p : p;
};

const peakShare = Math.max(...data.stats.arrivalCurve.map((b) => b.share), 0.2);
const firstBucket = data.stats.arrivalCurve[0]?.minutes ?? -60;

function staffing(expected: number): Staffing {
  const peakPerQuarter = Math.round(expected * peakShare);
  // Un escáner despacha ~60 personas por cuarto de hora (15 s por entrada).
  const scanners = Math.max(2, Math.ceil(peakPerQuarter / 60));
  const security = Math.max(1, Math.ceil(expected / 120));
  return {
    scanners,
    security,
    total: scanners + security,
    peakPerQuarter,
    doorsOpen: firstBucket - 15,
  };
}

export function predictLocal(ev: EventRow, levers: Levers = emptyLevers): Forecast {
  const convert = Math.min(levers.convertirCortesias, ev.mix['Cortesía']);
  const paidRate = paidRateOf(ev);

  const buckets: Bucket[] = [
    { label: 'General', count: ev.mix.General, rate: RATE.General, kind: 'paga', seriesIndex: 0 },
    {
      label: 'Preferencial',
      count: ev.mix.Preferencial,
      rate: RATE.Preferencial,
      kind: 'paga',
      seriesIndex: 1,
    },
    { label: 'VIP', count: ev.mix.VIP, rate: RATE.VIP, kind: 'paga', seriesIndex: 2 },
    {
      label: 'Cortesía',
      count: ev.mix['Cortesía'] - convert + levers.cortesia,
      rate: RATE['Cortesía'],
      kind: 'gratis',
      seriesIndex: 3,
    },
    {
      label: 'Boom membresía',
      count: levers.boomMembresia,
      rate: RATE.boomMembresia,
      kind: 'gratis',
      seriesIndex: 4,
    },
    {
      label: 'Boom consumo mínimo',
      count: levers.boomConsumo,
      rate: RATE.boomConsumo,
      kind: 'gratis',
      seriesIndex: 5,
    },
    // Las cortesías recuperadas se venden: pasan a comportarse como entrada paga.
    { label: 'Recuperadas (vendidas)', count: convert, rate: paidRate, kind: 'paga', seriesIndex: 0 },
  ]
    .filter((b) => b.count > 0)
    .map((b) => ({ ...b, expected: b.count * b.rate, contribution: 0 })) as Bucket[];

  const fitted = trained.events?.[ev.id];
  const lift = fitted?.lift ?? liftFor(ev);
  const emitted = buckets.reduce((s, b) => s + b.count, 0);

  // Lo ya emitido vs lo que sueltas ahora: si el modelo entrenado tiene este
  // evento, su baseline reemplaza la parte ya emitida y las palancas se suman
  // encima. Si no, todo sale de la calibración de julio.
  const isLever = (b: Bucket) => b.label.startsWith('Boom ') || b.label === 'Cortesía';
  const rawBase = buckets
    .filter((b) => !isLever(b))
    .reduce((s, b) => s + b.expected, 0);
  const rawCortesiaBase = Math.max(0, ev.mix['Cortesía'] - convert) * RATE['Cortesía'];
  const issuedExpected = (rawBase + rawCortesiaBase) * lift;
  const leversExpected =
    (levers.cortesia * RATE['Cortesía'] +
      levers.boomMembresia * RATE.boomMembresia +
      levers.boomConsumo * RATE.boomConsumo) *
    lift;

  const baseDemand = fitted?.baseline ?? issuedExpected;
  const demand = baseDemand + leversExpected;

  // Reparte la corrección del modelo entre los tipos ya emitidos, para que la
  // tabla de aportes siga sumando exactamente la proyección.
  const baseScale = issuedExpected > 0 ? baseDemand / issuedExpected : 1;
  for (const b of buckets) {
    const leverPart = isLever(b)
      ? b.label === 'Cortesía'
        ? levers.cortesia * b.rate
        : b.expected
      : 0;
    const issuedPart = b.expected - leverPart;
    b.contribution = issuedPart * lift * baseScale + leverPart * lift;
  }

  const varBinomial = buckets.reduce((s, b) => s + b.count * b.rate * (1 - b.rate), 0);
  const sd = fitted?.sd
    ? Math.sqrt(
        fitted.sd ** 2 +
          (levers.cortesia * RATE['Cortesía'] * (1 - RATE['Cortesía']) +
            levers.boomMembresia * RATE.boomMembresia * (1 - RATE.boomMembresia) +
            levers.boomConsumo * RATE.boomConsumo * (1 - RATE.boomConsumo)) *
            data.calibration.overdispersion,
      )
    : Math.sqrt(Math.max(varBinomial, 1) * data.calibration.overdispersion);

  const capacity = ev.capacity;
  const expected = Math.min(demand, capacity);
  const p10 = Math.max(0, Math.min(demand - Z90 * sd, capacity));
  const p90 = Math.min(demand + Z90 * sd, capacity);
  const overflowRisk = sd > 0 ? 1 - normalCdf((capacity - demand) / sd) : demand > capacity ? 1 : 0;

  return {
    eventId: ev.id,
    expected: Math.round(expected),
    demand: Math.round(demand),
    p10: Math.round(p10),
    p90: Math.round(p90),
    sd,
    overflowRisk,
    emitted,
    capacity,
    fillRate: expected / Math.max(1, capacity),
    ticketsPerHead: emitted / Math.max(1, expected),
    lift,
    buckets,
    staff: staffing(expected),
    source: fitted ? 'modelo' : 'local',
  };
}

/** Un punto del barrido: qué pasa si repartimos N entradas gratis con esta repartición. */
export interface SweepPoint {
  x: number;
  expected: number;
  p10: number;
  p90: number;
  overflowRisk: number;
  emitted: number;
}

/** Barrido 1: cuántas entradas gratis repartir, manteniendo la proporción actual entre palancas. */
export function sweepVolume(ev: EventRow, levers: Levers, steps = 28): SweepPoint[] {
  const total = levers.cortesia + levers.boomMembresia + levers.boomConsumo;
  const weights =
    total > 0
      ? {
          cortesia: levers.cortesia / total,
          boomMembresia: levers.boomMembresia / total,
          boomConsumo: levers.boomConsumo / total,
        }
      : { cortesia: 1, boomMembresia: 0, boomConsumo: 0 };
  const max = Math.max(20, Math.ceil((ev.capacity - ev.issued) * 1.4), total + 20);
  return Array.from({ length: steps + 1 }, (_, i) => {
    const n = Math.round((max * i) / steps);
    const f = predictLocal(ev, {
      ...levers,
      cortesia: Math.round(n * weights.cortesia),
      boomMembresia: Math.round(n * weights.boomMembresia),
      boomConsumo: Math.round(n * weights.boomConsumo),
    });
    return { x: n, expected: f.expected, p10: f.p10, p90: f.p90, overflowRisk: f.overflowRisk, emitted: f.emitted };
  });
}

/** Barrido 2: con el mismo presupuesto de entradas gratis, cómo repartirlo entre cortesía y Boom. */
export function sweepSplit(ev: EventRow, levers: Levers, steps = 20): SweepPoint[] {
  const budget = levers.cortesia + levers.boomMembresia + levers.boomConsumo;
  if (budget <= 0) return [];
  return Array.from({ length: steps + 1 }, (_, i) => {
    const share = i / steps; // proporción que va a cortesía abierta
    const cortesia = Math.round(budget * share);
    const rest = budget - cortesia;
    const boomTotal = levers.boomMembresia + levers.boomConsumo;
    const memShare = boomTotal > 0 ? levers.boomMembresia / boomTotal : 0.5;
    const f = predictLocal(ev, {
      ...levers,
      cortesia,
      boomMembresia: Math.round(rest * memShare),
      boomConsumo: rest - Math.round(rest * memShare),
    });
    return {
      x: share,
      expected: f.expected,
      p10: f.p10,
      p90: f.p90,
      overflowRisk: f.overflowRisk,
      emitted: f.emitted,
    };
  });
}

/**
 * Recomendación operativa: cuántas entradas gratis caben antes de que el p90
 * choque con el aforo, y por dónde conviene repartirlas.
 */
export interface Recommendation {
  headroom: number;
  suggestedFree: number;
  bestLever: LeverKey;
  gain: number;
  riskAt: number;
}

export function recommend(ev: EventRow, levers: Levers): Recommendation {
  const bestLever = (Object.keys(LEVER_RATE) as LeverKey[]).reduce((a, b) =>
    LEVER_RATE[a] >= LEVER_RATE[b] ? a : b,
  );

  const base = predictLocal(ev, { ...levers, cortesia: 0, boomMembresia: 0, boomConsumo: 0 });
  const headroom = Math.max(0, ev.capacity - base.p90);

  // El máximo de entradas del mejor tipo que mantiene el riesgo de sobreaforo bajo 15%.
  let suggested = 0;
  for (let n = 0; n <= ev.capacity; n += 2) {
    const f = predictLocal(ev, { ...levers, cortesia: 0, boomMembresia: 0, boomConsumo: 0, [bestLever]: n } as Levers);
    if (f.overflowRisk > 0.15) break;
    suggested = n;
  }
  const withSuggestion = predictLocal(ev, {
    ...levers,
    cortesia: 0,
    boomMembresia: 0,
    boomConsumo: 0,
    [bestLever]: suggested,
  } as Levers);

  return {
    headroom: Math.round(headroom),
    suggestedFree: suggested,
    bestLever,
    gain: withSuggestion.expected - base.expected,
    riskAt: withSuggestion.overflowRisk,
  };
}

export const LEVER_LABEL: Record<LeverKey, string> = {
  cortesia: 'Cortesía abierta',
  boomMembresia: 'Boom · membresía',
  boomConsumo: 'Boom · consumo mínimo',
};
