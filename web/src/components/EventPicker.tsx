import { useMemo, useState } from 'react';
import type { EventRow } from '../lib/types';
import { fmtDate, fmtTime, pct } from '../lib/format';

const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(DIACRITICS, '');

export function EventPicker({
  events,
  selected,
  onSelect,
}: {
  events: EventRow[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const [q, setQ] = useState('');
  const [city, setCity] = useState<string>('todas');

  const cities = useMemo(() => ['todas', ...new Set(events.map((e) => e.city))], [events]);

  const filtered = useMemo(() => {
    const needle = norm(q);
    return events.filter(
      (e) =>
        (city === 'todas' || e.city === city) &&
        (!needle || norm(`${e.artist} ${e.venue} ${e.title} ${e.city}`).includes(needle)),
    );
  }, [events, q, city]);

  return (
    <>
      <div className="picker-head">
        <label className="search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Artista, venue…"
            aria-label="Buscar evento"
          />
        </label>
        <div className="chips">
          {cities.map((c) => (
            <button
              key={c}
              className="chip"
              aria-pressed={city === c}
              onClick={() => setCity(c)}
              type="button"
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="picker-list">
        {filtered.map((e) => (
          <button
            key={e.id}
            className="event-row"
            aria-current={e.id === selected}
            onClick={() => onSelect(e.id)}
            type="button"
          >
            <div className="er-top">
              <span className="er-name">{e.artist}</span>
              <span className="er-when">
                {fmtDate(e.startsAt)} · {fmtTime(e.startsAt)}
              </span>
            </div>
            <div className="er-sub">
              <span>{e.venue}</span>
              <i className="dot" />
              <span className="num">
                {e.issued}/{e.capacity}
              </span>
              <i className="dot" />
              <span className="num">{pct(e.courtesyShare)} cort.</span>
              {e.isResidency && (
                <>
                  <i className="dot" />
                  <span style={{ color: 'var(--cyan)' }}>res.</span>
                </>
              )}
            </div>
          </button>
        ))}
        {!filtered.length && (
          <p className="small muted" style={{ padding: 16 }}>
            Ningún show con ese filtro.
          </p>
        )}
      </div>
    </>
  );
}
