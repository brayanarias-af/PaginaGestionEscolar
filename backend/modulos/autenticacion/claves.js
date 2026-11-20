const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");

// Mismos formatos que genera el front (utils.js -> hashClave) para que las cuentas existentes sigan funcionando.
const sha256 = (t) => "sha256:" + crypto.createHash("sha256").update(t, "utf8").digest("hex");
const djb2 = (t) => {
    let h = 5381;
    for (const c of t) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0;
    return "djb2:" + h.toString(16);
};

// Formato para cuentas creadas en el servidor (administrador): scrypt con sal aleatoria.
function hashScrypt(clave) {
    const sal = crypto.randomBytes(16);
    return `scrypt:${sal.toString("hex")}:${crypto.scryptSync(clave, sal, 64).toString("hex")}`;
}

function iguales(a, b) {
    const x = Buffer.from(String(a));
    const y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function verificar(clave, guardado) {
    if (typeof guardado !== "string" || !guardado || typeof clave !== "string") return false;
    if (guardado.startsWith("scrypt:")) {
        const [, sal, hash] = guardado.split(":");
        if (!sal || !hash) return false;
        return iguales(crypto.scryptSync(clave, Buffer.from(sal, "hex"), 64).toString("hex"), hash);
    }
    if (/^\$2[aby]\$/.test(guardado)) return bcrypt.compareSync(clave, guardado); // admins creados con bcrypt
    if (guardado.startsWith("sha256:")) return iguales(sha256(clave), guardado);
    if (guardado.startsWith("djb2:")) return iguales(djb2(clave), guardado);
    return false;
}

const FORMATO_HASH = /^(sha256:[0-9a-f]{64}|djb2:[0-9a-f]{1,8})$/;

module.exports = { hashScrypt, verificar, FORMATO_HASH };
