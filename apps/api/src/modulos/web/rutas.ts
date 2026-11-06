import { ESTADOS_TAREA } from '@campo/core';
import type { Db } from '@campo/db';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Firmador } from '../../plataforma/almacenamiento.ts';
import type { Auth } from '../../plataforma/auth.ts';
import { noAutenticado } from '../../plataforma/errores.ts';
import { requiereSesion, type Actor } from '../../plataforma/sesion.ts';
import { noEncontrado, rolEnCuadrilla } from '../alcance/autorizacion.ts';
import { rutaParaDescarga } from '../archivos/servicio.ts';
import * as org from '../organizacion/servicio.ts';
import * as consultas from '../tareas/consultas.ts';
import * as revisiones from '../tareas/revisiones.ts';
import * as tareas from '../tareas/servicio.ts';

interface Opciones {
  readonly auth: Auth;
  readonly db: Db;
  readonly firmador: Firmador;
}

const id = z.uuid();
const texto = (max: number) => z.string().trim().min(1).max(max);
const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora HH:MM');
const tipoDocumento = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2,10}$/);
const numDocumento = z
  .string()
  .trim()
  .regex(/^[0-9A-Za-z]{4,20}$/);
const rolGlobal = z.enum(['supervisor', 'admin', 'ninguno']);
const latitud = z.number().min(-90).max(90);
const longitud = z.number().min(-180).max(180);
const conId = z.object({ id });

const actor = (request: FastifyRequest): Actor => {
  if (request.actor === null) throw noAutenticado();
  return request.actor;
};

/** API de la web (doc. 03 §8). Todas las rutas exigen sesión y autorizan por rol + alcance. */
export const rutasWeb: FastifyPluginAsyncZod<Opciones> = (app, { auth, db, firmador }) => {
  app.addHook('preHandler', requiereSesion(auth, db));

  app.get('/yo', async (request) => {
    const a = actor(request);
    const u = await db
      .selectFrom('usuario')
      .select(['id', 'nombre', 'tipo_documento', 'num_documento', 'rol_global'])
      .where('id', '=', a.usuarioId)
      .executeTakeFirstOrThrow();
    const jefe = await db
      .selectFrom('cuadrilla')
      .select('id')
      .where('jefe_id', '=', a.usuarioId)
      .execute();
    const miembro = await db
      .selectFrom('miembro_cuadrilla')
      .select(['cuadrilla_id', 'rol'])
      .where('usuario_id', '=', a.usuarioId)
      .where('estado', '=', 'activo')
      .execute();
    return { ...u, cuadrillas_jefe: jefe.map((j) => j.id), membresias: miembro };
  });

  // ── Proyectos ──
  const datosProyecto = z.object({
    nombre: texto(200),
    validacion_activa: z.boolean(),
    subir_originales: z.boolean().default(false),
    dias_bloqueo: z.number().int().min(1).max(365).default(15),
    hora_cierre_jornada: hora.nullable().default(null),
  });

  app.get('/proyectos', async (request) => ({
    proyectos: await org.listarProyectos(db, actor(request)),
  }));
  app.get('/proyectos/:id', { schema: { params: conId } }, async (request) =>
    org.verProyecto(db, actor(request), request.params.id),
  );
  app.post('/proyectos', { schema: { body: datosProyecto } }, async (request, reply) => {
    const b = request.body;
    const nuevo = await org.crearProyecto(db, actor(request), {
      nombre: b.nombre,
      validacionActiva: b.validacion_activa,
      subirOriginales: b.subir_originales,
      diasBloqueo: b.dias_bloqueo,
      horaCierreJornada: b.hora_cierre_jornada,
    });
    return reply.status(201).send({ id: nuevo });
  });
  app.patch(
    '/proyectos/:id',
    {
      schema: {
        params: conId,
        body: z.object({
          nombre: texto(200).optional(),
          validacion_activa: z.boolean().optional(),
          subir_originales: z.boolean().optional(),
          dias_bloqueo: z.number().int().min(1).max(365).optional(),
          hora_cierre_jornada: hora.nullable().optional(),
          estado: z.enum(['activo', 'cerrado']).optional(),
        }),
      },
    },
    async (request, reply) => {
      const b = request.body;
      await org.actualizarProyecto(db, actor(request), request.params.id, {
        ...(b.nombre === undefined ? {} : { nombre: b.nombre }),
        ...(b.validacion_activa === undefined ? {} : { validacionActiva: b.validacion_activa }),
        ...(b.subir_originales === undefined ? {} : { subirOriginales: b.subir_originales }),
        ...(b.dias_bloqueo === undefined ? {} : { diasBloqueo: b.dias_bloqueo }),
        ...(b.hora_cierre_jornada === undefined
          ? {}
          : { horaCierreJornada: b.hora_cierre_jornada }),
        ...(b.estado === undefined ? {} : { estado: b.estado }),
      });
      return reply.status(204).send();
    },
  );

  // ── Cuadrillas y miembros ──
  app.get('/proyectos/:id/cuadrillas', { schema: { params: conId } }, async (request) => ({
    cuadrillas: await org.listarCuadrillas(db, actor(request), request.params.id),
  }));
  app.post(
    '/proyectos/:id/cuadrillas',
    {
      schema: {
        params: conId,
        body: z.object({ nombre: texto(120), jefe_id: id.nullable().default(null) }),
      },
    },
    async (request, reply) => {
      const nuevo = await org.crearCuadrilla(
        db,
        actor(request),
        request.params.id,
        request.body.nombre,
        request.body.jefe_id,
      );
      return reply.status(201).send({ id: nuevo });
    },
  );
  app.patch(
    '/cuadrillas/:id',
    {
      schema: {
        params: conId,
        body: z.object({ nombre: texto(120).optional(), jefe_id: id.nullable().optional() }),
      },
    },
    async (request, reply) => {
      await org.actualizarCuadrilla(db, actor(request), request.params.id, {
        ...(request.body.nombre === undefined ? {} : { nombre: request.body.nombre }),
        ...(request.body.jefe_id === undefined ? {} : { jefeId: request.body.jefe_id }),
      });
      return reply.status(204).send();
    },
  );
  app.get('/cuadrillas/:id/miembros', { schema: { params: conId } }, async (request) => ({
    miembros: await org.listarMiembros(db, actor(request), request.params.id),
  }));
  app.post(
    '/cuadrillas/:id/miembros',
    {
      schema: {
        params: conId,
        body: z.object({ usuario_id: id, rol: z.enum(['especialista', 'logistico']) }),
      },
    },
    async (request, reply) => {
      const nuevo = await org.agregarMiembro(
        db,
        actor(request),
        request.params.id,
        request.body.usuario_id,
        request.body.rol,
      );
      return reply.status(201).send({ id: nuevo });
    },
  );
  app.patch(
    '/miembros/:id',
    { schema: { params: conId, body: z.object({ estado: z.enum(['activo', 'retirado']) }) } },
    async (request, reply) => {
      await org.cambiarMiembro(db, actor(request), request.params.id, request.body.estado);
      return reply.status(204).send();
    },
  );

  // ── Estaciones y metodologías ──
  app.get('/metodologias', async () => ({ metodologias: await org.listarMetodologias(db) }));
  app.post(
    '/metodologias',
    {
      schema: {
        body: z.object({
          nombre: texto(120),
          unidad: texto(60),
          requiere_transecto: z.boolean().default(false),
        }),
      },
    },
    async (request, reply) => {
      const nuevo = await org.crearMetodologia(db, actor(request), {
        nombre: request.body.nombre,
        unidad: request.body.unidad,
        requiereTransecto: request.body.requiere_transecto,
      });
      return reply.status(201).send({ id: nuevo });
    },
  );
  app.get('/proyectos/:id/estaciones', { schema: { params: conId } }, async (request) => ({
    estaciones: await org.listarEstaciones(db, actor(request), request.params.id),
  }));
  app.post(
    '/proyectos/:id/estaciones',
    {
      schema: { params: conId, body: z.object({ codigo: texto(40), lat: latitud, lon: longitud }) },
    },
    async (request, reply) => {
      const nuevo = await org.crearEstacion(db, actor(request), request.params.id, request.body);
      return reply.status(201).send({ id: nuevo });
    },
  );
  app.post(
    '/estaciones/:id/metodologias',
    {
      schema: {
        params: conId,
        body: z.object({
          metodologia_id: id,
          meta_esfuerzo: z.number().nonnegative().nullable().default(null),
        }),
      },
    },
    async (request, reply) => {
      const nuevo = await org.programarMetodologia(
        db,
        actor(request),
        request.params.id,
        request.body.metodologia_id,
        request.body.meta_esfuerzo,
      );
      return reply.status(201).send({ id: nuevo });
    },
  );

  // ── Cuadernos y tareas ──
  app.get('/proyectos/:id/cuadernos', { schema: { params: conId } }, async (request) => ({
    cuadernos: await tareas.listarCuadernos(db, actor(request), request.params.id),
  }));
  app.post(
    '/cuadernos',
    {
      schema: {
        body: z.object({
          cuadrilla_id: id,
          responsable_id: id,
          titulo: texto(200),
          validacion_activa: z.boolean().nullable().default(null),
        }),
      },
    },
    async (request, reply) => {
      const nuevo = await tareas.crearCuaderno(db, actor(request), {
        cuadrillaId: request.body.cuadrilla_id,
        responsableId: request.body.responsable_id,
        titulo: request.body.titulo,
        validacionActiva: request.body.validacion_activa,
      });
      return reply.status(201).send({ id: nuevo });
    },
  );

  app.get(
    '/proyectos/:id/tareas',
    {
      schema: {
        params: conId,
        querystring: z.object({
          estado: z.enum(ESTADOS_TAREA).optional(),
          cuadrilla_id: id.optional(),
          origen: z.enum(['manual', 'regla']).optional(),
          tipo: z.enum(['tecnica', 'logistica']).optional(),
          despues_de: id.optional(),
          limite: z.coerce.number().int().min(1).max(100).default(50),
        }),
      },
    },
    async (request) =>
      consultas.listarTareas(db, actor(request), {
        proyectoId: request.params.id,
        estado: request.query.estado,
        cuadrillaId: request.query.cuadrilla_id,
        origen: request.query.origen,
        tipo: request.query.tipo,
        despuesDe: request.query.despues_de,
        limite: request.query.limite,
      }),
  );
  app.post(
    '/tareas',
    {
      schema: {
        body: z.object({
          cuaderno_id: id,
          titulo: texto(200),
          descripcion: z.string().trim().max(4000).nullable().default(null),
          tipo: z.enum(['tecnica', 'logistica']).default('tecnica'),
          estacion_id: id.nullable().default(null),
          metodologia_id: id.nullable().default(null),
          ubicacion: z.object({ lat: latitud, lon: longitud }).nullable().default(null),
        }),
      },
    },
    async (request, reply) => {
      const b = request.body;
      const nuevo = await tareas.crearTarea(db, actor(request), {
        cuadernoId: b.cuaderno_id,
        titulo: b.titulo,
        descripcion: b.descripcion,
        tipo: b.tipo,
        estacionId: b.estacion_id,
        metodologiaId: b.metodologia_id,
        ubicacion: b.ubicacion,
      });
      return reply.status(201).send({ id: nuevo });
    },
  );
  app.get('/tareas/:id', { schema: { params: conId } }, async (request) =>
    consultas.detalleTarea(db, actor(request), request.params.id),
  );
  app.post(
    '/tareas/:id/reasignar',
    { schema: { params: conId, body: z.object({ cuaderno_id: id }) } },
    async (request) => ({
      estado: await tareas.reasignar(
        db,
        actor(request),
        request.params.id,
        request.body.cuaderno_id,
      ),
    }),
  );
  app.post(
    '/tareas/:id/revocar',
    { schema: { params: conId, body: z.object({ motivo: z.string().max(1000) }) } },
    async (request) => ({
      estado: await tareas.revocar(db, actor(request), request.params.id, request.body.motivo),
    }),
  );
  app.post(
    '/tareas/:id/validar',
    {
      schema: {
        params: conId,
        body: z.object({ comentario: z.string().max(2000).nullable().default(null) }),
      },
    },
    async (request) =>
      tareas.validar(db, actor(request), request.params.id, false, request.body.comentario),
  );
  app.post(
    '/tareas/:id/observar',
    { schema: { params: conId, body: z.object({ comentario: texto(2000) }) } },
    async (request) =>
      tareas.validar(db, actor(request), request.params.id, true, request.body.comentario),
  );
  app.post(
    '/tareas/:id/reabrir',
    { schema: { params: conId, body: z.object({ motivo: z.string().max(1000) }) } },
    async (request) => ({
      estado: await tareas.reabrir(db, actor(request), request.params.id, request.body.motivo),
    }),
  );
  app.post(
    '/tareas/:id/cerrar',
    { schema: { params: conId, body: z.object({ comentario: z.string().max(2000) }) } },
    async (request) => ({
      estado: await tareas.cerrar(db, actor(request), request.params.id, request.body.comentario),
    }),
  );
  app.post(
    '/tareas/:id/comentarios',
    { schema: { params: conId, body: z.object({ texto: texto(2000) }) } },
    async (request, reply) => {
      const nuevo = await tareas.comentar(
        db,
        actor(request),
        request.params.id,
        request.body.texto,
      );
      return reply.status(201).send({ id: nuevo });
    },
  );

  // ── Avance, mapa y archivos ──
  app.get('/proyectos/:id/avance', { schema: { params: conId } }, async (request) =>
    consultas.avance(db, actor(request), request.params.id),
  );
  app.get('/proyectos/:id/mapa', { schema: { params: conId } }, async (request) =>
    consultas.mapa(db, actor(request), request.params.id),
  );
  app.get(
    '/archivos/:id/url',
    {
      schema: {
        params: conId,
        querystring: z.object({
          variante: z.enum(['miniatura', 'preview', 'original']).default('preview'),
        }),
      },
    },
    async (request) => {
      const a = actor(request);
      const clave = await rutaParaDescarga(
        db,
        a,
        (c) => rolEnCuadrilla(db, a, c),
        request.params.id,
        request.query.variante,
      );
      if (clave === null) throw noEncontrado('El archivo');
      return { url: await firmador.firmar(clave) };
    },
  );

  // ── Revisiones ──
  app.get('/proyectos/:id/revisiones', { schema: { params: conId } }, async (request) => ({
    revisiones: await revisiones.listarRevisiones(db, actor(request), request.params.id),
  }));
  app.post(
    '/revisiones/:id/resolver',
    {
      schema: {
        params: conId,
        body: z.object({
          decision: z.enum(['elegido', 'descartado']),
          comentario: z.string().max(2000).nullable().default(null),
        }),
      },
    },
    async (request, reply) => {
      await revisiones.resolverRevision(
        db,
        actor(request),
        request.params.id,
        request.body.decision,
        request.body.comentario,
      );
      return reply.status(204).send();
    },
  );

  // ── Administración ──
  app.get('/admin/usuarios', async (request) => ({
    usuarios: await org.listarUsuarios(db, actor(request)),
  }));
  app.post(
    '/admin/usuarios',
    {
      schema: {
        body: z.object({
          tipo_documento: tipoDocumento,
          num_documento: numDocumento,
          nombre: texto(200),
          rol_global: rolGlobal.default('ninguno'),
        }),
      },
    },
    async (request, reply) => {
      const r = await org.altaUsuario(db, actor(request), {
        tipoDocumento: request.body.tipo_documento,
        numDocumento: request.body.num_documento,
        nombre: request.body.nombre,
        rolGlobal: request.body.rol_global,
      });
      // La contraseña temporal se muestra una sola vez y no se guarda en claro.
      return reply
        .status(201)
        .header('cache-control', 'no-store')
        .send({ id: r.id, contrasena_temporal: r.contrasenaTemporal });
    },
  );
  app.patch(
    '/admin/usuarios/:id',
    {
      schema: {
        params: conId,
        body: z.object({
          estado: z.enum(['activo', 'inactivo']).optional(),
          rol_global: rolGlobal.optional(),
        }),
      },
    },
    async (request, reply) => {
      await org.cambiarUsuario(db, actor(request), request.params.id, {
        ...(request.body.estado === undefined ? {} : { estado: request.body.estado }),
        ...(request.body.rol_global === undefined ? {} : { rolGlobal: request.body.rol_global }),
      });
      return reply.status(204).send();
    },
  );
  app.post(
    '/admin/usuarios/:id/contrasena',
    { schema: { params: conId } },
    async (request, reply) => {
      const c = await org.restablecerContrasena(db, actor(request), request.params.id);
      return reply.header('cache-control', 'no-store').send({ contrasena_temporal: c });
    },
  );
  app.get('/admin/dispositivos', async (request) => ({
    dispositivos: await org.listarDispositivos(db, actor(request)),
  }));
  app.post(
    '/admin/dispositivos/:id/baja',
    { schema: { params: conId } },
    async (request, reply) => {
      await org.darDeBaja(db, actor(request), request.params.id);
      return reply.status(204).send();
    },
  );

  return Promise.resolve();
};
