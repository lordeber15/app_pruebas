import { sql, type Kysely } from 'kysely';

/**
 * Polígonos del proyecto cargados por KMZ (RF-W02, RF-M05, D02 §11; cartografía final P-06).
 * Decisión del usuario (2026-11-09). Solo expande.
 *
 * - `capa`: un KMZ/KML subido por Coordinación o JdP, con su archivo y hash (auditoría).
 * - `poligono`: cada Placemark con polígono de la capa, como MultiPolygon EPSG:4326 válido.
 * - `estacion.poligono_id`: cada estación tiene a lo sumo un polígono; un polígono, muchas
 *   estaciones. La estación fuera de su polígono genera una alerta técnica del sistema.
 *
 * Sin borrado físico: no se otorga DELETE.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE app.capa (
      id uuid PRIMARY KEY,
      proyecto_id uuid NOT NULL REFERENCES app.proyecto ON DELETE RESTRICT,
      nombre text NOT NULL CHECK (length(trim(nombre)) BETWEEN 1 AND 120),
      archivo_nombre text NOT NULL CHECK (length(trim(archivo_nombre)) BETWEEN 1 AND 255),
      archivo_sha256 text NOT NULL CHECK (archivo_sha256 ~ '^[0-9a-f]{64}$'),
      archivo_bytes integer NOT NULL CHECK (archivo_bytes BETWEEN 1 AND 20971520),
      archivo bytea NOT NULL,
      creado_en timestamptz NOT NULL DEFAULT now(),
      creado_por uuid NOT NULL REFERENCES app.usuario ON DELETE RESTRICT,
      actualizado_en timestamptz NOT NULL DEFAULT now(),
      actualizado_por uuid REFERENCES app.usuario ON DELETE RESTRICT
    );
    CREATE INDEX capa_proyecto_idx ON app.capa (proyecto_id, creado_en DESC);
    CREATE TRIGGER capa_actualizado_en BEFORE UPDATE ON app.capa
      FOR EACH ROW EXECUTE FUNCTION app.tocar_actualizado_en();

    CREATE TABLE app.poligono (
      id uuid PRIMARY KEY,
      capa_id uuid NOT NULL REFERENCES app.capa ON DELETE RESTRICT,
      proyecto_id uuid NOT NULL REFERENCES app.proyecto ON DELETE RESTRICT,
      nombre text NOT NULL CHECK (length(trim(nombre)) BETWEEN 1 AND 200),
      orden integer NOT NULL CHECK (orden >= 0),
      geom geometry(MultiPolygon, 4326) NOT NULL CHECK (ST_IsValid(geom)),
      creado_en timestamptz NOT NULL DEFAULT now(),
      creado_por uuid NOT NULL REFERENCES app.usuario ON DELETE RESTRICT,
      actualizado_en timestamptz NOT NULL DEFAULT now(),
      actualizado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      UNIQUE (capa_id, orden)
    );
    CREATE INDEX poligono_proyecto_idx ON app.poligono (proyecto_id);
    CREATE INDEX poligono_geom_idx ON app.poligono USING gist (geom);
    CREATE TRIGGER poligono_actualizado_en BEFORE UPDATE ON app.poligono
      FOR EACH ROW EXECUTE FUNCTION app.tocar_actualizado_en();

    ALTER TABLE app.estacion
      ADD COLUMN poligono_id uuid REFERENCES app.poligono ON DELETE RESTRICT;
    CREATE INDEX estacion_poligono_idx ON app.estacion (poligono_id);

    REVOKE DELETE, TRUNCATE ON app.capa, app.poligono FROM app_rw, worker_rw;
  `.execute(db);
}
