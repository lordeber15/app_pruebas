import { cambioContrasenaSchema, ROLES_BRIGADA, VALORES_ROL_GLOBAL } from '@campo/core';
import type { Db } from '@campo/db';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Firmador } from '../../plataforma/almacenamiento.ts';
import type { Auth } from '../../plataforma/auth.ts';
import { noAutenticado } from '../../plataforma/errores.ts';
import { requiereSesion, type Actor } from '../../plataforma/sesion.ts';
import { noEncontrado, rolEnBrigada } from '../alcance/autorizacion.ts';
import { rutaParaDescarga } from '../archivos/servicio.ts';
import { cargarConfiguracionToce } from '../configuracion/servicio.ts';
import { cambiarContrasena } from '../cuenta/servicio.ts';
import * as revisiones from '../ejecuciones/revisiones.ts';
import * as org from '../organizacion/servicio.ts';

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
const rolGlobal = z.enum(VALORES_ROL_GLOBAL);
const conId = z.object({ id });

const actor = (request: FastifyRequest): Actor => {
  if (request.actor === null) throw noAutenticado();
  return request.actor;
};

/** API de la web (doc. 03 §8). Todas las rutas exigen sesión y autorizan por rol + alcance. */
export const rutasWeb: FastifyPluginAsyncZod<Opciones> = (app, { auth, db, firmador }) => {
  // Con una contraseña temporal solo se puede ver el perfil y cambiarla (primer ingreso).
  app.addHook(
    'preHandler',
    requiereSesion(auth, db, { exentas: new Set(['/api/v1/yo', '/api/v1/yo/contrasena']) }),
  );

  app.get('/yo', async (request) => {
    const a = actor(request);
    const u = await db
      .selectFrom('usuario')
      .select([
        'id',
        'nombre',
        'tipo_documento',
        'num_documento',
        'rol_global',
        'debe_cambiar_contrasena',
      ])
      .where('id', '=', a.usuarioId)
      .executeTakeFirstOrThrow();
    const miembro = await db
      .selectFrom('miembro_brigada')
      .select(['brigada_id', 'rol'])
      .where('usuario_id', '=', a.usuarioId)
      .where('estado', '=', 'activo')
      .execute();
    return { ...u, membresias: miembro };
  });

  // Cambio de la propia contraseña (web y celular). Límite propio contra intentos de adivinar la
  // actual: 10 cada 15 minutos.
  app.post(
    '/yo/contrasena',
    {
      config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
      schema: { body: cambioContrasenaSchema },
    },
    async (request, reply) => {
      const a = actor(request);
      await cambiarContrasena(db, a, request.body.actual, request.body.nueva);
      return reply.status(204).send();
    },
  );

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

  // ── Brigadas y miembros ──
  app.get('/proyectos/:id/brigadas', { schema: { params: conId } }, async (request) => ({
    brigadas: await org.listarBrigadas(db, actor(request), request.params.id),
  }));
  app.post(
    '/proyectos/:id/brigadas',
    {
      schema: {
        params: conId,
        body: z.object({ nombre: texto(120) }),
      },
    },
    async (request, reply) => {
      const nuevo = await org.crearBrigada(
        db,
        actor(request),
        request.params.id,
        request.body.nombre,
      );
      return reply.status(201).send({ id: nuevo });
    },
  );
  app.patch(
    '/brigadas/:id',
    {
      schema: {
        params: conId,
        body: z.object({ nombre: texto(120).optional() }),
      },
    },
    async (request, reply) => {
      await org.actualizarBrigada(db, actor(request), request.params.id, {
        ...(request.body.nombre === undefined ? {} : { nombre: request.body.nombre }),
      });
      return reply.status(204).send();
    },
  );
  app.get('/brigadas/:id/miembros', { schema: { params: conId } }, async (request) => ({
    miembros: await org.listarMiembros(db, actor(request), request.params.id),
  }));
  app.post(
    '/brigadas/:id/miembros',
    {
      schema: {
        params: conId,
        body: z.object({ usuario_id: id, rol: z.enum(ROLES_BRIGADA) }),
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

  // ── Estaciones (A01) ──
  app.get('/proyectos/:id/estaciones', { schema: { params: conId } }, async (request) => ({
    estaciones: await org.listarEstaciones(db, actor(request), request.params.id),
  }));
  // Carga de D01 + A01 (RF-W09). Puede tardar unos segundos: crea estaciones, brigadas,
  // cronograma y reservas en una sola transacción.
  app.post(
    '/proyectos/:id/configuracion/toce',
    {
      schema: {
        params: conId,
        // Sin cuerpo: carga D01 y A01 con sus fechas originales.
        body: z
          .object({
            fecha_inicio: z.iso.date().nullable().default(null),
            incluir_a01: z.boolean().default(true),
          })
          .nullish(),
      },
    },
    async (request) => ({
      resumen: await cargarConfiguracionToce(db, actor(request), request.params.id, {
        fechaInicio: request.body?.fecha_inicio ?? null,
        incluirA01: request.body?.incluir_a01 ?? true,
      }),
    }),
  );
  // ── Archivos ──
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
        (c) => rolEnBrigada(db, a, c),
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
