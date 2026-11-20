-- Tablas auxiliares NUEVAS (no modifican ninguna tabla existente de DB_COLEGIO).
-- nova_ids: relaciona los ids que genera el front (p. ej. "est-lq3x9") con los ids reales (bigint) de tus tablas,
--           y guarda las fechas tal como las escribió el front.
CREATE TABLE IF NOT EXISTS nova_ids (
    tabla    TEXT   NOT NULL,
    id_db    BIGINT NOT NULL,
    id_front TEXT   NOT NULL,
    extra    JSONB  NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (tabla, id_db),
    UNIQUE (tabla, id_front)
);

-- nova_versiones: contador de cambios por colección (evita que dos guardados simultáneos se pisen).
CREATE TABLE IF NOT EXISTS nova_versiones (
    clave       TEXT PRIMARY KEY,
    version     INTEGER NOT NULL DEFAULT 0,
    actualizado TIMESTAMPTZ NOT NULL DEFAULT now()
);
