const { leerToken } = require("../modulos/autenticacion/token");

// Exige un token válido (Authorization: Bearer ...) y deja la sesión en req.sesion = { rol, id }.
function requerirSesion(req, res, next) {
    const cabecera = req.headers.authorization || "";
    const sesion = cabecera.startsWith("Bearer ") ? leerToken(cabecera.slice(7)) : null;
    if (!sesion) return res.status(401).json({ mensaje: "Sesión no válida o vencida. Inicia sesión de nuevo." });
    req.sesion = sesion;
    next();
}

module.exports = { requerirSesion };
