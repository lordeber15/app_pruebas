import { sql, type Kysely } from 'kysely';

/**
 * Paquetes de mapa sin conexión (RF-M05, CA-08, V-10). Solo expande.
 *
 * El servidor recorta el mapa base PMTiles (ADR-005) a un rectángulo y el celular lo descarga.
 * - `brigada`: área automática con las estaciones de la brigada en el cronograma vigente; una por
 *   brigada (índice único parcial). Se regenera al cambiar el cronograma (`version` + 1).
 * - `usuario`: rectángulo marcado por un usuario.
 *
 * `paquete_mapa_descarga` guarda qué versión tiene cada dispositivo (upsert por paquete ×
 * dispositivo). Nada se borra: sin DELETE para la API ni el worker.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE app.paquete_mapa (
      id uuid PRIMARY KEY,
      proyecto_id uuid NOT NULL REFERENCES app.proyecto ON DELETE RESTRICT,
      brigada_id uuid REFERENCES app.brigada ON DELETE RESTRICT,
      origen text NOT NULL CHECK (origen IN ('brigada', 'usuario')),
      nombre text NOT NULL CHECK (length(nombre) BETWEEN 1 AND 80),
      oeste double precision NOT NULL CHECK (oeste BETWEEN -180 AND 180),
      sur double precision NOT NULL CHECK (sur BETWEEN -90 AND 90),
      este double precision NOT NULL CHECK (este BETWEEN -180 AND 180),
      norte double precision NOT NULL CHECK (norte BETWEEN -90 AND 90),
      zoom_max integer NOT NULL CHECK (zoom_max BETWEEN 0 AND 22),
      estado text NOT NULL DEFAULT 'pendiente'
        CHECK (estado IN ('pendiente', 'generando', 'listo', 'error')),
      version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
      ruta_objeto text,
      tamano bigint CHECK (tamano IS NULL OR tamano >= 0),
      sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
      error text CHECK (error IS NULL OR length(error) <= 500),
      generado_en timestamptz,
      -- Momento en que el worker tomó el trabajo: detecta generaciones colgadas.
      generando_desde timestamptz,
      solicitado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      creado_en timestamptz NOT NULL DEFAULT now(),
      creado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      actualizado_en timestamptz NOT NULL DEFAULT now(),
      actualizado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      CHECK (oeste < este),
      CHECK (sur < norte),
      CHECK (origen = 'usuario' OR brigada_id IS NOT NULL),
      CHECK (estado <> 'listo' OR (ruta_objeto IS NOT NULL AND tamano IS NOT NULL AND sha256 IS NOT NULL)),
      CHECK ((estado = 'error') = (error IS NOT NULL))
    );
    CREATE UNIQUE INDEX paquete_mapa_brigada_uq
      ON app.paquete_mapa (proyecto_id, brigada_id) WHERE origen = 'brigada';
    CREATE INDEX paquete_mapa_proyecto_idx ON app.paquete_mapa (proyecto_id, creado_en);
    CREATE INDEX paquete_mapa_pendiente_idx
      ON app.paquete_mapa (estado) WHERE estado IN ('pendiente', 'generando');
    CREATE TRIGGER paquete_mapa_actualizado_en BEFORE UPDATE ON app.paquete_mapa
      FOR EACH ROW EXECUTE FUNCTION app.tocar_actualizado_en();

    CREATE TABLE app.paquete_mapa_descarga (
      id uuid PRIMARY KEY,
      paquete_id uuid NOT NULL REFERENCES app.paquete_mapa ON DELETE RESTRICT,
      dispositivo_id uuid NOT NULL REFERENCES app.dispositivo ON DELETE RESTRICT,
      usuario_id uuid NOT NULL REFERENCES app.usuario ON DELETE RESTRICT,
      version integer NOT NULL CHECK (version >= 1),
      descargado_en timestamptz NOT NULL DEFAULT now(),
      UNIQUE (paquete_id, dispositivo_id)
    );

    REVOKE DELETE, TRUNCATE ON app.paquete_mapa, app.paquete_mapa_descarga FROM app_rw, worker_rw;
  `.execute(db);
}
