const path = require("node:path");
const express = require("express");
const database = require("./config/database");

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND = path.resolve(__dirname, "..", "frontend");

// Permite abrir el front con Live Server (puerto 5501/5500) mientras el backend corre en el 3000
const ORIGENES = new Set(
    ["5500", "5501"].flatMap((p) => [`http://localhost:${p}`, `http://127.0.0.1:${p}`]).concat((process.env.NOVA_ORIGENES || "").split(",").filter(Boolean))
);
app.use((req, res, next) => {
    if (ORIGENES.has(req.headers.origin)) {
        res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
});

app.use(express.json({ limit: "5mb" }));

async function iniciar() {
    try {
        // Abrir conexión PostgreSQL y crear las tablas nuevas si faltan
        await database.conectar();

        // Comprobar conexión mediante una consulta SQL
        const resultado = await database.verificarConexion();

        if (!resultado.conectado) {
            throw new Error(resultado.error);
        }

        console.log("✅ Base de datos conectada");
        console.log("Motor:", resultado.motor);
        console.log("Versión:", resultado.version);
        console.log("Base:", resultado.base);

        const datos = require("./modulos/datos/datos.service");
        await datos.revisarEsquema();
        await datos.importarLegado(); // pasa lo que el panel guardó antes en nova_datos a tus tablas reales

        const { rolAdmin } = await require("./config/esquema").usuarios();
        const { rows } = await database.pool.query("SELECT COUNT(*)::int AS n FROM usuarios WHERE rol = $1", [rolAdmin]);
        if (!rows[0].n) {
            console.warn("⚠️  Aún no hay un administrador. Créalo con:  npm run crear-admin -- correo@dominio.com TuClave");
        }

        // Comprueba que el panel puede leer tus tablas reales; si algo falla, se ve aquí desde el arranque
        const contar = async () => {
            const { colecciones } = await datos.cargar(database.pool);
            return Object.fromEntries(datos.CLAVES.map((c) => [c, colecciones[c].length]));
        };
        try {
            console.log("✅ Tablas del panel leídas correctamente:", JSON.stringify(await contar()));
        } catch (e) {
            console.error("❌ El panel NO puede leer tus tablas:", e.message, e.code ? `[${e.code}]` : "");
            console.error("   Mientras eso falle, el front no guardará nada. Ejecuta npm run diagnostico y revisa el mensaje.");
        }

        app.get("/api/salud", (req, res) => res.send("Servidor Express funcionando correctamente"));
        // Solo desde este mismo equipo: abre http://localhost:3000/api/salud/db para ver si el panel llega a la base
        app.get("/api/salud/db", async (req, res) => {
            if (!/^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(req.ip || "")) return res.status(403).json({ mensaje: "Solo disponible desde este equipo." });
            try {
                res.json({ ok: true, registros: await contar() });
            } catch (e) {
                res.status(500).json({ ok: false, codigo: e.code, mensaje: e.message });
            }
        });
        app.use("/api/auth", require("./modulos/autenticacion/autenticacion.routes"));
        app.use("/api/datos", require("./modulos/datos/datos.routes"));
        app.use("/api", (req, res) => res.status(404).json({ mensaje: "Ruta no encontrada." }));

        // Sirve el front desde el mismo servidor: http://localhost:3000
        app.use(express.static(FRONTEND));

        app.use((err, req, res, next) => {
            const estado = err.status || err.statusCode || 500;
            if (estado >= 500) console.error(err);
            res.status(estado).json({ mensaje: estado === 413 ? "Los datos son demasiado grandes." : estado >= 500 ? "Error interno del servidor." : "Solicitud no válida." });
        });

        app.listen(PORT, () => {
            console.log(`Servidor funcionando en http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error("❌ Error de conexión:", error.message || error.code || error);
        if (error.code === "28P01") console.error("   La contraseña de PostgreSQL no es correcta. Revisa backend/.env (DB_PASSWORD).");
        if (error.code === "3D000") console.error("   La base de datos no existe. Revisa DB_NAME en backend/.env.");
        if (error.code === "ECONNREFUSED") console.error("   PostgreSQL no está encendido o el puerto no es el 5432.");
        process.exitCode = 1;
        await database.pool.end().catch(() => {});
    }
}

iniciar();
