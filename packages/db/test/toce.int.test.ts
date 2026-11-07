import {
  contarPorClase,
  ESTADOS_ALERTA,
  ESTADOS_EJECUCION,
  ESTADOS_FILA_CRONOGRAMA,
  ESTADOS_SOLICITUD_CRONOGRAMA,
  TIPOS_ACTIVIDAD_CRONOGRAMA,
} from '@campo/core';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { iniciarBaseDePrueba, type BaseDePrueba } from '../src/pruebas.ts';
import { cargarToce, leerSemillaD01, type ResumenCargaToce } from '../src/semillas/toce.ts';

const PROY = '0192f0c8-0000-7000-8000-000000000010';

let base: BaseDePrueba;
let db: Kysely<unknown>;
let migrador: pg.Client;
let resumen: ResumenCargaToce;

const uno = async <T>(q: ReturnType<typeof sql<T>>): Promise<T> => {
  const r = await q.execute(db);
  const fila = r.rows[0];
  if (fila === undefined) throw new Error('sin filas');
  return fila;
};
const n = async (q: ReturnType<typeof sql<{ n: string }>>): Promise<number> =>
  Number((await uno(q)).n);

/** Estado de la matriz para un método en una estación. */
const matriz = (estacion: string, metodo: string) =>
  uno(sql<{ habilitado: boolean; origen: string; condicion_pendiente: boolean }>`
    SELECT em.habilitado, em.origen, em.condicion_pendiente
      FROM app.estacion_metodo em
      JOIN app.estacion e ON e.id = em.estacion_id
      JOIN app.metodo m ON m.id = em.metodo_id
     WHERE e.codigo = ${estacion} AND m.codigo = ${metodo}`);

beforeAll(async () => {
  base = await iniciarBaseDePrueba();
  migrador = new pg.Client({ connectionString: base.url('app_migrator') });
  await migrador.connect();
  db = new Kysely<unknown>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString: base.url('app_rw'), max: 2 }),
    }),
  });
  await sql`INSERT INTO app.proyecto (id, nombre, validacion_activa) VALUES (${PROY}, 'TOCE', false)`.execute(
    db,
  );
  resumen = await cargarToce(db, { proyectoId: PROY });
});

afterAll(async () => {
  await db.destroy();
  await migrador.end();
  await base.detener();
});

describe('semilla D01 (configuración por método)', () => {
  it('QA-02: 33 métodos en 14 TODAS / 14 CONDICIONAL / 3 EVENTO / 1 ATRIBUTO / 1 TRANSVERSAL', async () => {
    const d01 = await leerSemillaD01();
    expect(d01.metodos).toHaveLength(33);
    expect(contarPorClase(d01.metodos)).toEqual({
      todas: 14,
      condicional: 14,
      evento: 3,
      atributo: 1,
      transversal: 1,
    });
    expect(d01.especialidades).toHaveLength(12);
  });

  it('RN-24: el track solo está en los métodos que D01 marca «Sí»', async () => {
    const d01 = await leerSemillaD01();
    const conTrack = d01.metodos
      .filter((m) => m.track)
      .map((m) => m.codigo)
      .sort();
    expect(conTrack).toEqual([
      'anfibios_reptiles.tbf',
      'anfibios_reptiles.ves',
      'artropodos.red_entomologica',
      'aves.listas_20',
      'fauna_transversal.abs',
      'flora_vegetacion.evaluacion_cualitativa',
      'mamiferos_mayores.transectos_lineales',
    ]);
  });

  it('RN-31: ninguna validación informativa o de referencia es obligatoria; los casos explícitos de D01 están', async () => {
    const d01 = await leerSemillaD01();
    const porCodigo = new Map(d01.metodos.map((m) => [m.codigo, m]));
    const ves = porCodigo
      .get('anfibios_reptiles.ves')
      ?.validaciones.find((v) => v.tipo === 'separacion_minima_m');
    expect(ves).toMatchObject({ metros: 50, tipo_control: 'advertencia' });
    const camaras = porCodigo.get('mamiferos_mayores.camaras_trampa')?.validaciones ?? [];
    expect(camaras.find((v) => v.tipo === 'confirmacion')).toMatchObject({
      condicion: 'za_ef_cantidad_exacta',
      cantidad: 6,
    });
    expect(camaras.find((v) => v.tipo === 'cantidad_unidades')).toMatchObject({
      minimo: 6,
      tipo_control: 'obligatorio',
    });
    const bofedal = porCodigo.get('bofedales.intercepcion_cuadrantes')?.validaciones ?? [];
    expect(
      bofedal.some((v) => v.tipo === 'referencia_esfuerzo' && v.tipo_control === 'criterio_humano'),
    ).toBe(true);
    expect(bofedal.some((v) => v.tipo === 'cantidad_unidades')).toBe(false);
    const redes = porCodigo.get('mamiferos_menores_voladores.redes_neblina')?.validaciones ?? [];
    expect(redes.find((v) => v.tipo === 'cantidad_unidades')).toMatchObject({
      minimo: 10,
      tipo_control: 'obligatorio',
    });
    expect(redes.find((v) => v.tipo === 'fotos_contexto')).toMatchObject({
      cantidad_por_unidad: 1,
      tipo_control: 'obligatorio',
    });
    expect(redes.find((v) => v.tipo === 'separacion_minima_m')).toMatchObject({
      metros: 20,
      tipo_control: 'advertencia',
    });
    const tomahawk = porCodigo.get('mamiferos_menores_terrestres.tomahawk')?.validaciones ?? [];
    expect(tomahawk.some((v) => v.tipo === 'mensaje')).toBe(true);
    for (const m of d01.metodos) {
      for (const v of m.validaciones) {
        if (v.tipo === 'referencia_esfuerzo' || v.tipo === 'mensaje') {
          expect(v.tipo_control, `${m.codigo} ${v.tipo}`).not.toBe('obligatorio');
        }
      }
    }
  });
});

describe('carga TOCE (A01 + D01)', () => {
  it('carga 102 estaciones, 15 brigadas, 183 filas de cronograma y la matriz completa', () => {
    expect(resumen).toMatchObject({
      configuracion_numero: 1,
      especialidades: 12,
      metodos: 33,
      estaciones: 102,
      brigadas: 15,
      cronograma_items: 183,
    });
    expect(resumen.estacion_metodo).toBe(102 * 33);
  });

  it('RN-29: la estación conserva juntos código, Zona UTM, Este, Norte, AID/AII, UV y ZA/EF, y su geometría en 4326', async () => {
    const e = await uno(sql<{
      zona_utm: string;
      este: string;
      norte: string;
      aid_aii: string;
      uv: string;
      za_ef: string | null;
      lon: number;
      lat: number;
      region: string;
    }>`
      SELECT zona_utm, este, norte, aid_aii, uv, za_ef, ST_X(geom) AS lon, ST_Y(geom) AS lat, region
        FROM app.estacion WHERE proyecto_id = ${PROY} AND codigo = 'EM-52'`);
    expect(e).toMatchObject({
      zona_utm: '18 S',
      aid_aii: 'AII',
      uv: 'Zona agropecuaria amazónica',
      za_ef: 'ZA Cordillera Azul',
      region: 'SELVA',
    });
    expect(Number(e.este)).toBe(374581);
    expect(e.lon).toBeGreaterThan(-76.2);
    expect(e.lon).toBeLessThan(-76.0);
    expect(e.lat).toBeGreaterThan(-8.8);
    expect(e.lat).toBeLessThan(-8.7);
    // EM-23, EM-41 y EM-65 sin letras adicionales (A01 hoja 00).
    expect(
      await n(
        sql<{
          n: string;
        }>`SELECT count(*)::text AS n FROM app.estacion WHERE proyecto_id = ${PROY} AND codigo IN ('EM-23','EM-41','EM-65')`,
      ),
    ).toBe(3);
  });

  it('RN-35: el cronograma base es la versión 1 vigente y BL-21 conserva sus dos filas pendientes de validación', async () => {
    const v = await uno(sql<{ numero: number; estado: string; es_base: boolean }>`
      SELECT v.numero, v.estado, v.es_base FROM app.cronograma_version v
        JOIN app.campania c ON c.id = v.campania_id WHERE c.proyecto_id = ${PROY}`);
    expect(v).toEqual({ numero: 1, estado: 'vigente', es_base: true });
    const bl21 = await n(sql<{ n: string }>`
      SELECT count(*)::text AS n FROM app.cronograma_item i JOIN app.estacion e ON e.id = i.estacion_id
       WHERE e.codigo = 'BL-21' AND i.estado_fila = 'pendiente_validacion' AND i.fecha IN ('2026-12-16','2026-12-17')`);
    expect(bl21).toBe(2);
  });

  it('RN-28 / E-01: TODAS en las 102 estaciones, ABS en todas, ATRIBUTO en ninguna', async () => {
    expect(
      await n(sql<{
        n: string;
      }>`SELECT count(*)::text AS n FROM app.estacion_metodo em JOIN app.metodo m ON m.id = em.metodo_id
      WHERE m.codigo = 'flora_vegetacion.puntos_intercepcion' AND em.habilitado`),
    ).toBe(102);
    expect(
      await n(sql<{
        n: string;
      }>`SELECT count(*)::text AS n FROM app.estacion_metodo em JOIN app.metodo m ON m.id = em.metodo_id
      WHERE m.codigo = 'fauna_transversal.abs' AND em.habilitado`),
    ).toBe(102);
    expect(
      await n(sql<{
        n: string;
      }>`SELECT count(*)::text AS n FROM app.estacion_metodo em JOIN app.metodo m ON m.id = em.metodo_id
      WHERE m.clase = 'atributo' AND em.habilitado`),
    ).toBe(0);
    expect(
      await n(sql<{
        n: string;
      }>`SELECT count(*)::text AS n FROM app.estacion_metodo em JOIN app.metodo m ON m.id = em.metodo_id
      WHERE m.clase = 'evento' AND NOT em.habilitado`),
    ).toBe(0);
  });

  it('RN-28 CONDICIONAL: región, lagunas, bofedales, ZA/EF y nominal desde las actividades especiales de A01', async () => {
    expect(await matriz('EM-27', 'aves.puntos_conteo')).toMatchObject({
      habilitado: true,
      origen: 'condicion',
    }); // COSTA
    expect(await matriz('BL-18', 'aves.puntos_conteo')).toMatchObject({ habilitado: false }); // lacustre
    expect(await matriz('BL-18', 'aves.conteo_total')).toMatchObject({ habilitado: true });
    expect(await matriz('EM-15', 'aves.listas_20')).toMatchObject({ habilitado: true }); // SELVA
    expect(await matriz('EM-27', 'aves.listas_20')).toMatchObject({
      habilitado: false,
      condicion_pendiente: false,
    });
    expect(await matriz('BL-35', 'bofedales.biomasa')).toMatchObject({ habilitado: true });
    expect(await matriz('EM-27', 'bofedales.biomasa')).toMatchObject({ habilitado: false });
    expect(await matriz('EM-52', 'epifitas.vasculares')).toMatchObject({
      habilitado: true,
      origen: 'nominal',
    }); // A01 hoja 02
    expect(await matriz('EM-53', 'epifitas.vasculares')).toMatchObject({
      habilitado: true,
      origen: 'condicion',
    }); // ZA Sunchubamba
    expect(await matriz('EM-27', 'epifitas.vasculares')).toMatchObject({
      habilitado: false,
      condicion_pendiente: true,
    });
    expect(await matriz('EM-27', 'flora_vegetacion.parcelas_arbustos')).toMatchObject({
      habilitado: false,
      condicion_pendiente: true,
    }); // P-01
    expect(await matriz('EM-65', 'aves.listas_20')).toMatchObject({
      habilitado: false,
      condicion_pendiente: true,
    }); // sin región (BC 2)
    expect(resumen.estacion_metodo_pendientes).toBeGreaterThan(0);
  });

  it('las tareas internas son una por estación × método habilitado, con brigada y fecha del cronograma', async () => {
    const habilitados = await n(sql<{
      n: string;
    }>`SELECT count(*)::text AS n FROM app.estacion_metodo em JOIN app.metodo m ON m.id = em.metodo_id
      WHERE em.habilitado AND m.clase IN ('todas','condicional','transversal')`);
    expect(resumen.tareas).toBe(habilitados);
    const t = await uno(sql<{ estado: string; fecha: string; brigada: string }>`
      SELECT t.estado, to_char(t.fecha_programada, 'YYYY-MM-DD') AS fecha, b.codigo AS brigada
        FROM app.tarea t JOIN app.estacion e ON e.id = t.estacion_id JOIN app.metodo m ON m.id = t.metodo_id
        JOIN app.brigada b ON b.id = t.brigada_id
       WHERE e.codigo = 'EM-52' AND m.codigo = 'epifitas.vasculares'`);
    expect(t).toEqual({ estado: 'asignada', fecha: '2026-12-13', brigada: 'B1' });
    const sherman = await uno(sql<{ fecha: string; brigada: string }>`
      SELECT to_char(t.fecha_programada, 'YYYY-MM-DD') AS fecha, b.codigo AS brigada
        FROM app.tarea t JOIN app.estacion e ON e.id = t.estacion_id JOIN app.metodo m ON m.id = t.metodo_id
        JOIN app.brigada b ON b.id = t.brigada_id
       WHERE e.codigo = 'EM-52' AND m.codigo = 'mamiferos_menores_terrestres.sherman'`);
    expect(sherman).toEqual({ fecha: '2026-12-02', brigada: 'SELVA 2' });
  });

  it('volver a cargar es idempotente y respeta una decisión nominal tomada en la web', async () => {
    await sql`UPDATE app.estacion_metodo em SET habilitado = true, origen = 'nominal', condicion_pendiente = false
        FROM app.estacion e, app.metodo m
       WHERE em.estacion_id = e.id AND em.metodo_id = m.id AND e.codigo = 'EM-27' AND m.codigo = 'flora_vegetacion.parcelas_arbustos'`.execute(
      db,
    );
    const otra = await cargarToce(db, { proyectoId: PROY });
    expect(otra.configuracion_numero).toBe(1);
    expect(otra.tareas).toBe(0);
    expect(
      await n(
        sql<{
          n: string;
        }>`SELECT count(*)::text AS n FROM app.estacion WHERE proyecto_id = ${PROY}`,
      ),
    ).toBe(102);
    expect(
      await n(sql<{ n: string }>`SELECT count(*)::text AS n FROM app.cronograma_version`),
    ).toBe(1);
    expect(await n(sql<{ n: string }>`SELECT count(*)::text AS n FROM app.metodo`)).toBe(33);
    expect(await matriz('EM-27', 'flora_vegetacion.parcelas_arbustos')).toMatchObject({
      habilitado: true,
      origen: 'nominal',
    });
  });

  it.each([
    ['ejecucion', 'estado', ESTADOS_EJECUCION],
    ['alerta', 'estado', ESTADOS_ALERTA],
    ['solicitud_cronograma', 'estado', ESTADOS_SOLICITUD_CRONOGRAMA],
    ['cronograma_item', 'tipo_actividad', TIPOS_ACTIVIDAD_CRONOGRAMA],
    ['cronograma_item', 'estado_fila', ESTADOS_FILA_CRONOGRAMA],
  ] as const)('el CHECK de %s.%s coincide con core', async (tabla, columna, valores) => {
    const { rows } = await migrador.query<{ def: string }>(
      `SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace ns ON ns.oid = t.relnamespace
       WHERE ns.nspname = 'app' AND t.relname = $1 AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE $2`,
      [tabla, `%(${columna} = ANY%`],
    );
    const def = rows[0]?.def ?? '';
    const enBd = [...def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]).sort();
    expect(enBd).toEqual([...valores].sort());
  });
});
