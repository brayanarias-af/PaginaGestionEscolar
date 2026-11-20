/* ===== VISTA (profesor): NOTAS =====
   Nota final = 10% autoevaluación + 30% promedio(tareas, talleres y quices) + 60% parcial
   - Solo ve sus materias y solo puede calificar a estudiantes MATRICULADOS en ellas.
   - Usa los mismos registros que el administrador: localStorage["nova_notas"]
     { id, periodo, estudianteId, estudianteNombre, materia, autoevaluacion, actividades: [{ nombre, nota }], parcial } */

(() => {
  if (typeof NovaPro === "undefined" || !NovaPro) return;
  const { U, esc, norm, fmt, iniciales } = NovaPro;
  const $ = (id) => document.getElementById(id);

  const el = {
    materia: $("ep-materia"),
    tabs: $("ep-tabs"),
    resumen: $("ep-resumen"),
    tablaPeriodo: $("ep-tabla-periodo"),
    tbody: $("ep-tbody"),
    tablaDef: $("ep-tabla-def"),
    defTbody: $("ep-def-tbody"),
    vacio: $("ep-vacio"),
    vacioTitulo: $("ep-vacio-titulo"),
    vacioTexto: $("ep-vacio-texto"),
    modal: $("ep-modal"),
    form: $("ep-form"),
    titulo: $("ep-modal-titulo"),
    sub: $("ep-modal-sub"),
    auto: $("ep-auto"),
    parcial: $("ep-parcial"),
    actividades: $("ep-actividades"),
    agregarAct: $("ep-agregar-act"),
    preview: $("ep-preview"),
    error: $("ep-error"),
    cerrar: $("ep-cerrar"),
    cancelar: $("ep-cancelar"),
  };

  const PERIODOS = ["1", "2", "3", "4"];
  let materiaId = "";
  let tab = "1"; // "1".."4" o "def"
  let editando = null; // { estudiante, registroId }

  const materiaActual = () =>
    NovaPro.misMaterias().find((m) => m.id === materiaId) || null;
  const periodoDe = (r) => String(r.periodo || "1");

  function estadoDe(c) {
    if (!c.completo) return "En curso";
    return c.acumulado >= U.NOTA_MINIMA ? "Aprobado" : "Reprobado";
  }
  const claseEstado = {
    Aprobado: "ea-chip--aprobado",
    Reprobado: "ea-chip--reprobado",
    "En curso": "ea-chip--curso",
  };

  /* ---------- Selector de materia ---------- */
  function llenarMaterias() {
    const materias = NovaPro.misMaterias();
    el.materia.innerHTML = materias.length
      ? materias
          .map(
            (m) =>
              `<option value="${esc(m.id)}">${esc(m.nombre)} · ${esc(m.grado)}</option>`,
          )
          .join("")
      : '<option value="">Sin materias asignadas</option>';
    if (!materias.some((m) => m.id === materiaId))
      materiaId = materias.length ? materias[0].id : "";
    el.materia.value = materiaId;
    el.materia.disabled = materias.length === 0;
  }

  /* ---------- Tablas ---------- */
  function filaPeriodo(est, reg) {
    const persona = `
      <td class="ea-celda-materia">
        <div class="ea-persona"><span class="ea-avatar-mini">${esc(iniciales(est.nombre))}</span>
          <div><strong>${esc(est.nombre)}</strong><small>${esc(est.codigo)}</small></div></div>
      </td>`;

    if (!reg) {
      return `
      <tr data-est="${esc(est.id)}">${persona}
        <td data-label="Autoeval. (10%)"><span class="ea-pend">Pendiente</span></td>
        <td data-label="Tareas (30%)"><span class="ea-pend">Sin notas</span></td>
        <td data-label="Parcial (60%)"><span class="ea-pend">Pendiente</span></td>
        <td data-label="Nota final"><span class="ea-chip ea-chip--curso">Sin registrar</span></td>
        <td class="ea-acciones" data-label="Acciones">
          <button type="button" class="ea-btn ea-btn--primario ea-btn--chico" data-accion="registrar">
            <span class="material-icons-sharp">add</span> Registrar</button>
        </td>
      </tr>`;
    }

    const c = U.calcular(reg);
    const estado = estadoDe(c);
    const chips = (reg.actividades || [])
      .filter((a) => U.num(a.nota) !== null)
      .map(
        (a) =>
          `<span class="ea-nota" title="${esc(a.nombre || "Nota")}">${U.num(a.nota).toFixed(1)}</span>`,
      )
      .join("");
    const tareas = c.cantidad
      ? `<div class="ea-chips">${chips}</div><span class="ea-resumen-act">Promedio <b>${fmt(c.promTareas)}</b> (${c.cantidad} ${c.cantidad === 1 ? "nota" : "notas"})</span>`
      : '<span class="ea-pend">Sin notas</span>';

    return `
      <tr data-est="${esc(est.id)}" data-reg="${esc(reg.id)}">${persona}
        <td data-label="Autoeval. (10%)">${c.auto === null ? '<span class="ea-pend">Pendiente</span>' : fmt(c.auto)}</td>
        <td data-label="Tareas (30%)">${tareas}</td>
        <td data-label="Parcial (60%)">${c.parcial === null ? '<span class="ea-pend">Pendiente</span>' : fmt(c.parcial)}</td>
        <td data-label="Nota final">
          <div class="ea-final">${c.acumulado.toFixed(1)}<small>${c.completo ? "final" : "acumulado"}</small></div>
          <span class="ea-chip ${claseEstado[estado]}">${estado}</span>
        </td>
        <td class="ea-acciones" data-label="Acciones">
          <button type="button" class="ea-icono-btn" data-accion="editar" aria-label="Editar notas de ${esc(est.nombre)}"><span class="material-icons-sharp">edit</span></button>
          <button type="button" class="ea-icono-btn" data-accion="eliminar" aria-label="Eliminar notas de ${esc(est.nombre)}"><span class="material-icons-sharp">delete_outline</span></button>
        </td>
      </tr>`;
  }

  function filaDefinitiva(est, registros) {
    const calc = {};
    PERIODOS.forEach((p) => {
      const r = registros.find(
        (x) => x.estudianteId === est.id && periodoDe(x) === p,
      );
      calc[p] = r ? U.calcular(r) : null;
    });
    const completos = PERIODOS.map((p) => calc[p]).filter(
      (c) => c && c.completo,
    );
    const def = completos.length
      ? completos.reduce((a, c) => a + c.acumulado * 0.25, 0)
      : null;
    const estado =
      completos.length < PERIODOS.length
        ? "En curso"
        : def >= U.NOTA_MINIMA
          ? "Aprobado"
          : "Reprobado";
    const celda = (p) => {
      const c = calc[p];
      if (!c)
        return `<td data-label="Periodo ${p}"><span class="ea-pend">—</span></td>`;
      return c.completo
        ? `<td data-label="Periodo ${p}"><strong>${c.acumulado.toFixed(1)}</strong></td>`
        : `<td data-label="Periodo ${p}"><span class="ea-pend" title="Periodo incompleto">${c.acumulado.toFixed(1)}*</span></td>`;
    };
    return `
      <tr>
        <td class="ea-celda-materia"><div class="ea-persona"><span class="ea-avatar-mini">${esc(iniciales(est.nombre))}</span>
          <div><strong>${esc(est.nombre)}</strong><small>${esc(est.codigo)}</small></div></div></td>
        ${PERIODOS.map(celda).join("")}
        <td data-label="Definitiva">
          <div class="ea-final">${def === null ? "—" : def.toFixed(1)}<small>${completos.length}/4 periodos</small></div>
          <span class="ea-chip ${claseEstado[estado]}">${estado}</span>
        </td>
      </tr>`;
  }

  function mostrarVacio(titulo, texto) {
    el.vacio.hidden = false;
    el.vacioTitulo.textContent = titulo;
    el.vacioTexto.textContent = texto;
    el.tablaPeriodo.hidden = true;
    el.tablaDef.hidden = true;
    el.resumen.textContent = "";
  }

  function render() {
    llenarMaterias();
    const materia = materiaActual();
    if (!materia)
      return mostrarVacio(
        "Aún no tienes materias asignadas",
        "Cuando el administrador te asigne una materia podrás registrar notas aquí.",
      );

    const estudiantes = NovaPro.estudiantesDe(materia.id);
    if (!estudiantes.length)
      return mostrarVacio(
        "Aún no hay estudiantes matriculados",
        `Cuando un estudiante se matricule en ${materia.nombre}, aparecerá aquí para que le registres notas.`,
      );

    el.vacio.hidden = true;
    const registros = NovaPro.notasDe(materia);
    const esDef = tab === "def";
    el.tablaPeriodo.hidden = esDef;
    el.tablaDef.hidden = !esDef;

    if (esDef) {
      el.defTbody.innerHTML = estudiantes
        .map((e) => filaDefinitiva(e, registros))
        .join("");
      el.resumen.innerHTML = `<b>${estudiantes.length}</b> ${estudiantes.length === 1 ? "estudiante" : "estudiantes"}. El * indica un periodo incompleto.`;
      return;
    }

    const delPeriodo = registros.filter((r) => periodoDe(r) === tab);
    el.tbody.innerHTML = estudiantes
      .map((e) =>
        filaPeriodo(
          e,
          delPeriodo.find((r) => r.estudianteId === e.id),
        ),
      )
      .join("");

    const completos = estudiantes.filter((e) => {
      const r = delPeriodo.find((x) => x.estudianteId === e.id);
      return r && U.calcular(r).completo;
    }).length;
    el.resumen.innerHTML = `<b>${estudiantes.length}</b> ${estudiantes.length === 1 ? "estudiante" : "estudiantes"} · <b>${completos}</b> con nota completa · <b>${estudiantes.length - completos}</b> pendientes en el Periodo ${tab}`;
  }

  /* ---------- Modal ---------- */
  function agregarFila(nombre = "", nota = "") {
    const fila = document.createElement("div");
    fila.className = "ea-fila-act";
    fila.innerHTML = `
      <input type="text" class="ep-act-nombre" placeholder="Ej. Quiz 1, Taller 2" value="${esc(nombre)}" autocomplete="off" aria-label="Nombre de la actividad" />
      <input type="text" class="ep-act-nota" inputmode="decimal" placeholder="0.0 - 5.0" value="${esc(nota)}" autocomplete="off" aria-label="Nota" />
      <button type="button" class="ea-icono-btn" aria-label="Quitar nota"><span class="material-icons-sharp">close</span></button>`;
    el.actividades.appendChild(fila);
    return fila;
  }

  const leerForm = () => ({
    autoevaluacion: el.auto.value.trim(),
    parcial: el.parcial.value.trim(),
    actividades: [...el.actividades.querySelectorAll(".ea-fila-act")].map(
      (f) => ({
        nombre: f.querySelector(".ep-act-nombre").value.trim(),
        nota: f.querySelector(".ep-act-nota").value.trim(),
      }),
    ),
  });

  function actualizarPreview() {
    const c = U.calcular(leerForm());
    el.preview.innerHTML = `
      <div><span>Autoevaluación (10%)</span><strong>${fmt(c.auto)}</strong></div>
      <div><span>Promedio tareas (30%)</span><strong>${fmt(c.promTareas)}</strong></div>
      <div><span>Parcial (60%)</span><strong>${fmt(c.parcial)}</strong></div>
      <div><span>${c.completo ? "Nota final" : "Acumulado"}</span><strong>${c.acumulado.toFixed(2)}</strong></div>`;
  }

  function mostrarError(msg, campo) {
    el.error.textContent = msg;
    el.error.hidden = false;
    if (campo) campo.focus();
    return null;
  }

  function abrirModal(estudiante, reg) {
    editando = { estudiante, registroId: reg ? reg.id : null };
    el.form.reset();
    el.error.hidden = true;
    el.actividades.innerHTML = "";
    el.titulo.textContent = reg ? "Editar notas" : "Registrar notas";
    el.sub.textContent = `${estudiante.nombre} · ${materiaActual().nombre} · Periodo ${tab}`;
    if (reg) {
      el.auto.value = reg.autoevaluacion ?? "";
      el.parcial.value = reg.parcial ?? "";
      (reg.actividades || []).forEach((a) => agregarFila(a.nombre, a.nota));
    }
    if (!el.actividades.children.length) agregarFila();
    actualizarPreview();
    el.modal.showModal();
    el.auto.focus();
  }

  const cerrarModal = () => el.modal.close();

  function guardar() {
    el.error.hidden = true;
    const materia = materiaActual();
    const { estudiante } = editando;

    // Solo se califica a estudiantes matriculados en una materia propia
    if (
      !materia ||
      !NovaPro.estudiantesDe(materia.id).some((e) => e.id === estudiante.id)
    ) {
      cerrarModal();
      NovaPro.toast("Ese estudiante ya no está matriculado en la materia.");
      return render();
    }

    const form = leerForm();
    const fuera = (v) =>
      v !== "" && (U.num(v) === null || U.num(v) < 0 || U.num(v) > 5);
    if (fuera(form.autoevaluacion))
      return mostrarError(
        "La autoevaluación debe estar entre 0.0 y 5.0.",
        el.auto,
      );
    if (fuera(form.parcial))
      return mostrarError("El parcial debe estar entre 0.0 y 5.0.", el.parcial);
    for (const campo of el.actividades.querySelectorAll(".ep-act-nota")) {
      if (fuera(campo.value.trim()))
        return mostrarError(
          "Cada nota de tareas, talleres y quices debe estar entre 0.0 y 5.0.",
          campo,
        );
    }
    const actividades = form.actividades.filter((a) => a.nota !== "");
    if (
      form.autoevaluacion === "" &&
      form.parcial === "" &&
      !actividades.length
    ) {
      return mostrarError("Escribe al menos una nota.", el.auto);
    }

    const datos = {
      periodo: tab,
      estudianteId: estudiante.id,
      estudianteNombre: estudiante.nombre,
      materia: materia.nombre,
      autoevaluacion: form.autoevaluacion,
      parcial: form.parcial,
      actividades,
    };

    // Si ya existe un registro (p. ej. lo creó el administrador mientras tanto), se actualiza ese
    const todas = NovaPro.todasLasNotas();
    const existente = todas.find(
      (r) =>
        r.estudianteId === estudiante.id &&
        norm(r.materia) === norm(materia.nombre) &&
        periodoDe(r) === tab,
    );
    const id = editando.registroId || (existente && existente.id);
    const nuevas = id
      ? todas.map((r) => (r.id === id ? { ...r, ...datos } : r))
      : [...todas, { id: "not-" + Date.now().toString(36), ...datos }];

    NovaPro.guardarNotas(nuevas);
    cerrarModal();
    NovaPro.toast(`Notas de ${estudiante.nombre} guardadas.`);
  }

  /* ---------- Eventos ---------- */
  el.materia.addEventListener("change", () => {
    materiaId = el.materia.value;
    render();
  });

  el.tabs.addEventListener("click", (ev) => {
    const t = ev.target.closest(".ea-tab");
    if (!t) return;
    tab = t.dataset.tab;
    el.tabs.querySelectorAll(".ea-tab").forEach((b) => {
      b.classList.toggle("activo", b === t);
      b.setAttribute("aria-selected", b === t);
    });
    render();
  });

  el.tbody.addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-accion]");
    if (!b) return;
    const fila = b.closest("tr");
    const estudiante = NovaPro.estudiantesDe(materiaId).find(
      (e) => e.id === fila.dataset.est,
    );
    if (!estudiante) return render();
    const reg = NovaPro.todasLasNotas().find((r) => r.id === fila.dataset.reg);

    if (b.dataset.accion === "eliminar") {
      if (
        !reg ||
        !confirm(
          `¿Eliminar las notas de ${estudiante.nombre} en el Periodo ${tab}? Esta acción no se puede deshacer.`,
        )
      )
        return;
      NovaPro.guardarNotas(
        NovaPro.todasLasNotas().filter((r) => r.id !== reg.id),
      );
      return NovaPro.toast("Notas eliminadas.");
    }
    abrirModal(estudiante, b.dataset.accion === "editar" ? reg : null);
  });

  el.agregarAct.addEventListener("click", () =>
    agregarFila().querySelector(".ep-act-nombre").focus(),
  );
  el.actividades.addEventListener("click", (ev) => {
    const quitar = ev.target.closest("button");
    if (!quitar) return;
    quitar.closest(".ea-fila-act").remove();
    if (!el.actividades.children.length) agregarFila();
    actualizarPreview();
  });
  el.form.addEventListener("input", actualizarPreview);
  el.form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    guardar();
  });
  el.cerrar.addEventListener("click", cerrarModal);
  el.cancelar.addEventListener("click", cerrarModal);
  el.modal.addEventListener("click", (ev) => {
    if (ev.target === el.modal) cerrarModal();
  });

  // Desde "Mis materias" o desde un aviso
  window.addEventListener("ep:materia", (ev) => {
    materiaId = ev.detail;
  });

  window.addEventListener("ea:datos", render);
  window.addEventListener("ea:vista", (ev) => {
    if (ev.detail === "notas") render();
  });
  render();
})();
