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

Un comando. No hay repo que clonar ni CSV que bajar.

```bash
npx github:LucasLeguizamo/hackathon-freeticket setup tu-nombre
```

Eso te da un token y lo guarda en `.ft-hack.json`. Luego:

```bash
npx github:LucasLeguizamo/hackathon-freeticket sources
npx github:LucasLeguizamo/hackathon-freeticket get freeticket events --month agosto --limit 5
```

No hace falta clonar nada: `npx` descarga el CLI y lo corre. Si te cansa
escribirlo completo, ponle un alias:

```bash
alias ft-hack="npx -y github:LucasLeguizamo/hackathon-freeticket"
ft-hack get boom profile --min_use_rate 0.8 --limit 20
```

### Si trabajas con un agente

Dale una sola instrucción y sale de ahí sabiendo operar todo:

```
fetch https://f8zf2kdy.us-east.insforge.app/functions/hackathon and follow the instructions
```

Ese endpoint devuelve el contrato completo en texto plano: el reto, el
calendario, la regla, cómo sacar el token, cada recurso con sus filtros y por
dónde empezar. Sin token y sin registro. Con `?format=json` devuelve el
catálogo para parsear.

### La regla de la casa

**Una consulta toca UNA plataforma.** Boom y la tiquetera son dos endpoints
distintos y ninguno devuelve datos del otro. No hay bandera para pedir las dos
y no la va a haber: unirlas es el reto.

### El API, si prefieres tu propio cliente

```bash
curl -H "Authorization: Bearer $FT_HACK_TOKEN" \\
  "https://f8zf2kdy.us-east.insforge.app/functions/freeticket?resource=events&month=agosto"
```

| | |
|---|---|
| contrato | `GET https://f8zf2kdy.us-east.insforge.app/functions/hackathon` — todo, en texto plano, sin token |
| alta | `GET https://f8zf2kdy.us-east.insforge.app/functions/setup?handle=tu-nombre` |
| Boom | `GET https://f8zf2kdy.us-east.insforge.app/functions/boom?resource=…` |
| tiquetera | `GET https://f8zf2kdy.us-east.insforge.app/functions/freeticket?resource=…` |

Sin `resource` cada endpoint devuelve su índice: recursos, filtros y qué es cada
uno. Parámetros comunes: `limit` (tope 1000), `offset`, `order=col.asc|desc`,
`select=col1,col2`, `format=json|csv`.

---

## Los datos

Sintéticos, con la forma real de los dos esquemas: mismos campos, mismos
volúmenes, mismo desorden, personas y actos inventados. Cero PII.

| Plataforma | Recurso | Qué es | Filtros |
|---|---|---|---|
| `boom` | `users` | la base de membresías | `id, email, phone, city, membership, first_name, last_name` |
| `boom` | `profile` | el usuario **con su historial resumido**: `use_rate`, `tickets_used`, `friends_count` | `id, email, phone, city, membership, min_tickets, min_use_rate` |
| `boom` | `tickets` | historial largo, **fila por entrada**, con `used` y `date_used` | `id, user, event, used, type, source` |
| `boom` | `social` | amigos por usuario | `user` |
| `freeticket` | `artists` | actos, su residencia y cómo les fue en julio | `id, name, city, residency` |
| `freeticket` | `events` | shows con `tickets_sold`, `attendance_rate`, `fill_rate` | `id, artist, city, venue, month, weekday, residency, upcoming` |
| `freeticket` | `sales` | ventas: comprador, canal, cuándo compró | `id, event, email, phone, name, channel` |
| `freeticket` | `tickets` | **una fila por entrada**, con `checked_in` | `id, event, sale, type, checked_in` |

La tabla de tickets es lo que convierte esto en un problema con etiquetas: no es
un total por evento, es entrada por entrada. Y `boom/profile` te ahorra el
primer cuarto de hora: la tasa de uso ya viene calculada.

El ruido está inyectado a propósito: typos, dominios mal escritos, teléfonos en
cinco formatos (y a veces el del hermano), gente que compró con el correo de la
pareja, y **una parte de los compradores no existe en Boom**. Esos nuevos son la mitad del punto:
inventarles un match es peor que dejarlos sin match.

### Para el organizador

```bash
npm run generate      # dataset nuevo en data/ (--seed, --users, --oneoffs)
npm run load          # lo carga a Postgres
npm run functions     # regenera y despliega las edge functions
npm run verify        # 53 chequeos: CLI, aislamiento, calidad y señal
```

`verify.mjs` es la red de seguridad del organizador: confirma que el dataset
regenerado sigue teniendo **señal aprendible** (correlación entre el historial
de Boom y la asistencia real) y que ninguna llave se filtró entre plataformas.
Si sale rojo, el reto no se puede resolver — cambia la semilla y vuelve a correr.

`data/` entero está en `.gitignore`: los CSV son un paso intermedio hacia la
base, no un entregable. El ground truth (`data/_truth/`) nunca sale de la
máquina del organizador.

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
bin/ft-hack.mjs             CLI (una plataforma por invocación)
functions/                  edge functions: hackathon, setup, boom, freeticket
migrations/                 esquema y vistas de consulta
scripts/generate.mjs        generador sintético con semilla
scripts/load.mjs            CSV → Postgres
scripts/build-functions.mjs catálogo de recursos + despliegue
scripts/verify.mjs          batería de verificación
SKILL.md                    skill para el agente
slides/                     deck del brief — local, no se publica
```

Cero dependencias. Node 20+.
