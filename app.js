/* BMSN — interfaz. Lee los JSON de /data y genera issues de GitHub para escribir. */
(() => {
  "use strict";

  const S = { config: {}, personas: [], planes: [], encuestas: [], votos: {}, orden: { campo: "asistencias", asc: false } };
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = (x) => (isFinite(x) ? Math.round(x * 100) + "%" : "—");
  const dec = (x) => (isFinite(x) ? x.toFixed(1).replace(".", ",") : "—");
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const nombreMes = (m) => { const [y, mm] = m.split("-"); return `${MESES[+mm - 1]} ${y}`; };
  const fechaLarga = (f) => { const [y, m, d] = f.split("-"); return `${+d} ${MESES[+m - 1].slice(0, 3)} ${y}`; };

  function mesActual() {
    const tz = S.config.zonaHoraria || "America/Lima";
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit" }).formatToParts(new Date());
    return `${p.find((x) => x.type === "year").value}-${p.find((x) => x.type === "month").value}`;
  }

  async function cargar(nombre, defecto) {
    try {
      const r = await fetch(`data/${nombre}.json?t=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(r.status);
      return await r.json();
    } catch {
      return defecto;
    }
  }

  // ---------- Escritura vía issue de GitHub ----------
  function abrirIssue(titulo, datos) {
    const repo = S.config.repo;
    if (!repo) return aviso("Falta configurar <code>repo</code> en data/config.json.");
    const body =
      "Pulsa **Submit new issue** para enviar. No edites el bloque de abajo.\n\n" +
      "```json\n" + JSON.stringify({ bmsn: 1, ...datos }, null, 2) + "\n```\n";
    const url = `https://github.com/${repo}/issues/new?title=${encodeURIComponent("BMSN · " + titulo)}&body=${encodeURIComponent(body)}`;
    window.open(url, "_blank", "noopener");
    aviso("Se abrió GitHub con el formulario relleno. Pulsa <strong>Submit new issue</strong>; en 1–2 minutos verás el cambio aquí.");
  }

  function aviso(html) {
    const a = $("#aviso");
    a.innerHTML = html;
    a.hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ---------- Estadísticas ----------
  function periodos() {
    const meses = [...new Set(S.planes.map((p) => p.fecha.slice(0, 7)))].sort().reverse();
    const anios = [...new Set(meses.map((m) => m.slice(0, 4)))];
    return { meses, anios };
  }

  function planesDelPeriodo(per) {
    if (!per || per === "todo") return S.planes;
    return S.planes.filter((p) => p.fecha.startsWith(per));
  }

  function estadisticas(planes) {
    const mesesConPlanes = new Set(planes.map((p) => p.fecha.slice(0, 7))).size;
    return S.personas.map((pe) => {
      const asistencias = planes.filter((p) => p.asistentes.includes(pe.id)).length;
      const casas = planes.filter((p) => p.anfitrion === pe.id).length;
      return {
        id: pe.id,
        nombre: pe.nombre,
        asistencias,
        casas,
        pctAsistencia: planes.length ? asistencias / planes.length : NaN,
        pctCasa: asistencias ? casas / asistencias : NaN,
        promMes: mesesConPlanes ? asistencias / mesesConPlanes : NaN,
      };
    });
  }

  function pintarResumen() {
    const per = $("#filtro-periodo").value;
    const planes = planesDelPeriodo(per);
    const st = estadisticas(planes);
    const conCasa = planes.filter((p) => p.anfitrion).length;
    const promAsist = planes.length ? planes.reduce((a, p) => a + p.asistentes.length, 0) / planes.length : NaN;
    const topCasa = [...st].sort((a, b) => b.casas - a.casas)[0];

    $("#kpis").innerHTML = [
      ["Planes", planes.length],
      ["Personas", S.personas.length],
      ["Asistentes por plan", dec(promAsist)],
      ["Planes en casa", conCasa],
      ["Más veces puso casa", topCasa && topCasa.casas ? `${esc(topCasa.nombre)} (${topCasa.casas})` : "—"],
    ].map(([l, v]) => `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`).join("");

    const { campo, asc } = S.orden;
    st.sort((a, b) => {
      let x = a[campo], y = b[campo];
      if (campo === "nombre") return asc ? x.localeCompare(y) : y.localeCompare(x);
      x = isFinite(x) ? x : -1; y = isFinite(y) ? y : -1;
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
      : `<tr><td colspan="6" class="vacio">Aún no hay personas. Añádelas en la pestaña Personas.</td></tr>`;
  }

  function pintarFiltro() {
    const sel = $("#filtro-periodo");
    const prev = sel.value;
    const { meses, anios } = periodos();
    sel.innerHTML =
      `<option value="todo">Todo</option>` +
      anios.map((a) => `<option value="${a}">Año ${a}</option>`).join("") +
      meses.map((m) => `<option value="${m}">${nombreMes(m)}</option>`).join("");
    if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  }

  // ---------- Planes ----------
  const nombreDe = (id) => S.personas.find((p) => p.id === id)?.nombre ?? "(persona borrada)";

  function pintarPlanes() {
    const planes = [...S.planes].sort((a, b) => b.fecha.localeCompare(a.fecha));
    $("#lista-planes").innerHTML = planes.length
      ? planes.map((p) => `<div class="item">
          <div class="cab">
            <span class="t">${esc(p.titulo)}</span>
            <span class="meta">${fechaLarga(p.fecha)} · ${p.asistentes.length} asistentes</span>
          </div>
          <div>
            ${p.anfitrion ? `<span class="tag casa">🏠 ${esc(nombreDe(p.anfitrion))}</span>` : ""}
            ${p.asistentes.filter((a) => a !== p.anfitrion).map((a) => `<span class="tag">${esc(nombreDe(a))}</span>`).join("")}
          </div>
          ${p.notas ? `<div class="meta">${esc(p.notas)}</div>` : ""}
          <div class="votar"><button class="btn sec peq" data-borrar-plan="${esc(p.id)}">Borrar</button></div>
        </div>`).join("")
      : `<div class="vacio">Todavía no hay planes anotados.</div>`;
  }

  function pintarFormPlan() {
    const ord = [...S.personas].sort((a, b) => a.nombre.localeCompare(b.nombre));
    $("#form-plan [name=anfitrion]").innerHTML =
      `<option value="">— Nadie / fuera de casa —</option>` + ord.map((p) => `<option value="${esc(p.id)}">${esc(p.nombre)}</option>`).join("");
    $("#chips-asistentes").innerHTML = ord.length
      ? ord.map((p) => `<label class="chip"><input type="checkbox" value="${esc(p.id)}"><span>${esc(p.nombre)}</span></label>`).join("")
      : `<span class="meta">Primero añade personas.</span>`;
    const f = $("#form-plan [name=fecha]");
    if (!f.value) f.value = new Date().toISOString().slice(0, 10);
  }

  // ---------- Personas ----------
  function pintarPersonas() {
    const ord = [...S.personas].sort((a, b) => a.nombre.localeCompare(b.nombre));
    $("#lista-personas").innerHTML = ord.length
      ? ord.map((p) => `<div class="item"><div class="cab">
          <span class="t">${esc(p.nombre)}</span>
          <span class="meta">${p.github ? `GitHub: <a href="https://github.com/${esc(p.github)}" target="_blank" rel="noopener">@${esc(p.github)}</a> · puede votar` : "sin cuenta de GitHub · no vota"}</span>
        </div></div>`).join("")
      : `<div class="vacio">Todavía no hay personas.</div>`;
  }

  // ---------- Encuestas ----------
  function pintarEncuestas() {
    const actual = mesActual();
    const lista = [...S.encuestas].sort((a, b) => b.mes.localeCompare(a.mes));
    $("#lista-encuestas").innerHTML = lista.length
      ? lista.map((e) => {
          const votos = Object.values(S.votos[e.id] || {});
          const total = votos.length;
          const cuenta = e.opciones.map((o) => ({ o, n: votos.filter((v) => v.opcion === o).length }));
          const max = Math.max(0, ...cuenta.map((c) => c.n));
          const abierta = e.mes === actual;
          return `<div class="item">
            <div class="cab">
              <span class="t">${esc(e.pregunta)}</span>
              <span class="meta">${nombreMes(e.mes)} · ${total} voto${total === 1 ? "" : "s"}
                <span class="estado ${abierta ? "abierta" : "cerrada"}">${abierta ? "Abierta" : e.mes > actual ? "Próxima" : "Cerrada"}</span></span>
            </div>
            ${cuenta.map((c) => `<div class="opcion ${c.n && c.n === max ? "gana" : ""}">
                <span>${esc(c.o)}</span><span class="meta">${c.n} · ${total ? Math.round((c.n / total) * 100) : 0}%</span>
                <span class="b"><i style="width:${total ? (c.n / total) * 100 : 0}%"></i></span>
              </div>`).join("")}
            ${abierta ? `<div class="votar">
                <select data-voto-sel="${esc(e.id)}">${e.opciones.map((o) => `<option>${esc(o)}</option>`).join("")}</select>
                <button class="btn" data-votar="${esc(e.id)}">Votar con mi cuenta de GitHub</button>
              </div>` : ""}
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

  // ---------- Eventos ----------
  function eventos() {
    $$(".tab").forEach((b) => b.addEventListener("click", () => {
      $$(".tab").forEach((x) => x.classList.toggle("activa", x === b));
      $$(".panel").forEach((p) => p.classList.toggle("activo", p.id === b.dataset.tab));
      history.replaceState(null, "", "#" + b.dataset.tab);
    }));
    const irHash = () => { const h = location.hash.slice(1); if (h) $(`.tab[data-tab="${CSS.escape(h)}"]`)?.click(); };
    window.addEventListener("hashchange", irHash);
    irHash();

    $("#filtro-periodo").addEventListener("change", pintarResumen);
    $$("#tabla-promedios th").forEach((th) => th.addEventListener("click", () => {
      const c = th.dataset.orden;
      S.orden = { campo: c, asc: S.orden.campo === c ? !S.orden.asc : c === "nombre" };
      pintarResumen();
    }));

    $("#form-plan").addEventListener("submit", (ev) => {
      ev.preventDefault();
      const f = ev.target;
      const anfitrion = f.anfitrion.value || null;
      const asistentes = $$("#chips-asistentes input:checked").map((i) => i.value);
      if (anfitrion && !asistentes.includes(anfitrion)) asistentes.push(anfitrion);
      if (!asistentes.length) return aviso("Marca al menos una persona que asistió.");
      abrirIssue(`plan · ${f.fecha.value} ${f.titulo.value}`, {
        tipo: "plan", fecha: f.fecha.value, titulo: f.titulo.value.trim(), anfitrion, asistentes, notas: f.notas.value.trim(),
      });
    });

    $("#form-persona").addEventListener("submit", (ev) => {
      ev.preventDefault();
      const f = ev.target;
      abrirIssue(`persona · ${f.nombre.value}`, {
        tipo: "persona", nombre: f.nombre.value.trim(), github: f.github.value.trim().replace(/^@/, "") || null,
      });
    });

    $("#form-encuesta").addEventListener("submit", (ev) => {
      ev.preventDefault();
      const f = ev.target;
      const opciones = f.usarPersonas.checked
        ? S.personas.map((p) => p.nombre)
        : f.opciones.value.split("\n").map((s) => s.trim()).filter(Boolean);
      if (opciones.length < 2) return aviso("La encuesta necesita al menos dos opciones.");
      abrirIssue(`encuesta · ${f.mes.value}`, { tipo: "encuesta", mes: f.mes.value, pregunta: f.pregunta.value.trim(), opciones });
    });

    document.addEventListener("click", (ev) => {
      const v = ev.target.closest("[data-votar]");
      if (v) {
        const id = v.dataset.votar;
        const opcion = $(`[data-voto-sel="${CSS.escape(id)}"]`).value;
        abrirIssue(`voto · ${id}`, { tipo: "voto", encuesta: id, opcion });
      }
      const b = ev.target.closest("[data-borrar-plan]");
      if (b && confirm("¿Borrar este plan? Se enviará la petición a GitHub.")) {
        abrirIssue(`borrar plan · ${b.dataset.borrarPlan}`, { tipo: "borrar-plan", id: b.dataset.borrarPlan });
      }
    });
  }

  async function iniciar() {
    [S.config, S.personas, S.planes, S.encuestas, S.votos] = await Promise.all([
      cargar("config", {}), cargar("personas", []), cargar("planes", []), cargar("encuestas", []), cargar("votos", {}),
    ]);
    if (S.config.repo) $("#link-repo").href = `https://github.com/${S.config.repo}`;
    eventos();
    pintarTodo();
  }

  iniciar();
})();
