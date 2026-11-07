import { sql, type Kysely } from 'kysely';

/**
 * El sobre del evento trae la ubicación del momento de la acción (doc. 03 §9.1; C3: coordenadas
 * en cada evidencia). Se guarda tal cual en `evento.ubicacion` y queda protegida por el trigger
 * de inmutabilidad igual que el resto de columnas.
 *
 * No es la posición del aviso de cercanía: esa nunca se envía ni se persiste.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE app.evento ADD COLUMN ubicacion jsonb;

    CREATE OR REPLACE FUNCTION app.evento_inmutable() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'UPDATE'
         AND current_setting('app.resolviendo_evento', true) = 'si'
         AND OLD.estado IN ('en_revision', 'duplicado')
         AND NEW.estado IN ('resuelto_elegido', 'resuelto_descartado')
         AND (NEW.id, NEW.tipo, NEW.version_esquema, NEW.usuario_id, NEW.dispositivo_id,
              NEW.asignacion_id, NEW.entidad_tipo, NEW.entidad_id, NEW.payload,
              NEW.hora_dispositivo, NEW.hora_servidor, NEW.motivo, NEW.ubicacion)
             IS NOT DISTINCT FROM
             (OLD.id, OLD.tipo, OLD.version_esquema, OLD.usuario_id, OLD.dispositivo_id,
              OLD.asignacion_id, OLD.entidad_tipo, OLD.entidad_id, OLD.payload,
              OLD.hora_dispositivo, OLD.hora_servidor, OLD.motivo, OLD.ubicacion)
      THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'evento es solo inserción (% no permitido)', TG_OP USING ERRCODE = 'insufficient_privilege';
    END $$;
  `.execute(db);
}
