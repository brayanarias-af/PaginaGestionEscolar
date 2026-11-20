const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");

// Lee backend/.env (DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD). Las variables del sistema tienen prioridad.
try {
    process.loadEnvFile(path.resolve(__dirname, "..", ".env"));
} catch {}

const carpetaMigraciones = path.resolve(__dirname, "..", "..", "database", "migraciones");

const configuracion = process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
          host: process.env.DB_HOST || "localhost",
          port: Number(process.env.DB_PORT || 5432),
          database: process.env.DB_NAME || "DB_COLEGIO",
          user: process.env.DB_USER || "postgres",
          password: process.env.DB_PASSWORD
      };

const pool = new Pool({ ...configuracion, max: 10 });
pool.on("error", (e) => console.error("Error en la conexión a PostgreSQL:", e.message));

// Abre la conexión y crea las tablas nuevas si no existen (las tablas originales no se tocan).
async function conectar() {
    await pool.query("SELECT 1");
    if (fs.existsSync(carpetaMigraciones)) {
        for (const f of fs.readdirSync(carpetaMigraciones).filter((x) => x.endsWith(".sql")).sort()) {
            await pool.query(fs.readFileSync(path.join(carpetaMigraciones, f), "utf8"));
        }
    }
    return pool;
}

// Comprueba la conexión mediante una consulta SQL.
async function verificarConexion() {
    try {
        const { rows } = await pool.query("SELECT version() AS version, current_database() AS base");
        return { conectado: true, motor: "PostgreSQL", version: rows[0].version, base: rows[0].base };
    } catch (error) {
        return { conectado: false, error: error.message || String(error.code || error) };
    }
}

// Ejecuta varias consultas como una sola transacción.
async function transaccion(fn) {
    const cliente = await pool.connect();
    try {
        await cliente.query("BEGIN");
        const resultado = await fn(cliente);
        await cliente.query("COMMIT");
        return resultado;
    } catch (error) {
        await cliente.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        cliente.release();
    }
}

module.exports = { pool, conectar, verificarConexion, transaccion };
