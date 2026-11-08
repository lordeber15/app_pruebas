import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Config } from '../config.ts';

/**
 * Firma URLs de descarga contra el endpoint público (el que abre el navegador). Buckets privados;
 * la URL se emite solo después de verificar permisos y dura como máximo 15 minutos.
 */
export interface OpcionesFirma {
  /** Nombre sugerido; la disposición siempre es `inline` (el navegador lo muestra, no lo baja). */
  readonly nombre?: string;
  /** `Content-Type` de la respuesta (p. ej. `image/jpeg` para mostrar una foto en `<img>`). */
  readonly tipoContenido?: string;
}

export interface Firmador {
  readonly firmar: (clave: string, opciones?: OpcionesFirma) => Promise<string>;
}

export const crearFirmador = (c: Config): Firmador => {
  const s3 = new S3Client({
    endpoint: c.S3_PUBLIC_ENDPOINT,
    region: c.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: c.S3_ACCESS_KEY_APP, secretAccessKey: c.S3_SECRET_KEY_APP },
  });
  return {
    firmar: (clave, o = {}) =>
      getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: c.S3_BUCKET_ARCHIVOS,
          Key: clave,
          ResponseContentDisposition:
            o.nombre === undefined ? 'inline' : `inline; filename="${o.nombre}"`,
          ...(o.tipoContenido === undefined ? {} : { ResponseContentType: o.tipoContenido }),
        }),
        { expiresIn: c.S3_PRESIGN_TTL_SECONDS },
      ),
  };
};
