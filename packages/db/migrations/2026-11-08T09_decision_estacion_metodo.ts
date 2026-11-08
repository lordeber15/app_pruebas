import { sql, type Kysely } from 'kysely';

/**
 * Decisión nominal estación–método desde la web (panel «Métodos a ejecutar», decisión del
 * usuario 2026-11-08; RN-28, P-01). Solo expande.
 *
 * - `reserva.estado` admite `descartada`: un CONDICIONAL descartado conserva su reserva (nada se
 *   borra), pero deja de ir al paquete de campo y no cuenta en el avance.
 * - `estacion_metodo_decision`: historial de solo inserción de cada confirmación o descarte, con
 *   quién, cuándo, motivo y el estado anterior de la fila (auditoría). La fila de la matriz pasa a
 *   `origen = 'nominal'`, que la rederivación automática nunca pisa.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE app.reserva DROP CONSTRAINT reserva_estado_check;
    ALTER TABLE app.reserva ADD CONSTRAINT reserva_estado_check CHECK (estado IN (
      'pendiente', 'asignada', 'descargada', 'en_transito',
      'completada', 'validada', 'observada', 'cerrada', 'descartada'
    ));

    CREATE TABLE app.estacion_metodo_decision (
      id uuid PRIMARY KEY,
      estacion_metodo_id uuid NOT NULL REFERENCES app.estacion_metodo ON DELETE RESTRICT,
      decision text NOT NULL CHECK (decision IN ('confirmar', 'descartar')),
      motivo text NOT NULL CHECK (length(trim(motivo)) BETWEEN 3 AND 500),
      habilitado_anterior boolean NOT NULL,
      origen_anterior text NOT NULL CHECK (origen_anterior IN ('clase', 'condicion', 'nominal')),
      condicion_pendiente_anterior boolean NOT NULL,
      reserva_id uuid REFERENCES app.reserva ON DELETE RESTRICT,
      creado_en timestamptz NOT NULL DEFAULT now(),
      creado_por uuid NOT NULL REFERENCES app.usuario ON DELETE RESTRICT
    );
    CREATE INDEX estacion_metodo_decision_fila_idx
      ON app.estacion_metodo_decision (estacion_metodo_id, creado_en DESC);
    -- Historial: solo inserción.
    REVOKE UPDATE, DELETE, TRUNCATE ON app.estacion_metodo_decision FROM app_rw, worker_rw;
  `.execute(db);
}
