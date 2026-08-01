import { useCallback, useEffect, useRef, useState } from 'react';

const SLIDE_COUNT = 9;

const MIC_OPEN = [
  { date: '07 JUL', mix: '82 pagadas + 44 cortesías', rate: 65.9, courtesy: false },
  { date: '14 JUL', mix: '140 pagadas + 65 cortesías', rate: 69.3, courtesy: false },
  { date: '21 JUL', mix: '122 cortesías', rate: 27.9, courtesy: true },
  { date: '28 JUL', mix: '138 cortesías', rate: 26.8, courtesy: true },
];

function initialSlide() {
  const value = Number(location.hash.match(/\d+/)?.[0]);
  return Number.isFinite(value) && value >= 1 && value <= SLIDE_COUNT ? value - 1 : 0;
}

export function Pitch() {
  const [slide, setSlide] = useState(initialSlide);
  const touchStart = useRef<number | null>(null);

  const goTo = useCallback((next: number) => {
    setSlide(Math.max(0, Math.min(SLIDE_COUNT - 1, next)));
  }, []);

  const forward = useCallback(() => goTo(slide + 1), [goTo, slide]);
  const back = useCallback(() => goTo(slide - 1), [goTo, slide]);

  useEffect(() => {
    history.replaceState(null, '', `${location.pathname}${location.search}#${slide + 1}`);
  }, [slide]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTextControl = target?.closest('input, textarea, select');
      const isInteractive = target?.closest('a, button');
      if (isTextControl || (isInteractive && event.key === ' ')) return;

      if (['ArrowDown', 'ArrowRight', 'PageDown', ' '].includes(event.key)) {
        event.preventDefault();
        forward();
      } else if (['ArrowUp', 'ArrowLeft', 'PageUp'].includes(event.key)) {
        event.preventDefault();
        back();
      } else if (event.key === 'Home') {
        event.preventDefault();
        goTo(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        goTo(SLIDE_COUNT - 1);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [back, forward, goTo]);

  const slides = [
    <section className="pitch-slide cover" aria-labelledby="slide-1-title">
      <div className="pitch-kicker">FREETICKET × BOOM · HACKATHON 2026</div>
      <div className="cover-grid">
        <div>
          <span className="wordmark"><i>A</i> AFORO</span>
          <h1 id="slide-1-title">¿Cuánta gente<br />entra <em>realmente?</em></h1>
          <p className="pitch-lede">Pronóstico de asistencia para preparar la puerta antes de que empiece el show.</p>
        </div>
        <div className="cover-number" aria-hidden="true">
          <span>?</span>
          <small>ENTRADAS ≠ PERSONAS</small>
        </div>
      </div>
      <p className="gesture-hint">Presiona <kbd>↓</kbd> para comenzar</p>
    </section>,

    <section className="pitch-slide problem" aria-labelledby="slide-2-title">
      <div className="pitch-kicker">01 · EL PROBLEMA</div>
      <h2 id="slide-2-title">Una entrada emitida<br /><em>no es una persona en la puerta.</em></h2>
      <div className="problem-equation">
        <div className="big-stat cyan"><strong>500</strong><span>entradas emitidas</span></div>
        <div className="equation-arrow" aria-hidden="true">→</div>
        <div className="big-stat red"><strong>240</strong><span>personas que pueden llegar</span></div>
      </div>
      <div className="statement-strip"><span>HOY</span> La puerta se dimensiona a ojo: personal, inventario y capacidad reaccionan tarde.</div>
    </section>,

    <section className="pitch-slide thesis" aria-labelledby="slide-3-title">
      <div className="pitch-kicker">02 · LA TESIS</div>
      <h2 id="slide-3-title">No importa solo cuántas.<br /><em>Importa cuáles.</em></h2>
      <div className="rate-comparison">
        <article className="rate-card paid">
          <span>ENTRADA PAGADA</span>
          <strong>94<sup>%</sup></strong>
          <p>llega al show</p>
        </article>
        <div className="ratio" aria-label="Dos punto cuatro veces"><strong>2,4×</strong><span>más intención</span></div>
        <article className="rate-card free">
          <span>CORTESÍA ABIERTA</span>
          <strong>39<sup>%</sup></strong>
          <p>llega al show</p>
        </article>
      </div>
      <p className="pitch-footnote">Tasas observadas en 6.722 entradas de julio.</p>
    </section>,

    <section className="pitch-slide proof" aria-labelledby="slide-4-title">
      <div className="pitch-kicker">03 · LA PRUEBA</div>
      <div className="title-row">
        <h2 id="slide-4-title">Mismo show.<br /><em>Otra mezcla, otra puerta.</em></h2>
        <div className="show-stamp">MICRÓFONO<br />SUELTO<small>4 martes de julio</small></div>
      </div>
      <div className="proof-bars">
        {MIC_OPEN.map((row) => (
          <article className={row.courtesy ? 'courtesy-only' : ''} key={row.date}>
            <header><strong>{row.date}</strong><span>{row.mix}</span></header>
            <div className="proof-track"><i style={{ width: `${row.rate}%` }} /></div>
            <b>{row.rate.toFixed(1).replace('.', ',')}%</b>
          </article>
        ))}
      </div>
      <p className="proof-conclusion">Cuando la función fue 100% cortesía, la asistencia cayó de ~68% a ~27%.</p>
    </section>,

    <section className="pitch-slide matching" aria-labelledby="slide-5-title">
      <div className="pitch-kicker">04 · EL CRUCE</div>
      <h2 id="slide-5-title">Cruzar identidad<br /><em>sin inventarla.</em></h2>
      <div className="matching-flow">
        <div className="source-node"><strong>6.383</strong><span>ventas FreeTicket</span></div>
        <div className="flow-line" aria-hidden="true" />
        <div className="match-results">
          <div className="accepted"><strong>3.951</strong><span>matches aceptados · 61,9%</span></div>
          <div><strong>2.432</strong><span>sin evidencia suficiente</span></div>
        </div>
      </div>
      <div className="abstention">
        <strong>36</strong>
        <div><b>abstenciones deliberadas</b><p>Email y teléfono apuntaban a personas distintas. No elegimos una al azar.</p></div>
      </div>
      <p className="pitch-mantra">Un match falso contamina el historial y también la predicción.</p>
    </section>,

    <section className="pitch-slide leakage" aria-labelledby="slide-6-title">
      <div className="pitch-kicker">05 · LA TRAMPA</div>
      <h2 id="slide-6-title">Entrenar con el futuro<br /><em>es hacer trampa sin querer.</em></h2>
      <div className="leak-grid">
        <div className="future-number"><strong>666</strong><span>tickets Boom usados después del corte</span><small>634 usuarios afectados</small></div>
        <div className="timeline" aria-label="Línea de tiempo del corte de datos">
          <div className="timeline-line"><i /><i className="cut" /><i /></div>
          <div className="timeline-labels"><span><b>01 JUL</b>historia madura</span><span className="cut-label"><b>01 AGO</b>corte del modelo</span><span><b>26 AGO</b>dato del futuro</span></div>
        </div>
      </div>
      <div className="three-states">
        <span><b>¿Ya fue usado?</b> No</span>
        <span><b>¿Resultado observado?</b> No</span>
        <span className="unknown"><b>¿Faltó al show?</b> Desconocido</span>
      </div>
    </section>,

    <section className="pitch-slide product" aria-labelledby="slide-7-title">
      <div className="pitch-kicker">06 · EL PRODUCTO</div>
      <div className="product-layout">
        <div>
          <h2 id="slide-7-title">De datos a una<br /><em>decisión de puerta.</em></h2>
          <p className="pitch-lede">Elige el show, mueve las cortesías y mira cómo cambia el aforo en tiempo real.</p>
          <a className="demo-button" href="/e/ft_evt_0040#proyeccion" target="_blank" rel="noreferrer">
            ABRIR DEMO EN VIVO <span aria-hidden="true">↗</span>
          </a>
          <small className="demo-note">Trasnoche Cali · 1 de agosto · Sala Beethoven</small>
        </div>
        <div className="app-preview">
          <header><span><i>A</i> AFORO</span><b>MODELO CATBOOST</b></header>
          <div className="preview-title"><span>TRASNOCHE CALI</span><small>118 entradas emitidas · aforo 150</small></div>
          <div className="prediction"><strong>100</strong><span>personas esperadas<small>entre 91 y 109</small></span></div>
          <div className="capacity-bar"><i /></div>
          <div className="preview-control"><span>CORTESÍAS NUEVAS</span><b>0</b></div>
          <div className="fake-range"><i /></div>
        </div>
      </div>
    </section>,

    <section className="pitch-slide whatsapp" aria-labelledby="slide-8-title">
      <div className="pitch-kicker">07 · LA PUERTA</div>
      <div className="whatsapp-layout">
        <div>
          <h2 id="slide-8-title">El viernes en la puerta<br /><em>nadie abre un notebook.</em></h2>
          <p className="pitch-lede">Cada pronóstico se comparte como un enlace con preview y el estado exacto de las palancas.</p>
          <div className="operator-points"><span>Un toque</span><span>Un número accionable</span><span>Siempre actualizado</span></div>
        </div>
        <div className="phone" aria-label="Ejemplo del mensaje que se comparte por WhatsApp">
          <div className="phone-top">WhatsApp <i>•••</i></div>
          <div className="message">
            <b>Trasnoche Cali</b>
            <span>Sáb 1 ago · Sala Beethoven</span>
            <div className="link-preview"><strong>100 personas esperadas</strong><span>Entre 91 y 109 · aforo 150</span><small>AFORO · PROYECCIÓN DE PUERTA</small></div>
            <p>Puerta: 2 escáneres y 1 de logística.</p>
            <time>6:42 p. m. ✓✓</time>
          </div>
        </div>
      </div>
    </section>,

    <section className="pitch-slide next" aria-labelledby="slide-9-title">
      <div className="pitch-kicker">08 · CON 4 HORAS MÁS</div>
      <h2 id="slide-9-title">El modelo ya responde.<br /><em>Ahora puede aprender cada noche.</em></h2>
      <div className="next-steps">
        <article><span>01</span><h3>Automatizar el corte</h3><p>Recalcular cuando entren nuevas ventas, sin contaminar el histórico.</p></article>
        <article><span>02</span><h3>Cerrar el ciclo</h3><p>Incorporar el check-in final de cada show y recalibrar la incertidumbre.</p></article>
        <article><span>03</span><h3>Llevarlo a operación</h3><p>Alertas de sobreaforo, personal y apertura de puertas para cada función.</p></article>
      </div>
      <div className="closing-line"><span>AFORO</span><strong>De contar entradas a preparar la puerta.</strong></div>
    </section>,
  ];

  return (
    <main
      className="pitch-shell"
      onTouchStart={(event) => { touchStart.current = event.touches[0]?.clientY ?? null; }}
      onTouchEnd={(event) => {
        if (touchStart.current === null) return;
        const delta = touchStart.current - (event.changedTouches[0]?.clientY ?? touchStart.current);
        if (Math.abs(delta) > 50) delta > 0 ? forward() : back();
        touchStart.current = null;
      }}
    >
      <div className="slide-stage" key={slide}>{slides[slide]}</div>

      <nav className="pitch-progress" aria-label="Navegación de la presentación">
        <span className="slide-count"><b>{String(slide + 1).padStart(2, '0')}</b> / {String(SLIDE_COUNT).padStart(2, '0')}</span>
        <div className="progress-dots">
          {Array.from({ length: SLIDE_COUNT }, (_, index) => (
            <button
              type="button"
              aria-label={`Ir a la pantalla ${index + 1}`}
              aria-current={index === slide ? 'step' : undefined}
              onClick={() => goTo(index)}
              key={index}
            />
          ))}
        </div>
        <div className="arrow-controls">
          <button type="button" onClick={back} disabled={slide === 0} aria-label="Pantalla anterior">↑</button>
          <button type="button" onClick={forward} disabled={slide === SLIDE_COUNT - 1} aria-label="Pantalla siguiente">↓</button>
        </div>
      </nav>
    </main>
  );
}
