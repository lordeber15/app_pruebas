import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { ConfigWorker } from './config.ts';

export interface Almacenamiento {
  readonly bucket: string;
  /**
   * Lee el objeto completo, calcula su SHA-256 y corta si supera `maximo` bytes.
   * Devuelve el contenido solo si `conservar` es true (miniatura de la preview).
   */
  leer: (
    clave: string,
    maximo: number,
    conservar: boolean,
  ) => Promise<{
    sha256: string;
    tamano: number;
    inicio: Uint8Array;
    contenido: Buffer | null;
  } | null>;
  guardar: (clave: string, contenido: Buffer, tipo: string) => Promise<void>;
}

export const crearCliente = (c: ConfigWorker): S3Client =>
  new S3Client({
    endpoint: c.S3_ENDPOINT,
    region: c.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: c.S3_ACCESS_KEY_APP, secretAccessKey: c.S3_SECRET_KEY_APP },
  });

export const crearAlmacenamiento = (s3: S3Client, bucket: string): Almacenamiento => ({
  bucket,
  leer: async (clave, maximo, conservar) => {
    let respuesta;
    try {
      respuesta = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: clave }));
    } catch (e) {
      if ((e as { name?: string }).name === 'NoSuchKey') return null;
      throw e;
    }
    const cuerpo = respuesta.Body as Readable | undefined;
    if (cuerpo === undefined) return null;
    const hash = createHash('sha256');
    const partes: Buffer[] = [];
    const inicio: Buffer[] = [];
    let tamano = 0;
    let largoInicio = 0;
    for await (const trozo of cuerpo as AsyncIterable<Buffer>) {
      tamano += trozo.length;
      if (tamano > maximo) {
        cuerpo.destroy();
        return { sha256: '', tamano, inicio: new Uint8Array(), contenido: null };
      }
      hash.update(trozo);
      if (largoInicio < 16) {
        inicio.push(trozo.subarray(0, 16 - largoInicio));
        largoInicio += Math.min(trozo.length, 16 - largoInicio);
      }
      if (conservar) partes.push(trozo);
    }
    return {
      sha256: hash.digest('hex'),
      tamano,
      inicio: new Uint8Array(Buffer.concat(inicio)),
      contenido: conservar ? Buffer.concat(partes) : null,
    };
  },
  guardar: async (clave, contenido, tipo) => {
    await s3.send(
      new PutObjectCommand({ Bucket: bucket, Key: clave, Body: contenido, ContentType: tipo }),
    );
  },
});
