import {
  CATEGORIAS_ALERTA_LOGISTICA,
  consultaPaginaSchema,
  ESTADOS_ALERTA,
  TIPOS_ALERTA,
  TIPOS_ALERTA_REGISTRABLES,
} from '@campo/core';
import type { Db } from '@campo/db';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Auth } from '../../plataforma/auth.ts';
import { noAutenticado } from '../../plataforma/errores.ts';
import { decodificarCursor } from '../../plataforma/paginacion.ts';
import { requiereSesion, type Actor } from '../../plataforma/sesion.ts';
import * as servicio from './servicio.ts';

interface Opciones {
  readonly auth: Auth;
  readonly db: Db;
}

const conId = z.object({ id: z.uuid() });
const texto = (max: number) => z.string().trim().min(1).max(max);
const opcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .default(null)
    .transform((t) => (t === null || t.length === 0 ? null : t));

const actor = (request: FastifyRequest): Actor => {
  if (request.actor === null) throw noAutenticado();
  return request.actor;
};

/**
 * Alertas en la web (D02 §9 y §11, RN-36, doc. 03 §8). Todas exigen sesión y autorizan por rol +
 * alcance en el servicio; las rutas solo validan la entrada.
 */
export const rutasAlertas: FastifyPluginAsyncZod<Opciones> = (app, { auth, db }) => {
  app.addHook('preHandler', requiereSesion(auth, db));

  app.get(
    '/proyectos/:id/alertas',
    {
      schema: {
        params: conId,
        querystring: consultaPaginaSchema.extend({
          estado: z.enum(ESTADOS_ALERTA).optional(),
          tipo: z.enum(TIPOS_ALERTA).optional(),
          brigada: z.uuid().optional(),
        }),
      },
    },
    async (request) => {
      const q = request.query;
      const r = await servicio.listarAlertas(
        db,
        actor(request),
        request.params.id,
        { estado: q.estado, tipo: q.tipo, brigadaId: q.brigada },
        { limite: q.limite, cursor: decodificarCursor(q.cursor) },
      );
      return { alertas: r.filas, siguiente_cursor: r.siguiente_cursor };
    },
  );

  app.post(
    '/proyectos/:id/alertas',
    {
      schema: {
        params: conId,
        body: z.object({
          tipo: z.enum(TIPOS_ALERTA_REGISTRABLES),
          categoria: z.enum(CATEGORIAS_ALERTA_LOGISTICA).nullable().default(null),
          titulo: texto(200),
          descripcion: opcional(4000),
          brigada_id: z.uuid().nullable().default(null),
          estacion_id: z.uuid().nullable().default(null),
          afecta_cronograma: z.boolean().default(false),
        }),
      },
    },
    async (request, reply) => {
      const b = request.body;
      const id = await servicio.registrarDesdeWeb(db, actor(request), request.params.id, {
        tipo: b.tipo,
        categoria: b.categoria,
        titulo: b.titulo,
        descripcion: b.descripcion,
        brigadaId: b.brigada_id,
        estacionId: b.estacion_id,
        afectaCronograma: b.afecta_cronograma,
      });
      return reply.status(201).send({ id });
    },
  );

  app.get('/alertas/:id', { schema: { params: conId } }, async (request) =>
    servicio.verAlerta(db, actor(request), request.params.id),
  );

  app.post(
    '/alertas/:id/mensajes',
    {
      schema: {
        params: conId,
        body: z.object({
          tipo: z.enum(['respuesta', 'complemento', 'consulta']),
          texto: texto(4000),
        }),
      },
    },
    async (request, reply) => {
      const estado = await servicio.agregarMensaje(
        db,
        actor(request),
        request.params.id,
        request.body.tipo,
        request.body.texto,
      );
      return reply.status(201).send({ estado });
    },
  );

  app.post(
    '/alertas/:id/cerrar',
    {
      schema: {
        params: conId,
        body: z.object({ comentario: opcional(2000) }).default({ comentario: null }),
      },
    },
    async (request) => ({
      estado: await servicio.cerrarAlerta(
        db,
        actor(request),
        request.params.id,
        request.body.comentario,
      ),
    }),
  );

  app.post(
    '/alertas/:id/reabrir',
    { schema: { params: conId, body: z.object({ motivo: texto(2000) }) } },
    async (request) => ({
      estado: await servicio.reabrirAlerta(
        db,
        actor(request),
        request.params.id,
        request.body.motivo,
      ),
    }),
  );

  return Promise.resolve();
};
