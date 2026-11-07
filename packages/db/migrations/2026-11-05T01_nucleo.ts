import { sql, type Kysely } from 'kysely';

/**
 * Núcleo del dominio (doc. 02 §8). Migraciones solo hacia adelante: no hay `down`.
 *
 * Los valores de los CHECK de estado están escritos aquí a mano, no importados de core: una
 * migración ya aplicada no puede cambiar si core cambia. La prueba de integración verifica que
 * coincidan con los de core.
 *
 * Sin `ON DELETE CASCADE`: todas las FK son RESTRICT y no hay borrado físico de datos de campo.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    -- Columnas de auditoría (doc. 02 §8.2): actualizado_en se mantiene con este trigger.
    CREATE FUNCTION app.tocar_actualizado_en() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      NEW.actualizado_en := now();
      RETURN NEW;
    END $$;

    CREATE TABLE app.usuario (
      id uuid PRIMARY KEY,
      tipo_documento text NOT NULL CHECK (tipo_documento ~ '^[A-Z]{2,10}$'),
      num_documento text NOT NULL CHECK (num_documento ~ '^[0-9A-Za-z]{4,20}$'),
      nombre text NOT NULL CHECK (length(trim(nombre)) > 0),
      celular text,
      rol_global text NOT NULL DEFAULT 'ninguno' CHECK (rol_global IN ('supervisor', 'admin', 'ninguno')),
      estado text NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'inactivo')),
      creado_en timestamptz NOT NULL DEFAULT now(),
      creado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      actualizado_en timestamptz NOT NULL DEFAULT now(),
      actualizado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      UNIQUE (tipo_documento, num_documento)
    );

    CREATE TABLE app.dispositivo (
      id uuid PRIMARY KEY,
      usuario_id uuid NOT NULL REFERENCES app.usuario ON DELETE RESTRICT,
      plataforma text NOT NULL CHECK (plataforma IN ('android', 'ios')),
      llave_publica text NOT NULL,
      token_push text,
      version_app text NOT NULL,
      estado text NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'baja_pendiente', 'baja')),
      ultimo_sync_en timestamptz,
      creado_en timestamptz NOT NULL DEFAULT now(),
      creado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      actualizado_en timestamptz NOT NULL DEFAULT now(),
      actualizado_por uuid REFERENCES app.usuario ON DELETE RESTRICT
    );
    CREATE INDEX dispositivo_usuario_idx ON app.dispositivo (usuario_id);

    CREATE TABLE app.proyecto (
      id uuid PRIMARY KEY,
      nombre text NOT NULL CHECK (length(trim(nombre)) > 0),
      estado text NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'cerrado')),
      validacion_activa boolean NOT NULL,
      subir_originales boolean NOT NULL DEFAULT false,
      dias_bloqueo integer NOT NULL DEFAULT 15 CHECK (dias_bloqueo > 0),
      hora_cierre_jornada time,
      bbox geometry(Polygon, 4326),
      creado_en timestamptz NOT NULL DEFAULT now(),
      creado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      actualizado_en timestamptz NOT NULL DEFAULT now(),
      actualizado_por uuid REFERENCES app.usuario ON DELETE RESTRICT
    );

    CREATE TABLE app.cuadrilla (
      id uuid PRIMARY KEY,
      proyecto_id uuid NOT NULL REFERENCES app.proyecto ON DELETE RESTRICT,
      nombre text NOT NULL CHECK (length(trim(nombre)) > 0),
      jefe_id uuid REFERENCES app.usuario ON DELETE RESTRICT,
      creado_en timestamptz NOT NULL DEFAULT now(),
      creado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      actualizado_en timestamptz NOT NULL DEFAULT now(),
      actualizado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      UNIQUE (id, proyecto_id)
    );
    CREATE INDEX cuadrilla_proyecto_idx ON app.cuadrilla (proyecto_id);

    CREATE TABLE app.miembro_cuadrilla (
      id uuid PRIMARY KEY,
      cuadrilla_id uuid NOT NULL REFERENCES app.cuadrilla ON DELETE RESTRICT,
      usuario_id uuid NOT NULL REFERENCES app.usuario ON DELETE RESTRICT,
      rol text NOT NULL CHECK (rol IN ('especialista', 'logistico')),
      estado text NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'retirado')),
      creado_en timestamptz NOT NULL DEFAULT now(),
      creado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      actualizado_en timestamptz NOT NULL DEFAULT now(),
      actualizado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      UNIQUE (cuadrilla_id, usuario_id)
    );
    CREATE INDEX miembro_cuadrilla_usuario_idx ON app.miembro_cuadrilla (usuario_id);

    CREATE TABLE app.catalogo_metodologia (
      id uuid PRIMARY KEY,
      nombre text NOT NULL UNIQUE CHECK (length(trim(nombre)) > 0),
      unidad text NOT NULL,
      requiere_transecto boolean NOT NULL DEFAULT false,
      creado_en timestamptz NOT NULL DEFAULT now(),
      creado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      actualizado_en timestamptz NOT NULL DEFAULT now(),
      actualizado_por uuid REFERENCES app.usuario ON DELETE RESTRICT
    );

    CREATE TABLE app.estacion (
      id uuid PRIMARY KEY,
      proyecto_id uuid NOT NULL REFERENCES app.proyecto ON DELETE RESTRICT,
      codigo text NOT NULL CHECK (length(trim(codigo)) > 0),
      geom geometry(Point, 4326) NOT NULL,
      atributos jsonb NOT NULL DEFAULT '{}',
      creado_en timestamptz NOT NULL DEFAULT now(),
      creado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      actualizado_en timestamptz NOT NULL DEFAULT now(),
      actualizado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      UNIQUE (proyecto_id, codigo)
    );
    CREATE INDEX estacion_geom_idx ON app.estacion USING gist (geom);

    CREATE TABLE app.estacion_metodologia (
      id uuid PRIMARY KEY,
      estacion_id uuid NOT NULL REFERENCES app.estacion ON DELETE RESTRICT,
      metodologia_id uuid NOT NULL REFERENCES app.catalogo_metodologia ON DELETE RESTRICT,
      meta_esfuerzo numeric CHECK (meta_esfuerzo >= 0),
      creado_en timestamptz NOT NULL DEFAULT now(),
      creado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      actualizado_en timestamptz NOT NULL DEFAULT now(),
      actualizado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      UNIQUE (estacion_id, metodologia_id)
    );

    CREATE TABLE app.regla_alerta (
      id uuid PRIMARY KEY,
      proyecto_id uuid NOT NULL REFERENCES app.proyecto ON DELETE RESTRICT,
      tipo text NOT NULL,
      condicion jsonb NOT NULL,
      severidad text NOT NULL CHECK (severidad IN ('baja', 'media', 'alta')),
      ambito text NOT NULL CHECK (ambito IN ('local', 'servidor')),
      responsable_rol text NOT NULL CHECK (responsable_rol IN ('supervisor', 'jefe', 'especialista', 'logistico')),
      notificados jsonb NOT NULL DEFAULT '[]',
      activa boolean NOT NULL DEFAULT true,
      creado_en timestamptz NOT NULL DEFAULT now(),
      creado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      actualizado_en timestamptz NOT NULL DEFAULT now(),
      actualizado_por uuid REFERENCES app.usuario ON DELETE RESTRICT
    );

    CREATE TABLE app.cuaderno (
      id uuid PRIMARY KEY,
      proyecto_id uuid NOT NULL,
      cuadrilla_id uuid NOT NULL,
      responsable_id uuid NOT NULL REFERENCES app.usuario ON DELETE RESTRICT,
      titulo text NOT NULL CHECK (length(trim(titulo)) > 0),
      -- NULL = hereda del proyecto (RN-06, CP-036).
      validacion_activa boolean,
      estado text NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'archivado')),
      creado_en timestamptz NOT NULL DEFAULT now(),
      creado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      actualizado_en timestamptz NOT NULL DEFAULT now(),
      actualizado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      -- La cuadrilla debe ser del mismo proyecto que el cuaderno.
      FOREIGN KEY (cuadrilla_id, proyecto_id) REFERENCES app.cuadrilla (id, proyecto_id) ON DELETE RESTRICT,
      UNIQUE (id, proyecto_id)
    );
    CREATE INDEX cuaderno_responsable_idx ON app.cuaderno (responsable_id);

    CREATE TABLE app.tarea (
      id uuid PRIMARY KEY,
      -- Hueco de los documentos: tarea no tenía proyecto_id pero el índice de clave_dedup lo usa
      -- (CLAUDE.md). La FK compuesta asegura que coincida con el del cuaderno.
      proyecto_id uuid NOT NULL,
      cuaderno_id uuid NOT NULL,
      origen text NOT NULL CHECK (origen IN ('manual', 'regla')),
      regla_id uuid REFERENCES app.regla_alerta ON DELETE RESTRICT,
      clave_dedup text,
      tipo text NOT NULL CHECK (tipo IN ('tecnica', 'logistica')),
      estacion_id uuid REFERENCES app.estacion ON DELETE RESTRICT,
      metodologia_id uuid REFERENCES app.catalogo_metodologia ON DELETE RESTRICT,
      geom geometry(Geometry, 4326),
      titulo text NOT NULL CHECK (length(trim(titulo)) > 0),
      descripcion text,
      estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN (
        'pendiente', 'asignada', 'descargada', 'en_transito',
        'completada', 'validada', 'observada', 'cerrada'
      )),
      version integer NOT NULL DEFAULT 1 CHECK (version > 0),
      creado_en timestamptz NOT NULL DEFAULT now(),
      creado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      actualizado_en timestamptz NOT NULL DEFAULT now(),
      actualizado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      FOREIGN KEY (cuaderno_id, proyecto_id) REFERENCES app.cuaderno (id, proyecto_id) ON DELETE RESTRICT,
      -- RN-22: una tarea por regla es una alerta y siempre lleva su clave de deduplicación.
      CHECK (
        (origen = 'manual' AND regla_id IS NULL AND clave_dedup IS NULL)
        OR (origen = 'regla' AND regla_id IS NOT NULL AND clave_dedup IS NOT NULL)
      )
    );
    CREATE INDEX tarea_cuaderno_idx ON app.tarea (cuaderno_id);
    CREATE INDEX tarea_proyecto_estado_idx ON app.tarea (proyecto_id, estado);
    CREATE INDEX tarea_geom_idx ON app.tarea USING gist (geom);
    -- RN-22 y doc. 02 §8.3.
    CREATE UNIQUE INDEX tarea_clave_dedup_uq ON app.tarea (proyecto_id, clave_dedup) WHERE clave_dedup IS NOT NULL;

    CREATE TABLE app.asignacion (
      id uuid PRIMARY KEY,
      tarea_id uuid NOT NULL REFERENCES app.tarea ON DELETE RESTRICT,
      usuario_id uuid NOT NULL REFERENCES app.usuario ON DELETE RESTRICT,
      dispositivo_id uuid NOT NULL REFERENCES app.dispositivo ON DELETE RESTRICT,
      estado text NOT NULL DEFAULT 'vigente' CHECK (estado IN ('vigente', 'devuelta', 'revocada', 'finalizada')),
      descargada_en timestamptz NOT NULL,
      finalizada_en timestamptz,
      motivo_revocacion text,
      creado_en timestamptz NOT NULL DEFAULT now(),
      creado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      actualizado_en timestamptz NOT NULL DEFAULT now(),
      actualizado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      -- RN-07: revocar exige motivo.
      CHECK (estado <> 'revocada' OR length(trim(coalesce(motivo_revocacion, ''))) > 0),
      CHECK (finalizada_en IS NULL OR finalizada_en >= descargada_en)
    );
    -- RN-02: como máximo una asignación vigente por tarea.
    CREATE UNIQUE INDEX asignacion_vigente_uq ON app.asignacion (tarea_id) WHERE estado = 'vigente';
    CREATE INDEX asignacion_usuario_idx ON app.asignacion (usuario_id, estado);

    -- Evento: solo inserción (RN-09, RN-10, RN-12, SEG-14). Su id es el UUID v7 del dispositivo.
    -- No lleva columnas de auditoría de actualización porque no se actualiza; hora_servidor
    -- cumple el papel de creado_en.
    CREATE TABLE app.evento (
      id uuid PRIMARY KEY,
      tipo text NOT NULL,
      version_esquema integer NOT NULL CHECK (version_esquema > 0),
      usuario_id uuid NOT NULL REFERENCES app.usuario ON DELETE RESTRICT,
      -- Nulo solo en acciones hechas desde la web (CLAUDE.md, huecos).
      dispositivo_id uuid REFERENCES app.dispositivo ON DELETE RESTRICT,
      asignacion_id uuid REFERENCES app.asignacion ON DELETE RESTRICT,
      entidad_tipo text NOT NULL,
      entidad_id uuid NOT NULL,
      payload jsonb NOT NULL,
      hora_dispositivo timestamptz,
      hora_servidor timestamptz NOT NULL DEFAULT clock_timestamp(),
      estado text NOT NULL CHECK (estado IN (
        'aplicado', 'ya_aplicado', 'no_aplicado', 'en_revision',
        'duplicado', 'resuelto_elegido', 'resuelto_descartado'
      )),
      motivo text,
      resuelto_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      resuelto_en timestamptz,
      resolucion_comentario text,
      -- RN-12: lo no aplicado guarda su motivo.
      CHECK (estado NOT IN ('no_aplicado', 'en_revision', 'duplicado') OR motivo IS NOT NULL),
      CHECK ((estado IN ('resuelto_elegido', 'resuelto_descartado')) = (resuelto_por IS NOT NULL AND resuelto_en IS NOT NULL))
    );
    CREATE INDEX evento_entidad_idx ON app.evento (entidad_tipo, entidad_id, hora_servidor);
    CREATE INDEX evento_usuario_idx ON app.evento (usuario_id, hora_servidor);
    CREATE INDEX evento_pendiente_resolucion_idx ON app.evento (hora_servidor) WHERE estado IN ('en_revision', 'duplicado');

    -- La única modificación permitida es la resolución de un evento en revisión o duplicado,
    -- y solo mediante app.resolver_evento (SEG-14, doc. 03 §11.1).
    CREATE FUNCTION app.evento_inmutable() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'UPDATE'
         AND current_setting('app.resolviendo_evento', true) = 'si'
         AND OLD.estado IN ('en_revision', 'duplicado')
         AND NEW.estado IN ('resuelto_elegido', 'resuelto_descartado')
         AND (NEW.id, NEW.tipo, NEW.version_esquema, NEW.usuario_id, NEW.dispositivo_id,
              NEW.asignacion_id, NEW.entidad_tipo, NEW.entidad_id, NEW.payload,
              NEW.hora_dispositivo, NEW.hora_servidor, NEW.motivo)
             IS NOT DISTINCT FROM
             (OLD.id, OLD.tipo, OLD.version_esquema, OLD.usuario_id, OLD.dispositivo_id,
              OLD.asignacion_id, OLD.entidad_tipo, OLD.entidad_id, OLD.payload,
              OLD.hora_dispositivo, OLD.hora_servidor, OLD.motivo)
      THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'evento es solo inserción (% no permitido)', TG_OP USING ERRCODE = 'insufficient_privilege';
    END $$;

    CREATE TRIGGER evento_inmutable_fila BEFORE UPDATE OR DELETE ON app.evento
      FOR EACH ROW EXECUTE FUNCTION app.evento_inmutable();
    CREATE TRIGGER evento_inmutable_truncate BEFORE TRUNCATE ON app.evento
      FOR EACH STATEMENT EXECUTE FUNCTION app.evento_inmutable();

    CREATE FUNCTION app.resolver_evento(
      p_evento_id uuid, p_estado text, p_resuelto_por uuid, p_comentario text
    ) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
    BEGIN
      IF p_estado NOT IN ('resuelto_elegido', 'resuelto_descartado') THEN
        RAISE EXCEPTION 'estado de resolución inválido: %', p_estado USING ERRCODE = 'check_violation';
      END IF;
      PERFORM set_config('app.resolviendo_evento', 'si', true);
      UPDATE app.evento
         SET estado = p_estado, resuelto_por = p_resuelto_por, resuelto_en = now(),
             resolucion_comentario = p_comentario
       WHERE id = p_evento_id AND estado IN ('en_revision', 'duplicado');
      IF NOT FOUND THEN
        RAISE EXCEPTION 'evento % no está pendiente de resolución', p_evento_id USING ERRCODE = 'no_data_found';
      END IF;
      PERFORM set_config('app.resolviendo_evento', '', true);
    END $$;
    REVOKE ALL ON FUNCTION app.resolver_evento(uuid, text, uuid, text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION app.resolver_evento(uuid, text, uuid, text) TO app_rw;

    CREATE TABLE app.categoria_foto (
      id uuid PRIMARY KEY,
      proyecto_id uuid NOT NULL REFERENCES app.proyecto ON DELETE RESTRICT,
      padre_id uuid REFERENCES app.categoria_foto ON DELETE RESTRICT,
      nivel text NOT NULL CHECK (nivel IN ('tema', 'subtema', 'categoria')),
      nombre text NOT NULL CHECK (length(trim(nombre)) > 0),
      creado_en timestamptz NOT NULL DEFAULT now(),
      creado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      actualizado_en timestamptz NOT NULL DEFAULT now(),
      actualizado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      CHECK ((nivel = 'tema') = (padre_id IS NULL))
    );

    CREATE TABLE app.evidencia_item (
      id uuid PRIMARY KEY,
      tarea_id uuid NOT NULL REFERENCES app.tarea ON DELETE RESTRICT,
      descripcion text NOT NULL,
      geom geometry(Point, 4326),
      orden integer NOT NULL CHECK (orden >= 0),
      creado_en timestamptz NOT NULL DEFAULT now(),
      creado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      actualizado_en timestamptz NOT NULL DEFAULT now(),
      actualizado_por uuid REFERENCES app.usuario ON DELETE RESTRICT
    );
    CREATE INDEX evidencia_item_tarea_idx ON app.evidencia_item (tarea_id);

    CREATE TABLE app.archivo (
      id uuid PRIMARY KEY,
      proyecto_id uuid NOT NULL REFERENCES app.proyecto ON DELETE RESTRICT,
      -- Autor (RN-21: el especialista solo ve y sistematiza lo suyo).
      usuario_id uuid NOT NULL REFERENCES app.usuario ON DELETE RESTRICT,
      tarea_id uuid REFERENCES app.tarea ON DELETE RESTRICT,
      evidencia_item_id uuid REFERENCES app.evidencia_item ON DELETE RESTRICT,
      tipo text NOT NULL CHECK (tipo IN ('foto', 'ficha', 'audio', 'comprobante')),
      categoria_foto_id uuid REFERENCES app.categoria_foto ON DELETE RESTRICT,
      hash_preview text NOT NULL CHECK (hash_preview ~ '^[0-9a-f]{64}$'),
      hash_original text CHECK (hash_original ~ '^[0-9a-f]{64}$'),
      tamano_preview bigint NOT NULL CHECK (tamano_preview > 0),
      tamano_original bigint CHECK (tamano_original > 0),
      -- Rutas generadas por el servidor, nunca por el usuario (doc. 03 §10).
      ruta_miniatura text,
      ruta_preview text,
      ruta_original text,
      estado text NOT NULL DEFAULT 'anunciado' CHECK (estado IN (
        'anunciado', 'preview_subida', 'preview_verificada', 'original_verificado', 'error'
      )),
      geom geometry(Point, 4326),
      precision_m real CHECK (precision_m >= 0),
      altitud_m real,
      capturado_en timestamptz NOT NULL,
      creado_en timestamptz NOT NULL DEFAULT now(),
      creado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      actualizado_en timestamptz NOT NULL DEFAULT now(),
      actualizado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      -- Fichas, audios y comprobantes solo tienen la variante preview (doc. 03 §10).
      CHECK (tipo = 'foto' OR hash_original IS NULL),
      CHECK ((hash_original IS NULL) = (tamano_original IS NULL)),
      CHECK (estado <> 'original_verificado' OR hash_original IS NOT NULL)
    );
    CREATE INDEX archivo_tarea_idx ON app.archivo (tarea_id);
    CREATE INDEX archivo_usuario_idx ON app.archivo (usuario_id);
    CREATE INDEX archivo_geom_idx ON app.archivo USING gist (geom);

    CREATE TABLE app.comentario (
      id uuid PRIMARY KEY,
      tarea_id uuid NOT NULL REFERENCES app.tarea ON DELETE RESTRICT,
      autor_id uuid NOT NULL REFERENCES app.usuario ON DELETE RESTRICT,
      texto text NOT NULL CHECK (length(trim(texto)) > 0),
      evento_id uuid REFERENCES app.evento ON DELETE RESTRICT,
      creado_en timestamptz NOT NULL DEFAULT now(),
      creado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      actualizado_en timestamptz NOT NULL DEFAULT now(),
      actualizado_por uuid REFERENCES app.usuario ON DELETE RESTRICT
    );
    CREATE INDEX comentario_tarea_idx ON app.comentario (tarea_id);

    -- RN-19: una fila por registro y usuario; el total es la suma.
    CREATE TABLE app.registro_esfuerzo (
      id uuid PRIMARY KEY,
      estacion_metodologia_id uuid NOT NULL REFERENCES app.estacion_metodologia ON DELETE RESTRICT,
      usuario_id uuid NOT NULL REFERENCES app.usuario ON DELETE RESTRICT,
      fase text NOT NULL,
      cantidad numeric NOT NULL CHECK (cantidad >= 0),
      fecha date NOT NULL,
      evento_id uuid NOT NULL UNIQUE REFERENCES app.evento ON DELETE RESTRICT,
      creado_en timestamptz NOT NULL DEFAULT now(),
      creado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      actualizado_en timestamptz NOT NULL DEFAULT now(),
      actualizado_por uuid REFERENCES app.usuario ON DELETE RESTRICT
    );
    CREATE INDEX registro_esfuerzo_em_idx ON app.registro_esfuerzo (estacion_metodologia_id);

    CREATE TABLE app.jornada (
      id uuid PRIMARY KEY,
      usuario_id uuid NOT NULL REFERENCES app.usuario ON DELETE RESTRICT,
      abierta_en timestamptz NOT NULL,
      cerrada_en timestamptz,
      cierre_automatico boolean NOT NULL DEFAULT false,
      creado_en timestamptz NOT NULL DEFAULT now(),
      creado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      actualizado_en timestamptz NOT NULL DEFAULT now(),
      actualizado_por uuid REFERENCES app.usuario ON DELETE RESTRICT,
      CHECK (cerrada_en IS NULL OR cerrada_en >= abierta_en)
    );
    CREATE INDEX jornada_usuario_idx ON app.jornada (usuario_id, abierta_en);
  `.execute(db);

  // Trigger de actualizado_en en todas las tablas que tienen la columna.
  await sql`
    DO $$
    DECLARE t text;
    BEGIN
      FOR t IN
        SELECT table_name FROM information_schema.columns
         WHERE table_schema = 'app' AND column_name = 'actualizado_en'
      LOOP
        EXECUTE format(
          'CREATE TRIGGER %I BEFORE UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.tocar_actualizado_en()',
          t || '_actualizado_en', t
        );
      END LOOP;
    END $$;
  `.execute(db);

  // Sin borrado físico de datos de campo: la API y el worker no tienen DELETE ni TRUNCATE.
  // evento además no admite UPDATE (SEG-14).
  await sql`
    REVOKE DELETE, TRUNCATE ON ALL TABLES IN SCHEMA app FROM app_rw, worker_rw;
    REVOKE UPDATE ON app.evento FROM app_rw, worker_rw;
  `.execute(db);
}
