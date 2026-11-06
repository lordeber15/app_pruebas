import { nivelPermiso, type Accion, type Rol } from '@campo/core';
import type { Db } from '@campo/db';
import { noAutorizado, ProblemaHttp } from '../../plataforma/errores.ts';
import type { Actor } from '../../plataforma/sesion.ts';

/**
 * Autorización por rol + alcance (CLAUDE.md, Seguridad). El nivel lo da la matriz de core
 * (doc. 01 §2.3); aquí se resuelve qué rol tiene el actor en una cuadrilla concreta.
 *
 * - Supervisor (rol global): todos los proyectos.
 * - Jefe: la cuadrilla de la que es jefe.
 * - Especialista o logístico: miembro activo de la cuadrilla; además solo lo suyo.
 * - Administrador (rol global): solo usuarios y dispositivos.
 */
export const rolEnCuadrilla = async (
  db: Db,
  actor: Actor,
  cuadrillaId: string,
): Promise<Rol | null> => {
  if (actor.rolGlobal === 'supervisor') return 'supervisor';
  const c = await db
    .selectFrom('cuadrilla')
    .leftJoin('miembro_cuadrilla as m', (j) =>
      j
        .onRef('m.cuadrilla_id', '=', 'cuadrilla.id')
        .on('m.usuario_id', '=', actor.usuarioId)
        .on('m.estado', '=', 'activo'),
    )
    .select(['cuadrilla.jefe_id', 'm.rol'])
    .where('cuadrilla.id', '=', cuadrillaId)
    .executeTakeFirst();
  if (c === undefined) return null;
  if (c.jefe_id === actor.usuarioId) return 'jefe';
  if (c.rol === 'especialista' || c.rol === 'logistico') return c.rol;
  return null;
};

/** Exige que el actor pueda modificar en esa cuadrilla. Devuelve su rol ahí. */
export const exigirEnCuadrilla = async (
  db: Db,
  actor: Actor,
  accion: Accion,
  cuadrillaId: string,
): Promise<Rol> => {
  const rol = await rolEnCuadrilla(db, actor, cuadrillaId);
  const nivel = rol === null ? 'no' : nivelPermiso(rol, accion);
  if (rol === null || (nivel !== 'total' && nivel !== 'alcance')) throw noAutorizado();
  return rol;
};

/** Acciones de nivel global (configurar proyecto, crear cuadrillas): solo el supervisor. */
export const exigirSupervisor = (actor: Actor): void => {
  if (actor.rolGlobal !== 'supervisor') throw noAutorizado();
};

/** Usuarios y dispositivos: supervisor o administrador (doc. 01 §2.3). */
export const exigirAdministracion = (actor: Actor): void => {
  const rol = actor.rolGlobal === 'ninguno' ? null : actor.rolGlobal;
  if (rol === null || nivelPermiso(rol, 'administrar_usuarios') !== 'total') throw noAutorizado();
};

export const noEncontrado = (que: string): ProblemaHttp =>
  new ProblemaHttp(404, 'NO_ENCONTRADO', `${que} no existe o no está a su alcance.`);

/**
 * Cuadrillas visibles para el actor en un proyecto, con su rol en cada una.
 * Supervisor: todas. Jefe: las suyas. Miembro: la suya (pero solo verá lo propio).
 */
export const cuadrillasVisibles = async (
  db: Db,
  actor: Actor,
  proyectoId: string,
): Promise<ReadonlyMap<string, Rol>> => {
  const cuadrillas = await db
    .selectFrom('cuadrilla')
    .leftJoin('miembro_cuadrilla as m', (j) =>
      j
        .onRef('m.cuadrilla_id', '=', 'cuadrilla.id')
        .on('m.usuario_id', '=', actor.usuarioId)
        .on('m.estado', '=', 'activo'),
    )
    .select(['cuadrilla.id', 'cuadrilla.jefe_id', 'm.rol'])
    .where('cuadrilla.proyecto_id', '=', proyectoId)
    .execute();
  const mapa = new Map<string, Rol>();
  for (const c of cuadrillas) {
    if (actor.rolGlobal === 'supervisor') mapa.set(c.id, 'supervisor');
    else if (c.jefe_id === actor.usuarioId) mapa.set(c.id, 'jefe');
    else if (c.rol === 'especialista' || c.rol === 'logistico') mapa.set(c.id, c.rol);
  }
  return mapa;
};

/** ¿El rol solo ve lo suyo (doc. 01 §2.3: en avance, mapa y galería el especialista ve lo suyo)? */
export const soloLoSuyo = (rol: Rol): boolean => rol === 'especialista' || rol === 'logistico';
