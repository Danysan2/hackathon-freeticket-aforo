// Alta de participante. Público a propósito: nadie debería perder cinco
// minutos del hackathon pidiendo una credencial.
//
//   GET|POST <base>/functions/setup?handle=camila
//   → { token, api, endpoints }
//
// Idempotente por handle: volver a correrlo devuelve el MISMO token, así que
// `ft-hack setup` se puede repetir sin ensuciar la tabla ni perder el acceso.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });

const nuevoToken = () => {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return "hk_" + [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
};

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);
  let handle = url.searchParams.get("handle") ?? "";
  if (!handle && req.method === "POST") {
    try {
      handle = ((await req.json()) as { handle?: string })?.handle ?? "";
    } catch { /* cuerpo vacío o no-JSON: se maneja abajo */ }
  }

  handle = handle.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 40);
  if (handle.length < 2) {
    return json({ error: "Dime cómo te llamas: ?handle=tu-nombre (2 a 40 caracteres)." }, 400);
  }

  const base = Deno.env.get("INSFORGE_BASE_URL");
  const apiKey = Deno.env.get("API_KEY");
  // Lo que se le dice al participante es la URL pública; InsForge queda detrás.
  const publica = "https://hackathon-freeticket.vercel.app";
  const cabeceras = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

  // ¿Ya se registró? Mismo handle, mismo token.
  const previo = await fetch(
    `${base}/api/database/records/hackathon_participant?handle=eq.${encodeURIComponent(handle)}&limit=1`,
    { headers: cabeceras },
  );
  const existentes = previo.ok ? await previo.json() : [];

  let token: string;
  let nuevo = false;
  if (Array.isArray(existentes) && existentes.length > 0) {
    token = existentes[0].token;
  } else {
    token = nuevoToken();
    const alta = await fetch(`${base}/api/database/records/hackathon_participant`, {
      method: "POST",
      headers: cabeceras,
      body: JSON.stringify([{ token, handle }]),
    });
    if (!alta.ok) {
      return json({ error: "No se pudo crear el acceso.", detalle: (await alta.text()).slice(0, 300) }, 502);
    }
    nuevo = true;
  }

  return json({
    ok: true,
    nuevo,
    handle,
    token,
    api: publica,
    endpoints: {
      contrato: publica,
      boom: `${publica}/api/boom?resource=…`,
      freeticket: `${publica}/api/freeticket?resource=…`,
    },
    siguiente: [
      `export FT_HACK_API=${publica}`,
      `export FT_HACK_TOKEN=${token}`,
      "ft-hack get boom profile --limit 5",
    ],
    regla: "Una petición toca una sola plataforma. El cruce entre Boom y la tiquetera es tuyo.",
  });
}
