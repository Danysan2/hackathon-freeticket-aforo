#!/usr/bin/env node
// Arma public/ para Vercel: la especificación OpenAPI y la skill servida.
// Todo sale del mismo catálogo, así que no puede contradecir a la API.

import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { CATALOGO, API, REPO } from "./build-functions.mjs";

mkdirSync("public", { recursive: true });

// ------------------------------------------------------------------ openapi

const parametrosComunes = [
  { name: "limit", in: "query", description: "Filas por página (tope 1000).", schema: { type: "integer", default: 100, maximum: 1000 } },
  { name: "offset", in: "query", description: "Para paginar.", schema: { type: "integer", default: 0 } },
  { name: "order", in: "query", description: "Orden, p. ej. starts_at.asc", schema: { type: "string" } },
  { name: "select", in: "query", description: "Columnas separadas por coma.", schema: { type: "string" } },
  { name: "format", in: "query", description: "json (por defecto) o csv.", schema: { type: "string", enum: ["json", "csv"] } },
];

const paths = {
  "/": {
    get: {
      summary: "El contrato completo, en texto plano",
      description: "Todo lo que un agente necesita para operar: el reto, el calendario, la regla, cómo sacar el token y cada recurso con sus filtros. Sin autenticación.",
      security: [],
      responses: { 200: { description: "El contrato", content: { "text/plain": { schema: { type: "string" } } } } },
    },
  },
  "/api/setup": {
    get: {
      summary: "Consigue tu token",
      description: "Instantáneo, sin registro. Idempotente: el mismo handle devuelve siempre el mismo token.",
      security: [],
      parameters: [{ name: "handle", in: "query", required: true, description: "Tu nombre, 2 a 40 caracteres.", schema: { type: "string" } }],
      responses: {
        200: {
          description: "Token",
          content: { "application/json": { schema: { type: "object", properties: {
            ok: { type: "boolean" }, nuevo: { type: "boolean" }, handle: { type: "string" },
            token: { type: "string" }, api: { type: "string" },
          } } } },
        },
        400: { description: "Handle inválido" },
      },
    },
  },
};

for (const [plataforma, def] of Object.entries(CATALOGO)) {
  paths[`/api/${plataforma}`] = {
    get: {
      summary: def.label,
      description: `Sin \`resource\` devuelve el índice de la plataforma. Esta ruta NUNCA devuelve datos de la otra: cruzarlas es el reto.\n\nRecursos:\n${Object.entries(def.recursos).map(([n, r]) => `- \`${n}\` — ${r.nota}`).join("\n")}`,
      parameters: [
        { name: "resource", in: "query", required: false, description: "Qué recurso consultar.", schema: { type: "string", enum: Object.keys(def.recursos) } },
        ...[...new Set(Object.values(def.recursos).flatMap((r) => Object.keys(r.filtros)))].map((f) => ({
          name: f, in: "query",
          description: `Filtro. Aplica a: ${Object.entries(def.recursos).filter(([, r]) => f in r.filtros).map(([n]) => n).join(", ")}.`,
          schema: { type: "string" },
        })),
        ...parametrosComunes,
      ],
      responses: {
        200: {
          description: "Filas del recurso",
          content: {
            "application/json": { schema: { type: "object", properties: {
              plataforma: { type: "string" }, resource: { type: "string" },
              count: { type: "integer", description: "Total que existe, no el de la página." },
              limit: { type: "integer" }, offset: { type: "integer" },
              rows: { type: "array", items: { type: "object", additionalProperties: true } },
            } } },
            "text/csv": { schema: { type: "string" } },
          },
        },
        401: { description: "Falta el token o no es válido" },
        404: { description: "Recurso inexistente" },
      },
    },
  };
}

const openapi = {
  openapi: "3.1.0",
  info: {
    title: "Hackathon FreeTicket — API de datos",
    version: "1.0.0",
    description: "Dos plataformas que hablan de la misma gente y nunca se han mirado entre sí. Una petición toca una sola: cruzarlas es el reto.\n\nEl contrato en prosa, pensado para agentes, está en `GET /`.",
  },
  servers: [{ url: API }],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", description: "El token que entrega `/api/setup`." },
    },
  },
  paths,
};

writeFileSync("public/openapi.json", JSON.stringify(openapi, null, 2) + "\n");
console.log(`  public/openapi.json  (${Object.keys(paths).length} rutas)`);

// -------------------------------------------------------------------- skill

writeFileSync("public/skill.md", readFileSync("SKILL.md", "utf8"));
console.log("  public/skill.md");
console.log(`\n  ${API}  →  npx ${REPO}`);
