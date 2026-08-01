#!/usr/bin/env node
/**
 * Genera una página estática por show: dist/e/<event_id>.html
 *
 * Por qué: WhatsApp, Slack y Twitter piden el HTML y leen las meta tags sin
 * ejecutar JavaScript. Una SPA les devuelve siempre el mismo index vacío, así que
 * la preview saldría idéntica para los 30 shows. Aquí cada archivo lleva su
 * propio título y resumen; el bundle es el mismo y al abrirlo la app arranca en
 * ese evento (lee /e/<id> de la ruta).
 *
 * La proyección de la preview es la del evento sin palancas, con la misma
 * fórmula de src/lib/model.ts y las mismas fuentes: model.json si el modelo
 * entrenado ya trae el evento, si no la calibración de julio de dataset.json.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(WEB, 'dist');

const dataset = JSON.parse(readFileSync(join(WEB, 'src/data/dataset.json'), 'utf8'));
const trained = JSON.parse(readFileSync(join(WEB, 'src/data/model.json'), 'utf8'));
const shell = readFileSync(join(DIST, 'index.html'), 'utf8');

/** Origen del sitio: lo pone Vercel en el build; si no, quedan URLs relativas. */
const SITE = (
  process.env.SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : '') ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')
).replace(/\/$/, '');

const Z90 = 1.2816;
const TYPES = ['General', 'Preferencial', 'VIP', 'Cortesía'];

const rateFor = (type, fallback) => trained.rates?.[type] ?? fallback;
const baseRates = Object.fromEntries(
  dataset.calibration.byTicketType.map((r) => [r.type, rateFor(r.type, r.rate)]),
);

function liftOf(ev) {
  const a = dataset.calibration.liftByArtist.find((l) => l.key === ev.artistId)?.lift;
  const v = dataset.calibration.liftByVenue.find((l) => l.key === ev.venue)?.lift;
  const parts = [a, v].filter((x) => typeof x === 'number');
  return parts.length ? parts.reduce((s, x) => s + x, 0) / parts.length : 1;
}

const peakShare = Math.max(...dataset.stats.arrivalCurve.map((b) => b.share), 0.2);

function project(ev) {
  const fitted = trained.events?.[ev.id];
  const lift = fitted?.lift ?? liftOf(ev);
  const issued = TYPES.reduce((s, t) => s + ev.mix[t], 0);
  const rawExpected = TYPES.reduce((s, t) => s + ev.mix[t] * baseRates[t], 0) * lift;
  const demand = fitted?.baseline ?? rawExpected;

  const varBin = TYPES.reduce((s, t) => s + ev.mix[t] * baseRates[t] * (1 - baseRates[t]), 0);
  const sd = fitted?.sd ?? Math.sqrt(Math.max(varBin, 1) * dataset.calibration.overdispersion);

  const expected = Math.min(demand, ev.capacity);
  const peak = Math.round(expected * peakShare);
  return {
    expected: Math.round(expected),
    p10: Math.round(Math.max(0, Math.min(demand - Z90 * sd, ev.capacity))),
    p90: Math.round(Math.min(demand + Z90 * sd, ev.capacity)),
    issued,
    scanners: Math.max(2, Math.ceil(peak / 60)),
    security: Math.max(1, Math.ceil(expected / 120)),
    fill: expected / Math.max(1, ev.capacity),
  };
}

const WEEK = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const pad = (n) => String(n).padStart(2, '0');

function when(iso) {
  const d = new Date(iso);
  return `${WEEK[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} · ${pad(
    d.getUTCHours(),
  )}:${pad(d.getUTCMinutes())}`;
}

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** El mismo texto que la app manda por WhatsApp, para que la preview no mienta. */
export function summaryOf(ev, p) {
  return (
    `Se esperan ${p.expected} personas (entre ${p.p10} y ${p.p90}) de ${p.issued} entradas emitidas. ` +
    `Aforo ${ev.capacity}, ${Math.round(p.fill * 100)}% lleno. ` +
    `Puerta: ${p.scanners} escáneres y ${p.security} de logística.`
  );
}

const events = dataset.events.filter((e) => e.month === 'agosto');
mkdirSync(join(DIST, 'e'), { recursive: true });

for (const ev of events) {
  const p = project(ev);
  const title = `${ev.artist} · ${when(ev.startsAt)} — ${p.expected} personas esperadas`;
  const description = `${ev.venue}, ${ev.city}. ${summaryOf(ev, p)}`;
  const url = SITE ? `${SITE}/e/${ev.id}` : `/e/${ev.id}`;

  const meta = [
    `<meta name="description" content="${esc(description)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Aforo · proyección de puerta" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    SITE ? `<meta property="og:url" content="${esc(url)}" />` : '',
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
  ]
    .filter(Boolean)
    .join('\n    ');

  const html = shell
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/<meta name="description"[^>]*>/, '')
    .replace('</head>', `  ${meta}\n  </head>`);

  writeFileSync(join(DIST, 'e', `${ev.id}.html`), html);
}

console.log(`prerender -> dist/e/*.html (${events.length} shows)${SITE ? ` · origen ${SITE}` : ' · sin SITE_URL, og:url omitido'}`);
