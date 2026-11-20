const database = require("./database");

// Detecta cómo está definida la tabla "usuarios" en tu base real (valores permitidos de rol y estado).
// Si no se puede detectar, usa 'administrador' y 'Activo'.
let cache = null;

async function valoresPermitidos(columna) {
    const { rows } = await database.pool.query(
        `SELECT pg_get_constraintdef(c.oid) AS def
           FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
          WHERE t.relname = 'usuarios' AND c.contype = 'c'`
    );
    const literales = [];
    for (const { def } of rows) {
        if (new RegExp(`\\b${columna}\\b`).test(def)) for (const m of def.matchAll(/'([^']+)'/g)) literales.push(m[1]);
    }
    if (literales.length) return literales;
    // Si la columna es de tipo ENUM
    const tipo = await database.pool.query(
        "SELECT data_type, udt_name FROM information_schema.columns WHERE table_name = 'usuarios' AND column_name = $1",
        [columna]
    );
    if (tipo.rows[0] && tipo.rows[0].data_type === "USER-DEFINED") {
        const e = await database.pool.query(
            "SELECT enumlabel FROM pg_enum en JOIN pg_type ty ON ty.oid = en.enumtypid WHERE ty.typname = $1 ORDER BY en.enumsortorder",
            [tipo.rows[0].udt_name]
        );
        return e.rows.map((r) => r.enumlabel);
    }
    return [];
}

async function usuarios() {
    if (cache) return cache;
    const roles = await valoresPermitidos("rol");
    const estados = await valoresPermitidos("estado");
    const columnas = await database.pool.query(
        "SELECT column_name, is_nullable, column_default, is_identity FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'usuarios'"
    );
    cache = {
        rolAdmin: roles.find((r) => /^admin/i.test(r)) || "administrador",
        estadoActivo: estados.find((e) => /^activ/i.test(e)) || "Activo",
        columnas: columnas.rows
    };
    return cache;
}

module.exports = { usuarios };
