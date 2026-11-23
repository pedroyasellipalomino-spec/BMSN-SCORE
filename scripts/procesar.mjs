// BMSN — procesa un issue de GitHub y actualiza los JSON de /data.
// Se ejecuta desde .github/workflows/procesar.yml. Sin dependencias.
// Escribe el mensaje de respuesta en respuesta.md y "cambio=si|no" en $GITHUB_OUTPUT.

import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const DATA = new URL("../data/", import.meta.url);
const leer = (n) => JSON.parse(readFileSync(new URL(`${n}.json`, DATA), "utf8"));
const guardar = (n, v) => writeFileSync(new URL(`${n}.json`, DATA), JSON.stringify(v, null, 2) + "\n");

function salir(mensaje, cambio) {
  writeFileSync("respuesta.md", mensaje + "\n");
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `cambio=${cambio ? "si" : "no"}\n`);
  console.log(mensaje);
  process.exit(0);
}
const rechazar = (m) => salir(`❌ **No se guardó.** ${m}`, false);

const evento = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
const issue = evento.issue;
const autor = String(issue.user.login);
const autorLc = autor.toLowerCase();
const duenio = String(evento.repository?.owner?.login ?? "").toLowerCase();

// Solo cuentas de usuario reales (no bots).
if (issue.user.type !== "User") rechazar("Solo se aceptan cuentas de usuario de GitHub.");

const bloque = /```json\s*([\s\S]*?)```/.exec(issue.body ?? "");
if (!bloque) salir("ℹ️ Este issue no contiene datos de BMSN; se ignora.", false);
let d;
try { d = JSON.parse(bloque[1]); } catch { rechazar("El bloque JSON no es válido."); }
if (!d || d.bmsn !== 1 || typeof d.tipo !== "string") rechazar("Formato no reconocido.");

const config = leer("config");
const personas = leer("personas");
const planes = leer("planes");
const encuestas = leer("encuestas");
const votos = leer("votos");

const esAdmin = autorLc === duenio || (config.admins ?? []).some((a) => a.toLowerCase() === autorLc);
const soloAdmin = () => { if (!esAdmin) rechazar(`@${autor} no es admin. Añádelo en \`data/config.json\` → \`admins\`.`); };

const texto = (v, max, campo, opcional = false) => {
  if (v == null || v === "") { if (opcional) return ""; rechazar(`Falta \`${campo}\`.`); }
  if (typeof v !== "string") rechazar(`\`${campo}\` debe ser texto.`);
  const t = v.trim().replace(/\s+/g, " ");
  if (!t && !opcional) rechazar(`Falta \`${campo}\`.`);
  if (t.length > max) rechazar(`\`${campo}\` supera ${max} caracteres.`);
  return t;
};
const idPersona = (id) => {
  if (!personas.some((p) => p.id === id)) rechazar(`La persona \`${String(id).slice(0, 40)}\` no existe.`);
  return id;
};
const nuevoId = () => randomUUID().slice(0, 8);

function mesActual() {
  const tz = config.zonaHoraria || "America/Lima";
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit" }).formatToParts(new Date());
  return `${p.find((x) => x.type === "year").value}-${p.find((x) => x.type === "month").value}`;
}

switch (d.tipo) {
  case "persona": {
    soloAdmin();
    const nombre = texto(d.nombre, 40, "nombre");
    const github = d.github ? texto(d.github, 39, "github").replace(/^@/, "") : null;
    if (github && !/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(github)) rechazar("Usuario de GitHub no válido.");
    if (personas.some((p) => p.nombre.toLowerCase() === nombre.toLowerCase())) rechazar(`Ya existe una persona llamada **${nombre}**.`);
    if (github && personas.some((p) => p.github?.toLowerCase() === github.toLowerCase())) rechazar(`@${github} ya está asignado a otra persona.`);
    personas.push({ id: nuevoId(), nombre, github, creadoPor: autor });
    guardar("personas", personas);
    salir(`✅ Persona **${nombre}** añadida${github ? ` (vota como @${github})` : ""}.`, true);
  }

  case "plan": {
    soloAdmin();
    const fecha = texto(d.fecha, 10, "fecha");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || isNaN(Date.parse(fecha))) rechazar("Fecha no válida (AAAA-MM-DD).");
    const titulo = texto(d.titulo, 80, "titulo");
    const notas = texto(d.notas, 200, "notas", true);
    if (!Array.isArray(d.asistentes) || !d.asistentes.length) rechazar("Debe haber al menos un asistente.");
    const asistentes = [...new Set(d.asistentes.map(idPersona))];
    const anfitrion = d.anfitrion ? idPersona(d.anfitrion) : null;
    if (anfitrion && !asistentes.includes(anfitrion)) asistentes.push(anfitrion);
    planes.push({ id: nuevoId(), fecha, titulo, anfitrion, asistentes, notas, registradoPor: autor, issue: issue.number });
    planes.sort((a, b) => a.fecha.localeCompare(b.fecha));
    guardar("planes", planes);
    const casa = anfitrion ? ` Puso casa: **${personas.find((p) => p.id === anfitrion).nombre}**.` : "";
    salir(`✅ Plan **${titulo}** (${fecha}) anotado con ${asistentes.length} asistentes.${casa}`, true);
  }

  case "borrar-plan": {
    soloAdmin();
    const i = planes.findIndex((p) => p.id === d.id);
    if (i < 0) rechazar("Ese plan no existe.");
    const [p] = planes.splice(i, 1);
    guardar("planes", planes);
    salir(`🗑️ Plan **${p.titulo}** (${p.fecha}) borrado.`, true);
  }

  case "encuesta": {
    soloAdmin();
    const mes = texto(d.mes, 7, "mes");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) rechazar("Mes no válido (AAAA-MM).");
    if (encuestas.some((e) => e.id === mes)) rechazar(`Ya hay una encuesta para ${mes}.`);
    const pregunta = texto(d.pregunta, 120, "pregunta");
    if (!Array.isArray(d.opciones)) rechazar("Faltan opciones.");
    const opciones = [...new Set(d.opciones.map((o) => texto(o, 60, "opción")))];
    if (opciones.length < 2 || opciones.length > 30) rechazar("La encuesta necesita entre 2 y 30 opciones.");
    encuestas.push({ id: mes, mes, pregunta, opciones, creadaPor: autor });
    guardar("encuestas", encuestas);
    salir(`✅ Encuesta de **${mes}** creada: _${pregunta}_`, true);
  }

  case "voto": {
    const e = encuestas.find((x) => x.id === d.encuesta);
    if (!e) rechazar("Esa encuesta no existe.");
    if (e.mes !== mesActual()) rechazar(`La encuesta de ${e.mes} no está abierta (mes actual: ${mesActual()}).`);
    const persona = personas.find((p) => p.github?.toLowerCase() === autorLc);
    if (!persona) rechazar(`@${autor} no está registrado en BMSN. Un admin debe añadirte en *Personas* con tu usuario de GitHub.`);
    if (!e.opciones.includes(d.opcion)) rechazar("Opción no válida.");
    votos[e.id] ??= {};
    const previo = votos[e.id][autorLc];
    votos[e.id][autorLc] = { opcion: d.opcion, persona: persona.id, fecha: new Date().toISOString(), issue: issue.number };
    guardar("votos", votos);
    salir(previo
      ? `🔁 Voto de **${persona.nombre}** actualizado: _${previo.opcion}_ → **${d.opcion}**.`
      : `🗳️ Voto de **${persona.nombre}** registrado: **${d.opcion}**.`, true);
  }

  default:
    rechazar(`Tipo \`${String(d.tipo).slice(0, 30)}\` desconocido.`);
}
