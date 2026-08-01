// El contrato completo, en texto plano, para que un agente lo lea de una.
//
//   fetch https://<host>/functions/hackathon and follow the instructions
//
// Sin token: es la puerta de entrada. El cuerpo se arma en build-functions.mjs
// desde el mismo catálogo que usan la API y el CLI, así que no puede quedar
// desactualizado respecto a lo que el endpoint realmente responde.

const TEXTO = __TEXTO__;

export default function (req: Request): Response {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  // ?format=json para quien prefiera parsear en vez de leer.
  if (new URL(req.url).searchParams.get("format") === "json") {
    return new Response(JSON.stringify(__CATALOGO__, null, 2), {
      headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
    });
  }

  return new Response(TEXTO, {
    headers: { ...cors, "Content-Type": "text/plain; charset=utf-8" },
  });
}
