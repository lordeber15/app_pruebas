import { sql, type Kysely } from 'kysely';

/**
 * Modelo TOCE (ERS v4.0 §2, D02 §3–§10, A01). Expande sin romper: `tarea`, `asignacion` y
 * `cuaderno` siguen como objetos internos de reserva y sincronización (RN-01).
 *
 * - `cuadrilla` pasa a llamarse `brigada` (D02 §3).
 * - Campaña, especialidad, configuración metodológica versionada y `metodo` (D01, RF-W09).
 * - Atributos espaciales de la estación (A01, RN-29) y aplicabilidad estación–método (RN-28).
 * - Cronograma base/vigente versionado y solicitudes de cambio (RN-35, RN-36).
 * - Ejecución, unidad y track por método (RN-05, RN-30, RN-24).
 * - Alertas estructuradas (RN-36) y vínculo de fotos con ejecución, unidad y tipo (F-02, F-08).
 *
 * Los CHECK se escriben a mano (no se importan de core): la prueba de integración verifica que
 * coincidan. Sin ON DELETE CASCADE ni borrado físico.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    -- ── 1. Brigada (antes cuadrilla) ─────────────────────────────────────────────────────────
    ALTER TABLE app.cuadrilla RENAME TO brigada;
    ALTER TABLE app.miembro_cuadrilla RENAME TO miembro_brigada;
    ALTER TABLE app.miembro_brigada RENAME COLUMN cuadrilla_id TO brigada_id;
    ALTER TABLE app.cuaderno RENAME COLUMN cuadrilla_id TO brigada_id;
    ALTER INDEX app.cuadrilla_proyecto_idx RENAME TO brigada_proyecto_idx;
    ALTER INDEX app.miembro_cuadrilla_usuario_idx RENAME TO miembro_brigada_usuario_idx;
    ALTER TRIGGER cuadrilla_actualizado_en ON app.brigada RENAME TO brigada_actualizado_en;
    ALTER TRIGGER miembro_cuadrilla_actualizado_en ON app.miembro_brigada RENAME TO miembro_brigada_actualizado_en;

    -- ── 2. Campaña ───────────────────────────────────────────────────────────────────────────
    CREATE TABLE app.campania (
      id uuid PRIMARY KEY,
      proyecto_id uuid NOT NULL REFERENCES app.proyecto ON DELETE RESTRICT,
      nombre text NOT NULL CHECK (length(trim(nombre)) > 0),
      fecha_inicio date,
      fecha_fin date,
      estado text NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa', 'cerrada')),
      creado_en timestamptz NOT NULL DEFAULT now(),
      creado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      actualizado_en timestamptz NOT NULL DEFAULT now(),
      actualizado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      UNIQUE (id, proyecto_id),
      CHECK (fecha_fin IS NULL OR fecha_inicio IS NULL OR fecha_fin >= fecha_inicio)
    );
    CREATE UNIQUE INDEX campania_activa_uq ON app.campania (proyecto_id) WHERE estado = 'activa';

    ALTER TABLE app.brigada
      ADD COLUMN codigo text CHECK (length(trim(codigo)) > 0),
      ADD COLUMN region text CHECK (region IN ('COSTA', 'SIERRA', 'SELVA')),
      ADD COLUMN tipo text NOT NULL DEFAULT 'regular' CHECK (tipo IN ('regular', 'complementaria', 'especial')),
      ADD COLUMN campania_id uuid REFERENCES app.campania ON DELETE RESTRICT;
    CREATE UNIQUE INDEX brigada_codigo_uq ON app.brigada (proyecto_id, codigo) WHERE codigo IS NOT NULL;

    -- ── 3. Especialidad y configuración metodológica (D01) ───────────────────────────────────
    CREATE TABLE app.especialidad (
      id uuid PRIMARY KEY,
      proyecto_id uuid NOT NULL REFERENCES app.proyecto ON DELETE RESTRICT,
      codigo text NOT NULL CHECK (codigo ~ '^[a-z][a-z0-9_]*$'),
      nombre text NOT NULL CHECK (length(trim(nombre)) > 0),
      es_fauna boolean NOT NULL,
      orden integer NOT NULL DEFAULT 0,
      creado_en timestamptz NOT NULL DEFAULT now(),
      creado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      actualizado_en timestamptz NOT NULL DEFAULT now(),
      actualizado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      UNIQUE (proyecto_id, codigo)
    );

    -- Una versión por carga de D01. La vigente es la que usan las ejecuciones nuevas; una versión
    -- ya usada por una ejecución no se edita en sitio (CLAUDE.md, Base de datos).
    CREATE TABLE app.configuracion_metodologica (
      id uuid PRIMARY KEY,
      proyecto_id uuid NOT NULL REFERENCES app.proyecto ON DELETE RESTRICT,
      numero integer NOT NULL CHECK (numero > 0),
      origen text NOT NULL CHECK (length(trim(origen)) > 0),
      notas text,
      estado text NOT NULL DEFAULT 'vigente' CHECK (estado IN ('vigente', 'historica')),
      creado_en timestamptz NOT NULL DEFAULT now(),
      creado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      actualizado_en timestamptz NOT NULL DEFAULT now(),
      actualizado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      UNIQUE (proyecto_id, numero)
    );
    CREATE UNIQUE INDEX configuracion_vigente_uq ON app.configuracion_metodologica (proyecto_id) WHERE estado = 'vigente';

    CREATE TABLE app.metodo (
      id uuid PRIMARY KEY,
      configuracion_id uuid NOT NULL REFERENCES app.configuracion_metodologica ON DELETE RESTRICT,
      especialidad_id uuid NOT NULL REFERENCES app.especialidad ON DELETE RESTRICT,
      codigo text NOT NULL CHECK (codigo ~ '^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$'),
      nombre text NOT NULL CHECK (length(trim(nombre)) > 0),
      clase text NOT NULL CHECK (clase IN ('todas', 'condicional', 'evento', 'atributo', 'transversal')),
      tipo_geometria text NOT NULL CHECK (tipo_geometria IN (
        'punto', 'punto_opcional', 'inicio_fin', 'vertices', 'parcela_forestal', 'hereda', 'vinculada'
      )),
      requiere_track boolean NOT NULL DEFAULT false,
      orden integer NOT NULL DEFAULT 0,
      -- ConfiguracionMetodo de core (validada al cargar): esfuerzo, ZA/EF, horario, fotos, campos,
      -- validaciones con tipo de control, vínculos y texto fuente de D01.
      config jsonb NOT NULL,
      creado_en timestamptz NOT NULL DEFAULT now(),
      creado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      actualizado_en timestamptz NOT NULL DEFAULT now(),
      actualizado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      UNIQUE (configuracion_id, codigo)
    );
    CREATE INDEX metodo_especialidad_idx ON app.metodo (especialidad_id);

    -- ── 4. Estación: atributos espaciales de A01 (RN-29) ─────────────────────────────────────
    ALTER TABLE app.estacion
      ADD COLUMN zona_utm text,
      ADD COLUMN este numeric,
      ADD COLUMN norte numeric,
      ADD COLUMN aid_aii text CHECK (aid_aii IN ('AID', 'AII')),
      ADD COLUMN uv text,
      ADD COLUMN za_ef text,
      ADD COLUMN region text CHECK (region IN ('COSTA', 'SIERRA', 'SELVA'));

    -- ── 5. Aplicabilidad estación–método (RN-28) ─────────────────────────────────────────────
    CREATE TABLE app.estacion_metodo (
      id uuid PRIMARY KEY,
      estacion_id uuid NOT NULL REFERENCES app.estacion ON DELETE RESTRICT,
      metodo_id uuid NOT NULL REFERENCES app.metodo ON DELETE RESTRICT,
      habilitado boolean NOT NULL,
      origen text NOT NULL CHECK (origen IN ('clase', 'condicion', 'nominal')),
      -- La condición de un CONDICIONAL no pudo evaluarse con los atributos (P-01).
      condicion_pendiente boolean NOT NULL DEFAULT false,
      creado_en timestamptz NOT NULL DEFAULT now(),
      creado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      actualizado_en timestamptz NOT NULL DEFAULT now(),
      actualizado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      UNIQUE (estacion_id, metodo_id)
    );
    CREATE INDEX estacion_metodo_metodo_idx ON app.estacion_metodo (metodo_id);

    -- ── 6. Cronograma base/vigente (RN-35) y solicitudes de cambio (RN-36) ───────────────────
    CREATE TABLE app.cronograma_version (
      id uuid PRIMARY KEY,
      campania_id uuid NOT NULL REFERENCES app.campania ON DELETE RESTRICT,
      numero integer NOT NULL CHECK (numero > 0),
      estado text NOT NULL DEFAULT 'vigente' CHECK (estado IN ('vigente', 'historica')),
      -- La versión 1 es el cronograma base (A01): se conserva sin sobrescritura.
      es_base boolean NOT NULL DEFAULT false,
      solicitud_id uuid,
      aprobado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      aprobado_en timestamptz,
      creado_en timestamptz NOT NULL DEFAULT now(),
      creado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      actualizado_en timestamptz NOT NULL DEFAULT now(),
      actualizado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      UNIQUE (campania_id, numero),
      CHECK (es_base = (numero = 1))
    );
    CREATE UNIQUE INDEX cronograma_vigente_uq ON app.cronograma_version (campania_id) WHERE estado = 'vigente';

    CREATE TABLE app.cronograma_item (
      id uuid PRIMARY KEY,
      version_id uuid NOT NULL REFERENCES app.cronograma_version ON DELETE RESTRICT,
      brigada_id uuid NOT NULL REFERENCES app.brigada ON DELETE RESTRICT,
      fecha date NOT NULL,
      tipo_actividad text NOT NULL CHECK (tipo_actividad IN (
        'estacion', 'movilizacion', 'traslado', 'desmovilizacion', 'feriado', 'procesamiento', 'otro'
      )),
      estacion_id uuid REFERENCES app.estacion ON DELETE RESTRICT,
      detalle text,
      estado_fila text NOT NULL DEFAULT 'ok' CHECK (estado_fila IN (
        'ok', 'pendiente_validacion', 'reprogramada', 'sujeta_a_decision'
      )),
      -- EPÍFITAS o CÁMARAS TRAMPA en la hoja 02 de A01; nulo en la programación regular.
      actividad_especial text,
      orden integer NOT NULL DEFAULT 0,
      creado_en timestamptz NOT NULL DEFAULT now(),
      creado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      actualizado_en timestamptz NOT NULL DEFAULT now(),
      actualizado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      CHECK ((tipo_actividad = 'estacion') = (estacion_id IS NOT NULL))
    );
    CREATE INDEX cronograma_item_version_idx ON app.cronograma_item (version_id, fecha);
    CREATE INDEX cronograma_item_estacion_idx ON app.cronograma_item (estacion_id);

    CREATE TABLE app.solicitud_cronograma (
      id uuid PRIMARY KEY,
      campania_id uuid NOT NULL REFERENCES app.campania ON DELETE RESTRICT,
      version_base_id uuid NOT NULL REFERENCES app.cronograma_version ON DELETE RESTRICT,
      propuesto_por uuid NOT NULL REFERENCES app.usuario ON DELETE RESTRICT,
      estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN (
        'pendiente', 'aprobada', 'rechazada', 'ajuste_solicitado'
      )),
      motivo text NOT NULL CHECK (length(trim(motivo)) > 0),
      -- CambioCronograma[] de core: reprogramar, marcar o agregar; nunca eliminar (RN-35).
      cambios jsonb NOT NULL,
      decidido_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      decidido_en timestamptz,
      comentario_decision text,
      alerta_id uuid,
      creado_en timestamptz NOT NULL DEFAULT now(),
      creado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      actualizado_en timestamptz NOT NULL DEFAULT now(),
      actualizado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      CHECK (estado NOT IN ('aprobada', 'rechazada') OR (decidido_por IS NOT NULL AND decidido_en IS NOT NULL))
    );
    CREATE INDEX solicitud_cronograma_campania_idx ON app.solicitud_cronograma (campania_id, estado);
    ALTER TABLE app.cronograma_version
      ADD FOREIGN KEY (solicitud_id) REFERENCES app.solicitud_cronograma ON DELETE RESTRICT;

    -- ── 7. Tarea = reserva interna estación × método (RN-01, RN-02, RN-03) ───────────────────
    ALTER TABLE app.tarea ALTER COLUMN cuaderno_id DROP NOT NULL;
    ALTER TABLE app.tarea
      ADD COLUMN metodo_id uuid REFERENCES app.metodo ON DELETE RESTRICT,
      ADD COLUMN brigada_id uuid REFERENCES app.brigada ON DELETE RESTRICT,
      ADD COLUMN fecha_programada date,
      ADD COLUMN cronograma_item_id uuid REFERENCES app.cronograma_item ON DELETE RESTRICT;
    CREATE UNIQUE INDEX tarea_estacion_metodo_uq ON app.tarea (estacion_id, metodo_id) WHERE metodo_id IS NOT NULL;
    CREATE INDEX tarea_brigada_idx ON app.tarea (brigada_id, fecha_programada);

    -- ── 8. Ejecución, unidad y track (D02 §6, RN-05, RN-30, RN-24) ───────────────────────────
    CREATE TABLE app.ejecucion (
      id uuid PRIMARY KEY,
      proyecto_id uuid NOT NULL REFERENCES app.proyecto ON DELETE RESTRICT,
      tarea_id uuid NOT NULL REFERENCES app.tarea ON DELETE RESTRICT,
      estacion_id uuid NOT NULL REFERENCES app.estacion ON DELETE RESTRICT,
      metodo_id uuid NOT NULL REFERENCES app.metodo ON DELETE RESTRICT,
      usuario_id uuid NOT NULL REFERENCES app.usuario ON DELETE RESTRICT,
      dispositivo_id uuid REFERENCES app.dispositivo ON DELETE RESTRICT,
      estado text NOT NULL DEFAULT 'en_curso' CHECK (estado IN (
        'en_curso', 'evidencia_pendiente', 'completa', 'parcial', 'validada', 'observada'
      )),
      abierta_en timestamptz NOT NULL,
      cerrada_en timestamptz,
      -- Campos de ejecución del método (p. ej. grupo de fauna y tiempo efectivo en ABS).
      datos jsonb NOT NULL DEFAULT '{}',
      -- Esfuerzo planificado vs. ejecutado (T-10, RF-T05).
      esfuerzo_planificado jsonb,
      esfuerzo_ejecutado jsonb,
      desviacion_tipo text NOT NULL DEFAULT 'ninguna' CHECK (desviacion_tipo IN (
        'ninguna', 'parcial', 'imposibilidad', 'excepcional'
      )),
      desviacion_explicacion text,
      -- Resultado de la QA post-sincronización contra D01 (RF-T04).
      resultado_qa jsonb,
      qa_evaluado_en timestamptz,
      version integer NOT NULL DEFAULT 1 CHECK (version > 0),
      creado_en timestamptz NOT NULL DEFAULT now(),
      creado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      actualizado_en timestamptz NOT NULL DEFAULT now(),
      actualizado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      CHECK (desviacion_tipo = 'ninguna' OR length(trim(coalesce(desviacion_explicacion, ''))) > 0),
      CHECK (cerrada_en IS NULL OR cerrada_en >= abierta_en)
    );
    CREATE INDEX ejecucion_tarea_idx ON app.ejecucion (tarea_id);
    CREATE INDEX ejecucion_estacion_metodo_idx ON app.ejecucion (estacion_id, metodo_id);
    CREATE INDEX ejecucion_proyecto_estado_idx ON app.ejecucion (proyecto_id, estado);
    CREATE INDEX ejecucion_usuario_idx ON app.ejecucion (usuario_id);

    CREATE TABLE app.unidad (
      id uuid PRIMARY KEY,
      ejecucion_id uuid NOT NULL REFERENCES app.ejecucion ON DELETE RESTRICT,
      codigo text NOT NULL CHECK (length(trim(codigo)) > 0),
      tipo_unidad text NOT NULL CHECK (tipo_unidad IN (
        'transecto', 'cuadrante', 'parcela', 'recorrido', 'arbol', 'punto', 'trampa', 'bandeja',
        'red', 'camara', 'detector', 'lista', 'sector', 'abs', 'evento', 'atributo'
      )),
      orden integer NOT NULL DEFAULT 0,
      -- Punto, línea (inicio + fin) o polígono (vértices), según la geometría del método.
      geom geometry(Geometry, 4326),
      -- Vértices con precisión y hora, subparcelas de la parcela forestal, etc.
      geom_detalle jsonb,
      datos jsonb NOT NULL DEFAULT '{}',
      inicio timestamptz,
      fin timestamptz,
      -- Reutilización (RN-34): unidad de otro método cuya geometría o contexto se comparte.
      unidad_vinculada_id uuid REFERENCES app.unidad ON DELETE RESTRICT,
      estado text NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'cerrada')),
      creado_en timestamptz NOT NULL DEFAULT now(),
      creado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      actualizado_en timestamptz NOT NULL DEFAULT now(),
      actualizado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      UNIQUE (ejecucion_id, codigo),
      CHECK (fin IS NULL OR inicio IS NULL OR fin >= inicio)
    );
    CREATE INDEX unidad_geom_idx ON app.unidad USING gist (geom);

    CREATE TABLE app.track (
      id uuid PRIMARY KEY,
      ejecucion_id uuid NOT NULL REFERENCES app.ejecucion ON DELETE RESTRICT,
      unidad_id uuid REFERENCES app.unidad ON DELETE RESTRICT,
      geom geometry(LineString, 4326) NOT NULL,
      -- [{lat, lon, altitud_m, precision_m, hora}] tal como los registró la app.
      puntos jsonb NOT NULL,
      inicio timestamptz NOT NULL,
      fin timestamptz NOT NULL,
      evento_id uuid UNIQUE REFERENCES app.evento ON DELETE RESTRICT,
      creado_en timestamptz NOT NULL DEFAULT now(),
      creado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      actualizado_en timestamptz NOT NULL DEFAULT now(),
      actualizado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      CHECK (fin >= inicio)
    );
    CREATE INDEX track_ejecucion_idx ON app.track (ejecucion_id);
    CREATE INDEX track_geom_idx ON app.track USING gist (geom);

    -- ── 9. Fotos: estación, método, unidad, tipo y candidatas al reporte (F-02, F-08) ────────
    ALTER TABLE app.archivo
      ADD COLUMN ejecucion_id uuid REFERENCES app.ejecucion ON DELETE RESTRICT,
      ADD COLUMN unidad_id uuid REFERENCES app.unidad ON DELETE RESTRICT,
      ADD COLUMN estacion_id uuid REFERENCES app.estacion ON DELETE RESTRICT,
      ADD COLUMN metodo_id uuid REFERENCES app.metodo ON DELETE RESTRICT,
      ADD COLUMN tipo_foto text CHECK (tipo_foto IN ('contexto', 'metodologica', 'primer_plano', 'cientifica')),
      ADD COLUMN orientacion text CHECK (orientacion IN ('N', 'S', 'E', 'O')),
      ADD COLUMN candidata_reporte boolean NOT NULL DEFAULT false,
      ADD COLUMN seleccionada_reporte boolean NOT NULL DEFAULT false,
      ADD CONSTRAINT archivo_tipo_foto_solo_fotos CHECK (tipo = 'foto' OR (tipo_foto IS NULL AND orientacion IS NULL));
    CREATE INDEX archivo_ejecucion_idx ON app.archivo (ejecucion_id);
    CREATE INDEX archivo_unidad_idx ON app.archivo (unidad_id);
    CREATE INDEX archivo_candidata_idx ON app.archivo (proyecto_id) WHERE candidata_reporte;

    -- ── 10. Esfuerzo por ejecución (RN-19, T-10) ─────────────────────────────────────────────
    ALTER TABLE app.registro_esfuerzo ALTER COLUMN estacion_metodologia_id DROP NOT NULL;
    ALTER TABLE app.registro_esfuerzo
      ADD COLUMN ejecucion_id uuid REFERENCES app.ejecucion ON DELETE RESTRICT,
      ADD COLUMN unidad_id uuid REFERENCES app.unidad ON DELETE RESTRICT,
      ADD CONSTRAINT registro_esfuerzo_destino CHECK (estacion_metodologia_id IS NOT NULL OR ejecucion_id IS NOT NULL);
    CREATE INDEX registro_esfuerzo_ejecucion_idx ON app.registro_esfuerzo (ejecucion_id);

    -- ── 11. Alertas estructuradas (D02 §9, RN-36) ────────────────────────────────────────────
    CREATE TABLE app.alerta (
      id uuid PRIMARY KEY,
      proyecto_id uuid NOT NULL REFERENCES app.proyecto ON DELETE RESTRICT,
      tipo text NOT NULL CHECK (tipo IN ('tecnica', 'logistica', 'post_sincronizacion')),
      estado text NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'pendiente_respuesta', 'cerrada')),
      origen text NOT NULL CHECK (origen IN ('usuario', 'sistema')),
      brigada_id uuid REFERENCES app.brigada ON DELETE RESTRICT,
      estacion_id uuid REFERENCES app.estacion ON DELETE RESTRICT,
      ejecucion_id uuid REFERENCES app.ejecucion ON DELETE RESTRICT,
      tarea_id uuid REFERENCES app.tarea ON DELETE RESTRICT,
      titulo text NOT NULL CHECK (length(trim(titulo)) > 0),
      descripcion text,
      -- Post-sincronización: regla + ejecución + periodo; un reproceso no duplica (RN-22).
      clave_dedup text,
      responsable_id uuid REFERENCES app.usuario ON DELETE RESTRICT,
      dispositivo_id uuid REFERENCES app.dispositivo ON DELETE RESTRICT,
      hora_dispositivo timestamptz,
      afecta_cronograma boolean NOT NULL DEFAULT false,
      solicitud_cronograma_id uuid REFERENCES app.solicitud_cronograma ON DELETE RESTRICT,
      cerrado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      cerrado_en timestamptz,
      cierre_comentario text,
      evento_id uuid REFERENCES app.evento ON DELETE RESTRICT,
      creado_en timestamptz NOT NULL DEFAULT now(),
      creado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      actualizado_en timestamptz NOT NULL DEFAULT now(),
      actualizado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      CHECK ((estado = 'cerrada') = (cerrado_por IS NOT NULL AND cerrado_en IS NOT NULL)),
      CHECK (origen <> 'sistema' OR clave_dedup IS NOT NULL)
    );
    CREATE UNIQUE INDEX alerta_clave_dedup_uq ON app.alerta (proyecto_id, clave_dedup) WHERE clave_dedup IS NOT NULL;
    CREATE INDEX alerta_proyecto_estado_idx ON app.alerta (proyecto_id, estado, creado_en);
    CREATE INDEX alerta_brigada_idx ON app.alerta (brigada_id);
    CREATE INDEX alerta_ejecucion_idx ON app.alerta (ejecucion_id);
    ALTER TABLE app.solicitud_cronograma
      ADD FOREIGN KEY (alerta_id) REFERENCES app.alerta ON DELETE RESTRICT;

    CREATE TABLE app.alerta_mensaje (
      id uuid PRIMARY KEY,
      alerta_id uuid NOT NULL REFERENCES app.alerta ON DELETE RESTRICT,
      autor_id uuid NOT NULL REFERENCES app.usuario ON DELETE RESTRICT,
      tipo text NOT NULL CHECK (tipo IN ('respuesta', 'complemento', 'consulta', 'cierre', 'reapertura')),
      texto text NOT NULL CHECK (length(trim(texto)) > 0),
      evento_id uuid REFERENCES app.evento ON DELETE RESTRICT,
      creado_en timestamptz NOT NULL DEFAULT now(),
      creado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      actualizado_en timestamptz NOT NULL DEFAULT now(),
      actualizado_por uuid REFERENCES app.usuario ON DELETE RESTRICT
    );
    CREATE INDEX alerta_mensaje_alerta_idx ON app.alerta_mensaje (alerta_id, creado_en);
  `.execute(db);

  // Trigger de actualizado_en en las tablas nuevas (las existentes ya lo tienen).
  await sql`
    DO $$
    DECLARE t text;
    BEGIN
      FOR t IN
        SELECT c.table_name FROM information_schema.columns c
         WHERE c.table_schema = 'app' AND c.column_name = 'actualizado_en'
           AND NOT EXISTS (
             SELECT 1 FROM pg_trigger tg
              JOIN pg_class cl ON cl.oid = tg.tgrelid
              JOIN pg_namespace n ON n.oid = cl.relnamespace
             WHERE n.nspname = 'app' AND cl.relname = c.table_name
               AND tg.tgname = c.table_name || '_actualizado_en'
           )
      LOOP
        EXECUTE format(
          'CREATE TRIGGER %I BEFORE UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.tocar_actualizado_en()',
          t || '_actualizado_en', t
        );
      END LOOP;
    END $$;
  `.execute(db);

  // Sin borrado físico en las tablas nuevas. Solo en ellas: un REVOKE sobre todo el esquema
  // quitaría el DELETE de auth_session y auth_verification que concede la migración de auth.
  await sql`
    REVOKE DELETE, TRUNCATE ON
      app.campania, app.especialidad, app.configuracion_metodologica, app.metodo,
      app.estacion_metodo, app.cronograma_version, app.cronograma_item, app.solicitud_cronograma,
      app.ejecucion, app.unidad, app.track, app.alerta, app.alerta_mensaje
    FROM app_rw, worker_rw;
  `.execute(db);
}
