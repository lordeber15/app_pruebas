import { nivelPermiso, type Accion, type Rol } from '@campo/core';
import type { Db } from '@campo/db';
import { noAutorizado, ProblemaHttp } from '../../plataforma/errores.ts';
import type { Actor } from '../../plataforma/sesion.ts';

/**
 * Autorización por rol + alcance (CLAUDE.md, Seguridad). El nivel lo da la matriz de core
 * (doc. 01 §2.3); aquí se resuelve qué rol tiene el actor en una brigada concreta.
 *
 * - Supervisor (rol global): todos los proyectos.
 * - Jefe: la brigada de la que es jefe.
 * - Especialista o logístico: miembro activo de la brigada; además solo lo suyo.
 * - Administrador (rol global): solo usuarios y dispositivos.
 */
export const rolEnBrigada = async (
  db: Db,
  actor: Actor,
  brigadaId: string,
): Promise<Rol | null> => {
  if (actor.rolGlobal === 'supervisor') return 'supervisor';
  const c = await db
    .selectFrom('brigada')
    .leftJoin('miembro_brigada as m', (j) =>
      j
        .onRef('m.brigada_id', '=', 'brigada.id')
        .on('m.usuario_id', '=', actor.usuarioId)
        .on('m.estado', '=', 'activo'),
    )
    .select(['brigada.jefe_id', 'm.rol'])
    .where('brigada.id', '=', brigadaId)
    .executeTakeFirst();
  if (c === undefined) return null;
  if (c.jefe_id === actor.usuarioId) return 'jefe';
  if (c.rol === 'especialista' || c.rol === 'logistico') return c.rol;
  return null;
};

/** Exige que el actor pueda modificar en esa brigada. Devuelve su rol ahí. */
export const exigirEnBrigada = async (
  db: Db,
  actor: Actor,
  accion: Accion,
  brigadaId: string,
): Promise<Rol> => {
  const rol = await rolEnBrigada(db, actor, brigadaId);
  const nivel = rol === null ? 'no' : nivelPermiso(rol, accion);
  if (rol === null || (nivel !== 'total' && nivel !== 'alcance')) throw noAutorizado();
  return rol;
};

/** Acciones de nivel global (configurar proyecto, crear brigadas): solo el supervisor. */
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
 * Brigadas visibles para el actor en un proyecto, con su rol en cada una.
 * Supervisor: todas. Jefe: las suyas. Miembro: la suya (pero solo verá lo propio).
 */
export const brigadasVisibles = async (
  db: Db,
  actor: Actor,
  proyectoId: string,
): Promise<ReadonlyMap<string, Rol>> => {
  const brigadas = await db
    .selectFrom('brigada')
    .leftJoin('miembro_brigada as m', (j) =>
      j
        .onRef('m.brigada_id', '=', 'brigada.id')
        .on('m.usuario_id', '=', actor.usuarioId)
        .on('m.estado', '=', 'activo'),
    )
    .select(['brigada.id', 'brigada.jefe_id', 'm.rol'])
    .where('brigada.proyecto_id', '=', proyectoId)
    .execute();
  const mapa = new Map<string, Rol>();
  for (const c of brigadas) {
    if (actor.rolGlobal === 'supervisor') mapa.set(c.id, 'supervisor');
    else if (c.jefe_id === actor.usuarioId) mapa.set(c.id, 'jefe');
    else if (c.rol === 'especialista' || c.rol === 'logistico') mapa.set(c.id, c.rol);
  }
  return mapa;
};

/** ¿El rol solo ve lo suyo (doc. 01 §2.3: en avance, mapa y galería el especialista ve lo suyo)? */
export const soloLoSuyo = (rol: Rol): boolean => rol === 'especialista' || rol === 'logistico';
