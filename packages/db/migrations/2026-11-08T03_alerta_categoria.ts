import { sql, type Kysely } from 'kysely';

/**
 * Categoría de la alerta logística del JdB (D02 §9, D04 §10, E-07): movilidad, materiales,
 * hospedaje, apoyo local, EPP/documentos, viáticos, muestras/equipos. Solo expande: las técnicas
 * y las post-sincronización no la llevan. Que la logística la tenga lo exige el esquema de core.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE app.alerta
      ADD COLUMN categoria text CHECK (categoria IN (
        'movilidad', 'materiales', 'hospedaje', 'apoyo_local',
        'epp_documentos', 'viaticos', 'muestras_equipos'
      )),
      ADD CONSTRAINT alerta_categoria_solo_logistica CHECK (categoria IS NULL OR tipo = 'logistica');
  `.execute(db);
}
