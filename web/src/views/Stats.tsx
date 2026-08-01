import { useState } from 'react';
import { AreaCurve, BarList, Legend, SERIES, Scatter } from '../components/charts';
import { data } from '../lib/model';
import { fmtDate, int, money, offsetLabel, pct } from '../lib/format';

const S = data.stats;
const C = data.calibration;

type Cut = 'byCity' | 'byVenue' | 'byWeekday' | 'byChannel' | 'byResidency';

const CUTS: { key: Cut; label: string }[] = [
  { key: 'byCity', label: 'Ciudad' },
  { key: 'byVenue', label: 'Venue' },
  { key: 'byWeekday', label: 'Día' },
  { key: 'byChannel', label: 'Canal' },
  { key: 'byResidency', label: 'Residencia' },
];

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="tile">
      <span className="t-label">{label}</span>
      <span className="t-value">{value}</span>
      {note && <span className="t-note">{note}</span>}
    </div>
  );
}

function Box({
  title,
  note,
  band = 'plain',
  children,
  delay = 0,
}: {
  title: string;
  note?: React.ReactNode;
  band?: 'plain' | 'cyan' | 'red';
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <section className="box rise" style={{ animationDelay: `${delay}ms` }}>
      <div className={`box-band ${band === 'red' ? '' : band}`}>
        <span>{title}</span>
        {note && <small>{note}</small>}
      </div>
      <div className="box-body">{children}</div>
    </section>
  );
}

export function Stats() {
  const [cut, setCut] = useState<Cut>('byCity');
  const rows = S[cut] as { key: string; issued: number; rate: number; events?: number }[];

  const julyRate = S.july.attended / S.july.issued;
  const cortesia = C.byTicketType.find((r) => r.type === 'Cortesía');
  const courtesyNoShows = (cortesia?.issued ?? 0) - (cortesia?.attended ?? 0);
  const paidVsFree =
    (C.byTicketType.find((r) => r.type === 'General')?.rate ?? 0.94) / (cortesia?.rate ?? 0.4);
  const arrival = S.arrivalCurve.map((b) => ({ x: b.minutes, y: b.count }));

  const upcoming = data.events
    .filter((e) => e.month === 'agosto')
    .sort((a, b) => b.issued / b.capacity - a.issued / a.capacity);

  return (
    <>
      <div className="page-head">
        <h1>Lo que ya pasó</h1>
        <p>
          32 shows de julio con check-in entrada por entrada. Esto es lo que el modelo usa para
          aprender, y la respuesta a por qué “vendimos 500” nunca fue 500 personas.
        </p>
      </div>

      <div className="stack">
        <section className="tiles rise">
          <Tile label="Shows" value={String(S.july.events)} note={`${S.august.events} por venir`} />
          <Tile
            label="Entradas emitidas"
            value={int(S.july.issued)}
            note={`aforo total ${int(S.july.capacity)}`}
          />
          <Tile label="Entraron" value={int(S.july.attended)} note={`${pct(julyRate, 1)} de lo emitido`} />
          <Tile
            label="No aparecieron"
            value={int(S.july.issued - S.july.attended)}
            note={`${pct(courtesyNoShows / (S.july.issued - S.july.attended))} eran cortesías`}
          />
          <Tile label="Taquilla" value={money(S.july.revenue)} note="julio" />
          <Tile
            label="Usuarios Boom"
            value={int(S.boom.users)}
            note={`${pct(S.boom.withMembership / S.boom.users)} con membresía`}
          />
        </section>

        <div className="cols">
          <Box title="Quién entra, por tipo de entrada" note="julio, entrada por entrada" band="cyan" delay={60}>
            <BarList
              data={[
                ...C.byTicketType.map((r, i) => ({
                  label: r.type,
                  value: r.rate,
                  color: SERIES[i % SERIES.length],
                  detail: (
                    <>
                      <span className="t-k">{r.type}</span> {pct(r.rate, 1)} · {int(r.attended ?? 0)} de{' '}
                      {int(r.issued ?? 0)}
                    </>
                  ),
                })),
                ...C.boomByType.map((r) => ({
                  label: `Boom · ${r.type.replace('_', ' ')}`,
                  value: r.rate,
                  color: 'var(--s5)',
                  detail: (
                    <>
                      <span className="t-k">Boom {r.type}</span> {pct(r.rate, 1)} · {int(r.used ?? 0)} de{' '}
                      {int(r.tickets ?? 0)}
                    </>
                  ),
                })),
              ]}
              max={1}
              format={(v) => pct(v, 1)}
            />
            <p className="small dim" style={{ marginTop: 12 }}>
              Una entrada pagada vale <b>{paidVsFree.toFixed(1).replace('.', ',')} cortesías</b> a la
              hora de contar cabezas. Ahí está todo el negocio de la puerta.
            </p>
          </Box>

          <Box title="A qué hora llega la gente" note="minutos respecto al show" delay={100}>
            <AreaCurve
              points={arrival}
              formatX={(v) => offsetLabel(v)}
              formatY={(v) => int(v)}
              xLabel={(p) => (
                <>
                  <span className="t-k">{offsetLabel(p.x)}</span> {int(p.y)} personas
                </>
              )}
            />
            <p className="small dim" style={{ marginTop: 12 }}>
              El grueso entra entre 45 y 15 minutos antes. La puerta se dimensiona para ese cuarto de
              hora, no para el total de la noche.
            </p>
          </Box>
        </div>

        <section className="box rise" style={{ animationDelay: '140ms' }}>
          <div className="box-band">
            <span>Asistencia por corte</span>
          </div>
          <div className="box-body">
            <div className="chips" style={{ marginBottom: 14 }}>
              {CUTS.map((c) => (
                <button
                  key={c.key}
                  className="chip"
                  aria-pressed={cut === c.key}
                  onClick={() => setCut(c.key)}
                  type="button"
                >
                  {c.label}
                </button>
              ))}
            </div>
            <BarList
              data={rows.map((r) => ({
                label: r.key,
                value: r.rate,
                color: 'var(--s3)',
                detail: (
                  <>
                    <span className="t-k">{r.key}</span> {pct(r.rate, 1)} · {int(r.issued)} entradas
                    {r.events ? ` · ${r.events} shows` : ''}
                  </>
                ),
              }))}
              max={1}
              format={(v) => pct(v, 1)}
            />
            <Legend items={[{ label: 'tasa de entrada sobre lo emitido', color: 'var(--s3)' }]} />
          </div>
        </section>

        <div className="cols">
          <Box title="Cortesías vs asistencia" note="un punto por show · tamaño = entradas" delay={180}>
            <Scatter
              points={C.dilution.points.map((p) => ({ x: p.x, y: p.y, r: p.issued, label: p.artist }))}
              fit={{ slope: C.dilution.slope, intercept: C.dilution.intercept }}
              formatX={(v) => pct(v)}
              formatY={(v) => pct(v)}
              xTitle="% cortesías"
              yTitle="% que entró"
            />
            <p className="small dim" style={{ marginTop: 12 }}>
              Pendiente <b>{C.dilution.slope.toFixed(2)}</b> (r² {C.dilution.r2.toFixed(2)}): cada 10
              puntos de cortesía cuestan {Math.abs(C.dilution.slope * 10).toFixed(1)} puntos de
              asistencia. Y es casi pura aritmética de mezcla — al descontarla no queda dilución (
              {C.residualDilution.slope.toFixed(4)}).
            </p>
          </Box>

          <Box title="Factor propio del show" note="asistencia real ÷ la que predice su mezcla" delay={220}>
            <BarList
              data={C.liftByVenue
                .slice()
                .sort((a, b) => b.lift - a.lift)
                .map((l) => ({
                  label: l.key,
                  value: l.lift,
                  color: l.lift >= 1 ? 'var(--s3)' : 'var(--s2)',
                  detail: (
                    <>
                      <span className="t-k">{l.key}</span> ×{l.lift.toFixed(3)} · {l.events} shows ·{' '}
                      {int(l.attended)} de {int(Math.round(l.expected))} previstos
                    </>
                  ),
                }))}
              max={1.15}
              format={(v) => `×${v.toFixed(3)}`}
            />
            <p className="small dim" style={{ marginTop: 12 }}>
              Encogido hacia 1 con un prior de {C.shrink} entradas: un venue con dos shows no puede
              mover la proyección tanto como uno con ocho.
            </p>
          </Box>
        </div>

        <Box
          title="Agosto: qué hay vendido hoy"
          note={`${int(S.august.issued)} entradas · ${pct(S.august.courtesy / S.august.issued)} cortesías`}
          band="cyan"
          delay={260}
        >
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Show</th>
                  <th>Fecha</th>
                  <th>Venue</th>
                  <th>Emitidas</th>
                  <th>Aforo</th>
                  <th>Llenado</th>
                  <th>Cortesía</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((e) => (
                  <tr key={e.id}>
                    <td>{e.artist}</td>
                    <td className="num muted">{fmtDate(e.startsAt)}</td>
                    <td className="muted">{e.venue}</td>
                    <td className="num">{e.issued}</td>
                    <td className="num muted">{e.capacity}</td>
                    <td className="num" style={{ color: e.fillRate > 0.95 ? 'var(--warning)' : undefined }}>
                      {pct(e.fillRate)}
                    </td>
                    <td className="num">{pct(e.courtesyShare)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Box>

        <Box
          title="Boom · qué tan fieles son"
          note={`${int(S.boom.users)} personas · uso medio ${pct(S.boom.avgUseRate, 1)}`}
          delay={300}
        >
          <BarList
            data={S.boom.useRateHistogram.map((h) => ({
              label: h.bin,
              value: h.count,
              color: 'var(--s1)',
              detail: (
                <>
                  <span className="t-k">usan {h.bin}</span> {int(h.count)} personas
                </>
              ),
            }))}
            format={(v) => int(v)}
            labelWidth={78}
            barHeight={16}
            gap={7}
          />
          <p className="small dim" style={{ marginTop: 12 }}>
            La cola derecha es el activo: los que usan más del 80% de lo que reciben. A esos les puedes
            soltar cortesías sin que la puerta quede vacía. El cruce con la tiquetera es lo que dice
            quién de los compradores de agosto está ahí.
          </p>
        </Box>
      </div>
    </>
  );
}
