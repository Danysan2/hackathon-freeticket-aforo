// Verificación del paquete del hackathon: CLI, aislamiento entre plataformas,
// generador, calidad del dato y — lo importante — que el dataset TENGA señal.
// Correr después de regenerar con otra semilla:  node scripts/verify.mjs
import { execFileSync } from "node:child_process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const SCRIPTS = dirname(fileURLToPath(import.meta.url));
import { readFileSync, existsSync, rmSync, mkdtempSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CATALOGO, readmeAgentes } from "./build-functions.mjs";

const REPO = join(SCRIPTS, "..");
const CLI = join(REPO, "bin/ft-hack.mjs");
let ok = 0, fail = 0;

const t = (nombre, fn) => {
  try {
    fn();
    console.log(`  ✓ ${nombre}`);
    ok++;
  } catch (e) {
    console.log(`  ✕ ${nombre}\n      ${e.message.split("\n")[0]}`);
    fail++;
  }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const csvRows = (txt) => txt.trim().split("\n").length - 1;

// ------------------------------------------------------- 1-4. CLI contra el API
// El CLI ya no lee archivos: todo pasa por el API. Se levanta un servidor que
// calca el contrato real para que la prueba no dependa de la red.

const server = spawn("node", [join(SCRIPTS, "_verify-server.mjs")], { stdio: "pipe" });
await new Promise((r) => server.stdout.once("data", r));
const API = "http://localhost:8931";
const TRABAJO = mkdtempSync(join(tmpdir(), "ft-"));

const cli = (args, env = {}) =>
  execFileSync("node", [CLI, ...args], {
    cwd: TRABAJO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, FT_HACK_API: API, ...env },
  });

const cliFail = (args, env = {}) => {
  try {
    execFileSync("node", [CLI, ...args], {
      cwd: TRABAJO, encoding: "utf8", stdio: "pipe", maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, FT_HACK_API: API, ...env },
    });
    return null;
  } catch (e) { return { code: e.status, err: e.stderr }; }
};

console.log("\n1. Alta de participante");

t("setup entrega un token y lo guarda en .ft-hack.json", () => {
  const out = cli(["setup", "camila"]);
  assert(/hk_/.test(out), "no imprimió el token");
  const cfg = JSON.parse(readFileSync(join(TRABAJO, ".ft-hack.json"), "utf8"));
  assert(cfg.token.startsWith("hk_"), "token mal guardado");
  assert(cfg.handle === "camila", "handle mal guardado");
});

t("setup es idempotente: mismo handle, mismo token", () => {
  const antes = JSON.parse(readFileSync(join(TRABAJO, ".ft-hack.json"), "utf8")).token;
  cli(["setup", "camila"]);
  const despues = JSON.parse(readFileSync(join(TRABAJO, ".ft-hack.json"), "utf8")).token;
  assert(antes === despues, "el token cambió al repetir setup");
});

t("setup sin nombre falla con un mensaje útil", () => {
  const r = cliFail(["setup"]);
  assert(r && /cómo te llamas/i.test(r.err), r?.err);
});

t("el CLI toma el token del archivo sin variables de entorno", () => {
  const out = cli(["get", "freeticket", "artists", "--limit", "3"]);
  assert(JSON.parse(out).rows.length === 3, "no leyó .ft-hack.json");
});

console.log("\n2. Consultas");

for (const [plat, rec] of [["boom", "users"], ["boom", "tickets"], ["boom", "social"],
                           ["freeticket", "artists"], ["freeticket", "events"],
                           ["freeticket", "sales"], ["freeticket", "tickets"]]) {
  t(`get ${plat} ${rec} responde con filas`, () => {
    const r = JSON.parse(cli(["get", plat, rec, "--limit", "5"]));
    assert(r.resource === rec, "recurso equivocado");
    assert(r.rows.length > 0, "sin filas");
    assert(r.count > 0, "sin conteo total");
  });
}

t("un filtro concreto reduce el resultado", () => {
  const todos = JSON.parse(cli(["get", "freeticket", "events", "--limit", "1"])).count;
  const uno = JSON.parse(cli(["get", "freeticket", "events", "--artist", "ft_art_001"]));
  assert(uno.count > 0 && uno.count < todos, `filtro sin efecto: ${uno.count} de ${todos}`);
  assert(uno.rows.every((e) => e.artist_id === "ft_art_001"), "devolvió eventos de otro artista");
});

t("consulta por usuario concreto", () => {
  const r = JSON.parse(cli(["get", "boom", "users", "--id", "bm_usr_000001"]));
  assert(r.count === 1 && r.rows[0].boom_user_id === "bm_usr_000001", "no encontró al usuario");
});

t("--format csv devuelve CSV", () => {
  const out = cli(["get", "boom", "users", "--limit", "3", "--format", "csv"]);
  assert(out.split("\n")[0].includes("boom_user_id"), "no parece CSV");
});

t("pull pagina hasta traer el recurso completo", () => {
  const dest = join(TRABAJO, "raw/users.csv");
  cli(["pull", "boom", "users", "--out", dest]);
  assert(csvRows(readFileSync(dest, "utf8")) === 6000, `trajo ${csvRows(readFileSync(dest, "utf8"))} de 6000`);
});

console.log("\n3. La regla dura");

t("get boom freeticket → error y exit 1", () => {
  const r = cliFail(["get", "boom", "freeticket"]);
  assert(r && r.code === 1, "debió salir 1");
  assert(/una plataforma/i.test(r.err), `mensaje inesperado: ${r.err}`);
});

t("no existe ninguna bandera para pedir las dos", () => {
  const src = readFileSync(CLI, "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert(!/--all\b|--both\b|--todas\b/.test(src), "hay una bandera de escape");
});

t("un recurso de la otra plataforma no se cuela", () => {
  const r = cliFail(["get", "boom", "events"]);
  assert(r && /recurso inválido/i.test(r.err), r?.err);
});

t("el API tampoco mezcla: cada función conoce solo sus recursos", () => {
  const boom = Object.keys(CATALOGO.boom.recursos);
  const ft = Object.keys(CATALOGO.freeticket.recursos);
  const relBoom = Object.values(CATALOGO.boom.recursos).map((r) => r.rel);
  const relFt = Object.values(CATALOGO.freeticket.recursos).map((r) => r.rel);
  assert(relBoom.every((r) => r.startsWith("boom_")), `relación ajena en boom: ${relBoom}`);
  assert(relFt.every((r) => r.startsWith("ft_")), `relación ajena en freeticket: ${relFt}`);
  assert(boom.length > 0 && ft.length > 0, "catálogo vacío");
});

console.log("\n4. Errores");

t("sin token, mensaje accionable", () => {
  const solo = mkdtempSync(join(tmpdir(), "sin-"));
  const r = (() => {
    try {
      execFileSync("node", [CLI, "get", "boom", "users"], {
        cwd: solo, encoding: "utf8", stdio: "pipe",
        env: { ...process.env, FT_HACK_API: API, FT_HACK_TOKEN: "" },
      });
      return null;
    } catch (e) { return { err: e.stderr }; }
  })();
  assert(r && /setup/.test(r.err), `no sugiere setup: ${r?.err}`);
  rmSync(solo, { recursive: true });
});

t("token inválido → mensaje, no stacktrace", () => {
  const r = cliFail(["get", "boom", "users"], { FT_HACK_TOKEN: "hk_inventado" });
  assert(r && /token inválido/i.test(r.err), r?.err);
  assert(!/at .*\.mjs:/.test(r.err), "filtró stacktrace");
});

t("filtro mal escrito no se ignora en silencio", () => {
  const r = cliFail(["get", "boom", "users", "--emial", "x"]);
  assert(r && /no es un filtro/i.test(r.err), r?.err);
});

t("plataforma inexistente", () => {
  const r = cliFail(["get", "spotify", "users"]);
  assert(r && /plataforma inválida/i.test(r.err), r?.err);
});

server.kill();
rmSync(TRABAJO, { recursive: true, force: true });

// -------------------------------------------------------- 5. generador
console.log("\n5. Generador");

const sha = (p) => createHash("sha1").update(readFileSync(p)).digest("hex").slice(0, 12);

t("misma semilla → mismo dataset (reproducible)", () => {
  const d1 = mkdtempSync(join(tmpdir(), "g1-"));
  const d2 = mkdtempSync(join(tmpdir(), "g2-"));
  for (const d of [d1, d2]) {
    execFileSync("node", ["scripts/generate.mjs", "--seed", "99", "--users", "300", "--events", "6", "--out", d], { cwd: REPO, stdio: "pipe" });
  }
  assert(sha(join(d1, "boom/users.csv")) === sha(join(d2, "boom/users.csv")), "usuarios difieren");
  assert(sha(join(d1, "freeticket/sales.csv")) === sha(join(d2, "freeticket/sales.csv")), "ventas difieren");
  rmSync(d1, { recursive: true }); rmSync(d2, { recursive: true });
});

t("otra semilla → otro dataset", () => {
  const d = mkdtempSync(join(tmpdir(), "g3-"));
  execFileSync("node", ["scripts/generate.mjs", "--seed", "7", "--users", "300", "--events", "6", "--out", d], { cwd: REPO, stdio: "pipe" });
  assert(sha(join(d, "boom/users.csv")) !== sha(join(REPO, "data/boom/users.csv")), "semilla ignorada");
  rmSync(d, { recursive: true });
});

t("--users y --oneoffs se respetan", () => {
  const d = mkdtempSync(join(tmpdir(), "g4-"));
  execFileSync("node", ["scripts/generate.mjs", "--users", "500", "--oneoffs", "4", "--out", d], { cwd: REPO, stdio: "pipe" });
  assert(csvRows(readFileSync(join(d, "boom/users.csv"), "utf8")) === 500, "usuarios");
  const ev = readFileSync(join(d, "freeticket/events.csv"), "utf8").trim().split("\n").slice(1);
  const sueltos = ev.filter((l) => l.includes(",false,")).length;
  assert(sueltos === 4, `fechas sueltas: ${sueltos}`);
  rmSync(d, { recursive: true });
});

// -------------------------------------------------------- 6. calidad del dato
console.log("\n6. Calidad del dato");

const parse = (p) => {
  const txt = readFileSync(join(REPO, p), "utf8").trim().split("\n");
  const cs = txt[0].split(",");
  return txt.slice(1).map((l) => {
    // parser simple: ningún campo del dataset lleva comas (se valida aparte)
    const v = l.split(",");
    return Object.fromEntries(cs.map((c, i) => [c, v[i]]));
  });
};

const users = parse("data/boom/users.csv");
const tickets = parse("data/boom/tickets.csv");
const social = parse("data/boom/social.csv");
const sales = parse("data/freeticket/sales.csv");
const events = parse("data/freeticket/events.csv");
const ftTickets = parse("data/freeticket/tickets.csv");
const artists = parse("data/freeticket/artists.csv");
const truthM = parse("data/_truth/matches.csv");
const truthA = parse("data/_truth/attendance.csv");
const agosto = events.filter((e) => new Date(e.starts_at.replace(" ", "T") + "Z") > new Date("2026-08-01T12:00:00Z"));
const julio = events.filter((e) => !agosto.includes(e));

t("ningún CSV filtra columnas internas (_algo)", () => {
  for (const [n, rows] of [["users", users], ["tickets", tickets], ["events", events], ["sales", sales], ["ft_tickets", ftTickets], ["artists", artists]]) {
    const malas = Object.keys(rows[0]).filter((c) => c.startsWith("_"));
    assert(malas.length === 0, `${n} filtra ${malas.join(",")}`);
  }
});

t("ninguna fila tiene columnas corridas por comas sueltas", () => {
  for (const [n, p] of [["users", "data/boom/users.csv"], ["sales", "data/freeticket/sales.csv"], ["events", "data/freeticket/events.csv"], ["ft_tickets", "data/freeticket/tickets.csv"]]) {
    const lineas = readFileSync(join(REPO, p), "utf8").trim().split("\n");
    const nCols = lineas[0].split(",").length;
    const malas = lineas.filter((l) => !l.includes('"') && l.split(",").length !== nCols);
    assert(malas.length === 0, `${n}: ${malas.length} filas corridas — p.ej. ${malas[0]?.slice(0, 80)}`);
  }
});

t("ids únicos y con el prefijo de su plataforma", () => {
  assert(new Set(users.map((u) => u.boom_user_id)).size === users.length, "boom_user_id duplicado");
  assert(new Set(sales.map((s) => s.sale_id)).size === sales.length, "sale_id duplicado");
  assert(users.every((u) => u.boom_user_id.startsWith("bm_usr_")), "prefijo usuario");
  assert(sales.every((s) => s.sale_id.startsWith("ft_sal_")), "prefijo venta");
  assert(new Set(ftTickets.map((t) => t.ticket_id)).size === ftTickets.length, "ticket_id duplicado");
});

t("los universos de eventos no se tocan", () => {
  const boomEv = new Set(tickets.map((x) => x.event_id));
  const ftEv = new Set(events.map((e) => e.event_id));
  assert([...boomEv].every((e) => e.startsWith("bm_evt_")), "evento boom mal prefijado");
  assert([...ftEv].every((e) => e.startsWith("ft_evt_")), "evento ft mal prefijado");
  assert([...boomEv].filter((e) => ftEv.has(e)).length === 0, "hay colisión de ids");
});

t("integridad referencial dentro de cada plataforma", () => {
  const uid = new Set(users.map((u) => u.boom_user_id));
  assert(tickets.every((x) => uid.has(x.boom_user_id)), "ticket huérfano");
  assert(social.every((x) => uid.has(x.boom_user_id)), "social huérfano");
  const eid = new Set(events.map((e) => e.event_id));
  assert(sales.every((s) => eid.has(s.event_id)), "venta sin evento");
  const sid = new Set(sales.map((s) => s.sale_id));
  assert(ftTickets.every((t) => sid.has(t.sale_id) && eid.has(t.event_id)), "ticket huérfano");
  const aid = new Set(artists.map((a) => a.artist_id));
  assert(events.every((e) => aid.has(e.artist_id)), "evento sin artista");
  // qty de la venta = número de filas de ticket de esa venta
  const porVenta = new Map();
  for (const t of ftTickets) porVenta.set(t.sale_id, (porVenta.get(t.sale_id) ?? 0) + 1);
  const mal = sales.filter((s) => porVenta.get(s.sale_id) !== Number(s.qty));
  assert(mal.length === 0, `${mal.length} ventas con qty distinto a sus tickets`);
});

t("NO existe ninguna llave compartida entre plataformas", () => {
  const emailsBoom = new Set(users.map((u) => u.email));
  const exactos = sales.filter((s) => emailsBoom.has(s.buyer_email)).length;
  // Hay coincidencias exactas a propósito (el 55% limpio), pero ninguna columna
  // de la tiquetera puede contener un boom_user_id.
  const idFiltrado = sales.some((s) => Object.values(s).some((v) => String(v).includes("bm_usr_")));
  assert(!idFiltrado, "un boom_user_id se filtró a la tiquetera");
  assert(exactos > 0 && exactos < sales.length, `match exacto sospechoso: ${exactos}/${sales.length}`);
});

t("el ruido está presente en las tres llaves", () => {
  const alias = sales.filter((s) => s.buyer_email.includes("+")).length;
  const dominioMalo = sales.filter((s) => /gmial|hotmial|outlok/.test(s.buyer_email)).length;
  const mayus = sales.filter((s) => s.buyer_email !== s.buyer_email.toLowerCase()).length;
  const telVacio = sales.filter((s) => !s.buyer_phone).length;
  const formatos = new Set(sales.map((s) => s.buyer_phone.replace(/\d/g, "#"))).size;
  const nombreRaro = sales.filter((s) => s.buyer_name !== s.buyer_name.trim() || /^[a-zñáéíóú. ]+$/.test(s.buyer_name)).length;
  assert(alias > 50, `pocos alias +: ${alias}`);
  assert(dominioMalo > 50, `pocos dominios mal escritos: ${dominioMalo}`);
  assert(mayus > 20, `pocos mayúsculas: ${mayus}`);
  assert(telVacio > 50, `pocos teléfonos vacíos: ${telVacio}`);
  assert(formatos >= 5, `pocos formatos de teléfono: ${formatos}`);
  assert(nombreRaro > 100, `pocos nombres sucios: ${nombreRaro}`);
});

t("cerca de la mitad de compradores NO existe en Boom", () => {
  const tasa = truthM.length / sales.length;
  assert(tasa > 0.45 && tasa < 0.65, `tasa de match: ${(tasa * 100).toFixed(1)}%`);
});

t("truth apunta a ids que existen en ambos lados", () => {
  const uid = new Set(users.map((u) => u.boom_user_id));
  const sid = new Set(sales.map((s) => s.sale_id));
  assert(truthM.every((m) => uid.has(m.boom_user_id)), "truth con usuario fantasma");
  assert(truthM.every((m) => sid.has(m.sale_id)), "truth con venta fantasma");
  assert(new Set(truthM.map((m) => m.sale_id)).size === truthM.length, "una venta con dos matches");
});


t("julio tiene check-in y agosto NO (no se filtra el futuro)", () => {
  const evAgosto = new Set(agosto.map((e) => e.event_id));
  const conDato = ftTickets.filter((t) => t.checked_in !== "");
  const filtrados = conDato.filter((t) => evAgosto.has(t.event_id));
  assert(filtrados.length === 0, `${filtrados.length} tickets de agosto traen la respuesta`);
  const julioSinDato = ftTickets.filter((t) => t.checked_in === "" && !evAgosto.has(t.event_id));
  assert(julioSinDato.length === 0, `${julioSinDato.length} tickets de julio sin check-in`);
  assert(conDato.length > 3000, `julio muy chico: ${conDato.length} tickets`);
  console.log(`      julio ${conDato.length} tickets etiquetados · agosto ${ftTickets.length - conDato.length} por proyectar`);
});

t("hay eventos en los dos meses", () => {
  assert(julio.length >= 10 && agosto.length >= 10, `julio=${julio.length} agosto=${agosto.length}`);
});

t("las residencias caen SIEMPRE en su día y venue", () => {
  const porArtista = new Map(artists.map((a) => [a.artist_id, a]));
  const res = events.filter((e) => e.is_residency === "true");
  assert(res.length > 20, `pocas residencias: ${res.length}`);
  for (const e of res) {
    const a = porArtista.get(e.artist_id);
    assert(a.residency_weekday === e.weekday, `${a.name}: ${e.weekday} ≠ ${a.residency_weekday}`);
    assert(a.residency_venue === e.venue, `${a.name}: venue ${e.venue} ≠ ${a.residency_venue}`);
  }
  const conRes = new Set(res.map((e) => e.artist_id));
  assert([...conRes].every((id) => porArtista.get(id).residency_weekday !== ""), "residencia sin declarar en artists");
  const sueltos = events.filter((e) => e.is_residency === "false");
  assert(sueltos.every((e) => porArtista.get(e.artist_id).residency_weekday === ""), "un acto de residencia con fecha suelta");
  console.log(`      ${conRes.size} residencias · ${res.length} funciones · ${sueltos.length} fechas sueltas`);
});

t("cada residencia de agosto tiene hermanas en julio", () => {
  const julioPorArtista = new Set(julio.filter((e) => e.is_residency === "true").map((e) => e.artist_id));
  const huerfanas = agosto.filter((e) => e.is_residency === "true" && !julioPorArtista.has(e.artist_id));
  assert(huerfanas.length === 0, `${huerfanas.length} residencias de agosto sin histórico`);
});

t("el histórico de julio del artista predice su agosto", () => {
  const tasaPorEvento = new Map(truthA.map((a) => [a.event_id, Number(a.tasa)]));
  const media = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const pares = [];
  for (const a of artists) {
    const j = julio.filter((e) => e.artist_id === a.artist_id).map((e) => tasaPorEvento.get(e.event_id));
    const g = agosto.filter((e) => e.artist_id === a.artist_id).map((e) => tasaPorEvento.get(e.event_id));
    if (j.length < 2 || g.length < 1) continue;
    pares.push([media(j), media(g)]);
  }
  assert(pares.length >= 5, `pocos artistas comparables: ${pares.length}`);
  const mx = media(pares.map((p) => p[0])), my = media(pares.map((p) => p[1]));
  const r = media(pares.map((p) => (p[0] - mx) * (p[1] - my))) /
    (Math.sqrt(media(pares.map((p) => (p[0] - mx) ** 2))) * Math.sqrt(media(pares.map((p) => (p[1] - my) ** 2))));
  console.log(`      r (asistencia julio vs agosto, por artista) = ${r.toFixed(2)} sobre ${pares.length} actos`);
  assert(r > 0.4, `julio no dice nada de agosto: r=${r.toFixed(2)}`);
});

t("los eventos de agosto llevan vendida solo una parte del aforo", () => {
  const ratio = (e) => Number(truthA.find((a) => a.event_id === e.event_id).tickets_adquiridos) / Number(e.capacity);
  const mediaAgosto = agosto.map(ratio).reduce((s, x) => s + x, 0) / agosto.length;
  const mediaJulio = julio.map(ratio).reduce((s, x) => s + x, 0) / julio.length;
  console.log(`      aforo vendido — julio ${(mediaJulio * 100).toFixed(0)}% · agosto ${(mediaAgosto * 100).toFixed(0)}% (aún vendiendo)`);
  assert(mediaAgosto < mediaJulio, "agosto debería llevar menos vendido que julio");
});

t("ninguna compra de agosto es posterior a hoy", () => {
  const evAgosto = new Set(agosto.map((e) => e.event_id));
  const HOY = new Date("2026-08-01T23:59:59Z");
  const futuras = sales.filter((s) => evAgosto.has(s.event_id) && new Date(s.purchased_at.replace(" ", "T") + "Z") > HOY);
  assert(futuras.length === 0, `${futuras.length} ventas de agosto compradas en el futuro`);
});

// ------------------------------------------------------ 7. señal aprendible
console.log("\n7. ¿Hay señal que aprender?");

const porUsuario = new Map();
for (const x of tickets) {
  const a = porUsuario.get(x.boom_user_id) ?? { n: 0, u: 0 };
  a.n++;
  if (x.used === "true") a.u++;
  porUsuario.set(x.boom_user_id, a);
}

t("membresía sube la tasa de uso histórico", () => {
  const tasa = (filtro) => {
    let n = 0, u = 0;
    for (const usr of users.filter(filtro)) {
      const a = porUsuario.get(usr.boom_user_id);
      if (a) { n += a.n; u += a.u; }
    }
    return u / n;
  };
  const con = tasa((u) => u.has_membership === "true");
  const sin = tasa((u) => u.has_membership === "false");
  assert(con > sin + 0.08, `sin diferencia útil: con=${con.toFixed(3)} sin=${sin.toFixed(3)}`);
  console.log(`      membresía ${(con * 100).toFixed(1)}% vs resto ${(sin * 100).toFixed(1)}%`);
});

t("el ticket gratis se honra menos que el pago", () => {
  const tasa = (tipo) => {
    const t = tickets.filter((x) => x.type === tipo);
    return t.filter((x) => x.used === "true").length / t.length;
  };
  assert(tasa("free") < tasa("standard") - 0.05, `free=${tasa("free").toFixed(3)} standard=${tasa("standard").toFixed(3)}`);
  console.log(`      free ${(tasa("free") * 100).toFixed(1)}% vs standard ${(tasa("standard") * 100).toFixed(1)}%`);
});

t("el cruce paga: correlación entre historial y asistencia del evento", () => {
  const matchDe = new Map(truthM.map((m) => [m.sale_id, m.boom_user_id]));
  const porEvento = new Map();
  for (const s of sales) {
    const bid = matchDe.get(s.sale_id);
    if (!bid) continue;
    const a = porUsuario.get(bid);
    if (!a || a.n < 3) continue;
    const acc = porEvento.get(s.event_id) ?? { suma: 0, n: 0 };
    acc.suma += a.u / a.n;
    acc.n++;
    porEvento.set(s.event_id, acc);
  }
  const pares = truthA
    .filter((a) => porEvento.get(a.event_id)?.n >= 15)
    .map((a) => [porEvento.get(a.event_id).suma / porEvento.get(a.event_id).n, Number(a.tasa)]);
  assert(pares.length >= 15, `pocos eventos con muestra: ${pares.length}`);
  const media = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const mx = media(pares.map((p) => p[0])), my = media(pares.map((p) => p[1]));
  const cov = media(pares.map((p) => (p[0] - mx) * (p[1] - my)));
  const sx = Math.sqrt(media(pares.map((p) => (p[0] - mx) ** 2)));
  const sy = Math.sqrt(media(pares.map((p) => (p[1] - my) ** 2)));
  const r = cov / (sx * sy);
  console.log(`      r de Pearson (historial medio vs asistencia) = ${r.toFixed(2)} sobre ${pares.length} eventos`);
  // Con 24 eventos la correlación es ruidosa (r ≈ 0.35–0.7 según semilla). El
  // piso es que exista: por debajo de 0.3 el cruce no paga y el reto se cae.
  assert(r > 0.3, `el cruce no aporta señal a nivel evento: r=${r.toFixed(2)}. Prueba otra semilla o sube --events.`);
});

t("la asistencia de agosto varía por evento (no es una constante)", () => {
  const tasas = truthA.filter((a) => a.mes === "agosto").map((a) => Number(a.tasa));
  const min = Math.min(...tasas), max = Math.max(...tasas);
  const media = tasas.reduce((s, x) => s + x, 0) / tasas.length;
  console.log(`      asistencia agosto por evento: ${(min * 100).toFixed(0)}% – ${(max * 100).toFixed(0)}% (media ${(media * 100).toFixed(0)}%)`);
  assert(max - min > 0.15, `rango muy plano: ${(max - min).toFixed(3)}`);
  assert(media > 0.35 && media < 0.8, `media irreal: ${media.toFixed(3)}`);
});

// ------------------------------------------------------------- 8. documentos
console.log("\n8. Documentos");

t("el contrato para agentes cubre todos los recursos y filtros", () => {
  const txt = readmeAgentes();
  for (const [plataforma, def] of Object.entries(CATALOGO)) {
    for (const [recurso, r] of Object.entries(def.recursos)) {
      assert(txt.includes(`resource=${recurso}`), `el contrato no menciona ${plataforma}/${recurso}`);
      for (const f of Object.keys(r.filtros)) {
        assert(new RegExp(`filtros:.*\\b${f}\\b`).test(txt), `el contrato no lista el filtro ${f}`);
      }
    }
  }
  assert(/\/api\/setup\?handle=/.test(txt), "no explica cómo sacar el token");
  assert(/UNA plataforma/.test(txt), "no enuncia la regla");
});

t("las functions desplegadas están en sync con el catálogo", () => {
  // Cambiar el catálogo y olvidar `npm run functions` deja el API mintiendo.
  const tpl = readFileSync(join(REPO, "functions/_plataforma.ts"), "utf8");
  for (const [plataforma, def] of Object.entries(CATALOGO)) {
    const esperado = tpl
      .replace("__PLATAFORMA__", plataforma)
      .replace("__RECURSOS__", JSON.stringify(def.recursos, null, 2));
    const actual = readFileSync(join(REPO, `functions/${plataforma}.ts`), "utf8");
    assert(actual === esperado, `functions/${plataforma}.ts quedó viejo — corre 'npm run functions'`);
  }
  const readme = readFileSync(join(REPO, "functions/hackathon.ts"), "utf8");
  assert(readme.includes(JSON.stringify(readmeAgentes())), "functions/hackathon.ts quedó viejo — corre 'npm run functions'");
});

t("SKILL.md tiene frontmatter con name y description", () => {
  const md = readFileSync(join(REPO, "SKILL.md"), "utf8");
  assert(md.startsWith("---\n"), "sin frontmatter");
  const fm = md.split("---")[1];
  assert(/name:\s*hackathon-freeticket/.test(fm), "sin name");
  assert(/description:\s*.{40,}/.test(fm), "description muy corta");
});

t("los campos que documenta la skill existen en los CSV", () => {
  const md = readFileSync(join(REPO, "SKILL.md"), "utf8");
  for (const [rows, nombre] of [[users, "users"], [tickets, "tickets"], [sales, "sales"], [events, "events"], [ftTickets, "ft_tickets"], [artists, "artists"]]) {
    for (const c of Object.keys(rows[0])) {
      assert(md.includes(c), `SKILL.md no documenta ${nombre}.${c}`);
    }
  }
});

t("README y slides coinciden en el cronograma", () => {
  const rd = readFileSync(join(REPO, "README.md"), "utf8");
  const sl = readFileSync(join(REPO, "slides/index.html"), "utf8");
  for (const hora of ["12:30", "12:45", "13:10", "14:20", "14:35", "15:40", "15:55", "16:25", "16:30"]) {
    assert(rd.includes(hora), `README sin ${hora}`);
    assert(sl.includes(hora), `slides sin ${hora}`);
  }
});

t("la data NO va al repo: solo se llega por CLI o API", () => {
  const gi = readFileSync(join(REPO, ".gitignore"), "utf8");
  assert(/^data\/$/m.test(gi), "data/ no está en .gitignore");
  assert(/^\.ft-hack\.json$/m.test(gi), "el token del participante no está ignorado");
  const rastreados = execFileSync("git", ["ls-files"], { cwd: REPO, encoding: "utf8" }).split("\n");
  const fugas = rastreados.filter((f) => f.startsWith("data/") || f.endsWith(".csv") || f === ".ft-hack.json");
  assert(fugas.length === 0, `el repo rastrea datos: ${fugas.join(", ")}`);
});

t("ningún archivo del repo lleva un token ni la API key", () => {
  const rastreados = execFileSync("git", ["ls-files"], { cwd: REPO, encoding: "utf8" }).trim().split("\n");
  // Este mismo archivo lleva los patrones que busca; excluirlo evita el falso positivo.
  for (const f of rastreados.filter((f) => f !== "scripts/verify.mjs")) {
    const txt = readFileSync(join(REPO, f), "utf8");
    const hit = txt.match(/hk_[0-9a-f]{16,}|uak_[A-Za-z0-9_-]{10,}|eyJhbGciOi/);
    assert(!hit, `${f} contiene una credencial: ${hit?.[0].slice(0, 12)}…`);
  }
});

t("slides: cero hexadecimales fuera del bloque de tokens", () => {
  const sl = readFileSync(join(REPO, "slides/index.html"), "utf8");
  const cuerpo = sl.split("</style>")[1];
  const hex = cuerpo.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
  assert(hex.length === 0, `hex sueltos en el HTML: ${hex.join(", ")}`);
});

t("cero dependencias", () => {
  const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
  assert(!pkg.dependencies && !pkg.devDependencies, "aparecieron dependencias");
});

console.log(`\n${fail === 0 ? "TODO VERDE" : "HAY FALLOS"} — ${ok} pasaron, ${fail} fallaron\n`);
process.exit(fail === 0 ? 0 : 1);
