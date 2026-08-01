# Hackathon FreeTicket — «¿Cuánta gente entra realmente?»

**Sábado 1 de agosto de 2026 · 12:30 – 16:30 · café internet · individual**

Se venden 500 tickets. ¿Entran 500, 380 o 240? Hoy nadie lo sabe, y la puerta se
dimensiona a ojo. Hay dos bases que hablan de la misma gente y nunca se han
mirado entre sí:

| | Qué tiene | Qué le falta |
|---|---|---|
| **Boom** (membresías, v2) | La historia: membresías, tickets, amigos, puntos, y sobre todo `used` / `date_used` — **quién entró y a qué hora** | No cubre la venta paga nueva |
| **FreeTicket** (tiquetera) | La venta real: comprador, precio, canal, tipo de ticket | No sabe nada del comprador antes de la compra |

**Boom tiene el comportamiento. La tiquetera tiene la venta. Cruzarlas da la proyección.**

---

## El calendario manda

Hoy es **1 de agosto de 2026**.

| | Qué es | Qué tiene |
|---|---|---|
| **Julio** | Shows que ya pasaron | Ventas completas **y el check-in de cada entrada**: quién cruzó la puerta y a qué hora |
| **Agosto** | Shows por venir | Solo los tickets **ya adquiridos**. `checked_in` viene vacío porque todavía no pasa |

Julio está etiquetado entrada por entrada. Agosto es lo que hay que proyectar.

Y hay un tercer eje: **las residencias**. Algunos actos tocan el mismo día de la
semana en el mismo venue, todas las semanas — los viernes en Casa E, los martes
en Ace of Clubs. Un show de residencia de agosto tiene cuatro hermanos en julio
con el mismo público. Otros actos son fechas sueltas de gira, sin histórico propio.

---

## El reto

1. **Cruce** — decir qué comprador de la tiquetera **es** un usuario de Boom.
   No hay ID compartido. Salida: `sale_id, boom_user_id, confidence`.
2. **Proyección** — por cada evento de agosto, sobre los tickets ya adquiridos:
   `event_id, expected_attendance, p10, p90`.

Fuera de alcance: la curva de llegada por franja horaria. Si sale de ñapa, cuenta.

---

## Arranca

```bash
git clone <este-repo> && cd hackathon-freeticket

node bin/ft-hack.mjs sources
node bin/ft-hack.mjs peek freeticket tickets --limit 5
node bin/ft-hack.mjs pull boom users --out raw/boom_users.csv
node bin/ft-hack.mjs pull freeticket tickets --out raw/ft_tickets.csv
```

Si trabajas con un agente (Claude Code, Cursor, lo que uses), instálale la skill:

```bash
cp SKILL.md ~/.claude/skills/hackathon-freeticket/SKILL.md   # o el equivalente de tu herramienta
```

La skill le explica al agente el diccionario de campos, el ruido inyectado y la
regla de la casa.

### La regla de la casa

**Una consulta toca UNA plataforma.** No hay `--all`, no hay endpoint que
devuelva las dos juntas. Boom y la tiquetera son sistemas separados con
credenciales separadas — igual que en la vida real. Unirlas es tu trabajo.

### Credenciales

```bash
export FT_HACK_API=https://f8zf2kdy.us-east.insforge.app
export BOOM_TOKEN=…    # se anuncian en el minuto 0
export FT_TOKEN=…
```

Cada plataforma tiene **su endpoint y su token**. `…/functions/boom?file=users`
responde 401 con el token de la tiquetera, y al revés — no es cortesía del CLI,
es el backend.

Sin `FT_HACK_API` el CLI lee de `./data`: ese es el plan B cuando se caiga el
internet del café (los CSV también van en USB).

---

## Los datos

Sintéticos, generados con la forma real de los dos esquemas: mismos campos,
mismos volúmenes, mismo desorden, personas y actos inventados. Cero PII.

| Plataforma | Recurso | Qué es |
|---|---|---|
| `boom` | `users` | la base de membresías |
| `boom` | `tickets` | historial largo, **fila por entrada**, con `used` y `date_used` |
| `boom` | `social` | amigos por usuario |
| `freeticket` | `artists` | actos, con su residencia (venue + día de la semana) |
| `freeticket` | `events` | shows de julio y agosto |
| `freeticket` | `sales` | ventas: comprador, canal, cuándo compró, cuántas entradas |
| `freeticket` | `tickets` | **una fila por entrada**, con `checked_in` en julio y vacío en agosto |

La tabla de tickets es lo que convierte esto en un problema con etiquetas: no es
un total por evento, es entrada por entrada.

El ruido está inyectado a propósito: typos, dominios mal escritos, teléfonos en
cinco formatos (y a veces el del hermano), gente que compró con el correo de la
pareja, y **una parte de los compradores no existe en Boom**. Esos nuevos son la mitad del punto:
inventarles un match es peor que dejarlos sin match.

Regenerar con otra semilla o otro volumen:

```bash
node scripts/generate.mjs --seed 7 --users 12000 --oneoffs 30
node scripts/verify.mjs        # CLI, aislamiento, calidad del dato y señal
```

`verify.mjs` es la red de seguridad del organizador: confirma que el dataset
regenerado sigue teniendo **señal aprendible** (correlación entre el historial
de Boom y la asistencia real) y que ninguna llave se filtró entre plataformas.
Si sale rojo, el reto no se puede resolver — cambia la semilla y vuelve a correr.

El ground truth se escribe en `data/_truth/` y está en `.gitignore`. Se publican
`data/boom/` y `data/freeticket/`, nunca `data/_truth/`.

### Publicar un dataset nuevo

Los CSV viven en un bucket privado de InsForge y se sirven por dos edge
functions —una por plataforma— que validan el token. Después de regenerar:

```bash
npm run publish:data     # sube los 7 CSV al bucket
```

Para rotar los tokens del día:

```bash
npx @insforge/cli secrets update BOOM_TOKEN --value bm_...
npx @insforge/cli secrets update FT_TOKEN --value ft_...
```

---

## Cronograma

| Hora | Bloque |
|---|---|
| 12:30 – 12:45 | Brief, credenciales, todos corriendo |
| 12:45 – 13:10 | Exploración. **Mira los datos antes de escribir código** |
| 13:10 – 14:20 | Parte A — el cruce |
| 14:20 – 14:35 | **Push obligatorio al repo público** (aunque la proyección sea el promedio) |
| 14:35 – 15:40 | Parte B — la proyección |
| 15:40 – 15:55 | Congelamiento. **Push final** |
| 15:55 – 16:25 | Demos: 3 minutos cada uno, terminal en mano, sin slides |
| 16:25 – 16:30 | Cierre |

El push de la mitad es obligatorio: garantiza que nadie llegue a las 16:25 con
un repo hermoso y cero resultados.

### La campana

Suena cada 30 minutos — 13:00, 13:30, 14:00, 14:30, 15:00, 15:30, 16:00, 16:30.
Las dos pausas secas (14:00 y 15:30) caen justo antes de los dos momentos que
importan. No es casualidad.

En cada campana sale una carta de **Prompt Roulette** que aplica a todos desde
ese segundo:

- «Se cayó la columna `phone` de Boom. Que tu cruce sobreviva sin teléfonos.»
- «Llegaron 150 cortesías que nunca pasaron por venta. Van a entrar igual. Cuéntalas.»
- «El evento se movió a un venue con 30% menos de aforo. Reproyecta.»
- «Uno al azar explica en 60 segundos qué está haciendo.»
- «Nadie toca el teclado por 3 minutos. Solo se puede pensar. Reloj corriendo.»
- «Los próximos 20 minutos, solo modelo rápido. Nada de razonamiento pesado.»

Todo shot es opcional, se pasa con agua sin comentarios, y quien maneja no toma.

---

## Entrega

Un **repositorio público** con:

1. Un comando que corra de punta a punta.
2. `matches.csv` — `sale_id, boom_user_id, confidence`
3. `forecast.csv` — `event_id, expected_attendance, p10, p90` (solo agosto)
4. `NOTAS.md`, media página: qué asumiste, qué señal pesó más, qué harías con
   cuatro horas más.

Stack libre: Python, TypeScript, SQL puro, una hoja de cálculo si te da el cuero.
**Usar IA es obligatorio, no opcional.** No hay puntos por sufrir.

No hay scoreboard ni puntaje automático. Lo que se evalúa en la demo es el
criterio: si esto sirve para operar la puerta el viernes.

---

## Qué pasa el lunes

Lo que salga no se queda en el café. El estimador entra a FreeTicket como una
proyección visible en cada evento: asistencia esperada, rango, y personal
sugerido en puerta. Por eso la entrega pide entrada y salida limpias — para
poderla portar sin reescribirla.

---

## Estructura

```
bin/ft-hack.mjs       CLI de datos (una plataforma por invocación)
functions/            edge functions de InsForge (una por plataforma)
scripts/generate.mjs  generador sintético con semilla
scripts/verify.mjs    batería de verificación del dataset
SKILL.md              skill para el agente
slides/index.html     deck del brief (abrir en el navegador, flechas para pasar)
data/                 CSVs generados (_truth no se publica)
```

Cero dependencias. Node 20+.
