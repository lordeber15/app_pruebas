import { ProblemaHttp } from './errores.ts';

/**
 * Lector mínimo de `multipart/form-data` (RFC 7578) para subir un archivo pequeño desde la web
 * (plantilla D01, ≤ 5 MB). El cuerpo ya llega completo y con su límite de tamaño aplicado por
 * Fastify; aquí solo se separan las partes. Sin dependencias (no hay plugin multipart aprobado en
 * `03` §2).
 */

export interface Parte {
  readonly campo: string;
  readonly nombreArchivo: string | null;
  readonly tipo: string | null;
  readonly datos: Buffer;
}

const MAX_PARTES = 10;
const CRLF = Buffer.from('\r\n');

const invalido = () =>
  new ProblemaHttp(400, 'MULTIPART_INVALIDO', 'El envío del archivo no tiene un formato válido.');

const PARAMETROS = {
  name: /(?:^|;)\s*name="([^"]*)"/i,
  filename: /(?:^|;)\s*filename="([^"]*)"/i,
} as const;

const parametro = (cabecera: string, nombre: keyof typeof PARAMETROS): string | null =>
  PARAMETROS[nombre].exec(cabecera)?.[1] ?? null;

export const leerMultipart = (cuerpo: Buffer, contentType: string): Parte[] => {
  const b = /boundary=(?:"([^"]{1,70})"|([^;\s]{1,70}))/i.exec(contentType);
  const limite = b?.[1] ?? b?.[2];
  if (limite === undefined) throw invalido();
  const separador = Buffer.from(`--${limite}`);
  const siguiente = Buffer.concat([CRLF, separador]);

  let pos = cuerpo.indexOf(separador);
  if (pos < 0) throw invalido();
  const partes: Parte[] = [];
  for (;;) {
    pos += separador.length;
    if (cuerpo[pos] === 0x2d && cuerpo[pos + 1] === 0x2d) break; // «--»: fin
    if (cuerpo[pos] !== 0x0d || cuerpo[pos + 1] !== 0x0a) throw invalido();
    pos += 2;
    const finCabeceras = cuerpo.indexOf('\r\n\r\n', pos);
    if (finCabeceras < 0) throw invalido();
    const cabeceras = cuerpo.subarray(pos, finCabeceras).toString('utf8').split('\r\n');
    const inicio = finCabeceras + 4;
    const fin = cuerpo.indexOf(siguiente, inicio);
    if (fin < 0) throw invalido();

    let disposicion = '';
    let tipo: string | null = null;
    for (const c of cabeceras) {
      const i = c.indexOf(':');
      if (i < 0) continue;
      const nombre = c.slice(0, i).trim().toLowerCase();
      const valor = c.slice(i + 1).trim();
      if (nombre === 'content-disposition') disposicion = valor;
      else if (nombre === 'content-type') tipo = valor;
    }
    const campo = parametro(disposicion, 'name');
    if (!/^form-data/i.test(disposicion) || campo === null) throw invalido();
    partes.push({
      campo,
      nombreArchivo: parametro(disposicion, 'filename'),
      tipo,
      datos: cuerpo.subarray(inicio, fin),
    });
    if (partes.length > MAX_PARTES) throw invalido();
    pos = fin + CRLF.length;
  }
  return partes;
};

// eslint-disable-next-line no-control-regex -- se quitan justamente los caracteres de control.
const CONTROL = /[\u0000-\u001f\u007f"]/g;

/** Nombre de archivo para guardar y mostrar: sin rutas ni caracteres de control, ≤ 255. */
export const nombreSeguro = (nombre: string | null, porDefecto: string): string => {
  const base = (nombre ?? '').split(/[\\/]/).pop() ?? '';
  const limpio = base.replace(CONTROL, '').trim().slice(0, 255);
  return limpio === '' ? porDefecto : limpio;
};
