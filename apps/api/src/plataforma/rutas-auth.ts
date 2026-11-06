import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config.ts';
import type { Auth } from './auth.ts';
import { ProblemaHttp } from './errores.ts';

/** Mensaje único para documento inexistente o contraseña incorrecta (CP-002, SEG-04). */
const credencialesInvalidas = (): ProblemaHttp =>
  new ProblemaHttp(401, 'CREDENCIALES_INVALIDAS', 'Documento o contraseña incorrectos.');

const QUINCE_MINUTOS = 15 * 60 * 1000;

const aRequestFetch = (request: FastifyRequest): Request => {
  const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
  const tieneCuerpo = request.method !== 'GET' && request.body !== undefined;
  return new Request(url, {
    method: request.method,
    headers: fromNodeHeaders(request.headers),
    ...(tieneCuerpo ? { body: JSON.stringify(request.body) } : {}),
  });
};

const reenviar = async (respuesta: Response, reply: FastifyReply): Promise<FastifyReply> => {
  reply.status(respuesta.status);
  respuesta.headers.forEach((valor, clave) => {
    if (clave !== 'content-length') reply.header(clave, valor);
  });
  return reply.send(respuesta.body === null ? null : await respuesta.text());
};

/** Clave del límite por cuenta: el username normalizado; si no viene, la IP. */
const claveDeCuenta = (request: FastifyRequest): string => {
  const cuerpo = request.body as { username?: unknown } | undefined;
  const u = typeof cuerpo?.username === 'string' ? cuerpo.username.trim().toLowerCase() : '';
  return u === '' ? `ip:${request.ip}` : `cuenta:${u}`;
};

/**
 * Endpoints de Better Auth expuestos. Es una lista cerrada: el resto (registro, login por correo,
 * cambio de correo…) no existe para los clientes.
 */
export const registrarRutasAuth = (app: FastifyInstance, auth: Auth, config: Config): void => {
  app.post(
    '/api/auth/sign-in/username',
    {
      config: {
        rateLimit: {
          max: config.RATE_LIMIT_LOGIN,
          timeWindow: QUINCE_MINUTOS,
          hook: 'preHandler',
          keyGenerator: claveDeCuenta,
        },
      },
    },
    async (request, reply) => {
      const respuesta = await auth.handler(aRequestFetch(request));
      if (respuesta.status === 429) {
        throw new ProblemaHttp(
          429,
          'DEMASIADOS_INTENTOS',
          'Demasiados intentos. Espere unos minutos.',
        );
      }
      if (respuesta.status >= 400) throw credencialesInvalidas();
      return reenviar(respuesta, reply);
    },
  );

  app.post('/api/auth/sign-out', async (request, reply) =>
    reenviar(await auth.handler(aRequestFetch(request)), reply),
  );

  app.get('/api/auth/get-session', async (request, reply) =>
    reenviar(await auth.handler(aRequestFetch(request)), reply),
  );
};
