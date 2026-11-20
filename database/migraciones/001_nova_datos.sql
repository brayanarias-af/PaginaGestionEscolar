-- Tablas NUEVAS que usa el panel (no modifica ninguna tabla existente de DB_COLEGIO).
-- nova_datos: guarda cada colección del front tal como la maneja la interfaz
-- (nova_estudiantes, nova_profesores, nova_materias, matriculas, nova_notas).
CREATE TABLE IF NOT EXISTS nova_datos (
    clave       TEXT PRIMARY KEY,
    datos       JSONB NOT NULL,
    version     INTEGER NOT NULL DEFAULT 1,
    actualizado TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- nova_datos_historial: copia de la versión anterior en cada cambio (para poder recuperar datos).
CREATE TABLE IF NOT EXISTS nova_datos_historial (
    id      BIGSERIAL PRIMARY KEY,
    clave   TEXT NOT NULL,
    version INTEGER NOT NULL,
    datos   JSONB NOT NULL,
    usuario TEXT,
    fecha   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_nova_historial_clave ON nova_datos_historial (clave, id);
