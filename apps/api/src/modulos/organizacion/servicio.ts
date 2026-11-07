import type { Db } from '@campo/db';
import { sql } from 'kysely';
import { randomBytes } from 'node:crypto';
import { hashContrasena } from '../../plataforma/contrasena.ts';
import { ProblemaHttp } from '../../plataforma/errores.ts';
import { generarId } from '../../plataforma/ids.ts';
import type { Actor } from '../../plataforma/sesion.ts';
import {
  exigirAdministracion,
  exigirSupervisor,
  noEncontrado,
  rolEnCuadrilla,
} from '../alcance/autorizacion.ts';
import { crearUsuario } from '../usuarios/servicio.ts';
import { punto } from '../sync/repositorio.ts';
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
  exigirSupervisor(actor);
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
  exigirSupervisor(actor);
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
  repo.proyectosVisibles(db, actor.usuarioId, actor.rolGlobal === 'supervisor');

/** Detalle del proyecto si es visible para el actor. */
export const verProyecto = async (db: Db, actor: Actor, id: string) => {
  const visibles = await listarProyectos(db, actor);
  const p = visibles.find((x) => x.id === id);
  if (p === undefined) throw noEncontrado('El proyecto');
  return p;
};

// ── Cuadrillas y miembros ───────────────────────────────────────────────────

export const crearCuadrilla = async (
  db: Db,
  actor: Actor,
  proyectoId: string,
  nombre: string,
  jefeId: string | null,
) => {
  exigirSupervisor(actor);
  if ((await repo.buscarProyecto(db, proyectoId)) === undefined) throw noEncontrado('El proyecto');
  const id = generarId();
  await db
    .insertInto('cuadrilla')
    .values({
      id,
      proyecto_id: proyectoId,
      nombre,
      jefe_id: jefeId,
      creado_por: actor.usuarioId,
      actualizado_por: actor.usuarioId,
    })
    .execute();
  return id;
};

export const actualizarCuadrilla = async (
  db: Db,
  actor: Actor,
  id: string,
  d: { nombre?: string; jefeId?: string | null },
) => {
  exigirSupervisor(actor);
  const r = await db
    .updateTable('cuadrilla')
    .set({
      ...(d.nombre === undefined ? {} : { nombre: d.nombre }),
      ...(d.jefeId === undefined ? {} : { jefe_id: d.jefeId }),
      actualizado_por: actor.usuarioId,
    })
    .where('id', '=', id)
    .executeTakeFirst();
  if (r.numUpdatedRows === 0n) throw noEncontrado('La cuadrilla');
};

export const listarCuadrillas = async (db: Db, actor: Actor, proyectoId: string) => {
  await verProyecto(db, actor, proyectoId);
  const todas = await repo.cuadrillasDeProyecto(db, proyectoId);
  const visibles: (typeof todas)[number][] = [];
  for (const c of todas) if ((await rolEnCuadrilla(db, actor, c.id)) !== null) visibles.push(c);
  return visibles;
};

export const listarMiembros = async (db: Db, actor: Actor, cuadrillaId: string) => {
  const rol = await rolEnCuadrilla(db, actor, cuadrillaId);
  // Los miembros solo los ven el supervisor y el jefe (RN-25: nada de terceros al especialista).
  if (rol !== 'supervisor' && rol !== 'jefe') throw noEncontrado('La cuadrilla');
  return repo.miembrosDeCuadrilla(db, cuadrillaId);
};

export const agregarMiembro = async (
  db: Db,
  actor: Actor,
  cuadrillaId: string,
  usuarioId: string,
  rol: 'especialista' | 'logistico',
) => {
  exigirSupervisor(actor);
  const id = generarId();
  try {
    await db
      .insertInto('miembro_cuadrilla')
      .values({
        id,
        cuadrilla_id: cuadrillaId,
        usuario_id: usuarioId,
        rol,
        creado_por: actor.usuarioId,
        actualizado_por: actor.usuarioId,
      })
      .execute();
  } catch (e) {
    unico(e, 'MIEMBRO_EXISTE', 'Esa persona ya está en la cuadrilla.');
  }
  return id;
};

export const cambiarMiembro = async (
  db: Db,
  actor: Actor,
  miembroId: string,
  estado: 'activo' | 'retirado',
) => {
  exigirSupervisor(actor);
  const r = await db
    .updateTable('miembro_cuadrilla')
    .set({ estado, actualizado_por: actor.usuarioId })
    .where('id', '=', miembroId)
    .executeTakeFirst();
  if (r.numUpdatedRows === 0n) throw noEncontrado('El miembro');
};

// ── Estaciones y metodologías ──────────────────────────────────────────────

export const listarMetodologias = (db: Db) =>
  db
    .selectFrom('catalogo_metodologia')
    .select(['id', 'nombre', 'unidad', 'requiere_transecto'])
    .orderBy('nombre')
    .execute();

export const crearMetodologia = async (
  db: Db,
  actor: Actor,
  d: { nombre: string; unidad: string; requiereTransecto: boolean },
) => {
  exigirSupervisor(actor);
  const id = generarId();
  try {
    await db
      .insertInto('catalogo_metodologia')
      .values({
        id,
        nombre: d.nombre,
        unidad: d.unidad,
        requiere_transecto: d.requiereTransecto,
        creado_por: actor.usuarioId,
        actualizado_por: actor.usuarioId,
      })
      .execute();
  } catch (e) {
    unico(e, 'METODOLOGIA_EXISTE', 'Ya existe una metodología con ese nombre.');
  }
  return id;
};

export const crearEstacion = async (
  db: Db,
  actor: Actor,
  proyectoId: string,
  d: { codigo: string; lat: number; lon: number },
) => {
  exigirSupervisor(actor);
  if ((await repo.buscarProyecto(db, proyectoId)) === undefined) throw noEncontrado('El proyecto');
  const id = generarId();
  try {
    await db
      .insertInto('estacion')
      .values({
        id,
        proyecto_id: proyectoId,
        codigo: d.codigo,
        geom: punto(d.lon, d.lat),
        creado_por: actor.usuarioId,
        actualizado_por: actor.usuarioId,
      })
      .execute();
  } catch (e) {
    unico(e, 'ESTACION_EXISTE', 'Ya existe una estación con ese código en el proyecto.');
  }
  return id;
};

export const programarMetodologia = async (
  db: Db,
  actor: Actor,
  estacionId: string,
  metodologiaId: string,
  meta: number | null,
) => {
  exigirSupervisor(actor);
  const id = generarId();
  try {
    await db
      .insertInto('estacion_metodologia')
      .values({
        id,
        estacion_id: estacionId,
        metodologia_id: metodologiaId,
        meta_esfuerzo: meta === null ? null : String(meta),
        creado_por: actor.usuarioId,
        actualizado_por: actor.usuarioId,
      })
      .execute();
  } catch (e) {
    unico(e, 'METODOLOGIA_PROGRAMADA', 'Esa metodología ya está en la estación.');
  }
  return id;
};

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
    rolGlobal: 'supervisor' | 'admin' | 'ninguno';
  },
) => {
  exigirAdministracion(actor);
  const contrasena = contrasenaTemporal();
  const id = await crearUsuario(db, { ...d, contrasena, creadoPor: actor.usuarioId });
  return { id, contrasenaTemporal: contrasena };
};

export const listarUsuarios = (db: Db, actor: Actor) => {
  // El supervisor necesita la lista para armar cuadrillas; el administrador, para gestionarlos.
  exigirAdministracion(actor);
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
  d: { estado?: 'activo' | 'inactivo'; rolGlobal?: 'supervisor' | 'admin' | 'ninguno' },
) => {
  exigirAdministracion(actor);
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
  exigirAdministracion(actor);
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
  exigirAdministracion(actor);
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
  exigirAdministracion(actor);
  const r = await db
    .updateTable('dispositivo')
    .set({ estado: 'baja_pendiente', actualizado_por: actor.usuarioId })
    .where('id', '=', id)
    .where('estado', '=', 'activo')
    .executeTakeFirst();
  if (r.numUpdatedRows === 0n) throw noEncontrado('El dispositivo activo');
};
