#!/usr/bin/env node
// ft-hack — cliente del API del hackathon FreeTicket.
//
//   ft-hack setup camila                       consigue tu token (una vez)
//   ft-hack sources                            qué recursos y filtros hay
//   ft-hack get boom profile --email ana@x.com  consulta puntual
//   ft-hack get freeticket events --month agosto
//   ft-hack pull boom users --out raw/boom_users.csv   todo el recurso, paginado
//
// REGLA DURA: una invocación toca UNA plataforma. Boom y FreeTicket son dos
// sistemas distintos que en la vida real nadie consulta en el mismo query.
// No existe una bandera para pedir las dos, y no la va a haber: cruzarlas es
// justamente el reto.

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOGO } from "../scripts/build-functions.mjs";

const API_POR_DEFECTO = "https://hackathon-freeticket.vercel.app";
const CONFIG = ".ft-hack.json";
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
const die = (msg) => {
  console.error(`✕ ${msg}`);
  process.exit(1);
};

// --flag valor · --flag (booleano). Todo lo que no sea flag es posicional.
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) {
    const siguiente = argv[i + 1];
    if (siguiente !== undefined && !siguiente.startsWith("--")) { flags[a.slice(2)] = siguiente; i++; }
    else flags[a.slice(2)] = true;
  } else positional.push(a);
}

// ------------------------------------------------------------------- config

const leerConfig = () => {
  for (const dir of [process.cwd(), RAIZ]) {
    const f = join(dir, CONFIG);
    if (existsSync(f)) {
      try { return JSON.parse(readFileSync(f, "utf8")); } catch { /* archivo roto: se ignora */ }
    }
  }
  return {};
};

const cfg = leerConfig();
const API = flags.api ?? process.env.FT_HACK_API ?? cfg.api ?? API_POR_DEFECTO;
const TOKEN = flags.token ?? process.env.FT_HACK_TOKEN ?? cfg.token ?? "";

// -------------------------------------------------------------------- ayuda

function ayuda() {
  console.log(`
ft-hack — datos del hackathon FreeTicket

  ft-hack setup <handle>                    consigue tu token (una sola vez)
  ft-hack sources                           recursos y filtros disponibles
  ft-hack get <plataforma> <recurso> [...]  consulta puntual
  ft-hack pull <plataforma> <recurso>       el recurso completo, paginado

Flags
  --out <ruta>       escribir a un archivo (por defecto, a pantalla)
  --format json|csv  json en 'get', csv en 'pull'
  --limit <n>        máximo de filas (get: 100 por defecto, tope 1000)
  --offset <n>       para paginar a mano
  --order <col.asc>  ordenar
  --<filtro> <valor> cualquier filtro del recurso (ver 'sources')

Plataformas
${Object.entries(CATALOGO).map(([k, p]) => `  ${k.padEnd(12)} ${p.label}\n${" ".repeat(14)}${Object.keys(p.recursos).join(", ")}`).join("\n")}

Una invocación = una plataforma. Cruzarlas es tu trabajo, no el del CLI.
`);
}

// ------------------------------------------------------------------- fetch

async function pedir(plataforma, params) {
  if (!TOKEN) die("no tienes token. Corre:  ft-hack setup <tu-nombre>");
  const url = `${API.replace(/\/$/, "")}/api/${plataforma}?${params}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const cuerpo = await res.text();
  if (res.status === 401) die(`${JSON.parse(cuerpo).error ?? "token inválido"}`);
  if (!res.ok) {
    let msg = cuerpo.slice(0, 300);
    try { msg = JSON.parse(cuerpo).error ?? msg; } catch { /* respuesta no-JSON */ }
    die(`${res.status}: ${msg}`);
  }
  return cuerpo;
}

const escribir = (texto, etiqueta) => {
  const out = flags.out;
  if (typeof out === "string") {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, texto);
    console.log(`✓ ${etiqueta} → ${out}`);
  } else process.stdout.write(texto.endsWith("\n") ? texto : texto + "\n");
};

// -------------------------------------------------------------------- main

const [cmd, plataforma, recurso] = positional;

if (!cmd || cmd === "help" || flags.help) { ayuda(); process.exit(0); }

// ---- setup
if (cmd === "setup") {
  const handle = positional[1] ?? flags.handle;
  if (!handle || typeof handle !== "string") die("dime cómo te llamas:  ft-hack setup camila");
  const res = await fetch(`${API.replace(/\/$/, "")}/api/setup?handle=${encodeURIComponent(handle)}`);
  const data = await res.json();
  if (!res.ok || !data.token) die(data.error ?? `no se pudo registrar (${res.status})`);

  writeFileSync(join(process.cwd(), CONFIG), JSON.stringify({ api: data.api, token: data.token, handle: data.handle }, null, 2) + "\n");
  console.log(`
${data.nuevo ? "Listo, quedaste registrado" : "Ya estabas registrado"} como "${data.handle}".

  token   ${data.token}
  api     ${data.api}

Se guardó en ${CONFIG} — el CLI lo lee solo. Si prefieres variables de entorno:

  export FT_HACK_API=${data.api}
  export FT_HACK_TOKEN=${data.token}

Prueba:
  ft-hack sources
  ft-hack get freeticket events --month agosto --limit 5
`);
  process.exit(0);
}

// ---- sources
if (cmd === "sources") {
  for (const [k, p] of Object.entries(CATALOGO)) {
    console.log(`\n${k} — ${p.label}`);
    for (const [nombre, r] of Object.entries(p.recursos)) {
      console.log(`  · ${nombre.padEnd(9)} ${r.nota}`);
      console.log(`    ${" ".repeat(9)} filtros: ${Object.keys(r.filtros).join(", ")}`);
    }
  }
  console.log(`\napi:   ${API}`);
  console.log(`token: ${TOKEN ? TOKEN.slice(0, 9) + "…" : "(sin token — corre 'ft-hack setup <tu-nombre>')"}\n`);
  process.exit(0);
}

if (cmd !== "get" && cmd !== "pull") die(`comando desconocido: ${cmd}. Prueba 'ft-hack help'.`);

// ---- validación: una plataforma por invocación
const plataformasPedidas = positional.slice(1).filter((p) => p in CATALOGO);
if (plataformasPedidas.length > 1) {
  die("una invocación = una plataforma. Pide boom y freeticket por separado; el cruce es tuyo.");
}
if (!CATALOGO[plataforma]) die(`plataforma inválida: ${plataforma ?? "(falta)"}. Opciones: ${Object.keys(CATALOGO).join(", ")}`);

const defs = CATALOGO[plataforma].recursos;
if (!defs[recurso]) die(`recurso inválido para ${plataforma}: ${recurso ?? "(falta)"}. Opciones: ${Object.keys(defs).join(", ")}`);

// Un filtro mal escrito se ignoraría en silencio y devolvería el recurso entero.
const reservados = new Set(["out", "format", "limit", "offset", "order", "api", "token", "help"]);
const filtrosValidos = Object.keys(defs[recurso].filtros);
const params = new URLSearchParams({ resource: recurso });
for (const [k, v] of Object.entries(flags)) {
  if (reservados.has(k)) continue;
  if (!filtrosValidos.includes(k)) {
    die(`--${k} no es un filtro de ${plataforma}/${recurso}. Disponibles: ${filtrosValidos.join(", ")}`);
  }
  params.set(k, String(v));
}
if (flags.order) params.set("order", String(flags.order));

// ---- get: una página
if (cmd === "get") {
  params.set("limit", String(flags.limit ?? 100));
  if (flags.offset) params.set("offset", String(flags.offset));
  if (flags.format === "csv") params.set("format", "csv");
  const cuerpo = await pedir(plataforma, params);
  escribir(cuerpo, `${plataforma}/${recurso}`);
  process.exit(0);
}

// ---- pull: todo el recurso, paginando.
// 1000 es el tope real del API de registros; pedir más se trunca en silencio.
const PAGINA = 1000;
const filas = [];
let offset = 0;
for (;;) {
  params.set("limit", String(PAGINA));
  params.set("offset", String(offset));
  params.set("format", "json");
  const { rows, count } = JSON.parse(await pedir(plataforma, params));
  filas.push(...rows);
  process.stderr.write(`  ${filas.length}${count ? "/" + count : ""}   \r`);
  if (rows.length < PAGINA || (count && filas.length >= count)) break;
  offset += PAGINA;
}
process.stderr.write("                    \r");

const aCsv = (rs) => {
  if (!rs.length) return "";
  const cols = Object.keys(rs[0]);
  const esc = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rs.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n") + "\n";
};

escribir(flags.format === "json" ? JSON.stringify(filas, null, 2) : aCsv(filas), `${plataforma}/${recurso} (${filas.length} filas)`);
