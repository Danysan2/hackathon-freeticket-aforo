#!/usr/bin/env node
// ft-hack — cliente de datos del hackathon FreeTicket.
//
//   ft-hack sources
//   ft-hack pull boom users --out ./raw/boom_users.csv
//   ft-hack pull freeticket sales --format json
//   ft-hack peek boom tickets --limit 5
//
// REGLA DURA: una invocación toca UNA plataforma. Boom y FreeTicket son dos
// sistemas distintos, con credenciales distintas, que en la vida real nadie
// consulta en el mismo query. No existe `--all` y no va a existir: cruzarlos es
// justamente el reto.

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

const PLATAFORMAS = {
  boom: {
    label: "Boom — membresías (v2)",
    tokenEnv: "BOOM_TOKEN",
    recursos: ["users", "tickets", "social"],
  },
  freeticket: {
    label: "FreeTicket — tiquetera (free-admin)",
    tokenEnv: "FT_TOKEN",
    recursos: ["artists", "events", "sales", "tickets"],
  },
};

// Cada plataforma vive detrás de SU endpoint y SU token. No hay una URL que
// devuelva las dos: cruzarlas es el reto.
const BASE = process.env.FT_HACK_API || "./data";

const argv = process.argv.slice(2);
const flag = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  if (i === -1) return d;
  const v = argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
};
const positional = argv.filter((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));

const die = (msg) => {
  console.error(`✕ ${msg}`);
  process.exit(1);
};

function ayuda() {
  console.log(`
ft-hack — datos del hackathon FreeTicket

  ft-hack sources                          lista plataformas y recursos
  ft-hack pull <plataforma> <recurso>      descarga un recurso
  ft-hack peek <plataforma> <recurso>      muestra las primeras filas

Flags
  --out <ruta>      dónde escribir (por defecto stdout)
  --format csv|json por defecto csv
  --limit <n>       solo en peek (por defecto 10)
  --api <base>      URL o carpeta de datos (o env FT_HACK_API)

Plataformas
${Object.entries(PLATAFORMAS)
  .map(([k, p]) => `  ${k.padEnd(12)} ${p.label}\n${" ".repeat(14)}recursos: ${p.recursos.join(", ")}`)
  .join("\n")}

Una invocación = una plataforma. Cruzarlas es tu trabajo, no el del CLI.
`);
}

// ------------------------------------------------------------------ transporte

async function leer(base, plataforma, recurso) {
  const def = PLATAFORMAS[plataforma];
  if (/^https?:/.test(base)) {
    const url = `${base.replace(/\/$/, "")}/functions/${plataforma}?file=${recurso}`;
    const token = process.env[def.tokenEnv];
    const res = await fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
    if (res.status === 401 || res.status === 403) {
      die(`sin acceso a ${plataforma}. Exporta ${def.tokenEnv} y vuelve a intentar.`);
    }
    if (!res.ok) die(`${res.status} al pedir ${url}`);
    return res.text();
  }
  const file = join(base, plataforma, `${recurso}.csv`);
  if (!existsSync(file)) die(`no encuentro ${file}. ¿Corriste 'node scripts/generate.mjs'? ¿O falta --api?`);
  return readFileSync(file, "utf8");
}

// ------------------------------------------------------------------- csv→json

function parseCsv(text) {
  const filas = [];
  let campo = "";
  let fila = [];
  let entreComillas = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (entreComillas) {
      if (c === '"' && text[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') entreComillas = false;
      else campo += c;
    } else if (c === '"') entreComillas = true;
    else if (c === ",") { fila.push(campo); campo = ""; }
    else if (c === "\n") { fila.push(campo); filas.push(fila); fila = []; campo = ""; }
    else if (c !== "\r") campo += c;
  }
  if (campo || fila.length) { fila.push(campo); filas.push(fila); }
  const [cols, ...resto] = filas.filter((f) => f.length > 1 || f[0] !== "");
  return resto.map((f) => Object.fromEntries(cols.map((c, i) => [c, f[i] ?? ""])));
}

// ---------------------------------------------------------------------- main

const [cmd, plataforma, recurso] = positional;

if (!cmd || cmd === "help" || flag("help")) { ayuda(); process.exit(0); }

if (cmd === "sources") {
  for (const [k, p] of Object.entries(PLATAFORMAS)) {
    console.log(`\n${k} — ${p.label}`);
    console.log(`  token: ${p.tokenEnv}${process.env[p.tokenEnv] ? " (presente)" : " (no configurado)"}`);
    for (const r of p.recursos) console.log(`  · ${r}`);
  }
  console.log(`\nbase: ${BASE}\n`);
  process.exit(0);
}

if (cmd !== "pull" && cmd !== "peek") die(`comando desconocido: ${cmd}. Prueba 'ft-hack help'.`);

const plataformasPedidas = positional.slice(1).filter((p) => p in PLATAFORMAS);
if (plataformasPedidas.length > 1) {
  die("una invocación = una plataforma. Pide boom y freeticket por separado; el cruce es tuyo.");
}
if (!PLATAFORMAS[plataforma]) die(`plataforma inválida: ${plataforma ?? "(falta)"}. Opciones: ${Object.keys(PLATAFORMAS).join(", ")}`);
if (!PLATAFORMAS[plataforma].recursos.includes(recurso)) {
  die(`recurso inválido para ${plataforma}: ${recurso ?? "(falta)"}. Opciones: ${PLATAFORMAS[plataforma].recursos.join(", ")}`);
}

const base = flag("api", BASE);
const texto = await leer(base, plataforma, recurso);
const formato = flag("format", "csv");

if (cmd === "peek") {
  const filas = parseCsv(texto).slice(0, Number(flag("limit", 10)));
  console.log(`${plataforma}/${recurso} — ${filas.length} filas de muestra\n`);
  console.log(JSON.stringify(filas, null, 2));
  process.exit(0);
}

const salida = formato === "json" ? JSON.stringify(parseCsv(texto), null, 2) : texto;
const out = flag("out");
if (typeof out === "string") {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, salida);
  console.log(`✓ ${plataforma}/${recurso} → ${out}`);
} else {
  process.stdout.write(salida);
}
