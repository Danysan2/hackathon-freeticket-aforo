#!/usr/bin/env node
// Genera functions/boom.ts y functions/freeticket.ts desde _plataforma.ts.
// El catálogo de recursos vive aquí y en ningún otro lado: la skill, el CLI y
// la API se sirven de esta misma tabla.
//
//   node scripts/build-functions.mjs           solo genera
//   DESPLEGAR=1 node scripts/build-functions.mjs   genera y despliega

import { readFileSync, writeFileSync } from "node:fs";

export const CATALOGO = {
  boom: {
    label: "Boom — membresías (v2)",
    recursos: {
      users: {
        rel: "boom_user",
        nota: "la base de membresías, fila por persona",
        filtros: {
          id: ["boom_user_id", "eq"],
          email: ["email", "ilike"],
          phone: ["phone", "eq"],
          city: ["city", "eq"],
          membership: ["has_membership", "eq"],
          last_name: ["last_name", "ilike"],
          first_name: ["first_name", "ilike"],
        },
      },
      profile: {
        rel: "boom_user_profile",
        nota: "el usuario CON su historial resumido: tickets_total, tickets_used, use_rate, friends_count",
        filtros: {
          id: ["boom_user_id", "eq"],
          email: ["email", "ilike"],
          phone: ["phone", "eq"],
          city: ["city", "eq"],
          membership: ["has_membership", "eq"],
          min_tickets: ["tickets_total", "gte"],
          min_use_rate: ["use_rate", "gte"],
        },
      },
      tickets: {
        rel: "boom_ticket",
        nota: "historial fila por entrada; used dice si la persona entró",
        filtros: {
          id: ["boom_ticket_id", "eq"],
          user: ["boom_user_id", "eq"],
          event: ["event_id", "eq"],
          used: ["used", "eq"],
          type: ["type", "eq"],
          source: ["source", "eq"],
        },
      },
      social: {
        rel: "boom_social",
        nota: "amigos por usuario",
        filtros: { user: ["boom_user_id", "eq"] },
      },
    },
  },
  freeticket: {
    label: "FreeTicket — tiquetera (free-admin)",
    recursos: {
      artists: {
        rel: "ft_artist_summary",
        nota: "actos, su residencia y cómo les fue en julio",
        filtros: {
          id: ["artist_id", "eq"],
          name: ["name", "ilike"],
          city: ["home_city", "eq"],
          residency: ["has_residency", "eq"],
        },
      },
      events: {
        rel: "ft_event_summary",
        nota: "shows con tickets_sold, checked_in_count (null en agosto), attendance_rate y fill_rate",
        filtros: {
          id: ["event_id", "eq"],
          artist: ["artist_id", "eq"],
          city: ["city", "eq"],
          venue: ["venue", "eq"],
          month: ["month", "eq"],
          weekday: ["weekday", "eq"],
          residency: ["is_residency", "eq"],
          upcoming: ["is_upcoming", "eq"],
        },
      },
      sales: {
        rel: "ft_sale",
        nota: "ventas: comprador, canal, cuándo compró, cuántas entradas",
        filtros: {
          id: ["sale_id", "eq"],
          event: ["event_id", "eq"],
          email: ["buyer_email", "ilike"],
          phone: ["buyer_phone", "eq"],
          name: ["buyer_name", "ilike"],
          channel: ["channel", "eq"],
        },
      },
      tickets: {
        rel: "ft_ticket",
        nota: "una fila por entrada; checked_in es true/false en julio y null en agosto",
        filtros: {
          id: ["ticket_id", "eq"],
          event: ["event_id", "eq"],
          sale: ["sale_id", "eq"],
          type: ["ticket_type", "eq"],
          checked_in: ["checked_in", "eq"],
        },
      },
    },
  },
};

// La cara pública. InsForge queda detrás: si mañana cambia el backend, la URL
// que los participantes tienen escrita no se mueve.
export const API = "https://hackathon-freeticket.vercel.app";
export const BACKEND = "https://f8zf2kdy.us-east.insforge.app";
export const REPO = "github:LucasLeguizamo/hackathon-freeticket";

// El contrato completo en texto plano. Un agente hace UN fetch a
// /functions/hackathon y sale de ahí sabiendo operar todo.
export function readmeAgentes() {
  const recursos = Object.entries(CATALOGO).flatMap(([plataforma, def]) => [
    ``,
    `  ${plataforma.toUpperCase()} — ${def.label}`,
    `  GET ${API}/api/${plataforma}?resource=<recurso>`,
    ...Object.entries(def.recursos).flatMap(([nombre, r]) => [
      ``,
      `    resource=${nombre}`,
      `      ${r.nota}`,
      `      filtros: ${Object.keys(r.filtros).join(", ")}`,
    ]),
  ]);

  return `HACKATHON FREETICKET — «¿Cuánta gente entra realmente?»
${"=".repeat(72)}

Esto es un contrato para agentes. Léelo entero antes de la primera consulta.
Si eres un humano: el brief se proyecta el sábado y el código está en
https://github.com/LucasLeguizamo/hackathon-freeticket

EL PROBLEMA
${"-".repeat(72)}
Se venden 500 tickets a un show. ¿Entran 500, 380 o 240? Hoy nadie lo sabe y la
puerta se dimensiona a ojo. Hay dos plataformas que hablan de la misma gente y
nunca se han mirado entre sí:

  Boom (membresías)      la historia larga de cada persona, con "used" y
                         "date_used" por entrada: quién entró y a qué hora.
  FreeTicket (tiquetera) la venta real de julio y agosto, entrada por entrada.

Boom tiene el comportamiento. La tiquetera tiene la venta. Cruzarlas da la
proyección.

EL CALENDARIO
${"-".repeat(72)}
Hoy es el 1 de agosto de 2026.

  JULIO   shows que ya pasaron. Cada entrada trae checked_in (true/false) y la
          hora exacta. Es la parte etiquetada: tu set de entrenamiento.
  AGOSTO  shows por venir. Están los tickets YA ADQUIRIDOS; checked_in viene
          null porque todavía no pasa. Esto es lo que hay que proyectar.

Tercer eje: algunos actos tienen RESIDENCIA — mismo venue, mismo día de la
semana, todas las semanas. Un show de residencia de agosto tiene cuatro
hermanos en julio con el mismo público. Los actos de gira no tienen histórico
propio, y para esos el cruce con Boom es lo único que hay.

EL RETO
${"-".repeat(72)}
1. CRUCE — decir qué comprador de la tiquetera ES un usuario de Boom.
   No hay id compartido. Salida: sale_id, boom_user_id, confidence.

2. PROYECCIÓN — por cada evento de AGOSTO, sobre los tickets ya adquiridos:
   event_id, expected_attendance, p10, p90.

Las llaves para cruzar están sucias a propósito:
  · email      limpio, con alias +algo, con el dominio mal escrito (gmial,
               hotmial), con una letra faltante, en MAYÚSCULAS, o el de la pareja
  · teléfono   cinco formatos, a veces vacío, a veces con dos dígitos
               cambiados de orden, a veces es el del hermano
  · nombre     sin tildes, en minúscula, apellido primero, con un segundo
               apellido que Boom no registró, o solo la inicial

Y lo importante: una parte grande de los compradores NO EXISTE en Boom. Son
nuevos. Inventarles un match es peor que dejarlos sin match.

LO QUE MANDA NO ES CUÁNTAS ENTRADAS, ES CUÁLES
${"-".repeat(72)}
Dos reglas del negocio, medidas sobre julio:

  entrada pagada (General/Preferencial/VIP)   entra ~94%  — hubo plata de por medio
  cortesía                                    entra ~42%  — no dolió nada
  Boom, consumo mínimo                        entra ~75%
  Boom, membresía                             entra <=60% y nunca más

Un show que "vendió" 500 con la mitad en cortesías no llena. La mezcla de tipos
explica buena parte de la asistencia; el resto lo explica QUIÉN recibió esas
cortesías, y eso solo lo sabes cruzando con Boom.

Ojo con el atajo obvio: el use_rate crudo mezcla los dos tipos de entrada de
Boom y se queda corto. Un fiel que solo saca entradas de membresía nunca va a
pasar del 60%.

En v2 nadie puede tener más de DOS entradas para el mismo evento.

EXTRAS QUE CUENTAN
${"-".repeat(72)}
Si la proyección ya está y sobra reloj:

  · El link efímero para la puerta. Un enlace que se mande por WhatsApp y que
    durante 3 horas muestre el aforo aproximado del show: cuánta gente se
    espera, el rango y cuánto personal conviene. Que caduque solo. Quien está
    en la puerta el viernes no va a abrir un notebook.

  · La curva de llegada. A qué hora entra la gente, no solo cuánta.

LA REGLA QUE NO SE NEGOCIA
${"-".repeat(72)}
Una petición toca UNA plataforma. Son dos endpoints distintos y ninguno
devuelve datos del otro. No hay parámetro para pedir las dos juntas y no lo va
a haber: unirlas es el reto, no la infraestructura.

Los event_id tampoco se cruzan: bm_evt_* (Boom) y ft_evt_* (tiquetera) son
universos distintos. No intentes emparejarlos.

CÓMO ENTRAR
${"-".repeat(72)}
1) Consigue un token. Es instantáneo, no hay registro ni aprobación:

     curl "${API}/api/setup?handle=TU-NOMBRE"

   Devuelve JSON con { token, api, endpoints }. Es idempotente: el mismo handle
   siempre devuelve el mismo token.

2) Úsalo como Bearer en todas las consultas:

     curl -H "Authorization: Bearer $TOKEN" \\
       "${API}/api/freeticket?resource=events&month=agosto"

O con el CLI, que hace lo mismo y además pagina solo:

     npx ${REPO} setup TU-NOMBRE
     npx ${REPO} sources
     npx ${REPO} get boom profile --email ana@gmail.com
     npx ${REPO} pull freeticket tickets --out raw/ft_tickets.csv

  get   una página (100 por defecto, tope 1000)
  pull  el recurso completo, paginado, en CSV
  El token queda en .ft-hack.json del directorio actual y se lee solo.

RECURSOS
${"-".repeat(72)}
Parámetros comunes a todos: limit (tope 1000), offset, order=columna.asc|desc,
select=col1,col2, format=json|csv.

La respuesta JSON es { plataforma, resource, count, limit, offset, rows }.
count es el total que hay, no el de la página: úsalo para paginar.
${recursos.join("\n")}

POR DÓNDE EMPEZAR
${"-".repeat(72)}
Mira los datos antes de escribir código. Media hora leyendo vale más que dos
horas de modelo sobre supuestos falsos.

  # el panorama: 62 shows, cuáles ya pasaron y cómo les fue
  ?resource=events&limit=100                     (freeticket)

  # los actos y su residencia, con la asistencia real de julio
  ?resource=artists                              (freeticket)

  # un evento concreto de agosto y cuántos tickets lleva vendidos
  ?resource=events&id=ft_evt_0009                (freeticket)

  # las entradas de ese evento, una por fila
  ?resource=tickets&event=ft_evt_0009            (freeticket)

  # el comprador, para intentar cruzarlo
  ?resource=sales&event=ft_evt_0009              (freeticket)

  # ¿existe en Boom? por correo, por teléfono, por nombre
  ?resource=profile&email=ana@gmail.com          (boom)

  # profile ya trae use_rate calculado: esa es LA señal
  ?resource=profile&min_use_rate=0.8&limit=100   (boom)

ENTREGA
${"-".repeat(72)}
Un repositorio público con:
  1. un comando que corra de punta a punta
  2. matches.csv   → sale_id, boom_user_id, confidence
  3. forecast.csv  → event_id, expected_attendance, p10, p90  (solo agosto)
  4. NOTAS.md, media página: qué asumiste, qué señal pesó más, qué harías con
     cuatro horas más

Stack libre. Usar IA es obligatorio, no opcional: se evalúa el resultado y el
criterio, no cuántas líneas se escribieron a mano.

OTRAS FORMAS DE LEER ESTO MISMO
${"-".repeat(72)}
  ${API}/?format=json         catálogo de recursos y filtros, en JSON
  ${API}/openapi.json         especificación OpenAPI 3.1 del API
  ${API}/skill.md             la skill lista para instalar en tu agente

${"=".repeat(72)}
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const tpl = readFileSync("functions/_plataforma.ts", "utf8");
  for (const [plataforma, def] of Object.entries(CATALOGO)) {
    const src = tpl
      .replace("__PLATAFORMA__", plataforma)
      .replace("__RECURSOS__", JSON.stringify(def.recursos, null, 2));
    writeFileSync(`functions/${plataforma}.ts`, src);
    console.log(`  functions/${plataforma}.ts  (${Object.keys(def.recursos).length} recursos)`);
  }

  writeFileSync(
    "functions/hackathon.ts",
    readFileSync("functions/_readme.ts", "utf8")
      .replace("__TEXTO__", JSON.stringify(readmeAgentes()))
      .replace("__CATALOGO__", JSON.stringify({ api: API, catalogo: CATALOGO })),
  );
  console.log("  functions/hackathon.ts  (contrato para agentes)");

  if (process.env.DESPLEGAR === "1") {
    const { execFileSync } = await import("node:child_process");
    const desplegar = (slug, archivo, nombre) => {
      process.stdout.write(`  desplegando ${slug}… `);
      execFileSync("npx", ["@insforge/cli", "functions", "deploy", slug,
        "--file", archivo, "--name", nombre], { stdio: ["ignore", "ignore", "inherit"] });
      console.log("ok");
    };
    for (const [plataforma, def] of Object.entries(CATALOGO)) {
      desplegar(plataforma, `functions/${plataforma}.ts`, def.label);
    }
    desplegar("setup", "functions/setup.ts", "Alta de participante");
    desplegar("hackathon", "functions/hackathon.ts", "Contrato para agentes");
  }
}
