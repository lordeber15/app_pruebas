import { promises as fs } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aplicarMigraciones } from '../src/migraciones.ts';
import { CARPETA_MIGRACIONES, iniciarBaseDePrueba, type BaseDePrueba } from '../src/pruebas.ts';

/**
 * Migración `2026-11-07T03_terminos_toce` sobre datos del modelo anterior (los de una instalación
 * existente, como la demo en el VPS): no se pierde nada y todo queda con los términos TOCE.
 */
const MIGRACION = '2026-11-07T03_terminos_toce.ts';
const id = (n: number): string => `0192f0c8-0000-7000-8000-${n.toString().padStart(12, '0')}`;
const U = { supervisor: id(1), jefe: id(2), logistico: id(3), especialista: id(4), admin: id(5) };
const PROY = id(10);
const BRIGADA = id(20);
const CUADERNO = id(30);
const TAREA = id(40);
const ESTACION = id(50);

let base: BaseDePrueba;
let carpetaPrevia: string;
let db: pg.Client;

beforeAll(async () => {
  // Las migraciones anteriores a la T03, en una carpeta dentro del paquete (para resolver kysely).
  carpetaPrevia = await fs.mkdtemp(path.join(import.meta.dirname, '.migraciones-'));
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta fija del repositorio
  for (const f of await fs.readdir(CARPETA_MIGRACIONES)) {
    if (f < MIGRACION)
      await fs.copyFile(path.join(CARPETA_MIGRACIONES, f), path.join(carpetaPrevia, f));
  }
  base = await iniciarBaseDePrueba(carpetaPrevia);
  db = new pg.Client({ connectionString: base.url('app_rw') });
  await db.connect();

  await db.query(
    `INSERT INTO usuario (id, tipo_documento, num_documento, nombre, rol_global) VALUES
       ($1, 'DNI', '20000001', 'Supervisora', 'supervisor'),
       ($2, 'DNI', '20000002', 'Jefe', 'ninguno'),
       ($3, 'DNI', '20000003', 'Logístico', 'ninguno'),
       ($4, 'DNI', '20000004', 'Especialista', 'ninguno'),
       ($5, 'DNI', '20000005', 'Administrador', 'admin')`,
    [U.supervisor, U.jefe, U.logistico, U.especialista, U.admin],
  );
  await db.query(`INSERT INTO proyecto (id, nombre, validacion_activa) VALUES ($1, 'P', false)`, [
    PROY,
  ]);
  await db.query(
    `INSERT INTO brigada (id, proyecto_id, nombre, jefe_id) VALUES ($1, $2, 'B', $3)`,
    [BRIGADA, PROY, U.jefe],
  );
  await db.query(
    `INSERT INTO miembro_brigada (id, brigada_id, usuario_id, rol) VALUES
       ($1, $3, $4, 'logistico'), ($2, $3, $5, 'especialista')`,
    [id(21), id(22), BRIGADA, U.logistico, U.especialista],
  );
  await db.query(
    `INSERT INTO cuaderno (id, proyecto_id, brigada_id, responsable_id, titulo)
     VALUES ($1, $2, $3, $4, 'C')`,
    [CUADERNO, PROY, BRIGADA, U.especialista],
  );
  await db.query(
    `INSERT INTO estacion (id, proyecto_id, codigo, geom)
     VALUES ($1, $2, 'E-1', ST_SetSRID(ST_MakePoint(-77, -12), 4326))`,
    [ESTACION, PROY],
  );
  await db.query(
    `INSERT INTO tarea (id, proyecto_id, cuaderno_id, origen, tipo, titulo, estado, estacion_id)
     VALUES ($1, $2, $3, 'manual', 'tecnica', 'T', 'completada', $4)`,
    [TAREA, PROY, CUADERNO, ESTACION],
  );
  await db.end();

  const ok = await aplicarMigraciones(base.url('app_migrator'), CARPETA_MIGRACIONES, {
    log: () => undefined,
    error: () => undefined,
  });
  expect(ok).toBe(true);
  db = new pg.Client({ connectionString: base.url('app_rw') });
  await db.connect();
});

afterAll(async () => {
  await db.end();
  await base.detener();
  await fs.rm(carpetaPrevia, { recursive: true, force: true });
});

describe('2026-11-07T03 solo términos TOCE', () => {
  it('la tarea pasa a ser una reserva con sus datos intactos', async () => {
    const { rows } = await db.query<{ titulo: string; estado: string; cuaderno_id: string }>(
      `SELECT titulo, estado, cuaderno_id FROM reserva WHERE id = $1`,
      [TAREA],
    );
    expect(rows).toEqual([{ titulo: 'T', estado: 'completada', cuaderno_id: CUADERNO }]);
    const vieja = await db.query(`SELECT to_regclass('app.tarea') AS t`);
    expect(vieja.rows[0]).toEqual({ t: null });
  });

  it('el supervisor global pasa a Coordinación y el administrador se conserva', async () => {
    const { rows } = await db.query<{ id: string; rol_global: string }>(
      `SELECT id, rol_global FROM usuario WHERE id = ANY($1) ORDER BY id`,
      [[U.supervisor, U.admin]],
    );
    expect(rows).toEqual([
      { id: U.supervisor, rol_global: 'coordinacion' },
      { id: U.admin, rol_global: 'admin' },
    ]);
  });

  it('el logístico y el jefe de la brigada quedan como Jefe de Brigada; el especialista sigue igual', async () => {
    const { rows } = await db.query<{ usuario_id: string; rol: string }>(
      `SELECT usuario_id, rol FROM miembro_brigada WHERE brigada_id = $1 ORDER BY usuario_id`,
      [BRIGADA],
    );
    expect(rows).toEqual([
      { usuario_id: U.jefe, rol: 'jefe_brigada' },
      { usuario_id: U.logistico, rol: 'jefe_brigada' },
      { usuario_id: U.especialista, rol: 'especialista' },
    ]);
  });

  it('nada se borró: el cuaderno sigue en su tabla, sin uso', async () => {
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM cuaderno`);
    expect(rows[0]).toEqual({ n: 1 });
  });

  it('una reserva nueva ya no exige los campos del modelo anterior', async () => {
    await expect(
      db.query(
        `INSERT INTO reserva (id, proyecto_id, estacion_id, titulo, estado) VALUES ($1, $2, $3, 'R', 'pendiente')`,
        [id(41), PROY, ESTACION],
      ),
    ).resolves.toBeDefined();
  });
});
