/* BMSN — app móvil sobre Supabase. Añade ?demo a la URL para probar con datos inventados. */
(() => {
  "use strict";

  // ---------- Utilidades ----------
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
  const TZ = "America/Lima"; // igual que bmsn_mes_actual() en supabase/esquema.sql
  const hoy = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  const mesActual = () => hoy().slice(0, 7);
  const sumarDias = (f, n) => { const d = new Date(f + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const nombreMes = (m) => `${MESES[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
  const diaSemana = (f) => DIAS[new Date(f + "T12:00:00Z").getUTCDay()];
  const fechaCorta = (f) => `${+f.slice(8)} ${MESES[+f.slice(5, 7) - 1].slice(0, 3)}`;
  const pct = (x) => (isFinite(x) ? Math.round(x * 100) + "%" : "—");
  const dec = (x) => (isFinite(x) ? (Math.round(x * 10) / 10).toString().replace(".", ",") : "—");
  const iniciales = (n) => n.trim().split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
  const tono = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const avatar = (p, cls = "") => (p ? `<span class="av ${cls}" style="--h:${tono(p.nombre)}">${esc(iniciales(p.nombre))}</span>` : "");
  const ICON = {
    cerrar: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    izq: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
    der: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
  };

  let toastTimer;
  function toast(msg, error = false) {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast ver" + (error ? " error" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.className = "toast"), error ? 4200 : 2400);
  }
  const msgError = (e) => {
    const m = e?.message || String(e);
    if (/permission denied/i.test(m)) return "Sin permiso en la base de datos (faltan los GRANT del esquema).";
    if (/duplicate key.*nombre/i.test(m)) return "Ya existe alguien con ese nombre.";
    if (/rate limit/i.test(m)) return "Demasiados correos seguidos. Espera unos minutos.";
    return m;
  };

  // ---------- Estado ----------
  const S = {
    personas: [], planes: [], encuestas: [], resultados: [], misVotos: {}, votosAdmin: [],
    user: null, admin: false, cargado: false, errorCarga: null,
    periodo: { tipo: "anio", valor: hoy().slice(0, 4) },
    metrica: "asistencia",
  };

  // ---------- Capa de datos ----------
  const DEMO = new URLSearchParams(location.search).has("demo");
  const api = DEMO ? crearDemo() : crearSupabase();

  function crearSupabase() {
    const cfg = window.BMSN_CONFIG || {};
    if (!cfg.supabaseUrl || !cfg.supabaseKey || !window.supabase) return null;
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
    const q = async (p) => { const { data, error } = await p; if (error) throw error; return data; };
    return {
      async cargar() {
        const [personas, planes, asist, encuestas, resultados] = await Promise.all([
          q(sb.from("personas").select("id,nombre").order("nombre")),
          q(sb.from("planes").select("id,fecha,titulo,anfitrion,notas").order("fecha", { ascending: false }).order("creado", { ascending: false })),
          q(sb.from("asistencias").select("plan_id,persona_id")),
          q(sb.from("encuestas").select("id,mes,pregunta,opciones,creado").order("mes", { ascending: false }).order("creado", { ascending: false })),
          q(sb.rpc("resultados")),
        ]);
        const votos = S.user ? await q(sb.from("votos").select("encuesta_id,user_id,email,opcion")) : [];
        return { personas, planes, asist, encuestas, resultados, votos };
      },
      reclamarAdmin: () => q(sb.rpc("reclamar_admin")),
      guardarPlan: (p) => q(sb.rpc("guardar_plan", { p_id: p.id || null, p_fecha: p.fecha, p_titulo: p.titulo, p_anfitrion: p.anfitrion, p_asistentes: p.asistentes, p_notas: p.notas || "" })),
      borrarPlan: (id) => q(sb.from("planes").delete().eq("id", id)),
      crearPersona: (nombre) => q(sb.from("personas").insert({ nombre })),
      renombrarPersona: (id, nombre) => q(sb.from("personas").update({ nombre }).eq("id", id)),
      borrarPersona: (id) => q(sb.from("personas").delete().eq("id", id)),
      crearEncuesta: (e) => q(sb.from("encuestas").insert(e)),
      borrarEncuesta: (id) => q(sb.from("encuestas").delete().eq("id", id)),
      votar: (id, opcion) => q(sb.rpc("votar", { p_encuesta: id, p_opcion: opcion })),
      entrar: async (email) => { const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } }); if (error) throw error; },
      salir: () => sb.auth.signOut(),
      alCambiarSesion: (fn) => sb.auth.onAuthStateChange((ev, s) => setTimeout(() => fn(s?.user ?? null), 0)),
    };
  }

  function crearDemo() {
    const uid = () => Math.random().toString(36).slice(2, 10);
    const personas = ["Ana", "Luis", "Pedro", "Camila", "Diego", "Valeria", "Mateo", "Sofía"].map((n) => ({ id: uid(), nombre: n }));
    const titulos = ["Asado", "Noche de pelis", "Cumple", "Juegos de mesa", "Fútbol", "Karaoke", "Cena", "Playa"];
    const planes = [], asist = [];
    let f = hoy();
    for (let i = 0; i < 26; i++) {
      f = sumarDias(f, -(3 + (i * 7) % 9));
      const id = uid();
      const van = personas.filter((p, j) => (i + j * 3) % 5 !== 0 && (j + i) % 7 !== 3);
      planes.push({ id, fecha: f, titulo: titulos[i % titulos.length], anfitrion: i % 4 === 3 ? null : van[(i * 5) % van.length].id, notas: "" });
      van.forEach((p) => asist.push({ plan_id: id, persona_id: p.id }));
    }
    const m = mesActual(), ant = sumarDias(m + "-01", -1).slice(0, 7);
    const encuestas = [
      { id: "e1", mes: m, pregunta: "¿Cuál fue el mejor plan del mes?", opciones: ["Asado", "Karaoke", "Noche de pelis", "Playa"] },
      { id: "e2", mes: ant, pregunta: "¿Quién fue el mejor anfitrión?", opciones: ["Ana", "Luis", "Camila"] },
    ];
    const votos = { e1: { Asado: 4, Karaoke: 2, "Noche de pelis": 1 }, e2: { Ana: 3, Luis: 5, Camila: 2 } };
    const mio = {};
    let user = null, listener = () => {};
    const pausa = () => new Promise((r) => setTimeout(r, 120));
    return {
      async cargar() {
        await pausa();
        return {
          personas: [...personas].sort((a, b) => a.nombre.localeCompare(b.nombre)),
          planes: [...planes].sort((a, b) => b.fecha.localeCompare(a.fecha)),
          asist: [...asist], encuestas: [...encuestas],
          resultados: Object.entries(votos).flatMap(([e, o]) => Object.entries(o).map(([opcion, n]) => ({ encuesta_id: e, opcion, votos: n }))),
          votos: user ? Object.entries(mio).map(([e, o]) => ({ encuesta_id: e, user_id: user.id, email: user.email, opcion: o })) : [],
        };
      },
      reclamarAdmin: async () => true,
      async guardarPlan(p) {
        let pl = planes.find((x) => x.id === p.id);
        if (!pl) { pl = { id: uid() }; planes.push(pl); }
        Object.assign(pl, { fecha: p.fecha, titulo: p.titulo, anfitrion: p.anfitrion, notas: p.notas || "" });
        for (let i = asist.length - 1; i >= 0; i--) if (asist[i].plan_id === pl.id) asist.splice(i, 1);
        new Set([...p.asistentes, p.anfitrion].filter(Boolean)).forEach((x) => asist.push({ plan_id: pl.id, persona_id: x }));
      },
      async borrarPlan(id) { planes.splice(planes.findIndex((x) => x.id === id), 1); },
      async crearPersona(nombre) {
        if (personas.some((p) => p.nombre.toLowerCase() === nombre.toLowerCase())) throw new Error("duplicate key nombre");
        personas.push({ id: uid(), nombre });
      },
      async renombrarPersona(id, nombre) { personas.find((p) => p.id === id).nombre = nombre; },
      async borrarPersona(id) { personas.splice(personas.findIndex((x) => x.id === id), 1); },
      async crearEncuesta(e) { const id = uid(); encuestas.unshift({ id, ...e }); votos[id] = {}; },
      async borrarEncuesta(id) { encuestas.splice(encuestas.findIndex((x) => x.id === id), 1); },
      async votar(id, opcion) {
        votos[id] ??= {};
        if (mio[id]) votos[id][mio[id]]--;
        votos[id][opcion] = (votos[id][opcion] || 0) + 1;
        mio[id] = opcion;
      },
      async entrar(email) { await pausa(); user = { id: "demo", email }; setTimeout(() => listener(user), 300); },
      async salir() { user = null; listener(null); },
      alCambiarSesion(fn) { listener = fn; fn(null); },
    };
  }

  async function cargar() {
    try {
      const d = await api.cargar();
      const porPlan = {};
      d.asist.forEach((a) => (porPlan[a.plan_id] ??= []).push(a.persona_id));
      S.personas = d.personas;
      S.planes = d.planes.map((p) => ({ ...p, asistentes: porPlan[p.id] || [] }));
      S.encuestas = d.encuestas;
      S.resultados = d.resultados;
      S.misVotos = {};
      d.votos.filter((v) => v.user_id === S.user?.id).forEach((v) => (S.misVotos[v.encuesta_id] = v.opcion));
      S.votosAdmin = S.admin ? d.votos : [];
      S.errorCarga = null;
    } catch (e) {
      S.errorCarga = msgError(e);
    }
    S.cargado = true;
    render();
  }

  // ---------- Cálculos ----------
  const persona = (id) => S.personas.find((p) => p.id === id);

  function planesPeriodo() {
    const { tipo, valor } = S.periodo;
    return tipo === "todo" ? S.planes : S.planes.filter((p) => p.fecha.startsWith(valor));
  }

  function stats(planes) {
    const meses = new Set(planes.map((p) => p.fecha.slice(0, 7))).size;
    const orden = [...planes].sort((a, b) => b.fecha.localeCompare(a.fecha));
    return S.personas.map((pe) => {
      const fue = orden.filter((p) => p.asistentes.includes(pe.id));
      const casas = planes.filter((p) => p.anfitrion === pe.id).length;
      let racha = 0;
      for (const p of orden) { if (p.asistentes.includes(pe.id)) racha++; else break; }
      return {
        p: pe, asistencias: fue.length, casas, racha, total: planes.length,
        pctAsistencia: planes.length ? fue.length / planes.length : NaN,
        pctCasa: fue.length ? casas / fue.length : NaN,
        promMes: meses ? fue.length / meses : NaN,
        ultimo: fue[0]?.fecha,
      };
    });
  }

  function ranking(planes) {
    const k = S.metrica === "casas" ? (r) => [r.casas, r.pctCasa || 0] : (r) => [r.pctAsistencia || 0, r.asistencias];
    return stats(planes).sort((a, b) => { const [a1, a2] = k(a), [b1, b2] = k(b); return b1 - a1 || b2 - a2 || a.p.nombre.localeCompare(b.p.nombre); });
  }

  function periodosDisponibles(tipo) {
    const s = new Set(S.planes.map((p) => p.fecha.slice(0, tipo === "mes" ? 7 : 4)));
    s.add(tipo === "mes" ? mesActual() : hoy().slice(0, 4));
    return [...s].sort();
  }

  // ---------- Vistas ----------
  const vistaActual = () => (location.hash.slice(1).match(/^(inicio|planes|encuestas|gente)$/) || ["inicio"])[0];

  function render() {
    const v = vistaActual();
    $$(".nav a").forEach((a) => a.classList.toggle("activo", a.dataset.nav === v));
    renderCuenta();
    if (!api) { $("#vista").innerHTML = bannerError("BMSN no está conectado a la base de datos (falta config.js)."); return; }
    if (!S.cargado) return;
    const err = S.errorCarga ? bannerError("No se pudieron cargar los datos: " + esc(S.errorCarga)) : "";
    const demo = DEMO ? `<div class="banner"><span>Modo demo: datos inventados, nada se guarda.</span></div>` : "";
    $("#vista").innerHTML = demo + err + { inicio: vInicio, planes: vPlanes, encuestas: vEncuestas, gente: vGente }[v]();
  }

  const bannerError = (m) => `<div class="banner error">${m}</div>`;

  function bannerSesion(texto) {
    if (S.admin) return "";
    if (!S.user) return `<div class="banner"><span>${texto}</span><button class="btn chico" data-a="login">Entrar</button></div>`;
    return `<div class="banner"><span>Tu cuenta puede votar, pero solo el admin puede anotar.</span></div>`;
  }

  function renderCuenta() {
    const b = $("#btn-cuenta");
    if (!S.user) { b.innerHTML = `<span class="txt">Entrar</span>`; return; }
    const nombre = S.user.email.split("@")[0];
    b.innerHTML = `${avatar({ nombre }, "sm")}<span class="txt">${S.admin ? "Admin" : esc(nombre)}</span>`;
  }

  function selectorPeriodo() {
    const { tipo, valor } = S.periodo;
    let flechas = "";
    if (tipo !== "todo") {
      const lista = periodosDisponibles(tipo);
      const i = lista.indexOf(valor);
      flechas = `<div class="flechas">
        <button data-a="per-mover" data-v="-1" ${i <= 0 ? "disabled" : ""} aria-label="Anterior">${ICON.izq}</button>
        <span class="lbl">${tipo === "mes" ? nombreMes(valor) : valor}</span>
        <button data-a="per-mover" data-v="1" ${i >= lista.length - 1 ? "disabled" : ""} aria-label="Siguiente">${ICON.der}</button>
      </div>`;
    }
    return `<div class="periodo">
      <div class="seg">${[["mes", "Mes"], ["anio", "Año"], ["todo", "Todo"]].map(([k, l]) => `<button class="${tipo === k ? "on" : ""}" data-a="per-tipo" data-v="${k}">${l}</button>`).join("")}</div>
      ${flechas}
    </div>`;
  }

  function vInicio() {
    if (!S.personas.length) {
      return bannerSesion("Entra con tu correo para empezar a anotar.") + `<div class="vacio">
        <div class="h2">Bienvenido a BMSN</div>
        <p>Primero añade a la gente del grupo.<br>Después anota cada plan con el botón ＋.</p>
        <button class="btn" data-a="nueva-persona">Añadir personas</button>
      </div>`;
    }
    const planes = planesPeriodo();
    const rk = ranking(planes);
    const casas = planes.filter((p) => p.anfitrion).length;
    const prom = planes.length ? planes.reduce((a, p) => a + p.asistentes.length, 0) / planes.length : NaN;
    const { tipo, valor } = S.periodo;
    const etiqueta = tipo === "todo" ? "en total" : tipo === "mes" ? `en ${MESES[+valor.slice(5) - 1]}` : `en ${valor}`;
    const val = (r) => (S.metrica === "casas" ? r.casas : pct(r.pctAsistencia));
    const top = rk.slice(0, 3);
    const podio = top.length === 3 ? `<div class="podio">
        ${[[top[1], "dos", 2], [top[0], "uno", 1], [top[2], "tres", 3]].map(([r, c, n]) => `
          <div class="p ${c}" data-a="perfil" data-id="${r.p.id}">
            ${avatar(r.p)}<div class="nom">${esc(r.p.nombre)}</div><div class="val">${val(r)}</div>
            <div class="base">${n}</div>
          </div>`).join("")}
      </div>` : "";
    const max = Math.max(1, ...rk.map((r) => r.casas));
    const resto = top.length === 3 ? rk.slice(3) : rk;
    return `
      ${selectorPeriodo()}
      <div class="hero">
        <div><div class="display">${planes.length}</div><div class="sub">plan${planes.length === 1 ? "" : "es"} ${etiqueta}</div></div>
        <div class="mini"><b>${dec(prom)}</b><span class="sub">personas por plan</span><b style="margin-top:10px">${casas}</b><span class="sub">en casa de alguien</span></div>
      </div>
      <div class="seccion">
        <div class="cab"><span class="eyebrow">Ranking</span>
          <div class="seg">${[["asistencia", "Asistencia"], ["casas", "Puso casa"]].map(([k, l]) => `<button class="${S.metrica === k ? "on" : ""}" data-a="metrica" data-v="${k}">${l}</button>`).join("")}</div>
        </div>
        ${planes.length ? podio + (resto.length ? `<div class="lista">${resto.map((r, i) => `
          <button class="fila" data-a="perfil" data-id="${r.p.id}">
            <span class="pos">${i + 1 + (rk.length - resto.length)}</span>${avatar(r.p)}
            <span class="cuerpo"><div class="nom">${esc(r.p.nombre)}</div>
              <div class="det">${r.asistencias} de ${r.total} planes · puso casa ${r.casas}</div>
              <div class="barrita"><i style="width:${S.metrica === "casas" ? (r.casas / max) * 100 : (r.pctAsistencia || 0) * 100}%"></i></div>
            </span>
            <span class="der"><div class="big">${val(r)}</div></span>
          </button>`).join("")}</div>` : "")
        : `<div class="vacio"><p>No hay planes en este periodo.</p><button class="btn" data-a="nuevo-plan">＋ Anotar un plan</button></div>`}
      </div>`;
  }

  function vPlanes() {
    const head = `<div class="titulo-vista"><h1 class="h2">Planes</h1><span class="sub">${S.planes.length} en total</span></div>`;
    if (!S.planes.length) {
      return head + bannerSesion("Entra con tu correo para anotar planes.") + `<div class="vacio">
        <p>Todavía no hay planes anotados.</p>
        <button class="btn" data-a="nuevo-plan">＋ Anotar el primero</button></div>`;
    }
    const grupos = {};
    S.planes.forEach((p) => (grupos[p.fecha.slice(0, 7)] ??= []).push(p));
    return head + Object.entries(grupos).map(([m, ps]) => `
      <div class="mes-cab"><span>${nombreMes(m)}</span><span>${ps.length}</span></div>
      ${ps.map((p) => {
        const anf = persona(p.anfitrion);
        const gente = p.asistentes.map(persona).filter(Boolean);
        return `<button class="plan" data-a="ver-plan" data-id="${p.id}">
          <span class="fecha-bloque"><b>${+p.fecha.slice(8)}</b><span>${diaSemana(p.fecha)}</span></span>
          <span class="cuerpo">
            <div class="tit">${esc(p.titulo)}</div>
            <div class="casa">${anf ? `en casa de <em>${esc(anf.nombre)}</em>` : "fuera de casa"} · ${gente.length} personas</div>
            <div class="pila">${gente.slice(0, 6).map((g) => avatar(g, "sm")).join("")}${gente.length > 6 ? `<span class="av sm mas">+${gente.length - 6}</span>` : ""}</div>
          </span>
        </button>`;
      }).join("")}`).join("");
  }

  function conteo(e) {
    const res = S.resultados.filter((r) => r.encuesta_id === e.id);
    const c = e.opciones.map((o) => ({ o, n: Number(res.find((r) => r.opcion === o)?.votos || 0) }));
    const total = c.reduce((a, x) => a + x.n, 0);
    return { c, total, max: Math.max(0, ...c.map((x) => x.n)) };
  }

  function tarjetaEncuesta(e) {
    const abierta = e.mes === mesActual();
    const mio = S.misVotos[e.id];
    const { c, total, max } = conteo(e);
    const verRes = !abierta || !!mio || S.admin;
    const votantes = S.votosAdmin.filter((v) => v.encuesta_id === e.id);
    return `<div class="encuesta">
      <div class="pasada"><span class="eyebrow">${nombreMes(e.mes)}</span><span class="estado ${abierta ? "" : "cerrada"}">${abierta ? "Abierta" : e.mes > mesActual() ? "Próxima" : "Cerrada"}</span></div>
      <div class="pregunta">${esc(e.pregunta)}</div>
      ${c.map((x) => {
        const w = verRes && total ? (x.n / total) * 100 : 0;
        return `<button class="opc ${mio === x.o ? "mia" : ""} ${verRes && x.n && x.n === max ? "gana" : ""}" data-a="votar" data-id="${e.id}" data-v="${esc(x.o)}" ${abierta ? "" : "disabled"}>
          <i class="relleno" style="width:${w}%"></i>
          <span>${mio === x.o ? '<span class="check">✓</span>' : ""}${esc(x.o)}</span>
          <span class="pct">${verRes ? Math.round(w) + "%" : ""}</span>
        </button>`;
      }).join("")}
      <div class="pie-enc">
        <span>${total} voto${total === 1 ? "" : "s"}${abierta ? (mio ? " · toca otra para cambiar" : " · toca una opción para votar") : ""}</span>
        ${S.admin ? `<button class="link" data-a="admin-encuesta" data-id="${e.id}">Opciones</button>` : ""}
      </div>
      ${S.admin && votantes.length ? `<details style="margin-top:10px;font-size:13px;color:var(--muted)"><summary>Quién votó (${votantes.length})</summary>${votantes.map((v) => `<div>${esc(v.email)} → ${esc(v.opcion)}</div>`).join("")}</details>` : ""}
    </div>`;
  }

  function vEncuestas() {
    const vigentes = S.encuestas.filter((e) => e.mes >= mesActual()).sort((a, b) => a.mes.localeCompare(b.mes));
    const pasadas = S.encuestas.filter((e) => e.mes < mesActual());
    const head = `<div class="titulo-vista"><h1 class="h2">Encuestas</h1>${S.admin ? `<button class="btn chico" data-a="nueva-encuesta">＋ Nueva</button>` : ""}</div>`;
    const login = !S.user ? `<div class="banner"><span>Para votar, entra con tu correo. Un voto por persona.</span><button class="btn chico" data-a="login">Entrar</button></div>` : "";
    return head + login +
      (vigentes.length ? vigentes.map(tarjetaEncuesta).join('<div style="height:14px"></div>')
        : `<div class="vacio"><p>No hay encuesta abierta este mes.</p>${S.admin ? `<button class="btn" data-a="nueva-encuesta">Crear la de ${MESES[+mesActual().slice(5) - 1]}</button>` : ""}</div>`) +
      (pasadas.length ? `<div class="seccion"><div class="cab"><span class="eyebrow">Anteriores</span></div><div class="lista">
        ${pasadas.map((e) => {
          const { c, max, total } = conteo(e);
          const gan = c.filter((x) => x.n === max && max > 0).map((x) => x.o).join(" / ") || "Sin votos";
          return `<button class="fila" data-a="ver-encuesta" data-id="${e.id}"><span class="cuerpo">
            <div class="det">${nombreMes(e.mes)} · ${total} votos</div><div class="nom">${esc(e.pregunta)}</div></span>
            <span class="der"><div class="gan-txt">${esc(gan)}</div></span></button>`;
        }).join("")}</div></div>` : "");
  }

  function vGente() {
    const st = Object.fromEntries(stats(S.planes).map((r) => [r.p.id, r]));
    const head = `<div class="titulo-vista"><h1 class="h2">Gente</h1>${S.admin ? `<button class="btn chico" data-a="nueva-persona">＋ Añadir</button>` : ""}</div>`;
    if (!S.personas.length) {
      return head + bannerSesion("Entra con tu correo para añadir gente.") + `<div class="vacio"><p>Aún no hay nadie.</p><button class="btn" data-a="nueva-persona">Añadir personas</button></div>`;
    }
    return head + bannerSesion("Entra con tu correo para editar.") + `<div class="lista">${S.personas.map((p) => {
      const r = st[p.id];
      return `<button class="fila" data-a="perfil" data-id="${p.id}">${avatar(p)}
        <span class="cuerpo"><div class="nom">${esc(p.nombre)}</div><div class="det">${r.asistencias} planes · puso casa ${r.casas}</div></span>
        <span class="der"><div class="big">${pct(r.pctAsistencia)}</div></span></button>`;
    }).join("")}</div>`;
  }

  // ---------- Hoja inferior ----------
  const hoja = $("#hoja");
  function abrirHoja(html) {
    $("#hoja-contenido").innerHTML = html;
    if (!hoja.open) hoja.showModal();
    hoja.scrollTop = 0;
  }
  const cerrarHoja = () => hoja.open && hoja.close();
  hoja.addEventListener("click", (e) => { if (e.target === hoja) cerrarHoja(); });
  const cabHoja = (t, sub = "") => `<div class="hoja-cab"><div>${sub ? `<div class="eyebrow">${sub}</div>` : ""}<div class="h2">${t}</div></div><button class="cerrar" data-a="cerrar" aria-label="Cerrar">${ICON.cerrar}</button></div>`;

  function hojaLogin(motivo = "") {
    abrirHoja(`${cabHoja("Entrar")}
      <p class="sub" style="margin:-6px 0 20px">${motivo || "Te enviamos un enlace a tu correo. Sin contraseñas."}</p>
      <form id="f-login">
        <label class="campo"><span>Tu correo</span><input type="email" name="email" required autocomplete="email" placeholder="nombre@gmail.com"></label>
        <button class="btn full" type="submit">Enviarme el enlace</button>
      </form>`);
    setTimeout(() => $("#f-login [name=email]")?.focus(), 250);
  }
  function hojaLoginEnviado(email) {
    abrirHoja(`${cabHoja("Revisa tu correo")}
      <div class="vacio" id="login-enviado" style="padding:10px 0">
        <div class="display" style="font-size:60px">✉︎</div>
        <p>Enviamos un enlace a <b style="color:var(--ink)">${esc(email)}</b>.<br>Ábrelo <b style="color:var(--ink)">en este mismo dispositivo</b> para entrar.</p>
        <p style="font-size:13px">¿No llega? Mira en spam o espera un minuto.</p>
      </div>
      <button class="btn sec full" data-a="login">Usar otro correo</button>`);
  }
  function hojaCuenta() {
    abrirHoja(`${cabHoja(S.admin ? "Admin" : "Tu cuenta")}
      <div class="perfil-cab">${avatar({ nombre: S.user.email }, "xl")}<div><div class="h3">${esc(S.user.email)}</div>
      <div class="sub">${S.admin ? "Puedes anotar planes, gente y encuestas." : "Puedes votar en las encuestas."}</div></div></div>
      <button class="btn linea full" data-a="salir">Cerrar sesión</button>`);
  }

  // Formulario rápido de plan
  let borrador = null;
  function nuevoBorrador(plan) {
    const titulos = [...new Set(S.planes.map((p) => p.titulo))].slice(0, 6);
    borrador = plan
      ? { id: plan.id, titulo: plan.titulo, fecha: plan.fecha, notas: plan.notas || "", asistentes: new Set(plan.asistentes), anfitrion: plan.anfitrion, titulos }
      : { id: null, titulo: "", fecha: hoy(), notas: "", asistentes: new Set(), anfitrion: null, titulos };
  }

  function hojaPlan() {
    const b = borrador;
    const ayer = sumarDias(hoy(), -1);
    const esOtra = b.fecha !== hoy() && b.fecha !== ayer;
    const n = b.asistentes.size;
    abrirHoja(`${cabHoja(b.id ? "Editar plan" : "Nuevo plan")}
      <form id="f-plan" autocomplete="off">
        <input class="input-grande" name="titulo" maxlength="80" placeholder="¿Qué hicieron?" value="${esc(b.titulo)}">
        ${b.titulos.length && !b.id ? `<div class="chips" style="margin:12px 0 4px">${b.titulos.map((t) => `<button type="button" class="chip ${b.titulo === t ? "on" : ""}" data-a="tit-sug" data-v="${esc(t)}">${esc(t)}</button>`).join("")}</div>` : ""}
        <div class="campo" style="margin-top:22px"><span>Cuándo</span>
          <div class="chips">
            <button type="button" class="chip ${b.fecha === hoy() ? "on" : ""}" data-a="fecha" data-v="${hoy()}">Hoy</button>
            <button type="button" class="chip ${b.fecha === ayer ? "on" : ""}" data-a="fecha" data-v="${ayer}">Ayer</button>
            <label class="chip ${esOtra ? "on" : ""}" style="position:relative">${esOtra ? `${diaSemana(b.fecha)} ${fechaCorta(b.fecha)}` : "Otra fecha"}
              <input type="date" name="fecha" value="${b.fecha}" max="${hoy()}" style="position:absolute;inset:0;opacity:0;cursor:pointer;padding:0">
            </label>
          </div>
        </div>
        <div class="fila-acc"><span class="h3">¿Quién fue?${n ? ` <span class="sub">· ${n}</span>` : ""}</span>
          <button type="button" class="link" data-a="todos">${n === S.personas.length ? "Quitar todos" : "Todos"}</button></div>
        <p class="ayuda">Un toque: asistió ✓ · Otro toque: puso casa 🏠 · Otro: quitar</p>
        <div class="gente-grid">${S.personas.map((p) => {
          const on = b.asistentes.has(p.id), casa = b.anfitrion === p.id;
          return `<button type="button" class="persona-sel ${on ? "on" : ""} ${casa ? "casa" : ""}" data-a="sel" data-id="${p.id}">
            ${avatar(p)}<i class="marca">${casa ? "🏠" : "✓"}</i><span>${esc(p.nombre)}</span></button>`;
        }).join("")}
          <button type="button" class="persona-sel" data-a="nueva-persona-rapida"><span class="av" style="background:var(--soft);color:var(--ink-2)">＋</span><span>Añadir</span></button>
        </div>
        <div class="campo" style="margin-top:22px"><span>¿Dónde fue?</span>
          <div class="chips">
            <button type="button" class="chip ${!b.anfitrion ? "on" : ""}" data-a="casa" data-id="">Fuera de casa</button>
            ${[...b.asistentes].map(persona).filter(Boolean).map((p) => `<button type="button" class="chip casa ${b.anfitrion === p.id ? "on" : ""}" data-a="casa" data-id="${p.id}">🏠 ${esc(p.nombre)}</button>`).join("")}
          </div>
        </div>
        <label class="campo"><span>Nota (opcional)</span><input name="notas" maxlength="200" value="${esc(b.notas)}" placeholder="Algo para recordar"></label>
        <div class="pie-hoja"><button class="btn full" type="submit" ${n ? "" : "disabled"}>${n ? `Guardar · ${n} persona${n === 1 ? "" : "s"}` : "Marca quién fue"}</button></div>
      </form>`);
  }

  function hojaVerPlan(p) {
    if (!p) return;
    const anf = persona(p.anfitrion);
    const gente = p.asistentes.map(persona).filter(Boolean);
    const [y, m, d] = p.fecha.split("-");
    abrirHoja(`${cabHoja(esc(p.titulo), `${diaSemana(p.fecha)} ${+d} de ${MESES[+m - 1]} ${y}`)}
      <p class="sub" style="margin:-8px 0 18px">${anf ? `En casa de <b style="color:var(--accent)">${esc(anf.nombre)}</b>` : "Fuera de casa"} · ${gente.length} personas</p>
      ${p.notas ? `<p style="margin:0 0 18px">${esc(p.notas)}</p>` : ""}
      <div class="lista">${gente.map((g) => `<button class="fila" data-a="perfil" data-id="${g.id}">${avatar(g)}<span class="cuerpo"><div class="nom">${esc(g.nombre)}</div></span>${g.id === p.anfitrion ? "<span>🏠</span>" : ""}</button>`).join("")}</div>
      ${S.admin ? `<div class="acciones-pie"><button class="btn sec" data-a="editar-plan" data-id="${p.id}">Editar</button><button class="btn peligro" data-a="borrar-plan" data-id="${p.id}">Borrar</button></div>` : ""}`);
  }

  function hojaPerfil(id) {
    const p = persona(id);
    if (!p) return;
    const r = stats(S.planes).find((x) => x.p.id === id);
    const ult = S.planes.filter((x) => x.asistentes.includes(id)).slice(0, 5);
    abrirHoja(`<div class="hoja-cab"><span></span><button class="cerrar" data-a="cerrar" aria-label="Cerrar">${ICON.cerrar}</button></div>
      <div class="perfil-cab" style="margin-top:-28px">${avatar(p, "xl")}<div><div class="h2">${esc(p.nombre)}</div>
        <div class="sub">${r.ultimo ? `Último plan: ${fechaCorta(r.ultimo)}` : "Aún sin planes"}</div></div></div>
      <div class="stats">
        <div class="stat"><b>${pct(r.pctAsistencia)}</b><span>asistencia · ${r.asistencias} de ${r.total}</span></div>
        <div class="stat"><b>${r.casas}</b><span>veces puso casa · ${pct(r.pctCasa)}</span></div>
        <div class="stat"><b>${dec(r.promMes)}</b><span>planes por mes</span></div>
        <div class="stat"><b>${r.racha}</b><span>racha actual</span></div>
      </div>
      ${ult.length ? `<div class="seccion" style="margin-top:22px"><div class="cab"><span class="eyebrow">Últimos planes</span></div>
        <div class="lista">${ult.map((x) => `<button class="fila" data-a="ver-plan" data-id="${x.id}"><span class="cuerpo"><div class="nom">${esc(x.titulo)}</div>
          <div class="det">${fechaCorta(x.fecha)} ${x.fecha.slice(0, 4)}</div></span>${x.anfitrion === id ? "<span>🏠</span>" : ""}</button>`).join("")}</div></div>` : ""}
      ${S.admin ? `<div class="acciones-pie"><button class="btn sec" data-a="renombrar" data-id="${id}">Renombrar</button><button class="btn peligro" data-a="borrar-persona" data-id="${id}">Borrar</button></div>` : ""}`);
  }

  function hojaNuevaPersona(volverAPlan = false) {
    abrirHoja(`${cabHoja("Añadir gente")}
      <p class="sub" style="margin:-6px 0 18px">Escribe un nombre y pulsa Añadir. Puedes añadir varios seguidos.</p>
      <form id="f-persona" data-volver="${volverAPlan ? 1 : ""}" autocomplete="off">
        <input class="input-grande" name="nombre" maxlength="40" placeholder="Nombre" required>
        <div class="chips" id="recien" style="margin:14px 0"></div>
        <div class="pie-hoja" style="display:flex;gap:10px">
          <button class="btn full" type="submit">Añadir</button>
          <button class="btn sec full" type="button" data-a="${volverAPlan ? "volver-plan" : "cerrar"}">Listo</button>
        </div>
      </form>`);
    setTimeout(() => $("#f-persona [name=nombre]")?.focus(), 250);
  }

  function hojaNuevaEncuesta(opciones = ["", ""], preg = "", mes = mesActual()) {
    abrirHoja(`${cabHoja("Nueva encuesta")}
      <form id="f-encuesta" autocomplete="off">
        <input class="input-grande" name="pregunta" maxlength="120" placeholder="¿Cuál fue el mejor plan?" value="${esc(preg)}" required>
        <label class="campo" style="margin-top:20px"><span>Mes</span><input type="month" name="mes" value="${mes}" min="${mesActual()}" required></label>
        <div class="fila-acc"><span class="h3">Opciones</span></div>
        <div class="chips" style="margin-bottom:12px">
          <button type="button" class="chip" data-a="op-gente">👥 Usar la gente</button>
          <button type="button" class="chip" data-a="op-planes">📅 Planes recientes</button>
        </div>
        <div class="opciones-edit" id="ops">${opciones.map((o, i) => `<div class="o"><input name="op" maxlength="60" value="${esc(o)}" placeholder="Opción ${i + 1}"><button type="button" data-a="op-quitar" aria-label="Quitar">−</button></div>`).join("")}</div>
        <button type="button" class="link" data-a="op-mas">＋ Añadir opción</button>
        <div class="pie-hoja"><button class="btn full" type="submit">Crear encuesta</button></div>
      </form>`);
  }

  // ---------- Acciones ----------
  async function hacer(fn, ok) {
    try { await fn(); if (ok) toast(ok); await cargar(); return true; }
    catch (e) { toast(msgError(e), true); return false; }
  }

  function exigirAdmin(motivo) {
    if (S.admin) return true;
    if (!S.user) hojaLogin(motivo);
    else toast("Solo el admin puede hacer esto.", true);
    return false;
  }

  const recogerOpciones = () => $$("#ops [name=op]").map((i) => i.value);
  function rehacerEncuesta(opciones) {
    const f = $("#f-encuesta");
    hojaNuevaEncuesta(opciones, f.pregunta.value, f.mes.value);
  }
  function guardarCampos() {
    const f = $("#f-plan");
    if (!f || !borrador) return;
    borrador.titulo = f.titulo.value;
    borrador.notas = f.notas.value;
  }
  function repintarPlan() { const y = hoja.scrollTop; hojaPlan(); hoja.scrollTop = y; }

  const acciones = {
    cerrar: cerrarHoja,
    login: () => hojaLogin(),
    salir: async () => { cerrarHoja(); await api.salir(); toast("Sesión cerrada"); },
    "per-tipo": (d) => {
      const t = d.v, p = S.periodo;
      let valor = "";
      if (t === "mes") valor = p.tipo === "anio" && p.valor !== hoy().slice(0, 4) ? periodosDisponibles("mes").filter((m) => m.startsWith(p.valor)).pop() : mesActual();
      if (t === "anio") valor = (p.valor || hoy()).slice(0, 4);
      S.periodo = { tipo: t, valor };
      render();
    },
    "per-mover": (d) => {
      const l = periodosDisponibles(S.periodo.tipo);
      S.periodo.valor = l[Math.min(l.length - 1, Math.max(0, l.indexOf(S.periodo.valor) + Number(d.v)))];
      render();
    },
    metrica: (d) => { S.metrica = d.v; render(); },
    perfil: (d) => hojaPerfil(d.id),
    "ver-plan": (d) => hojaVerPlan(S.planes.find((p) => p.id === d.id)),
    "nuevo-plan": () => {
      if (!exigirAdmin("Entra con tu correo de admin para anotar planes.")) return;
      nuevoBorrador();
      if (!S.personas.length) { toast("Primero añade a la gente"); return hojaNuevaPersona(true); }
      hojaPlan();
    },
    "editar-plan": (d) => { nuevoBorrador(S.planes.find((p) => p.id === d.id)); hojaPlan(); },
    "borrar-plan": async (d) => { if (confirm("¿Borrar este plan?")) { cerrarHoja(); await hacer(() => api.borrarPlan(d.id), "Plan borrado"); } },
    "tit-sug": (d) => { guardarCampos(); borrador.titulo = d.v; repintarPlan(); },
    fecha: (d) => { guardarCampos(); borrador.fecha = d.v; repintarPlan(); },
    sel: (d) => {
      guardarCampos();
      const b = borrador;
      if (!b.asistentes.has(d.id)) b.asistentes.add(d.id);
      else if (b.anfitrion !== d.id) b.anfitrion = d.id;
      else { b.anfitrion = null; b.asistentes.delete(d.id); }
      repintarPlan();
    },
    casa: (d) => { guardarCampos(); borrador.anfitrion = d.id || null; repintarPlan(); },
    todos: () => {
      guardarCampos();
      if (borrador.asistentes.size === S.personas.length) { borrador.asistentes.clear(); borrador.anfitrion = null; }
      else S.personas.forEach((p) => borrador.asistentes.add(p.id));
      repintarPlan();
    },
    "nueva-persona": () => { if (exigirAdmin("Entra con tu correo de admin para añadir gente.")) hojaNuevaPersona(); },
    "nueva-persona-rapida": () => { guardarCampos(); hojaNuevaPersona(true); },
    "volver-plan": () => { if (!borrador) nuevoBorrador(); if (S.personas.length) hojaPlan(); else cerrarHoja(); },
    renombrar: async (d) => {
      const p = persona(d.id);
      const nombre = prompt("Nuevo nombre", p.nombre)?.trim();
      if (nombre && nombre !== p.nombre && await hacer(() => api.renombrarPersona(d.id, nombre), "Nombre actualizado")) hojaPerfil(d.id);
    },
    "borrar-persona": async (d) => {
      if (confirm(`¿Borrar a ${persona(d.id).nombre}? Desaparecerá de todos los planes.`)) { cerrarHoja(); await hacer(() => api.borrarPersona(d.id), "Persona borrada"); }
    },
    votar: async (d) => {
      if (!S.user) return hojaLogin("Entra con tu correo para votar. Se cuenta un voto por correo.");
      if (S.misVotos[d.id] === d.v) return;
      const enHoja = hoja.open;
      await hacer(() => api.votar(d.id, d.v), S.misVotos[d.id] ? "Voto cambiado" : "¡Voto registrado!");
      if (enHoja) acciones["ver-encuesta"](d);
    },
    "ver-encuesta": (d) => {
      const e = S.encuestas.find((x) => x.id === d.id);
      if (e) abrirHoja(`<div class="hoja-cab"><span></span><button class="cerrar" data-a="cerrar" aria-label="Cerrar">${ICON.cerrar}</button></div>${tarjetaEncuesta(e)}`);
    },
    "admin-encuesta": (d) => {
      const e = S.encuestas.find((x) => x.id === d.id);
      abrirHoja(`${cabHoja(esc(e.pregunta), nombreMes(e.mes))}
        <p class="sub">Borrar la encuesta elimina también sus votos.</p>
        <button class="btn peligro full" data-a="borrar-encuesta" data-id="${e.id}">Borrar encuesta</button>`);
    },
    "borrar-encuesta": async (d) => { if (confirm("¿Borrar la encuesta y sus votos?")) { cerrarHoja(); await hacer(() => api.borrarEncuesta(d.id), "Encuesta borrada"); } },
    "nueva-encuesta": () => { if (exigirAdmin("Entra con tu correo de admin para crear encuestas.")) hojaNuevaEncuesta(); },
    "op-mas": () => rehacerEncuesta([...recogerOpciones(), ""]),
    "op-quitar": (d, el) => { const o = recogerOpciones(); o.splice($$("#ops [data-a=op-quitar]").indexOf(el), 1); rehacerEncuesta(o.length ? o : [""]); },
    "op-gente": () => rehacerEncuesta(S.personas.map((p) => p.nombre)),
    "op-planes": () => {
      const m = $("#f-encuesta [name=mes]").value;
      const prev = sumarDias(m + "-01", -1).slice(0, 7);
      let t = [...new Set(S.planes.filter((p) => p.fecha.startsWith(m)).map((p) => p.titulo))];
      if (t.length < 2) t = [...new Set(S.planes.filter((p) => p.fecha.startsWith(prev)).map((p) => p.titulo))];
      if (t.length < 2) return toast("No hay suficientes planes recientes", true);
      rehacerEncuesta(t);
    },
  };

  document.addEventListener("click", (ev) => {
    const el = ev.target.closest("[data-a]");
    if (!el || el.disabled) return;
    const fn = acciones[el.dataset.a];
    if (fn) { ev.preventDefault(); fn(el.dataset, el); }
  });

  document.addEventListener("change", (ev) => {
    if (ev.target.matches("#f-plan [name=fecha]") && ev.target.value) { guardarCampos(); borrador.fecha = ev.target.value; repintarPlan(); }
  });

  document.addEventListener("submit", async (ev) => {
    const f = ev.target;
    ev.preventDefault();
    const btn = f.querySelector("[type=submit]");
    if (f.id === "f-login") {
      const email = f.email.value.trim().toLowerCase();
      btn.disabled = true; btn.textContent = "Enviando…";
      try { await api.entrar(email); if (!S.user) hojaLoginEnviado(email); }
      catch (e) { toast(msgError(e), true); btn.disabled = false; btn.textContent = "Enviarme el enlace"; }
    }
    if (f.id === "f-plan") {
      guardarCampos();
      const b = borrador;
      if (!b.titulo.trim()) { toast("Ponle un nombre al plan", true); f.titulo.focus(); return; }
      btn.disabled = true; btn.textContent = "Guardando…";
      const ok = await hacer(() => api.guardarPlan({ id: b.id, fecha: b.fecha, titulo: b.titulo.trim(), anfitrion: b.anfitrion, asistentes: [...b.asistentes], notas: b.notas.trim() }), b.id ? "Plan actualizado" : "Plan anotado ✓");
      if (ok) { borrador = null; cerrarHoja(); }
      else { btn.disabled = false; btn.textContent = "Guardar"; }
    }
    if (f.id === "f-persona") {
      const nombre = f.nombre.value.trim().replace(/\s+/g, " ");
      if (!nombre) return;
      btn.disabled = true;
      if (await hacer(() => api.crearPersona(nombre), `${nombre} añadido`)) {
        const p = S.personas.find((x) => x.nombre === nombre);
        if (f.dataset.volver && borrador && p) borrador.asistentes.add(p.id);
        f.nombre.value = "";
        $("#recien").insertAdjacentHTML("beforeend", `<span class="chip on">✓ ${esc(nombre)}</span>`);
      }
      btn.disabled = false; f.nombre.focus();
    }
    if (f.id === "f-encuesta") {
      const opciones = [...new Set(recogerOpciones().map((s) => s.trim()).filter(Boolean))];
      if (opciones.length < 2) return toast("Pon al menos dos opciones", true);
      btn.disabled = true;
      if (await hacer(() => api.crearEncuesta({ mes: f.mes.value, pregunta: f.pregunta.value.trim(), opciones }), "Encuesta creada")) {
        cerrarHoja(); location.hash = "#encuestas";
      } else btn.disabled = false;
    }
  });

  $("#btn-nuevo").addEventListener("click", () => acciones["nuevo-plan"]());
  $("#btn-cuenta").addEventListener("click", () => (S.user ? hojaCuenta() : hojaLogin()));
  window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });

  // ---------- Arranque ----------
  if (!api) return render();
  let ultimo = "inicial";
  api.alCambiarSesion(async (user) => {
    if ((user?.id ?? null) === ultimo) return;
    const habia = ultimo !== "inicial";
    ultimo = user?.id ?? null;
    S.user = user;
    S.admin = false;
    if (user) {
      try { S.admin = !!(await api.reclamarAdmin()); } catch { S.admin = false; }
      if (hoja.open && $("#f-login, #login-enviado")) cerrarHoja();
      if (/access_token|error_description/.test(location.hash)) history.replaceState(null, "", location.pathname + location.search);
      if (habia || DEMO) toast(S.admin ? "Entraste como admin" : "Sesión iniciada");
    }
    await cargar();
  });
})();
