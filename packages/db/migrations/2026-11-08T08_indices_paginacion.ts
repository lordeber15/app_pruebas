import { sql, type Kysely } from 'kysely';

/**
 * Índices para la paginación por cursor de la web (ejecuciones y alertas): cubren el filtro por
 * proyecto y el orden (instante desc, id desc), así cada página lee solo sus filas en vez de
 * ordenar toda la tabla. Las revisiones ya usan `evento_pendiente_resolucion_idx`. Solo expande.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE INDEX ejecucion_proyecto_abierta_idx
      ON app.ejecucion (proyecto_id, abierta_en DESC, id DESC);
    CREATE INDEX alerta_proyecto_creado_idx
      ON app.alerta (proyecto_id, creado_en DESC, id DESC);
  `.execute(db);
}
