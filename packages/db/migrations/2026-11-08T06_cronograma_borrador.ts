import { sql, type Kysely } from 'kysely';

/**
 * Borrador del cronograma base armado desde la web (RN-35, RF-W12). Solo expande.
 *
 * Un proyecto sin A01 (creado en la web) no tiene cronograma: Coordinación o el JdP lo arman fila
 * por fila y lo publican. Mientras tanto las filas viven aquí, no en `cronograma_item`, porque
 * las versiones son inmutables (migración 2026-11-08T04) y una versión `borrador` rompería esa
 * regla. Al publicar se crea la versión 1 (base, vigente) con una copia de las filas `borrador`
 * y cada una queda `publicada` con su versión. Nada se borra: una fila quitada del borrador queda
 * `descartada` (sin DELETE para la API ni el worker).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE app.cronograma_borrador_item (
      id uuid PRIMARY KEY,
      proyecto_id uuid NOT NULL REFERENCES app.proyecto ON DELETE RESTRICT,
      brigada_id uuid NOT NULL REFERENCES app.brigada ON DELETE RESTRICT,
      fecha date NOT NULL,
      tipo_actividad text NOT NULL CHECK (tipo_actividad IN (
        'estacion', 'movilizacion', 'traslado', 'desmovilizacion', 'feriado', 'procesamiento', 'otro'
      )),
      estacion_id uuid REFERENCES app.estacion ON DELETE RESTRICT,
      detalle text CHECK (detalle IS NULL OR length(detalle) <= 500),
      orden integer NOT NULL DEFAULT 0,
      estado text NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'descartada', 'publicada')),
      -- Versión base creada al publicar.
      version_id uuid REFERENCES app.cronograma_version ON DELETE RESTRICT,
      creado_en timestamptz NOT NULL DEFAULT now(),
      creado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      actualizado_en timestamptz NOT NULL DEFAULT now(),
      actualizado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      CHECK ((tipo_actividad = 'estacion') = (estacion_id IS NOT NULL)),
      CHECK ((estado = 'publicada') = (version_id IS NOT NULL))
    );
    CREATE INDEX cronograma_borrador_proyecto_idx
      ON app.cronograma_borrador_item (proyecto_id, fecha) WHERE estado = 'borrador';
    CREATE TRIGGER cronograma_borrador_item_actualizado_en BEFORE UPDATE ON app.cronograma_borrador_item
      FOR EACH ROW EXECUTE FUNCTION app.tocar_actualizado_en();
    REVOKE DELETE, TRUNCATE ON app.cronograma_borrador_item FROM app_rw, worker_rw;
  `.execute(db);
}
