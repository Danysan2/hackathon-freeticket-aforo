import { useEffect, useMemo, useState } from 'react';
import { EventPicker } from '../components/EventPicker';
import { Legend, SERIES, StackedRow, SweepChart } from '../components/charts';
import { predict, hasRemote } from '../lib/api';
import {
  data,
  emptyLevers,
  LEVER_LABEL,
  LEVER_RATE,
  modelAlgorithm,
  modelVersion,
  predictLocal,
  recommend,
  sweepSplit,
  sweepVolume,
  type Forecast as ForecastResult,
  type LeverKey,
  type Levers,
} from '../lib/model';
import { fmtDate, fmtTime, int, pct } from '../lib/format';
import { useMediaQuery } from '../lib/useMediaQuery';
import { readShareState, sharePath, shareUrl, whatsappUrl } from '../lib/share';
import type { EventRow } from '../lib/types';

const AUGUST = data.events
  .filter((e) => e.month === 'agosto')
  .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

const LEVERS: { key: LeverKey; hint: string }[] = [
  { key: 'cortesia', hint: 'Invitación abierta. No dolió nada, así que muchas no aparecen.' },
  { key: 'boomMembresia', hint: 'Ya pagaron el mes: la noche puntual les pesa menos.' },
  { key: 'boomConsumo', hint: 'Hay plata comprometida en la mesa, y se nota en la puerta.' },
];

function Slider({
  id,
  label,
  rate,
  hint,
  value,
  max,
  onChange,
}: {
  id: string;
  label: string;
  rate: number;
  hint: string;
  value: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="lever">
      <div className="lever-top">
        <label className="lever-name" htmlFor={id}>
          {label}
          <span className="lever-rate">entra {pct(rate)}</span>
        </label>
        <span className="lever-val">{value}</span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={max}
        value={value}
        style={{ ['--p' as string]: `${(value / Math.max(1, max)) * 100}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <p className="lever-hint">{hint}</p>
    </div>
  );
}

function riskBadge(risk: number) {
  if (risk > 0.35) return { cls: 'critical', text: `sobreaforo ${pct(risk)}` };
  if (risk > 0.15) return { cls: 'warning', text: `sobreaforo ${pct(risk)}` };
  return { cls: 'good', text: `sobreaforo ${pct(risk)}` };
}

const INITIAL = readShareState();

export function Forecast() {
  const [eventId, setEventId] = useState(
    INITIAL.eventId && AUGUST.some((e) => e.id === INITIAL.eventId)
      ? INITIAL.eventId
      : AUGUST[0].id,
  );
  const [levers, setLevers] = useState<Levers>(INITIAL.levers);
  const [result, setResult] = useState<ForecastResult | null>(null);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);

  const isNarrow = useMediaQuery('(max-width: 900px)');
  const [pickerOpen, setPickerOpen] = useState(false);

  const ev = useMemo(() => AUGUST.find((e) => e.id === eventId) as EventRow, [eventId]);

  // La proyección es inmediata: se recalcula con cada cambio, sin botón de por medio.
  const live = useMemo(() => predictLocal(ev, levers), [ev, levers]);
  const shown = result ?? live;

  // La barra de direcciones siempre refleja lo que estás viendo: así el enlace
  // que copies o compartas abre exactamente este show con estas palancas.
  useEffect(() => {
    history.replaceState(null, '', sharePath(eventId, levers) + location.hash);
  }, [eventId, levers]);

  const set = (k: keyof Levers) => (v: number) => setLevers((prev) => ({ ...prev, [k]: v }));

  // Si hay modelo remoto configurado, se consulta solo (con respiro entre cambios
  // para no disparar una petición por cada píxel del slider). Sin endpoint, el
  // número local ya es el definitivo y no hay nada que esperar.
  useEffect(() => {
    if (!hasRemote) return;
    let cancelled = false;
    setRunning(true);
    const t = setTimeout(async () => {
      const r = await predict(ev, levers);
      if (!cancelled) {
        setResult(r);
        setRunning(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [ev, levers]);

  // El reinicio de palancas cuelga de la acción de elegir, no de un efecto: así
  // no lo dispara el doble montaje de StrictMode y sobreviven las que traiga el
  // enlace compartido.
  const chooseEvent = (id: string) => {
    if (id === eventId) return;
    setEventId(id);
    setLevers(emptyLevers);
    setResult(null);
    if (isNarrow) setPickerOpen(false);
  };

  const rec = useMemo(() => recommend(ev, levers), [ev, levers]);
  const volume = useMemo(() => sweepVolume(ev, levers), [ev, levers]);
  const split = useMemo(() => sweepSplit(ev, levers), [ev, levers]);
  const base = useMemo(() => predictLocal(ev, emptyLevers), [ev]);
  const freeTotal = levers.cortesia + levers.boomMembresia + levers.boomConsumo;
  const sliderMax = Math.max(40, ev.capacity - ev.issued + 40);
  const risk = riskBadge(shown.overflowRisk);

  const link = shareUrl(eventId, levers);

  const summary =
    `*${ev.artist}* · ${fmtDate(ev.startsAt)} ${fmtTime(ev.startsAt)} · ${ev.venue}\n` +
    `Se esperan *${shown.expected} personas* (entre ${shown.p10} y ${shown.p90}, aforo ${ev.capacity}).\n` +
    `${shown.emitted} entradas emitidas · ${pct(shown.fillRate)} lleno\n` +
    `Puerta: ${shown.staff.scanners} escáneres y ${shown.staff.security} de logística, abrir ${Math.abs(
      shown.staff.doorsOpen,
    )} min antes.\n\n` +
    `Ver en vivo: ${link}`;

  const copy = async () => {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <>
      <div className="page-head">
        <h1>¿Cuánta gente entra?</h1>
        <p>
          Elige un show de agosto, decide cuántas entradas sueltas gratis y mira cuánta gente llega
          realmente a la puerta.
        </p>
      </div>

      <div className="split">
        {/* ---------- paso 1 ---------- */}
        <div className="box rise">
          {isNarrow ? (
            <button
              className="box-band as-toggle"
              onClick={() => setPickerOpen((v) => !v)}
              aria-expanded={pickerOpen}
              type="button"
            >
              <span className="row" style={{ gap: 8 }}>
                <i className="step">1</i>
                {pickerOpen ? 'Elige el show' : ev.artist}
              </span>
              <small>{pickerOpen ? 'cerrar' : 'cambiar'}</small>
            </button>
          ) : (
            <div className="box-band">
              <span className="row" style={{ gap: 8 }}>
                <i className="step">1</i> Elige el show
              </span>
            </div>
          )}
          {(!isNarrow || pickerOpen) && (
            <div className="box-body flush">
              <EventPicker events={AUGUST} selected={eventId} onSelect={chooseEvent} />
            </div>
          )}
        </div>

        <div className="stack">
          {/* ---------- resultado ---------- */}
          <section className="result rise">
            <div className="result-head">
              <div>
                <h2>{ev.artist}</h2>
                <p className="small dim up">
                  {ev.venue} · {ev.city} · {fmtDate(ev.startsAt)} {fmtTime(ev.startsAt)}
                </p>
              </div>
              <div className="row">
                {ev.isResidency && <span className="badge">residencia {ev.weekday}</span>}
                <span className={`badge ${risk.cls}`}>{risk.text}</span>
                <span className="badge">
                  {shown.source === 'local'
                    ? 'calibración julio'
                    : `${modelAlgorithm} · ${modelVersion ?? 'activo'}`}
                </span>
              </div>
            </div>

            <div className="result-body">
              <div>
                <div className="figure">{int(shown.expected)}</div>
                <div className="figure-unit">personas esperadas</div>
              </div>

              <div style={{ display: 'grid', gap: 12 }}>
                <div className="row between">
                  <span className="range">
                    entre <b>{int(shown.p10)}</b> y <b>{int(shown.p90)}</b> personas
                  </span>
                  <span className="range">
                    aforo <b>{ev.capacity}</b>
                  </span>
                </div>
                <div className="capbar">
                  <div className="fill" style={{ width: `${Math.min(100, shown.fillRate * 100)}%` }} />
                  <div
                    className="band"
                    style={{
                      left: `${Math.min(100, (shown.p10 / ev.capacity) * 100)}%`,
                      width: `${Math.max(1, ((shown.p90 - shown.p10) / ev.capacity) * 100)}%`,
                    }}
                  />
                </div>
                <div className="cap-legend">
                  <span>
                    <b>{pct(shown.fillRate)}</b> lleno
                  </span>
                  <span>
                    <b>{int(shown.emitted)}</b> entradas emitidas
                  </span>
                </div>
                <p className="small dim">
                  En puerta: <b>{shown.staff.scanners} escáneres</b> y {shown.staff.security} de
                  logística; el pico es de {shown.staff.peakPerQuarter} personas en 15 minutos.
                </p>
                <div className="row">
                  <a
                    className="btn btn-primary"
                    href={whatsappUrl(summary)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <path d="M12.04 2a9.9 9.9 0 0 0-8.5 14.95L2 22l5.2-1.5A9.9 9.9 0 1 0 12.04 2Zm0 1.8a8.1 8.1 0 1 1-4.1 15.09l-.3-.18-3.08.89.9-3-.2-.31A8.1 8.1 0 0 1 12.04 3.8Zm4.66 10.3c-.25-.13-1.47-.72-1.7-.8-.23-.09-.4-.13-.56.12s-.64.8-.79.97c-.14.16-.29.18-.54.06a6.6 6.6 0 0 1-1.95-1.2 7.3 7.3 0 0 1-1.35-1.68c-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.44.13-.15.17-.25.25-.42.09-.16.05-.31-.01-.44-.07-.12-.56-1.34-.76-1.84-.2-.48-.4-.41-.56-.42h-.47c-.16 0-.43.06-.65.31-.22.25-.85.83-.85 2.03s.87 2.35 1 2.51c.12.17 1.71 2.61 4.15 3.66.58.25 1.03.4 1.39.51.58.19 1.11.16 1.53.1.47-.07 1.47-.6 1.68-1.19.2-.58.2-1.08.14-1.18-.06-.1-.22-.16-.47-.29Z" />
                    </svg>
                    Enviar por WhatsApp
                  </a>
                  <button className="btn btn-ghost" onClick={copy} type="button">
                    {copied ? '✓ enlace copiado' : 'Copiar enlace'}
                  </button>
                  {running && <span className="xs muted">consultando el modelo…</span>}
                </div>
              </div>
            </div>
          </section>

          {/* ---------- paso 2 ---------- */}
          <section className="box rise" style={{ animationDelay: '60ms' }}>
            <div className="box-band cyan">
              <span className="row" style={{ gap: 8 }}>
                <i className="step">2</i> ¿Cuántas entradas gratis sueltas?
              </span>
              <small>{freeTotal} en juego</small>
            </div>
            <div className="box-body">
              {LEVERS.map((l) => (
                <Slider
                  key={l.key}
                  id={`lv-${l.key}`}
                  label={LEVER_LABEL[l.key]}
                  rate={LEVER_RATE[l.key]}
                  hint={l.hint}
                  value={levers[l.key]}
                  max={sliderMax}
                  onChange={set(l.key)}
                />
              ))}

              <div className="callout" style={{ marginTop: 14 }}>
                <h4>Lo que conviene</h4>
                <p>
                  Con lo ya vendido te sobran <b>{rec.headroom}</b> puestos. Repartiéndolos como{' '}
                  <b>{LEVER_LABEL[rec.bestLever]}</b> caben <b>{rec.suggestedFree}</b> entradas: suman{' '}
                  <b>{int(rec.gain)}</b> asistentes y dejan el riesgo de sobreaforo en{' '}
                  <b>{pct(rec.riskAt)}</b>. Las mismas entradas como cortesía abierta traerían solo{' '}
                  <b>{Math.round(rec.suggestedFree * LEVER_RATE.cortesia * shown.lift)}</b>.
                </p>
              </div>

              {freeTotal > 0 && (
                <button
                  className="btn btn-ghost"
                  style={{ marginTop: 12 }}
                  onClick={() => setLevers(emptyLevers)}
                  type="button"
                >
                  Volver a cero
                </button>
              )}
            </div>
          </section>

          {/* ---------- todo lo demás, plegado ---------- */}
          <details className="fold rise" style={{ animationDelay: '100ms' }}>
            <summary>Ver el detalle</summary>
            <div className="fold-body">
              <div>
                <h4 style={{ fontSize: 13, marginBottom: 10 }}>De dónde sale el número</h4>
                <StackedRow
                  total={shown.emitted}
                  segments={shown.buckets.map((b) => ({
                    label: b.label,
                    value: b.count,
                    color: SERIES[b.seriesIndex % SERIES.length],
                    note: `entra ${pct(b.rate)}`,
                  }))}
                />
                <Legend
                  items={shown.buckets.map((b) => ({
                    label: b.label,
                    color: SERIES[b.seriesIndex % SERIES.length],
                  }))}
                />
                <div className="table-wrap" style={{ marginTop: 12 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Tipo</th>
                        <th>Entradas</th>
                        <th>Entra</th>
                        <th>Aporta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.buckets.map((b) => (
                        <tr key={b.label}>
                          <td>{b.label}</td>
                          <td className="num">{b.count}</td>
                          <td className="num">{pct(b.rate, 1)}</td>
                          <td className="num">{Math.round(b.contribution)}</td>
                        </tr>
                      ))}
                      <tr>
                        <td>Total</td>
                        <td className="num">{shown.emitted}</td>
                        <td className="num muted">—</td>
                        <td className="num">{int(shown.demand)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                {shown.demand > ev.capacity && (
                  <p className="xs" style={{ color: 'var(--warning)', marginTop: 8 }}>
                    La demanda ({int(shown.demand)}) pasa el aforo:{' '}
                    {int(shown.demand - ev.capacity)} personas se quedan afuera.
                  </p>
                )}
              </div>

              {ev.mix['Cortesía'] > 0 && (
                <Slider
                  id="lv-convertir"
                  label="Cortesías que recuperas y vendes"
                  rate={0.94}
                  hint={`De las ${ev.mix['Cortesía']} cortesías ya emitidas, cuántas vuelven a la venta.`}
                  value={levers.convertirCortesias}
                  max={ev.mix['Cortesía']}
                  onChange={set('convertirCortesias')}
                />
              )}

              <div>
                <h4 style={{ fontSize: 13, marginBottom: 10 }}>
                  Cuántas entradas gratis aguanta la puerta
                </h4>
                <SweepChart
                  points={volume}
                  capacity={ev.capacity}
                  current={freeTotal > 0 ? freeTotal : undefined}
                  formatX={(v) => `${Math.round(v)}`}
                  xTitle="entradas gratis repartidas"
                  tooltip={(p) => (
                    <>
                      <span className="t-k">{Math.round(p.x)} gratis</span> → {p.expected} personas ·{' '}
                      {p.p10}–{p.p90}
                    </>
                  )}
                />
                <p className="small dim" style={{ marginTop: 8 }}>
                  Cuando la banda toca el aforo, cada entrada extra sólo agrega gente en la fila.
                </p>
              </div>

              {split.length > 0 && (
                <div>
                  <h4 style={{ fontSize: 13, marginBottom: 10 }}>
                    La mejor relación cortesía ↔ Boom
                  </h4>
                  <SweepChart
                    points={split}
                    capacity={ev.capacity}
                    current={levers.cortesia / freeTotal}
                    formatX={(v) => pct(v)}
                    xTitle="% del cupo gratis que va a cortesía abierta"
                    tooltip={(p) => (
                      <>
                        <span className="t-k">{pct(p.x)} cortesía</span> → {p.expected} personas
                      </>
                    )}
                  />
                  <p className="small dim" style={{ marginTop: 8 }}>
                    Mismo regalo, distinta gente: de{' '}
                    <b>{split[split.length - 1].expected}</b> a <b>{split[0].expected}</b> personas.
                  </p>
                </div>
              )}

              <div className="small dim" style={{ display: 'grid', gap: 8 }}>
                <h4 style={{ fontSize: 13 }}>Cómo se calcula</h4>
                <p>
                  <code>esperados = Σ (entradas_tipo × tasa_tipo) × factor_show</code>, recortado por
                  el aforo. Este show tiene factor ×{shown.lift.toFixed(3)}.
                </p>
                <p>
                  Las tasas salen de julio, entrada por entrada:{' '}
                  {data.calibration.byTicketType.map((r) => `${r.type} ${pct(r.rate, 1)}`).join(' · ')}.
                  En Boom,{' '}
                  {data.calibration.boomByType.map((r) => `${r.type} ${pct(r.rate, 1)}`).join(' · ')}.
                </p>
                <p>
                  El factor del show combina artista y venue (asistencia real ÷ la que predice su
                  mezcla), encogido hacia 1 con un prior de {data.calibration.shrink} entradas. El
                  rango usa la varianza de la mezcla por la sobredispersión observada (φ ={' '}
                  {data.calibration.overdispersion.toFixed(2)}), a ±1,28 σ.
                </p>
                <p className="xs muted">
                  La caída de asistencia cuando suben las cortesías es casi toda aritmética de mezcla.
                  Al descontarla, la dilución que sobra es{' '}
                  {data.calibration.residualDilution.slope.toFixed(4)} (r²{' '}
                  {data.calibration.residualDilution.r2.toFixed(2)}): una cortesía cuesta exactamente
                  su propia tasa, no contagia al resto.
                </p>
                <p className="xs muted">
                  Sin palancas, este show proyecta {base.expected} personas.{' '}
                  {hasRemote
                    ? 'Conectado al endpoint del modelo: se consulta solo con cada cambio.'
                    : base.source === 'modelo'
                      ? `Proyección base generada por ${modelAlgorithm}; las palancas se calculan al instante en el navegador.`
                      : 'Corriendo con la calibración de julio, en el navegador y sin backend.'}
                </p>
              </div>
            </div>
          </details>
        </div>
      </div>
    </>
  );
}
