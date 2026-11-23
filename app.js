/* BMSN — interfaz sobre Supabase. */
(() => {
  "use strict";

  const S = {
    personas: [], planes: [], encuestas: [], resultados: [], misVotos: {}, votosAdmin: [],
    user: null, admin: false, orden: { campo: "asistencias", asc: false },
  };
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = (x) => (isFinite(x) ? Math.round(x * 100) + "%" : "—");
  const dec = (x) => (isFinite(x) ? x.toFixed(1).replace(".", ",") : "—");
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const nombreMes = (m) => { const [y, mm] = m.split("-"); return `${MESES[+mm - 1]} ${y}`; };
  const fechaLarga = (f) => { const [y, m, d] = f.split("-"); return `${+d} ${MESES[+m - 1].slice(0, 3)} ${y}`; };
  const TZ = "America/Lima"; // igual que bmsn_mes_actual() en supabase/esquema.sql

  function mesActual() {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" }).formatToParts(new Date());
    return `${p.find((x) => x.type === "year").value}-${p.find((x) => x.type === "month").value}`;
  }
  const hoy = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());

  function aviso(html, tipo = "") {
    const a = $("#aviso");
    a.innerHTML = html;
    a.className = "aviso " + tipo;
    a.hidden = !html;
    if (html) window.scrollTo({ top: 0, behavior: "smooth" });
  }
  const errorMsg = (e) => esc(e?.message || e?.error_description || String(e));

  // ---------- Supabase ----------
  const cfg = window.BMSN_CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabaseKey || !window.supabase) {
    aviso("BMSN todavía no está conectado a la base de datos (falta <code>config.js</code>).", "error");
    return;
  }
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);

  async function q(promesa) {
    const { data, error } = await promesa;
    if (error) throw error;
    return data;
  }

  async function cargarDatos() {
    const [personas, planes, asist, encuestas, resultados] = await Promise.all([
      q(sb.from("personas").select("id,nombre").order("nombre")),
      q(sb.from("planes").select("id,fecha,titulo,anfitrion,notas").order("fecha", { ascending: false })),
      q(sb.from("asistencias").select("plan_id,persona_id")),
      q(sb.from("encuestas").select("id,mes,pregunta,opciones,creado").order("mes", { ascending: false }).order("creado", { ascending: false })),
      q(sb.rpc("resultados")),
    ]);
    const porPlan = {};
    asist.forEach((a) => (porPlan[a.plan_id] ??= []).push(a.persona_id));
    S.personas = personas;
    S.planes = planes.map((p) => ({ ...p, asistentes: porPlan[p.id] || [] }));
    S.encuestas = encuestas;
    S.resultados = resultados;
    S.misVotos = {};
    S.votosAdmin = [];
    if (S.user) {
      const votos = await q(sb.from("votos").select("encuesta_id,user_id,email,opcion,fecha"));
      votos.filter((v) => v.user_id === S.user.id).forEach((v) => (S.misVotos[v.encuesta_id] = v.opcion));
      if (S.admin) S.votosAdmin = votos;
    }
  }

  async function refrescar() {
    try {
      await cargarDatos();
      pintarTodo();
    } catch (e) {
      aviso("No se pudieron cargar los datos: " + errorMsg(e), "error");
    }
  }

  // ---------- Sesión ----------
  async function actualizarSesion(session) {
    S.user = session?.user ?? null;
    S.admin = false;
    if (S.user) {
      try { S.admin = await q(sb.rpc("reclamar_admin")); } catch { S.admin = false; }
    }
    document.body.classList.toggle("admin", S.admin);
    $("#sesion").innerHTML = S.user
      ? `<span class="correo" title="${esc(S.user.email)}">${S.admin ? "👑 " : ""}${esc(S.user.email)}</span><button class="btn sec peq" id="btn-salir">Salir</button>`
      : `<button class="btn peq" id="btn-entrar">Entrar</button>`;
    await refrescar();
  }

  function abrirLogin() {
    $("#form-email").hidden = false;
    $("#enviado").hidden = true;
    $("#err-login").textContent = "";
    $("#dlg-login").showModal();
    $("#form-email [name=email]").focus();
  }

  // ---------- Estadísticas ----------
  function planesDelPeriodo(per) {
    return !per || per === "todo" ? S.planes : S.planes.filter((p) => p.fecha.startsWith(per));
  }

  function estadisticas(planes) {
    const meses = new Set(planes.map((p) => p.fecha.slice(0, 7))).size;
    return S.personas.map((pe) => {
      const asistencias = planes.filter((p) => p.asistentes.includes(pe.id)).length;
      const casas = planes.filter((p) => p.anfitrion === pe.id).length;
      return {
        id: pe.id, nombre: pe.nombre, asistencias, casas,
        pctAsistencia: planes.length ? asistencias / planes.length : NaN,
        pctCasa: asistencias ? casas / asistencias : NaN,
        promMes: meses ? asistencias / meses : NaN,
      };
    });
  }

  function pintarFiltro() {
    const sel = $("#filtro-periodo");
    const prev = sel.value;
    const meses = [...new Set(S.planes.map((p) => p.fecha.slice(0, 7)))].sort().reverse();
    const anios = [...new Set(meses.map((m) => m.slice(0, 4)))];
    sel.innerHTML = `<option value="todo">Todo</option>` +
      anios.map((a) => `<option value="${a}">Año ${a}</option>`).join("") +
      meses.map((m) => `<option value="${m}">${nombreMes(m)}</option>`).join("");
    if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  }

  function pintarResumen() {
    const planes = planesDelPeriodo($("#filtro-periodo").value);
    const st = estadisticas(planes);
    const conCasa = planes.filter((p) => p.anfitrion).length;
    const promAsist = planes.length ? planes.reduce((a, p) => a + p.asistentes.length, 0) / planes.length : NaN;
    const topCasa = [...st].sort((a, b) => b.casas - a.casas)[0];

    $("#kpis").innerHTML = [
      ["Planes", planes.length],
      ["Personas", S.personas.length],
      ["Asistentes por plan", dec(promAsist)],
      ["Planes en casa", conCasa],
      ["Más veces puso casa", topCasa?.casas ? `${esc(topCasa.nombre)} (${topCasa.casas})` : "—"],
    ].map(([l, v]) => `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`).join("");

    const { campo, asc } = S.orden;
    st.sort((a, b) => {
      if (campo === "nombre") return asc ? a.nombre.localeCompare(b.nombre) : b.nombre.localeCompare(a.nombre);
      const x = isFinite(a[campo]) ? a[campo] : -1, y = isFinite(b[campo]) ? b[campo] : -1;
      return asc ? x - y : y - x;
    });
    $$("#tabla-promedios th").forEach((th) => {
      th.classList.toggle("orden", th.dataset.orden === campo);
      th.classList.toggle("asc", th.dataset.orden === campo && asc);
    });
    const barra = (x) => `<span class="barra"><i style="width:${isFinite(x) ? Math.round(x * 100) : 0}%"></i></span>`;
    $("#tabla-promedios tbody").innerHTML = st.length
      ? st.map((r) => `<tr>
          <td>${esc(r.nombre)}</td>
          <td class="num">${r.asistencias}</td>
          <td class="num">${pct(r.pctAsistencia)}${barra(r.pctAsistencia)}</td>
          <td class="num">${r.casas}</td>
          <td class="num">${pct(r.pctCasa)}</td>
          <td class="num">${dec(r.promMes)}</td>
        </tr>`).join("")
      : `<tr><td colspan="6" class="vacio">Aún no hay personas.</td></tr>`;
  }

  // ---------- Planes ----------
  const nombreDe = (id) => S.personas.find((p) => p.id === id)?.nombre ?? "(borrada)";

  function pintarPlanes() {
    $("#lista-planes").innerHTML = S.planes.length
      ? S.planes.map((p) => `<div class="item">
          <div class="cab">
            <span class="t">${esc(p.titulo)}</span>
            <span class="meta">${fechaLarga(p.fecha)} · ${p.asistentes.length} asistentes</span>
          </div>
          <div>
            ${p.anfitrion ? `<span class="tag casa">🏠 ${esc(nombreDe(p.anfitrion))}</span>` : ""}
            ${p.asistentes.filter((a) => a !== p.anfitrion).map((a) => `<span class="tag">${esc(nombreDe(a))}</span>`).join("")}
          </div>
          ${p.notas ? `<div class="meta">${esc(p.notas)}</div>` : ""}
          <div class="acciones solo-admin">
            <button class="btn sec peq" data-editar-plan="${p.id}">Editar</button>
            <button class="btn peligro peq" data-borrar-plan="${p.id}">Borrar</button>
          </div>
        </div>`).join("")
      : `<div class="vacio">Todavía no hay planes anotados.</div>`;
  }

  function pintarFormPlan(plan) {
    const f = $("#form-plan");
    const sel = plan ? new Set(plan.asistentes) : new Set($$("#chips-asistentes input:checked").map((i) => i.value));
    const anf = plan ? plan.anfitrion || "" : f.anfitrion.value;
    f.anfitrion.innerHTML = `<option value="">— Nadie / fuera de casa —</option>` +
      S.personas.map((p) => `<option value="${p.id}">${esc(p.nombre)}</option>`).join("");
    f.anfitrion.value = anf;
    $("#chips-asistentes").innerHTML = S.personas.length
      ? S.personas.map((p) => `<label class="chip"><input type="checkbox" value="${p.id}" ${sel.has(p.id) ? "checked" : ""}><span>${esc(p.nombre)}</span></label>`).join("")
      : `<span class="meta">Primero añade personas en la pestaña Personas.</span>`;
    if (plan) {
      f.id.value = plan.id; f.fecha.value = plan.fecha; f.titulo.value = plan.titulo; f.notas.value = plan.notas || "";
    }
    if (!f.fecha.value) f.fecha.value = hoy();
    const editando = !!f.id.value;
    $("#titulo-form-plan").textContent = editando ? "✏️ Editar plan" : "➕ Anotar un plan";
    $("#cancelar-plan").hidden = !editando;
  }

  function limpiarFormPlan() {
    const f = $("#form-plan");
    f.reset(); f.id.value = "";
    $$("#chips-asistentes input").forEach((i) => (i.checked = false));
    pintarFormPlan();
  }

  // ---------- Personas ----------
  function pintarPersonas() {
    const st = Object.fromEntries(estadisticas(S.planes).map((r) => [r.id, r]));
    $("#lista-personas").innerHTML = S.personas.length
      ? S.personas.map((p) => `<div class="item"><div class="cab">
          <span class="t">${esc(p.nombre)}</span>
          <span class="meta">${st[p.id].asistencias} planes · ${st[p.id].casas} veces puso casa</span>
        </div>
        <div class="acciones solo-admin">
          <button class="btn sec peq" data-renombrar="${p.id}">Renombrar</button>
          <button class="btn peligro peq" data-borrar-persona="${p.id}">Borrar</button>
        </div></div>`).join("")
      : `<div class="vacio">Todavía no hay personas.</div>`;
  }

  // ---------- Encuestas ----------
  function pintarEncuestas() {
    const actual = mesActual();
    $("#lista-encuestas").innerHTML = S.encuestas.length
      ? S.encuestas.map((e) => {
          const res = S.resultados.filter((r) => r.encuesta_id === e.id);
          const cuenta = e.opciones.map((o) => ({ o, n: Number(res.find((r) => r.opcion === o)?.votos || 0) }));
          const total = cuenta.reduce((a, c) => a + c.n, 0);
          const max = Math.max(0, ...cuenta.map((c) => c.n));
          const abierta = e.mes === actual;
          const mio = S.misVotos[e.id];
          const votantes = S.votosAdmin.filter((v) => v.encuesta_id === e.id);
          return `<div class="item">
            <div class="cab">
              <span class="t">${esc(e.pregunta)}</span>
              <span class="meta">${nombreMes(e.mes)} · ${total} voto${total === 1 ? "" : "s"}
                <span class="estado ${abierta ? "abierta" : "cerrada"}">${abierta ? "Abierta" : e.mes > actual ? "Próxima" : "Cerrada"}</span></span>
            </div>
            ${cuenta.map((c) => `<div class="opcion ${c.n && c.n === max ? "gana" : ""}">
                <span>${esc(c.o)}${mio === c.o ? ' <span class="mi-voto">✓ tu voto</span>' : ""}</span>
                <span class="meta">${c.n} · ${total ? Math.round((c.n / total) * 100) : 0}%</span>
                <span class="b"><i style="width:${total ? (c.n / total) * 100 : 0}%"></i></span>
              </div>`).join("")}
            ${abierta ? `<div class="votar">
                <select data-voto-sel="${e.id}">${e.opciones.map((o) => `<option ${mio === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>
                <button class="btn" data-votar="${e.id}">${mio ? "Cambiar mi voto" : S.user ? "Votar" : "Entrar con mi correo y votar"}</button>
              </div>` : ""}
            ${S.admin ? `<details class="votantes"><summary>Quién votó (${votantes.length}) — solo lo ves tú</summary>
                ${votantes.map((v) => `<div>${esc(v.email)} → ${esc(v.opcion)}</div>`).join("") || "Nadie todavía."}
              </details>
              <div class="acciones"><button class="btn peligro peq" data-borrar-encuesta="${e.id}">Borrar encuesta</button></div>` : ""}
          </div>`;
        }).join("")
      : `<div class="vacio">No hay encuestas todavía.</div>`;
    const m = $("#form-encuesta [name=mes]");
    if (!m.value) m.value = actual;
  }

  function pintarTodo() {
    pintarFiltro();
    pintarResumen();
    pintarPlanes();
    pintarFormPlan();
    pintarPersonas();
    pintarEncuestas();
  }

  // ---------- Acciones ----------
  async function hacer(fn, ok) {
    try {
      await fn();
      aviso(ok ? "✅ " + ok : "", "ok");
      await refrescar();
      return true;
    } catch (e) {
      aviso("❌ " + errorMsg(e), "error");
      return false;
    }
  }

  function eventos() {
    $$(".tab").forEach((b) => b.addEventListener("click", () => {
      $$(".tab").forEach((x) => x.classList.toggle("activa", x === b));
      $$(".panel").forEach((p) => p.classList.toggle("activo", p.id === b.dataset.tab));
      history.replaceState(null, "", "#" + b.dataset.tab);
    }));
    const irHash = () => { const h = location.hash.slice(1); if (/^\w+$/.test(h)) $(`.tab[data-tab="${h}"]`)?.click(); };
    window.addEventListener("hashchange", irHash);
    irHash();

    $("#filtro-periodo").addEventListener("change", pintarResumen);
    $$("#tabla-promedios th").forEach((th) => th.addEventListener("click", () => {
      const c = th.dataset.orden;
      S.orden = { campo: c, asc: S.orden.campo === c ? !S.orden.asc : c === "nombre" };
      pintarResumen();
    }));

    // Login
    $("#form-email").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const email = ev.target.email.value.trim().toLowerCase();
      $("#err-login").textContent = "";
      const btn = ev.target.querySelector("button");
      btn.disabled = true;
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
      btn.disabled = false;
      if (error) { $("#err-login").textContent = error.message; return; }
      $("#txt-correo").textContent = email;
      $("#form-email").hidden = true;
      $("#enviado").hidden = false;
    });
    $("#otro-correo").addEventListener("click", () => { $("#form-email").hidden = false; $("#enviado").hidden = true; });

    // Planes
    $("#form-plan").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      const asistentes = $$("#chips-asistentes input:checked").map((i) => i.value);
      const anfitrion = f.anfitrion.value || null;
      if (!asistentes.length && !anfitrion) return aviso("Marca al menos una persona que asistió.", "error");
      const ok = await hacer(() => q(sb.rpc("guardar_plan", {
        p_id: f.id.value || null, p_fecha: f.fecha.value, p_titulo: f.titulo.value,
        p_anfitrion: anfitrion, p_asistentes: asistentes, p_notas: f.notas.value,
      })), `Plan «${esc(f.titulo.value)}» guardado.`);
      if (ok) limpiarFormPlan();
    });
    $("#cancelar-plan").addEventListener("click", limpiarFormPlan);

    // Personas
    $("#form-persona").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const nombre = ev.target.nombre.value.trim();
      if (await hacer(() => q(sb.from("personas").insert({ nombre })), `${esc(nombre)} añadida.`)) ev.target.reset();
    });

    // Encuestas
    $("#form-encuesta").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      const opciones = f.usarPersonas.checked
        ? S.personas.map((p) => p.nombre)
        : [...new Set(f.opciones.value.split("\n").map((s) => s.trim()).filter(Boolean))];
      if (opciones.length < 2) return aviso("La encuesta necesita al menos dos opciones.", "error");
      if (await hacer(() => q(sb.from("encuestas").insert({ mes: f.mes.value, pregunta: f.pregunta.value.trim(), opciones })), "Encuesta creada.")) {
        f.reset(); pintarEncuestas();
      }
    });

    document.addEventListener("click", async (ev) => {
      const t = ev.target.closest("button");
      if (!t) return;
      if (t.id === "btn-entrar") return abrirLogin();
      if (t.id === "btn-salir") return sb.auth.signOut();
      const d = t.dataset;
      if (d.votar) {
        if (!S.user) return abrirLogin();
        const opcion = $(`[data-voto-sel="${d.votar}"]`).value;
        return hacer(() => q(sb.rpc("votar", { p_encuesta: d.votar, p_opcion: opcion })), `Voto registrado: <strong>${esc(opcion)}</strong>.`);
      }
      if (d.editarPlan) {
        pintarFormPlan(S.planes.find((p) => p.id === d.editarPlan));
        $("#caja-plan").open = true;
        return $("#caja-plan").scrollIntoView({ behavior: "smooth" });
      }
      if (d.borrarPlan && confirm("¿Borrar este plan?")) return hacer(() => q(sb.from("planes").delete().eq("id", d.borrarPlan)), "Plan borrado.");
      if (d.renombrar) {
        const p = S.personas.find((x) => x.id === d.renombrar);
        const nombre = prompt("Nuevo nombre", p.nombre)?.trim();
        if (nombre && nombre !== p.nombre) return hacer(() => q(sb.from("personas").update({ nombre }).eq("id", p.id)), "Nombre actualizado.");
      }
      if (d.borrarPersona && confirm("¿Borrar esta persona? Se quitará de todos los planes.")) {
        return hacer(() => q(sb.from("personas").delete().eq("id", d.borrarPersona)), "Persona borrada.");
      }
      if (d.borrarEncuesta && confirm("¿Borrar esta encuesta y sus votos?")) {
        return hacer(() => q(sb.from("encuestas").delete().eq("id", d.borrarEncuesta)), "Encuesta borrada.");
      }
    });
  }

  // ---------- Inicio ----------
  eventos();
  let ultimaSesion;
  sb.auth.onAuthStateChange((evento, session) => {
    const id = session?.user?.id ?? null;
    if (id === ultimaSesion && evento !== "INITIAL_SESSION") return;
    ultimaSesion = id;
    if (evento === "SIGNED_IN" && $("#dlg-login").open) $("#dlg-login").close();
    setTimeout(() => actualizarSesion(session), 0);
  });
})();
