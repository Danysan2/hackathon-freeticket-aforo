/**
 * Kit de gráficos en SVG puro. Sin librerías.
 *
 * El viewBox se ajusta al ancho real del contenedor (ResizeObserver) en vez de
 * escalarse: así el texto conserva su tamaño en px sea cual sea la columna.
 * Cada forma trae su capa de hover; las series llevan leyenda y etiqueta directa.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)'];

interface TipState {
  x: number;
  y: number;
  content: ReactNode;
}

function useTip() {
  const [tip, setTip] = useState<TipState | null>(null);
  return { tip, setTip, clear: () => setTip(null) };
}

/** Ancho real del contenedor, para dibujar 1 unidad de viewBox = 1 px. */
function useWidth(fallback = 640) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Medición inmediata: el observer puede tardar (o no correr, si la pestaña
    // está en segundo plano), y el primer pintado ya necesita el ancho bueno.
    const measure = () => {
      // Piso bajo a propósito: por encima de él el dibujo es 1 unidad = 1 px y
      // el texto no se encoge ni en un teléfono de 320.
      const next = Math.max(220, Math.round(el.getBoundingClientRect().width));
      setW((prev) => (Math.abs(prev - next) > 1 ? next : prev));
    };
    measure();
    // Y otra vez cuando el layout se asienta (fuentes, scrollbar, pestaña oculta).
    const raf = requestAnimationFrame(measure);
    const t = setTimeout(measure, 120);

    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  return [ref, w] as const;
}

function Tip({ tip, vw }: { tip: TipState | null; vw: number }) {
  if (!tip) return null;
  // Se ancla dentro del gráfico: si no, en pantalla angosta el globo se sale y
  // arrastra scroll horizontal a toda la página.
  const left = Math.min(Math.max(tip.x, 64), Math.max(64, vw - 64));
  return (
    <div className="tip" style={{ left, top: tip.y, marginTop: -10 }}>
      {tip.content}
    </div>
  );
}

/** Oswald es condensada: ~0,44 em por carácter. Recorta lo que no cabe. */
function fit(label: string, width: number, fontSize = 12) {
  const max = Math.floor(width / (fontSize * 0.44));
  return label.length > max ? `${label.slice(0, Math.max(1, max - 1))}…` : label;
}

const svgStyle = { width: '100%', height: 'auto', display: 'block' } as const;

/* ------------------------------------------------------------------ */
/* Barras horizontales: magnitud comparada entre categorías con nombre  */
/* ------------------------------------------------------------------ */
export interface BarDatum {
  label: string;
  value: number;
  note?: string;
  color?: string;
  detail?: ReactNode;
}

export function BarList({
  data,
  format,
  max,
  labelWidth,
  barHeight = 22,
  gap = 10,
}: {
  data: BarDatum[];
  format: (v: number) => string;
  max?: number;
  labelWidth?: number;
  barHeight?: number;
  gap?: number;
}) {
  const { tip, setTip, clear } = useTip();
  const [ref, VW] = useWidth();
  const lw = labelWidth ?? Math.min(170, Math.max(96, Math.round(VW * 0.3)));
  const top = 4;
  const VH = top * 2 + data.length * (barHeight + gap) - gap;
  const right = 56;
  const domain = max ?? Math.max(...data.map((d) => d.value), 0.0001);
  const w = Math.max(40, VW - lw - right);

  return (
    <div className="viz-wrap" ref={ref}>
      <svg className="viz" viewBox={`0 0 ${VW} ${VH}`} style={svgStyle} role="img">
        {data.map((d, i) => {
          const y = top + i * (barHeight + gap);
          const len = Math.max(2, (d.value / domain) * w);
          const color = d.color ?? SERIES[i % SERIES.length];
          return (
            <g key={d.label}>
              <text x={0} y={y + barHeight * 0.7} className="lbl">
                {fit(d.label, lw - 10)}
                <title>{d.label}</title>
              </text>
              <rect x={lw} y={y} width={w} height={barHeight} rx={4} fill="var(--surface-2)" />
              <rect className="mark" x={lw} y={y} width={len} height={barHeight} rx={4} fill={color} />
              <text x={lw + len + 8} y={y + barHeight * 0.72} className="lbl-strong">
                {format(d.value)}
              </text>
              <rect
                className="hit"
                x={lw}
                y={y - gap / 2}
                width={w}
                height={barHeight + gap}
                onMouseMove={() =>
                  setTip({
                    x: Math.min(VW - 20, lw + len),
                    y,
                    content: d.detail ?? (
                      <>
                        <span className="t-k">{d.label}</span> {format(d.value)}
                        {d.note ? ` · ${d.note}` : ''}
                      </>
                    ),
                  })
                }
                onMouseLeave={clear}
              />
            </g>
          );
        })}
      </svg>
      <Tip tip={tip} vw={VW} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Barra apilada de una fila: la mezcla de entradas de un evento        */
/* En HTML, no SVG: se comporta mejor en columnas angostas.             */
/* ------------------------------------------------------------------ */
export function StackedRow({
  segments,
  total,
}: {
  segments: { label: string; value: number; color: string; note?: string }[];
  total: number;
}) {
  return (
    <div className="stackbar" role="img" aria-label={`Mezcla de ${total} entradas`}>
      {segments.map((s) => (
        <div
          key={s.label}
          className="seg"
          style={{ flexGrow: s.value, background: s.color }}
          title={`${s.label}: ${s.value}${s.note ? ` (${s.note})` : ''}`}
        >
          {s.value / Math.max(1, total) > 0.08 && <span>{s.value}</span>}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Área + línea: la curva de llegada                                    */
/* ------------------------------------------------------------------ */
export function AreaCurve({
  points,
  xLabel,
  formatX,
  formatY,
}: {
  points: { x: number; y: number }[];
  xLabel: (p: { x: number; y: number }) => ReactNode;
  formatX: (v: number) => string;
  formatY: (v: number) => string;
}) {
  const { tip, setTip, clear } = useTip();
  const [ref, VW] = useWidth();
  const VH = 230;
  const m = { t: 14, r: 14, b: 28, l: 44 };
  const iw = VW - m.l - m.r;
  const ih = VH - m.t - m.b;
  const maxY = Math.max(...points.map((p) => p.y)) * 1.12;
  const sx = (i: number) => m.l + (i / Math.max(1, points.length - 1)) * iw;
  const sy = (v: number) => m.t + ih - (v / maxY) * ih;

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${sx(i)},${sy(p.y)}`).join(' ');
  const area = `${line} L${sx(points.length - 1)},${m.t + ih} L${sx(0)},${m.t + ih} Z`;
  const ticks = [0, 0.5, 1].map((f) => f * maxY);

  return (
    <div className="viz-wrap" ref={ref}>
      <svg className="viz" viewBox={`0 0 ${VW} ${VH}`} style={svgStyle} role="img">
        <defs>
          <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--s1)" stopOpacity="0.42" />
            <stop offset="100%" stopColor="var(--s1)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {ticks.map((t, i) => (
          <g key={i} className="tick">
            <line x1={m.l} x2={VW - m.r} y1={sy(t)} y2={sy(t)} />
            <text x={m.l - 8} y={sy(t) + 3.5} textAnchor="end">
              {formatY(t)}
            </text>
          </g>
        ))}
        <path d={area} fill="url(#areaFill)" />
        <path d={line} fill="none" stroke="var(--s1)" strokeWidth={2} strokeLinejoin="round" />
        {points.map((p, i) => (
          <g key={p.x}>
            <text x={sx(i)} y={VH - 8} textAnchor="middle">
              {formatX(p.x)}
            </text>
            <rect
              className="hit"
              x={sx(i) - iw / points.length / 2}
              y={m.t}
              width={iw / points.length}
              height={ih}
              onMouseMove={() => setTip({ x: sx(i), y: sy(p.y), content: xLabel(p) })}
              onMouseLeave={clear}
            />
          </g>
        ))}
        {tip && (
          <circle cx={tip.x} cy={tip.y} r={5} fill="var(--s1)" stroke="var(--surface)" strokeWidth={2} />
        )}
        <line className="axis" x1={m.l} x2={VW - m.r} y1={m.t + ih} y2={m.t + ih} />
      </svg>
      <Tip tip={tip} vw={VW} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Barrido: línea con banda p10–p90 y línea de referencia del aforo     */
/* ------------------------------------------------------------------ */
export function SweepChart({
  points,
  capacity,
  current,
  formatX,
  xTitle,
  tooltip,
}: {
  points: { x: number; expected: number; p10: number; p90: number }[];
  capacity: number;
  current?: number;
  formatX: (v: number) => string;
  xTitle: string;
  tooltip: (p: { x: number; expected: number; p10: number; p90: number }) => ReactNode;
}) {
  const { tip, setTip, clear } = useTip();
  const [ref, VW] = useWidth();
  const VH = 250;
  const m = { t: 18, r: 16, b: 38, l: 46 };
  const iw = VW - m.l - m.r;
  const ih = VH - m.t - m.b;

  const xs = points.map((p) => p.x);
  const xMin = points.length ? Math.min(...xs) : 0;
  const xMax = points.length ? Math.max(...xs) : 1;
  const yMax = Math.max(capacity * 1.08, ...points.map((p) => p.p90)) * 1.02;
  const sx = (v: number) => m.l + ((v - xMin) / Math.max(1e-9, xMax - xMin)) * iw;
  const sy = (v: number) => m.t + ih - (v / yMax) * ih;

  if (!points.length) return null;

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x)},${sy(p.expected)}`).join(' ');
  const band = [
    ...points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x)},${sy(p.p90)}`),
    ...[...points].reverse().map((p) => `L${sx(p.x)},${sy(p.p10)}`),
    'Z',
  ].join(' ');

  return (
    <div className="viz-wrap" ref={ref}>
      <svg className="viz" viewBox={`0 0 ${VW} ${VH}`} style={svgStyle} role="img">
        {[0, capacity / 2, capacity].map((t, i) => (
          <g key={i} className="tick">
            <line x1={m.l} x2={VW - m.r} y1={sy(t)} y2={sy(t)} />
            <text x={m.l - 8} y={sy(t) + 3.5} textAnchor="end">
              {Math.round(t)}
            </text>
          </g>
        ))}

        {/* aforo: la única línea que no conviene cruzar */}
        <line
          x1={m.l}
          x2={VW - m.r}
          y1={sy(capacity)}
          y2={sy(capacity)}
          stroke="var(--critical)"
          strokeWidth={1.5}
          strokeDasharray="5 4"
        />
        <text x={VW - m.r} y={sy(capacity) - 6} textAnchor="end" style={{ fill: 'var(--critical)' }}>
          aforo {capacity}
        </text>

        <path d={band} fill="var(--signal)" opacity={0.13} />
        <path d={line} fill="none" stroke="var(--signal)" strokeWidth={2} strokeLinejoin="round" />

        {current != null && (
          <g>
            <line
              x1={sx(current)}
              x2={sx(current)}
              y1={m.t}
              y2={m.t + ih}
              stroke="var(--paper-dim)"
              strokeWidth={1}
            />
            <text x={sx(current)} y={m.t - 5} textAnchor="middle" className="lbl-strong">
              ahora
            </text>
          </g>
        )}

        {points.map((p, i) => (
          <rect
            key={i}
            className="hit"
            x={sx(p.x) - iw / points.length / 2}
            y={m.t}
            width={iw / points.length}
            height={ih}
            onMouseMove={() => setTip({ x: sx(p.x), y: sy(p.expected), content: tooltip(p) })}
            onMouseLeave={clear}
          />
        ))}
        {tip && (
          <circle cx={tip.x} cy={tip.y} r={5} fill="var(--signal)" stroke="var(--surface)" strokeWidth={2} />
        )}

        {[xMin, (xMin + xMax) / 2, xMax].map((v, i) => (
          <text key={i} x={sx(v)} y={VH - 14} textAnchor="middle">
            {formatX(v)}
          </text>
        ))}
        <text x={VW - m.r} y={VH - 2} textAnchor="end" className="muted">
          {xTitle}
        </text>
        <line className="axis" x1={m.l} x2={VW - m.r} y1={m.t + ih} y2={m.t + ih} />
      </svg>
      <Tip tip={tip} vw={VW} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dispersión: cortesías vs asistencia, con la recta ajustada           */
/* ------------------------------------------------------------------ */
export function Scatter({
  points,
  fit,
  formatX,
  formatY,
  xTitle,
  yTitle,
}: {
  points: { x: number; y: number; r: number; label: string }[];
  fit?: { slope: number; intercept: number };
  formatX: (v: number) => string;
  formatY: (v: number) => string;
  xTitle: string;
  yTitle: string;
}) {
  const { tip, setTip, clear } = useTip();
  const [ref, VW] = useWidth();
  const VH = 280;
  const m = { t: 20, r: 18, b: 40, l: 48 };
  const iw = VW - m.l - m.r;
  const ih = VH - m.t - m.b;
  const xMax = Math.max(...points.map((p) => p.x)) * 1.1 || 1;
  const yMin = Math.min(...points.map((p) => p.y)) * 0.92;
  const yMax = Math.max(...points.map((p) => p.y)) * 1.04;
  const sx = (v: number) => m.l + (v / xMax) * iw;
  const sy = (v: number) => m.t + ih - ((v - yMin) / Math.max(1e-9, yMax - yMin)) * ih;
  const rMax = Math.max(...points.map((p) => p.r));

  return (
    <div className="viz-wrap" ref={ref}>
      <svg className="viz" viewBox={`0 0 ${VW} ${VH}`} style={svgStyle} role="img">
        {[yMin, (yMin + yMax) / 2, yMax].map((t, i) => (
          <g key={i} className="tick">
            <line x1={m.l} x2={VW - m.r} y1={sy(t)} y2={sy(t)} />
            <text x={m.l - 8} y={sy(t) + 3.5} textAnchor="end">
              {formatY(t)}
            </text>
          </g>
        ))}
        {fit && (
          <line
            x1={sx(0)}
            y1={sy(fit.intercept)}
            x2={sx(xMax)}
            y2={sy(fit.intercept + fit.slope * xMax)}
            stroke="var(--paper-dim)"
            strokeWidth={1.5}
            strokeDasharray="6 5"
          />
        )}
        {points.map((p, i) => (
          <circle
            key={`${p.label}-${i}`}
            className="mark"
            cx={sx(p.x)}
            cy={sy(p.y)}
            r={5 + (p.r / rMax) * 7}
            fill="var(--s3)"
            fillOpacity={0.5}
            stroke="var(--surface)"
            strokeWidth={2}
            onMouseMove={() =>
              setTip({
                x: sx(p.x),
                y: sy(p.y),
                content: (
                  <>
                    <span className="t-k">{p.label}</span> {formatX(p.x)} cortesía → {formatY(p.y)} entró
                  </>
                ),
              })
            }
            onMouseLeave={clear}
          />
        ))}
        {[0, xMax / 2, xMax].map((v, i) => (
          <text key={i} x={sx(v)} y={VH - 16} textAnchor="middle">
            {formatX(v)}
          </text>
        ))}
        <text x={VW - m.r} y={VH - 3} textAnchor="end" className="muted">
          {xTitle}
        </text>
        <text x={m.l - 8} y={m.t - 6} textAnchor="end" className="muted">
          {yTitle}
        </text>
        <line className="axis" x1={m.l} x2={VW - m.r} y1={m.t + ih} y2={m.t + ih} />
      </svg>
      <Tip tip={tip} vw={VW} />
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="viz-legend">
      {items.map((it) => (
        <span key={it.label}>
          <i style={{ background: it.color }} /> {it.label}
        </span>
      ))}
    </div>
  );
}
