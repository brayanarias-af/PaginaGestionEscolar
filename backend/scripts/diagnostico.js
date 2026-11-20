// Uso:  npm run diagnostico
// Muestra (y guarda en backend/diagnostico.txt) la estructura REAL de tu base: columnas, restricciones,
// triggers y cuántas filas tiene cada tabla. No imprime contraseñas ni datos de las filas.
const fs = require("node:fs");
const path = require("node:path");
const database = require("../config/database");

(async () => {
    const salida = [];
    const linea = (t = "") => salida.push(t);
    try {
        await database.conectar();
        const q = (sql, p) => database.pool.query(sql, p).then((r) => r.rows);
        const tablas = await q("SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = current_schema() ORDER BY table_type, table_name");
        for (const { table_name: t, table_type } of tablas) {
            const esVista = table_type === "VIEW";
            const filas = esVista ? "" : `  (${(await q(`SELECT COUNT(*)::int AS n FROM "${t}"`))[0].n} filas)`;
            linea(`${esVista ? "VISTA" : "TABLA"} ${t}${filas}`);
            for (const c of await q("SELECT column_name, data_type, udt_name, is_nullable, column_default FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position", [t])) {
                linea(`   - ${c.column_name} ${c.data_type === "USER-DEFINED" ? c.udt_name : c.data_type}${c.is_nullable === "NO" ? " NOT NULL" : ""}${c.column_default ? " DEFAULT " + c.column_default : ""}`);
            }
            if (esVista) { linea(); continue; }
            for (const c of await q("SELECT conname, pg_get_constraintdef(c.oid) AS def FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid WHERE r.relname = $1 ORDER BY contype", [t])) linea(`   * ${c.conname}: ${c.def}`);
            for (const g of await q("SELECT tgname FROM pg_trigger g JOIN pg_class r ON r.oid = g.tgrelid WHERE r.relname = $1 AND NOT g.tgisinternal", [t])) linea(`   ! trigger ${g.tgname}`);
            linea();
        }
        linea("FUNCIONES DE TRIGGERS");
        for (const fn of await q("SELECT DISTINCT p.proname, pg_get_functiondef(p.oid) AS def FROM pg_trigger g JOIN pg_proc p ON p.oid = g.tgfoid WHERE NOT g.tgisinternal ORDER BY p.proname")) {
            linea(fn.def);
        }
    } catch (error) {
        linea("❌ " + (error.message || error.code));
        process.exitCode = 1;
    } finally {
        await database.pool.end();
    }
    const texto = salida.join("\n");
    console.log(texto);
    fs.writeFileSync(path.resolve(__dirname, "..", "diagnostico.txt"), texto + "\n");
    console.log("\n(Guardado en backend/diagnostico.txt)");
})();
