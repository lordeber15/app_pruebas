import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Config } from '../config.ts';

/**
 * Firma URLs de descarga contra el endpoint público (el que abre el navegador). Buckets privados;
 * la URL se emite solo después de verificar permisos y dura como máximo 15 minutos.
 */
export interface Firmador {
  readonly firmar: (clave: string, nombreDescarga?: string) => Promise<string>;
}

export const crearFirmador = (c: Config): Firmador => {
  const s3 = new S3Client({
    endpoint: c.S3_PUBLIC_ENDPOINT,
    region: c.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: c.S3_ACCESS_KEY_APP, secretAccessKey: c.S3_SECRET_KEY_APP },
  });
  return {
    firmar: (clave, nombreDescarga) =>
      getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: c.S3_BUCKET_ARCHIVOS,
          Key: clave,
          ...(nombreDescarga === undefined
            ? {}
            : { ResponseContentDisposition: `inline; filename="${nombreDescarga}"` }),
        }),
        { expiresIn: c.S3_PRESIGN_TTL_SECONDS },
      ),
  };
};
