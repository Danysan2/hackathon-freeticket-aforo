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

Si necesitas ambas, haz dos llamadas y únelas tú en disco.

## El CLI

```bash
node bin/ft-hack.mjs sources                  # qué hay y con qué credencial
node bin/ft-hack.mjs peek freeticket tickets --limit 5
node bin/ft-hack.mjs pull boom users --out raw/boom_users.csv
node bin/ft-hack.mjs pull freeticket tickets --out raw/ft_tickets.csv --format csv
```

Configuración:

| Variable | Para qué |
|---|---|
| `FT_HACK_API` | URL base del servidor de datos. Sin ella, el CLI lee de `./data`. |
| `BOOM_TOKEN` | Credencial de la plataforma de membresías. |
| `FT_TOKEN` | Credencial de la tiquetera. |

```bash
export FT_HACK_API=https://f8zf2kdy.us-east.insforge.app
export BOOM_TOKEN=…    # te lo dan en el minuto 0
export FT_TOKEN=…
```

Cada plataforma vive detrás de **su propio endpoint y su propio token**:
`https://f8zf2kdy.us-east.insforge.app/functions/boom?file=users` responde
401 con el token de la tiquetera, y al revés. No hay una URL que devuelva las dos.

Si el internet del café se cae: los CSV están en la USB. `--api ./data` y sigues.

## Qué hay en cada plataforma

### `boom` — membresías (v2). La historia larga.

**`users`** — `boom_user_id, first_name, last_name, email, phone, city, country, birthday, created_at, has_membership, membership_since, points`

**`tickets`** — `boom_ticket_id, boom_user_id, event_id, type, source, created_at, used, date_used`

> `used` dice si la persona **entró**, `date_used` a qué hora. Es el registro de
> comportamiento más largo que existe: va años atrás, mucho antes de la tiquetera.
> `type` ∈ `standard | free | membership` · `source` ∈ `app | web | referral | box_office`.

**`social`** — `boom_user_id, friends_count`

### `freeticket` — tiquetera (free-admin). Julio y agosto.

**`artists`** — `artist_id, name, home_city, residency_venue, residency_weekday`

> Algunos actos tienen **residencia**: mismo venue, mismo día de la semana, todas
> las semanas (los viernes en Casa E, los martes en Ace of Clubs…). Un show de
> residencia de agosto tiene cuatro hermanos en julio con el mismo público. Los
> demás son fechas sueltas de gira. `residency_*` vacío = sin residencia.

**`events`** — `event_id, title, artist_id, artist_name, city, venue, capacity, starts_at, weekday, is_residency, is_paid`

**`sales`** — `sale_id, event_id, buyer_name, buyer_email, buyer_phone, qty, subtotal, channel, purchased_at`

> Una venta puede llevar varias entradas (`qty`). Una venta **no** es una persona.
> `channel` ∈ `WEB | BOX_OFFICE | ADMIN | RRPP`. Precios en COP.

**`tickets`** — `ticket_id, sale_id, event_id, ticket_type, price, checked_in, checked_in_at`

> **Una fila por entrada**, no un total por evento. `ticket_type` ∈
> `General | Preferencial | VIP | Cortesía`.
> `checked_in` es `true`/`false` en julio y **vacío** en agosto.
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
