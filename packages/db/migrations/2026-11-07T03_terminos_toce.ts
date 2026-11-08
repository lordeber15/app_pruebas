import { sql, type Kysely } from 'kysely';

/**
 * Solo términos TOCE (decisión del usuario, 2026-11-07): «tarea», «asignación» y «cuaderno» dejan
 * de existir en el modelo vigente. No se borra nada:
 *
 * - `tarea` pasa a llamarse `reserva` (estación × método programada para una brigada y fecha del
 *   cronograma vigente). Sus índices, restricciones y trigger se renombran. Las columnas del
 *   modelo anterior (`origen`, `tipo`) dejan de ser obligatorias.
 * - `tarea_id` → `reserva_id` en `ejecucion`, `alerta` y `archivo`.
 * - `ejecucion.brigada_id`: la brigada en la que se registró (de su reserva, o la del usuario en
 *   los EVENTOS). Define el alcance de la web sin pasar por tablas antiguas.
 * - Roles TOCE (ERS §2.2): globales `coordinacion`, `jefe_proyecto`, `admin`; en la brigada
 *   `especialista`, `supervisor_campo`, `jefe_brigada`. El supervisor global pasa a Coordinación,
 *   el logístico a Jefe de Brigada y el jefe de cada brigada (`brigada.jefe_id`) entra como
 *   miembro `jefe_brigada` si aún no era miembro.
 *
 * Sin uso desde aquí, pendientes de una migración de contracción que el usuario autorice:
 * `cuaderno`, `asignacion`, `evidencia_item`, `comentario`, `catalogo_metodologia`,
 * `estacion_metodologia`, `registro_esfuerzo`, `reserva.cuaderno_id`, `reserva.metodologia_id`,
 * `reserva.origen`, `reserva.tipo`, `reserva.regla_id`, `reserva.clave_dedup`, `brigada.jefe_id`
 * y `evento.asignacion_id` (el evento es inmutable: su historia se conserva tal cual).
 */
const ANTIGUAS = ['asignacion', 'comentario', 'evidencia_item', 'cuaderno'];

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    -- ── 1. Reserva (antes tarea) ─────────────────────────────────────────────────────────────
    ALTER TABLE app.tarea RENAME TO reserva;
    ALTER TABLE app.reserva ALTER COLUMN origen DROP NOT NULL, ALTER COLUMN tipo DROP NOT NULL;
    ALTER TRIGGER tarea_actualizado_en ON app.reserva RENAME TO reserva_actualizado_en;

    ALTER TABLE app.ejecucion RENAME COLUMN tarea_id TO reserva_id;
    ALTER TABLE app.alerta RENAME COLUMN tarea_id TO reserva_id;
    ALTER TABLE app.archivo RENAME COLUMN tarea_id TO reserva_id;
  `.execute(db);

  // Restricciones e índices con «tarea» en el nombre, salvo los de las tablas antiguas sin uso.
  await sql`
    DO $$
    DECLARE r record;
    BEGIN
      FOR r IN
        SELECT c.conname, t.relname
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'app' AND c.conname LIKE '%tarea%'
           AND t.relname <> ALL (${sql.raw(`ARRAY['${ANTIGUAS.join("','")}']`)})
      LOOP
        EXECUTE format('ALTER TABLE app.%I RENAME CONSTRAINT %I TO %I',
                       r.relname, r.conname, replace(r.conname, 'tarea', 'reserva'));
      END LOOP;
      FOR r IN
        SELECT i.relname AS indice
          FROM pg_index x
          JOIN pg_class i ON i.oid = x.indexrelid
          JOIN pg_class t ON t.oid = x.indrelid
          JOIN pg_namespace n ON n.oid = i.relnamespace
         WHERE n.nspname = 'app' AND i.relname LIKE '%tarea%'
           AND t.relname <> ALL (${sql.raw(`ARRAY['${ANTIGUAS.join("','")}']`)})
      LOOP
        EXECUTE format('ALTER INDEX app.%I RENAME TO %I', r.indice, replace(r.indice, 'tarea', 'reserva'));
      END LOOP;
    END $$;
  `.execute(db);

  await sql`
    -- ── 2. Brigada de cada ejecución ─────────────────────────────────────────────────────────
    ALTER TABLE app.ejecucion ADD COLUMN brigada_id uuid REFERENCES app.brigada ON DELETE RESTRICT;
    UPDATE app.ejecucion x SET brigada_id = r.brigada_id FROM app.reserva r WHERE r.id = x.reserva_id;
    CREATE INDEX ejecucion_brigada_idx ON app.ejecucion (brigada_id, estado);

    -- ── 3. Roles TOCE (ERS §2.2) ─────────────────────────────────────────────────────────────
    DO $$
    DECLARE r record;
    BEGIN
      FOR r IN
        SELECT t.relname, c.conname
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'app' AND c.contype = 'c'
           AND ((t.relname = 'usuario' AND pg_get_constraintdef(c.oid) LIKE '%rol_global%')
             OR (t.relname = 'miembro_brigada' AND pg_get_constraintdef(c.oid) LIKE '%(rol %'))
      LOOP
        EXECUTE format('ALTER TABLE app.%I DROP CONSTRAINT %I', r.relname, r.conname);
      END LOOP;
    END $$;
    UPDATE app.usuario SET rol_global = 'coordinacion' WHERE rol_global = 'supervisor';
    ALTER TABLE app.usuario ADD CONSTRAINT usuario_rol_global_check
      CHECK (rol_global IN ('coordinacion', 'jefe_proyecto', 'admin', 'ninguno'));

    UPDATE app.miembro_brigada SET rol = 'jefe_brigada' WHERE rol = 'logistico';
    -- Una fila por brigada como mucho: su id (UUID v7) sirve de id del miembro nuevo.
    INSERT INTO app.miembro_brigada (id, brigada_id, usuario_id, rol, creado_por)
    SELECT b.id, b.id, b.jefe_id, 'jefe_brigada', NULL
      FROM app.brigada b
     WHERE b.jefe_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM app.miembro_brigada m
                        WHERE m.brigada_id = b.id AND m.usuario_id = b.jefe_id);
    ALTER TABLE app.miembro_brigada ADD CONSTRAINT miembro_brigada_rol_check
      CHECK (rol IN ('especialista', 'supervisor_campo', 'jefe_brigada'));
  `.execute(db);
}
