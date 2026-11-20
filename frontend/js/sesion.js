/* ===== Sesión (prototipo) =====
   Guarda quién inició sesión en sessionStorage (se borra al cerrar la pestaña).
   El token que emite el servidor (login) se guarda en sessionStorage["nova_token"]. */
const NovaSesion = (() => {
  const CLAVE = "nova_sesion";

  const iniciar = (rol, id) => {
    try { sessionStorage.setItem(CLAVE, JSON.stringify({ rol, id })); } catch {}
  };
  const actual = () => {
    try { return JSON.parse(sessionStorage.getItem(CLAVE)); } catch { return null; }
  };
  const cerrar = () => {
    try { sessionStorage.removeItem(CLAVE); sessionStorage.removeItem("nova_token"); } catch {}
  };

  return { iniciar, actual, cerrar };
})();
