const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

// El secreto se toma de NOVA_SECRETO o se genera una vez y se guarda en config/.secreto (no se sube a Git).
function obtenerSecreto() {
    if (process.env.NOVA_SECRETO) return process.env.NOVA_SECRETO;
    const archivo = path.resolve(__dirname, "..", "..", "config", ".secreto");
    if (!fs.existsSync(archivo)) fs.writeFileSync(archivo, crypto.randomBytes(48).toString("hex"), { mode: 0o600 });
    return fs.readFileSync(archivo, "utf8").trim();
}

const SECRETO = obtenerSecreto();
const DURACION_MS = 8 * 60 * 60 * 1000; // 8 horas

const b64 = (b) => Buffer.from(b).toString("base64url");
const firmar = (texto) => crypto.createHmac("sha256", SECRETO).update(texto).digest("base64url");

function crearToken(rol, id) {
    const cuerpo = b64(JSON.stringify({ rol, id, exp: Date.now() + DURACION_MS }));
    return `${cuerpo}.${firmar(cuerpo)}`;
}

function leerToken(token) {
    if (typeof token !== "string") return null;
    const [cuerpo, firma] = token.split(".");
    if (!cuerpo || !firma) return null;
    const esperada = firmar(cuerpo);
    if (esperada.length !== firma.length || !crypto.timingSafeEqual(Buffer.from(esperada), Buffer.from(firma))) return null;
    try {
        const datos = JSON.parse(Buffer.from(cuerpo, "base64url").toString("utf8"));
        return datos.exp > Date.now() ? datos : null;
    } catch {
        return null;
    }
}

module.exports = { crearToken, leerToken };
