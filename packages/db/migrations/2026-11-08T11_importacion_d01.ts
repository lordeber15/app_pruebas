import { sql, type Kysely } from 'kysely';

/**
 * Carga de D01 desde la web con la plantilla Excel (RF-W09, decisión del usuario 2026-11-08).
 * Solo expande.
 *
 * `importacion_d01`: cada archivo subido queda como vista previa (sin aplicar) con el archivo, su
 * hash, la configuración convertida y el diff contra la vigente de ese momento. Aplicarla crea una
 * versión nueva de `configuracion_metodologica` (nunca edita la usada por ejecuciones) y deja
 * autor, fecha y motivo. Una importación se aplica una sola vez. Sin borrado físico.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE app.importacion_d01 (
      id uuid PRIMARY KEY,
      proyecto_id uuid NOT NULL REFERENCES app.proyecto ON DELETE RESTRICT,
      estado text NOT NULL DEFAULT 'vista_previa' CHECK (estado IN ('vista_previa', 'aplicada')),
      archivo_nombre text NOT NULL CHECK (length(trim(archivo_nombre)) BETWEEN 1 AND 255),
      archivo_sha256 text NOT NULL CHECK (archivo_sha256 ~ '^[0-9a-f]{64}$'),
      archivo_bytes integer NOT NULL CHECK (archivo_bytes BETWEEN 1 AND 5242880),
      -- El archivo tal como se subió (auditoría); ≤ 5 MB.
      archivo bytea NOT NULL,
      -- Versión vigente contra la que se calculó la vista previa (nula si no había).
      configuracion_base_id uuid REFERENCES app.configuracion_metodologica ON DELETE RESTRICT,
      -- Métodos convertidos (ConfiguracionMetodo de core) que se aplicarían.
      metodos jsonb NOT NULL,
      -- Resumen, cambios por método y errores por fila/columna.
      vista_previa jsonb NOT NULL,
      con_errores boolean NOT NULL,
      -- Versión creada al aplicar.
      configuracion_id uuid UNIQUE REFERENCES app.configuracion_metodologica ON DELETE RESTRICT,
      motivo text CHECK (motivo IS NULL OR length(trim(motivo)) BETWEEN 3 AND 500),
      aplicado_en timestamptz,
      aplicado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      creado_en timestamptz NOT NULL DEFAULT now(),
      creado_por uuid NOT NULL REFERENCES app.usuario ON DELETE RESTRICT,
      actualizado_en timestamptz NOT NULL DEFAULT now(),
      actualizado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      CONSTRAINT importacion_d01_aplicada_ck CHECK (
        (estado = 'aplicada') = (configuracion_id IS NOT NULL AND aplicado_en IS NOT NULL
                                 AND aplicado_por IS NOT NULL AND motivo IS NOT NULL)
      ),
      CONSTRAINT importacion_d01_sin_errores_ck CHECK (estado = 'vista_previa' OR NOT con_errores)
    );
    CREATE INDEX importacion_d01_proyecto_idx ON app.importacion_d01 (proyecto_id, creado_en DESC);
    CREATE TRIGGER importacion_d01_actualizado_en BEFORE UPDATE ON app.importacion_d01
      FOR EACH ROW EXECUTE FUNCTION app.tocar_actualizado_en();
    REVOKE DELETE, TRUNCATE ON app.importacion_d01 FROM app_rw, worker_rw;
  `.execute(db);
}
