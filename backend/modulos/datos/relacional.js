// Conecta el panel con las tablas reales de DB_COLEGIO:
//   nova_estudiantes -> usuarios + estudiantes      nova_profesores -> usuarios + profesores
//   nova_materias    -> materias (+ grados)         matriculas      -> matriculas (+ año lectivo activo)
//   nova_notas       -> notas + actividades
// El front sigue trabajando con sus mismos objetos; aquí se traducen de ida y vuelta.
const database = require("../../config/database");
const { ErrorPermiso, norm, unionPorId, esRegistro } = require("./datos.permisos");

const CLAVES = ["nova_estudiantes", "nova_profesores", "nova_materias", "matriculas", "nova_notas"];
const SIN_CLAVE = "!sin-clave!"; // usuarios.clave_hash no admite vacío: marca "aún sin contraseña"
const ESTADOS_USUARIO = ["Activo", "Retirado", "Inactivo"];

/* ---------- utilidades ---------- */
const num = (v) => {
    if (v === null || v === undefined || String(v).trim() === "") return null;
    const n = parseFloat(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : null;
};
const salidaNum = (v) => (v === null || v === undefined ? "" : Number(v));
const fechaISO = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const estadoUsuario = (v) => (ESTADOS_USUARIO.includes(v) ? v : /activ/i.test(String(v)) ? "Activo" : "Inactivo");
const canon = (v) =>
    Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
const iguales = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

/* ---------- ids del front <-> ids reales ---------- */
async function cargarIds(q) {
    const { rows } = await q.query("SELECT tabla, id_db::text AS id_db, id_front, extra FROM nova_ids");
    const porDb = new Map();
    const porFront = new Map();
    const mapa = (m, t) => (m.has(t) ? m.get(t) : m.set(t, new Map()).get(t));
    const poner = (t, idDb, idFront, extra) => {
        mapa(porDb, t).set(idDb, { front: idFront, extra: extra || {} });
        mapa(porFront, t).set(idFront, idDb);
    };
    rows.forEach((r) => poner(r.tabla, r.id_db, r.id_front, r.extra));
    return {
        front: (t, idDb) => mapa(porDb, t).get(String(idDb))?.front ?? String(idDb),
        extra: (t, idDb) => mapa(porDb, t).get(String(idDb))?.extra ?? {},
        db(t, idFront) {
            const v = mapa(porFront, t).get(String(idFront));
            if (v !== undefined) return v;
            return /^\d+$/.test(String(idFront)) && !mapa(porDb, t).has(String(idFront)) ? String(idFront) : null;
        },
        async registrar(t, idDb, idFront, extra = {}) {
            await q.query(
                "INSERT INTO nova_ids (tabla, id_db, id_front, extra) VALUES ($1, $2, $3, $4::jsonb) " +
                    "ON CONFLICT (tabla, id_db) DO UPDATE SET id_front = EXCLUDED.id_front, extra = EXCLUDED.extra",
                [t, idDb, idFront, JSON.stringify(extra)]
            );
            poner(t, String(idDb), idFront, extra);
        },
        async olvidar(t, idDb) {
            await q.query("DELETE FROM nova_ids WHERE tabla = $1 AND id_db = $2", [t, idDb]);
            const e = mapa(porDb, t).get(String(idDb));
            if (e) {
                mapa(porFront, t).delete(e.front);
                mapa(porDb, t).delete(String(idDb));
            }
        }
    };
}

/* ---------- LEER: tablas reales -> objetos del front ---------- */
async function cargar(q) {
    const ids = await cargarIds(q);
    const f = (t, id) => ids.front(t, id);
    const filas = async (sql, p) => (await q.query(sql, p)).rows;
    const clave = (h) => (h === SIN_CLAVE ? "" : h);

    const est = await filas(
        `SELECT e.id::text AS id, e.codigo, e.documento, g.nombre AS grado, u.nombre, u.correo, u.clave_hash, u.estado
           FROM estudiantes e JOIN usuarios u ON u.id = e.usuario_id JOIN grados g ON g.id = e.grado_id ORDER BY e.id`
    );
    const pro = await filas(
        `SELECT p.id::text AS id, p.documento, p.especialidad, u.nombre, u.correo, u.clave_hash, u.estado
           FROM profesores p JOIN usuarios u ON u.id = p.usuario_id ORDER BY p.id`
    );
    const mat = await filas(
        `SELECT m.id::text AS id, m.codigo, m.nombre, g.nombre AS grado, m.profesor_id::text AS profesor_id, m.cupos, m.estado
           FROM materias m JOIN grados g ON g.id = m.grado_id ORDER BY m.id`
    );
    const matr = await filas(
        `SELECT x.id::text AS id, x.estudiante_id::text AS estudiante_id, x.materia_id::text AS materia_id, ma.nombre AS materia,
                x.estado, x.fecha_matricula, x.fecha_cancelacion
           FROM matriculas x JOIN materias ma ON ma.id = x.materia_id ORDER BY x.id`
    );
    const notas = await filas(
        `SELECT n.id::text AS id, n.periodo, n.autoevaluacion, n.parcial, m.estudiante_id::text AS estudiante_id,
                u.nombre AS estudiante_nombre, ma.nombre AS materia
           FROM notas n JOIN matriculas m ON m.id = n.matricula_id JOIN estudiantes e ON e.id = m.estudiante_id
           JOIN usuarios u ON u.id = e.usuario_id JOIN materias ma ON ma.id = m.materia_id
          WHERE n.estado = 'Vigente' ORDER BY n.id`
    );
    const acts = await filas("SELECT nota_id::text AS nota_id, nombre, calificacion FROM actividades WHERE estado = 'Vigente' ORDER BY nota_id, orden, id");
    const actsPorNota = new Map();
    acts.forEach((a) => actsPorNota.set(a.nota_id, [...(actsPorNota.get(a.nota_id) || []), { nombre: a.nombre, nota: salidaNum(a.calificacion) }]));
    const vers = await filas("SELECT clave, version FROM nova_versiones");
    // Solo cuentas que NO son de estudiante/profesor (administradores): para comprobar correos repetidos
    const admins = await filas("SELECT id::text AS id, correo FROM usuarios WHERE rol NOT IN ('estudiante', 'profesor')");

    const colecciones = {
        nova_estudiantes: est.map((r) => ({
            id: f("estudiantes", r.id), codigo: r.codigo, nombre: r.nombre, documento: r.documento, grado: r.grado,
            correo: r.correo, claveHash: clave(r.clave_hash), estado: r.estado
        })),
        nova_profesores: pro.map((r) => ({
            id: f("profesores", r.id), nombre: r.nombre, documento: r.documento, materia: r.especialidad || "",
            correo: r.correo, claveHash: clave(r.clave_hash), estado: r.estado
        })),
        nova_materias: mat.map((r) => ({
            id: f("materias", r.id), codigo: r.codigo, nombre: r.nombre, grado: r.grado,
            profesorId: r.profesor_id ? f("profesores", r.profesor_id) : "", estado: r.estado,
            ...(r.cupos !== null && { cupos: r.cupos })
        })),
        matriculas: matr.map((r) => {
            const ex = ids.extra("matriculas", r.id);
            const ms = r.fecha_matricula.getTime();
            const out = {
                id: f("matriculas", r.id), estudianteId: f("estudiantes", r.estudiante_id), materiaId: f("materias", r.materia_id),
                materia: r.materia, estado: r.estado,
                fecha: ex.fecha !== undefined && ex.fechaMs === ms ? ex.fecha : r.fecha_matricula.toISOString(),
                fechaCancelacion: null
            };
            if (r.fecha_cancelacion) {
                const mc = r.fecha_cancelacion.getTime();
                out.fechaCancelacion = ex.fechaCancelacion !== undefined && ex.fechaCancelMs === mc ? ex.fechaCancelacion : r.fecha_cancelacion.toISOString();
            }
            return out;
        }),
        nova_notas: notas.map((r) => ({
            id: f("notas", r.id), periodo: String(r.periodo), estudianteId: f("estudiantes", r.estudiante_id),
            estudianteNombre: r.estudiante_nombre, materia: r.materia, autoevaluacion: salidaNum(r.autoevaluacion),
            actividades: actsPorNota.get(r.id) || [], parcial: salidaNum(r.parcial)
        })),
        usuarios_correos: admins
    };
    const versiones = Object.fromEntries(CLAVES.map((c) => [c, vers.find((v) => v.clave === c)?.version ?? 0]));
    return { colecciones, versiones, leer: (c) => colecciones[c] || [] };
}

/* ---------- ESCRIBIR: objetos del front -> tablas reales ---------- */
async function gradoId(q, nombre) {
    const { rows } = await q.query("SELECT id::text AS id, nombre FROM grados ORDER BY id");
    const g = rows.find((x) => norm(x.nombre) === norm(nombre));
    if (!g) throw new ErrorPermiso(`El grado «${nombre}» no existe. Grados disponibles: ${rows.map((x) => x.nombre).join(", ")}.`, 400);
    return g.id;
}
const noSePuede = (nombre, motivo) => new ErrorPermiso(`No se puede eliminar «${nombre}» porque ${motivo}. Cámbialo a Inactivo si ya no se usa.`, 409);

const manejadores = {
    nova_estudiantes: {
        async crear(q, ids, r) {
            const grado = await gradoId(q, r.grado);
            const u = await q.query(
                "INSERT INTO usuarios (nombre, correo, clave_hash, rol, estado) VALUES ($1, $2, $3, 'estudiante', $4) RETURNING id::text AS id",
                [r.nombre, r.correo, r.claveHash || SIN_CLAVE, estadoUsuario(r.estado)]
            );
            const e = await q.query(
                "INSERT INTO estudiantes (usuario_id, codigo, documento, grado_id) VALUES ($1, $2, $3, $4) RETURNING id::text AS id",
                [u.rows[0].id, r.codigo, r.documento, grado]
            );
            await ids.registrar("estudiantes", e.rows[0].id, r.id);
        },
        async cambiar(q, ids, r) {
            const id = ids.db("estudiantes", r.id);
            if (!id) return false;
            const grado = await gradoId(q, r.grado);
            await q.query(
                "UPDATE usuarios SET nombre = $1, correo = $2, clave_hash = $3, estado = $4 WHERE id = (SELECT usuario_id FROM estudiantes WHERE id = $5)",
                [r.nombre, r.correo, r.claveHash || SIN_CLAVE, estadoUsuario(r.estado), id]
            );
            await q.query("UPDATE estudiantes SET codigo = $1, documento = $2, grado_id = $3 WHERE id = $4", [r.codigo, r.documento, grado, id]);
        },
        async borrar(q, ids, r) {
            const id = ids.db("estudiantes", r.id);
            if (!id) return;
            try {
                const d = await q.query("DELETE FROM estudiantes WHERE id = $1 RETURNING usuario_id::text AS u", [id]);
                if (d.rows[0]) await q.query("DELETE FROM usuarios WHERE id = $1", [d.rows[0].u]);
            } catch (e) {
                if (e.code === "23503") throw noSePuede(r.nombre, "tiene matrículas u otros registros asociados");
                throw e;
            }
            await ids.olvidar("estudiantes", id);
        }
    },

    nova_profesores: {
        async crear(q, ids, r) {
            const u = await q.query(
                "INSERT INTO usuarios (nombre, correo, clave_hash, rol, estado) VALUES ($1, $2, $3, 'profesor', $4) RETURNING id::text AS id",
                [r.nombre, r.correo, r.claveHash || SIN_CLAVE, estadoUsuario(r.estado)]
            );
            const p = await q.query(
                "INSERT INTO profesores (usuario_id, documento, especialidad) VALUES ($1, $2, $3) RETURNING id::text AS id",
                [u.rows[0].id, r.documento, r.materia || null]
            );
            await ids.registrar("profesores", p.rows[0].id, r.id);
        },
        async cambiar(q, ids, r) {
            const id = ids.db("profesores", r.id);
            if (!id) return false;
            await q.query(
                "UPDATE usuarios SET nombre = $1, correo = $2, clave_hash = $3, estado = $4 WHERE id = (SELECT usuario_id FROM profesores WHERE id = $5)",
                [r.nombre, r.correo, r.claveHash || SIN_CLAVE, estadoUsuario(r.estado), id]
            );
            await q.query("UPDATE profesores SET documento = $1, especialidad = $2 WHERE id = $3", [r.documento, r.materia || null, id]);
        },
        async borrar(q, ids, r) {
            const id = ids.db("profesores", r.id);
            if (!id) return;
            try {
                const d = await q.query("DELETE FROM profesores WHERE id = $1 RETURNING usuario_id::text AS u", [id]);
                if (d.rows[0]) await q.query("DELETE FROM usuarios WHERE id = $1", [d.rows[0].u]);
            } catch (e) {
                if (e.code === "23503") throw noSePuede(r.nombre, "tiene materias u otros registros asociados");
                throw e;
            }
            await ids.olvidar("profesores", id);
        }
    },

    nova_materias: {
        async crear(q, ids, r) {
            const grado = await gradoId(q, r.grado);
            const profesor = r.profesorId ? ids.db("profesores", r.profesorId) : null;
            const m = await q.query(
                "INSERT INTO materias (codigo, nombre, grado_id, profesor_id, cupos, estado) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id::text AS id",
                [r.codigo, r.nombre, grado, profesor, r.cupos ?? null, r.estado === "Inactiva" ? "Inactiva" : "Activa"]
            );
            await ids.registrar("materias", m.rows[0].id, r.id);
        },
        async cambiar(q, ids, r) {
            const id = ids.db("materias", r.id);
            if (!id) return false;
            const grado = await gradoId(q, r.grado);
            const profesor = r.profesorId ? ids.db("profesores", r.profesorId) : null;
            await q.query("UPDATE materias SET codigo = $1, nombre = $2, grado_id = $3, profesor_id = $4, estado = $5 WHERE id = $6", [
                r.codigo, r.nombre, grado, profesor, r.estado === "Inactiva" ? "Inactiva" : "Activa", id
            ]);
            if (r.cupos !== undefined) await q.query("UPDATE materias SET cupos = $1 WHERE id = $2", [r.cupos, id]);
        },
        async borrar(q, ids, r) {
            const id = ids.db("materias", r.id);
            if (!id) return;
            try {
                await q.query("DELETE FROM materias WHERE id = $1", [id]);
            } catch (e) {
                if (e.code === "23503") throw noSePuede(r.nombre, "tiene estudiantes matriculados");
                throw e;
            }
            await ids.olvidar("materias", id);
        }
    },

    matriculas: {
        async crear(q, ids, r) {
            const est = ids.db("estudiantes", r.estudianteId);
            const mat = ids.db("materias", r.materiaId);
            if (!est || !mat) return false;
            const anio = await q.query("SELECT id::text AS id FROM anios_lectivos WHERE estado = 'Activo' ORDER BY anio DESC LIMIT 1");
            if (!anio.rows[0]) throw new ErrorPermiso("No hay un año lectivo activo para registrar la matrícula.", 409);
            const cancelada = r.estado === "Cancelada";
            const res = await q.query(
                `INSERT INTO matriculas (estudiante_id, materia_id, anio_lectivo_id, estado, fecha_matricula, fecha_cancelacion)
                 VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now()), $6::timestamptz)
                 RETURNING id::text AS id, fecha_matricula, fecha_cancelacion`,
                [est, mat, anio.rows[0].id, cancelada ? "Cancelada" : "Matriculada", fechaISO(r.fecha), cancelada ? fechaISO(r.fechaCancelacion) || new Date().toISOString() : null]
            );
            const fila = res.rows[0];
            await ids.registrar("matriculas", fila.id, r.id, {
                fecha: r.fecha, fechaMs: fila.fecha_matricula.getTime(),
                fechaCancelacion: r.fechaCancelacion ?? null, fechaCancelMs: fila.fecha_cancelacion ? fila.fecha_cancelacion.getTime() : null
            });
        },
        async cambiar(q, ids, r) {
            const id = ids.db("matriculas", r.id);
            if (!id) return false;
            const cancelada = r.estado === "Cancelada";
            const res = await q.query(
                "UPDATE matriculas SET estado = $1, fecha_cancelacion = $2::timestamptz WHERE id = $3 RETURNING fecha_matricula, fecha_cancelacion",
                [cancelada ? "Cancelada" : "Matriculada", cancelada ? fechaISO(r.fechaCancelacion) || new Date().toISOString() : null, id]
            );
            const fila = res.rows[0];
            const ex = ids.extra("matriculas", id);
            await ids.registrar("matriculas", id, r.id, {
                fecha: ex.fecha ?? r.fecha, fechaMs: fila.fecha_matricula.getTime(),
                fechaCancelacion: r.fechaCancelacion ?? null, fechaCancelMs: fila.fecha_cancelacion ? fila.fecha_cancelacion.getTime() : null
            });
        },
        async borrar(q, ids, r) {
            const id = ids.db("matriculas", r.id);
            if (!id) return;
            try {
                await q.query("DELETE FROM matriculas WHERE id = $1", [id]);
            } catch (e) {
                if (e.code === "23503") throw noSePuede(r.materia || "la matrícula", "ya tiene notas registradas");
                throw e;
            }
            await ids.olvidar("matriculas", id);
        }
    },

    nova_notas: {
        async crear(q, ids, r, ctx) { return guardarNota(q, ids, r, ctx); },
        async cambiar(q, ids, r, ctx) { return guardarNota(q, ids, r, ctx); },
        async borrar(q, ids, r) {
            const id = ids.db("notas", r.id);
            if (!id) return;
            // Se anula (no se borra) para conservar el historial y la auditoría
            await q.query("UPDATE actividades SET estado = 'Anulada' WHERE nota_id = $1 AND estado = 'Vigente'", [id]);
            await q.query("UPDATE notas SET estado = 'Anulada' WHERE id = $1", [id]);
        }
    }
};

async function guardarNota(q, ids, r, ctx) {
    const est = ids.db("estudiantes", r.estudianteId);
    if (!est) return false;
    const periodo = parseInt(r.periodo, 10);
    if (!(periodo >= 1 && periodo <= 4)) throw new ErrorPermiso("El periodo debe ser 1, 2, 3 o 4.", 400);
    // La matrícula del estudiante en esa materia (por nombre, como lo hace el front)
    const ms = await q.query(
        "SELECT x.id::text AS id, x.estado, ma.nombre FROM matriculas x JOIN materias ma ON ma.id = x.materia_id WHERE x.estudiante_id = $1 ORDER BY x.id DESC",
        [est]
    );
    const candidatas = ms.rows.filter((m) => norm(m.nombre) === norm(r.materia));
    const matricula = candidatas.find((m) => m.estado === "Matriculada") || candidatas[0];
    if (!matricula) return false;

    const auto = num(r.autoevaluacion);
    const parcial = num(r.parcial);
    let nid = ids.db("notas", r.id);
    const destino = (await q.query("SELECT id::text AS id FROM notas WHERE matricula_id = $1 AND periodo = $2", [matricula.id, periodo])).rows[0];

    if (nid) {
        if (destino && destino.id !== nid) throw new ErrorPermiso("Ya existe una nota de ese estudiante, en esa materia y periodo.", 409);
        await q.query(
            "UPDATE notas SET matricula_id = $1, periodo = $2, autoevaluacion = $3, parcial = $4, estado = 'Vigente', registrada_por_usuario_id = COALESCE($5, registrada_por_usuario_id) WHERE id = $6",
            [matricula.id, periodo, auto, parcial, ctx.actor, nid]
        );
    } else if (destino) {
        nid = destino.id; // ya había una (por ejemplo anulada): se reutiliza
        await q.query(
            "UPDATE notas SET autoevaluacion = $1, parcial = $2, estado = 'Vigente', registrada_por_usuario_id = COALESCE($3, registrada_por_usuario_id) WHERE id = $4",
            [auto, parcial, ctx.actor, nid]
        );
        await ids.registrar("notas", nid, r.id);
    } else {
        const n = await q.query(
            "INSERT INTO notas (matricula_id, periodo, autoevaluacion, parcial, registrada_por_usuario_id) VALUES ($1, $2, $3, $4, $5) RETURNING id::text AS id",
            [matricula.id, periodo, auto, parcial, ctx.actor]
        );
        nid = n.rows[0].id;
        await ids.registrar("notas", nid, r.id);
    }

    // Actividades: se actualizan por posición; las que sobran se anulan
    const vigentes = (await q.query("SELECT id::text AS id FROM actividades WHERE nota_id = $1 AND estado = 'Vigente' ORDER BY orden, id", [nid])).rows;
    const lista = (Array.isArray(r.actividades) ? r.actividades : [])
        .map((a, i) => ({ nombre: String((a && a.nombre) || "").trim() || (num(a && a.nota) !== null ? `Actividad ${i + 1}` : ""), nota: num(a && a.nota) }))
        .filter((a) => a.nombre);
    for (let i = 0; i < lista.length; i++) {
        if (vigentes[i]) {
            await q.query("UPDATE actividades SET nombre = $1, calificacion = $2, orden = $3 WHERE id = $4", [lista[i].nombre, lista[i].nota, i + 1, vigentes[i].id]);
        } else {
            await q.query("INSERT INTO actividades (nota_id, nombre, calificacion, orden) VALUES ($1, $2, $3, $4)", [nid, lista[i].nombre, lista[i].nota, i + 1]);
        }
    }
    for (const sobrante of vigentes.slice(lista.length)) await q.query("UPDATE actividades SET estado = 'Anulada' WHERE id = $1", [sobrante.id]);
}

/* ---------- Auditoría: quién hizo el cambio ---------- */
let ajusteActor; // nombre del parámetro que lee tu trigger de auditoría (si usa current_setting)
async function nombreAjusteActor(q) {
    if (ajusteActor !== undefined) return ajusteActor;
    const { rows } = await q.query("SELECT p.prosrc FROM pg_trigger g JOIN pg_proc p ON p.oid = g.tgfoid WHERE g.tgname = 'trg_auditoria' LIMIT 1");
    const m = rows[0] && /current_setting\(\s*'([^']+)'/.exec(rows[0].prosrc);
    ajusteActor = m ? m[1] : null;
    return ajusteActor;
}
async function usuarioActor(q, ids, ctx) {
    if (ctx.rol === "administrador") return /^\d+$/.test(String(ctx.id)) ? String(ctx.id) : null;
    const tabla = ctx.rol === "estudiante" ? "estudiantes" : ctx.rol === "profesor" ? "profesores" : null;
    const idDb = tabla && ids.db(tabla, ctx.id);
    if (!idDb) return null;
    const { rows } = await q.query(`SELECT usuario_id::text AS u FROM ${tabla} WHERE id = $1`, [idDb]);
    return rows[0] ? rows[0].u : null;
}

// Guarda una colección: compara lo anterior con lo nuevo y aplica solo las diferencias.
// "previo" = { datos, version }.  Devuelve { version, ignorados }.
async function escribir(q, clave, nuevo, previo, ctx) {
    const ids = await cargarIds(q);
    const actor = await usuarioActor(q, ids, ctx);
    const ajuste = await nombreAjusteActor(q);
    if (ajuste && actor) await q.query("SELECT set_config($1, $2, true)", [ajuste, actor]);

    const antes = new Map(previo.datos.map((r) => [r.id, r]));
    const despues = new Map(nuevo.map((r) => [r.id, r]));
    const borrar = previo.datos.filter((r) => !despues.has(r.id));
    const crear = nuevo.filter((r) => !antes.has(r.id));
    const cambiar = nuevo.filter((r) => antes.has(r.id) && !iguales(r, antes.get(r.id)));
    if (!borrar.length && !crear.length && !cambiar.length) return { version: previo.version, ignorados: 0 };

    const h = manejadores[clave];
    const c = { ...ctx, actor };
    let ignorados = 0;
    for (const r of borrar) await h.borrar(q, ids, r, c);
    for (const r of crear) if ((await h.crear(q, ids, r, c)) === false) ignorados++;
    for (const r of cambiar) if ((await h.cambiar(q, ids, r, c)) === false) ignorados++;

    const v = await q.query(
        "INSERT INTO nova_versiones (clave, version) VALUES ($1, 1) ON CONFLICT (clave) DO UPDATE SET version = nova_versiones.version + 1, actualizado = now() RETURNING version",
        [clave]
    );
    return { version: v.rows[0].version, ignorados };
}

/* ---------- Al arrancar ---------- */
// Los datos que el panel guardó antes en nova_datos (versión anterior) se pasan a las tablas reales.
// nova_datos NO se borra: queda como copia.
async function importarLegado() {
    for (const clave of CLAVES) {
        try {
            const r = await database.transaccion(async (q) => {
                await q.query("SELECT pg_advisory_xact_lock(hashtext($1))", [clave]);
                if ((await q.query("SELECT 1 FROM nova_versiones WHERE clave = $1", [clave])).rows.length) return null;
                const leg = await q.query("SELECT datos FROM nova_datos WHERE clave = $1", [clave]);
                const datos = leg.rows[0] && Array.isArray(leg.rows[0].datos) ? leg.rows[0].datos.filter(esRegistro) : [];
                if (!datos.length) return null;
                const { colecciones } = await cargar(q);
                const res = await escribir(q, clave, unionPorId(colecciones[clave], datos), { datos: colecciones[clave], version: 0 }, { rol: "importacion", id: null });
                return { total: datos.length, ...res };
            });
            if (r) console.log(`📥 ${r.total} registros de ${clave} pasaron a las tablas reales` + (r.ignorados ? ` (${r.ignorados} omitidos por referencias que ya no existen)` : ""));
        } catch (e) {
            console.error(`⚠️  No se pudo pasar ${clave} desde nova_datos: ${e.message}`);
        }
    }
}

// Avisa si alguna tabla no genera sola su id (las inserciones lo necesitan)
async function revisarEsquema() {
    const { rows } = await database.pool.query(
        `SELECT table_name FROM information_schema.columns
          WHERE table_schema = current_schema() AND column_name = 'id' AND column_default IS NULL AND is_identity = 'NO'
            AND table_name IN ('usuarios','estudiantes','profesores','materias','matriculas','notas','actividades')`
    );
    rows.forEach((r) => console.warn(`⚠️  La columna id de «${r.table_name}» no se genera sola (identity/serial); no se podrán crear registros nuevos.`));
}

module.exports = { CLAVES, cargar, escribir, importarLegado, revisarEsquema };
