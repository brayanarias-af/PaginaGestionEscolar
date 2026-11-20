const express = require("express");
const database = require("../../config/database");
const { requerirSesion } = require("../../middleware/autenticacion");
const servicio = require("./datos.service");
const permisos = require("./datos.permisos");

const router = express.Router();
router.use(requerirSesion);

const { CLAVES } = servicio;
const { ErrorPermiso } = permisos;

// Una cuenta de estudiante/profesor solo sigue siendo válida mientras exista y esté activa
function sesionVigente(sesion, leer) {
    if (sesion.rol === "administrador") return true;
    const coleccion = sesion.rol === "estudiante" ? "nova_estudiantes" : sesion.rol === "profesor" ? "nova_profesores" : null;
    if (!coleccion) return false;
    const yo = leer(coleccion).find((r) => r.id === sesion.id);
    return !!yo && yo.estado === "Activo";
}

// Traduce errores de PostgreSQL (restricciones y triggers de tu base) a mensajes claros
function traducirError(error) {
    if (error instanceof ErrorPermiso) return { estado: error.estado, mensaje: error.message };
    const c = String(error.constraint || "");
    switch (error.code) {
        case "23505": {
            const campo = /documento/.test(c) ? "documento" : /codigo/.test(c) ? "código" : /correo|usuarios/.test(c) ? "correo" : "valor";
            return { estado: 409, mensaje: `Ya existe un registro con ese ${campo}.` };
        }
        case "23503":
            return { estado: 409, mensaje: "No se pudo completar porque hay registros relacionados." };
        case "23514":
            return { estado: 400, mensaje: "Un dato no cumple las reglas de la base de datos." };
        case "23502":
            return { estado: 400, mensaje: "Falta un dato obligatorio." };
        case "22P02":
        case "22007":
        case "22003":
            return { estado: 400, mensaje: "Hay un dato con formato no válido." };
    }
    if (String(error.code || "").startsWith("P0")) return { estado: 400, mensaje: error.message }; // RAISE EXCEPTION de tus triggers
    return null;
}

// GET /api/datos -> todas las colecciones que el rol puede ver
router.get("/", async (req, res) => {
    const { rol, id } = req.sesion;
    const { versiones, leer } = await servicio.cargar(database.pool);
    if (!sesionVigente(req.sesion, leer)) return res.status(401).json({ mensaje: "Tu cuenta ya no está activa." });
    res.json({ datos: permisos.proyectar(rol, id, leer), versiones });
});

// PUT /api/datos/:clave  { datos: [...], base: <versión que tenía el cliente> }
router.put("/:clave", async (req, res) => {
    const { rol, id } = req.sesion;
    const clave = req.params.clave;
    if (!CLAVES.includes(clave)) return res.status(404).json({ mensaje: "Colección desconocida." });

    const enviado = req.body && req.body.datos;
    if (!Array.isArray(enviado) || !enviado.every(permisos.esRegistro)) {
        return res.status(400).json({ mensaje: "Los datos enviados no son válidos (cada registro necesita un id)." });
    }
    const ids = enviado.map((r) => r.id);
    if (new Set(ids).size !== ids.length) return res.status(400).json({ mensaje: "Hay registros con el mismo id." });

    try {
        const salida = await database.transaccion(async (q) => {
            // Un solo escritor a la vez por colección (evita que dos guardados se pisen)
            await q.query("SELECT pg_advisory_xact_lock(hashtext($1))", [clave]);
            const { colecciones, versiones, leer } = await servicio.cargar(q);
            if (!sesionVigente(req.sesion, leer)) throw new ErrorPermiso("Tu cuenta ya no está activa.", 401);

            const previo = { datos: colecciones[clave], version: versiones[clave] };
            const ctx = { rol, id };

            if (rol === "administrador") {
                if (clave === "nova_notas" && !permisos.notasValidas(enviado)) {
                    throw new ErrorPermiso("Las notas deben estar entre 0.0 y 5.0.", 400);
                }
                // Versión al día: se reemplaza tal cual (respeta borrados).
                // Versión desfasada (otra persona guardó antes): se fusiona por id y nunca se pierde nada.
                const alDia = req.body.base === previo.version;
                const nuevo = alDia ? enviado : permisos.unionPorId(previo.datos, enviado);
                const { version, ignorados } = await servicio.escribir(q, clave, nuevo, previo, ctx);
                return { datos: nuevo, version, fusionado: !alDia, ...(ignorados && { ignorados }) };
            }

            const { nuevo, ignorados: sinPermiso } = permisos.aplicarEscritura(rol, id, clave, enviado, previo.datos, leer);
            const { version, ignorados } = await servicio.escribir(q, clave, nuevo, previo, ctx);
            const vista = permisos.proyectar(rol, id, (c) => (c === clave ? nuevo : leer(c)))[clave];
            return { datos: vista, version, ignorados: (sinPermiso || 0) + ignorados };
        });
        res.json(salida);
    } catch (error) {
        const t = traducirError(error);
        if (t) {
            console.warn(`⚠️  No se guardó ${clave} (${rol}): ${t.mensaje}` + (error.code ? ` [${error.code}${error.constraint ? " " + error.constraint : ""}]` : ""));
            return res.status(t.estado).json({ mensaje: t.mensaje });
        }
        console.error("Error guardando", clave, error);
        res.status(500).json({ mensaje: "No se pudo guardar en la base de datos." });
    }
});

module.exports = router;
