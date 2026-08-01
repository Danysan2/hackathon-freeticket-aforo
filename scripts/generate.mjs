#!/usr/bin/env node
// Generador de datos sintéticos del hackathon.
//   node scripts/generate.mjs [--seed 42] [--users 6000] [--oneoffs 18] [--out data]
//
// Calendario: hoy es el 1 de agosto de 2026.
//   · JULIO   — shows que ya pasaron. Cada ticket dice si entró y a qué hora.
//   · AGOSTO  — shows por venir. Los tickets ya adquiridos están, el check-in no.
//               Esos son los eventos a proyectar.
//
// Produce dos universos que NUNCA comparten un id:
//   data/boom/*        → plataforma de membresías (v2)
//   data/freeticket/*  → tiquetera (free-admin)
//   data/_truth/*      → ground truth (NO se publica; ver .gitignore)
//
// ponytail: PRNG propio de 6 líneas en vez de una dependencia. Semilla fija =
// dataset reproducible, que es lo único que se le pide.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------- PRNG + utils

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const args = process.argv.slice(2);
const arg = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i === -1 ? d : args[i + 1];
};

const SEED = Number(arg("seed", 42));
const N_USERS = Number(arg("users", 6000));
const N_ONEOFFS = Number(arg("oneoffs", 18));
const OUT = arg("out", "data");

const rnd = mulberry32(SEED);
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const chance = (p) => rnd() < p;
const int = (min, max) => min + Math.floor(rnd() * (max - min + 1));
// Suma de 3 uniformes ≈ campana. Suficiente para dar forma, no para publicar un paper.
const bell = (min, max) => {
  const u = (rnd() + rnd() + rnd()) / 3;
  return min + u * (max - min);
};
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const pad = (n, w = 5) => String(n).padStart(w, "0");
const iso = (d) => d.toISOString().slice(0, 19).replace("T", " ");
const DAY = 86400000;

// Hoy: 1 de agosto de 2026. Julio ya pasó, agosto está por venir.
const HOY = new Date("2026-08-01T12:00:00Z");
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

// ------------------------------------------------------------------ vocabulario

const NOMBRES_F = "María,Laura,Valentina,Camila,Daniela,Sara,Andrea,Juliana,Paula,Natalia,Isabella,Manuela,Carolina,Diana,Alejandra,Ximena,Tatiana,Luisa,Catalina,Mariana".split(",");
const NOMBRES_M = "Juan,Carlos,Andrés,Santiago,Sebastián,David,Felipe,Nicolás,Daniel,Miguel,Camilo,Julián,Esteban,Mateo,Alejandro,Ricardo,Óscar,Diego,Fabián,Cristian".split(",");
const APELLIDOS = "Gómez,Rodríguez,Martínez,Ramírez,López,González,Hernández,Moreno,Muñoz,Rojas,Castro,Vargas,Ortiz,Jiménez,Suárez,Cárdenas,Quintero,Peña,Mejía,Salazar,Bermúdez,Zapata,Arango,Cifuentes,Guerrero,Ospina,Betancur,Valencia,Restrepo,Céspedes".split(",");
const CIUDADES = [
  ["Bogotá", 0.42],
  ["Medellín", 0.19],
  ["Cali", 0.12],
  ["Barranquilla", 0.08],
  ["Bucaramanga", 0.06],
  ["Cartagena", 0.05],
  ["Pereira", 0.05],
  ["Manizales", 0.03],
];
const DOMINIOS = [
  ["gmail.com", 0.62],
  ["hotmail.com", 0.16],
  ["outlook.com", 0.11],
  ["yahoo.com", 0.05],
  ["icloud.com", 0.04],
  ["proton.me", 0.02],
];
const VENUES = {
  "Bogotá": ["Teatro Colsubsidio", "Casa E", "Teatro Nacional Fanny Mikey", "Ace of Clubs", "La Bodega del Chiste"],
  "Medellín": ["Teatro Metropolitano", "Casa Teatro El Poblado", "La Pascasia"],
  "Cali": ["Teatro Jorge Isaacs", "Sala Beethoven"],
  "Barranquilla": ["Teatro Amira de la Rosa"],
  "Bucaramanga": ["Teatro Corfescu"],
  "Cartagena": ["Teatro Adolfo Mejía"],
  "Pereira": ["Teatro Santiago Londoño"],
  "Manizales": ["Teatro Los Fundadores"],
};

// Actos, no personas: el dataset es sintético y no debe parecerse a nadie real.
// `dia` = residencia fija (0 domingo … 6 sábado). Sin `dia` = gira, fechas sueltas.
// El acto que jala no necesita regalar entradas; el que no jala empapela la
// sala de invitados. Por eso las cortesías salen del tirón y no son ruido:
// un acto se comporta parecido en julio y en agosto, y ahí está la señal.
const compsDe = (tiro) => clamp(0.62 - 0.6 * tiro, 0.04, 0.6);

const ARTISTAS = [
  { nombre: "Mala Hora", ciudad: "Bogotá", venue: "Casa E", dia: 5, tiro: 0.9, fidelidad: 0.12 },
  { nombre: "Micrófono Suelto", ciudad: "Bogotá", venue: "Ace of Clubs", dia: 2, tiro: 0.45, fidelidad: -0.1 },
  { nombre: "Doble Sentido", ciudad: "Medellín", venue: "La Pascasia", dia: 4, tiro: 0.7, fidelidad: 0.06 },
  { nombre: "La Bodega Improvisa", ciudad: "Bogotá", venue: "La Bodega del Chiste", dia: 3, tiro: 0.55, fidelidad: 0.02 },
  { nombre: "Trasnoche Cali", ciudad: "Cali", venue: "Sala Beethoven", dia: 6, tiro: 0.6, fidelidad: 0.08 },
  { nombre: "Sin Filtro", ciudad: "Bogotá", tiro: 0.95, fidelidad: 0.15 },
  { nombre: "Cuento Corto", ciudad: "Medellín", tiro: 0.5, fidelidad: 0.0 },
  { nombre: "Los del Fondo", ciudad: "Cali", tiro: 0.4, fidelidad: -0.05 },
  { nombre: "Roast de Medianoche", ciudad: "Bogotá", tiro: 0.75, fidelidad: 0.04 },
  { nombre: "Tres Sillas", ciudad: "Barranquilla", tiro: 0.45, fidelidad: -0.02 },
  { nombre: "Comedia de Barrio", ciudad: "Bucaramanga", tiro: 0.35, fidelidad: -0.08 },
  { nombre: "Segunda Función", ciudad: "Pereira", tiro: 0.3, fidelidad: -0.03 },
  { nombre: "El Recreo", ciudad: "Cartagena", tiro: 0.4, fidelidad: 0.01 },
  { nombre: "Últimas Filas", ciudad: "Manizales", tiro: 0.28, fidelidad: -0.06 },
];

const TITULOS_SUELTOS = [
  "Material Nuevo",
  "Especial de Improvisación",
  "Show de Temporada",
  "Función Única",
  "Comedia sin Red",
  "Sesión Doble",
  "Cierre de Gira",
];

const weighted = (pairs) => {
  let r = rnd();
  for (const [v, w] of pairs) {
    r -= w;
    if (r <= 0) return v;
  }
  return pairs[pairs.length - 1][0];
};

const sinTildes = (s) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "");

// ------------------------------------------------------------------- ruido

function ensuciarEmail(email) {
  const [local, dom] = email.split("@");
  const r = rnd();
  if (r < 0.55) return email; // limpio
  if (r < 0.66) return `${local}+${pick(["eventos", "compras", "boletas", "spam"])}@${dom}`;
  if (r < 0.76) return `${local}@${dom.replace("gmail", "gmial").replace("hotmail", "hotmial").replace("outlook", "outlok")}`;
  if (r < 0.85) {
    const i = int(1, Math.max(1, local.length - 2));
    return `${local.slice(0, i)}${local.slice(i + 1)}@${dom}`; // typo: falta una letra
  }
  if (r < 0.93) return `${local}@${weighted(DOMINIOS)}`; // mismo local, otro dominio
  return email.toUpperCase();
}

function formatearTelefono(base) {
  switch (int(0, 4)) {
    case 0: return base;
    case 1: return `${base.slice(0, 3)} ${base.slice(3, 6)} ${base.slice(6)}`;
    case 2: return `+57 ${base.slice(0, 3)} ${base.slice(3)}`;
    case 3: return `(+57) ${base.slice(0, 3)}-${base.slice(3, 6)}-${base.slice(6)}`;
    default: return `57${base}`;
  }
}

function ensuciarNombre(first, last) {
  const r = rnd();
  if (r < 0.5) return `${first} ${last}`;
  if (r < 0.62) return sinTildes(`${first} ${last}`);
  if (r < 0.72) return `${first} ${last}`.toLowerCase();
  if (r < 0.8) return `${last} ${first}`; // apellido primero
  if (r < 0.88) return `${first} ${last} ${pick(APELLIDOS)}`; // segundo apellido que Boom no tiene
  if (r < 0.94) return `${first[0]}. ${last}`;
  return `${first} ${last}`.toUpperCase();
}

// ------------------------------------------------------------------ 1. usuarios

const users = [];
const emailsUsados = new Set();

for (let i = 0; i < N_USERS; i++) {
  const fem = chance(0.48);
  const first = pick(fem ? NOMBRES_F : NOMBRES_M);
  const last = pick(APELLIDOS);
  const ciudad = weighted(CIUDADES);
  const dom = weighted(DOMINIOS);

  let local = `${sinTildes(first).toLowerCase()}.${sinTildes(last).toLowerCase()}`;
  if (chance(0.4)) local += int(1, 99);
  let email = `${local}@${dom}`;
  while (emailsUsados.has(email)) email = `${local}${int(100, 999)}@${dom}`;
  emailsUsados.add(email);

  // Antigüedad: la base creció más fuerte en los últimos 18 meses.
  const antiguedadDias = Math.round(bell(15, 1500) ** 0.85);
  const created = new Date(HOY - antiguedadDias * DAY);

  const tieneMembresia = chance(0.22);
  const membershipSince = tieneMembresia
    ? new Date(+created + int(0, Math.max(1, antiguedadDias - 10)) * DAY)
    : null;

  // Confiabilidad latente: dónde cae esta persona dentro de la banda de su
  // tipo de entrada. Es lo que el participante tiene que inferir del historial.
  // Distribución ancha a propósito: si todos se parecen, el cruce no paga y
  // saber QUIÉN compró deja de importar.
  let fiabilidad = clamp(0.04 + rnd() * 0.94, 0.04, 0.98);
  if (tieneMembresia) fiabilidad = clamp(fiabilidad + 0.08, 0.04, 0.98);

  users.push({
    boom_user_id: `bm_usr_${pad(i + 1, 6)}`,
    first_name: first,
    last_name: last,
    email,
    phone: `3${pick([0, 1, 2])}${int(0, 9)}${pad(int(0, 9999999), 7)}`.slice(0, 10),
    city: ciudad,
    country: "CO",
    birthday: new Date(Date.UTC(int(1972, 2006), int(0, 11), int(1, 28))).toISOString().slice(0, 10),
    created_at: iso(created),
    has_membership: tieneMembresia,
    membership_since: membershipSince ? iso(membershipSince) : "",
    _fiabilidad: fiabilidad,
    _antiguedadDias: antiguedadDias,
  });
}

// ------------------------------------------- 2. historial de tickets en Boom

const boomTickets = [];
const BOOM_EVENTS = 60;
let btN = 0;

// Bandas de asistencia por tipo de ticket, tomadas del comportamiento real.
// La fiabilidad de la persona mueve dentro de la banda; el tipo pone el techo.
//   membresía        entra como mucho el 60%: no dolió nada, se pierde sin culpa
//   consumo mínimo   hay plata comprometida en la puerta, se honra bastante más
// Techos reales por tipo de entrada. Valen igual en las dos plataformas: lo que
// manda es si hubo plata de por medio, no en qué sistema se emitió el ticket.
//   entrada pagada   ~95%: se honra casi siempre
//   membresía        60% como mucho; la cortesía se comporta igual
const BANDA = {
  membresia: [0.22, 0.60],
  consumo_minimo: [0.55, 0.88],
};
const dentroDe = ([min, max], fiabilidad) => min + (max - min) * fiabilidad;

for (const u of users) {
  // Cuántos tickets sacó en Boom: más antigüedad y membresía → más historia.
  const base = (u._antiguedadDias / 1500) * 14 + (u.has_membership ? 6 : 0);
  const n = Math.max(0, Math.round(base * bell(0.3, 1.6)));
  let usados = 0;
  // v2 no deja adquirir más de dos entradas por usuario para el mismo evento.
  const porEvento = new Map();

  for (let t = 0; t < n; t++) {
    let eventoId = `bm_evt_${pad(int(1, BOOM_EVENTS), 4)}`;
    let intentos = 0;
    while ((porEvento.get(eventoId) ?? 0) >= 2 && intentos++ < 8) {
      eventoId = `bm_evt_${pad(int(1, BOOM_EVENTS), 4)}`;
    }
    if ((porEvento.get(eventoId) ?? 0) >= 2) continue; // el cupo del usuario se llenó
    porEvento.set(eventoId, (porEvento.get(eventoId) ?? 0) + 1);

    const diasAtras = int(5, Math.min(u._antiguedadDias, 900));
    const created = new Date(HOY - diasAtras * DAY);
    // Quien tiene membresía la usa; el resto entra por consumo mínimo.
    const type = u.has_membership && chance(0.75) ? "membresia" : "consumo_minimo";
    const source = pick(["app", "app", "web", "referral", "box_office"]);

    let p = dentroDe(BANDA[type], u._fiabilidad);
    // Quien va a la taquilla el mismo día ya salió de la casa.
    if (source === "box_office") p = clamp(p + 0.12, 0, BANDA[type][1] + 0.05);
    const used = chance(clamp(p, 0, 0.99));
    if (used) usados++;

    // Entrada real: entre 45 min antes y 20 min después de la hora del show.
    const dateUsed = used ? new Date(+created + int(1, 30) * DAY + int(-45, 20) * 60000) : null;

    boomTickets.push({
      boom_ticket_id: `bm_tkt_${pad(++btN, 7)}`,
      boom_user_id: u.boom_user_id,
      event_id: eventoId,
      type,
      source,
      created_at: iso(created),
      used: used ? "true" : "false",
      date_used: dateUsed ? iso(dateUsed) : "",
    });
  }
  u._ticketsBoom = n;
  u._usadosBoom = usados;
  // Los puntos siguen la asistencia, no la compra: es la señal honesta.
  u.points = usados * 10 + (u.has_membership ? 150 : 0) + int(0, 40);
}

// --------------------------------------------------------------- 3. social

const boomSocial = users.map((u) => ({
  boom_user_id: u.boom_user_id,
  // Quien va a los shows conoce gente en los shows.
  friends_count: Math.max(0, Math.round((u._usadosBoom * bell(0.2, 1.4)) + bell(-2, 6))),
}));

// --------------------------------------------------------------- 4. artistas

const artistas = ARTISTAS.map((a, i) => ({
  artist_id: `ft_art_${pad(i + 1, 3)}`,
  name: a.nombre,
  home_city: a.ciudad,
  residency_venue: a.dia === undefined ? "" : a.venue,
  residency_weekday: a.dia === undefined ? "" : DIAS[a.dia],
  _dia: a.dia,
  _venue: a.venue,
  _tiro: a.tiro,
  _fidelidad: a.fidelidad,
  _comps: compsDe(a.tiro),
}));

// ---------------------------------------------------------------- 5. eventos

const events = [];
let evN = 0;

const nuevoEvento = ({ artista, fecha, ciudad, venue, titulo, residencia }) => {
  const cap = residencia ? pick([120, 150, 180, 220, 250]) : pick([250, 320, 450, 600, 800, 1200]);
  const starts = new Date(fecha);
  starts.setUTCHours(residencia ? 20 : int(19, 21), pick([0, 30]), 0, 0);
  const ev = {
    event_id: `ft_evt_${pad(++evN, 4)}`,
    title: titulo,
    artist_id: artista.artist_id,
    artist_name: artista.name,
    city: ciudad,
    venue,
    capacity: cap,
    starts_at: iso(starts),
    weekday: DIAS[starts.getUTCDay()],
    is_residency: residencia ? "true" : "false",
    is_paid: residencia ? (chance(0.9) ? "true" : "false") : chance(0.85) ? "true" : "false",
    _starts: starts,
    _pasado: starts < HOY,
    _artista: artista,
    // Carácter del público. Es sobre todo del ACTO, no de la función: una
    // residencia convoca a la misma gente todas las semanas, que es justo lo
    // que hace que julio sirva para proyectar agosto. Lo que queda es el
    // ruido de la noche.
    _tilt: clamp(artista._fidelidad * 5 + bell(-0.3, 0.3), -1, 1),
    _enBoom: clamp(bell(0.25, 0.85) + artista._tiro * 0.15, 0.15, 0.92),
    // Qué proporción del show se regala (RRPP, prensa, invitados del artista).
    // Es lo que más mueve la asistencia: la pagada casi siempre entra, la
    // cortesía no. Y es un rasgo del ACTO, no ruido de la función: hay quien
    // llena de invitados todas las semanas y quien vende cada silla. Por eso
    // julio dice algo de agosto.
    _cortesias: clamp(artista._comps + bell(-0.06, 0.06), 0.02, 0.62),
  };
  events.push(ev);
  return ev;
};

// 5a. Residencias: toda ocurrencia de su día, de julio a fin de agosto.
for (const a of artistas.filter((x) => x._dia !== undefined)) {
  for (let d = new Date("2026-07-01T00:00:00Z"); d <= new Date("2026-08-31T00:00:00Z"); d = new Date(+d + DAY)) {
    if (d.getUTCDay() !== a._dia) continue;
    nuevoEvento({
      artista: a,
      fecha: d,
      ciudad: a.home_city,
      venue: a._venue,
      titulo: `${a.name} — residencia ${DIAS[a._dia]}`,
      residencia: true,
    });
  }
}

// 5b. Fechas sueltas repartidas entre julio y agosto.
const sueltos = artistas.filter((x) => x._dia === undefined);
for (let i = 0; i < N_ONEOFFS; i++) {
  const a = pick(sueltos);
  const ciudad = chance(0.7) ? a.home_city : weighted(CIUDADES);
  // Mitad en julio (ya pasaron), mitad en agosto (por proyectar).
  const base = i % 2 === 0 ? new Date("2026-07-01T00:00:00Z") : new Date("2026-08-02T00:00:00Z");
  const fecha = new Date(+base + int(0, i % 2 === 0 ? 30 : 29) * DAY);
  nuevoEvento({
    artista: a,
    fecha,
    ciudad,
    venue: pick(VENUES[ciudad]),
    titulo: `${a.name} — ${pick(TITULOS_SUELTOS)}`,
    residencia: false,
  });
}

events.sort((a, b) => a._starts - b._starts);

// ------------------------------------------------------- 6. ventas y tickets

const sales = [];
const ftTickets = [];
const matches = [];
const asistenciaPorEvento = new Map();

const TIPOS = [
  ["General", 45000],
  ["General", 60000],
  ["Preferencial", 95000],
  ["VIP", 140000],
  ["Cortesía", 0],
];
const CANALES = [
  ["WEB", 0.78],
  ["BOX_OFFICE", 0.13],
  ["ADMIN", 0.06],
  ["RRPP", 0.03],
];

let saleN = 0;
let tktN = 0;

for (const ev of events) {
  const a = ev._artista;
  // Llenado final del aforo: el tirón del artista manda.
  const llenadoFinal = clamp(bell(0.3, 0.85) + a._tiro * 0.35, 0.18, 1);
  const diasParaEvento = Math.round((ev._starts - HOY) / DAY);

  // Un evento pasado ya vendió todo lo que iba a vender. Uno futuro lleva
  // vendida solo una fracción, y entre más lejos, menos.
  const avance = ev._pasado ? 1 : clamp(1 - diasParaEvento / 42, 0.12, 0.95);
  const vendidos = Math.max(4, Math.round(ev.capacity * llenadoFinal * avance));

  let restantes = vendidos;
  let asistieron = 0;
  const ticketsDelEvento = [];

  while (restantes > 0) {
    const qty = Math.min(restantes, weighted([[1, 0.46], [2, 0.34], [3, 0.1], [4, 0.07], [6, 0.03]]));
    restantes -= qty;
    saleN++;
    const saleId = `ft_sal_${pad(saleN, 6)}`;

    // ¿El comprador ya existía en Boom? Depende del show.
    // Torneo de k candidatos: entre más marcado el tilt, más se inclina el
    // público del evento hacia los fieles (o hacia los tibios).
    let u = null;
    if (chance(ev._enBoom)) {
      const k = 1 + Math.round(Math.abs(ev._tilt) * 6);
      u = pick(users);
      for (let c = 1; c < k; c++) {
        const otro = pick(users);
        const mejor = ev._tilt >= 0 ? otro._fiabilidad > u._fiabilidad : otro._fiabilidad < u._fiabilidad;
        if (mejor) u = otro;
      }
    }

    const [tipo, precioBase] = ev.is_paid === "true"
      ? (chance(ev._cortesias)
          ? TIPOS[4]
          : weighted([[TIPOS[0], 0.37], [TIPOS[1], 0.28], [TIPOS[2], 0.22], [TIPOS[3], 0.13]]))
      : TIPOS[4];
    const unitPrice = tipo === "Cortesía" ? 0 : Math.round((precioBase * clamp(bell(0.85, 1.15), 0.7, 1.3)) / 1000) * 1000;

    const canal = weighted(CANALES);
    const humorVenta = bell(0.92, 1.08); // el ánimo del grupo el día del show
    // Anticipación de compra: cola larga, mucha gente compra sobre la hora.
    // En los eventos de agosto la compra no puede ser posterior a hoy.
    let diasAntes = canal === "BOX_OFFICE" && ev._pasado ? 0 : Math.round(bell(0, 60) ** 1.4 / 12);
    if (!ev._pasado) diasAntes = Math.max(diasAntes, diasParaEvento);
    const purchased = new Date(+ev._starts - diasAntes * DAY - int(0, 20) * 3600000);

    let nombre, email, telefono;
    if (u) {
      nombre = ensuciarNombre(u.first_name, u.last_name);
      // 6% compra con el correo de otra persona (la pareja, un amigo).
      email = chance(0.06) ? pick(users).email : ensuciarEmail(u.email);
      // El teléfono tampoco es una llave limpia: se digita mal, y hay quien deja
      // el del hermano o el de la pareja.
      const r = rnd();
      if (r < 0.08) telefono = "";
      else if (r < 0.14) telefono = formatearTelefono(pick(users).phone);
      else if (r < 0.24) {
        const d = u.phone.split("");
        const i = int(3, 8);
        [d[i], d[i + 1]] = [d[i + 1], d[i]]; // dos dígitos cambiados de orden
        telefono = formatearTelefono(d.join(""));
      } else telefono = formatearTelefono(u.phone);
      matches.push({ sale_id: saleId, boom_user_id: u.boom_user_id });
    } else {
      const fem = chance(0.5);
      const f = pick(fem ? NOMBRES_F : NOMBRES_M);
      const l = pick(APELLIDOS);
      nombre = ensuciarNombre(f, l);
      email = `${sinTildes(f).toLowerCase()}${sinTildes(l).toLowerCase()}${int(1, 999)}@${weighted(DOMINIOS)}`;
      telefono = chance(0.12) ? "" : formatearTelefono(`3${int(0, 2)}${int(0, 9)}${pad(int(0, 9999999), 7)}`.slice(0, 10));
    }

    // Probabilidad real de que cada entrada de esta venta cruce la puerta.
    // La banda la pone el tipo de entrada; la persona mueve dentro de la banda.
    //   pagada     ~95%: hubo plata de por medio y la gente va
    //   cortesía   no dolió nada; se comporta como una entrada de membresía
    // El contexto mueve a la persona DENTRO de la banda de su tipo de entrada;
    // nunca la saca. Si multiplicara sobre la probabilidad final, una entrada
    // pagada podría terminar por debajo del techo de una cortesía, que es
    // justo lo que el negocio dice que no pasa.
    let f = u ? u._fiabilidad : clamp(bell(0.2, 0.9) + ev._tilt * 0.18, 0.05, 0.95);
    if (canal === "BOX_OFFICE") f += 0.25;                 // ya salió de la casa
    if (canal === "RRPP") f -= 0.15;
    if (diasAntes > 30) f -= 0.08;                         // comprar con mucha anticipación enfría
    if (qty >= 3) f -= 0.06;                               // el grupo grande pierde a alguien
    if (u && u.city !== ev.city) f -= 0.28;                // de otra ciudad
    f = clamp(f + a._fidelidad + (humorVenta - 1), 0, 1);  // el público del artista y el día
    const banda = unitPrice === 0 ? BANDA.membresia : [0.88, 0.995];
    const p = banda[0] + (banda[1] - banda[0]) * f;

    let entraron = 0;
    for (let k = 0; k < qty; k++) {
      const entra = chance(clamp(p, 0.01, 0.99));
      if (entra) entraron++;
      // Entrada real: entre 50 min antes y 25 después de la hora del show.
      const cuando = entra ? new Date(+ev._starts + int(-50, 25) * 60000) : null;
      ticketsDelEvento.push({
        ticket_id: `ft_tkt_${pad(++tktN, 7)}`,
        sale_id: saleId,
        event_id: ev.event_id,
        ticket_type: tipo,
        price: unitPrice,
        // El check-in solo existe para lo que ya pasó. Julio lo tiene, agosto no.
        checked_in: ev._pasado ? (entra ? "true" : "false") : "",
        checked_in_at: ev._pasado && cuando ? iso(cuando) : "",
        _entra: entra,
      });
    }
    asistieron += entraron;

    sales.push({
      sale_id: saleId,
      event_id: ev.event_id,
      buyer_name: nombre,
      buyer_email: email,
      buyer_phone: telefono,
      qty,
      subtotal: unitPrice * qty,
      channel: canal,
      purchased_at: iso(purchased),
    });
  }

  ftTickets.push(...ticketsDelEvento);
  asistenciaPorEvento.set(ev.event_id, {
    vendidos: ticketsDelEvento.length,
    asistieron,
    pasado: ev._pasado,
  });
}

// ------------------------------------------------------------------ escritura

const csv = (rows) => {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]).filter((c) => !c.startsWith("_"));
  const esc = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n") + "\n";
};

const write = (dir, name, rows) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), csv(rows));
  console.log(`  ${join(dir, name)}  ${rows.length} filas`);
};

console.log(`seed=${SEED} usuarios=${N_USERS} eventos=${events.length} (${events.filter((e) => e._pasado).length} de julio, ${events.filter((e) => !e._pasado).length} de agosto)`);

write(join(OUT, "boom"), "users.csv", users);
write(join(OUT, "boom"), "tickets.csv", boomTickets);
write(join(OUT, "boom"), "social.csv", boomSocial);

write(join(OUT, "freeticket"), "artists.csv", artistas);
write(join(OUT, "freeticket"), "events.csv", events);
write(join(OUT, "freeticket"), "sales.csv", sales);
write(join(OUT, "freeticket"), "tickets.csv", ftTickets);

// El ground truth vive DENTRO de --out: si no, regenerar en otra carpeta pisa
// el truth del dataset oficial. Se publica data/boom y data/freeticket, nunca _truth.
const TRUTH = join(OUT, "_truth");
write(TRUTH, "matches.csv", matches);
write(
  TRUTH,
  "attendance.csv",
  events.map((e) => {
    const a = asistenciaPorEvento.get(e.event_id);
    return {
      event_id: e.event_id,
      artist_name: e.artist_name,
      starts_at: e.starts_at,
      mes: e._pasado ? "julio" : "agosto",
      tickets_adquiridos: a.vendidos,
      asistencia_real: a.asistieron,
      tasa: (a.asistieron / a.vendidos).toFixed(4),
    };
  }),
);
// Verdad a nivel ticket para los eventos de agosto: sirve para revisar una demo
// ticket por ticket, no solo el agregado.
write(
  TRUTH,
  "agosto_tickets.csv",
  ftTickets
    .filter((t) => t.checked_in === "")
    .map((t) => ({ ticket_id: t.ticket_id, event_id: t.event_id, entra: t._entra ? "true" : "false" })),
);

const julio = events.filter((e) => e._pasado).map((e) => asistenciaPorEvento.get(e.event_id));
const agosto = events.filter((e) => !e._pasado).map((e) => asistenciaPorEvento.get(e.event_id));
const tasa = (xs) => xs.reduce((s, a) => s + a.asistieron, 0) / xs.reduce((s, a) => s + a.vendidos, 0);
console.log(`\njulio  — ${julio.length} shows · ${julio.reduce((s, a) => s + a.vendidos, 0)} tickets · asistencia ${(tasa(julio) * 100).toFixed(1)}%`);
console.log(`agosto — ${agosto.length} shows · ${agosto.reduce((s, a) => s + a.vendidos, 0)} tickets adquiridos · asistencia real ${(tasa(agosto) * 100).toFixed(1)}% (a proyectar)`);
console.log(`compradores con match en Boom: ${((matches.length / sales.length) * 100).toFixed(1)}%`);
console.log(`\n${TRUTH}/ NO se publica — está en .gitignore.`);
