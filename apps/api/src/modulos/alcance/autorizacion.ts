import { esRolBrigada, esRolGlobal, nivelPermiso, type Accion, type Rol } from '@campo/core';
import type { Db } from '@campo/db';
import { noAutorizado, ProblemaHttp } from '../../plataforma/errores.ts';
import type { Actor } from '../../plataforma/sesion.ts';

/**
 * Autorización por rol + alcance (CLAUDE.md, Seguridad). El nivel lo da la matriz de core
 * (ERS §2.3); aquí se resuelve qué rol tiene el actor en una brigada concreta.
 *
 * - Coordinación y Jefe de Proyecto (roles globales): todas las brigadas.
 * - Especialista, Supervisor de campo y Jefe de Brigada: miembro activo de la brigada; el
 *   especialista además solo ve lo suyo.
 * - Administrador técnico (rol global): solo usuarios y dispositivos; ninguna brigada.
 */
export const rolEnBrigada = async (
  db: Db,
  actor: Actor,
  brigadaId: string,
): Promise<Rol | null> => {
  const brigada = await db
    .selectFrom('brigada')
    .leftJoin('miembro_brigada as m', (j) =>
      j
        .onRef('m.brigada_id', '=', 'brigada.id')
        .on('m.usuario_id', '=', actor.usuarioId)
        .on('m.estado', '=', 'activo'),
    )
    .select(['brigada.id', 'm.rol'])
    .where('brigada.id', '=', brigadaId)
    .executeTakeFirst();
  if (brigada === undefined) return null;
  if (actor.rolGlobal === 'coordinacion' || actor.rolGlobal === 'jefe_proyecto') {
    return actor.rolGlobal;
  }
  return brigada.rol !== null && esRolBrigada(brigada.rol) ? brigada.rol : null;
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

/**
 * Acciones de nivel global (configurar el proyecto, administrar usuarios): exigen un rol global
 * con permiso total para la acción.
 */
export const exigirGlobal = (actor: Actor, accion: Accion): void => {
  const rol = esRolGlobal(actor.rolGlobal) ? actor.rolGlobal : null;
  if (rol === null || nivelPermiso(rol, accion) !== 'total') throw noAutorizado();
};

/** ¿Ve todos los proyectos? Solo Coordinación y Jefe de Proyecto. */
export const veTodosLosProyectos = (actor: Actor): boolean =>
  actor.rolGlobal === 'coordinacion' || actor.rolGlobal === 'jefe_proyecto';

export const noEncontrado = (que: string): ProblemaHttp =>
  new ProblemaHttp(404, 'NO_ENCONTRADO', `${que} no existe o no está a su alcance.`);

/**
 * Brigadas visibles para el actor en un proyecto, con su rol en cada una.
 * Coordinación y JdP: todas. Miembros: la suya (el especialista solo verá lo propio).
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
    .select(['brigada.id', 'm.rol'])
    .where('brigada.proyecto_id', '=', proyectoId)
    .execute();
  const mapa = new Map<string, Rol>();
  for (const b of brigadas) {
    if (actor.rolGlobal === 'coordinacion' || actor.rolGlobal === 'jefe_proyecto') {
      mapa.set(b.id, actor.rolGlobal);
    } else if (b.rol !== null && esRolBrigada(b.rol)) mapa.set(b.id, b.rol);
  }
  return mapa;
};

/** ERS §2.3: en el seguimiento (dashboard, mapa, galería) el especialista solo ve lo suyo. */
export const soloLoSuyo = (rol: Rol): boolean => rol === 'especialista';
