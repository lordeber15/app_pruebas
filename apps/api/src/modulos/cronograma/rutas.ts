import { cambioCronogramaSchema, TIPOS_ACTIVIDAD_CRONOGRAMA } from '@campo/core';
import type { Db } from '@campo/db';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Auth } from '../../plataforma/auth.ts';
import { noAutenticado } from '../../plataforma/errores.ts';
import { requiereSesion, type Actor } from '../../plataforma/sesion.ts';
import * as borrador from './borrador.ts';
import * as cronograma from './servicio.ts';

interface Opciones {
  readonly auth: Auth;
  readonly db: Db;
}

const conId = z.object({ id: z.uuid() });
const motivo = z.string().trim().min(1).max(2000);
const comentario = z.object({ comentario: z.string().trim().min(1).max(2000) });
const cambios = z.array(cambioCronogramaSchema).min(1).max(200);
const filaBorrador = z
  .object({
    brigada_id: z.uuid(),
    fecha: z.iso.date(),
    tipo_actividad: z.enum(TIPOS_ACTIVIDAD_CRONOGRAMA),
    estacion_id: z.uuid().nullable().default(null),
    detalle: z.string().trim().max(500).nullable().default(null),
  })
  .refine((f) => (f.tipo_actividad === 'estacion') === (f.estacion_id !== null), {
    message: 'Una actividad de tipo estación indica su estación (y solo esa).',
    path: ['estacion_id'],
  });

const actor = (request: FastifyRequest): Actor => {
  if (request.actor === null) throw noAutenticado();
  return request.actor;
};

/**
 * Cronograma base y vigente y solicitudes de cambio (RF-W12, RN-35, RN-36, E-08). La
 * autorización por rol + alcance está en el servicio: proponer Coordinación y JdP; decidir solo
 * el JdP; ver el cronograma, los miembros de cada brigada la suya.
 */
export const rutasCronograma: FastifyPluginAsyncZod<Opciones> = (app, { auth, db }) => {
  app.addHook('preHandler', requiereSesion(auth, db));

  app.get(
    '/proyectos/:id/cronograma',
    {
      schema: {
        params: conId,
        querystring: z.object({ version: z.coerce.number().int().positive().optional() }),
      },
    },
    async (request) =>
      cronograma.verCronograma(db, actor(request), request.params.id, request.query.version),
  );

  app.get(
    '/proyectos/:id/cronograma/solicitudes',
    { schema: { params: conId } },
    async (request) => ({
      solicitudes: await cronograma.listarSolicitudes(db, actor(request), request.params.id),
    }),
  );

  app.post(
    '/proyectos/:id/cronograma/solicitudes',
    {
      schema: {
        params: conId,
        body: z.object({ motivo, cambios, alerta_id: z.uuid().nullable().default(null) }),
      },
    },
    async (request, reply) => {
      const id = await cronograma.proponerCambio(db, actor(request), request.params.id, {
        motivo: request.body.motivo,
        cambios: request.body.cambios,
        alertaId: request.body.alerta_id,
      });
      return reply.status(201).send({ id });
    },
  );

  // «Aplicar ahora» (solo el JdP): solicitud + aprobación en una transacción (RN-36).
  app.post(
    '/proyectos/:id/cronograma/aplicar',
    {
      schema: {
        params: conId,
        body: z.object({ motivo, cambios, alerta_id: z.uuid().nullable().default(null) }),
      },
    },
    async (request, reply) =>
      reply.status(201).send(
        await cronograma.aplicarAhora(db, actor(request), request.params.id, {
          motivo: request.body.motivo,
          cambios: request.body.cambios,
          alertaId: request.body.alerta_id,
        }),
      ),
  );

  // ── Borrador del cronograma base (proyecto sin A01) ──
  app.get('/proyectos/:id/cronograma/borrador', { schema: { params: conId } }, async (request) =>
    borrador.verBorrador(db, actor(request), request.params.id),
  );
  app.post(
    '/proyectos/:id/cronograma/borrador',
    { schema: { params: conId, body: filaBorrador } },
    async (request, reply) => {
      const b = request.body;
      const id = await borrador.agregarFilaBorrador(db, actor(request), request.params.id, {
        brigada_id: b.brigada_id,
        fecha: b.fecha,
        tipo_actividad: b.tipo_actividad,
        estacion_id: b.estacion_id,
        detalle: b.detalle === '' ? null : b.detalle,
      });
      return reply.status(201).send({ id });
    },
  );
  app.post(
    '/cronograma/borrador/:id/descartar',
    { schema: { params: conId } },
    async (request, reply) => {
      await borrador.descartarFilaBorrador(db, actor(request), request.params.id);
      return reply.status(204).send();
    },
  );
  app.post(
    '/proyectos/:id/cronograma/borrador/publicar',
    { schema: { params: conId } },
    async (request, reply) =>
      reply
        .status(201)
        .send(await borrador.publicarBorrador(db, actor(request), request.params.id)),
  );

  app.post('/cronograma/solicitudes/:id/aprobar', { schema: { params: conId } }, async (request) =>
    cronograma.aprobarSolicitud(db, actor(request), request.params.id),
  );

  app.post(
    '/cronograma/solicitudes/:id/rechazar',
    { schema: { params: conId, body: comentario } },
    async (request, reply) => {
      await cronograma.decidirSolicitud(db, actor(request), request.params.id, {
        tipo: 'rechazar',
        comentario: request.body.comentario,
      });
      return reply.status(204).send();
    },
  );

  app.post(
    '/cronograma/solicitudes/:id/pedir-ajuste',
    { schema: { params: conId, body: comentario } },
    async (request, reply) => {
      await cronograma.decidirSolicitud(db, actor(request), request.params.id, {
        tipo: 'pedir_ajuste',
        comentario: request.body.comentario,
      });
      return reply.status(204).send();
    },
  );

  app.post(
    '/cronograma/solicitudes/:id/ajustar',
    {
      schema: {
        params: conId,
        body: z.object({ motivo: motivo.nullable().default(null), cambios }),
      },
    },
    async (request, reply) => {
      await cronograma.ajustarSolicitud(db, actor(request), request.params.id, {
        motivo: request.body.motivo,
        cambios: request.body.cambios,
      });
      return reply.status(204).send();
    },
  );

  return Promise.resolve();
};
