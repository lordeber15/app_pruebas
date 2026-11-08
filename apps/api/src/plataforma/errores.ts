import { hasZodFastifySchemaValidationErrors } from '@fastify/type-provider-zod';
import type { FastifyError, FastifyInstance } from 'fastify';

/**
 * Errores en RFC 9457 (application/problem+json), sin trazas en producción.
 * Los servicios lanzan ProblemaHttp; las rutas no arman respuestas de error a mano.
 */
export class ProblemaHttp extends Error {
  readonly estado: number;
  readonly codigo: string;

  constructor(estado: number, codigo: string, detalle: string) {
    super(detalle);
    this.name = 'ProblemaHttp';
    this.estado = estado;
    this.codigo = codigo;
  }
}

const TITULOS: Readonly<Record<number, string>> = {
  400: 'Solicitud inválida',
  401: 'No autenticado',
  403: 'No autorizado',
  404: 'No encontrado',
  409: 'Conflicto',
  413: 'Contenido demasiado grande',
  415: 'Tipo de contenido no admitido',
  422: 'Contenido no procesable',
  429: 'Demasiadas solicitudes',
  500: 'Error interno',
};

export const noAutenticado = (): ProblemaHttp =>
  new ProblemaHttp(401, 'NO_AUTENTICADO', 'Inicie sesión para continuar.');
export const noAutorizado = (): ProblemaHttp =>
  new ProblemaHttp(403, 'NO_AUTORIZADO', 'No tiene permiso para esta acción.');

export const registrarManejoDeErrores = (app: FastifyInstance, produccion: boolean): void => {
  app.setErrorHandler((error: FastifyError | ProblemaHttp, request, reply) => {
    let estado = 500;
    let codigo = 'ERROR_INTERNO';
    let detalle = 'Ocurrió un error inesperado.';
    let errores: unknown;

    if (error instanceof ProblemaHttp) {
      ({ estado, codigo } = error);
      detalle = error.message;
    } else if (hasZodFastifySchemaValidationErrors(error)) {
      estado = 400;
      codigo = 'VALIDACION';
      detalle = 'Los datos enviados no son válidos.';
      errores = error.validation.map((v) => ({ ruta: v.instancePath, mensaje: v.message }));
    } else if (typeof error.statusCode === 'number' && error.statusCode < 500) {
      estado = error.statusCode;
      codigo = error.code;
      detalle = TITULOS[estado] ?? 'Solicitud inválida';
    }

    if (estado >= 500) request.log.error({ err: error }, 'error no controlado');

    return reply
      .status(estado)
      .type('application/problem+json')
      .send({
        type: `about:blank`,
        title: TITULOS[estado] ?? 'Error',
        status: estado,
        detail: detalle,
        codigo,
        instance: request.url,
        ...(errores === undefined ? {} : { errores }),
        ...(produccion || estado < 500 ? {} : { traza: (error as Error).stack }),
      });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).type('application/problem+json').send({
      type: 'about:blank',
      title: TITULOS[404],
      status: 404,
      detail: 'El recurso no existe.',
      codigo: 'NO_ENCONTRADO',
      instance: request.url,
    }),
  );
};
