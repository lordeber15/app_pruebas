import type { RolBrigada, ValorRolGlobal } from '@campo/core';
import type { Db } from '@campo/db';
import { sql } from 'kysely';
import { randomBytes } from 'node:crypto';
import { hashContrasena } from '../../plataforma/contrasena.ts';
import { ProblemaHttp } from '../../plataforma/errores.ts';
import { generarId } from '../../plataforma/ids.ts';
import type { Actor } from '../../plataforma/sesion.ts';
import {
  exigirGlobal,
  noEncontrado,
  rolEnBrigada,
  veTodosLosProyectos,
} from '../alcance/autorizacion.ts';
import { crearUsuario } from '../usuarios/servicio.ts';
import * as repo from './repositorio.ts';

/** RN-27: hasta 6 proyectos activos por instalación. */
export const MAX_PROYECTOS_ACTIVOS = 6;

const bloquearCupoProyectos = async (tx: Db): Promise<void> => {
  await sql`select pg_advisory_xact_lock(hashtext('cupo_proyectos_activos'))`.execute(tx);
};

const unico = (e: unknown, codigo: string, detalle: string): never => {
  if ((e as { code?: string }).code === '23505') throw new ProblemaHttp(409, codigo, detalle);
  throw e;
};

// ── Proyectos ────────────────────────────────────────────────────────────────

export interface DatosProyecto {
  readonly nombre: string;
  readonly validacionActiva: boolean;
  readonly subirOriginales: boolean;
  readonly diasBloqueo: number;
  readonly horaCierreJornada: string | null;
}

export const crearProyecto = async (db: Db, actor: Actor, d: DatosProyecto) => {
  exigirGlobal(actor, 'configurar_proyecto');
  return db.transaction().execute(async (tx) => {
    // Candado de transacción: dos altas simultáneas no pueden superar el máximo.
    await bloquearCupoProyectos(tx);
    if ((await repo.contarProyectosActivos(tx)) >= MAX_PROYECTOS_ACTIVOS) {
      throw new ProblemaHttp(
        409,
        'MAXIMO_PROYECTOS',
        'Ya hay 6 proyectos activos. Cierre uno antes de crear otro.',
      );
    }
    const id = generarId();
    await tx
      .insertInto('proyecto')
      .values({
        id,
        nombre: d.nombre,
        validacion_activa: d.validacionActiva,
        subir_originales: d.subirOriginales,
        dias_bloqueo: d.diasBloqueo,
        hora_cierre_jornada: d.horaCierreJornada,
        creado_por: actor.usuarioId,
        actualizado_por: actor.usuarioId,
      })
      .execute();
    return id;
  });
};

export const actualizarProyecto = async (
  db: Db,
  actor: Actor,
  id: string,
  d: Partial<DatosProyecto> & { estado?: 'activo' | 'cerrado' },
) => {
  exigirGlobal(actor, 'configurar_proyecto');
  await db.transaction().execute(async (tx) => {
    const actual = await tx
      .selectFrom('proyecto')
      .select('estado')
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (actual === undefined) throw noEncontrado('El proyecto');
    if (d.estado === 'activo' && actual.estado !== 'activo') {
      await bloquearCupoProyectos(tx);
      if ((await repo.contarProyectosActivos(tx)) >= MAX_PROYECTOS_ACTIVOS) {
        throw new ProblemaHttp(409, 'MAXIMO_PROYECTOS', 'Ya hay 6 proyectos activos.');
      }
    }
    await tx
      .updateTable('proyecto')
      .set({
        ...(d.nombre === undefined ? {} : { nombre: d.nombre }),
        ...(d.validacionActiva === undefined ? {} : { validacion_activa: d.validacionActiva }),
        ...(d.subirOriginales === undefined ? {} : { subir_originales: d.subirOriginales }),
        ...(d.diasBloqueo === undefined ? {} : { dias_bloqueo: d.diasBloqueo }),
        ...(d.horaCierreJornada === undefined ? {} : { hora_cierre_jornada: d.horaCierreJornada }),
        ...(d.estado === undefined ? {} : { estado: d.estado }),
        actualizado_por: actor.usuarioId,
      })
      .where('id', '=', id)
      .execute();
  });
};

export const listarProyectos = (db: Db, actor: Actor) =>
  repo.proyectosVisibles(db, actor.usuarioId, veTodosLosProyectos(actor));

/** Detalle del proyecto si es visible para el actor. */
export const verProyecto = async (db: Db, actor: Actor, id: string) => {
  const visibles = await listarProyectos(db, actor);
  const p = visibles.find((x) => x.id === id);
  if (p === undefined) throw noEncontrado('El proyecto');
  return p;
};

// ── Brigadas y miembros ───────────────────────────────────────────────────

export const crearBrigada = async (db: Db, actor: Actor, proyectoId: string, nombre: string) => {
  exigirGlobal(actor, 'configurar_proyecto');
  if ((await repo.buscarProyecto(db, proyectoId)) === undefined) throw noEncontrado('El proyecto');
  const id = generarId();
  await db
    .insertInto('brigada')
    .values({
      id,
      proyecto_id: proyectoId,
      nombre,
      creado_por: actor.usuarioId,
      actualizado_por: actor.usuarioId,
    })
    .execute();
  return id;
};

export const actualizarBrigada = async (
  db: Db,
  actor: Actor,
  id: string,
  d: { nombre?: string },
) => {
  exigirGlobal(actor, 'configurar_proyecto');
  const r = await db
    .updateTable('brigada')
    .set({
      ...(d.nombre === undefined ? {} : { nombre: d.nombre }),
      actualizado_por: actor.usuarioId,
    })
    .where('id', '=', id)
    .executeTakeFirst();
  if (r.numUpdatedRows === 0n) throw noEncontrado('La brigada');
};

export const listarBrigadas = async (db: Db, actor: Actor, proyectoId: string) => {
  await verProyecto(db, actor, proyectoId);
  const todas = await repo.brigadasDeProyecto(db, proyectoId);
  const visibles: (typeof todas)[number][] = [];
  for (const c of todas) if ((await rolEnBrigada(db, actor, c.id)) !== null) visibles.push(c);
  return visibles;
};

export const listarMiembros = async (db: Db, actor: Actor, brigadaId: string) => {
  const rol = await rolEnBrigada(db, actor, brigadaId);
  // Los miembros los ven Coordinación, JdP y el Jefe de Brigada de la suya (RN-25: nada de
  // terceros al especialista ni al supervisor de campo).
  if (rol !== 'coordinacion' && rol !== 'jefe_proyecto' && rol !== 'jefe_brigada') {
    throw noEncontrado('La brigada');
  }
  return repo.miembrosDeBrigada(db, brigadaId);
};

export const agregarMiembro = async (
  db: Db,
  actor: Actor,
  brigadaId: string,
  usuarioId: string,
  rol: RolBrigada,
) => {
  exigirGlobal(actor, 'configurar_proyecto');
  const id = generarId();
  try {
    await db
      .insertInto('miembro_brigada')
      .values({
        id,
        brigada_id: brigadaId,
        usuario_id: usuarioId,
        rol,
        creado_por: actor.usuarioId,
        actualizado_por: actor.usuarioId,
      })
      .execute();
  } catch (e) {
    unico(e, 'MIEMBRO_EXISTE', 'Esa persona ya está en la brigada.');
  }
  return id;
};

export const cambiarMiembro = async (
  db: Db,
  actor: Actor,
  miembroId: string,
  estado: 'activo' | 'retirado',
) => {
  exigirGlobal(actor, 'configurar_proyecto');
  const r = await db
    .updateTable('miembro_brigada')
    .set({ estado, actualizado_por: actor.usuarioId })
    .where('id', '=', miembroId)
    .executeTakeFirst();
  if (r.numUpdatedRows === 0n) throw noEncontrado('El miembro');
};

// ── Estaciones (A01) ─────────────────────────────────────────────────────────

export const listarEstaciones = async (db: Db, actor: Actor, proyectoId: string) => {
  await verProyecto(db, actor, proyectoId);
  return repo.estacionesDeProyecto(db, proyectoId);
};

// ── Usuarios (administración) ──────────────────────────────────────────────

/** Contraseña temporal legible (sin caracteres ambiguos), se muestra una sola vez. */
const contrasenaTemporal = (): string => {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from(randomBytes(12), (b) => alfabeto[b % alfabeto.length] ?? 'x').join('');
};

export const altaUsuario = async (
  db: Db,
  actor: Actor,
  d: {
    tipoDocumento: string;
    numDocumento: string;
    nombre: string;
    rolGlobal: ValorRolGlobal;
  },
) => {
  exigirGlobal(actor, 'administrar_usuarios');
  const contrasena = contrasenaTemporal();
  const id = await crearUsuario(db, { ...d, contrasena, creadoPor: actor.usuarioId });
  return { id, contrasenaTemporal: contrasena };
};

export const listarUsuarios = (db: Db, actor: Actor) => {
  // Coordinación y JdP la necesitan para armar brigadas; el administrador, para gestionarlos.
  exigirGlobal(actor, 'administrar_usuarios');
  return db
    .selectFrom('usuario')
    .select(['id', 'tipo_documento', 'num_documento', 'nombre', 'rol_global', 'estado'])
    .orderBy('nombre')
    .execute();
};

export const cambiarUsuario = async (
  db: Db,
  actor: Actor,
  id: string,
  d: { estado?: 'activo' | 'inactivo'; rolGlobal?: ValorRolGlobal },
) => {
  exigirGlobal(actor, 'administrar_usuarios');
  if (id === actor.usuarioId && (d.estado === 'inactivo' || d.rolGlobal !== undefined)) {
    throw new ProblemaHttp(
      409,
      'AUTOMODIFICACION',
      'No puede desactivarse ni cambiar su propio rol.',
    );
  }
  const r = await db
    .updateTable('usuario')
    .set({
      ...(d.estado === undefined ? {} : { estado: d.estado }),
      ...(d.rolGlobal === undefined ? {} : { rol_global: d.rolGlobal }),
      actualizado_por: actor.usuarioId,
    })
    .where('id', '=', id)
    .executeTakeFirst();
  if (r.numUpdatedRows === 0n) throw noEncontrado('El usuario');
  if (d.estado === 'inactivo') {
    // Cierra sus sesiones abiertas.
    await db.deleteFrom('auth_session').where('user_id', '=', id).execute();
  }
};

export const restablecerContrasena = async (db: Db, actor: Actor, id: string) => {
  exigirGlobal(actor, 'administrar_usuarios');
  const contrasena = contrasenaTemporal();
  const r = await db
    .updateTable('auth_account')
    .set({ password: await hashContrasena(contrasena), updated_at: new Date() })
    .where('user_id', '=', id)
    .where('provider_id', '=', 'credential')
    .executeTakeFirst();
  if (r.numUpdatedRows === 0n) throw noEncontrado('El usuario');
  await db.deleteFrom('auth_session').where('user_id', '=', id).execute();
  return contrasena;
};

export const listarDispositivos = (db: Db, actor: Actor) => {
  exigirGlobal(actor, 'administrar_usuarios');
  return db
    .selectFrom('dispositivo')
    .innerJoin('usuario', 'usuario.id', 'dispositivo.usuario_id')
    .select([
      'dispositivo.id',
      'dispositivo.plataforma',
      'dispositivo.version_app',
      'dispositivo.estado',
      'dispositivo.ultimo_sync_en',
      'dispositivo.creado_en',
      'usuario.nombre as usuario_nombre',
    ])
    .orderBy('dispositivo.creado_en', 'desc')
    .execute();
};

/** Baja remota (RF-M17): se ejecuta en la siguiente conexión del celular. */
export const darDeBaja = async (db: Db, actor: Actor, id: string) => {
  exigirGlobal(actor, 'administrar_usuarios');
  const r = await db
    .updateTable('dispositivo')
    .set({ estado: 'baja_pendiente', actualizado_por: actor.usuarioId })
    .where('id', '=', id)
    .where('estado', '=', 'activo')
    .executeTakeFirst();
  if (r.numUpdatedRows === 0n) throw noEncontrado('El dispositivo activo');
};
