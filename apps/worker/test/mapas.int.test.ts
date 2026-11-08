/* eslint-disable security/detect-non-literal-fs-filename, security/detect-non-literal-regexp -- prueba: rutas en una carpeta temporal propia y patrones con ids generados aquí. */
import { CreateBucketCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { crearGeneradorUuidV7 } from '@campo/core';
import { crearDb, crearPool, type Db } from '@campo/db';
import { iniciarBaseDePrueba, type BaseDePrueba } from '@campo/db/pruebas';
import { createHash, randomBytes, randomFillSync } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type pg from 'pg';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearAlmacenamiento, type Almacenamiento } from '../src/almacenamiento.ts';
import {
  ErrorPmtiles,
  generarPaqueteMapa,
  paquetesPendientes,
  type EjecutarPmtiles,
  type OpcionesMapa,
} from '../src/mapas.ts';

/**
 * Generación de paquetes de mapa (RF-M05, V-10) contra PostgreSQL + PostGIS y MinIO reales. Lo
 * único simulado es el ejecutable `pmtiles`: escribe un PMTiles v3 sintético del tamaño pedido.
 */
const MINIO =
  'cgr.dev/chainguard/minio@sha256:3b6e40c30ecd5cea627e382ff0b82ca841f58c52294578787043ee80c8ef7c82';
const BUCKET = 'archivos';
const generarId = crearGeneradorUuidV7((n) => randomFillSync(new Uint8Array(n)));

let base: BaseDePrueba;
let minio: StartedTestContainer;
let s3: S3Client;
let almacen: Almacenamiento;
let poolAdmin: pg.Pool;
let poolWorker: pg.Pool;
let admin: Db;
let db: Db;
let proyectoId: string;
let dirTemporal: string;
let fuente: string;

beforeAll(async () => {
  const usuario = 'campo-prueba';
  const clave = randomBytes(16).toString('hex');
  [base, minio] = await Promise.all([
    iniciarBaseDePrueba(),
    new GenericContainer(MINIO)
      .withCommand(['server', '/data'])
      .withEnvironment({ MINIO_ROOT_USER: usuario, MINIO_ROOT_PASSWORD: clave })
      .withExposedPorts(9000)
      .withWaitStrategy(Wait.forHttp('/minio/health/live', 9000))
      .start(),
  ]);
  s3 = new S3Client({
    endpoint: `http://${minio.getHost()}:${String(minio.getMappedPort(9000))}`,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: usuario, secretAccessKey: clave },
  });
  await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
  almacen = crearAlmacenamiento(s3, BUCKET);
  poolAdmin = crearPool(base.url('app_migrator'), 2);
  poolWorker = crearPool(base.url('worker_rw'), 3);
  admin = crearDb(poolAdmin);
  db = crearDb(poolWorker);
  proyectoId = generarId();
  await admin
    .insertInto('proyecto')
    .values({ id: proyectoId, nombre: 'Proyecto sintético', validacion_activa: false })
    .execute();
  dirTemporal = await mkdtemp(path.join(tmpdir(), 'campo-mapas-'));
  fuente = path.join(dirTemporal, 'base.pmtiles');
  await writeFile(fuente, pmtilesSintetico(13, 200));
});

afterAll(async () => {
  await poolAdmin.end();
  await poolWorker.end();
  await rm(dirTemporal, { recursive: true, force: true });
  await Promise.all([base.detener(), minio.stop()]);
});

/** PMTiles v3 sintético: encabezado de 127 bytes con el zoom máximo en el byte 101. */
const pmtilesSintetico = (zoomMax: number, tamano: number): Buffer => {
  const b = Buffer.alloc(Math.max(tamano, 127));
  b.write('PMTiles', 0, 'latin1');
  b[7] = 3;
  b[100] = 0;
  b[101] = zoomMax;
  randomFillSync(b, 127);
  return b;
};

/** Ejecutor simulado: escribe el archivo de salida (args[3]) y guarda los argumentos. */
const simulado = (zoomFuente: number, tamano: number, llamadas: (readonly string[])[] = []) => {
  const ejecutar: EjecutarPmtiles = async (_bin, args) => {
    llamadas.push(args);
    const salida = args[3];
    if (salida === undefined) throw new Error('sin salida');
    const pedido = Number(args.find((a) => a.startsWith('--maxzoom='))?.split('=')[1]);
    await writeFile(salida, pmtilesSintetico(Math.min(pedido, zoomFuente), tamano));
  };
  return ejecutar;
};

const opciones = (o: Partial<OpcionesMapa>): OpcionesMapa => ({
  bin: 'pmtiles',
  fuente,
  tamanoMaximo: 150 * 1024 * 1024,
  dirTemporal,
  timeoutMs: 10_000,
  ...o,
});

const nuevoPaquete = async (zoom = 15) => {
  const id = generarId();
  await admin
    .insertInto('paquete_mapa')
    .values({
      id,
      proyecto_id: proyectoId,
      origen: 'usuario',
      nombre: 'Área sintética',
      oeste: -77.1,
      sur: -12.1,
      este: -77.0,
      norte: -12.0,
      zoom_max: zoom,
    })
    .execute();
  return id;
};

const paquete = (id: string) =>
  admin.selectFrom('paquete_mapa').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

/** Solo debe quedar la fuente en la carpeta de trabajo: los temporales se borran siempre. */
const temporales = async () => (await readdir(dirTemporal)).filter((f) => f !== 'base.pmtiles');

describe('RF-M05 generación de paquetes de mapa', () => {
  it('RF-M05: recorta el área, guarda el zoom real, el tamaño y el SHA-256 y sube el archivo', async () => {
    const id = await nuevoPaquete(15);
    expect(await paquetesPendientes(db)).toContain(id);
    const llamadas: (readonly string[])[] = [];
    const r = await generarPaqueteMapa(
      db,
      almacen,
      opciones({ ejecutar: simulado(13, 50_000, llamadas) }),
      id,
    );
    expect(r).toEqual({ accion: 'listo', version: 1, tamano: 50_000, zoom: 13 });
    expect(llamadas[0]).toEqual([
      'extract',
      '--quiet',
      fuente,
      expect.stringMatching(/^.+\.pmtiles$/) as unknown as string,
      '--bbox=-77.1,-12.1,-77,-12',
      '--maxzoom=15',
    ]);
    const p = await paquete(id);
    expect(p).toMatchObject({ estado: 'listo', zoom_max: 13, error: null });
    expect(Number(p.tamano)).toBe(50_000);
    expect(p.ruta_objeto).toMatch(
      new RegExp(`^proyectos/${proyectoId}/mapas/${id}/[0-9a-f-]{36}\\.pmtiles$`),
    );
    const objeto = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: p.ruta_objeto ?? '' }),
    );
    const contenido = Buffer.from((await objeto.Body?.transformToByteArray()) ?? []);
    expect(contenido.length).toBe(50_000);
    expect(createHash('sha256').update(contenido).digest('hex')).toBe(p.sha256);
    expect(await temporales()).toEqual([]);
    // Ya listo: otro aviso no hace nada.
    expect(
      await generarPaqueteMapa(db, almacen, opciones({ ejecutar: simulado(13, 10) }), id),
    ).toEqual({
      accion: 'nada',
    });
  });

  it('RF-M05 V-10: si el recorte supera el máximo queda en error con el peso y el máximo', async () => {
    const id = await nuevoPaquete();
    const r = await generarPaqueteMapa(
      db,
      almacen,
      opciones({ tamanoMaximo: 150 * 1024 * 1024, ejecutar: simulado(15, 160 * 1024 * 1024) }),
      id,
    );
    expect(r).toMatchObject({ accion: 'error', motivo: 'TAMANO_EXCEDIDO' });
    const p = await paquete(id);
    expect(p.estado).toBe('error');
    expect(p.error).toBe('El área pesa 160 MB; el máximo es 150 MB. Marque un área más pequeña.');
    expect(p.ruta_objeto).toBeNull();
    expect(await temporales()).toEqual([]);
  });

  it('RF-M05: sin mapa base en el servidor queda en error con un mensaje claro y no ejecuta pmtiles', async () => {
    const id = await nuevoPaquete();
    const llamadas: (readonly string[])[] = [];
    const r = await generarPaqueteMapa(
      db,
      almacen,
      opciones({
        fuente: path.join(dirTemporal, 'no-existe.pmtiles'),
        ejecutar: simulado(15, 10, llamadas),
      }),
      id,
    );
    expect(r).toMatchObject({ accion: 'error', motivo: 'FUENTE_INEXISTENTE' });
    expect(llamadas).toEqual([]);
    expect((await paquete(id)).error).toContain('El mapa base no está instalado en el servidor');
  });

  it('RF-M05: si pmtiles falla queda en error; si cambió la versión durante el recorte, se descarta', async () => {
    const fallo = await nuevoPaquete();
    const r = await generarPaqueteMapa(
      db,
      almacen,
      opciones({ ejecutar: () => Promise.reject(new ErrorPmtiles(1)) }),
      fallo,
    );
    expect(r).toMatchObject({ accion: 'error', motivo: 'PMTILES_FALLO' });
    expect((await paquete(fallo)).estado).toBe('error');

    const id = await nuevoPaquete();
    const base = simulado(15, 1000);
    const cambia: EjecutarPmtiles = async (bin, args, o) => {
      await base(bin, args, o);
      // Mientras tanto la API pidió otra versión (otra área o «regenerar»).
      await admin
        .updateTable('paquete_mapa')
        .set((eb) => ({ version: eb('version', '+', 1), estado: 'pendiente' }))
        .where('id', '=', id)
        .execute();
    };
    expect(await generarPaqueteMapa(db, almacen, opciones({ ejecutar: cambia }), id)).toEqual({
      accion: 'descartado',
      version: 1,
    });
    expect(await paquete(id)).toMatchObject({ estado: 'pendiente', version: 2, ruta_objeto: null });
    expect(await temporales()).toEqual([]);
  });

  it('RF-M05: una generación colgada más de 30 min vuelve a la lista de pendientes', async () => {
    const id = await nuevoPaquete();
    await admin
      .updateTable('paquete_mapa')
      .set({ estado: 'generando', generando_desde: new Date(Date.now() - 31 * 60 * 1000) })
      .where('id', '=', id)
      .execute();
    expect(await paquetesPendientes(db)).toContain(id);
    await admin
      .updateTable('paquete_mapa')
      .set({ generando_desde: new Date() })
      .where('id', '=', id)
      .execute();
    expect(await paquetesPendientes(db)).not.toContain(id);
  });
});
