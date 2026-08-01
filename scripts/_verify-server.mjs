// Servidor de prueba: calca el contrato de las edge functions de InsForge
// (/functions/<plataforma>?file=<recurso>) y exige el token correcto por plataforma.
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOKENS = { boom: "Bearer boom-secreto", freeticket: "Bearer ft-secreto" };

createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const plataforma = url.pathname.replace("/functions/", "");
  const file = url.searchParams.get("file");
  if (!TOKENS[plataforma]) return res.writeHead(404).end("no");
  if (req.headers.authorization !== TOKENS[plataforma]) return res.writeHead(401).end("no");
  const ruta = join(REPO, "data", plataforma, `${file}.csv`);
  if (!existsSync(ruta)) return res.writeHead(404).end("no");
  res.writeHead(200, { "content-type": "text/csv" }).end(readFileSync(ruta));
}).listen(8931, () => console.log("listo"));
