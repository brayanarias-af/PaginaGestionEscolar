/* ===== Login ===== */
(() => {
  const CLAVE_TEMA = "tema";            // misma clave que el dashboard
  const CLAVE_CORREO = "nova_correo";   // correo recordado
  const DESTINOS = {
    administrador: "../admin/db.admin.html",
    estudiante: "../estudiantes/db.estudiantes.html",
    profesor: "../profesores/db.profesores.html"
  };

  const $ = (id) => document.getElementById(id);
  const form = $("login-form");
  const correo = $("correo");
  const clave = $("clave");
  const recordar = $("recordar");
  const error = $("login-error");
  const verClave = $("ver-clave");
  const toggler = $("theme-toggler");

  /* ---------- Tema (compartido con el dashboard) ---------- */
  const setTheme = (oscuro) => {
    document.body.classList.toggle("dark-theme-variables", oscuro);
    toggler.querySelector("span:nth-child(1)").classList.toggle("active", !oscuro);
    toggler.querySelector("span:nth-child(2)").classList.toggle("active", oscuro);
    try {
      localStorage.setItem(CLAVE_TEMA, oscuro ? "oscuro" : "claro");
    } catch {}
  };
  const alternarTema = () => setTheme(!document.body.classList.contains("dark-theme-variables"));

  toggler.addEventListener("click", alternarTema);
  toggler.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      alternarTema();
    }
  });
  try {
    if (localStorage.getItem(CLAVE_TEMA) === "oscuro") setTheme(true);
  } catch {}

  /* ---------- Mostrar / ocultar contraseña ---------- */
  verClave.addEventListener("click", () => {
    const visible = clave.type === "text";
    clave.type = visible ? "password" : "text";
    verClave.setAttribute("aria-label", visible ? "Mostrar contraseña" : "Ocultar contraseña");
    verClave.querySelector("span").textContent = visible ? "visibility" : "visibility_off";
  });

  /* ---------- Recordar correo ---------- */
  try {
    const guardado = localStorage.getItem(CLAVE_CORREO);
    if (guardado) {
      correo.value = guardado;
      recordar.checked = true;
    }
  } catch {}

  /* ---------- Envío ---------- */
  const marcar = (input, invalido) =>
    input.closest(".campo-input").classList.toggle("invalido", invalido);

  const mostrarError = (msg, input) => {
    error.textContent = msg;
    error.hidden = false;
    marcar(correo, input === correo);
    marcar(clave, input === clave);
    input.focus();
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    error.hidden = true;
    marcar(correo, false);
    marcar(clave, false);

    const email = correo.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return mostrarError("Escribe un correo válido, por ejemplo nombre@correo.com.", correo);
    }
    if (!clave.value) {
      return mostrarError("Escribe tu contraseña.", clave);
    }

    try {
      if (recordar.checked) localStorage.setItem(CLAVE_CORREO, email);
      else localStorage.removeItem(CLAVE_CORREO);
    } catch {}

    // El servidor valida el correo y la contraseña de administrador, profesores y estudiantes
    try {
      const respuesta = await fetch(NovaModelo.API + "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ correo: email, clave: clave.value })
      });
      const datos = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) {
        return mostrarError(datos.mensaje || "No se pudo iniciar sesión", datos.campo === "correo" ? correo : clave);
      }
      sessionStorage.setItem("nova_token", datos.token);
      NovaSesion.iniciar(datos.usuario.rol, datos.usuario.id);
      window.location.href = DESTINOS[datos.usuario.rol];
    } catch {
      return mostrarError("No se pudo conectar con el servidor. Inicia el backend (npm start en la carpeta backend).", correo);
    }
  });
})();
