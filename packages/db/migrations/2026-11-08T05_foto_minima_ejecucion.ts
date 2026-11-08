import { sql, type Kysely } from 'kysely';

/**
 * Foto mínima por ejecución (RN-04 ampliada, decisión del usuario 2026-11-08): toda ejecución,
 * incluidos los EVENTOS, debe tener al menos N fotos georreferenciadas antes de cerrarse. Es
 * una regla del proyecto, no de D01: el motor de core la evalúa como obligatoria cuando N > 0.
 * Solo expande: los proyectos existentes quedan con 1; 0 desactiva la regla.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE app.proyecto
      ADD COLUMN fotos_minimas_ejecucion integer NOT NULL DEFAULT 1
        CHECK (fotos_minimas_ejecucion >= 0);
  `.execute(db);
}
