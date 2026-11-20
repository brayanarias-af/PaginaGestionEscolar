const { FORMATO_HASH } = require("../autenticacion/claves");

const norm = (s) =>
    String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const esRegistro = (r) => r && typeof r === "object" && !Array.isArray(r) && typeof r.id === "string" && r.id !== "";
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ---------- Lo que ve cada rol ---------- */
function proyectar(rol, id, leer) {
    if (rol === "administrador") {
        return Object.fromEntries(["nova_estudiantes", "nova_profesores", "nova_materias", "matriculas", "nova_notas"].map((c) => [c, leer(c)]));
    }
    const estudiantes = leer("nova_estudiantes");
    const profesores = leer("nova_profesores");
    const materias = leer("nova_materias");
    const matriculas = leer("matriculas");
    const notas = leer("nova_notas");

    if (rol === "estudiante") {
        const yo = estudiantes.find((e) => e.id === id);
        return {
            nova_estudiantes: yo ? [yo] : [],
            nova_profesores: profesores.map((p) => ({ id: p.id, nombre: p.nombre, materia: p.materia, estado: p.estado })),
            nova_materias: materias,
            matriculas: matriculas.filter((m) => m.estudianteId === id),
            nova_notas: notas.filter((n) => n.estudianteId === id)
        };
    }
    if (rol === "profesor") {
        const yo = profesores.find((p) => p.id === id);
        const mias = materias.filter((m) => m.profesorId === id);
        const idsMias = new Set(mias.map((m) => m.id));
        const nombres = new Set(mias.map((m) => norm(m.nombre)));
        const susMatriculas = matriculas.filter((m) => idsMias.has(m.materiaId));
        const idsEst = new Set(susMatriculas.map((m) => m.estudianteId));
        return {
            nova_profesores: yo ? [yo] : [],
            nova_materias: materias,
            nova_estudiantes: estudiantes
                .filter((e) => idsEst.has(e.id))
                .map((e) => ({ id: e.id, codigo: e.codigo, nombre: e.nombre, grado: e.grado, estado: e.estado })),
            matriculas: susMatriculas,
            nova_notas: notas.filter((n) => nombres.has(norm(n.materia)))
        };
    }
    return null;
}

/* ---------- Validaciones ---------- */
function numeroNota(v) {
    if (v === null || v === undefined || String(v).trim() === "") return null;
    const n = parseFloat(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : null;
}

// Las notas deben estar entre 0.0 y 5.0 (RF-13)
function notasValidas(lista) {
    return lista.every((n) => {
        const valores = [n.autoevaluacion, n.parcial, ...(Array.isArray(n.actividades) ? n.actividades.map((a) => a && a.nota) : [])];
        return valores.every((v) => {
            const x = numeroNota(v);
            return x === null || (x >= 0 && x <= 5);
        });
    });
}

// leer("usuarios_correos") trae los correos de la tabla usuarios (los administradores)
function correoEnUso(correo, { exceptoId, leer }) {
    const buscado = String(correo).toLowerCase();
    const igual = (u) => String(u.correo || "").toLowerCase() === buscado && u.id !== exceptoId;
    return leer("nova_estudiantes").some(igual) || leer("nova_profesores").some(igual) || leer("usuarios_correos").some(igual);
}

const unionPorId = (servidor, cliente) => {
    const ids = new Set(cliente.map((r) => r.id));
    return [...cliente, ...servidor.filter((r) => !ids.has(r.id))];
};

class ErrorPermiso extends Error {
    constructor(mensaje, estado = 403) {
        super(mensaje);
        this.estado = estado;
    }
}

/* ---------- Qué puede escribir cada rol ---------- */
// Devuelve la colección completa resultante. Nunca toca registros fuera del alcance del rol.
function aplicarEscritura(rol, id, clave, enviado, actual, leer) {
    const resultado = { nuevo: actual, ignorados: 0 };

    // Cada persona solo puede cambiar su correo y su contraseña
    const cuentaPropia = () => {
        const mio = enviado.find((r) => r.id === id);
        if (!mio) return resultado;
        const cambios = {};
        if (mio.correo !== undefined) {
            if (!CORREO.test(String(mio.correo))) throw new ErrorPermiso("Escribe un correo válido.", 400);
            if (correoEnUso(mio.correo, { exceptoId: id, leer })) throw new ErrorPermiso("Ese usuario ya está en uso. Elige otro correo.", 409);
            cambios.correo = String(mio.correo).trim();
        }
        if (mio.claveHash !== undefined && mio.claveHash !== null) {
            if (!FORMATO_HASH.test(String(mio.claveHash))) throw new ErrorPermiso("Contraseña no válida.", 400);
            cambios.claveHash = mio.claveHash;
        }
        resultado.nuevo = actual.map((r) => (r.id === id ? { ...r, ...cambios } : r));
        return resultado;
    };

    if (rol === "estudiante") {
        if (clave === "nova_estudiantes") return cuentaPropia();
        if (clave === "matriculas") {
            const yo = leer("nova_estudiantes").find((e) => e.id === id);
            const materias = leer("nova_materias");
            const previos = new Set(actual.filter((m) => m.estudianteId === id).map((m) => m.id));
            const vistas = new Set();
            const propias = enviado.filter((m) => esRegistro(m) && m.estudianteId === id);
            const validas = propias
                .filter((m) => {
                    if (vistas.has(m.id)) return false;
                    vistas.add(m.id);
                    if (previos.has(m.id)) return true;
                    const mat = materias.find((x) => x.id === m.materiaId);
                    return !!(mat && mat.estado === "Activa" && yo && norm(mat.grado) === norm(yo.grado));
                })
                .map((m) => ({ ...m, estudianteId: id }));
            resultado.ignorados = enviado.length - validas.length;
            resultado.nuevo = actual.filter((m) => m.estudianteId !== id).concat(validas);
            return resultado;
        }
        throw new ErrorPermiso("No tienes permiso para modificar esta información.");
    }

    if (rol === "profesor") {
        if (clave === "nova_profesores") return cuentaPropia();
        if (clave === "nova_notas") {
            if (!notasValidas(enviado.filter(esRegistro))) throw new ErrorPermiso("Las notas deben estar entre 0.0 y 5.0.", 400);
            const mias = leer("nova_materias").filter((m) => m.profesorId === id);
            const nombres = new Set(mias.map((m) => norm(m.nombre)));
            const matriculas = leer("matriculas");
            const enScope = (n) => nombres.has(norm(n.materia));
            const previos = new Set(actual.filter(enScope).map((n) => n.id));
            const vistas = new Set();
            const validas = enviado.filter((n) => {
                if (!esRegistro(n) || vistas.has(n.id) || !enScope(n)) return false;
                vistas.add(n.id);
                if (previos.has(n.id)) return true;
                // Nota nueva: el estudiante debe estar (o haber estado) matriculado en una materia suya con ese nombre
                return matriculas.some(
                    (m) => m.estudianteId === n.estudianteId && mias.some((x) => x.id === m.materiaId && norm(x.nombre) === norm(n.materia))
                );
            });
            resultado.ignorados = enviado.length - validas.length;
            resultado.nuevo = actual.filter((n) => !enScope(n)).concat(validas);
            return resultado;
        }
        throw new ErrorPermiso("No tienes permiso para modificar esta información.");
    }

    throw new ErrorPermiso("Rol no permitido.");
}

module.exports = { proyectar, aplicarEscritura, unionPorId, notasValidas, esRegistro, ErrorPermiso, norm };
