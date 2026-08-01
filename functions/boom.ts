// Plantilla del API de una plataforma. Se despliega dos veces —boom y
// freeticket— porque son dos sistemas distintos. Ninguna respuesta mezcla las
// dos: cruzarlas es el reto del participante, no un favor de la infraestructura.
//
//   GET <base>/functions/boom?resource=profile&email=ana@gmail.com
//   GET <base>/functions/freeticket?resource=events&month=agosto&artist=ft_art_001
//
// Autenticación: Authorization: Bearer <token>, el que entrega /functions/setup.
//
// Este archivo es la plantilla; boom.ts y freeticket.ts se generan de aquí con
// `node scripts/build-functions.mjs`. No editar los generados.

const PLATAFORMA = "boom";
const RECURSOS: Record<string, { rel: string; filtros: Record<string, [string, string]>; nota: string }> = {
  "users": {
    "rel": "boom_user",
    "nota": "la base de membresías, fila por persona",
    "filtros": {
      "id": [
        "boom_user_id",
        "eq"
      ],
      "email": [
        "email",
        "ilike"
      ],
      "phone": [
        "phone",
        "eq"
      ],
      "city": [
        "city",
        "eq"
      ],
      "membership": [
        "has_membership",
        "eq"
      ],
      "last_name": [
        "last_name",
        "ilike"
      ],
      "first_name": [
        "first_name",
        "ilike"
      ]
    }
  },
  "profile": {
    "rel": "boom_user_profile",
    "nota": "el usuario CON su historial resumido: tickets_total, tickets_used, use_rate, friends_count",
    "filtros": {
      "id": [
        "boom_user_id",
        "eq"
      ],
      "email": [
        "email",
        "ilike"
      ],
      "phone": [
        "phone",
        "eq"
      ],
      "city": [
        "city",
        "eq"
      ],
      "membership": [
        "has_membership",
        "eq"
      ],
      "min_tickets": [
        "tickets_total",
        "gte"
      ],
      "min_use_rate": [
        "use_rate",
        "gte"
      ]
    }
  },
  "tickets": {
    "rel": "boom_ticket",
    "nota": "historial fila por entrada; used dice si la persona entró",
    "filtros": {
      "id": [
        "boom_ticket_id",
        "eq"
      ],
      "user": [
        "boom_user_id",
        "eq"
      ],
      "event": [
        "event_id",
        "eq"
      ],
      "used": [
        "used",
        "eq"
      ],
      "type": [
        "type",
        "eq"
      ],
      "source": [
        "source",
        "eq"
      ]
    }
  },
  "social": {
    "rel": "boom_social",
    "nota": "amigos por usuario",
    "filtros": {
      "user": [
        "boom_user_id",
        "eq"
      ]
    }
  }
};

const LIMITE_DEF = 100;
// El API de registros topa en 1000 por página. Prometer más truncaría en silencio.
const LIMITE_MAX = 1000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });

const aCsv = (filas: Record<string, unknown>[]) => {
  if (!filas.length) return "";
  const cols = Object.keys(filas[0]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...filas.map((f) => cols.map((c) => esc(f[c])).join(","))].join("\n") + "\n";
};

function indice() {
  return {
    plataforma: PLATAFORMA,
    uso: "GET ?resource=<recurso>&<filtro>=<valor>&limit=100&offset=0&format=json|csv",
    autenticacion: "Authorization: Bearer <token> · consíguelo en https://hackathon-freeticket.vercel.app/api/setup?handle=tu-nombre",
    contrato: "https://hackathon-freeticket.vercel.app",
    regla: "Una petición toca una sola plataforma. El cruce entre Boom y la tiquetera es tuyo.",
    recursos: Object.fromEntries(
      Object.entries(RECURSOS).map(([nombre, r]) => [
        nombre,
        { filtros: Object.keys(r.filtros), nota: r.nota },
      ]),
    ),
  };
}

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);
  const q = url.searchParams;
  const recurso = q.get("resource") ?? "";

  if (!recurso) return json(indice());

  const def = RECURSOS[recurso];
  if (!def) {
    return json(
      { error: `No existe el recurso "${recurso}" en ${PLATAFORMA}.`, recursos: Object.keys(RECURSOS) },
      404,
    );
  }

  // ------------------------------------------------------------- credencial
  const base = Deno.env.get("INSFORGE_BASE_URL");
  const apiKey = Deno.env.get("API_KEY");
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Falta el token. Corre `ft-hack setup`." }, 401);

  const quien = await fetch(`${base}/api/database/rpc/touch_participant`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_token: token }),
  });
  const participante = quien.ok ? await quien.json() : [];
  if (!Array.isArray(participante) || participante.length === 0) {
    return json({ error: "Token inválido. Vuelve a correr `ft-hack setup` o pídele uno a un organizador." }, 401);
  }

  // ---------------------------------------------------------------- consulta
  const params = new URLSearchParams();

  for (const [nombre, [columna, op]] of Object.entries(def.filtros)) {
    const valor = q.get(nombre);
    if (valor === null || valor === "") continue;
    // `ilike` sin comodines es una igualdad que ignora mayúsculas: es lo que
    // quiere quien busca un correo. Con * el participante pide el parcial.
    params.append(columna, `${op}.${valor}`);
  }

  const limite = Math.min(Math.max(Number(q.get("limit") ?? LIMITE_DEF) || LIMITE_DEF, 1), LIMITE_MAX);
  const offset = Math.max(Number(q.get("offset") ?? 0) || 0, 0);
  params.set("limit", String(limite));
  params.set("offset", String(offset));

  const order = q.get("order");
  if (order && /^[a-z_]+\.(asc|desc)$/.test(order)) params.set("order", order);

  // Solo columnas simples: nada de embeddings de PostgREST que puedan alcanzar
  // otra relación. La separación entre plataformas no depende de la buena fe.
  const select = q.get("select");
  if (select && /^[a-z_,]+$/.test(select)) params.set("select", select);

  const res = await fetch(`${base}/api/database/records/${def.rel}?${params}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Prefer: "count=exact" },
  });

  if (!res.ok) {
    return json({ error: `La consulta falló (${res.status}).`, detalle: (await res.text()).slice(0, 300) }, 502);
  }

  const filas = await res.json();
  const rango = res.headers.get("content-range") ?? "";
  const total = rango.includes("/") ? Number(rango.split("/")[1]) : null;

  if (q.get("format") === "csv") {
    return new Response(aCsv(filas), {
      status: 200,
      headers: { ...CORS, "Content-Type": "text/csv; charset=utf-8" },
    });
  }

  return json({
    plataforma: PLATAFORMA,
    resource: recurso,
    count: Number.isFinite(total) ? total : filas.length,
    limit: limite,
    offset,
    rows: filas,
  });
}
