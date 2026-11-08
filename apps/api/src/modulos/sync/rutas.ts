import { ESTADOS_RESULTADO_LOTE } from '@campo/core';
import type { Db } from '@campo/db';
import type { FastifyPluginAsyncZod } from '@fastify/type-provider-zod';
import { z } from 'zod';
import type { Config } from '../../config.ts';
import type { Auth } from '../../plataforma/auth.ts';
import { actorDispositivo, requiereDispositivo } from '../../plataforma/sesion.ts';
import { cambiosDesde, codificarCursor } from './cambios.ts';
import { procesarLote, sobreMinimo } from './servicio.ts';

interface Opciones {
  readonly auth: Auth;
  readonly db: Db;
  readonly config: Config;
}

export const rutasSync: FastifyPluginAsyncZod<Opciones> = (app, { auth, db, config }) => {
  const soloDispositivo = requiereDispositivo(auth, db);

  app.post(
    '/sync/eventos',
    {
      preHandler: soloDispositivo,
      // Doc. 03 §8: cuerpo de hasta 5 MB en este endpoint.
      bodyLimit: 5 * 1024 * 1024,
      schema: {
        body: z.object({
          eventos: z.array(sobreMinimo).min(1).max(config.SYNC_MAX_EVENTOS_LOTE),
        }),
        response: {
          200: z.object({
            resultados: z.array(
              z.object({
                id: z.uuid(),
                estado: z.enum(ESTADOS_RESULTADO_LOTE),
                motivo: z.string().optional(),
              }),
            ),
            cursor_cambios: z.string(),
          }),
        },
      },
    },
    async (request) => {
      const resultados = await procesarLote(db, actorDispositivo(request), request.body.eventos);
      // ⚑ Informativo: el celular sigue pidiendo /sync/cambios con su propio cursor.
      return { resultados, cursor_cambios: codificarCursor(new Date()) };
    },
  );

  app.get(
    '/sync/cambios',
    {
      preHandler: requiereDispositivo(auth, db, { permitirBaja: true }),
      schema: { querystring: z.object({ desde: z.string().max(200).optional() }) },
    },
    async (request) => cambiosDesde(db, actorDispositivo(request), request.query.desde),
  );

  return Promise.resolve();
};
