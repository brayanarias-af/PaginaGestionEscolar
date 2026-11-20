const express = require("express");
const database = require("../../config/database");
const { cargar } = require("../datos/datos.service");
const esquema = require("../../config/esquema");
const { verificar } = require("./claves");
const { crearToken } = require("./token");
const { requerirSesion } = require("../../middleware/autenticacion");

const router = express.Router();

// Límite de intentos: 8 cada 10 minutos por IP + correo
const intentos = new Map();
const VENTANA = 10 * 60 * 1000;
const MAXIMO = 8;
function demasiados(clave) {
    const ahora = Date.now();
    const lista = (intentos.get(clave) || []).filter((t) => ahora - t < VENTANA);
    intentos.set(clave, lista);
    return lista.length >= MAXIMO;
}
const registrarFallo = (clave) => intentos.set(clave, [...(intentos.get(clave) || []), Date.now()]);

const fallo = (res, estado, mensaje, campo = "clave") => res.status(estado).json({ mensaje, campo });

// POST /api/auth/login  { correo, clave }  ->  { token, usuario: { id, rol, correo, nombre } }
router.post("/login", async (req, res) => {
    const correo = String((req.body && req.body.correo) || "").trim();
    const clave = String((req.body && req.body.clave) || "");
    if (!correo || !clave) return fallo(res, 400, "Escribe tu correo y tu contraseña.");

    const llave = `${req.ip}|${correo.toLowerCase()}`;
    if (demasiados(llave)) return fallo(res, 429, "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.");

    // 1) Administrador: tabla usuarios de la base de datos
    const { rolAdmin } = await esquema.usuarios();
    const { rows } = await database.pool.query(
        "SELECT id::text AS id, correo, clave_hash, rol, estado, to_jsonb(usuarios)->>'nombre' AS nombre FROM usuarios WHERE lower(correo) = lower($1) AND rol = $2",
        [correo, rolAdmin]
    );
    const admin = rows[0];
    if (admin) {
        if (!verificar(clave, admin.clave_hash)) {
            registrarFallo(llave);
            return fallo(res, 401, "Correo o contraseña incorrectos.");
        }
        if (!/^activ/i.test(String(admin.estado))) return fallo(res, 403, "Tu cuenta está inactiva. Comunícate con el administrador.", "correo");
        intentos.delete(llave);
        return res.json({
            token: crearToken("administrador", admin.id),
            usuario: { id: admin.id, rol: "administrador", correo: admin.correo, nombre: admin.nombre || "Administrador" }
        });
    }

    // 2) Estudiantes y profesores: registros que gestiona el administrador
    const igual = (u) => String(u.correo || "").toLowerCase() === correo.toLowerCase();
    const { leer } = await cargar(database.pool);
    const estudiante = leer("nova_estudiantes").find(igual);
    const profesor = estudiante ? null : leer("nova_profesores").find(igual);
    const cuenta = estudiante || profesor;
    const rol = estudiante ? "estudiante" : "profesor";

    if (!cuenta) {
        registrarFallo(llave);
        return fallo(res, 401, "Correo o contraseña incorrectos.");
    }
    if (!cuenta.claveHash) {
        return fallo(res, 403, "Esta cuenta aún no tiene contraseña. Pídele al administrador que se la asigne.");
    }
    if (!verificar(clave, cuenta.claveHash)) {
        registrarFallo(llave);
        return fallo(res, 401, "Correo o contraseña incorrectos.");
    }
    if (cuenta.estado !== "Activo") return fallo(res, 403, "Tu cuenta está inactiva. Comunícate con el administrador.", "correo");

    intentos.delete(llave);
    res.json({
        token: crearToken(rol, cuenta.id),
        usuario: { id: cuenta.id, rol, correo: cuenta.correo, nombre: cuenta.nombre }
    });
});

// GET /api/auth/yo -> comprueba que el token sigue siendo válido
router.get("/yo", requerirSesion, (req, res) => res.json({ rol: req.sesion.rol, id: req.sesion.id }));

module.exports = router;
