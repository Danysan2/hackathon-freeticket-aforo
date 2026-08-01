import { useEffect, useState } from 'react';
import { Forecast } from './views/Forecast';
import { Stats } from './views/Stats';

type Tab = 'proyeccion' | 'estadisticas';

const TABS: { key: Tab; label: string }[] = [
  { key: 'proyeccion', label: 'Puerta' },
  { key: 'estadisticas', label: 'Datos' },
];

const readHash = (): Tab => (location.hash === '#estadisticas' ? 'estadisticas' : 'proyeccion');

export default function App() {
  const [tab, setTab] = useState<Tab>(readHash);

  useEffect(() => {
    location.hash = tab;
  }, [tab]);

  // El botón atrás del navegador también cambia de módulo.
  useEffect(() => {
    const onHash = () => setTab(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <>
      <header className="topbar">
        <div className="topbar-in">
          <div className="brand">
            <span className="brand-mark">A</span>
            <span>
              Aforo
              <small>Proyección de puerta</small>
            </span>
          </div>
          <nav className="tabs">
            {TABS.map((t) => (
              <button
                key={t.key}
                className="tab"
                aria-current={tab === t.key}
                onClick={() => setTab(t.key)}
                type="button"
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="marquee-strip" aria-hidden>
          <span>
            {Array.from({ length: 12 }, () => 'Aforo · cuánta gente entra realmente · ').join('')}
          </span>
        </div>
      </header>

      <main>{tab === 'proyeccion' ? <Forecast /> : <Stats />}</main>
    </>
  );
}
