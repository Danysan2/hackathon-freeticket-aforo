# Aforo — la app de puerta

Consulta la proyección de asistencia de cada show de agosto y deja que el
administrador juegue con **cuántas entradas suelta como cortesía o vía Boom**
antes de repartirlas. El número se recalcula al instante.

Dos módulos:

- **Puerta** — el panel de proyección: elige el show, mueve las palancas, mira
  asistencia esperada, rango p10–p90, riesgo de sobreaforo y personal sugerido.
  Incluye los dos barridos: cuántas entradas gratis aguanta la puerta y cuál es
  la mejor relación cortesía ↔ Boom con el mismo presupuesto.
- **Datos** — estadísticas de julio: tasa de entrada por tipo de entrada, curva
  de llegada, cortes por ciudad/venue/día/canal, dispersión cortesías vs
  asistencia y el factor propio de cada venue.

## Enlaces para la puerta

Cada show tiene su propia URL: **`/e/<event_id>`**, y las palancas viajan en la
query (`?c=` cortesías, `?m=` membresía Boom, `?k=` consumo mínimo, `?v=`
cortesías recuperadas). La barra de direcciones se mantiene sincronizada sola, así
que el enlace que copies abre exactamente lo que estás viendo.

El botón de WhatsApp arma el mensaje con la proyección del momento y lo abre en
`wa.me` — sirve en el teléfono y en WhatsApp Web.

Para que la preview del enlace no salga vacía, `npm run build` corre
`scripts/prerender.mjs`, que escribe **un HTML por show** en `dist/e/` con su
propio `<title>` y sus `og:` tags. WhatsApp y Slack no ejecutan JavaScript: leen
ese HTML, así que sin este paso los 30 shows compartirían la misma tarjeta
genérica. En Vercel, `cleanUrls` sirve `/e/<id>` desde ese archivo, y el resto de
rutas cae al SPA.

La proyección de la preview replica la fórmula de `src/lib/model.ts` sobre las
mismas fuentes (`model.json` si el modelo ya trae el evento, si no la calibración
de julio). Coinciden exacto en los 30 shows: si tocas el motor, vale la pena
volver a comparar.

`og:url` sale absoluto usando `VERCEL_PROJECT_PRODUCTION_URL` en el build de
Vercel. Con dominio propio, define `SITE_URL=https://tu-dominio` en las variables
de entorno del proyecto. La tarjeta es de texto (sin `og:image`): una imagen por
evento pediría generarla en runtime.

## Diseño

Sigue el sistema visual de [boomstandupbar.com](https://www.boomstandupbar.com/): fondo
`#222222`, cyan `#00FAF6` como primario, rojo `#EB3A24` como CTA, tipografía
Oswald en todo, titulares en mayúscula pesada y el patrón de caja con banda de
color a todo el ancho. Los tokens viven en `src/styles.css`.

La paleta de los gráficos es aparte —azul/naranja/verde/ámbar— porque el cyan y
el rojo de marca ya significan otra cosa en la interfaz; está validada para
daltonismo sobre el fondo `#222`.

## Correr en local

```bash
npm install --prefix web && npm run dev --prefix web
```

## Regenerar los datos

`src/data/dataset.json` se construye desde los CSV de `raw/` (que no viajan al
repo). Si vuelves a bajar los datos con `ft-hack pull`, regenéralo:

```bash
node scripts/build-webapp-data.mjs
```

El script calcula las tasas de show-up por tipo de entrada, el factor por
artista y venue, la sobredispersión del rango y la curva de llegada. Todo lo que
la app afirma sale de ahí; no hay números escritos a mano.

## Conectar el modelo entrenado

Mientras el modelo se entrena, la proyección corre en el navegador con la
calibración de julio (`src/lib/model.ts`). Para delegar al modelo real basta
definir la variable de entorno:

```
VITE_FORECAST_API=https://.../forecast
```

La app hace `POST { event_id, levers }` y espera
`{ expected_attendance, p10, p90, overflow_risk?, lift? }`. Si el endpoint falla,
sigue con el cálculo local: la puerta nunca se queda sin número.
El contrato vive en [`src/lib/api.ts`](src/lib/api.ts).

## Desplegar en Vercel

El proyecto vive en el subdirectorio `web/`, así que en Vercel:

- **Root Directory:** `web`
- Framework: Vite (se detecta solo). Build `npm run build`, output `dist`.

O desde la terminal, parado en `web/`:

```bash
npx vercel deploy --prod
```

`src/data/dataset.json` **sí** se versiona: es la foto de datos que la app
necesita para construir sin acceso a `raw/`.
