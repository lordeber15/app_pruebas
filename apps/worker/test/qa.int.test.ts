import { S3Client } from '@aws-sdk/client-s3';
import {
  configuracionMetodoSchema,
  crearGeneradorUuidV7,
  type ConfiguracionMetodo,
  type EvaluacionEjecucion,
} from '@campo/core';
import { crearDb, crearPool, type Db } from '@campo/db';
import { iniciarBaseDePrueba, type BaseDePrueba } from '@campo/db/pruebas';
import { randomFillSync } from 'node:crypto';
import { sql } from 'kysely';
import type pg from 'pg';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearAlmacenamiento } from '../src/almacenamiento.ts';
import { claveAlertaQa, ejecucionesListas, evaluarEjecucionQa } from '../src/qa.ts';
import { iniciarTrabajos } from '../src/trabajos.ts';

/**
 * QA post-sincronización (D02 §9, RN-05, RN-31, RF-T04). El motor de reglas tiene sus pruebas
 * por fila de D01 en `core`; aquí se prueba que el worker arma el contexto desde PostgreSQL,
 * transiciona la ejecución y genera (sin duplicar) las alertas de lo obligatorio.
 */
const generarId = crearGeneradorUuidV7((n) => randomFillSync(new Uint8Array(n)));

/**
 * Método sintético con la forma de una fila de D01: una unidad punto georreferenciada con una
 * foto de contexto (obligatorio) y una separación mínima entre puntos (advertencia no bloqueante,
 * como la de Sherman en D01: «advertencia no bloqueante… separación de 10–15 m»).
 */
const CONFIG: ConfiguracionMetodo = configuracionMetodoSchema.parse({
  codigo: 'prueba.puntos',
  nombre: 'PUNTOS DE PRUEBA',
  especialidad: 'prueba',
  clase: 'todas',
  aplicacion: { texto: 'Todas las estaciones.', condicion: null },
  unidad: { tipo: 'punto', tipos_adicionales: [], texto: null },
  esfuerzo: { estandar: { cantidad: 1, unidad: 'puntos', texto: '1 punto.' }, za_ef: null },
  horario: null,
  geometria: {
    tipo: 'punto',
    texto: 'Punto georreferenciado',
    vinculo_metodo: null,
    detalle: null,
  },
  track: false,
  fotos: {
    contexto: {
      cantidad_por_unidad: 1,
      cardinales: false,
      reutiliza_metodo: null,
      texto: '1 foto de contexto por punto',
    },
    metodologicas: { minimo: 0, texto: 'Sin fotos metodológicas' },
  },
  campos_ejecucion: [],
  campos: [],
  registros: null,
  validaciones: [
    {
      tipo: 'cantidad_unidades',
      minimo: 1,
      minimo_za_ef: null,
      tipo_control: 'obligatorio',
      texto: 'Validar 1 punto.',
    },
    { tipo: 'geometria', tipo_control: 'obligatorio', texto: 'Validar el punto.' },
    {
      tipo: 'fotos_contexto',
      cantidad_por_unidad: 1,
      tipo_control: 'obligatorio',
      texto: 'Validar 1 foto por punto.',
    },
    {
      tipo: 'separacion_minima_m',
      metros: 10,
      tipo_control: 'advertencia',
      texto: 'Advertencia no bloqueante: separación de 10 m entre puntos.',
    },
  ],
  vinculo: null,
  fuente: { estado: 'CERRADO', origen: 'Prueba', pendiente: 'Ninguno' },
});

let base: BaseDePrueba;
let poolAdmin: pg.Pool;
let poolWorker: pg.Pool;
let admin: Db;
let db: Db;
let proyectoId: string;
let usuarioId: string;
let brigadaId: string;
let estacionId: string;
let metodoId: string;
let metodoSinConfig: string;

beforeAll(async () => {
  base = await iniciarBaseDePrueba();
  poolAdmin = crearPool(base.url('app_migrator'), 2);
  poolWorker = crearPool(base.url('worker_rw'), 3);
  admin = crearDb(poolAdmin);
  db = crearDb(poolWorker);

  [proyectoId, usuarioId, brigadaId, estacionId, metodoId, metodoSinConfig] = [
    generarId(),
    generarId(),
    generarId(),
    generarId(),
    generarId(),
    generarId(),
  ];
  const [configuracionId, especialidadId] = [generarId(), generarId()];
  await admin
    .insertInto('usuario')
    .values({
      id: usuarioId,
      tipo_documento: 'DNI',
      num_documento: '50000002',
      nombre: 'Sintético',
    })
    .execute();
  await admin
    .insertInto('proyecto')
    // Las pruebas de D01 aíslan sus reglas: la foto mínima del proyecto (RN-04 ampliada) se
    // activa solo en su propio bloque.
    .values({
      id: proyectoId,
      nombre: 'Proyecto sintético',
      validacion_activa: false,
      fotos_minimas_ejecucion: 0,
    })
    .execute();
  await admin
    .insertInto('brigada')
    .values({ id: brigadaId, proyecto_id: proyectoId, nombre: 'Brigada A', codigo: 'A' })
    .execute();
  await admin
    .insertInto('estacion')
    .values({
      id: estacionId,
      proyecto_id: proyectoId,
      codigo: 'EST-QA',
      geom: sql<string>`ST_SetSRID(ST_MakePoint(-77.03, -12.04), 4326)`,
    })
    .execute();
  await admin
    .insertInto('configuracion_metodologica')
    .values({ id: configuracionId, proyecto_id: proyectoId, numero: 1, origen: 'prueba' })
    .execute();
  await admin
    .insertInto('especialidad')
    .values({
      id: especialidadId,
      proyecto_id: proyectoId,
      codigo: 'prueba',
      nombre: 'Prueba',
      es_fauna: false,
    })
    .execute();
  await admin
    .insertInto('metodo')
    .values([
      {
        id: metodoId,
        configuracion_id: configuracionId,
        especialidad_id: especialidadId,
        codigo: CONFIG.codigo,
        nombre: 'Puntos de prueba',
        clase: 'todas',
        tipo_geometria: 'punto',
        config: JSON.stringify(CONFIG),
      },
      {
        id: metodoSinConfig,
        configuracion_id: configuracionId,
        especialidad_id: especialidadId,
        codigo: 'prueba.sin_config',
        nombre: 'Sin configuración',
        clase: 'todas',
        tipo_geometria: 'punto',
        config: '{}',
      },
    ])
    .execute();
});

afterAll(async () => {
  await poolAdmin.end();
  await poolWorker.end();
  await base.detener();
});

interface UnidadPrueba {
  readonly lat?: number;
  readonly lon?: number;
  readonly sinGeometria?: boolean;
  readonly fotos?: number;
  readonly estadoFotos?: string;
}

/** Ejecución cerrada en el celular y aplicada en el servidor: queda `evidencia_pendiente` (RN-05). */
const ejecucionCerrada = async (unidades: readonly UnidadPrueba[], metodo = metodoId) => {
  const ejecucionId = generarId();
  await admin
    .insertInto('ejecucion')
    .values({
      id: ejecucionId,
      proyecto_id: proyectoId,
      brigada_id: brigadaId,
      estacion_id: estacionId,
      metodo_id: metodo,
      usuario_id: usuarioId,
      abierta_en: new Date('2026-12-02T13:00:00Z'),
      cerrada_en: new Date('2026-12-02T15:00:00Z'),
      estado: 'evidencia_pendiente',
    })
    .execute();
  let orden = 0;
  for (const u of unidades) {
    const unidadId = generarId();
    const lat = u.lat ?? -12.04;
    const lon = u.lon ?? -77.03 + orden * 0.001;
    await admin
      .insertInto('unidad')
      .values({
        id: unidadId,
        ejecucion_id: ejecucionId,
        codigo: `P-${String(orden + 1)}`,
        tipo_unidad: 'punto',
        orden,
        estado: 'cerrada',
        geom:
          u.sinGeometria === true
            ? null
            : sql<string>`ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)`,
        geom_detalle:
          u.sinGeometria === true ? null : JSON.stringify({ tipo: 'punto', punto: { lat, lon } }),
        inicio: new Date('2026-12-02T13:10:00Z'),
        fin: new Date('2026-12-02T13:40:00Z'),
      })
      .execute();
    for (let i = 0; i < (u.fotos ?? 1); i++) {
      await admin
        .insertInto('archivo')
        .values({
          id: generarId(),
          proyecto_id: proyectoId,
          usuario_id: usuarioId,
          ejecucion_id: ejecucionId,
          unidad_id: unidadId,
          estacion_id: estacionId,
          metodo_id: metodo,
          tipo: 'foto',
          tipo_foto: 'contexto',
          orientacion: 'N',
          hash_preview: 'ab'.repeat(32),
          tamano_preview: '800000',
          estado: u.estadoFotos ?? 'preview_verificada',
          capturado_en: new Date('2026-12-02T13:20:00Z'),
        })
        .execute();
    }
    orden += 1;
  }
  return ejecucionId;
};

const ejecucion = (id: string) =>
  admin
    .selectFrom('ejecucion')
    .select(['estado', 'resultado_qa', 'qa_evaluado_en'])
    .where('id', '=', id)
    .executeTakeFirstOrThrow();

const alertas = (ejecucionId: string) =>
  admin
    .selectFrom('alerta')
    .select(['tipo', 'origen', 'estado', 'clave_dedup', 'titulo', 'brigada_id', 'estacion_id'])
    .where('ejecucion_id', '=', ejecucionId)
    .execute();

describe('QA post-sincronización (RN-05, RN-31, RF-T04)', () => {
  it('RN-31 una ejecución que cumple todo lo obligatorio pasa a completa sin alertas', async () => {
    const id = await ejecucionCerrada([{ fotos: 1 }]);
    const r = await evaluarEjecucionQa(db, id);
    expect(r).toMatchObject({ accion: 'evaluada', estado: 'completa', incumplimientos: 0 });
    const e = await ejecucion(id);
    expect(e.estado).toBe('completa');
    expect(e.qa_evaluado_en).not.toBeNull();
    const qa = e.resultado_qa as unknown as EvaluacionEjecucion;
    expect(qa.incumplimientos_obligatorios).toBe(0);
    expect(qa.resultados.find((x) => x.regla === 'geometria')?.estado).toBe('cumple');
    expect(await alertas(id)).toHaveLength(0);
  });

  it('RN-31 falta la foto de contexto obligatoria: parcial y una alerta post_sincronizacion del sistema', async () => {
    const id = await ejecucionCerrada([{ fotos: 0 }]);
    const r = await evaluarEjecucionQa(db, id);
    expect(r).toMatchObject({ accion: 'evaluada', estado: 'parcial', alertas_nuevas: 1 });
    expect((await ejecucion(id)).estado).toBe('parcial');
    const a = await alertas(id);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({
      tipo: 'post_sincronizacion',
      origen: 'sistema',
      estado: 'abierta',
      brigada_id: brigadaId,
      estacion_id: estacionId,
      clave_dedup: claveAlertaQa('fotos_contexto', id, '2026-12-02'),
    });
    expect(a[0]?.titulo).toContain('Fotos de contexto');
  });

  it('RN-30 RN-31 sin geometría ni foto: parcial con una alerta por regla obligatoria incumplida', async () => {
    const id = await ejecucionCerrada([{ sinGeometria: true, fotos: 0 }]);
    const r = await evaluarEjecucionQa(db, id);
    expect(r).toMatchObject({ accion: 'evaluada', estado: 'parcial', incumplimientos: 2 });
    const claves = (await alertas(id)).map((x) => x.clave_dedup).sort();
    expect(claves).toEqual(
      [
        claveAlertaQa('fotos_contexto', id, '2026-12-02'),
        claveAlertaQa('geometria', id, '2026-12-02'),
      ].sort(),
    );
  });

  it('RN-22 reprocesar una ejecución no duplica sus alertas (clave regla + ejecución + periodo)', async () => {
    const id = await ejecucionCerrada([{ fotos: 0 }]);
    await evaluarEjecucionQa(db, id);
    // Segunda ejecución del trabajo sobre una ya evaluada: no hace nada.
    expect(await evaluarEjecucionQa(db, id)).toEqual({ accion: 'nada', motivo: 'YA_EVALUADA' });
    // Reproceso forzado (la ejecución vuelve a esperar evaluación): la alerta no se repite.
    await admin
      .updateTable('ejecucion')
      .set({ estado: 'evidencia_pendiente' })
      .where('id', '=', id)
      .execute();
    expect(await evaluarEjecucionQa(db, id)).toMatchObject({
      accion: 'evaluada',
      estado: 'parcial',
      alertas_nuevas: 0,
    });
    expect(await alertas(id)).toHaveLength(1);
  });

  it('RN-31 una advertencia incumplida (separación mínima) no hace parcial ni genera alerta', async () => {
    // Dos puntos a ~3 m: incumple la separación de 10 m, que D01 marca como advertencia.
    const id = await ejecucionCerrada([
      { lat: -12.04, lon: -77.03, fotos: 1 },
      { lat: -12.04003, lon: -77.03, fotos: 1 },
    ]);
    const r = await evaluarEjecucionQa(db, id);
    expect(r).toMatchObject({ accion: 'evaluada', estado: 'completa', incumplimientos: 0 });
    const qa = (await ejecucion(id)).resultado_qa as unknown as EvaluacionEjecucion;
    expect(qa.advertencias).toBeGreaterThan(0);
    expect(
      qa.resultados.some((x) => x.regla === 'separacion_minima_m' && x.estado === 'incumple'),
    ).toBe(true);
    expect(await alertas(id)).toHaveLength(0);
  });

  it('RN-05 con una foto sin verificar la ejecución sigue en evidencia_pendiente', async () => {
    const subida = await ejecucionCerrada([{ fotos: 1, estadoFotos: 'preview_subida' }]);
    const conError = await ejecucionCerrada([{ fotos: 1, estadoFotos: 'error' }]);
    for (const id of [subida, conError]) {
      expect(await evaluarEjecucionQa(db, id)).toEqual({
        accion: 'nada',
        motivo: 'FOTOS_PENDIENTES',
      });
      expect((await ejecucion(id)).estado).toBe('evidencia_pendiente');
      expect(await alertas(id)).toHaveLength(0);
    }
    const listas = await ejecucionesListas(db, 1000);
    expect(listas).not.toContain(subida);
    expect(listas).not.toContain(conError);
  });

  it('RN-05 una ejecución cerrada sin fotos se evalúa directamente', async () => {
    const id = await ejecucionCerrada([{ fotos: 0 }]);
    expect(await ejecucionesListas(db, 1000)).toContain(id);
    expect(await evaluarEjecucionQa(db, id)).toMatchObject({ accion: 'evaluada' });
    expect(await ejecucionesListas(db, 1000)).not.toContain(id);
  });

  it('sin configuración D01 válida no se evalúa ni se inventan reglas', async () => {
    const id = await ejecucionCerrada([{ fotos: 1 }], metodoSinConfig);
    expect(await evaluarEjecucionQa(db, id)).toEqual({
      accion: 'nada',
      motivo: 'CONFIGURACION_INVALIDA',
    });
    expect((await ejecucion(id)).estado).toBe('evidencia_pendiente');
  });
});

describe('RN-04 ampliada (decisión 2026-11-08): foto mínima por ejecución en la QA', () => {
  const conMinimo = async (n: number, prueba: () => Promise<void>) => {
    await admin
      .updateTable('proyecto')
      .set({ fotos_minimas_ejecucion: n })
      .where('id', '=', proyectoId)
      .execute();
    try {
      await prueba();
    } finally {
      await admin
        .updateTable('proyecto')
        .set({ fotos_minimas_ejecucion: 0 })
        .where('id', '=', proyectoId)
        .execute();
    }
  };

  it('RN-04 ampliada: una ejecución sin fotos queda parcial con alerta post_sincronizacion foto_ejecucion', () =>
    conMinimo(1, async () => {
      // Sin unidades ni fotos (como un EVENTO cerrado sin foto).
      const id = await ejecucionCerrada([]);
      const r = await evaluarEjecucionQa(db, id);
      expect(r).toMatchObject({ accion: 'evaluada', estado: 'parcial' });
      expect((await ejecucion(id)).estado).toBe('parcial');
      const qa = (await ejecucion(id)).resultado_qa as unknown as EvaluacionEjecucion;
      expect(qa.resultados.find((x) => x.regla === 'foto_ejecucion')).toMatchObject({
        estado: 'incumple',
        tipo_control: 'obligatorio',
        esperado: 1,
        obtenido: 0,
      });
      const a = (await alertas(id)).find(
        (x) => x.clave_dedup === claveAlertaQa('foto_ejecucion', id, '2026-12-02'),
      );
      expect(a).toMatchObject({
        tipo: 'post_sincronizacion',
        origen: 'sistema',
        estado: 'abierta',
      });
      expect(a?.titulo).toContain('Foto mínima de la ejecución');
    }));

  it('RN-04 ampliada: con una foto verificada la regla del proyecto se cumple', () =>
    conMinimo(1, async () => {
      const id = await ejecucionCerrada([{ fotos: 1 }]);
      expect(await evaluarEjecucionQa(db, id)).toMatchObject({
        accion: 'evaluada',
        estado: 'completa',
        incumplimientos: 0,
      });
      const qa = (await ejecucion(id)).resultado_qa as unknown as EvaluacionEjecucion;
      expect(qa.resultados.find((x) => x.regla === 'foto_ejecucion')?.estado).toBe('cumple');
    }));
});

describe('cola con pg-boss', () => {
  it('RN-05 el aviso ejecucion_cerrada encola y evalúa la ejecución', async () => {
    const almacen = crearAlmacenamiento(
      new S3Client({
        endpoint: 'http://127.0.0.1:9',
        region: 'us-east-1',
        forcePathStyle: true,
        credentials: { accessKeyId: 'x', secretAccessKey: 'y' },
      }),
      'archivos',
    );
    const trabajos = await iniciarTrabajos(
      base.url('worker_rw'),
      db,
      almacen,
      pino({ level: 'silent' }),
    );
    try {
      const id = await ejecucionCerrada([{ fotos: 1 }]);
      await poolAdmin.query('select pg_notify($1, $2)', ['ejecucion_cerrada', id]);
      const limite = Date.now() + 30_000;
      while ((await ejecucion(id)).estado === 'evidencia_pendiente' && Date.now() < limite) {
        await new Promise((r) => setTimeout(r, 250));
      }
      expect((await ejecucion(id)).estado).toBe('completa');
    } finally {
      await trabajos.detener();
    }
  }, 60_000);
});
