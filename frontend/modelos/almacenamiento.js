/* ===== Modelo de datos conectado al backend (Node.js + Express + SQLite) =====
   Mantiene la misma interfaz de siempre: NovaModelo.leer / guardar / actualizar.
   - Al cargar la página trae los datos del servidor (una sola petición).
   - guardar() actualiza la copia en memoria y envía el cambio al servidor en segundo plano.
   - Tus datos antiguos de localStorage NO se borran: la primera vez que el administrador
     inicia sesión desde este navegador se suben a la base de datos (se combinan por id). */
const NovaModelo = (() => {
  const CLAVES = ["nova_estudiantes", "nova_profesores", "nova_materias", "matriculas", "nova_notas"];
  const FLAG_MIGRADO = "nova_migrado_v1";
  const script = document.currentScript;
  const RAIZ = new URL("../", script ? script.src : location.href); // carpeta frontend/
  // Servido por Express (puerto 3000) usa rutas relativas; con Live Server apunta al backend en el 3000
  const API = window.NOVA_API ?? (location.port === "3000" ? "" : "http://localhost:3000");

  const cache = {};
  const versiones = {};
  const cambios = {}; // contador de cambios locales por colección
  let cola = Promise.resolve(); // un solo turno de envío: el orden de los guardados se respeta
  let pendientes = 0;
  let conectado = false;

  const clonar = (v) => JSON.parse(JSON.stringify(v));
  const token = () => { try { return sessionStorage.getItem("nova_token"); } catch { return null; } };
  const rolActual = () => { try { return JSON.parse(sessionStorage.getItem("nova_sesion"))?.rol; } catch { return null; } };
  const cabeceras = () => ({ "Content-Type": "application/json", Authorization: "Bearer " + token() });

  /* ---------- Aviso visible ---------- */
  function aviso(texto, tipo = "info", fijo = false) {
    const poner = () => {
      let caja = document.getElementById("nova-aviso");
      if (!caja) {
        caja = document.createElement("div");
        caja.id = "nova-aviso";
        caja.setAttribute("role", "alert");
        caja.style.cssText =
          "position:fixed;right:16px;bottom:16px;max-width:340px;padding:12px 16px;border-radius:10px;font:14px/1.4 system-ui,sans-serif;color:#fff;box-shadow:0 6px 20px rgba(0,0,0,.25);z-index:99999";
        document.body.appendChild(caja);
      }
      caja.style.background = tipo === "error" ? "#d6455d" : "#4b5bd0";
      caja.textContent = texto;
      caja.title = "Clic para cerrar";
      caja.style.cursor = "pointer";
      caja.onclick = () => (caja.hidden = true);
      caja.hidden = false;
      clearTimeout(caja._t);
      if (!fijo) caja._t = setTimeout(() => (caja.hidden = true), 7000);
    };
    if (document.body) poner();
    else document.addEventListener("DOMContentLoaded", poner);
  }

  function cerrarSesion() {
    try { sessionStorage.removeItem("nova_token"); sessionStorage.removeItem("nova_sesion"); } catch {}
    location.replace(new URL("Vistas/autenticacion/login.html", RAIZ).href);
  }

  /* ---------- Carga inicial (síncrona, para que los controladores encuentren los datos listos) ---------- */
  function pedirTodo() {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", API + "/api/datos", false);
    xhr.setRequestHeader("Authorization", "Bearer " + token());
    xhr.send();
    return xhr;
  }

  function hidratar() {
    if (!token()) return; // p. ej. la pantalla de login
    try {
      const xhr = pedirTodo();
      if (xhr.status === 401) return cerrarSesion();
      if (xhr.status !== 200) {
        let detalle = "";
        try { detalle = JSON.parse(xhr.responseText).mensaje || ""; } catch {}
        throw new Error(`El servidor respondió con un error (${xhr.status}). ${detalle} Revisa la ventana donde corre el backend.`);
      }
      const r = JSON.parse(xhr.responseText);
      CLAVES.forEach((c) => {
        cache[c] = Array.isArray(r.datos[c]) ? r.datos[c] : [];
        versiones[c] = r.versiones[c] ?? null;
      });
      conectado = true;
      migrarLocalStorage();
    } catch (e) {
      console.error("[Nova] No se pudieron cargar los datos:", e);
      const sinRed = !/servidor respondió/.test(e.message);
      aviso(
        "⚠️ LOS CAMBIOS NO SE ESTÁN GUARDANDO EN LA BASE DE DATOS. " +
          (sinRed
            ? `No se pudo conectar con el backend (${API || location.origin}). Enciende el backend (npm start) y abre la página desde http://localhost:3000.`
            : e.message),
        "error",
        true
      );
    }
  }

  /* ---------- Migración única de los datos que ya tenías en localStorage ---------- */
  const leerLocal = (clave) => {
    try {
      const d = JSON.parse(localStorage.getItem(clave));
      return Array.isArray(d) ? d : [];
    } catch { return []; }
  };

  function migrarLocalStorage() {
    if (rolActual() !== "administrador") return; // solo el administrador tiene todos los datos
    try { if (localStorage.getItem(FLAG_MIGRADO)) return; } catch { return; }
    let subidos = 0;
    try {
      for (const c of CLAVES) {
        const local = leerLocal(c).filter((r) => r && typeof r.id === "string");
        const ids = new Set(cache[c].map((r) => r.id));
        const nuevos = local.filter((r) => !ids.has(r.id));
        if (!nuevos.length) continue;
        const union = [...cache[c], ...nuevos]; // lo que ya está en el servidor manda
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", API + "/api/datos/" + c, false);
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.setRequestHeader("Authorization", "Bearer " + token());
        xhr.send(JSON.stringify({ datos: union, base: versiones[c] }));
        if (xhr.status !== 200) throw new Error(`No se pudo migrar ${c} (HTTP ${xhr.status})`);
        const r = JSON.parse(xhr.responseText);
        cache[c] = r.datos;
        versiones[c] = r.version;
        subidos += nuevos.length;
      }
      localStorage.setItem(FLAG_MIGRADO, new Date().toISOString());
      if (subidos) aviso(`Se pasaron ${subidos} registros de este navegador a la base de datos.`);
    } catch (e) {
      console.error(e);
      aviso("No se pudieron migrar tus datos locales. Tus datos siguen guardados en este navegador.", "error");
    }
  }

  /* ---------- Envío al servidor ---------- */
  async function enviar(clave) {
    const n = cambios[clave];
    let r;
    try {
      r = await fetch(API + "/api/datos/" + clave, {
        method: "PUT",
        headers: cabeceras(),
        body: JSON.stringify({ datos: cache[clave], base: versiones[clave] })
      });
    } catch {
      return aviso("⚠️ Sin conexión con el servidor: el último cambio NO se guardó en la base de datos.", "error", true);
    }
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) return cerrarSesion();
    if (!r.ok) {
      console.error("[Nova] No se guardó", clave, r.status, j);
      aviso("⚠️ No se guardó: " + (j.mensaje || `error ${r.status} del servidor`), "error", true);
      return recargarDesdeServidor();
    }
    versiones[clave] = j.version;
    const sinCambiosNuevos = cambios[clave] === n; // si hubo otro guardar mientras tanto, no pisar
    if (sinCambiosNuevos && (j.fusionado || j.ignorados || rolActual() !== "administrador")) {
      cache[clave] = j.datos;
      window.dispatchEvent(new Event("nova:actualizado"));
    }
    if (j.fusionado) aviso("Otra persona guardó cambios al mismo tiempo; se combinaron sin perder datos.");
    else if (j.ignorados) aviso("Algunos cambios no estaban permitidos y no se guardaron.", "error");
  }

  function programar(clave) {
    cambios[clave] = (cambios[clave] || 0) + 1;
    pendientes++;
    cola = cola
      .then(() => enviar(clave))
      .catch((e) => console.error(e))
      .finally(() => pendientes--);
  }

  async function recargarDesdeServidor() {
    try {
      const r = await fetch(API + "/api/datos", { headers: cabeceras() });
      if (r.status === 401) return cerrarSesion();
      if (!r.ok) return;
      const j = await r.json();
      CLAVES.forEach((c) => { cache[c] = j.datos[c] || []; versiones[c] = j.versiones[c] ?? null; });
      window.dispatchEvent(new Event("nova:actualizado"));
    } catch {}
  }

  // Estudiantes y profesores ven los cambios de otras personas al volver a la pestaña.
  // (El administrador no recarga solo, para no pisar lo que tiene abierto.)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !conectado || pendientes || rolActual() === "administrador") return;
    recargarDesdeServidor().then(() => window.dispatchEvent(new Event("ea:datos")));
  });

  /* ---------- Interfaz pública (igual que antes) ---------- */
  const leer = (clave) => {
    if (CLAVES.includes(clave)) return clonar(cache[clave] || []);
    try {
      const datos = JSON.parse(localStorage.getItem(clave));
      return Array.isArray(datos) ? datos : [];
    } catch { return []; }
  };

  const guardar = (clave, registros) => {
    if (!CLAVES.includes(clave)) {
      localStorage.setItem(clave, JSON.stringify(registros));
      return registros;
    }
    if (!conectado) {
      hidratar(); // reintenta la conexión, pero NO guarda este cambio: la pantalla se cargó sin los datos reales
      if (conectado) aviso("La conexión se restableció. Recarga la página (F5) y repite el último cambio.", "error", true);
      throw new Error("Sin conexión con el servidor");
    }
    cache[clave] = clonar(registros);
    programar(clave);
    return registros;
  };

  const actualizar = (clave, cambio) => guardar(clave, cambio(leer(clave)));

  hidratar();

  return { leer, guardar, actualizar, API };
})();
