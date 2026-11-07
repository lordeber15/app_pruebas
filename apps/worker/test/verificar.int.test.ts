import {
  CreateBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { crearGeneradorUuidV7 } from '@campo/core';
import { crearDb, crearPool, type Db } from '@campo/db';
import { iniciarBaseDePrueba, type BaseDePrueba } from '@campo/db/pruebas';
import { createHash, randomBytes, randomFillSync } from 'node:crypto';
import type pg from 'pg';
import { pino } from 'pino';
import sharp from 'sharp';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearAlmacenamiento, type Almacenamiento } from '../src/almacenamiento.ts';
import { iniciarTrabajos } from '../src/trabajos.ts';
import { archivosPendientes, miniaturaDe, verificarArchivo } from '../src/verificar.ts';

// Misma imagen de MinIO que el entorno local (infra/compose).
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
let cuadernoId: string;
let usuarioId: string;

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

  usuarioId = generarId();
  proyectoId = generarId();
  const brigadaId = generarId();
  cuadernoId = generarId();
  await admin
    .insertInto('usuario')
    .values({
      id: usuarioId,
      tipo_documento: 'DNI',
      num_documento: '50000001',
      nombre: 'Especialista Sintético',
    })
    .execute();
  await admin
    .insertInto('proyecto')
    .values({ id: proyectoId, nombre: 'Proyecto sintético', validacion_activa: false })
    .execute();
  await admin
    .insertInto('brigada')
    .values({ id: brigadaId, proyecto_id: proyectoId, nombre: 'Brigada' })
    .execute();
  await admin
    .insertInto('cuaderno')
    .values({
      id: cuadernoId,
      proyecto_id: proyectoId,
      brigada_id: brigadaId,
      responsable_id: usuarioId,
      titulo: 'Cuaderno',
    })
    .execute();
});

afterAll(async () => {
  await poolAdmin.end();
  await poolWorker.end();
  await Promise.all([base.detener(), minio.stop()]);
});

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

const jpeg = (ancho = 1200): Promise<Buffer> =>
  sharp({
    create: { width: ancho, height: 800, channels: 3, background: { r: 30, g: 120, b: 60 } },
  })
    .jpeg()
    .toBuffer();

const nuevaTarea = async (estado = 'en_transito'): Promise<string> => {
  const id = generarId();
  await admin
    .insertInto('tarea')
    .values({
      id,
      proyecto_id: proyectoId,
      cuaderno_id: cuadernoId,
      origen: 'manual',
      tipo: 'tecnica',
      titulo: 'Tarea',
      estado,
    })
    .execute();
  return id;
};

interface Variante {
  readonly contenido: Buffer;
  readonly hashAnunciado?: string;
}

/** Archivo con su preview (y original) ya subidos a S3, como tras el post-finish de tusd. */
const archivoSubido = async (opciones: {
  tipo?: 'foto' | 'ficha' | 'audio';
  tareaId?: string;
  preview: Variante;
  original?: Variante;
  estado?: string;
}) => {
  const id = generarId();
  const tareaId = opciones.tareaId ?? (await nuevaTarea());
  const clavePreview = `proyectos/${proyectoId}/archivos/${id}/preview/${generarId()}.jpg`;
  await s3.send(
    new PutObjectCommand({ Bucket: BUCKET, Key: clavePreview, Body: opciones.preview.contenido }),
  );
  let claveOriginal: string | null = null;
  if (opciones.original !== undefined) {
    claveOriginal = `proyectos/${proyectoId}/archivos/${id}/original/${generarId()}.jpg`;
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: claveOriginal,
        Body: opciones.original.contenido,
      }),
    );
  }
  await admin
    .insertInto('archivo')
    .values({
      id,
      proyecto_id: proyectoId,
      usuario_id: usuarioId,
      tarea_id: tareaId,
      tipo: opciones.tipo ?? 'foto',
      hash_preview: opciones.preview.hashAnunciado ?? sha(opciones.preview.contenido),
      hash_original:
        opciones.original === undefined
          ? null
          : (opciones.original.hashAnunciado ?? sha(opciones.original.contenido)),
      tamano_preview: String(opciones.preview.contenido.length),
      tamano_original:
        opciones.original === undefined ? null : String(opciones.original.contenido.length),
      ruta_preview: clavePreview,
      ruta_original: claveOriginal,
      estado: opciones.estado ?? 'preview_subida',
      capturado_en: new Date(),
    })
    .execute();
  return { id, tareaId };
};

const fila = (id: string) =>
  admin
    .selectFrom('archivo')
    .select(['estado', 'ruta_miniatura', 'ruta_original'])
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
const estadoTarea = async (id: string) =>
  (await admin.selectFrom('tarea').select('estado').where('id', '=', id).executeTakeFirstOrThrow())
    .estado;

describe('verificar_archivo (doc. 03 §7.2)', () => {
  it('RN-05 una foto con hash correcto se verifica, genera miniatura y completa la tarea', async () => {
    const { id, tareaId } = await archivoSubido({ preview: { contenido: await jpeg() } });
    const r = await verificarArchivo(db, almacen, id);
    expect(r).toEqual({ accion: 'verificado', variante: 'preview', tareaCompletada: true });
    expect(await fila(id)).toMatchObject({
      estado: 'preview_verificada',
      ruta_miniatura: miniaturaDe(proyectoId, id),
    });
    expect(await estadoTarea(tareaId)).toBe('completada');
    const mini = await s3.send(
      new HeadObjectCommand({ Bucket: BUCKET, Key: miniaturaDe(proyectoId, id) }),
    );
    expect(mini.ContentType).toBe('image/jpeg');
  });

  it('RN-17 un hash distinto deja el archivo en error y la tarea en tránsito', async () => {
    const { id, tareaId } = await archivoSubido({
      preview: { contenido: await jpeg(), hashAnunciado: 'f'.repeat(64) },
    });
    expect(await verificarArchivo(db, almacen, id)).toMatchObject({
      accion: 'rechazado',
      motivo: 'HASH_DISTINTO',
    });
    expect((await fila(id)).estado).toBe('error');
    expect(await estadoTarea(tareaId)).toBe('en_transito');
  });

  it('SEG-08 un archivo que no es JPEG se rechaza por contenido aunque su hash coincida', async () => {
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } })
      .png()
      .toBuffer();
    const { id } = await archivoSubido({ preview: { contenido: png } });
    expect(await verificarArchivo(db, almacen, id)).toMatchObject({
      accion: 'rechazado',
      motivo: 'TIPO_NO_PERMITIDO',
    });
  });

  it('SEG-08 una firma JPEG con contenido corrupto se rechaza', async () => {
    const falso = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(2000)]);
    const { id } = await archivoSubido({ preview: { contenido: falso } });
    expect(await verificarArchivo(db, almacen, id)).toMatchObject({
      accion: 'rechazado',
      motivo: 'IMAGEN_CORRUPTA',
    });
  });

  it('RN-17 tras la preview se verifica el original', async () => {
    const { id } = await archivoSubido({
      preview: { contenido: await jpeg() },
      original: { contenido: await jpeg(3000) },
    });
    expect(await verificarArchivo(db, almacen, id)).toMatchObject({ variante: 'preview' });
    expect(await verificarArchivo(db, almacen, id)).toEqual({
      accion: 'verificado',
      variante: 'original',
      tareaCompletada: false,
    });
    expect((await fila(id)).estado).toBe('original_verificado');
  });

  it('RN-17 un original con hash distinto se descarta y la preview sigue verificada', async () => {
    const { id } = await archivoSubido({
      preview: { contenido: await jpeg() },
      original: { contenido: await jpeg(3000), hashAnunciado: 'e'.repeat(64) },
      estado: 'preview_verificada',
    });
    expect(await verificarArchivo(db, almacen, id)).toMatchObject({
      accion: 'rechazado',
      variante: 'original',
    });
    expect(await fila(id)).toMatchObject({ estado: 'preview_verificada', ruta_original: null });
  });

  it('un audio M4A se verifica sin miniatura', async () => {
    const m4a = Buffer.concat([
      Buffer.from([0, 0, 0, 0x20]),
      Buffer.from('ftypM4A '),
      randomBytes(500),
    ]);
    const { id } = await archivoSubido({ tipo: 'audio', preview: { contenido: m4a } });
    expect(await verificarArchivo(db, almacen, id)).toMatchObject({
      accion: 'verificado',
      tareaCompletada: false,
    });
    expect(await fila(id)).toMatchObject({ estado: 'preview_verificada', ruta_miniatura: null });
  });

  it('una foto subida antes de completar no cambia la tarea descargada', async () => {
    const tareaId = await nuevaTarea('descargada');
    const { id } = await archivoSubido({ tareaId, preview: { contenido: await jpeg() } });
    expect(await verificarArchivo(db, almacen, id)).toMatchObject({
      accion: 'verificado',
      tareaCompletada: false,
    });
    expect(await estadoTarea(tareaId)).toBe('descargada');
  });

  it('es idempotente: un archivo ya verificado no se vuelve a procesar', async () => {
    const { id } = await archivoSubido({ preview: { contenido: await jpeg() } });
    await verificarArchivo(db, almacen, id);
    expect(await verificarArchivo(db, almacen, id)).toEqual({ accion: 'nada' });
  });

  it('la revisión periódica encuentra los archivos subidos sin verificar', async () => {
    const { id } = await archivoSubido({ preview: { contenido: await jpeg() } });
    expect(await archivosPendientes(db, 1000)).toContain(id);
    await verificarArchivo(db, almacen, id);
    expect(await archivosPendientes(db, 1000)).not.toContain(id);
  });
});

describe('cola con pg-boss', () => {
  it('el aviso archivo_subido encola y verifica el archivo', async () => {
    const trabajos = await iniciarTrabajos(
      base.url('worker_rw'),
      db,
      almacen,
      pino({ level: 'silent' }),
    );
    try {
      const { id, tareaId } = await archivoSubido({ preview: { contenido: await jpeg() } });
      await poolAdmin.query('select pg_notify($1, $2)', ['archivo_subido', id]);
      const limite = Date.now() + 30_000;
      while ((await fila(id)).estado !== 'preview_verificada' && Date.now() < limite) {
        await new Promise((r) => setTimeout(r, 250));
      }
      expect((await fila(id)).estado).toBe('preview_verificada');
      expect(await estadoTarea(tareaId)).toBe('completada');
    } finally {
      await trabajos.detener();
    }
  }, 60_000);
});
