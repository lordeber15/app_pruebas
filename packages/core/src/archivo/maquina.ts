import type { EstadoArchivo, TipoArchivo } from '../estados.ts';
import { exito, fallo, type Resultado } from '../resultado.ts';

/**
 * Máquina de estados del archivo (doc. 02 §7.4). El celular libera cada variante solo cuando
 * el servidor la verificó (RN-17, RNF-09).
 *
 * - La preview (2 048 px, ficha o audio) sube → se verifica su hash → `preview_verificada`.
 *   Si el hash no coincide → `error`, y el celular vuelve a subirla.
 * - El original (solo fotos) se verifica después de la preview → `original_verificado`.
 *   Si su hash no coincide, el archivo sigue en `preview_verificada` y el original se reintenta.
 */
export type VarianteArchivo = 'preview' | 'original';

export type AccionArchivo =
  | { readonly tipo: 'subir'; readonly variante: VarianteArchivo }
  | {
      readonly tipo: 'verificar';
      readonly variante: VarianteArchivo;
      readonly hashCorrecto: boolean;
    };

export type MotivoRechazoArchivo = 'TRANSICION_INVALIDA' | 'SIN_ORIGINAL' | 'YA_VERIFICADO';

export const transicionarArchivo = (
  estado: EstadoArchivo,
  tipoArchivo: TipoArchivo,
  accion: AccionArchivo,
): Resultado<EstadoArchivo, MotivoRechazoArchivo> => {
  if (accion.variante === 'original' && tipoArchivo !== 'foto') return fallo('SIN_ORIGINAL');

  if (accion.variante === 'preview') {
    if (accion.tipo === 'subir') {
      if (estado === 'anunciado' || estado === 'error' || estado === 'preview_subida') {
        return exito('preview_subida');
      }
      return fallo('YA_VERIFICADO');
    }
    if (estado !== 'preview_subida') return fallo('TRANSICION_INVALIDA');
    return exito(accion.hashCorrecto ? 'preview_verificada' : 'error');
  }

  // Original: el estado del archivo no cambia al subirlo; se verifica sobre una preview ya verificada.
  if (estado === 'original_verificado') return fallo('YA_VERIFICADO');
  if (accion.tipo === 'subir') return exito(estado);
  if (estado !== 'preview_verificada') return fallo('TRANSICION_INVALIDA');
  return exito(accion.hashCorrecto ? 'original_verificado' : 'preview_verificada');
};

/** Doc. 03 §10: tamaños máximos por variante y tipo. */
const MB = 1024 * 1024;
export const TAMANO_MAXIMO: Readonly<Record<'preview' | 'original' | 'audio', number>> = {
  preview: 3 * MB,
  original: 25 * MB,
  audio: 10 * MB,
};

export const tamanoMaximo = (tipo: TipoArchivo, variante: VarianteArchivo): number =>
  variante === 'original'
    ? TAMANO_MAXIMO.original
    : tipo === 'audio'
      ? TAMANO_MAXIMO.audio
      : TAMANO_MAXIMO.preview;

/** Tipos permitidos (doc. 03 §10): JPEG para imágenes y AAC en MP4 para audio. */
export type TipoContenido = 'image/jpeg' | 'audio/mp4';

export const tipoContenidoEsperado = (tipo: TipoArchivo): TipoContenido =>
  tipo === 'audio' ? 'audio/mp4' : 'image/jpeg';

export const extensionDe = (contenido: TipoContenido): 'jpg' | 'm4a' =>
  contenido === 'image/jpeg' ? 'jpg' : 'm4a';

/**
 * Tipo detectado por la firma del archivo, no por su extensión (doc. 03 §10, SEG-08).
 * Recibe los primeros bytes (al menos 12).
 */
export const tipoPorContenido = (inicio: Uint8Array): TipoContenido | null => {
  if (inicio.length >= 3 && inicio[0] === 0xff && inicio[1] === 0xd8 && inicio[2] === 0xff) {
    return 'image/jpeg';
  }
  // ISO BMFF: bytes 4–7 = "ftyp"; marcas de audio MP4/M4A.
  if (inicio.length >= 12) {
    const ftyp = String.fromCharCode(...inicio.subarray(4, 8));
    const marca = String.fromCharCode(...inicio.subarray(8, 12));
    if (ftyp === 'ftyp' && ['M4A ', 'mp42', 'isom', 'mp41', 'M4B '].includes(marca))
      return 'audio/mp4';
  }
  return null;
};
