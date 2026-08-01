---
name: hackathon-freeticket
description: Datos del hackathon FreeTicket «¿Cuánta gente entra realmente?». Úsala cuando el usuario pida jalar, explorar o cruzar los datos de Boom (membresías) o de la tiquetera FreeTicket, cuando mencione ft-hack, boom_users, ft_sales, ft_tickets, el cruce comprador↔usuario, las residencias de los artistas, o la proyección de asistencia de los shows de agosto. Incluye el diccionario de campos, el calendario julio/agosto, el ruido inyectado y la regla de una plataforma por consulta.
---

# Hackathon FreeTicket — datos

Dos plataformas que hablan de la misma gente y nunca se han mirado entre sí.
Tu trabajo es cruzarlas y, con eso, decir cuánta gente va a entrar a los shows
de agosto.

## El calendario manda

Hoy es **1 de agosto de 2026**.

| | Qué es | Qué tiene |
|---|---|---|
| **Julio** | Shows que ya pasaron | Ventas completas **y el check-in de cada entrada**: quién cruzó la puerta y a qué hora |
| **Agosto** | Shows por venir | Solo los tickets **ya adquiridos**. `checked_in` viene vacío porque todavía no pasa |

Julio es tu set de entrenamiento y está etiquetado a nivel entrada. Agosto es lo
que hay que proyectar. Un evento es de agosto si `starts_at` es futuro — o, lo
que es lo mismo, si sus tickets no tienen `checked_in`.

## Regla que no se negocia

**Una consulta toca UNA plataforma.** Boom y FreeTicket son sistemas separados,
con credenciales separadas. No hay endpoint que devuelva las dos juntas y no lo
va a haber: unirlas es el reto, no la infraestructura.

Si necesitas ambas, haz dos llamadas y únelas tú.

## Cómo se llega a los datos

No hay CSV que descargar de ningún lado. Se consulta el API, por el CLI o por HTTP.

El contrato completo está en `https://f8zf2kdy.us-east.insforge.app/functions/hackathon` — texto plano, sin
token. Si solo vas a leer una cosa, lee esa.

**Primero, el token** (una sola vez, sin registro ni espera):

```bash
npx github:LucasLeguizamo/hackathon-freeticket setup tu-nombre
```

Queda guardado en `.ft-hack.json` del directorio actual. Después:

```bash
ft-hack sources                                    # recursos y filtros
ft-hack get boom profile --email ana@gmail.com     # una persona
ft-hack get boom tickets --user bm_usr_000123      # su historial
ft-hack get freeticket events --month agosto       # lo que hay que proyectar
ft-hack get freeticket artists --id ft_art_001     # un acto y su residencia
ft-hack pull freeticket tickets --out raw/ft_tickets.csv   # el recurso completo
```

`get` trae una página (100 por defecto, tope 1000). `pull` pagina hasta traerlo
todo y escribe CSV.

**O directo por HTTP**, si prefieres tu propio cliente:

```bash
curl -H "Authorization: Bearer $FT_HACK_TOKEN" \
  "https://f8zf2kdy.us-east.insforge.app/functions/freeticket?resource=events&month=agosto"
```

| Variable | Para qué |
|---|---|
| `FT_HACK_API` | `https://f8zf2kdy.us-east.insforge.app` — ya viene por defecto |
| `FT_HACK_TOKEN` | tu token; el CLI lo lee de `.ft-hack.json` si no la exportas |

Parámetros comunes a todos los recursos: `limit` (tope 1000), `offset`,
`order=columna.asc|desc`, `select=col1,col2`, `format=json|csv`.

Cada plataforma tiene **su propio endpoint**: `/functions/boom` y
`/functions/freeticket`. Ninguno devuelve datos del otro.

## Qué hay en cada plataforma

### `boom` — membresías (v2). La historia larga.

**`users`** — `boom_user_id, first_name, last_name, email, phone, city, country, birthday, created_at, has_membership, membership_since, points`
· filtros: `id, email, phone, city, membership, first_name, last_name`

**`profile`** — lo mismo **más el historial ya resumido**: `tickets_total, tickets_used, use_rate, last_used_at, friends_count`
· filtros: `id, email, phone, city, membership, min_tickets, min_use_rate`

> Este es el atajo. `use_rate` es la señal que en crudo tocaría calcular a mano.
> `ft-hack get boom profile --min_use_rate 0.8 --limit 50` te da los fieles.

**`tickets`** — `boom_ticket_id, boom_user_id, event_id, type, source, created_at, used, date_used`
· filtros: `id, user, event, used, type, source`

> `used` dice si la persona **entró**, `date_used` a qué hora. Va años atrás,
> mucho antes de la tiquetera.
> `type` ∈ `membresia | consumo_minimo` · `source` ∈ `app | web | referral | box_office`.
> La entrada de **membresía no pasa del 60%** de asistencia; la de consumo
> mínimo ronda el 75%. Y v2 no deja más de **dos entradas por usuario y evento**.

**`social`** — `boom_user_id, friends_count` · filtros: `user`

### `freeticket` — tiquetera (free-admin). Julio y agosto.

**`artists`** — `artist_id, name, home_city, residency_venue, residency_weekday, has_residency, events_total, events_past, events_upcoming, tickets_sold, checked_in_count, attendance_rate_july`
· filtros: `id, name, city, residency`

> Algunos actos tienen **residencia**: mismo venue, mismo día de la semana, todas
> las semanas (los viernes en Casa E, los martes en Ace of Clubs…). Un show de
> residencia de agosto tiene cuatro hermanos en julio con el mismo público. Los
> demás son fechas sueltas de gira, sin histórico propio.

**`events`** — `event_id, title, artist_id, artist_name, residency_venue, residency_weekday, city, venue, capacity, starts_at, weekday, is_residency, is_paid, is_upcoming, month, tickets_sold, checked_in_count, attendance_rate, fill_rate, gross_revenue`
· filtros: `id, artist, city, venue, month, weekday, residency, upcoming`

> `month` es `julio` o `agosto`. `checked_in_count` y `attendance_rate` vienen
> **null en agosto**: el show no ha pasado, no hay verdad que dar.

**`sales`** — `sale_id, event_id, buyer_name, buyer_email, buyer_phone, qty, subtotal, channel, purchased_at`
· filtros: `id, event, email, phone, name, channel`

> Una venta puede llevar varias entradas (`qty`). Una venta **no** es una persona.
> `channel` ∈ `WEB | BOX_OFFICE | ADMIN | RRPP`. Precios en COP.

**`tickets`** — `ticket_id, sale_id, event_id, ticket_type, price, checked_in, checked_in_at`
· filtros: `id, event, sale, type, checked_in`

> **Una fila por entrada**, no un total por evento. `ticket_type` ∈
> `General | Preferencial | VIP | Cortesía`.
> `checked_in` es `true`/`false` en julio y **null** en agosto.
> Es la tabla que convierte esto en un problema con etiquetas.

**Los `event_id` de Boom y los de FreeTicket son universos distintos.** `bm_evt_*`
no tiene nada que ver con `ft_evt_*`. No intentes cruzarlos.

## El ruido está puesto a propósito

No hay ID compartido entre las dos bases. Las llaves disponibles están sucias:

- **Email** — limpio, con alias `+algo`, con el dominio mal escrito, con una
  letra faltante, con el mismo local en otro dominio, en MAYÚSCULAS. Y un
  porcentaje compró con el correo de la pareja.
- **Teléfono** — cinco formatos distintos, a veces vacío, a veces con dos dígitos
  cambiados de orden, y a veces es el del hermano.
- **Nombre** — sin tildes, en minúscula, apellido primero, con un segundo
  apellido que Boom no registró, o solo la inicial.
- **Y lo importante:** una parte de los compradores de la tiquetera **no existe
  en Boom**. Son nuevos. Inventarles un match es peor que dejarlos sin match.

## El reto

1. **Cruce** — `sale_id ↔ boom_user_id` con un score de confianza.
2. **Proyección** — por cada evento de **agosto**: `asistencia_esperada` sobre los
   tickets ya adquiridos, con un rango `p10 – p90`.

Tres fuentes de señal, y las tres suman:

- **Julio a nivel entrada** — es la única parte etiquetada de la tiquetera.
- **La residencia** — el mismo acto, el mismo día, el mismo venue, cuatro semanas
  antes. El histórico del propio show.
- **Boom** — quien sacó 12 tickets y usó 11 no es quien sacó 8 y usó 2. Es lo que
  te dice algo del comprador que en julio no aparece.

Encima va lo que ya sabes de la venta: precio pagado, cuánta anticipación, canal,
tipo de ticket, si la persona es de la ciudad del evento.

**Lo que más manda es el tipo de entrada.** Medido sobre julio: la pagada entra
~94%, la cortesía ~42%. Un show que "vendió" 500 con la mitad en cortesías no
llena. La mezcla explica buena parte de la asistencia; el resto lo explica quién
recibió esas cortesías — y eso solo lo sabes cruzando con Boom.

Ojo con el atajo obvio: el `use_rate` crudo de Boom mezcla los dos tipos de
entrada y se queda corto. Un fiel que solo saca entradas de membresía nunca va a
pasar del 60%.
### Extras que cuentan

Si la proyección ya está y sobra reloj:

- **El link efímero para la puerta.** Un enlace que se mande por WhatsApp y que,
  durante 3 horas, muestre el aforo aproximado del show: cuánta gente se espera,
  el rango, y cuánto personal conviene. Que caduque solo. Quien está en la puerta
  el viernes no va a abrir un notebook.
- **La curva de llegada.** A qué hora entra la gente, no solo cuánta.


**Mira los datos antes de escribir código.** Media hora leyendo CSV vale más que
dos horas de modelo sobre supuestos falsos.

## Entrega

Un **repositorio público** con:

1. Un comando que corra de punta a punta y produzca la salida.
2. `matches.csv` → `sale_id, boom_user_id, confidence`
3. `forecast.csv` → `event_id, expected_attendance, p10, p90` (solo agosto)
4. `NOTAS.md`, media página: qué asumiste, qué señal pesó más, qué harías con
   cuatro horas más.

Stack libre. Usar IA es obligatorio, no opcional — lo que se mira es el
resultado y el criterio, no cuántas líneas escribiste a mano.
