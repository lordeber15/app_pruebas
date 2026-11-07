import { sql, type Kysely } from 'kysely';

/**
 * Ejecución en campo (RF-M04, RF-M11, RN-19, RN-38). Solo expande:
 *
 * - `ejecucion.tarea_id` admite nulo: los EVENTOS (registros oportunos) no tienen reserva (RN-40).
 * - Varias ejecuciones por reserva estación × método: cada especialista registra la suya y el
 *   esfuerzo del método es la suma (RN-19). Por eso no hay índice único por `tarea_id`.
 * - Confirmaciones del usuario (cámaras trampa en ZA/EF) y objetivo definido en campo (bofedales).
 * - Registros (filas por especie, lectura…) y parámetros técnicos confirmados por unidad (T-12).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE app.ejecucion ALTER COLUMN tarea_id DROP NOT NULL;
    ALTER TABLE app.ejecucion
      ADD COLUMN confirmaciones jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(confirmaciones) = 'array'),
      ADD COLUMN objetivo_campo numeric CHECK (objetivo_campo IS NULL OR objetivo_campo > 0);

    ALTER TABLE app.unidad
      ADD COLUMN registros jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(registros) = 'array'),
      ADD COLUMN parametros_confirmados jsonb NOT NULL DEFAULT '[]'
        CHECK (jsonb_typeof(parametros_confirmados) = 'array');
    CREATE INDEX unidad_ejecucion_idx ON app.unidad (ejecucion_id);
  `.execute(db);
}
