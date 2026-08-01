// Plantilla de un servidor de datos por plataforma. Se despliega dos veces
// —boom y freeticket— porque son dos sistemas distintos, con su propio token.
// Cruzarlos es el reto del participante, no un favor de la infraestructura.
//
//   GET <base>/functions/boom?file=users        Authorization: Bearer $BOOM_TOKEN
//   GET <base>/functions/freeticket?file=sales  Authorization: Bearer $FT_TOKEN

const PLATAFORMA = "freeticket";
const TOKEN_ENV = "FT_TOKEN";
const ARCHIVOS = ["artists","events","sales","tickets"];

const BUCKET = "hackathon-data";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const texto = (body: string, status: number) =>
  new Response(body, { status, headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8" } });

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const file = new URL(req.url).searchParams.get("file") ?? "";

  // Sin ?file= devuelve el índice. No expone ni una fila.
  if (!file) {
    return texto(
      [
        `Hackathon FreeTicket — plataforma "${PLATAFORMA}"`,
        "",
        `Credencial: Authorization: Bearer $${TOKEN_ENV}`,
        "",
        "Recursos:",
        ...ARCHIVOS.map((a: string) => `  ?file=${a}`),
        "",
        "Esta puerta solo abre esta plataforma. La otra tiene su propia URL y su",
        "propio token: pídelas por separado y haz el cruce tú.",
        "",
        `CLI:  node bin/ft-hack.mjs pull ${PLATAFORMA} ${ARCHIVOS[0]} --out raw/${PLATAFORMA}_${ARCHIVOS[0]}.csv`,
      ].join("\n"),
      200,
    );
  }

  if (!ARCHIVOS.includes(file)) {
    return texto(`No existe ${PLATAFORMA}/${file}. Opciones: ${ARCHIVOS.join(", ")}`, 404);
  }

  const esperado = Deno.env.get(TOKEN_ENV);
  const enviado = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!esperado || enviado !== esperado) {
    return texto(`Sin acceso a ${PLATAFORMA}. Exporta ${TOKEN_ENV} y vuelve a intentar.`, 401);
  }

  const base = Deno.env.get("INSFORGE_BASE_URL");
  const apiKey = Deno.env.get("API_KEY") ?? Deno.env.get("STORAGE_API_KEY");
  const objeto = encodeURIComponent(`${PLATAFORMA}/${file}.csv`);
  const res = await fetch(`${base}/api/storage/buckets/${BUCKET}/objects/${objeto}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return texto(`El dato no está disponible (${res.status}). Avísale a un organizador.`, 502);

  return new Response(res.body, {
    status: 200,
    headers: { ...CORS, "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}
