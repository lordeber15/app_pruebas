import {
  ESTADOS_ARCHIVO,
  ESTADOS_EJECUCION,
  ESTADOS_EVENTO,
  ESTADOS_RESERVA,
  ROLES_BRIGADA,
  VALORES_ROL_GLOBAL,
} from '@campo/core';
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
const U = { coordinacion: id(1), especialista: id(2), otro: id(3) };
const PROY = id(10);
const BRIGADA = id(20);
const ESTACION = id(30);
const METODO = id(31);
const DISP = id(40);
const DISP_OTRO = id(41);

beforeAll(async () => {
  base = await iniciarBaseDePrueba();
  migrador = await conectar('app_migrator');
  appRw = await conectar('app_rw');

  await appRw.query(
    `INSERT INTO usuario (id, tipo_documento, num_documento, nombre, rol_global) VALUES
       ($1, 'DNI', '10000001', 'Coordinadora Sintética', 'coordinacion'),
       ($2, 'DNI', '10000002', 'Especialista Sintético', 'ninguno'),
       ($3, 'DNI', '10000003', 'Otro Especialista', 'ninguno')`,
    [U.coordinacion, U.especialista, U.otro],
  );
  await appRw.query(
    `INSERT INTO proyecto (id, nombre, validacion_activa) VALUES ($1, 'Línea base sintética', false)`,
    [PROY],
  );
  await appRw.query(`INSERT INTO brigada (id, proyecto_id, nombre) VALUES ($1, $2, 'Brigada A')`, [
    BRIGADA,
    PROY,
  ]);
  await appRw.query(
    `INSERT INTO estacion (id, proyecto_id, codigo, geom)
     VALUES ($1, $2, 'EST-01', ST_SetSRID(ST_MakePoint(-77, -12), 4326))`,
    [ESTACION, PROY],
  );
  const conf = id(32);
  const esp = id(33);
  await appRw.query(
    `INSERT INTO configuracion_metodologica (id, proyecto_id, numero, origen)
     VALUES ($1, $2, 1, 'prueba')`,
    [conf, PROY],
  );
  await appRw.query(
    `INSERT INTO especialidad (id, proyecto_id, codigo, nombre, es_fauna) VALUES ($1, $2, 'aves', 'Aves', true)`,
    [esp, PROY],
  );
  await appRw.query(
    `INSERT INTO metodo (id, configuracion_id, especialidad_id, codigo, nombre, clase, tipo_geometria, config)
     VALUES ($1, $2, $3, 'aves.puntos', 'Puntos de conteo', 'todas', 'punto', '{}')`,
    [METODO, conf, esp],
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

const nuevaReserva = async (estacion = ESTACION, metodo = METODO): Promise<string> => {
  const reservaId = id(secuencia++);
  await appRw.query(
    `INSERT INTO reserva (id, proyecto_id, estacion_id, metodo_id, brigada_id, titulo, estado)
     VALUES ($1, $2, $3, $4, $5, 'EST-01 · Puntos de conteo', 'asignada')`,
    [reservaId, PROY, estacion, metodo, BRIGADA],
  );
  return reservaId;
};

const nuevaEjecucion = (reservaId: string | null, extra: { desviacion?: string } = {}) =>
  appRw.query(
    `INSERT INTO ejecucion (id, proyecto_id, reserva_id, brigada_id, estacion_id, metodo_id,
                            usuario_id, dispositivo_id, abierta_en, desviacion_tipo)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9)`,
    [
      id(secuencia++),
      PROY,
      reservaId,
      BRIGADA,
      ESTACION,
      METODO,
      U.especialista,
      DISP,
      extra.desviacion ?? 'ninguna',
    ],
  );

const nuevoEvento = async (estado = 'aplicado', motivo: string | null = null): Promise<string> => {
  const eventoId = id(secuencia++);
  await appRw.query(
    `INSERT INTO evento (id, tipo, version_esquema, usuario_id, dispositivo_id, entidad_tipo,
                         entidad_id, payload, hora_dispositivo, estado, motivo)
     VALUES ($1, 'unidad_guardada', 1, $2, $3, 'unidad', $4, '{}', now(), $5, $6)`,
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

  const valoresDelCheck = async (tabla: string, columna: string): Promise<string[]> => {
    const { rows } = await migrador.query<{ def: string }>(
      `SELECT pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = $1 AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE $2`,
      [tabla, `CHECK ((${columna} = ANY%`],
    );
    expect(rows).toHaveLength(1);
    return [...(rows[0]?.def ?? '').matchAll(/'([a-z_]+)'::text/g)].flatMap((m) =>
      m[1] === undefined ? [] : [m[1]],
    );
  };

  it.each([
    ['evento', 'estado', ESTADOS_EVENTO],
    ['archivo', 'estado', ESTADOS_ARCHIVO],
    ['ejecucion', 'estado', ESTADOS_EJECUCION],
    ['usuario', 'rol_global', VALORES_ROL_GLOBAL],
    ['miembro_brigada', 'rol', ROLES_BRIGADA],
  ] as const)('el CHECK de %s.%s coincide con core', async (tabla, columna, valores) => {
    expect((await valoresDelCheck(tabla, columna)).sort()).toEqual([...valores].sort());
  });

  it('los estados de reserva de core caben en el CHECK (que conserva los del modelo anterior)', async () => {
    expect(await valoresDelCheck('reserva', 'estado')).toEqual(
      expect.arrayContaining([...ESTADOS_RESERVA]),
    );
  });

  it('las tablas del modelo vigente no conservan nombres del modelo anterior', async () => {
    const { rows } = await migrador.query<{ nombre: string }>(
      `SELECT t.relname || '.' || coalesce(a.attname, '') AS nombre
         FROM pg_class t
         JOIN pg_namespace n ON n.oid = t.relnamespace
         LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
        WHERE n.nspname = 'app' AND t.relkind = 'r'
          AND (t.relname ~ 'tarea|cuadrilla' OR a.attname ~ 'tarea|cuadrilla')
          AND t.relname <> ALL (ARRAY['asignacion', 'comentario', 'evidencia_item', 'cuaderno'])`,
    );
    expect(rows.map((r) => r.nombre)).toEqual([]);
  });
});

describe('invariantes en la base de datos', () => {
  it('una sola reserva por estación × método', async () => {
    const otraEstacion = id(secuencia++);
    await appRw.query(
      `INSERT INTO estacion (id, proyecto_id, codigo, geom)
       VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint(-77.1, -12.1), 4326))`,
      [otraEstacion, PROY, `EST-${String(secuencia)}`],
    );
    await nuevaReserva(otraEstacion);
    expect(await codigoError(nuevaReserva(otraEstacion))).toBe('23505');
  });

  it('RN-19 varios especialistas registran su propia ejecución sobre la misma reserva', async () => {
    const reserva = await nuevaReserva();
    await nuevaEjecucion(reserva);
    await expect(nuevaEjecucion(reserva)).resolves.toBeDefined();
  });

  it('RN-40 un EVENTO se registra sin reserva', async () => {
    await expect(nuevaEjecucion(null)).resolves.toBeDefined();
  });

  it('RF-M11 E-06 una desviación declarada exige explicación', async () => {
    expect(await codigoError(nuevaEjecucion(null, { desviacion: 'parcial' }))).toBe('23514');
  });

  it('los roles del modelo anterior ya no se aceptan', async () => {
    const r1 = appRw.query(`UPDATE usuario SET rol_global = 'supervisor' WHERE id = $1`, [
      U.coordinacion,
    ]);
    expect(await codigoError(r1)).toBe('23514');
    const r2 = appRw.query(
      `INSERT INTO miembro_brigada (id, brigada_id, usuario_id, rol) VALUES ($1, $2, $3, 'logistico')`,
      [id(secuencia++), BRIGADA, U.otro],
    );
    expect(await codigoError(r2)).toBe('23514');
  });

  it('RN-12 un evento no aplicado exige motivo', async () => {
    expect(await codigoError(nuevoEvento('no_aplicado', null))).toBe('23514');
    await expect(nuevoEvento('no_aplicado', 'EJECUCION_AJENA')).resolves.toBeDefined();
  });

  it('RN-10 reenviar un evento con el mismo id no lo duplica', async () => {
    const eventoId = await nuevoEvento();
    const r = appRw.query(
      `INSERT INTO evento (id, tipo, version_esquema, usuario_id, entidad_tipo, entidad_id, payload, estado)
       VALUES ($1, 'unidad_guardada', 1, $2, 'unidad', $3, '{}', 'aplicado')`,
      [eventoId, U.especialista, id(9999)],
    );
    expect(await codigoError(r)).toBe('23505');
  });

  it('actualizado_en se renueva al modificar una fila', async () => {
    const otraEstacion = id(secuencia++);
    await appRw.query(
      `INSERT INTO estacion (id, proyecto_id, codigo, geom)
       VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint(-77.2, -12.2), 4326))`,
      [otraEstacion, PROY, `EST-${String(secuencia)}`],
    );
    const reserva = await nuevaReserva(otraEstacion);
    const antes = await appRw.query<{ t: Date }>(
      `SELECT actualizado_en t FROM reserva WHERE id = $1`,
      [reserva],
    );
    await appRw.query(`UPDATE reserva SET titulo = 'Cambiada' WHERE id = $1`, [reserva]);
    const despues = await appRw.query<{ t: Date }>(
      `SELECT actualizado_en t FROM reserva WHERE id = $1`,
      [reserva],
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
        [eventoId, U.coordinacion],
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
      U.coordinacion,
    ]);
    const { rows } = await appRw.query<{ estado: string; resuelto_por: string; payload: unknown }>(
      `SELECT estado, resuelto_por, payload FROM evento WHERE id = $1`,
      [eventoId],
    );
    expect(rows[0]).toMatchObject({
      estado: 'resuelto_elegido',
      resuelto_por: U.coordinacion,
      payload: {},
    });
  });

  it('SEG-14 no se puede resolver un evento ya aplicado ni volver a resolverlo', async () => {
    const aplicado = await nuevoEvento();
    const r1 = appRw.query(`SELECT resolver_evento($1, 'resuelto_descartado', $2, null)`, [
      aplicado,
      U.coordinacion,
    ]);
    expect(await codigoError(r1)).toBe('P0002');

    const duplicado = await nuevoEvento('en_revision', 'EJECUCION_CERRADA');
    await appRw.query(`SELECT resolver_evento($1, 'resuelto_descartado', $2, null)`, [
      duplicado,
      U.coordinacion,
    ]);
    const r2 = appRw.query(`SELECT resolver_evento($1, 'resuelto_elegido', $2, null)`, [
      duplicado,
      U.coordinacion,
    ]);
    expect(await codigoError(r2)).toBe('P0002');
  });

  it('SEG-14 la función rechaza un estado de resolución inválido', async () => {
    const eventoId = await nuevoEvento('duplicado', 'DUPLICADO');
    const r = appRw.query(`SELECT resolver_evento($1, 'aplicado', $2, null)`, [
      eventoId,
      U.coordinacion,
    ]);
    expect(await codigoError(r)).toBe('23514');
  });
});

describe('sin borrado físico de datos de campo', () => {
  it.each(['reserva', 'ejecucion', 'unidad', 'track', 'archivo', 'alerta', 'usuario'])(
    'app_rw no puede borrar en %s',
    async (tabla) => {
      expect(await codigoError(appRw.query(`DELETE FROM ${tabla} WHERE false`))).toBe('42501');
    },
  );

  it('app_rw no puede crear tablas ni cambiar el esquema', async () => {
    expect(await codigoError(appRw.query(`CREATE TABLE intrusa (i int)`))).toBe('42501');
  });
});
