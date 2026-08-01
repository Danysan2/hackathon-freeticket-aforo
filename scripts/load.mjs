#!/usr/bin/env node
// Carga los CSV de data/ a Postgres.
//   node scripts/load.mjs            → escribe data/_load.sql
//   npm run load                     → lo escribe y lo importa
//
// Genera INSERTs por lotes en vez de COPY porque `db import` toma un .sql
// plano. Con ~55k filas alcanza de sobra y no agrega una dependencia.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DATA = process.argv[2] ?? "data";
const SALIDA = join(DATA, "_load.sql");
const LOTE = 500;

// tabla ← archivo, con el tipo de cada columna para saber cómo citarla.
// t=texto · n=número · b=booleano · d=fecha/hora (vacío ⇒ NULL)
const TABLAS = [
  ["boom_user", "boom/users.csv", "t,t,t,t,t,t,t,d,d,b,d,n"],
  ["boom_ticket", "boom/tickets.csv", "t,t,t,t,t,d,b,d"],
  ["boom_social", "boom/social.csv", "t,n"],
  ["ft_artist", "freeticket/artists.csv", "t,t,t,t,t"],
  ["ft_event", "freeticket/events.csv", "t,t,t,t,t,t,n,d,t,b,b"],
  ["ft_sale", "freeticket/sales.csv", "t,t,t,t,t,n,n,t,d"],
  ["ft_ticket", "freeticket/tickets.csv", "t,t,t,t,n,b,d"],
];

function parseCsv(text) {
  const filas = [];
  let campo = "";
  let fila = [];
  let comillas = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (comillas) {
      if (c === '"' && text[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === ",") { fila.push(campo); campo = ""; }
    else if (c === "\n") { fila.push(campo); filas.push(fila); fila = []; campo = ""; }
    else if (c !== "\r") campo += c;
  }
  if (campo || fila.length) { fila.push(campo); filas.push(fila); }
  return filas.filter((f) => f.length > 1 || f[0] !== "");
}

const lit = (valor, tipo) => {
  if (valor === "" || valor === undefined) return "NULL";
  if (tipo === "n") return String(Number(valor));
  if (tipo === "b") return valor === "true" ? "true" : "false";
  return `'${String(valor).replace(/'/g, "''")}'`;
};

// La carga va por `db query` en trozos: `db import` responde 502 con un archivo
// de 5 MB. Nada de begin/commit — la API rechaza el control de transacciones
// ("Transaction control statements are not allowed"); cada trozo ya corre en su
// propia transacción implícita. 150 KB entra sobrado en ARG_MAX.
const TROZO_MAX = 150 * 1024;
const trozos = [];
let actual = [TABLAS.map(([t]) => `delete from ${t};`).reverse().join("\n")];
let tam = actual[0].length;
const empujar = (sql) => {
  if (tam + sql.length > TROZO_MAX && actual.length) {
    trozos.push(actual.join("\n"));
    actual = [];
    tam = 0;
  }
  actual.push(sql);
  tam += sql.length;
};
let total = 0;

for (const [tabla, archivo, tipos] of TABLAS) {
  const [cols, ...filas] = parseCsv(readFileSync(join(DATA, archivo), "utf8"));
  const tipoDe = tipos.split(",");
  // Un tipo de menos corre las columnas en silencio y mete basura en la tabla.
  if (tipoDe.length !== cols.length) {
    console.error(`✕ ${tabla}: ${cols.length} columnas en el CSV pero ${tipoDe.length} tipos declarados.`);
    console.error(`  columnas: ${cols.join(", ")}`);
    process.exit(1);
  }
  for (let i = 0; i < filas.length; i += LOTE) {
    const trozo = filas.slice(i, i + LOTE);
    const values = trozo.map((f) => `(${cols.map((_, k) => lit(f[k], tipoDe[k])).join(",")})`).join(",\n");
    empujar(`insert into ${tabla} (${cols.join(",")}) values\n${values};`);
  }
  console.log(`  ${tabla.padEnd(16)} ${filas.length} filas`);
  total += filas.length;
}

if (actual.length) trozos.push(actual.join("\n"));

const sqls = trozos;
writeFileSync(SALIDA, sqls.join("\n"));
console.log(`\n${total} filas en ${sqls.length} trozos → ${SALIDA}`);

if (process.env.CARGAR !== "1") {
  console.log("Cargar a Postgres:  npm run load");
  process.exit(0);
}

const { execFileSync } = await import("node:child_process");
for (const [i, sql] of sqls.entries()) {
  process.stdout.write(`  cargando ${i + 1}/${sqls.length}… `);
  execFileSync("npx", ["@insforge/cli", "db", "query", sql], { stdio: ["ignore", "ignore", "inherit"] });
  console.log("ok");
}

const conteo = execFileSync("npx", ["@insforge/cli", "db", "query",
  TABLAS.map(([t]) => `select '${t}' as tabla, count(*) from ${t}`).join(" union all "),
  "--json"], { encoding: "utf8" });
console.log("\n" + JSON.parse(conteo).rows.map((r) => `  ${r.tabla.padEnd(14)} ${r.count}`).join("\n"));
