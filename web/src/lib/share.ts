/**
 * Enlaces compartibles: /e/<event_id>?c=&m=&k=
 *
 * La ruta la sirve un HTML pre-renderizado por show (scripts/prerender.mjs) con
 * sus propias meta tags, así que al pegar el link en WhatsApp la preview trae el
 * nombre del show y su proyección. Los parámetros llevan el estado de las
 * palancas para que quien abra el link vea exactamente lo mismo.
 */
import type { Levers } from './model';
import { emptyLevers } from './model';

const PARAM: Record<keyof Levers, string> = {
  cortesia: 'c',
  boomMembresia: 'm',
  boomConsumo: 'k',
  convertirCortesias: 'v',
};

export function readShareState(): { eventId: string | null; levers: Levers } {
  if (typeof window === 'undefined') return { eventId: null, levers: emptyLevers };

  const fromPath = location.pathname.match(/\/e\/([A-Za-z0-9_-]+)/)?.[1] ?? null;
  const q = new URLSearchParams(location.search);
  const levers = { ...emptyLevers };
  for (const key of Object.keys(PARAM) as (keyof Levers)[]) {
    const raw = Number(q.get(PARAM[key]));
    if (Number.isFinite(raw) && raw > 0) levers[key] = Math.round(raw);
  }
  return { eventId: fromPath ?? q.get('e'), levers };
}

export function sharePath(eventId: string, levers: Levers) {
  const q = new URLSearchParams();
  for (const key of Object.keys(PARAM) as (keyof Levers)[]) {
    if (levers[key] > 0) q.set(PARAM[key], String(levers[key]));
  }
  const query = q.toString();
  return `/e/${eventId}${query ? `?${query}` : ''}`;
}

export function shareUrl(eventId: string, levers: Levers) {
  return `${location.origin}${sharePath(eventId, levers)}`;
}

/** Abre WhatsApp (app o web) con el mensaje ya escrito. */
export function whatsappUrl(text: string) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
