# AGENTS.md

## App web (`web/`) — desplegada en Vercel

Hay una app React (Vite + TS) en `web/` que muestra la proyección de asistencia y
las estadísticas de julio. **Ya está desplegada y funciona sin el modelo**: mientras
no exista salida entrenada, calcula con la calibración de julio.

### Cómo entregarle tu modelo (no hace falta backend)

Escribe **`web/src/data/model.json`**. La app lo lee al construir; si tiene eventos,
los usa y muestra la versión en pantalla. No hay que tocar código ni levantar un
endpoint: el efecto de repartir entradas es lineal (la dilución residual medida es
−0,0007, r² 0,00), así que los sliders suman encima del baseline sin volver a llamar
al modelo.

```json
{
  "version": "2026-08-01T15:20:00Z",
  "rates": {
    "General": 0.938, "Preferencial": 0.939, "VIP": 0.949, "Cortesía": 0.387,
    "boom_membresia": 0.465, "boom_consumo": 0.749
  },
  "events": {
    "ft_evt_0040": { "baseline": 97.3, "lift": 1.025, "sd": 8.1 }
  }
}
```

- `baseline` — asistencia esperada de las entradas **ya emitidas** del evento, con su
  factor propio ya aplicado. Es el mismo número de `expected_attendance` en
  `forecast.csv`.
- `lift` (opcional) — factor propio del show; se usa para escalar las entradas nuevas.
- `sd` (opcional) — desviación de esa proyección; alimenta el rango p10–p90.
- `rates` (opcional) — si las omites, se usan las de julio calculadas desde `raw/`.
- Los eventos que no aparezcan siguen con la calibración de julio; se puede entregar
  parcial.

Si prefieres un endpoint en vivo, el contrato alterno está en `web/src/lib/api.ts`
(variable `VITE_FORECAST_API`). Es opcional y no lo necesita la demo.

### Reglas de la carpeta

- `web/src/data/dataset.json` se **versiona** (lo genera `scripts/build-webapp-data.mjs`
  desde `raw/`, que sí está en `.gitignore`). Si cambian los CSV, hay que regenerarlo:
  `node scripts/build-webapp-data.mjs`.
- En `.gitignore`, la regla de datos está anclada a la raíz (`/data/`) justo para que
  `web/src/data/` sí viaje al repo. No la vuelvas a dejar como `data/` o Vercel deja
  de construir.
- El `vercel.json` de la raíz es del organizador (proxy a InsForge). El de la app es
  `web/vercel.json`, y en Vercel el **Root Directory es `web`**.

<!-- INSFORGE:START -->
## InsForge backend

This project uses [InsForge](https://insforge.dev): an all-in-one, open-source Postgres-based backend (BaaS) that gives this app a database, authentication, file storage, edge functions, realtime, an AI model gateway, and payments through one platform.

- **Project:** **hackathon-freeticket** (API base `https://f8zf2kdy.us-east.insforge.app`)
- **Skills:** these InsForge skills are installed for supported coding agents. Reach for them before implementing any InsForge feature instead of guessing the API:
  - `insforge`: app code with the `@insforge/sdk` client (database CRUD, auth, storage, edge functions, realtime, AI, email, and Stripe payments).
  - `insforge-cli`: backend and infrastructure via the `insforge` CLI (projects, SQL, migrations, RLS policies, storage buckets, functions, secrets, payment setup, schedules, deploys).
  - `insforge-debug`: diagnosing failures (SDK/HTTP errors, RLS denials, auth and OAuth issues) and running security or performance audits.
  - `insforge-integrations`: wiring external auth providers (Clerk, Auth0, WorkOS, Better Auth, etc.) for JWT-based RLS, or the OKX x402 payment facilitator.
  - `find-skills`: discovering additional skills on demand.
- **Credentials:** app code reads keys from `.env.local`; the CLI reads `.insforge/project.json`. Never hardcode or commit keys.

Key patterns:

- Database inserts take an array: `insert([{ ... }])`.
- Reference users with `auth.users(id)`; use `auth.uid()` in RLS policies.
- For storage uploads, persist both the returned `url` and `key`.
<!-- INSFORGE:END -->
