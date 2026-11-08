import { sql, type Kysely } from 'kysely';

/**
 * Cronograma versionado y selección de fotos para el reporte diario (RN-35, RN-36, E-08, E-10).
 * Solo expande:
 *
 * - `cronograma_item.linaje_id`: la misma fila lógica a lo largo de las versiones. Cada versión
 *   es una copia completa con ids propios; el linaje es el id de la fila en la versión donde
 *   apareció por primera vez (en el base, su propio id). Permite comparar base y vigente y
 *   reubicar las reservas sin perder la estación (una estación no ejecutada nunca desaparece).
 * - Las filas del cronograma son inmutables: la API y el worker no pueden actualizarlas. Una
 *   versión solo puede pasar de `vigente` a `historica`; nada más de ella cambia (RN-35).
 * - Selección manual de Coordinación para el reporte diario (D02 §8 y §12): fecha del reporte,
 *   quién y cuándo. La plantilla del reporte espera P-13; aquí solo se guarda la selección.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    -- ── 1. Linaje de las filas del cronograma ────────────────────────────────────────────────
    ALTER TABLE app.cronograma_item ADD COLUMN linaje_id uuid;
    UPDATE app.cronograma_item SET linaje_id = id WHERE linaje_id IS NULL;
    ALTER TABLE app.cronograma_item
      ALTER COLUMN linaje_id SET NOT NULL,
      ADD CONSTRAINT cronograma_item_linaje_fk FOREIGN KEY (linaje_id)
        REFERENCES app.cronograma_item ON DELETE RESTRICT;
    CREATE INDEX cronograma_item_linaje_idx ON app.cronograma_item (linaje_id);
    CREATE UNIQUE INDEX cronograma_item_version_linaje_uq ON app.cronograma_item (version_id, linaje_id);

    -- Una fila nueva sin linaje es su propio origen (la carga de A01 no lo conoce).
    CREATE FUNCTION app.cronograma_item_linaje() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      NEW.linaje_id := coalesce(NEW.linaje_id, NEW.id);
      RETURN NEW;
    END $$;
    CREATE TRIGGER cronograma_item_linaje BEFORE INSERT ON app.cronograma_item
      FOR EACH ROW EXECUTE FUNCTION app.cronograma_item_linaje();

    -- ── 2. Inmutabilidad de versiones (RN-35) ────────────────────────────────────────────────
    REVOKE UPDATE ON app.cronograma_item FROM app_rw, worker_rw;

    CREATE FUNCTION app.cronograma_version_inmutable() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.id <> OLD.id OR NEW.campania_id <> OLD.campania_id OR NEW.numero <> OLD.numero
         OR NEW.es_base <> OLD.es_base
         OR NEW.solicitud_id IS DISTINCT FROM OLD.solicitud_id
         OR NEW.aprobado_por IS DISTINCT FROM OLD.aprobado_por
         OR NEW.aprobado_en IS DISTINCT FROM OLD.aprobado_en
         OR NEW.creado_en <> OLD.creado_en OR NEW.creado_por IS DISTINCT FROM OLD.creado_por
         OR (NEW.estado <> OLD.estado AND NOT (OLD.estado = 'vigente' AND NEW.estado = 'historica'))
      THEN
        RAISE EXCEPTION 'Una versión del cronograma no se modifica: solo pasa de vigente a histórica (RN-35)'
          USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER cronograma_version_inmutable BEFORE UPDATE ON app.cronograma_version
      FOR EACH ROW EXECUTE FUNCTION app.cronograma_version_inmutable();

    -- ── 3. Selección manual de fotos para el reporte diario (E-10) ───────────────────────────
    ALTER TABLE app.archivo
      ADD COLUMN candidata_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      ADD COLUMN candidata_en timestamptz,
      ADD COLUMN seleccion_fecha date,
      ADD COLUMN seleccionada_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      ADD COLUMN seleccionada_en timestamptz,
      ADD CONSTRAINT archivo_seleccion_con_fecha CHECK (
        seleccionada_reporte = (seleccion_fecha IS NOT NULL AND seleccionada_por IS NOT NULL)
      ),
      ADD CONSTRAINT archivo_seleccion_solo_fotos CHECK (tipo = 'foto' OR NOT seleccionada_reporte);
    CREATE INDEX archivo_seleccion_idx ON app.archivo (proyecto_id, seleccion_fecha) WHERE seleccionada_reporte;
  `.execute(db);
}
