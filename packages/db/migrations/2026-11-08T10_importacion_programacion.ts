import { sql, type Kysely } from 'kysely';

/**
 * Carga de la programación A01 desde la web (RF-W09, decisión del usuario 2026-11-08). Solo
 * expande.
 *
 * - `importacion_programacion`: cada carga (Excel o tabla de la web) con sus filas tal como
 *   llegaron, el resumen de la vista previa y su destino. Estados: `pendiente` (vista previa de
 *   Coordinación o JdP), `propuesta` (sugerencia del Supervisor de campo para sus brigadas),
 *   `aplicada` (al borrador del cronograma base o como solicitud de reprogramación, RN-35/RN-36) y
 *   `descartada` (con motivo). Nada se borra.
 * - `cronograma_borrador_item` gana `estado_fila` y `actividad_especial`, como `cronograma_item`,
 *   para que una carga de A01 al borrador conserve «PENDIENTE VALIDACIÓN» y las actividades
 *   especiales (epífitas, cámaras trampa) al publicarse.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE app.cronograma_borrador_item
      ADD COLUMN estado_fila text NOT NULL DEFAULT 'ok' CHECK (estado_fila IN (
        'ok', 'pendiente_validacion', 'reprogramada', 'sujeta_a_decision'
      )),
      ADD COLUMN actividad_especial text
        CHECK (actividad_especial IS NULL OR length(actividad_especial) <= 100);

    CREATE TABLE app.importacion_programacion (
      id uuid PRIMARY KEY,
      proyecto_id uuid NOT NULL REFERENCES app.proyecto ON DELETE RESTRICT,
      origen text NOT NULL CHECK (origen IN ('excel', 'web')),
      nombre_archivo text CHECK (nombre_archivo IS NULL OR length(nombre_archivo) <= 255),
      hash_archivo text CHECK (hash_archivo IS NULL OR hash_archivo ~ '^[0-9a-f]{64}$'),
      tamano_bytes integer CHECK (tamano_bytes IS NULL OR tamano_bytes >= 0),
      -- Filas tal como llegaron (celdas sin interpretar): la vista previa se recalcula al aplicar.
      filas jsonb NOT NULL CHECK (jsonb_typeof(filas) = 'array'),
      -- Brigadas que la carga puede tocar; NULL = todas (Coordinación o JdP).
      alcance_brigadas uuid[],
      resumen jsonb NOT NULL,
      estado text NOT NULL DEFAULT 'pendiente'
        CHECK (estado IN ('pendiente', 'propuesta', 'aplicada', 'descartada')),
      destino text CHECK (destino IN ('borrador', 'solicitud', 'aplicada_ahora')),
      solicitud_id uuid REFERENCES app.solicitud_cronograma ON DELETE RESTRICT,
      motivo text CHECK (motivo IS NULL OR length(motivo) <= 2000),
      motivo_descarte text CHECK (motivo_descarte IS NULL OR length(motivo_descarte) <= 2000),
      propuesta_en timestamptz,
      aplicada_en timestamptz,
      aplicada_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      descartada_en timestamptz,
      descartada_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      creado_en timestamptz NOT NULL DEFAULT now(),
      creado_por uuid NOT NULL REFERENCES app.usuario ON DELETE RESTRICT,
      actualizado_en timestamptz NOT NULL DEFAULT now(),
      actualizado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      CHECK ((estado = 'aplicada') = (aplicada_en IS NOT NULL AND destino IS NOT NULL)),
      CHECK ((estado = 'descartada') = (descartada_en IS NOT NULL AND motivo_descarte IS NOT NULL)),
      CHECK (destino IS NULL OR destino = 'borrador' OR solicitud_id IS NOT NULL)
    );
    CREATE INDEX importacion_programacion_proyecto_idx
      ON app.importacion_programacion (proyecto_id, estado, creado_en DESC);
    CREATE TRIGGER importacion_programacion_actualizado_en BEFORE UPDATE ON app.importacion_programacion
      FOR EACH ROW EXECUTE FUNCTION app.tocar_actualizado_en();
    REVOKE DELETE, TRUNCATE ON app.importacion_programacion FROM app_rw, worker_rw;
  `.execute(db);
}
