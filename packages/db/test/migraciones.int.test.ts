import { ESTADOS_ARCHIVO, ESTADOS_ASIGNACION, ESTADOS_EVENTO, ESTADOS_TAREA } from '@campo/core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aplicarMigraciones } from '../src/migraciones.ts';
import { CARPETA_MIGRACIONES, iniciarBaseDePrueba, type BaseDePrueba } from '../src/pruebas.ts';

let base: BaseDePrueba;
let migrador: pg.Client;
let appRw: pg.Client;

const url = (rol: 'app_migrator' | 'app_rw'): string => base.url(rol);

const conectar = async (rol: 'app_migrator' | 'app_rw'): Promise<pg.Client> => {
  const c = new pg.Client({ connectionString: url(rol) });
  await c.connect();
  return c;
};

// Ids fijos (UUID v7 sintéticos) para los datos de prueba.
const id = (n: number): string => `0192f0c8-0000-7000-8000-${n.toString().padStart(12, '0')}`;
const U = { supervisor: id(1), especialista: id(2), otro: id(3) };
const PROY = id(10);
const CUAD = id(20);
const CUADERNO = id(30);
const DISP = id(40);
const DISP_OTRO = id(41);

beforeAll(async () => {
  base = await iniciarBaseDePrueba();
  migrador = await conectar('app_migrator');
  appRw = await conectar('app_rw');

  await appRw.query(
    `INSERT INTO usuario (id, tipo_documento, num_documento, nombre, rol_global) VALUES
       ($1, 'DNI', '10000001', 'Supervisora Sintética', 'supervisor'),
       ($2, 'DNI', '10000002', 'Especialista Sintético', 'ninguno'),
       ($3, 'DNI', '10000003', 'Otro Especialista', 'ninguno')`,
    [U.supervisor, U.especialista, U.otro],
  );
  await appRw.query(
    `INSERT INTO proyecto (id, nombre, validacion_activa) VALUES ($1, 'Línea base sintética', false)`,
    [PROY],
  );
  await appRw.query(
    `INSERT INTO brigada (id, proyecto_id, nombre) VALUES ($1, $2, 'Brigada A')`,
    [CUAD, PROY],
  );
  await appRw.query(
    `INSERT INTO cuaderno (id, proyecto_id, brigada_id, responsable_id, titulo)
     VALUES ($1, $2, $3, $4, 'Cuaderno 1')`,
    [CUADERNO, PROY, CUAD, U.especialista],
  );
  await appRw.query(
    `INSERT INTO dispositivo (id, usuario_id, plataforma, llave_publica, version_app) VALUES
       ($1, $2, 'android', 'llave-sintetica', '0.1.0'),
       ($3, $4, 'ios', 'llave-sintetica-2', '0.1.0')`,
    [DISP, U.especialista, DISP_OTRO, U.otro],
  );
});

afterAll(async () => {
  await appRw.end();
  await migrador.end();
  await base.detener();
});

let secuencia = 1000;
interface DatosTarea {
  proyecto_id?: string;
  origen?: 'manual' | 'regla';
  regla_id?: string | null;
  clave_dedup?: string | null;
}

const nuevaTarea = async (extra: DatosTarea = {}): Promise<string> => {
  const tareaId = id(secuencia++);
  await appRw.query(
    `INSERT INTO tarea (id, proyecto_id, cuaderno_id, origen, regla_id, clave_dedup, tipo, titulo)
     VALUES ($1, $2, $3, $4, $5, $6, 'tecnica', 'Tarea sintética')`,
    [
      tareaId,
      extra.proyecto_id ?? PROY,
      CUADERNO,
      extra.origen ?? 'manual',
      extra.regla_id ?? null,
      extra.clave_dedup ?? null,
    ],
  );
  return tareaId;
};

const nuevaAsignacion = (tareaId: string, usuario = U.especialista, disp = DISP) =>
  appRw.query(
    `INSERT INTO asignacion (id, tarea_id, usuario_id, dispositivo_id, descargada_en)
     VALUES ($1, $2, $3, $4, now())`,
    [id(secuencia++), tareaId, usuario, disp],
  );

const nuevoEvento = async (estado = 'aplicado', motivo: string | null = null): Promise<string> => {
  const eventoId = id(secuencia++);
  await appRw.query(
    `INSERT INTO evento (id, tipo, version_esquema, usuario_id, dispositivo_id, entidad_tipo,
                         entidad_id, payload, hora_dispositivo, estado, motivo)
     VALUES ($1, 'comentario_creado', 1, $2, $3, 'tarea', $4, '{}', now(), $5, $6)`,
    [eventoId, U.especialista, DISP, id(9999), estado, motivo],
  );
  return eventoId;
};

/** Código SQLSTATE del error que lanza la promesa. */
const codigoError = async (p: Promise<unknown>): Promise<string | undefined> => {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code;
  }
};

describe('migraciones', () => {
  it('volver a migrar no aplica nada (solo hacia adelante, idempotente)', async () => {
    const mensajes: string[] = [];
    const ok = await aplicarMigraciones(url('app_migrator'), CARPETA_MIGRACIONES, {
      log: (m) => mensajes.push(m),
      error: () => undefined,
    });
    expect(ok).toBe(true);
    expect(mensajes).toEqual(['Sin migraciones pendientes.']);
  });

  it.each([
    ['tarea', 'estado', ESTADOS_TAREA],
    ['asignacion', 'estado', ESTADOS_ASIGNACION],
    ['evento', 'estado', ESTADOS_EVENTO],
    ['archivo', 'estado', ESTADOS_ARCHIVO],
  ] as const)(
    'el CHECK de %s.%s coincide con los estados de core',
    async (tabla, columna, estados) => {
      const { rows } = await migrador.query<{ def: string }>(
        `SELECT pg_get_constraintdef(c.oid) AS def
         FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = $1 AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE $2`,
        [tabla, `CHECK ((${columna} = ANY%`],
      );
      expect(rows).toHaveLength(1);
      const enBd = [...(rows[0]?.def ?? '').matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);
      expect(enBd.sort()).toEqual([...estados].sort());
    },
  );
});

describe('invariantes en la base de datos', () => {
  it('RN-02 una tarea no puede tener dos asignaciones vigentes', async () => {
    const tarea = await nuevaTarea();
    await nuevaAsignacion(tarea);
    expect(await codigoError(nuevaAsignacion(tarea, U.otro, DISP_OTRO))).toBe('23505');
  });

  it('RN-02 tras revocar con motivo se puede crear otra asignación vigente', async () => {
    const tarea = await nuevaTarea();
    await nuevaAsignacion(tarea);
    await appRw.query(
      `UPDATE asignacion SET estado = 'revocada', motivo_revocacion = 'Reasignación'
        WHERE tarea_id = $1 AND estado = 'vigente'`,
      [tarea],
    );
    await expect(nuevaAsignacion(tarea, U.otro, DISP_OTRO)).resolves.toBeDefined();
  });

  it('RN-07 CP-032 una asignación no se revoca sin motivo', async () => {
    const tarea = await nuevaTarea();
    await nuevaAsignacion(tarea);
    const r = appRw.query(`UPDATE asignacion SET estado = 'revocada' WHERE tarea_id = $1`, [tarea]);
    expect(await codigoError(r)).toBe('23514');
  });

  it('RN-22 CP-049 la misma clave de deduplicación no crea dos tareas en el proyecto', async () => {
    const regla = id(secuencia++);
    await appRw.query(
      `INSERT INTO regla_alerta (id, proyecto_id, tipo, condicion, severidad, ambito, responsable_rol)
       VALUES ($1, $2, 'checklist_incompleto', '{}', 'media', 'local', 'jefe')`,
      [regla, PROY],
    );
    const extra: DatosTarea = {
      origen: 'regla',
      regla_id: regla,
      clave_dedup: 'regla:entidad:2026-11-05',
    };
    await nuevaTarea(extra);
    expect(await codigoError(nuevaTarea(extra))).toBe('23505');
  });

  it('RN-22 una tarea por regla exige su clave de deduplicación', async () => {
    expect(await codigoError(nuevaTarea({ origen: 'regla', regla_id: null }))).toBe('23514');
  });

  it('la tarea pertenece al mismo proyecto que su cuaderno', async () => {
    const otroProyecto = id(secuencia++);
    await appRw.query(
      `INSERT INTO proyecto (id, nombre, validacion_activa) VALUES ($1, 'Otro proyecto', true)`,
      [otroProyecto],
    );
    expect(await codigoError(nuevaTarea({ proyecto_id: otroProyecto }))).toBe('23503');
  });

  it('rechaza un estado de tarea desconocido', async () => {
    const tarea = await nuevaTarea();
    const r = appRw.query(`UPDATE tarea SET estado = 'en_revision' WHERE id = $1`, [tarea]);
    expect(await codigoError(r)).toBe('23514');
  });

  it('RN-12 un evento no aplicado exige motivo', async () => {
    expect(await codigoError(nuevoEvento('no_aplicado', null))).toBe('23514');
    await expect(nuevoEvento('no_aplicado', 'TAREA_CERRADA')).resolves.toBeDefined();
  });

  it('RN-10 reenviar un evento con el mismo id no lo duplica', async () => {
    const eventoId = await nuevoEvento();
    const r = appRw.query(
      `INSERT INTO evento (id, tipo, version_esquema, usuario_id, entidad_tipo, entidad_id, payload, estado)
       VALUES ($1, 'comentario_creado', 1, $2, 'tarea', $3, '{}', 'aplicado')`,
      [eventoId, U.especialista, id(9999)],
    );
    expect(await codigoError(r)).toBe('23505');
  });

  it('actualizado_en se renueva al modificar una fila', async () => {
    const tarea = await nuevaTarea();
    const antes = await appRw.query<{ t: Date }>(
      `SELECT actualizado_en t FROM tarea WHERE id = $1`,
      [tarea],
    );
    await appRw.query(`UPDATE tarea SET titulo = 'Cambiada' WHERE id = $1`, [tarea]);
    const despues = await appRw.query<{ t: Date }>(
      `SELECT actualizado_en t FROM tarea WHERE id = $1`,
      [tarea],
    );
    expect(despues.rows[0]?.t.getTime()).toBeGreaterThan(antes.rows[0]?.t.getTime() ?? Infinity);
  });
});

describe('SEG-14 inmutabilidad de evento', () => {
  it('SEG-14 app_rw no puede actualizar eventos', async () => {
    const eventoId = await nuevoEvento();
    const r = appRw.query(`UPDATE evento SET payload = '{"x":1}' WHERE id = $1`, [eventoId]);
    expect(await codigoError(r)).toBe('42501');
  });

  it('SEG-14 app_rw no puede borrar eventos', async () => {
    const eventoId = await nuevoEvento();
    expect(await codigoError(appRw.query(`DELETE FROM evento WHERE id = $1`, [eventoId]))).toBe(
      '42501',
    );
  });

  it('SEG-14 ni siquiera el dueño de la tabla puede modificar, borrar o vaciar eventos', async () => {
    const eventoId = await nuevoEvento();
    const upd = migrador.query(`UPDATE evento SET payload = '{}' WHERE id = $1`, [eventoId]);
    expect(await codigoError(upd)).toBe('42501');
    expect(await codigoError(migrador.query(`DELETE FROM evento WHERE id = $1`, [eventoId]))).toBe(
      '42501',
    );
    expect(await codigoError(migrador.query(`TRUNCATE evento CASCADE`))).toBe('42501');
  });

  it('SEG-14 el dueño no puede saltarse el trigger fijando la variable de resolución', async () => {
    const eventoId = await nuevoEvento('duplicado', 'DUPLICADO');
    await migrador.query('BEGIN');
    try {
      await migrador.query(`SELECT set_config('app.resolviendo_evento', 'si', true)`);
      const r = migrador.query(
        `UPDATE evento SET payload = '{"x":1}', estado = 'resuelto_elegido',
                                  resuelto_por = $2, resuelto_en = now() WHERE id = $1`,
        [eventoId, U.supervisor],
      );
      expect(await codigoError(r)).toBe('42501');
    } finally {
      await migrador.query('ROLLBACK');
    }
  });

  it('RN-08 SEG-14 un evento duplicado se resuelve solo con la función controlada', async () => {
    const eventoId = await nuevoEvento('duplicado', 'DUPLICADO');
    await appRw.query(`SELECT resolver_evento($1, 'resuelto_elegido', $2, 'Versión correcta')`, [
      eventoId,
      U.supervisor,
    ]);
    const { rows } = await appRw.query<{ estado: string; resuelto_por: string; payload: unknown }>(
      `SELECT estado, resuelto_por, payload FROM evento WHERE id = $1`,
      [eventoId],
    );
    expect(rows[0]).toMatchObject({
      estado: 'resuelto_elegido',
      resuelto_por: U.supervisor,
      payload: {},
    });
  });

  it('SEG-14 no se puede resolver un evento ya aplicado ni volver a resolverlo', async () => {
    const aplicado = await nuevoEvento();
    const r1 = appRw.query(`SELECT resolver_evento($1, 'resuelto_descartado', $2, null)`, [
      aplicado,
      U.supervisor,
    ]);
    expect(await codigoError(r1)).toBe('P0002');

    const duplicado = await nuevoEvento('en_revision', 'ASIGNACION_REVOCADA');
    await appRw.query(`SELECT resolver_evento($1, 'resuelto_descartado', $2, null)`, [
      duplicado,
      U.supervisor,
    ]);
    const r2 = appRw.query(`SELECT resolver_evento($1, 'resuelto_elegido', $2, null)`, [
      duplicado,
      U.supervisor,
    ]);
    expect(await codigoError(r2)).toBe('P0002');
  });

  it('SEG-14 la función rechaza un estado de resolución inválido', async () => {
    const eventoId = await nuevoEvento('duplicado', 'DUPLICADO');
    const r = appRw.query(`SELECT resolver_evento($1, 'aplicado', $2, null)`, [
      eventoId,
      U.supervisor,
    ]);
    expect(await codigoError(r)).toBe('23514');
  });
});

describe('sin borrado físico de datos de campo', () => {
  it.each(['tarea', 'asignacion', 'archivo', 'registro_esfuerzo', 'usuario'])(
    'app_rw no puede borrar en %s',
    async (tabla) => {
      expect(await codigoError(appRw.query(`DELETE FROM ${tabla} WHERE false`))).toBe('42501');
    },
  );

  it('app_rw no puede crear tablas ni cambiar el esquema', async () => {
    expect(await codigoError(appRw.query(`CREATE TABLE intrusa (i int)`))).toBe('42501');
  });
});
