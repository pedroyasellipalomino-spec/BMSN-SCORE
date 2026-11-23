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
  const normalizarClave = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const hue = (p) => (Number.isInteger(p.color) ? p.color : tono(p.nombre));
  const avatar = (p, cls = "") => {
    if (!p) return "";
    if (p.foto) return `<span class="av ${cls} foto" style="--h:${hue(p)};background-image:url('${esc(p.foto.replace(/'/g, "%27"))}')" role="img" aria-label="${esc(p.nombre)}"></span>`;
    return `<span class="av ${cls} ${p.emoji ? "emoji" : ""}" style="--h:${hue(p)}">${p.emoji ? esc(p.emoji) : esc(iniciales(p.nombre))}</span>`;
  };
  const EMOJIS = ["😎", "🔥", "🍻", "🍕", "🎮", "⚽", "🎸", "🎧", "🌮", "🍷", "🏀", "🎲", "🦁", "🐺", "🦊", "🐸", "👑", "💀", "🚀", "🌈", "⚡", "🍀", "🎯", "🃏"];
  const COLORES = [80, 140, 180, 210, 260, 300, 340, 15, 40];
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
    if (/bucket not found/i.test(m)) return "Las fotos aún no están activadas (falta 03_fotos_admin.sql).";
    if (/row-level security|unauthorized/i.test(m)) return "No tienes permiso para hacer esto.";
    if (/duplicate key.*admins/i.test(m)) return "Ese correo ya es admin.";
    if (/invalid login credentials/i.test(m)) return "No se pudo entrar. Revisa el correo y la contraseña.";
    if (/email address not authorized|email_address_not_authorized/i.test(m)) return "Supabase no deja enviar correos a esa dirección. Entra con la contraseña del grupo.";
    if (/over_email_send_rate_limit|email rate limit/i.test(m)) return "Se alcanzó el límite de correos por hora. Entra con la contraseña del grupo.";
    return m;
  };

  // ---------- Estado ----------
  const S = {
    personas: [], planes: [], encuestas: [], resultados: [], misVotos: {}, votosAdmin: [],
    user: null, admin: false, cargado: false, errorCarga: null,
    periodo: { tipo: "anio", valor: hoy().slice(0, 4) },
    metrica: "asistencia",
    vistaPlanes: "cal", calMes: null, calPersona: undefined, calDia: null,
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
        let migracion = true, fotos = true;
        const personasQ = sb.from("personas").select("id,nombre,user_id,bio,emoji,color,vinculado,foto").order("nombre").then(async (r) => {
          if (r.error?.code !== "42703") return r;
          fotos = false;
          r = await sb.from("personas").select("id,nombre,user_id,bio,emoji,color,vinculado").order("nombre");
          if (r.error?.code !== "42703") return r;
          migracion = false;
          return sb.from("personas").select("id,nombre").order("nombre");
        });
        const opcional = (p) => p.then((r) => r.data || []);
        const [personas, planes, asist, encuestas, resultados, participacion, admins, claveGrupo] = await Promise.all([
          q(personasQ),
          q(sb.from("planes").select("id,fecha,titulo,anfitrion,notas").order("fecha", { ascending: false }).order("creado", { ascending: false })),
          q(sb.from("asistencias").select("plan_id,persona_id")),
          q(sb.from("encuestas").select("id,mes,pregunta,opciones,creado").order("mes", { ascending: false }).order("creado", { ascending: false })),
          q(sb.rpc("resultados")),
          opcional(sb.rpc("participacion")),
          opcional(sb.rpc("personas_admin")),
          sb.rpc("clave_grupo_activa").then((r) => (r.error ? null : !!r.data)),
        ]);
        const votos = S.user ? await q(sb.from("votos").select("encuesta_id,user_id,email,opcion,fecha")) : [];
        const emailsAdmin = S.admin ? await opcional(sb.from("admins").select("email")) : [];
        return { personas, planes, asist, encuestas, resultados, votos, participacion, admins: admins.map((a) => a.persona_id), migracion, fotos, emailsAdmin: emailsAdmin.map((a) => a.email), claveGrupo };
      },
      reclamarAdmin: () => q(sb.rpc("reclamar_admin")),
      guardarPlan: (p) => q(sb.rpc("guardar_plan", { p_id: p.id || null, p_fecha: p.fecha, p_titulo: p.titulo, p_anfitrion: p.anfitrion, p_asistentes: p.asistentes, p_notas: p.notas || "" })),
      borrarPlan: (id) => q(sb.from("planes").delete().eq("id", id)),
      crearPersona: (nombre) => q(sb.from("personas").insert({ nombre })),
      vincular: (id, nombre) => q(sb.rpc("vincular", { p_persona: id || null, p_nombre: nombre || "" })),
      editarPerfil: (id, d, propio) => propio
        ? q(sb.rpc("editar_perfil", { p_nombre: d.nombre, p_bio: d.bio, p_emoji: d.emoji, p_color: d.color }))
        : q(sb.from("personas").update({ nombre: d.nombre, bio: d.bio, emoji: d.emoji, color: d.color }).eq("id", id)),
      desvincular: (id) => q(sb.rpc("desvincular", { p_persona: id })),
      async subirFoto(id, blob) {
        const ruta = `${id}.jpg`;
        const { error } = await sb.storage.from("avatares").upload(ruta, blob, { upsert: true, contentType: "image/jpeg", cacheControl: "3600" });
        if (error) throw error;
        const url = sb.storage.from("avatares").getPublicUrl(ruta).data.publicUrl + "?v=" + Date.now();
        await q(sb.rpc("poner_foto", { p_persona: id, p_url: url }));
      },
      quitarFoto: (id) => q(sb.rpc("poner_foto", { p_persona: id, p_url: null })),
      agregarAdmin: (email) => q(sb.from("admins").insert({ email: email.toLowerCase() })),
      quitarAdmin: (email) => q(sb.from("admins").delete().eq("email", email)),
      borrarPersona: (id) => q(sb.from("personas").delete().eq("id", id)),
      crearEncuesta: (e) => q(sb.from("encuestas").insert(e)),
      borrarEncuesta: (id) => q(sb.from("encuestas").delete().eq("id", id)),
      votar: (id, opcion) => q(sb.rpc("votar", { p_encuesta: id, p_opcion: opcion })),
      entrar: async (email) => { const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } }); if (error) throw error; },
      async entrarConEnlace(texto) {
        let u;
        try { u = new URL(texto.trim()); } catch { throw new Error("Eso no parece un enlace"); }
        const h = new URLSearchParams(u.hash.slice(1));
        if (h.get("access_token") && h.get("refresh_token")) {
          const { error } = await sb.auth.setSession({ access_token: h.get("access_token"), refresh_token: h.get("refresh_token") });
          if (error) throw error;
          return;
        }
        const token = u.searchParams.get("token_hash") || u.searchParams.get("token");
        if (!token) throw new Error("Ese enlace no es el del correo de BMSN");
        const tipo = u.searchParams.get("type") || "magiclink";
        const { error } = await sb.auth.verifyOtp({ token_hash: token, type: tipo === "signup" ? "signup" : tipo === "magiclink" ? "magiclink" : "email" });
        if (error) throw new Error(/expired|invalid/i.test(error.message) ? "El enlace venció o ya se usó. Pide uno nuevo." : error.message);
      },
      async entrarConClave(email, clave) {
        const pass = normalizarClave(clave);
        await q(sb.rpc("entrar_grupo", { p_email: email, p_clave: pass }));
        const { error } = await sb.auth.signInWithPassword({ email, password: pass });
        if (error) throw error;
      },
      ponerClaveGrupo: (clave) => q(sb.rpc("poner_clave_grupo", { p_clave: normalizarClave(clave) })),
      async entrarConCodigo(email, codigo) {
        const { error } = await sb.auth.verifyOtp({ email, token: codigo, type: "email" });
        if (error) throw new Error(/expired|invalid/i.test(error.message) ? "Código incorrecto o vencido. Pide uno nuevo." : error.message);
      },
      salir: () => sb.auth.signOut(),
      alCambiarSesion: (fn) => sb.auth.onAuthStateChange((ev, s) => setTimeout(() => fn(s?.user ?? null), 0)),
    };
  }

  function crearDemo() {
    const uid = () => Math.random().toString(36).slice(2, 10);
    const personas = ["Ana", "Luis", "Pedro", "Camila", "Diego", "Valeria", "Mateo", "Sofía"].map((n, i) => ({ id: uid(), nombre: n, user_id: i % 3 === 1 ? "otro" + i : null, bio: i === 1 ? "El que nunca falta al asado" : "", emoji: i === 4 ? "🔥" : "", color: null }));
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
    const emailsAdmin = [];
    const pausa = () => new Promise((r) => setTimeout(r, 120));
    return {
      async cargar() {
        await pausa();
        return {
          personas: [...personas].sort((a, b) => a.nombre.localeCompare(b.nombre)),
          planes: [...planes].sort((a, b) => b.fecha.localeCompare(a.fecha)),
          asist: [...asist], encuestas: [...encuestas],
          resultados: Object.entries(votos).flatMap(([e, o]) => Object.entries(o).map(([opcion, n]) => ({ encuesta_id: e, opcion, votos: n }))),
          votos: user ? Object.entries(mio).map(([e, o]) => ({ encuesta_id: e, user_id: user.id, email: user.email, opcion: o.opcion, fecha: o.fecha })) : [],
          participacion: personas.map((p, i) => ({ persona_id: p.id, votos: p.user_id === "demo" ? Object.keys(mio).length : (i % 3) + 1 })),
          admins: personas.filter((p) => p.user_id === "demo").map((p) => p.id),
          migracion: true, fotos: true, claveGrupo: true, emailsAdmin: user ? [user.email, ...emailsAdmin] : [],
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
      async vincular(id, nombre) {
        if (personas.some((p) => p.user_id === user.id)) return;
        let p = id ? personas.find((x) => x.id === id) : personas.find((x) => x.nombre.toLowerCase() === nombre.trim().toLowerCase());
        if (p && p.user_id) throw new Error("Ese perfil ya pertenece a otra cuenta");
        if (!p) { p = { id: uid(), nombre: nombre.trim() }; personas.push(p); }
        Object.assign(p, { user_id: user.id, vinculado: new Date().toISOString() });
      },
      async editarPerfil(id, d) { Object.assign(personas.find((p) => p.id === id), d); },
      async desvincular(id) { Object.assign(personas.find((p) => p.id === id), { user_id: null, vinculado: null }); },
      async subirFoto(id, blob) { personas.find((p) => p.id === id).foto = URL.createObjectURL(blob); },
      async quitarFoto(id) { personas.find((p) => p.id === id).foto = null; },
      async agregarAdmin(email) { emailsAdmin.push(email.toLowerCase()); },
      async quitarAdmin(email) { emailsAdmin.splice(emailsAdmin.indexOf(email), 1); },
      async borrarPersona(id) { personas.splice(personas.findIndex((x) => x.id === id), 1); },
      async crearEncuesta(e) { const id = uid(); encuestas.unshift({ id, ...e }); votos[id] = {}; },
      async borrarEncuesta(id) { encuestas.splice(encuestas.findIndex((x) => x.id === id), 1); },
      async votar(id, opcion) {
        votos[id] ??= {};
        if (mio[id]) votos[id][mio[id].opcion]--;
        votos[id][opcion] = (votos[id][opcion] || 0) + 1;
        mio[id] = { opcion, fecha: new Date().toISOString() };
      },
      async entrar(email) { await pausa(); user = { id: "demo", email }; setTimeout(() => listener(user), 300); },
      async salir() { user = null; listener(null); },
      async entrarConEnlace() { throw new Error("En el modo demo no hace falta: usa Entrar."); },
      async entrarConClave(email, clave) {
        if (normalizarClave(clave) !== "demo bmsn") throw new Error("Contraseña del grupo incorrecta");
        user = { id: "demo", email }; setTimeout(() => listener(user), 200);
      },
      async ponerClaveGrupo() {},
      async entrarConCodigo(email) { user = { id: "demo", email }; setTimeout(() => listener(user), 200); },
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
      S.misVotosLista = d.votos.filter((v) => v.user_id === S.user?.id);
      S.misVotosLista.forEach((v) => (S.misVotos[v.encuesta_id] = v.opcion));
      S.participacion = Object.fromEntries((d.participacion || []).map((x) => [x.persona_id, Number(x.votos)]));
      S.adminIds = new Set(d.admins || []);
      S.migracion = d.migracion !== false;
      S.fotos = d.fotos !== false;
      S.emailsAdmin = d.emailsAdmin || [];
      S.claveGrupo = d.claveGrupo ?? null; // null = aún no se ejecutó 04_clave_grupo.sql
      S.yo = S.user ? S.personas.find((p) => p.user_id && p.user_id === S.user.id) || null : null;
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
  const vistaActual = () => {
    const v = (location.hash.slice(1).match(/^(inicio|planes|encuestas|gente|admin)$/) || ["inicio"])[0];
    return v === "admin" && !S.admin ? "inicio" : v;
  };

  function render() {
    const v = vistaActual();
    $$(".nav a").forEach((a) => a.classList.toggle("activo", a.dataset.nav === v));
    renderCuenta();
    if (!api) { $("#vista").innerHTML = bannerError("BMSN no está conectado a la base de datos (falta config.js)."); return; }
    if (!S.cargado) return;
    const err = S.errorCarga ? bannerError("No se pudieron cargar los datos: " + esc(S.errorCarga)) : "";
    const demo = DEMO ? `<div class="banner"><span>Modo demo: datos inventados, nada se guarda.</span></div>` : "";
    const mig = !S.migracion && S.admin ? bannerError("Falta activar los perfiles: ejecuta <b>supabase/02_perfiles.sql</b> en Supabase.") : "";
    const sinPerfil = S.user && S.migracion && !S.yo && S.cargado ? `<div class="banner"><span>Tu correo aún no está unido a tu perfil.</span><button class="btn chico" data-a="quien-soy">¿Quién eres?</button></div>` : "";
    const inst = v === "inicio" ? bannerInstalar() : "";
    $("#vista").innerHTML = demo + mig + err + sinPerfil + inst + { inicio: vInicio, planes: vPlanes, encuestas: vEncuestas, gente: vGente, admin: vAdmin }[v]();
    document.body.classList.toggle("es-admin", S.admin);
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
    const yo = S.yo || { nombre: S.user.email.split("@")[0] };
    b.innerHTML = `${avatar(yo, "sm")}<span class="txt">${esc(yo.nombre)}</span>${S.admin ? '<span class="insignia mini">Admin</span>' : ""}`;
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
    return `<div class="inicio-grid"><div class="col-a">
      ${selectorPeriodo()}
      <div class="hero">
        <div><div class="display">${planes.length}</div><div class="sub">plan${planes.length === 1 ? "" : "es"} ${etiqueta}</div></div>
        <div class="mini"><b>${dec(prom)}</b><span class="sub">personas por plan</span><b style="margin-top:10px">${casas}</b><span class="sub">en casa de alguien</span></div>
      </div>
      ${resumenMeses()}
      </div><div class="col-b seccion">
        <div class="cab"><span class="eyebrow">Ranking</span>
          <div class="seg">${[["asistencia", "Asistencia"], ["casas", "Puso casa"]].map(([k, l]) => `<button class="${S.metrica === k ? "on" : ""}" data-a="metrica" data-v="${k}">${l}</button>`).join("")}</div>
        </div>
        ${planes.length ? podio + (resto.length ? `<div class="lista">${resto.map((r, i) => `
          <button class="fila" data-a="perfil" data-id="${r.p.id}">
            <span class="pos">${i + 1 + (rk.length - resto.length)}</span>${avatar(r.p)}
            <span class="cuerpo"><div class="nom">${esc(r.p.nombre)}</div>
              <div class="det">${r.asistencias} de ${r.total} planes · 🏠 ${r.casas}</div>
              <div class="barrita"><i style="width:${S.metrica === "casas" ? (r.casas / max) * 100 : (r.pctAsistencia || 0) * 100}%"></i></div>
            </span>
            <span class="der"><div class="big">${val(r)}</div></span>
          </button>`).join("")}</div>` : "")
        : `<div class="vacio"><p>No hay planes en este periodo.</p><button class="btn" data-a="nuevo-plan">＋ Anotar un plan</button></div>`}
      </div></div>`;
  }

  function resumenMeses() {
    const { tipo, valor } = S.periodo;
    if (tipo === "mes") return "";
    const anio = tipo === "anio" ? valor : null;
    const meses = anio ? Array.from({ length: 12 }, (_, i) => `${anio}-${String(i + 1).padStart(2, "0")}`)
      : [...new Set(S.planes.map((p) => p.fecha.slice(0, 7)))].sort().slice(-12);
    if (!meses.length) return "";
    const n = meses.map((m) => S.planes.filter((p) => p.fecha.startsWith(m)).length);
    const max = Math.max(1, ...n);
    return `<div class="seccion meses"><div class="cab"><span class="eyebrow">Planes por mes</span></div>
      <div class="barras">${meses.map((m, i) => `<button class="barra-mes ${m === mesActual() ? "actual" : ""}" data-a="ir-mes" data-v="${m}" title="${nombreMes(m)}: ${n[i]} planes">
        <span class="n">${n[i] || ""}</span><i style="height:${(n[i] / max) * 100}%"></i><span class="m">${MESES[+m.slice(5) - 1].slice(0, 1).toUpperCase()}</span></button>`).join("")}</div></div>`;
  }

  function vPlanes() {
    const head = `<div class="titulo-vista"><h1 class="h2">Planes</h1>
      <div class="seg">${[["cal", "Calendario"], ["lista", "Lista"]].map(([k, l]) => `<button class="${S.vistaPlanes === k ? "on" : ""}" data-a="vista-planes" data-v="${k}">${l}</button>`).join("")}</div></div>`;
    if (S.vistaPlanes === "cal") return head + vCalendario();
    if (!S.planes.length) {
      return head + bannerSesion("Entra con tu correo para anotar planes.") + `<div class="vacio">
        <p>Todavía no hay planes anotados.</p>
        <button class="btn" data-a="nuevo-plan">＋ Anotar el primero</button></div>`;
    }
    const grupos = {};
    S.planes.forEach((p) => (grupos[p.fecha.slice(0, 7)] ??= []).push(p));
    return head + Object.entries(grupos).map(([m, ps]) => `
      <div class="mes-cab"><span>${nombreMes(m)}</span><span>${ps.length}</span></div>
      <div class="rejilla">${ps.map((p) => tarjetaPlan(p, S.yo?.id)).join("")}</div>`).join("");
  }


  // ---------- Calendario ----------
  function vCalendario() {
    const mes = S.calMes || mesActual();
    const [y, m] = mes.split("-").map(Number);
    const pid = S.calPersona === undefined ? S.yo?.id ?? null : S.calPersona;
    const quien = pid ? persona(pid) : null;
    const delMes = S.planes.filter((p) => p.fecha.startsWith(mes));
    const porDia = {};
    delMes.forEach((p) => (porDia[p.fecha] ??= []).push(p));
    const fue = quien ? delMes.filter((p) => p.asistentes.includes(pid)).length : 0;
    const casa = quien ? delMes.filter((p) => p.anfitrion === pid).length : 0;

    const primero = new Date(Date.UTC(y, m - 1, 1));
    const offset = (primero.getUTCDay() + 6) % 7; // lunes primero
    const dias = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const celdas = [];
    for (let i = 0; i < offset; i++) celdas.push(`<span class="dia vacio-dia"></span>`);
    for (let d = 1; d <= dias; d++) {
      const f = `${mes}-${String(d).padStart(2, "0")}`;
      const ps = porDia[f] || [];
      let cls = "", marca = "";
      if (ps.length) {
        if (!quien) cls = "plan";
        else if (ps.some((p) => p.anfitrion === pid)) { cls = "casa"; marca = "🏠"; }
        else if (ps.some((p) => p.asistentes.includes(pid))) { cls = "fue"; marca = "✓"; }
        else { cls = "falto"; marca = "✕"; }
      }
      celdas.push(`<button class="dia ${cls} ${f === hoy() ? "hoy" : ""} ${f === S.calDia ? "sel" : ""}" data-a="cal-dia" data-v="${f}" aria-label="${d} de ${MESES[m - 1]}${ps.length ? `, ${ps.length} plan` : ""}">
        <span class="num">${d}</span>${marca ? `<span class="mk">${marca}</span>` : ps.length ? `<span class="pt"></span>` : ""}${ps.length > 1 ? `<span class="cnt">${ps.length}</span>` : ""}</button>`);
    }

    const dia = S.calDia && S.calDia.startsWith(mes) ? S.calDia : null;
    const planesDia = dia ? porDia[dia] || [] : [];
    const opciones = [`<option value="">Todo el grupo</option>`, ...S.personas.map((p) => `<option value="${p.id}" ${p.id === pid ? "selected" : ""}>${esc(p.nombre)}${S.yo?.id === p.id ? " (tú)" : ""}</option>`)].join("");

    return `<div class="cal-wrap"><div class="cal-col">
      <div class="cal-cab">
        <div class="flechas"><button data-a="cal-mover" data-v="-1" aria-label="Mes anterior">${ICON.izq}</button>
          <span class="lbl cal-mes">${MESES[m - 1]} ${y}</span>
          <button data-a="cal-mover" data-v="1" aria-label="Mes siguiente">${ICON.der}</button></div>
        <label class="ver-como"><span>Ver como</span><select id="cal-persona">${opciones}</select></label>
      </div>
      <div class="cal-resumen">
        ${quien ? `${avatar(quien, "sm")}<span><b>${esc(quien.nombre)}</b> fue a <b class="neon">${fue}</b> de ${delMes.length} plan${delMes.length === 1 ? "" : "es"}${casa ? ` · puso casa <b class="naranja">${casa}</b>` : ""}</span>`
          : `<span><b class="neon">${delMes.length}</b> plan${delMes.length === 1 ? "" : "es"} en ${MESES[m - 1]}</span>`}
      </div>
      <div class="cal">
        ${["L", "M", "X", "J", "V", "S", "D"].map((d) => `<span class="cal-sem">${d}</span>`).join("")}
        ${celdas.join("")}
      </div>
      <div class="leyenda">${quien ? `<span><i class="lg fue"></i>Fue</span><span><i class="lg casa"></i>Puso casa</span><span><i class="lg falto"></i>No fue</span>` : `<span><i class="lg plan"></i>Hubo plan</span>`}<span><i class="lg hoy"></i>Hoy</span></div>
      </div>
      <div class="cal-col cal-detalle">
        ${dia ? `<div class="mes-cab" style="margin-top:0"><span>${diaSemana(dia)} ${+dia.slice(8)} de ${MESES[+dia.slice(5, 7) - 1]}</span><span>${planesDia.length || ""}</span></div>
          ${planesDia.length ? planesDia.map((p) => tarjetaPlan(p, pid)).join("") : `<div class="vacio" style="padding:24px 0"><p>No hubo plan este día.</p></div>`}
          ${S.admin ? `<button class="btn ${planesDia.length ? "sec" : ""} full" data-a="nuevo-plan-dia" data-v="${dia}">＋ Anotar plan este día</button>` : ""}`
        : `<div class="vacio cal-pista"><p>Toca un día para ver sus planes.</p></div>`}
      </div></div>`;
  }

  function tarjetaPlan(p, pid = null) {
    const anf = persona(p.anfitrion);
    const gente = p.asistentes.map(persona).filter(Boolean);
    const estado = !pid ? "" : p.anfitrion === pid ? `<span class="estado-plan casa">🏠 Puso casa</span>` : p.asistentes.includes(pid) ? `<span class="estado-plan fue">✓ Fue</span>` : `<span class="estado-plan falto">✕ No fue</span>`;
    return `<button class="plan" data-a="ver-plan" data-id="${p.id}">
      <span class="fecha-bloque"><b>${+p.fecha.slice(8)}</b><span>${diaSemana(p.fecha)}</span></span>
      <span class="cuerpo">
        <div class="tit">${esc(p.titulo)}</div>
        <div class="casa">${anf ? `en casa de <em>${esc(anf.nombre)}</em>` : "fuera de casa"} · ${gente.length} personas</div>
        <div class="pila">${gente.slice(0, 6).map((g) => avatar(g, "sm")).join("")}${gente.length > 6 ? `<span class="av sm mas">+${gente.length - 6}</span>` : ""}</div>
        ${estado}
      </span>
    </button>`;
  }

  // ---------- Panel de admin ----------
  function vAdmin() {
    const conCuenta = S.personas.filter((p) => p.user_id);
    const sinCuenta = S.personas.filter((p) => !p.user_id);
    const yoEmail = S.user?.email?.toLowerCase();
    return `<div class="titulo-vista"><h1 class="h2">Panel de admin</h1><span class="insignia">Admin</span></div>
      ${!S.migracion ? bannerError("Falta ejecutar <b>supabase/02_perfiles.sql</b> en Supabase.") : !S.fotos ? `<div class="banner"><span>Para activar las fotos de perfil ejecuta <b>supabase/03_fotos_admin.sql</b> en Supabase.</span></div>` : ""}
      <div class="stats admin-stats">
        <div class="stat"><b>${S.personas.length}</b><span>personas</span></div>
        <div class="stat"><b>${conCuenta.length}</b><span>con cuenta</span></div>
        <div class="stat"><b>${S.planes.length}</b><span>planes</span></div>
        <div class="stat"><b>${S.encuestas.length}</b><span>encuestas</span></div>
      </div>
      <div class="seccion"><div class="cab"><span class="eyebrow">Acciones rápidas</span></div>
        <div class="acciones-admin">
          <button class="accion" data-a="nuevo-plan"><span class="ai">＋</span>Anotar plan</button>
          <button class="accion" data-a="nueva-persona"><span class="ai">👤</span>Añadir personas</button>
          <button class="accion" data-a="nueva-encuesta"><span class="ai">☑</span>Nueva encuesta</button>
          <button class="accion" data-a="csv"><span class="ai">⬇</span>Descargar datos</button>
        </div></div>
      <div class="admin-grid">
        <div class="seccion"><div class="cab"><span class="eyebrow">Cuentas · ${conCuenta.length} de ${S.personas.length}</span></div>
          <p class="sub" style="margin:-4px 0 12px">Cuando alguien entra con su correo y elige su nombre, su perfil queda unido a su cuenta.</p>
          <div class="lista">${[...conCuenta, ...sinCuenta].map((p) => `<button class="fila" data-a="perfil" data-id="${p.id}">${avatar(p)}
            <span class="cuerpo"><div class="nom">${esc(p.nombre)}${insignias(p, true)}</div>
            <div class="det">${p.user_id ? `Con cuenta desde ${p.vinculado ? fechaCorta(p.vinculado.slice(0, 10)) : "—"}` : "Sin cuenta todavía"}</div></span>
            <span class="estado-cuenta ${p.user_id ? "si" : ""}">${p.user_id ? "✓" : "—"}</span></button>`).join("") || `<div class="vacio"><p>Aún no hay personas.</p></div>`}</div>
        </div>
        <div>
        <div class="seccion"><div class="cab"><span class="eyebrow">Contraseña del grupo</span>
          <span class="estado ${S.claveGrupo ? "" : "cerrada"}">${S.claveGrupo ? "Activa" : S.claveGrupo === false ? "Sin poner" : "Falta SQL"}</span></div>
          ${S.claveGrupo === null ? `<p class="sub">Ejecuta <b>supabase/04_clave_grupo.sql</b> en Supabase para activarla.</p>` : `
          <p class="sub" style="margin:-4px 0 12px">Quien la sepa entra con su correo sin verificarlo. Tu correo de admin siempre entra con enlace.</p>
          <form id="f-clave-grupo" class="form-linea" autocomplete="off">
            <input type="text" name="clave" placeholder="${S.claveGrupo ? "Nueva contraseña" : "Contraseña del grupo"}" required>
            <button class="btn chico" type="submit">${S.claveGrupo ? "Cambiar" : "Guardar"}</button>
          </form>`}
        </div>
        <div class="seccion"><div class="cab"><span class="eyebrow">Admins</span></div>
          <div class="lista">${S.emailsAdmin.map((e) => `<div class="fila"><span class="cuerpo"><div class="nom" style="text-transform:none">${esc(e)}</div>
            <div class="det">${e === yoEmail ? "Tú" : "Admin"}</div></span>
            ${e !== yoEmail ? `<button class="btn peligro chico" data-a="quitar-admin" data-v="${esc(e)}">Quitar</button>` : ""}</div>`).join("")}</div>
          <form id="f-admin" class="form-linea" style="margin-top:12px" autocomplete="off">
            <input type="email" name="email" placeholder="correo@gmail.com" required>
            <button class="btn chico" type="submit">Hacer admin</button>
          </form>
          <p class="sub" style="font-size:12.5px;margin-top:8px">Esa persona podrá anotar planes, gente y encuestas.</p>
        </div>
        </div>
      </div>`;
  }

  function descargarCSV() {
    const c = (t) => `"${String(t ?? "").replace(/"/g, '""')}"`;
    const filas = [["fecha", "plan", "puso casa", "asistentes", "nº asistentes", "notas"].map(c).join(",")];
    [...S.planes].sort((a, b) => a.fecha.localeCompare(b.fecha)).forEach((p) => {
      filas.push([p.fecha, p.titulo, persona(p.anfitrion)?.nombre || "", p.asistentes.map((x) => persona(x)?.nombre).filter(Boolean).join("; "), p.asistentes.length, p.notas].map(c).join(","));
    });
    const blob = new Blob(["﻿" + filas.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `bmsn-planes-${hoy()}.csv` });
    document.body.append(a); a.click(); a.remove();
    toast("Descargado");
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
      (vigentes.length ? `<div class="rejilla enc">${vigentes.map(tarjetaEncuesta).join("")}</div>`
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
    return head + bannerSesion("Entra con tu correo para editar.") + `<div class="lista gente">${S.personas.map((p) => {
      const r = st[p.id];
      return `<button class="fila ${S.yo?.id === p.id ? "yo" : ""}" data-a="perfil" data-id="${p.id}">${avatar(p)}
        <span class="cuerpo"><div class="nom">${esc(p.nombre)}${insignias(p, true)}</div><div class="det">${p.bio ? esc(p.bio) : `${r.asistencias} planes · 🏠 ${r.casas}`}</div></span>
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

  let modoLogin = null;
  function hojaLogin(motivo = "", modo) {
    const conClave = S.claveGrupo === true;
    modoLogin = modo || modoLogin || (conClave ? "clave" : "enlace");
    if (!conClave) modoLogin = "enlace";
    const correo = esc(leer("bmsn-correo") || "");
    abrirHoja(`${cabHoja("Entrar")}
      ${motivo ? `<p class="sub" style="margin:-6px 0 16px">${motivo}</p>` : ""}
      ${conClave ? `<div class="seg seg-full" style="margin-bottom:18px">
        <button class="${modoLogin === "clave" ? "on" : ""}" data-a="modo-login" data-v="clave">Contraseña del grupo</button>
        <button class="${modoLogin === "enlace" ? "on" : ""}" data-a="modo-login" data-v="enlace">Enlace por correo</button></div>` : ""}
      ${modoLogin === "clave" ? `
      <form id="f-clave" autocomplete="on">
        <p class="sub" style="margin:0 0 16px">Escribe tu correo y la contraseña del grupo. Entras al momento, sin verificar nada.</p>
        <label class="campo"><span>Tu correo</span><input type="email" name="email" required autocomplete="username" placeholder="nombre@gmail.com" value="${correo}"></label>
        <label class="campo"><span>Contraseña del grupo</span><div class="pass"><input type="password" name="clave" required autocomplete="current-password" placeholder="La que te pasaron en el grupo"><button type="button" class="ver-pass" data-a="ver-pass" aria-label="Mostrar contraseña">👁</button></div></label>
        <p class="ayuda" style="margin:-8px 0 16px">Da igual mayúsculas, tildes o espacios.</p>
        <button class="btn full" type="submit">Entrar</button>
      </form>` : `
      <p class="sub" style="margin:0 0 16px">Te enviamos un enlace a tu correo. Sin contraseñas.</p>
      <form id="f-login">
        <label class="campo"><span>Tu correo</span><input type="email" name="email" required autocomplete="email" placeholder="nombre@gmail.com" value="${correo}"></label>
        <button class="btn full" type="submit">Enviarme el enlace</button>
      </form>
      ${APP.standalone ? `<div style="height:16px"></div>${formPegarEnlace()}` : ""}`}`);
    setTimeout(() => { const i = $(correo ? "#hoja [name=clave], #f-login [name=email]" : "#hoja [name=email]"); i?.focus(); }, 250);
  }
  function hojaLoginEnviado(email) {
    abrirHoja(`${cabHoja("Revisa tu correo")}
      <div class="vacio" id="login-enviado" style="padding:10px 0">
        <div class="display" style="font-size:60px">✉︎</div>
        <p>Enviamos un correo a <b style="color:var(--ink)">${esc(email)}</b>.<br>Escribe el código o abre el enlace <b style="color:var(--ink)">en este mismo dispositivo</b>.</p>
      </div>
      <form id="f-codigo" data-email="${esc(email)}" autocomplete="off">
        <label class="campo"><span>Código del correo</span><input name="codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="123456" class="input-codigo"></label>
        <button class="btn full" type="submit">Entrar con el código</button>
      </form>
      <p class="sub" style="font-size:13px;text-align:center;margin:14px 0">¿No llega? Mira en spam o espera un minuto.</p>
      ${formPegarEnlace()}
      <button class="btn sec full" data-a="login">Usar otro correo</button>`);
  }
  function formPegarEnlace() {
    return `<form id="f-enlace" class="pegar-enlace ${APP.standalone ? "destacado" : ""}" autocomplete="off">
      <div class="h3">${APP.standalone ? "📲 Estás en la app" : "¿Usas BMSN como app?"}</div>
      <p class="sub">${APP.ios ? "En iPhone el enlace se abre en Safari. Para entrar en la app: en el correo <b>mantén pulsado el botón del enlace → Copiar enlace</b> y pégalo aquí." : "Si el enlace se abre en otro sitio, cópialo desde el correo y pégalo aquí."}</p>
      <div class="form-linea"><input name="enlace" inputmode="url" placeholder="Pega el enlace del correo" required><button class="btn chico" type="submit">Entrar</button></div>
    </form>`;
  }

  // ---------- App instalable ----------
  const APP = {
    standalone: matchMedia("(display-mode: standalone)").matches || navigator.standalone === true,
    ios: /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
    android: /android/i.test(navigator.userAgent),
    aviso: null,
  };
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); APP.aviso = e; render(); });
  window.addEventListener("appinstalled", () => { APP.aviso = null; toast("BMSN instalada ✓"); render(); });
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  const puedeInstalar = () => !APP.standalone;
  const leer = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

  function bannerInstalar() {
    if (!puedeInstalar() || leer("bmsn-sin-banner") || !(APP.ios || APP.android || APP.aviso)) return "";
    return `<div class="banner instalar"><span class="ico-app"></span><span><b>Instala BMSN</b><br><span class="sub">Ábrela desde tu pantalla de inicio, como una app.</span></span>
      <button class="btn chico" data-a="instalar">Instalar</button><button class="cerrar chico" data-a="no-banner" aria-label="Ocultar">${ICON.cerrar}</button></div>`;
  }

  async function instalar() {
    if (APP.aviso) {
      APP.aviso.prompt();
      const r = await APP.aviso.userChoice.catch(() => null);
      APP.aviso = null;
      if (r?.outcome === "accepted") guardar("bmsn-sin-banner", "1");
      return render();
    }
    const compartir = `<svg viewBox="0 0 24 24" class="ico-inline"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>`;
    const pasos = APP.ios
      ? [[compartir, `Toca <b>Compartir</b> en la barra de Safari${navigator.maxTouchPoints > 1 && !/iphone/i.test(navigator.userAgent) ? " (arriba a la derecha en iPad)" : " (abajo)"}.`],
         ["＋", `Elige <b>Añadir a pantalla de inicio</b>. Si no aparece, desliza la lista hacia abajo.`],
         ["✓", `Pulsa <b>Añadir</b>. BMSN aparecerá con su icono junto a tus apps.`]]
      : APP.android
        ? [["⋮", "Abre el menú <b>⋮</b> de Chrome (arriba a la derecha)."], ["＋", "Toca <b>Instalar app</b> o <b>Añadir a pantalla de inicio</b>."], ["✓", "Confirma. BMSN quedará en tu cajón de apps."]]
        : [["⊕", "En Chrome o Edge, pulsa el icono <b>Instalar</b> al final de la barra de direcciones."], ["✓", "Confirma. BMSN se abrirá en su propia ventana."]];
    abrirHoja(`${cabHoja("Instalar BMSN")}
      <div class="instalar-cab"><img src="icons/icon-192.png" alt="" width="72" height="72"><div><div class="h3">BMSN</div><div class="sub">Gratis · sin tienda de apps · se actualiza sola</div></div></div>
      ${APP.ios && !/safari/i.test(navigator.userAgent.replace(/crios|fxios|edgios/i, "x")) ? `<div class="banner error" style="margin-bottom:14px"><span>En iPhone y iPad hay que abrir este link en <b>Safari</b> para poder instalarla.</span></div>` : ""}
      <ol class="pasos">${pasos.map(([i, t], n) => `<li><span class="paso-n">${i}</span><span>${t}</span></li>`).join("")}</ol>
      ${APP.ios ? `<p class="sub" style="font-size:13px">Al abrirla por primera vez tendrás que entrar con tu correo otra vez (la app y Safari no comparten la sesión).</p>` : ""}
      <button class="btn full" data-a="cerrar">Entendido</button>`);
  }

  function hojaCuenta() {
    if (S.yo) return hojaPerfil(S.yo.id);
    abrirHoja(`${cabHoja("Tu cuenta")}
      <div class="perfil-cab">${avatar({ nombre: S.user.email }, "xl")}<div><div class="h3">${esc(S.user.email)}</div>
      <div class="sub">${S.admin ? "Admin de BMSN" : "Miembro"} · sin perfil todavía</div></div></div>
      ${S.migracion ? `<button class="btn full" data-a="quien-soy">Elegir mi perfil</button><div style="height:10px"></div>` : ""}
      ${S.admin ? `<button class="btn sec full" data-a="ir-admin">⚙ Panel de admin</button><div style="height:10px"></div>` : ""}
      ${puedeInstalar() ? `<button class="btn linea full" data-a="instalar">📲 Instalar BMSN como app</button><div style="height:10px"></div>` : ""}
      <button class="btn linea full" data-a="salir">Cerrar sesión</button>`);
  }

  // "¿Quién eres?": une el correo a una persona de BMSN
  function hojaQuienSoy() {
    const libres = S.personas.filter((p) => !p.user_id);
    abrirHoja(`${cabHoja("¿Quién eres?", "Bienvenido a BMSN")}
      <p class="sub" style="margin:-6px 0 18px">Escribe tu nombre. Si ya estás en BMSN, tu correo se une a tu perfil con todas tus estadísticas.</p>
      <form id="f-quien" autocomplete="off">
        <input class="input-grande" name="nombre" maxlength="40" placeholder="Tu nombre" required>
        <p class="ayuda" id="quien-pista" style="margin-top:10px">&nbsp;</p>
        ${libres.length ? `<div class="campo"><span>O toca tu perfil</span><div class="gente-grid">${libres.map((p) => `
          <button type="button" class="persona-sel" data-a="soy" data-id="${p.id}">${avatar(p)}<span>${esc(p.nombre)}</span></button>`).join("")}</div></div>` : ""}
        <div class="pie-hoja"><button class="btn full" type="submit">Este soy yo</button></div>
      </form>`);
    setTimeout(() => $("#f-quien [name=nombre]")?.focus(), 250);
  }

  function insignias(p, compactas = false) {
    const b = [];
    if (S.adminIds?.has(p.id)) b.push('<span class="insignia">Admin</span>');
    if (S.yo?.id === p.id) b.push('<span class="insignia tu">Tú</span>');
    else if (p.user_id && !compactas) b.push('<span class="insignia gris">Cuenta verificada</span>');
    return b.length ? ` ${b.join(" ")}` : "";
  }

  function actividad(p) {
    const ev = [];
    S.planes.forEach((x) => {
      if (x.anfitrion === p.id) ev.push({ f: x.fecha, i: "🏠", t: `Puso casa: <b>${esc(x.titulo)}</b>`, a: "ver-plan", id: x.id });
      else if (x.asistentes.includes(p.id)) ev.push({ f: x.fecha, i: "✓", t: `Fue a <b>${esc(x.titulo)}</b>`, a: "ver-plan", id: x.id });
    });
    if (S.yo?.id === p.id) {
      (S.misVotosLista || []).forEach((v) => {
        const e = S.encuestas.find((x) => x.id === v.encuesta_id);
        if (e) ev.push({ f: (v.fecha || e.mes + "-01").slice(0, 10), i: "☑", t: `Votó <b>${esc(v.opcion)}</b> en «${esc(e.pregunta)}»`, a: "ver-encuesta", id: e.id });
      });
    }
    if (p.vinculado) ev.push({ f: p.vinculado.slice(0, 10), i: "★", t: "Se unió a BMSN con su correo" });
    return ev.sort((a, b) => b.f.localeCompare(a.f));
  }

  function hojaPerfil(id, todo = false) {
    const p = persona(id);
    if (!p) return;
    const r = stats(S.planes).find((x) => x.p.id === id);
    const votos = S.yo?.id === id ? (S.misVotosLista || []).length : S.participacion?.[id] || 0;
    const propio = S.yo?.id === id;
    const ev = actividad(p);
    const lista = todo ? ev : ev.slice(0, 8);
    abrirHoja(`<div class="hoja-cab"><span></span><button class="cerrar" data-a="cerrar" aria-label="Cerrar">${ICON.cerrar}</button></div>
      <div class="perfil-cab" style="margin-top:-28px">${avatar(p, "xl")}<div style="min-width:0">
        <div class="h2">${esc(p.nombre)}</div>
        <div class="insignias">${insignias(p)}</div>
        ${p.bio ? `<div class="bio">${esc(p.bio)}</div>` : propio ? `<div class="sub">Añade una frase en Editar perfil</div>` : ""}
      </div></div>
      <div class="stats">
        <div class="stat"><b>${pct(r.pctAsistencia)}</b><span>asistencia · ${r.asistencias} de ${r.total}</span></div>
        <div class="stat"><b>${r.casas}</b><span>puso casa · ${pct(r.pctCasa)}</span></div>
        <div class="stat"><b>${r.racha}</b><span>racha actual</span></div>
        <div class="stat"><b>${votos}</b><span>${votos === 1 ? "encuesta votada" : "encuestas votadas"}</span></div>
      </div>
      <div class="seccion" style="margin-top:24px"><div class="cab"><span class="eyebrow">Actividad</span><span class="sub">${dec(r.promMes)} planes/mes</span></div>
        ${lista.length ? `<div class="timeline">${lista.map((x) => `<${x.a ? `button data-a="${x.a}" data-id="${x.id}"` : "div"} class="ev">
          <span class="ic">${x.i}</span><span class="tx">${x.t}</span><span class="fe">${fechaCorta(x.f)}</span></${x.a ? "button" : "div"}>`).join("")}</div>
          ${!todo && ev.length > lista.length ? `<button class="link" style="margin-top:12px" data-a="perfil-todo" data-id="${id}">Ver toda la actividad (${ev.length})</button>` : ""}`
        : `<p class="sub">Todavía sin actividad.</p>`}
      </div>
      <div class="acciones-pie">
        ${propio || S.admin ? `<button class="btn" data-a="editar-perfil" data-id="${id}">Editar perfil</button>` : ""}
        ${propio ? `<button class="btn linea" data-a="salir">Cerrar sesión</button>` : ""}
      </div>
      ${propio && S.admin ? `<button class="btn sec full" style="margin-top:10px" data-a="ir-admin">⚙ Panel de admin</button>` : ""}
      ${propio && puedeInstalar() ? `<button class="btn linea full" style="margin-top:10px" data-a="instalar">📲 Instalar BMSN como app</button>` : ""}
      ${S.admin && !propio ? `<div class="acciones-pie" style="margin-top:10px">
        ${p.user_id ? `<button class="btn sec" data-a="desvincular" data-id="${id}">Soltar cuenta</button>` : ""}
        <button class="btn peligro" data-a="borrar-persona" data-id="${id}">Borrar</button></div>` : ""}`);
  }

  // Recorta al centro y reduce a 480×480 JPEG antes de subir.
  async function reducirImagen(file) {
    if (!file.type.startsWith("image/")) throw new Error("Elige una imagen");
    const img = await new Promise((ok, mal) => {
      const i = new Image(); i.onload = () => ok(i); i.onerror = () => mal(new Error("No se pudo leer la imagen"));
      i.src = URL.createObjectURL(file);
    });
    const lado = Math.min(img.naturalWidth, img.naturalHeight), T = 480;
    const c = Object.assign(document.createElement("canvas"), { width: T, height: T });
    c.getContext("2d").drawImage(img, (img.naturalWidth - lado) / 2, (img.naturalHeight - lado) / 2, lado, lado, 0, 0, T, T);
    URL.revokeObjectURL(img.src);
    return new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.85));
  }

  let edicion = null;
  function hojaEditarPerfil(id) {
    const p = persona(id);
    edicion ??= { id, nombre: p.nombre, bio: p.bio || "", emoji: p.emoji || "", color: Number.isInteger(p.color) ? p.color : null, foto: p.foto || null };
    const e = edicion;
    const vista = { nombre: e.nombre || "?", emoji: e.emoji, color: e.color ?? tono(p.nombre), foto: e.foto };
    abrirHoja(`${cabHoja(S.yo?.id === id ? "Tu perfil" : "Editar perfil")}
      <form id="f-perfil" autocomplete="off">
        <div class="perfil-cab">${avatar(vista, "xl")}<div style="flex:1;min-width:0">
          <input class="input-grande" name="nombre" maxlength="40" value="${esc(e.nombre)}" placeholder="Nombre" required></div></div>
        ${S.fotos ? `<div class="campo"><span>Foto de perfil</span><div class="foto-acc">
          <button type="button" class="btn sec chico" data-a="subir-foto">📷 ${e.foto ? "Cambiar foto" : "Subir foto"}</button>
          ${e.foto ? `<button type="button" class="btn peligro chico" data-a="quitar-foto" data-id="${id}">Quitar</button>` : ""}
          <input type="file" id="input-foto" accept="image/*" hidden></div>
          <p class="ayuda" style="margin:8px 0 0">${e.foto ? "La foto se muestra en lugar del emoji." : "Si no subes foto, se usa el emoji o tus iniciales."}</p></div>` : ""}
        <label class="campo"><span>Tu frase</span><input name="bio" maxlength="140" value="${esc(e.bio)}" placeholder="Ej: el que siempre pone la música"></label>
        <div class="campo"><span>Avatar</span><div class="emojis">
          <button type="button" class="emo ${!e.emoji ? "on" : ""}" data-a="emo" data-v="">${esc(iniciales(e.nombre || "?"))}</button>
          ${EMOJIS.map((x) => `<button type="button" class="emo ${e.emoji === x ? "on" : ""}" data-a="emo" data-v="${x}">${x}</button>`).join("")}</div></div>
        <div class="campo"><span>Color</span><div class="colores">
          ${COLORES.map((h) => `<button type="button" class="col ${e.color === h ? "on" : ""}" data-a="col" data-v="${h}" style="--h:${h}" aria-label="Color"></button>`).join("")}</div></div>
        <div class="pie-hoja"><button class="btn full" type="submit">Guardar perfil</button></div>
      </form>`);
  }
  function guardarEdicion() {
    const f = $("#f-perfil");
    if (f && edicion) { edicion.nombre = f.nombre.value; edicion.bio = f.bio.value; }
  }
  function repintarEdicion() { const y = hoja.scrollTop; hojaEditarPerfil(edicion.id); hoja.scrollTop = y; }

  // Formulario rápido de plan
  let borrador = null;
  function nuevoBorrador(plan, fecha) {
    const titulos = [...new Set(S.planes.map((p) => p.titulo))].slice(0, 6);
    borrador = plan
      ? { id: plan.id, titulo: plan.titulo, fecha: plan.fecha, notas: plan.notas || "", asistentes: new Set(plan.asistentes), anfitrion: plan.anfitrion, titulos }
      : { id: null, titulo: "", fecha: fecha || hoy(), notas: "", asistentes: new Set(), anfitrion: null, titulos };
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
    "ir-mes": (d) => { S.periodo = { tipo: "mes", valor: d.v }; render(); },
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
    "quien-soy": () => hojaQuienSoy(),
    instalar: () => instalar(),
    "modo-login": (d) => hojaLogin("", d.v),
    "ver-pass": (d, el) => { const i = el.previousElementSibling; i.type = i.type === "password" ? "text" : "password"; },
    "no-banner": () => { guardar("bmsn-sin-banner", "1"); render(); },
    "vista-planes": (d) => { S.vistaPlanes = d.v; render(); },
    "cal-mover": (d) => {
      const [y, m] = (S.calMes || mesActual()).split("-").map(Number);
      const t = new Date(Date.UTC(y, m - 1 + Number(d.v), 1));
      S.calMes = t.toISOString().slice(0, 7); S.calDia = null; render();
    },
    "cal-dia": (d) => {
      S.calDia = S.calDia === d.v ? null : d.v; render();
      if (S.calDia && innerWidth < 1024) setTimeout(() => $(".cal-detalle")?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
    },
    "nuevo-plan-dia": (d) => {
      if (!exigirAdmin("Entra con tu correo de admin para anotar planes.")) return;
      nuevoBorrador(null, d.v); hojaPlan();
    },
    "ir-admin": () => { cerrarHoja(); location.hash = "#admin"; },
    csv: () => descargarCSV(),
    "quitar-admin": async (d) => { if (confirm(`¿Quitar a ${d.v} como admin?`)) await hacer(() => api.quitarAdmin(d.v), "Admin quitado"); },
    "subir-foto": () => $("#input-foto")?.click(),
    "quitar-foto": async (d) => { if (await hacer(() => api.quitarFoto(d.id), "Foto quitada")) { edicion.foto = null; repintarEdicion(); } },
    soy: async (d) => {
      const p = persona(d.id);
      if (!confirm(`¿Eres ${p.nombre}? Tu correo quedará unido a este perfil.`)) return;
      if (await hacer(() => api.vincular(d.id, null), `¡Hola, ${p.nombre}!`)) hojaPerfil(d.id);
    },
    "perfil-todo": (d) => hojaPerfil(d.id, true),
    "editar-perfil": (d) => { edicion = null; hojaEditarPerfil(d.id); },
    emo: (d) => { guardarEdicion(); edicion.emoji = d.v; repintarEdicion(); },
    col: (d) => { guardarEdicion(); edicion.color = Number(d.v); repintarEdicion(); },
    desvincular: async (d) => {
      if (confirm(`¿Soltar la cuenta de ${persona(d.id).nombre}? Su correo tendrá que elegir perfil otra vez.`) && await hacer(() => api.desvincular(d.id), "Cuenta soltada")) hojaPerfil(d.id);
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

  document.addEventListener("input", (ev) => {
    if (!ev.target.matches("#f-quien [name=nombre]")) return;
    const n = ev.target.value.trim().toLowerCase();
    const p = n && S.personas.find((x) => x.nombre.toLowerCase() === n);
    $("#quien-pista").innerHTML = !n ? "&nbsp;" : p ? (p.user_id ? "⚠️ Ese perfil ya pertenece a otra cuenta." : `✓ Te unirás al perfil de <b>${esc(p.nombre)}</b> con sus estadísticas.`) : "Se creará un perfil nuevo con ese nombre.";
  });

  document.addEventListener("change", async (ev) => {
    if (ev.target.id === "cal-persona") { S.calPersona = ev.target.value || null; render(); return; }
    if (ev.target.id === "input-foto" && ev.target.files[0]) {
      const id = edicion?.id;
      try {
        toast("Subiendo foto…");
        const blob = await reducirImagen(ev.target.files[0]);
        await api.subirFoto(id, blob);
        toast("Foto actualizada");
        await cargar();
        guardarEdicion(); edicion.foto = persona(id)?.foto; repintarEdicion();
      } catch (e) { toast(msgError(e), true); }
      return;
    }
    if (ev.target.matches("#f-plan [name=fecha]") && ev.target.value) { guardarCampos(); borrador.fecha = ev.target.value; repintarPlan(); }
  });

  document.addEventListener("submit", async (ev) => {
    const f = ev.target;
    ev.preventDefault();
    const btn = f.querySelector("[type=submit]");
    if (f.id === "f-login") {
      const email = f.email.value.trim().toLowerCase();
      btn.disabled = true; btn.textContent = "Enviando…";
      try { await api.entrar(email); guardar("bmsn-correo", email); if (!S.user) hojaLoginEnviado(email); }
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
    if (f.id === "f-codigo") {
      const codigo = f.codigo.value.replace(/\D/g, "");
      if (codigo.length < 6) return toast("El código tiene 6 números", true);
      btn.disabled = true; btn.textContent = "Comprobando…";
      try { await api.entrarConCodigo(f.dataset.email, codigo); }
      catch (e) { toast(msgError(e), true); btn.disabled = false; btn.textContent = "Entrar con el código"; }
      return;
    }
    if (f.id === "f-clave") {
      const email = f.email.value.trim().toLowerCase();
      btn.disabled = true; btn.textContent = "Entrando…";
      try { await api.entrarConClave(email, f.clave.value); guardar("bmsn-correo", email); }
      catch (e) { toast(msgError(e), true); btn.disabled = false; btn.textContent = "Entrar"; }
      return;
    }
    if (f.id === "f-clave-grupo") {
      const clave = f.clave.value;
      if (normalizarClave(clave).length < 6) return toast("Mínimo 6 caracteres", true);
      btn.disabled = true;
      if (await hacer(() => api.ponerClaveGrupo(clave), "Contraseña del grupo guardada")) f.reset();
      btn.disabled = false;
      return;
    }
    if (f.id === "f-enlace") {
      btn.disabled = true; btn.textContent = "…";
      try { await api.entrarConEnlace(f.enlace.value); cerrarHoja(); }
      catch (e) { toast(msgError(e), true); btn.disabled = false; btn.textContent = "Entrar"; }
      return;
    }
    if (f.id === "f-admin") {
      const email = f.email.value.trim().toLowerCase();
      if (S.emailsAdmin.includes(email)) return toast("Ya es admin", true);
      btn.disabled = true;
      await hacer(() => api.agregarAdmin(email), `${email} ahora es admin`);
      return;
    }
    if (f.id === "f-quien") {
      const nombre = f.nombre.value.trim().replace(/\s+/g, " ");
      if (!nombre) return;
      const existe = S.personas.find((p) => p.nombre.toLowerCase() === nombre.toLowerCase());
      if (existe && existe.user_id) return toast("Ese nombre ya pertenece a otra cuenta", true);
      btn.disabled = true;
      if (await hacer(() => api.vincular(null, nombre), existe ? `¡Hola, ${existe.nombre}! Tu perfil ya tiene tus datos` : `¡Bienvenido, ${nombre}!`)) {
        if (S.yo) hojaPerfil(S.yo.id); else cerrarHoja();
      } else btn.disabled = false;
    }
    if (f.id === "f-perfil") {
      guardarEdicion();
      const e = edicion;
      const nombre = e.nombre.trim().replace(/\s+/g, " ");
      if (!nombre) return toast("Pon un nombre", true);
      btn.disabled = true;
      const propio = S.yo?.id === e.id;
      if (await hacer(() => api.editarPerfil(e.id, { nombre, bio: e.bio.trim(), emoji: e.emoji, color: e.color }, propio), "Perfil guardado")) {
        edicion = null; hojaPerfil(e.id);
      } else btn.disabled = false;
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
  document.addEventListener("keydown", (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey || hoja.open || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
    const k = ev.key.toLowerCase();
    if (k === "n") { ev.preventDefault(); acciones["nuevo-plan"](); }
    const rutas = { 1: "inicio", 2: "planes", 3: "encuestas", 4: "gente", 5: "admin" };
    if (rutas[k]) location.hash = "#" + rutas[k];
  });
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
      if (hoja.open && $("#f-login, #login-enviado, #f-clave, #f-enlace, #f-codigo")) cerrarHoja();
      if (/access_token|error_description/.test(location.hash)) history.replaceState(null, "", location.pathname + location.search);
      if (habia || DEMO) toast(S.admin ? "Entraste como admin" : "Sesión iniciada");
    }
    await cargar();
    if (S.user && S.migracion && !S.yo && !S.errorCarga) hojaQuienSoy();
    else if (new URLSearchParams(location.search).get("accion") === "nuevo") {
      const q = new URLSearchParams(location.search); q.delete("accion");
      history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q : "") + location.hash);
      acciones["nuevo-plan"]();
    }
  });
})();
