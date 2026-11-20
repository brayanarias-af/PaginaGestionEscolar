// Uso:  npm run crear-admin -- correo@dominio.com TuClave "Nombre Apellido"
// Crea el administrador en la tabla usuarios (o le cambia la contraseña si el correo ya existe).
// Se adapta a las columnas y valores permitidos de TU tabla usuarios.
const database = require("../config/database");
const esquema = require("../config/esquema");
const { hashScrypt } = require("../modulos/autenticacion/claves");

const [correo, clave, nombre = "Administrador"] = process.argv.slice(2);
if (!correo || !clave || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo) || clave.length < 6) {
    console.error('Uso: npm run crear-admin -- correo@dominio.com TuClave "Nombre Apellido"   (clave de mínimo 6 caracteres)');
    process.exit(1);
}

(async () => {
    try {
        await database.conectar();
        const { rolAdmin, estadoActivo, columnas } = await esquema.usuarios();
        const existe = (c) => columnas.some((x) => x.column_name === c);
        const valores = { correo, clave_hash: hashScrypt(clave), rol: rolAdmin, estado: estadoActivo };
        if (existe("nombre")) valores.nombre = nombre;

        const previo = await database.pool.query("SELECT id FROM usuarios WHERE lower(correo) = lower($1)", [correo]);
        if (previo.rows.length) {
            const { correo: _omitido, ...cambios } = valores;
            const campos = Object.keys(cambios);
            await database.pool.query(
                `UPDATE usuarios SET ${campos.map((c, i) => `${c} = $${i + 1}`).join(", ")} WHERE id = $${campos.length + 1}`,
                [...campos.map((c) => cambios[c]), previo.rows[0].id]
            );
            console.log(`✅ Se actualizó el administrador ${correo}`);
        } else {
            // ¿Falta alguna columna obligatoria que este script no conoce?
            const faltan = columnas.filter(
                (c) => c.is_nullable === "NO" && !c.column_default && c.is_identity !== "YES" && !(c.column_name in valores) && c.column_name !== "id"
            );
            if (faltan.length) throw new Error("tu tabla usuarios exige además: " + faltan.map((c) => c.column_name).join(", "));
            const campos = Object.keys(valores);
            await database.pool.query(
                `INSERT INTO usuarios (${campos.join(", ")}) VALUES (${campos.map((_, i) => "$" + (i + 1)).join(", ")})`,
                campos.map((c) => valores[c])
            );
            console.log(`✅ Administrador creado: ${correo}`);
        }
    } catch (error) {
        console.error("❌ No se pudo crear el administrador:", error.message || error.code);
        process.exitCode = 1;
    } finally {
        await database.pool.end();
    }
})();
