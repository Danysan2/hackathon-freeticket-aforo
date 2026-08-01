#!/usr/bin/env node
// Construye el dataset estático que consume la app web (web/src/data/dataset.json).
// Lee los CSV de raw/ y precalcula lo que el panel y el módulo de estadísticas necesitan.
// Cuando el modelo real esté listo, este archivo sigue sirviendo: la app lo usa como
// base histórica y de calibración; la predicción se puede delegar a la API.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'raw');
const OUT = join(ROOT, 'web', 'src', 'data', 'dataset.json');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    if (c === '\r') continue;
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return rows
    .filter((r) => r.length === header.length && r.some((v) => v !== ''))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

const read = (name) => parseCsv(readFileSync(join(RAW, name), 'utf8'));

const num = (v) => (v === '' || v == null ? null : Number(v));
const bool = (v) => v === 'true' || v === 'TRUE' || v === '1';
const r4 = (v) => (Number.isFinite(v) ? Math.round(v * 10000) / 10000 : null);

const events = read('ft_events.csv');
const artists = read('ft_artists.csv');
const tickets = read('ft_tickets.csv');
const sales = read('ft_sales.csv');
const boomTickets = read('boom_tickets.csv');
const boomProfile = read('boom_profile.csv');

const TYPES = ['General', 'Preferencial', 'VIP', 'Cortesía'];
const emptyMix = () => Object.fromEntries(TYPES.map((t) => [t, 0]));

// ---------- índices ----------
const saleById = new Map(sales.map((s) => [s.sale_id, s]));
const eventById = new Map(events.map((e) => [e.event_id, e]));

// mezcla de tipos y asistencia por evento
const perEvent = new Map();
for (const e of events) {
  perEvent.set(e.event_id, {
    mix: emptyMix(),
    attended: emptyMix(),
    revenue: 0,
    arrival: [],
    channels: new Map(),
  });
}

for (const t of tickets) {
  const agg = perEvent.get(t.event_id);
  if (!agg) continue;
  const type = TYPES.includes(t.ticket_type) ? t.ticket_type : 'General';
  agg.mix[type] += 1;
  agg.revenue += num(t.price) ?? 0;
  const inside = bool(t.checked_in);
  if (inside) agg.attended[type] += 1;

  const sale = saleById.get(t.sale_id);
  const channel = sale?.channel || 'DESCONOCIDO';
  const ch = agg.channels.get(channel) || { issued: 0, attended: 0 };
  ch.issued += 1;
  if (inside) ch.attended += 1;
  agg.channels.set(channel, ch);

  if (inside && t.checked_in_at) {
    const ev = eventById.get(t.event_id);
    if (ev?.starts_at) {
      const delta = (Date.parse(t.checked_in_at) - Date.parse(ev.starts_at)) / 60000;
      if (Number.isFinite(delta)) agg.arrival.push(delta);
    }
  }
}

// ---------- calibración: tasa de show-up por tipo de entrada (julio) ----------
const byType = Object.fromEntries(TYPES.map((t) => [t, { issued: 0, attended: 0 }]));
for (const e of events) {
  if (e.month !== 'julio') continue;
  const agg = perEvent.get(e.event_id);
  for (const t of TYPES) {
    byType[t].issued += agg.mix[t];
    byType[t].attended += agg.attended[t];
  }
}
const calibrationByType = TYPES.map((t) => ({
  type: t,
  issued: byType[t].issued,
  attended: byType[t].attended,
  rate: r4(byType[t].attended / Math.max(1, byType[t].issued)),
}));

// ---------- calibración Boom: membresía vs consumo mínimo ----------
const boomByType = new Map();
for (const bt of boomTickets) {
  const k = bt.type || 'otro';
  const agg = boomByType.get(k) || { tickets: 0, used: 0 };
  agg.tickets += 1;
  if (bool(bt.used)) agg.used += 1;
  boomByType.set(k, agg);
}
const calibrationBoom = [...boomByType.entries()]
  .map(([type, v]) => ({ type, tickets: v.tickets, used: v.used, rate: r4(v.used / Math.max(1, v.tickets)) }))
  .sort((a, b) => b.tickets - a.tickets);

// ---------- eventos enriquecidos ----------
const eventRows = events.map((e) => {
  const agg = perEvent.get(e.event_id);
  const issued = TYPES.reduce((s, t) => s + agg.mix[t], 0);
  const attended = TYPES.reduce((s, t) => s + agg.attended[t], 0);
  const freeIssued = agg.mix['Cortesía'];
  return {
    id: e.event_id,
    title: e.title,
    artistId: e.artist_id,
    artist: e.artist_name,
    city: e.city,
    venue: e.venue,
    capacity: num(e.capacity),
    startsAt: e.starts_at,
    weekday: e.weekday,
    month: e.month,
    isResidency: bool(e.is_residency),
    isUpcoming: bool(e.is_upcoming),
    residencyVenue: e.residency_venue || null,
    ticketsSold: num(e.tickets_sold),
    mix: agg.mix,
    issued,
    attended: e.month === 'julio' ? attended : null,
    attendanceRate: e.month === 'julio' ? r4(attended / Math.max(1, issued)) : null,
    fillRate: r4(issued / Math.max(1, num(e.capacity) ?? 1)),
    courtesyShare: r4(freeIssued / Math.max(1, issued)),
    revenue: agg.revenue,
  };
});

// ---------- efecto de mezcla vs efecto propio del show ----------
// La caída de asistencia cuando sube la cortesía es, en su mayor parte, aritmética:
// una cortesía entra al 39% y una paga al 94%. Eso ya lo captura la mezcla.
// Lo que queda después de descontarla es la señal real: qué shows llenan por encima
// o por debajo de lo que su mezcla predice (residencia, artista, venue).
const rateOf = Object.fromEntries(calibrationByType.map((c) => [c.type, c.rate]));
for (const e of eventRows) {
  e.mixExpected = r4(TYPES.reduce((s, t) => s + e.mix[t] * rateOf[t], 0));
  e.lift = e.month === 'julio' && e.mixExpected > 0 ? r4(e.attended / e.mixExpected) : null;
}

const julio = eventRows.filter((e) => e.month === 'julio' && e.issued >= 20);
function linreg(points) {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  const sxy = points.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
  const sxx = points.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  const ssTot = points.reduce((s, p) => s + (p.y - my) ** 2, 0);
  const ssRes = points.reduce((s, p) => s + (p.y - (intercept + slope * p.x)) ** 2, 0);
  return { slope, intercept, r2: ssTot === 0 ? 0 : 1 - ssRes / ssTot, n };
}
const dilFit = linreg(julio.map((e) => ({ x: e.courtesyShare, y: e.attendanceRate })));
// Dilución residual: lo que la mezcla NO explica. Si es ~0, repartir cortesías no
// contagia a los demás; el costo de una cortesía es exactamente su propia tasa.
const residFit = linreg(julio.map((e) => ({ x: e.courtesyShare, y: e.lift })));

// Factor propio del show, con encogimiento bayesiano hacia 1 (pocos shows -> poca confianza).
const SHRINK = 120; // entradas de "prior"; por debajo de esto el factor se acerca a 1
function liftBy(keyFn) {
  const m = new Map();
  for (const e of eventRows) {
    if (e.month !== 'julio') continue;
    const k = keyFn(e);
    if (!k) continue;
    const g = m.get(k) || { key: k, attended: 0, expected: 0, events: 0 };
    g.attended += e.attended ?? 0;
    g.expected += e.mixExpected;
    g.events += 1;
    m.set(k, g);
  }
  return [...m.values()].map((g) => ({
    ...g,
    raw: r4(g.attended / Math.max(1, g.expected)),
    lift: r4((g.attended + SHRINK) / (g.expected + SHRINK)),
  }));
}
// Sobredispersión: cuánto más ancha es la realidad que un binomial puro.
// Alimenta el rango p10–p90 con el error observado, no con un supuesto.
const phiSamples = julio.map((e) => {
  const varBin = TYPES.reduce((s, t) => s + e.mix[t] * rateOf[t] * (1 - rateOf[t]), 0);
  const resid = (e.attended - e.mixExpected) ** 2;
  return varBin > 0 ? resid / varBin : 1;
});
const overdispersion = r4(
  Math.max(1, phiSamples.reduce((s, v) => s + v, 0) / Math.max(1, phiSamples.length)),
);

const liftByArtist = liftBy((e) => e.artistId);
const liftByVenue = liftBy((e) => e.venue);
const liftByWeekday = liftBy((e) => e.weekday);

// ---------- curva de llegada (julio, minutos relativos al show) ----------
const BUCKET = 15;
const buckets = new Map();
let arrivalTotal = 0;
for (const e of eventRows) {
  if (e.month !== 'julio') continue;
  for (const d of perEvent.get(e.id).arrival) {
    const b = Math.floor(d / BUCKET) * BUCKET;
    const key = Math.max(-120, Math.min(120, b));
    buckets.set(key, (buckets.get(key) || 0) + 1);
    arrivalTotal += 1;
  }
}
const arrivalCurve = [...buckets.entries()]
  .sort((a, b) => a[0] - b[0])
  .map(([minutes, count]) => ({ minutes, count, share: r4(count / Math.max(1, arrivalTotal)) }));

// ---------- cortes agregados ----------
function groupJuly(keyFn) {
  const m = new Map();
  for (const e of eventRows) {
    if (e.month !== 'julio') continue;
    const k = keyFn(e);
    const g = m.get(k) || { key: k, events: 0, issued: 0, attended: 0, capacity: 0, courtesy: 0 };
    g.events += 1;
    g.issued += e.issued;
    g.attended += e.attended ?? 0;
    g.capacity += e.capacity ?? 0;
    g.courtesy += e.mix['Cortesía'];
    m.set(k, g);
  }
  return [...m.values()]
    .map((g) => ({
      ...g,
      rate: r4(g.attended / Math.max(1, g.issued)),
      fill: r4(g.issued / Math.max(1, g.capacity)),
      courtesyShare: r4(g.courtesy / Math.max(1, g.issued)),
    }))
    .sort((a, b) => b.issued - a.issued);
}

const channelAgg = new Map();
for (const e of eventRows) {
  if (e.month !== 'julio') continue;
  for (const [ch, v] of perEvent.get(e.id).channels) {
    const g = channelAgg.get(ch) || { key: ch, issued: 0, attended: 0 };
    g.issued += v.issued;
    g.attended += v.attended;
    channelAgg.set(ch, g);
  }
}

const WEEKDAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

const artistRows = artists.map((a) => {
  const own = eventRows.filter((e) => e.artistId === a.artist_id);
  const past = own.filter((e) => e.month === 'julio');
  const issued = past.reduce((s, e) => s + e.issued, 0);
  const attended = past.reduce((s, e) => s + (e.attended ?? 0), 0);
  return {
    id: a.artist_id,
    name: a.name,
    city: a.home_city,
    hasResidency: bool(a.has_residency),
    residencyVenue: a.residency_venue || null,
    residencyWeekday: a.residency_weekday || null,
    eventsPast: past.length,
    eventsUpcoming: own.filter((e) => e.month === 'agosto').length,
    issuedJuly: issued,
    attendedJuly: attended,
    rateJuly: past.length ? r4(attended / Math.max(1, issued)) : null,
    courtesyShareJuly: past.length
      ? r4(past.reduce((s, e) => s + e.mix['Cortesía'], 0) / Math.max(1, issued))
      : null,
  };
});

const julyEvents = eventRows.filter((e) => e.month === 'julio');
const augEvents = eventRows.filter((e) => e.month === 'agosto');
const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) ?? 0), 0);

// perfil Boom: sólo agregados (el cruce lo produce el modelo)
const useRates = boomProfile.map((p) => num(p.use_rate)).filter((v) => v != null);
const withMembership = boomProfile.filter((p) => bool(p.has_membership));
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

const dataset = {
  meta: {
    generatedAt: new Date().toISOString(),
    today: '2026-08-01',
    source: 'raw/*.csv (FreeTicket + Boom)',
    ticketTypes: TYPES,
  },
  calibration: {
    byTicketType: calibrationByType,
    boomByType: calibrationBoom,
    global: {
      issued: sum(julyEvents, (e) => e.issued),
      attended: sum(julyEvents, (e) => e.attended),
      rate: r4(sum(julyEvents, (e) => e.attended) / Math.max(1, sum(julyEvents, (e) => e.issued))),
    },
    dilution: {
      slope: r4(dilFit.slope),
      intercept: r4(dilFit.intercept),
      r2: r4(dilFit.r2),
      n: dilFit.n,
      points: julio.map((e) => ({
        id: e.id,
        x: e.courtesyShare,
        y: e.attendanceRate,
        lift: e.lift,
        issued: e.issued,
        artist: e.artist,
      })),
    },
    residualDilution: {
      slope: r4(residFit.slope),
      intercept: r4(residFit.intercept),
      r2: r4(residFit.r2),
      n: residFit.n,
    },
    liftByArtist,
    liftByVenue,
    liftByWeekday,
    shrink: SHRINK,
    overdispersion,
  },
  events: eventRows,
  artists: artistRows,
  stats: {
    july: {
      events: julyEvents.length,
      issued: sum(julyEvents, (e) => e.issued),
      attended: sum(julyEvents, (e) => e.attended),
      capacity: sum(julyEvents, (e) => e.capacity),
      revenue: sum(julyEvents, (e) => e.revenue),
      courtesy: sum(julyEvents, (e) => e.mix['Cortesía']),
    },
    august: {
      events: augEvents.length,
      issued: sum(augEvents, (e) => e.issued),
      capacity: sum(augEvents, (e) => e.capacity),
      courtesy: sum(augEvents, (e) => e.mix['Cortesía']),
    },
    byCity: groupJuly((e) => e.city),
    byVenue: groupJuly((e) => e.venue).slice(0, 12),
    byWeekday: groupJuly((e) => e.weekday).sort(
      (a, b) => WEEKDAYS.indexOf(a.key) - WEEKDAYS.indexOf(b.key),
    ),
    byResidency: groupJuly((e) => (e.isResidency ? 'Residencia' : 'Fecha suelta')),
    byChannel: [...channelAgg.values()]
      .map((g) => ({ ...g, rate: r4(g.attended / Math.max(1, g.issued)) }))
      .sort((a, b) => b.issued - a.issued),
    arrivalCurve,
    boom: {
      users: boomProfile.length,
      withMembership: withMembership.length,
      avgUseRate: r4(mean(useRates)),
      avgUseRateMembers: r4(mean(withMembership.map((p) => num(p.use_rate)).filter((v) => v != null))),
      avgFriends: r4(mean(boomProfile.map((p) => num(p.friends_count) ?? 0))),
      useRateHistogram: Array.from({ length: 10 }, (_, i) => {
        const lo = i / 10;
        const hi = (i + 1) / 10;
        return {
          bin: `${Math.round(lo * 100)}-${Math.round(hi * 100)}%`,
          lo,
          count: useRates.filter((v) => (i === 9 ? v >= lo && v <= 1 : v >= lo && v < hi)).length,
        };
      }),
    },
  },
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(dataset));
const kb = Math.round(JSON.stringify(dataset).length / 1024);

console.log(`dataset -> ${OUT} (${kb} KB)`);
console.log(`  eventos: ${eventRows.length} (julio ${julyEvents.length} / agosto ${augEvents.length})`);
console.log('  tasas por tipo:', calibrationByType.map((c) => `${c.type} ${(c.rate * 100).toFixed(1)}%`).join(' · '));
console.log('  boom:', calibrationBoom.map((c) => `${c.type} ${(c.rate * 100).toFixed(1)}%`).join(' · '));
console.log(`  dilución cortesía: pendiente ${dilFit.slope.toFixed(3)} (r2 ${dilFit.r2.toFixed(3)}, n=${dilFit.n})`);
