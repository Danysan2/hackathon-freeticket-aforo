// Servidor de prueba: calca el contrato de las edge functions de InsForge
// (/functions/setup, /functions/<plataforma>?resource=…) leyendo de data/.
// Existe para que verify.mjs no dependa del backend real ni de la red.
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CATALOGO } from "./build-functions.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOPE = 1000;

// El servidor real consulta Postgres; aquí se sirve del CSV equivalente.
const ARCHIVO = {
  "boom/users": "boom/users.csv",
  "boom/profile": "boom/users.csv",
  "boom/tickets": "boom/tickets.csv",
  "boom/social": "boom/social.csv",
  "freeticket/artists": "freeticket/artists.csv",
  "freeticket/events": "freeticket/events.csv",
  "freeticket/sales": "freeticket/sales.csv",
  "freeticket/tickets": "freeticket/tickets.csv",
};

const participantes = new Map();

function parseCsv(text) {
  const filas = [];
  let campo = "", fila = [], comillas = false;
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
  const [cols, ...resto] = filas.filter((f) => f.length > 1 || f[0] !== "");
  return resto.map((f) => Object.fromEntries(cols.map((c, i) => [c, f[i] ?? ""])));
}

const aCsv = (rs) => {
  if (!rs.length) return "";
  const cols = Object.keys(rs[0]);
  const esc = (v) => (/[",\n]/.test(String(v ?? "")) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ""));
  return [cols.join(","), ...rs.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n") + "\n";
};

const json = (res, body, status = 200) =>
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));

createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const q = url.searchParams;

  if (url.pathname === "/api/setup") {
    const handle = (q.get("handle") ?? "").trim().toLowerCase();
    if (handle.length < 2) return json(res, { error: "handle muy corto" }, 400);
    const nuevo = !participantes.has(handle);
    if (nuevo) participantes.set(handle, `hk_prueba_${participantes.size + 1}`);
    return json(res, {
      ok: true, nuevo, handle, token: participantes.get(handle),
      api: "http://localhost:8931",
    });
  }

  const plataforma = url.pathname.replace("/api/", "");
  if (!CATALOGO[plataforma]) return json(res, { error: "no existe" }, 404);

  const recurso = q.get("resource");
  if (!recurso) return json(res, { plataforma, recursos: Object.keys(CATALOGO[plataforma].recursos) });
  if (!CATALOGO[plataforma].recursos[recurso]) return json(res, { error: "recurso inválido" }, 404);

  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token || ![...participantes.values()].includes(token)) {
    return json(res, { error: "Token inválido. Vuelve a correr `ft-hack setup`." }, 401);
  }

  const ruta = join(REPO, "data", ARCHIVO[`${plataforma}/${recurso}`]);
  if (!existsSync(ruta)) return json(res, { error: "sin datos locales" }, 502);
  let filas = parseCsv(readFileSync(ruta, "utf8"));

  // Filtros del catálogo, comparando como texto: alcanza para la prueba.
  for (const [nombre, [columna]] of Object.entries(CATALOGO[plataforma].recursos[recurso].filtros)) {
    const v = q.get(nombre);
    if (v === null || v === "") continue;
    filas = filas.filter((f) => String(f[columna] ?? "").toLowerCase() === v.toLowerCase());
  }

  const count = filas.length;
  const limite = Math.min(Number(q.get("limit") ?? 100) || 100, TOPE);
  const offset = Number(q.get("offset") ?? 0) || 0;
  const pagina = filas.slice(offset, offset + limite);

  if (q.get("format") === "csv") {
    return res.writeHead(200, { "content-type": "text/csv" }).end(aCsv(pagina));
  }
  return json(res, { plataforma, resource: recurso, count, limit: limite, offset, rows: pagina });
}).listen(8931, () => console.log("listo"));
