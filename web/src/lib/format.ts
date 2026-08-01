const pad = (n: number) => String(n).padStart(2, '0');

const WEEK = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Las fechas vienen en +00:00 y representan hora local del show: se leen en UTC a propósito. */
export function fmtDate(iso: string) {
  const d = new Date(iso);
  return `${WEEK[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function fmtTime(iso: string) {
  const d = new Date(iso);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export const pct = (v: number, digits = 0) =>
  `${(v * 100).toFixed(digits).replace('.', ',')}%`;

export const int = (v: number) => Math.round(v).toLocaleString('es-CO');

export const money = (v: number) =>
  `$${(v / 1_000_000).toFixed(1).replace('.', ',')}M`;

export const signed = (v: number) => `${v > 0 ? '+' : ''}${int(v)}`;

export function offsetLabel(minutes: number) {
  if (minutes === 0) return 'show';
  const sign = minutes < 0 ? '−' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${abs}′`;
}
