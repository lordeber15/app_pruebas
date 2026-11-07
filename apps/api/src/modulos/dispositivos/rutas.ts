import type { Db } from '@campo/db';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import { z } from 'zod';
import type { Auth } from '../../plataforma/auth.ts';
import { noAutenticado } from '../../plataforma/errores.ts';
import { requiereDispositivo, requiereSesion } from '../../plataforma/sesion.ts';
import * as servicio from './servicio.ts';

interface Opciones {
  readonly auth: Auth;
  readonly db: Db;
}

export const rutasDispositivos: FastifyPluginAsyncZod<Opciones> = (app, { auth, db }) => {
  app.post(
    '/dispositivos/activar',
    {
      preHandler: requiereSesion(auth, db),
      schema: {
        body: z.object({
          plataforma: z.enum(['android', 'ios']),
          llave_publica: z.base64().max(512),
          version_app: z.string().regex(/^\d+\.\d+\.\d+$/),
          token_push: z.string().max(4096).nullable(),
        }),
        response: { 201: z.object({ dispositivo_id: z.uuid() }) },
      },
    },
    async (request, reply) => {
      if (request.actor === null) throw noAutenticado();
      const { dispositivoId } = await servicio.activar(db, request.actor, {
        plataforma: request.body.plataforma,
        llavePublica: request.body.llave_publica,
        versionApp: request.body.version_app,
        tokenPush: request.body.token_push,
      });
      return reply.status(201).send({ dispositivo_id: dispositivoId });
    },
  );

  app.post(
    '/dispositivos/renovar',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        body: z.object({
          dispositivo_id: z.uuid(),
          momento: z.iso.datetime({ offset: true }),
          nonce: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
          firma: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/),
        }),
        response: { 200: z.object({ token: z.string(), expira_en: z.iso.datetime() }) },
      },
    },
    async (request) => {
      const r = await servicio.renovar(db, auth, {
        dispositivoId: request.body.dispositivo_id,
        momento: request.body.momento,
        nonce: request.body.nonce,
        firma: request.body.firma,
      });
      return { token: r.token, expira_en: r.expiraEn.toISOString() };
    },
  );

  app.get(
    '/dispositivos/estado',
    {
      preHandler: requiereDispositivo(auth, db, { permitirBaja: true }),
      schema: {
        response: {
          200: z.object({
            estado: z.enum(['activo', 'baja_pendiente']),
            version_minima: z.string().nullable(),
          }),
        },
      },
    },
    (request) => ({
      estado:
        request.actor?.estadoDispositivo === 'baja_pendiente'
          ? ('baja_pendiente' as const)
          : ('activo' as const),
      // ⚑ La versión mínima exigida (doc. 03 §12) aún no está definida.
      version_minima: null,
    }),
  );
  return Promise.resolve();
};
