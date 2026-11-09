import type { EstadoFilaCronograma, TipoActividadCronograma } from '@campo/core';
import {
  aplicarActividadesEspeciales,
  crearCronogramaBase,
  sincronizarReservas,
  type Db,
} from '@campo/db';
import { sql, type Kysely } from 'kysely';
import { ProblemaHttp } from '../../plataforma/errores.ts';
import { generarId } from '../../plataforma/ids.ts';
import type { Actor } from '../../plataforma/sesion.ts';
import { exigirGlobal, noEncontrado } from '../alcance/autorizacion.ts';
import type { AlCambiarCronograma } from '../mapas/servicio.ts';

/**
 * Cronograma base armado desde la web (RN-35, RF-W12) para un proyecto sin A01. Coordinación o el
 * JdP agregan filas al borrador (`cronograma_borrador_item`) y lo publican: la publicación crea
 * la versión 1 (base y vigente) con las mismas funciones que la carga de A01, y las reservas
 * estación × método toman brigada y fecha. Desde ese momento el base es inmutable y todo cambio
 * pasa por una solicitud que aprueba el JdP (RN-36).
 */

export interface FilaBorrador {
  readonly brigada_id: string;
  readonly fecha: string;
  readonly tipo_actividad: TipoActividadCronograma;
  readonly estacion_id: string | null;
  readonly detalle: string | null;
  /** Desde la carga de A01: «PENDIENTE VALIDACIÓN» y las actividades especiales. */
  readonly estado_fila?: EstadoFilaCronograma;
  readonly actividad_especial?: string | null;
}

const yaPublicado = (): ProblemaHttp =>
  new ProblemaHttp(
    409,
    'CRONOGRAMA_YA_PUBLICADO',
    'El proyecto ya tiene cronograma base: los cambios se proponen como reprogramación.',
  );

const exigirProyecto = async (db: Db, proyectoId: string): Promise<void> => {
  const p = await db
    .selectFrom('proyecto')
    .select('id')
    .where('id', '=', proyectoId)
    .executeTakeFirst();
  if (p === undefined) throw noEncontrado('El proyecto');
};

const tieneBase = async (db: Db, proyectoId: string): Promise<boolean> =>
  (await db
    .selectFrom('cronograma_version as v')
    .innerJoin('campania as c', 'c.id', 'v.campania_id')
    .select('v.id')
    .where('c.proyecto_id', '=', proyectoId)
    .where('v.es_base', '=', true)
    .executeTakeFirst()) !== undefined;

export const verBorrador = async (db: Db, actor: Actor, proyectoId: string) => {
  exigirGlobal(actor, 'configurar_proyecto');
  await exigirProyecto(db, proyectoId);
  return {
    publicado: await tieneBase(db, proyectoId),
    filas: await filasDelBorrador(db, proyectoId),
  };
};

/** Filas vigentes del borrador (sin las descartadas), en orden. */
export const filasDelBorrador = (db: Db, proyectoId: string) =>
  db
    .selectFrom('cronograma_borrador_item as i')
    .innerJoin('brigada as b', 'b.id', 'i.brigada_id')
    .leftJoin('estacion as e', 'e.id', 'i.estacion_id')
    .select([
      'i.id',
      'i.brigada_id',
      'b.codigo as brigada_codigo',
      'b.nombre as brigada_nombre',
      sql<string>`to_char(i.fecha, 'YYYY-MM-DD')`.as('fecha'),
      'i.tipo_actividad',
      'i.estacion_id',
      'e.codigo as estacion_codigo',
      'i.detalle',
      'i.estado_fila',
      'i.actividad_especial',
    ])
    .where('i.proyecto_id', '=', proyectoId)
    .where('i.estado', '=', 'borrador')
    .orderBy('i.fecha')
    .orderBy('i.orden')
    .execute();

export const agregarFilaBorrador = async (
  db: Db,
  actor: Actor,
  proyectoId: string,
  f: FilaBorrador,
): Promise<string> => {
  exigirGlobal(actor, 'configurar_proyecto');
  await exigirProyecto(db, proyectoId);
  if (await tieneBase(db, proyectoId)) throw yaPublicado();
  const brigada = await db
    .selectFrom('brigada')
    .select('id')
    .where('id', '=', f.brigada_id)
    .where('proyecto_id', '=', proyectoId)
    .executeTakeFirst();
  if (brigada === undefined) {
    throw new ProblemaHttp(400, 'FILA_INVALIDA', 'La brigada indicada no es del proyecto.');
  }
  if (f.estacion_id !== null) {
    const estacion = await db
      .selectFrom('estacion')
      .select('id')
      .where('id', '=', f.estacion_id)
      .where('proyecto_id', '=', proyectoId)
      .executeTakeFirst();
    if (estacion === undefined) {
      throw new ProblemaHttp(400, 'FILA_INVALIDA', 'La estación indicada no es del proyecto.');
    }
  }
  const [id] = await insertarFilasBorrador(db, actor, proyectoId, [f]);
  return id ?? '';
};

/**
 * Inserta filas al final del borrador (ya validadas contra el proyecto). La usan el alta fila por
 * fila y la carga de la programación por Excel o tabla (RF-W09).
 */
export const insertarFilasBorrador = async (
  db: Db,
  actor: Actor,
  proyectoId: string,
  filas: readonly FilaBorrador[],
): Promise<string[]> => {
  if (filas.length === 0) return [];
  const orden = await db
    .selectFrom('cronograma_borrador_item')
    .select(sql<number>`coalesce(max(orden), 0)`.as('n'))
    .where('proyecto_id', '=', proyectoId)
    .executeTakeFirstOrThrow();
  const valores = filas.map((f, i) => ({
    id: generarId(),
    proyecto_id: proyectoId,
    brigada_id: f.brigada_id,
    fecha: f.fecha,
    tipo_actividad: f.tipo_actividad,
    estacion_id: f.estacion_id,
    detalle: f.detalle,
    estado_fila: f.estado_fila ?? 'ok',
    actividad_especial: f.actividad_especial ?? null,
    orden: orden.n + i + 1,
    creado_por: actor.usuarioId,
    actualizado_por: actor.usuarioId,
  }));
  for (let i = 0; i < valores.length; i += 500) {
    await db
      .insertInto('cronograma_borrador_item')
      .values(valores.slice(i, i + 500))
      .execute();
  }
  return valores.map((v) => v.id);
};

/** Quita una fila del borrador: queda `descartada`, nada se borra. */
export const descartarFilaBorrador = async (
  db: Db,
  actor: Actor,
  filaId: string,
): Promise<void> => {
  exigirGlobal(actor, 'configurar_proyecto');
  const r = await db
    .updateTable('cronograma_borrador_item')
    .set({ estado: 'descartada', actualizado_por: actor.usuarioId })
    .where('id', '=', filaId)
    .where('estado', '=', 'borrador')
    .executeTakeFirst();
  if (r.numUpdatedRows === 0n) throw noEncontrado('La fila del borrador');
};

export const publicarBorrador = async (
  db: Db,
  actor: Actor,
  proyectoId: string,
  alCambiar?: AlCambiarCronograma,
) => {
  exigirGlobal(actor, 'configurar_proyecto');
  await exigirProyecto(db, proyectoId);
  const r = await db.transaction().execute(async (tx) => {
    // Dos publicaciones simultáneas: la segunda espera y encuentra el base ya creado.
    await tx.selectFrom('proyecto').select('id').where('id', '=', proyectoId).forUpdate().execute();
    if (await tieneBase(tx, proyectoId)) throw yaPublicado();
    const filas = await tx
      .selectFrom('cronograma_borrador_item')
      .select([
        'id',
        'brigada_id',
        sql<string>`to_char(fecha, 'YYYY-MM-DD')`.as('fecha'),
        'tipo_actividad',
        'estacion_id',
        'detalle',
        'estado_fila',
        'actividad_especial',
      ])
      .where('proyecto_id', '=', proyectoId)
      .where('estado', '=', 'borrador')
      .orderBy('fecha')
      .orderBy('orden')
      .execute();
    if (filas.length === 0) {
      throw new ProblemaHttp(
        409,
        'BORRADOR_VACIO',
        'Agregue al menos una actividad al borrador antes de publicarlo.',
      );
    }
    const desde = filas[0]?.fecha ?? null;
    const hasta = filas.at(-1)?.fecha ?? null;
    let campania = await tx
      .selectFrom('campania')
      .select('id')
      .where('proyecto_id', '=', proyectoId)
      .where('estado', '=', 'activa')
      .executeTakeFirst();
    if (campania === undefined) {
      const id = generarId();
      await tx
        .insertInto('campania')
        .values({
          id,
          proyecto_id: proyectoId,
          nombre: 'Campaña principal',
          fecha_inicio: desde,
          fecha_fin: hasta,
          creado_por: actor.usuarioId,
          actualizado_por: actor.usuarioId,
        })
        .execute();
      campania = { id };
    }
    const k = tx as unknown as Kysely<unknown>;
    const versionId = await crearCronogramaBase(k, {
      campaniaId: campania.id,
      usuarioId: actor.usuarioId,
      nuevoId: generarId,
      filas,
    });
    await tx
      .updateTable('cronograma_borrador_item')
      .set({ estado: 'publicada', version_id: versionId, actualizado_por: actor.usuarioId })
      .where(
        'id',
        'in',
        filas.map((f) => f.id),
      )
      .execute();
    // Las brigadas del cronograma quedan en la campaña.
    await tx
      .updateTable('brigada')
      .set({ campania_id: campania.id, actualizado_por: actor.usuarioId })
      .where('proyecto_id', '=', proyectoId)
      .where('campania_id', 'is', null)
      .where('id', 'in', [...new Set(filas.map((f) => f.brigada_id))])
      .execute();
    // Epífitas y cámaras trampa del borrador: decisión nominal, como en la carga de A01 (RN-28).
    await aplicarActividadesEspeciales(k, { proyectoId, versionId, usuarioId: actor.usuarioId });
    const reservas = await sincronizarReservas(k, { proyectoId, usuarioId: actor.usuarioId });
    return {
      version_id: versionId,
      numero: 1,
      filas: filas.length,
      reservas_creadas: reservas.creadas,
      reservas_programadas: reservas.ubicadas,
    };
  });
  // Después del commit: las áreas de mapa de las brigadas (un fallo solo queda en el log).
  await alCambiar?.(proyectoId, actor.usuarioId);
  return r;
};
