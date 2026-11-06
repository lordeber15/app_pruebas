import { ESTADOS_TAREA, type EstadoTarea, type Rol } from '@campo/core';
import type { Db } from '@campo/db';
import { sql } from 'kysely';
import type { Actor } from '../../plataforma/sesion.ts';
import { cuadrillasVisibles, noEncontrado, soloLoSuyo } from '../alcance/autorizacion.ts';
import { tareaVisible } from './servicio.ts';

/**
 * Lecturas de la web: centro de tareas, detalle, avance y mapa. Todas filtran por alcance en la
 * consulta (doc. 02 §11.1, IDOR): supervisor todo el proyecto, jefe sus cuadrillas,
 * especialista y logístico solo lo suyo.
 */

interface Alcance {
  readonly todas: readonly string[];
  readonly propias: readonly string[];
}

/** Cuadrillas con acceso total (supervisor/jefe) y cuadrillas donde solo ve lo propio. */
const alcanceEn = async (db: Db, actor: Actor, proyectoId: string): Promise<Alcance> => {
  const mapa = await cuadrillasVisibles(db, actor, proyectoId);
  const todas: string[] = [];
  const propias: string[] = [];
  for (const [id, rol] of mapa) (soloLoSuyo(rol) ? propias : todas).push(id);
  return { todas, propias };
};

export interface FiltrosTareas {
  readonly proyectoId: string;
  readonly estado?: EstadoTarea | undefined;
  readonly cuadrillaId?: string | undefined;
  readonly origen?: 'manual' | 'regla' | undefined;
  readonly tipo?: 'tecnica' | 'logistica' | undefined;
  readonly despuesDe?: string | undefined;
  readonly limite: number;
}

/** Centro de tareas (RF-W03, CP-042): filtros por estado, cuadrilla, origen y tipo; cursor por id. */
export const listarTareas = async (db: Db, actor: Actor, f: FiltrosTareas) => {
  const a = await alcanceEn(db, actor, f.proyectoId);
  if (a.todas.length === 0 && a.propias.length === 0) return { tareas: [], siguiente: null };
  const filas = await db
    .selectFrom('tarea')
    .innerJoin('cuaderno', 'cuaderno.id', 'tarea.cuaderno_id')
    .innerJoin('cuadrilla', 'cuadrilla.id', 'cuaderno.cuadrilla_id')
    .innerJoin('usuario as r', 'r.id', 'cuaderno.responsable_id')
    .select([
      'tarea.id',
      'tarea.titulo',
      'tarea.estado',
      'tarea.origen',
      'tarea.tipo',
      'tarea.actualizado_en',
      'tarea.creado_en',
      'cuaderno.id as cuaderno_id',
      'cuaderno.titulo as cuaderno_titulo',
      'cuadrilla.id as cuadrilla_id',
      'cuadrilla.nombre as cuadrilla_nombre',
      'r.nombre as responsable_nombre',
      sql<number | null>`ST_Y(ST_PointOnSurface(tarea.geom))`.as('lat'),
      sql<number | null>`ST_X(ST_PointOnSurface(tarea.geom))`.as('lon'),
    ])
    .where('tarea.proyecto_id', '=', f.proyectoId)
    .where((eb) => {
      const ramas = [];
      if (a.todas.length > 0) ramas.push(eb('cuaderno.cuadrilla_id', 'in', a.todas));
      if (a.propias.length > 0) {
        ramas.push(
          eb.and([
            eb('cuaderno.cuadrilla_id', 'in', a.propias),
            eb('cuaderno.responsable_id', '=', actor.usuarioId),
          ]),
        );
      }
      return eb.or(ramas);
    })
    .$if(f.estado !== undefined, (q) => q.where('tarea.estado', '=', f.estado ?? ''))
    .$if(f.cuadrillaId !== undefined, (q) =>
      q.where('cuaderno.cuadrilla_id', '=', f.cuadrillaId ?? ''),
    )
    .$if(f.origen !== undefined, (q) => q.where('tarea.origen', '=', f.origen ?? ''))
    .$if(f.tipo !== undefined, (q) => q.where('tarea.tipo', '=', f.tipo ?? ''))
    .$if(f.despuesDe !== undefined, (q) => q.where('tarea.id', '>', f.despuesDe ?? ''))
    .orderBy('tarea.id')
    .limit(f.limite + 1)
    .execute();
  const hayMas = filas.length > f.limite;
  const tareas = hayMas ? filas.slice(0, f.limite) : filas;
  return { tareas, siguiente: hayMas ? (tareas.at(-1)?.id ?? null) : null };
};

/** Detalle de la tarea con asignaciones, archivos, comentarios e historial de eventos. */
export const detalleTarea = async (db: Db, actor: Actor, tareaId: string) => {
  const { rol } = await tareaVisible(db, actor, tareaId);
  const tarea = await db
    .selectFrom('tarea')
    .innerJoin('cuaderno', 'cuaderno.id', 'tarea.cuaderno_id')
    .innerJoin('cuadrilla', 'cuadrilla.id', 'cuaderno.cuadrilla_id')
    .innerJoin('proyecto', 'proyecto.id', 'tarea.proyecto_id')
    .innerJoin('usuario as r', 'r.id', 'cuaderno.responsable_id')
    .leftJoin('estacion', 'estacion.id', 'tarea.estacion_id')
    .leftJoin('catalogo_metodologia as m', 'm.id', 'tarea.metodologia_id')
    .select([
      'tarea.id',
      'tarea.titulo',
      'tarea.descripcion',
      'tarea.estado',
      'tarea.origen',
      'tarea.tipo',
      'tarea.version',
      'tarea.creado_en',
      'tarea.actualizado_en',
      'proyecto.id as proyecto_id',
      'proyecto.nombre as proyecto_nombre',
      'cuaderno.id as cuaderno_id',
      'cuaderno.titulo as cuaderno_titulo',
      'cuadrilla.id as cuadrilla_id',
      'cuadrilla.nombre as cuadrilla_nombre',
      'r.nombre as responsable_nombre',
      'estacion.codigo as estacion_codigo',
      'm.nombre as metodologia_nombre',
      sql<boolean>`coalesce(cuaderno.validacion_activa, proyecto.validacion_activa)`.as(
        'validacion_activa',
      ),
      sql<number | null>`ST_Y(ST_PointOnSurface(tarea.geom))`.as('lat'),
      sql<number | null>`ST_X(ST_PointOnSurface(tarea.geom))`.as('lon'),
    ])
    .where('tarea.id', '=', tareaId)
    .executeTakeFirstOrThrow();

  const [asignaciones, archivos, comentarios, eventos, evidencias] = await Promise.all([
    db
      .selectFrom('asignacion')
      .innerJoin('usuario', 'usuario.id', 'asignacion.usuario_id')
      .select([
        'asignacion.id',
        'asignacion.estado',
        'asignacion.descargada_en',
        'asignacion.finalizada_en',
        'asignacion.motivo_revocacion',
        'usuario.nombre as usuario_nombre',
      ])
      .where('asignacion.tarea_id', '=', tareaId)
      .orderBy('asignacion.descargada_en')
      .execute(),
    db
      .selectFrom('archivo')
      .select([
        'id',
        'tipo',
        'estado',
        'evidencia_item_id',
        'capturado_en',
        'precision_m',
        sql<number | null>`ST_Y(geom)`.as('lat'),
        sql<number | null>`ST_X(geom)`.as('lon'),
        sql<boolean>`ruta_miniatura is not null`.as('tiene_miniatura'),
      ])
      .where('tarea_id', '=', tareaId)
      .orderBy('capturado_en')
      .execute(),
    db
      .selectFrom('comentario')
      .innerJoin('usuario', 'usuario.id', 'comentario.autor_id')
      .select([
        'comentario.id',
        'comentario.texto',
        'comentario.creado_en',
        'usuario.nombre as autor_nombre',
      ])
      .where('comentario.tarea_id', '=', tareaId)
      .orderBy('comentario.creado_en')
      .execute(),
    db
      .selectFrom('evento')
      .innerJoin('usuario', 'usuario.id', 'evento.usuario_id')
      .select([
        'evento.id',
        'evento.tipo',
        'evento.estado',
        'evento.motivo',
        'evento.hora_servidor',
        'evento.hora_dispositivo',
        'usuario.nombre as usuario_nombre',
      ])
      .where('evento.entidad_tipo', '=', 'tarea')
      .where('evento.entidad_id', '=', tareaId)
      .orderBy('evento.hora_servidor')
      .execute(),
    db
      .selectFrom('evidencia_item')
      .select(['id', 'descripcion', 'orden'])
      .where('tarea_id', '=', tareaId)
      .orderBy('orden')
      .execute(),
  ]);
  return {
    tarea,
    asignaciones,
    archivos,
    comentarios,
    eventos,
    evidencias,
    permisos: permisosDe(rol),
  };
};

/** Qué acciones mostrar en la interfaz. La API vuelve a validar cada una (ocultar no es un control). */
const permisosDe = (rol: Rol) => ({
  gestionar: rol === 'supervisor' || rol === 'jefe',
  comentar: true,
});

/** Avance del proyecto (RF-W07): tareas por estado y cuadrilla, y esfuerzo contra la meta. */
export const avance = async (db: Db, actor: Actor, proyectoId: string) => {
  const a = await alcanceEn(db, actor, proyectoId);
  if (a.todas.length === 0 && a.propias.length === 0) throw noEncontrado('El proyecto');
  const porEstado = await db
    .selectFrom('tarea')
    .innerJoin('cuaderno', 'cuaderno.id', 'tarea.cuaderno_id')
    .innerJoin('cuadrilla', 'cuadrilla.id', 'cuaderno.cuadrilla_id')
    .select([
      'cuadrilla.id as cuadrilla_id',
      'cuadrilla.nombre as cuadrilla_nombre',
      'tarea.estado',
      (eb) => eb.fn.countAll<string>().as('n'),
    ])
    .where('tarea.proyecto_id', '=', proyectoId)
    .where((eb) => {
      const ramas = [];
      if (a.todas.length > 0) ramas.push(eb('cuaderno.cuadrilla_id', 'in', a.todas));
      if (a.propias.length > 0) {
        ramas.push(
          eb.and([
            eb('cuaderno.cuadrilla_id', 'in', a.propias),
            eb('cuaderno.responsable_id', '=', actor.usuarioId),
          ]),
        );
      }
      return eb.or(ramas);
    })
    .groupBy(['cuadrilla.id', 'cuadrilla.nombre', 'tarea.estado'])
    .execute();

  // RN-19: el esfuerzo es la suma de las filas de todos los usuarios.
  const esfuerzo = await db
    .selectFrom('estacion_metodologia as em')
    .innerJoin('estacion as e', 'e.id', 'em.estacion_id')
    .innerJoin('catalogo_metodologia as m', 'm.id', 'em.metodologia_id')
    .leftJoin('registro_esfuerzo as r', 'r.estacion_metodologia_id', 'em.id')
    .select([
      'em.id',
      'e.codigo as estacion',
      'm.nombre as metodologia',
      'm.unidad',
      'em.meta_esfuerzo',
      sql<string>`coalesce(sum(r.cantidad), 0)`.as('total'),
    ])
    .where('e.proyecto_id', '=', proyectoId)
    .$if(a.todas.length === 0, (q) => q.where('r.usuario_id', '=', actor.usuarioId))
    .groupBy(['em.id', 'e.codigo', 'm.nombre', 'm.unidad', 'em.meta_esfuerzo'])
    .orderBy('e.codigo')
    .execute();

  const cuadrillas = new Map<
    string,
    { id: string; nombre: string; estados: Partial<Record<EstadoTarea, number>> }
  >();
  for (const f of porEstado) {
    const c = cuadrillas.get(f.cuadrilla_id) ?? {
      id: f.cuadrilla_id,
      nombre: f.cuadrilla_nombre,
      estados: {},
    };
    const estado = ESTADOS_TAREA.find((e) => e === f.estado);
    if (estado !== undefined) c.estados[estado] = Number(f.n);
    cuadrillas.set(f.cuadrilla_id, c);
  }
  return {
    cuadrillas: [...cuadrillas.values()],
    esfuerzo: esfuerzo.map((e) => ({
      ...e,
      total: Number(e.total),
      meta: e.meta_esfuerzo === null ? null : Number(e.meta_esfuerzo),
    })),
  };
};

/** Mapa (RF-W02): tareas y estaciones del proyecto como GeoJSON, dentro del alcance. */
export const mapa = async (db: Db, actor: Actor, proyectoId: string) => {
  const { tareas } = await listarTareas(db, actor, { proyectoId, limite: 5000 });
  const estaciones = await db
    .selectFrom('estacion')
    .select(['id', 'codigo', sql<number>`ST_Y(geom)`.as('lat'), sql<number>`ST_X(geom)`.as('lon')])
    .where('proyecto_id', '=', proyectoId)
    .execute();
  const punto = (lon: number, lat: number) => ({ type: 'Point' as const, coordinates: [lon, lat] });
  return {
    type: 'FeatureCollection' as const,
    features: [
      ...tareas
        .filter((t) => t.lat !== null && t.lon !== null)
        .map((t) => ({
          type: 'Feature' as const,
          geometry: punto(t.lon ?? 0, t.lat ?? 0),
          properties: {
            capa: 'tarea',
            id: t.id,
            titulo: t.titulo,
            estado: t.estado,
            cuadrilla: t.cuadrilla_nombre,
          },
        })),
      ...estaciones.map((e) => ({
        type: 'Feature' as const,
        geometry: punto(e.lon, e.lat),
        properties: { capa: 'estacion', id: e.id, codigo: e.codigo },
      })),
    ],
  };
};
