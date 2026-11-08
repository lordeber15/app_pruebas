import type { Bbox, PaqueteMapa } from '@campo/core';
import type { Db } from '@campo/db';
import { sql } from 'kysely';

/** Consultas de los paquetes de mapa (RF-M05). Sin reglas: solo lectura y escritura. */

const columnas = (db: Db) =>
  db
    .selectFrom('paquete_mapa as p')
    .leftJoin('brigada as b', 'b.id', 'p.brigada_id')
    .leftJoin('usuario as u', 'u.id', 'p.solicitado_por')
    .select((eb) => [
      'p.id',
      'p.proyecto_id',
      'p.brigada_id',
      'b.nombre as brigada_nombre',
      'p.origen',
      'p.nombre',
      'p.oeste',
      'p.sur',
      'p.este',
      'p.norte',
      'p.zoom_max',
      'p.estado',
      'p.tamano',
      'p.sha256',
      'p.error',
      'p.version',
      'p.generado_en',
      'p.creado_en',
      'p.solicitado_por',
      'p.ruta_objeto',
      'u.nombre as solicitado_por_nombre',
      eb
        .selectFrom('paquete_mapa_descarga as d')
        .select(sql<number>`count(*)::int`.as('n'))
        .whereRef('d.paquete_id', '=', 'p.id')
        .whereRef('d.version', '=', 'p.version')
        .as('descargas'),
    ]);

type Fila = Awaited<ReturnType<ReturnType<typeof columnas>['executeTakeFirstOrThrow']>>;

export interface PaqueteInterno extends PaqueteMapa {
  readonly solicitado_por: string | null;
  readonly ruta_objeto: string | null;
}

const iso = (d: Date | string | null): string | null =>
  d === null ? null : new Date(d).toISOString();

const aPaquete = (f: Fila): PaqueteInterno => ({
  id: f.id,
  proyecto_id: f.proyecto_id,
  brigada_id: f.brigada_id,
  brigada_nombre: f.brigada_nombre,
  origen: f.origen === 'brigada' ? 'brigada' : 'usuario',
  nombre: f.nombre,
  bbox: [f.oeste, f.sur, f.este, f.norte],
  zoom_max: f.zoom_max,
  estado:
    f.estado === 'generando' || f.estado === 'listo' || f.estado === 'error'
      ? f.estado
      : 'pendiente',
  tamano: f.tamano === null ? null : Number(f.tamano),
  sha256: f.sha256,
  error: f.error,
  version: f.version,
  generado_en: iso(f.generado_en),
  creado_en: iso(f.creado_en) ?? '',
  solicitado_por_nombre: f.solicitado_por_nombre,
  descargas: f.descargas ?? 0,
  solicitado_por: f.solicitado_por,
  ruta_objeto: f.ruta_objeto,
});

/** Sin el `solicitado_por` ni la ruta del objeto: lo que ve el cliente. */
export const publico = (p: PaqueteInterno): PaqueteMapa => {
  return {
    id: p.id,
    proyecto_id: p.proyecto_id,
    brigada_id: p.brigada_id,
    brigada_nombre: p.brigada_nombre,
    origen: p.origen,
    nombre: p.nombre,
    bbox: p.bbox,
    zoom_max: p.zoom_max,
    estado: p.estado,
    tamano: p.tamano,
    sha256: p.sha256,
    error: p.error,
    version: p.version,
    generado_en: p.generado_en,
    creado_en: p.creado_en,
    solicitado_por_nombre: p.solicitado_por_nombre,
    descargas: p.descargas,
  };
};

export const buscarPaquete = async (db: Db, id: string): Promise<PaqueteInterno | null> => {
  const f = await columnas(db).where('p.id', '=', id).executeTakeFirst();
  return f === undefined ? null : aPaquete(f);
};

/** Paquetes del proyecto; `brigadas` null = todos (Coordinación y JdP). */
export const listarPaquetes = async (
  db: Db,
  proyectoId: string,
  brigadas: readonly string[] | null,
  origen?: 'brigada' | 'usuario',
): Promise<PaqueteInterno[]> => {
  if (brigadas?.length === 0) return [];
  let q = columnas(db).where('p.proyecto_id', '=', proyectoId);
  if (brigadas !== null) q = q.where('p.brigada_id', 'in', brigadas);
  if (origen !== undefined) q = q.where('p.origen', '=', origen);
  const filas = await q.orderBy('p.origen').orderBy('p.creado_en').orderBy('p.id').execute();
  return filas.map(aPaquete);
};

export const existeProyecto = async (db: Db, proyectoId: string): Promise<boolean> =>
  (await db.selectFrom('proyecto').select('id').where('id', '=', proyectoId).executeTakeFirst()) !==
  undefined;

export const brigadaDelProyecto = async (
  db: Db,
  proyectoId: string,
  brigadaId: string,
): Promise<boolean> =>
  (await db
    .selectFrom('brigada')
    .select('id')
    .where('id', '=', brigadaId)
    .where('proyecto_id', '=', proyectoId)
    .executeTakeFirst()) !== undefined;

/** Paquetes de usuario que cuentan para el límite (los que no terminaron en error). */
export const contarPaquetesDeUsuario = async (
  db: Db,
  proyectoId: string,
  usuarioId: string,
): Promise<number> => {
  const r = await db
    .selectFrom('paquete_mapa')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('proyecto_id', '=', proyectoId)
    .where('solicitado_por', '=', usuarioId)
    .where('origen', '=', 'usuario')
    .where('estado', '<>', 'error')
    .executeTakeFirstOrThrow();
  return r.n;
};

/** Serializa las altas de un mismo usuario en un proyecto (límite de paquetes). */
export const bloquearAltas = async (db: Db, proyectoId: string, usuarioId: string) => {
  await sql`select pg_advisory_xact_lock(hashtextextended(${`mapa:${proyectoId}:${usuarioId}`}, 0))`.execute(
    db,
  );
};

/** Avisa al worker (mismo patrón que `archivo_subido`); se entrega al confirmar la transacción. */
export const avisarWorker = async (db: Db, paqueteId: string): Promise<void> => {
  await sql`select pg_notify('paquete_mapa', ${paqueteId})`.execute(db);
};

export interface NuevoPaquete {
  readonly id: string;
  readonly proyectoId: string;
  readonly brigadaId: string | null;
  readonly origen: 'brigada' | 'usuario';
  readonly nombre: string;
  readonly bbox: Bbox;
  readonly zoomMax: number;
  readonly usuarioId: string | null;
}

/** Inserta; con origen `brigada` no hace nada si la brigada ya tiene el suyo (devuelve false). */
export const insertarPaquete = async (db: Db, p: NuevoPaquete): Promise<boolean> => {
  const [oeste, sur, este, norte] = p.bbox;
  let q = db.insertInto('paquete_mapa').values({
    id: p.id,
    proyecto_id: p.proyectoId,
    brigada_id: p.brigadaId,
    origen: p.origen,
    nombre: p.nombre,
    oeste,
    sur,
    este,
    norte,
    zoom_max: p.zoomMax,
    estado: 'pendiente',
    solicitado_por: p.usuarioId,
    creado_por: p.usuarioId,
    actualizado_por: p.usuarioId,
  });
  if (p.origen === 'brigada') {
    q = q.onConflict((oc) =>
      oc.columns(['proyecto_id', 'brigada_id']).where('origen', '=', 'brigada').doNothing(),
    );
  }
  return (await q.returning('id').executeTakeFirst()) !== undefined;
};

/** Pide una versión nueva: version + 1 y pendiente (opcionalmente con otra área o zoom). */
export const ponerPendiente = async (
  db: Db,
  id: string,
  usuarioId: string | null,
  cambio: { bbox?: Bbox; zoomMax?: number } = {},
): Promise<void> => {
  await db
    .updateTable('paquete_mapa')
    .set((eb) => ({
      version: eb('version', '+', 1),
      estado: 'pendiente',
      error: null,
      generando_desde: null,
      actualizado_por: usuarioId,
      ...(cambio.bbox === undefined
        ? {}
        : {
            oeste: cambio.bbox[0],
            sur: cambio.bbox[1],
            este: cambio.bbox[2],
            norte: cambio.bbox[3],
          }),
      ...(cambio.zoomMax === undefined ? {} : { zoom_max: cambio.zoomMax }),
    }))
    .where('id', '=', id)
    .execute();
};

/** Paquete de brigada existente, bloqueado para actualizarlo. */
export const paqueteDeBrigadaParaActualizar = (db: Db, proyectoId: string, brigadaId: string) =>
  db
    .selectFrom('paquete_mapa')
    .select(['id', 'oeste', 'sur', 'este', 'norte', 'zoom_max', 'estado'])
    .where('proyecto_id', '=', proyectoId)
    .where('brigada_id', '=', brigadaId)
    .where('origen', '=', 'brigada')
    .forUpdate()
    .executeTakeFirst();

/** Estaciones de cada brigada en el cronograma vigente del proyecto, con su posición. */
export const estacionesPorBrigada = (db: Db, proyectoId: string) =>
  db
    .selectFrom('cronograma_item as ci')
    .innerJoin('cronograma_version as v', 'v.id', 'ci.version_id')
    .innerJoin('campania as c', 'c.id', 'v.campania_id')
    .innerJoin('estacion as e', 'e.id', 'ci.estacion_id')
    .innerJoin('brigada as b', 'b.id', 'ci.brigada_id')
    .select([
      'ci.brigada_id',
      'b.nombre as brigada_nombre',
      'b.codigo as brigada_codigo',
      sql<number>`ST_Y(ST_Centroid(e.geom))`.as('lat'),
      sql<number>`ST_X(ST_Centroid(e.geom))`.as('lon'),
    ])
    .distinct()
    .where('c.proyecto_id', '=', proyectoId)
    .where('v.estado', '=', 'vigente')
    .where('e.geom', 'is not', null)
    .execute();

export const registrarDescarga = async (
  db: Db,
  d: { id: string; paqueteId: string; dispositivoId: string; usuarioId: string; version: number },
): Promise<void> => {
  await db
    .insertInto('paquete_mapa_descarga')
    .values({
      id: d.id,
      paquete_id: d.paqueteId,
      dispositivo_id: d.dispositivoId,
      usuario_id: d.usuarioId,
      version: d.version,
    })
    .onConflict((oc) =>
      oc.columns(['paquete_id', 'dispositivo_id']).doUpdateSet({
        version: d.version,
        usuario_id: d.usuarioId,
        descargado_en: new Date(),
      }),
    )
    .execute();
};
