# Hackathon FreeTicket — «¿Cuánta gente entra realmente?»

**Sábado 1 de agosto de 2026 · 12:30 – 16:30 · café internet · individual**

Se venden 500 tickets. ¿Entran 500, 380 o 240? Hoy nadie lo sabe, y la puerta se
dimensiona a ojo. Hay dos plataformas que hablan de la misma gente y nunca se
han mirado entre sí:

| | Qué tiene | Qué le falta |
|---|---|---|
| **Boom** (membresías) | La historia larga de cada persona: membresías, tickets, amigos, puntos, y sobre todo `used` / `date_used` — **quién entró y a qué hora** | No cubre la venta paga nueva |
| **FreeTicket** (tiquetera) | La venta real: comprador, precio, canal, tipo de ticket | No sabe nada del comprador antes de la compra |

**Boom tiene el comportamiento. La tiquetera tiene la venta. Cruzarlas da la proyección.**

📊 **[Las slides del brief](https://docs.google.com/presentation/d/1RaMFgrR3J1wK_h6cBkxjxY1iiiEE_l3_/edit?usp=sharing)** — el reto, los criterios, el cronograma y cómo se califica.

---

## El calendario manda

Hoy es **1 de agosto de 2026**.

| | Qué es | Qué tiene |
|---|---|---|
| **Julio** | 32 shows que ya pasaron | Ventas completas **y el check-in de cada entrada**: quién cruzó la puerta y a qué hora |
| **Agosto** | 30 shows por venir | Solo los tickets **ya adquiridos**. `checked_in` viene null porque todavía no pasa |

Julio está etiquetado entrada por entrada. Agosto es lo que hay que proyectar.

Y hay un tercer eje: **las residencias**. Algunos actos tocan el mismo día de la
semana en el mismo venue, todas las semanas — los viernes en Casa E, los martes
en Ace of Clubs. Un show de residencia de agosto tiene cuatro hermanos en julio
con el mismo público. Otros actos son fechas sueltas de gira, sin histórico
propio; para esos, el cruce con Boom es lo único que hay.

---

## El reto

1. **Cruce** — decir qué comprador de la tiquetera **es** un usuario de Boom.
   No hay ID compartido. Salida: `sale_id, boom_user_id, confidence`.
2. **Proyección** — por cada evento de agosto, sobre los tickets ya adquiridos:
   `event_id, expected_attendance, p10, p90`.


### Extras que cuentan

Si la proyección ya está y sobra reloj:

- **El link efímero para la puerta.** Un enlace que se mande por WhatsApp y que,
  durante 3 horas, muestre el aforo aproximado del show: cuánta gente se espera,
  el rango, y cuánto personal conviene. Que caduque solo. Quien está en la puerta
  el viernes no va a abrir un notebook.
- **La curva de llegada.** A qué hora entra la gente, no solo cuánta.

### Las llaves están sucias a propósito

- **Email** — limpio, con alias `+algo`, con el dominio mal escrito (`gmial`,
  `hotmial`), con una letra faltante, en MAYÚSCULAS. Y hay quien compró con el
  correo de la pareja.
- **Teléfono** — cinco formatos, a veces vacío, a veces con dos dígitos
  cambiados de orden, a veces es el del hermano.
- **Nombre** — sin tildes, en minúscula, apellido primero, con un segundo
  apellido que Boom no registró, o solo la inicial.
- **Y lo importante:** una parte grande de los compradores **no existe en Boom**.
  Son nuevos. Inventarles un match es peor que dejarlos sin match.

---

## Arranca

Un comando. No hay repo que clonar ni CSV que bajar.

```bash
npx github:LucasLeguizamo/hackathon-freeticket setup tu-nombre
```

Te da un token al instante —sin registro ni aprobación— y lo guarda en
`.ft-hack.json`. Después:

```bash
npx github:LucasLeguizamo/hackathon-freeticket sources
npx github:LucasLeguizamo/hackathon-freeticket get freeticket events --month agosto
```

Si te cansa escribirlo completo, ponle un alias:

```bash
alias ft-hack="npx -y github:LucasLeguizamo/hackathon-freeticket"
ft-hack get boom profile --min_use_rate 0.8 --limit 20
```

### Si trabajas con un agente

Dale una sola instrucción y sale de ahí sabiendo operar todo:

```
fetch https://hackathon-freeticket.vercel.app and follow the instructions
```

Ese endpoint devuelve el contrato completo en texto plano: el reto, el
calendario, la regla, cómo sacar el token, cada recurso con sus filtros y por
dónde empezar. Sin token y sin registro.

También está la skill lista para instalar en
[`/skill.md`](https://hackathon-freeticket.vercel.app/skill.md), y la
especificación en
[`/openapi.json`](https://hackathon-freeticket.vercel.app/openapi.json).

### La regla de la casa

**Una consulta toca UNA plataforma.** Boom y la tiquetera son dos endpoints
distintos y ninguno devuelve datos del otro. No hay bandera para pedir las dos
y no la va a haber: unirlas es el reto.

Los `event_id` tampoco se cruzan: `bm_evt_*` y `ft_evt_*` son universos
distintos.

---

## Los datos

| Plataforma | Recurso | Qué es | Filtros |
|---|---|---|---|
| `boom` | `users` | la base de membresías, 6.000 personas | `id, email, phone, city, membership, first_name, last_name` |
| `boom` | `profile` | el usuario **con su historial resumido**: `use_rate`, `tickets_used`, `friends_count` | `id, email, phone, city, membership, min_tickets, min_use_rate` |
| `boom` | `tickets` | entradas históricas, con `used` y `date_used`. `type` ∈ `membresia \| consumo_minimo` | `id, user, event, used, type, source` |
| `boom` | `social` | amigos por usuario | `user` |
| `freeticket` | `artists` | 14 actos, su residencia y cómo les fue en julio | `id, name, city, residency` |
| `freeticket` | `events` | 62 shows con `tickets_sold`, `attendance_rate`, `fill_rate` | `id, artist, city, venue, month, weekday, residency, upcoming` |
| `freeticket` | `sales` | 7.091 ventas: comprador, canal, cuándo compró | `id, event, email, phone, name, channel` |
| `freeticket` | `tickets` | entradas, **una fila cada una**, con `checked_in`. `ticket_type` ∈ `General \| Preferencial \| VIP \| Cortesía` | `id, event, sale, type, checked_in` |

Parámetros comunes: `limit` (tope 1000), `offset`, `order=columna.asc|desc`,
`select=col1,col2`, `format=json|csv`. La respuesta trae `count` con el total
que existe, no el de la página.

`get` trae una página; `pull` pagina hasta traer el recurso completo y escribe
CSV:

```bash
ft-hack pull freeticket tickets --out raw/ft_tickets.csv
```

La tabla de tickets es lo que convierte esto en un problema con etiquetas: no
es un total por evento, es entrada por entrada. Y `boom/profile` te ahorra el
primer cuarto de hora — la tasa de uso ya viene calculada.

### Lo que manda no es cuántas entradas, es cuáles

Dos reglas del negocio, medidas sobre julio:

| Entrada | Entra |
|---|---|
| pagada (General, Preferencial, VIP) | **~94%** — hubo plata de por medio |
| cortesía | **~42%** — no dolió nada |
| Boom, consumo mínimo | ~75% |
| Boom, membresía | **≤60%**, nunca más |

Un show que "vendió" 500 con la mitad en cortesías no llena. Por eso la mezcla
de tipos explica buena parte de la asistencia — y el resto lo explica **quién**
recibió esas cortesías, que es justo lo que el cruce con Boom te dice.

En v2 nadie puede tener más de **dos entradas para el mismo evento**.

Los datos son sintéticos, con la forma real de los dos esquemas: mismos campos,
mismos volúmenes, mismo desorden, personas y actos inventados. Cero PII.

### Por dónde empezar

**Mira los datos antes de escribir código.** Media hora leyendo vale más que dos
horas de modelo sobre supuestos falsos.

```bash
ft-hack get freeticket events --limit 100          # el panorama de los 62 shows
ft-hack get freeticket artists                     # los actos y su julio
ft-hack get freeticket events --id ft_evt_0009     # un show de agosto
ft-hack get freeticket tickets --event ft_evt_0009 # sus entradas, una por fila
ft-hack get freeticket sales --event ft_evt_0009   # quién compró
ft-hack get boom profile --email ana@gmail.com     # ¿existe en Boom?
ft-hack get boom profile --min_use_rate 0.8        # los fieles
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
