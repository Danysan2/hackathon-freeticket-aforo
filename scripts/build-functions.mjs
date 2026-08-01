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

if (import.meta.url === `file://${process.argv[1]}`) {
  const tpl = readFileSync("functions/_plataforma.ts", "utf8");
  for (const [plataforma, def] of Object.entries(CATALOGO)) {
    const src = tpl
      .replace("__PLATAFORMA__", plataforma)
      .replace("__RECURSOS__", JSON.stringify(def.recursos, null, 2));
    writeFileSync(`functions/${plataforma}.ts`, src);
    console.log(`  functions/${plataforma}.ts  (${Object.keys(def.recursos).length} recursos)`);
  }

  if (process.env.DESPLEGAR === "1") {
    const { execFileSync } = await import("node:child_process");
    for (const [plataforma, def] of Object.entries(CATALOGO)) {
      process.stdout.write(`  desplegando ${plataforma}… `);
      execFileSync("npx", ["@insforge/cli", "functions", "deploy", plataforma,
        "--file", `functions/${plataforma}.ts`, "--name", def.label], { stdio: ["ignore", "ignore", "inherit"] });
      console.log("ok");
    }
    process.stdout.write("  desplegando setup… ");
    execFileSync("npx", ["@insforge/cli", "functions", "deploy", "setup",
      "--file", "functions/setup.ts", "--name", "Alta de participante"], { stdio: ["ignore", "ignore", "inherit"] });
    console.log("ok");
  }
}
