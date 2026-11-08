import type { Evento, Orientacion, TipoFoto } from '@campo/core';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { ejecutar } from './bd.ts';
import { registrarEvento } from './eventos.ts';
import { generarId, sha256DeArchivo } from './plataforma.ts';

/**
 * Foto de evidencia tomada con la cámara de la app (RN-16: no hay importación desde la galería).
 * La cámara la entrega ya **sellada** con coordenadas, fecha y hora, estación, método, unidad y
 * tipo (decisión del usuario, 2026-11-08), a 2 048 px como máximo. Aquí se reduce si hiciera
 * falta, se calcula el SHA-256 **del archivo final** y se anuncia con `archivo_capturado`.
 * ⚑ En esta versión no se conserva el original: solo sube la versión de 2 048 px (RN-17).
 */
const carpeta = new Directory(Paths.document, 'evidencias');
export const LADO_MAXIMO = 2048;

/** Tamaño final de la foto: el lado mayor a 2 048 px como máximo, sin agrandarla. */
export const tamanoFinal = (ancho: number, alto: number): { ancho: number; alto: number } => {
  const escala = Math.max(ancho, alto) > LADO_MAXIMO ? LADO_MAXIMO / Math.max(ancho, alto) : 1;
  return { ancho: Math.round(ancho * escala), alto: Math.round(alto * escala) };
};

export interface CapturaFoto {
  /** Imagen a guardar: la sellada o, si el sello falló, la de la cámara. */
  readonly uri: string;
  readonly ancho: number;
  readonly alto: number;
  /** Ubicación leída al disparar: la misma que lleva el sello (F-02). */
  readonly ubicacion: Evento['ubicacion'];
  readonly capturadoEn: string;
  /** Lleva el sello y ya tiene el tamaño final: se guarda sin recomprimir. */
  readonly sellada: boolean;
  /** Archivos temporales que se borran al terminar (p. ej. la foto sin sello). */
  readonly temporales: readonly string[];
}

const borrar = (uri: string) => {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // Un temporal que no se pudo borrar no impide guardar la evidencia.
  }
};

const procesar = async (c: CapturaFoto) => {
  if (!carpeta.exists) carpeta.create({ intermediates: true });
  const archivoId = generarId();
  const destino = new File(carpeta, `${archivoId}.jpg`);
  const final = tamanoFinal(c.ancho, c.alto);
  if (c.sellada && final.ancho === c.ancho && final.alto === c.alto) {
    await new File(c.uri).move(destino);
  } else {
    const contexto = ImageManipulator.manipulate(c.uri);
    if (final.ancho !== c.ancho || final.alto !== c.alto)
      contexto.resize({ width: final.ancho, height: final.alto });
    const imagen = await contexto.renderAsync();
    const resultado = await imagen.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
    await new File(resultado.uri).move(destino);
    borrar(c.uri);
  }
  for (const t of c.temporales) if (t !== c.uri) borrar(t);
  // El hash es el del archivo que se guarda y se sube (con el sello).
  const { hash, tamano } = await sha256DeArchivo(destino.uri);
  return {
    archivoId,
    uri: destino.uri,
    hash,
    tamano,
    ubicacion: c.ubicacion,
    capturadoEn: c.capturadoEn,
  };
};

const manifiesto = (f: Awaited<ReturnType<typeof procesar>>) => ({
  archivo_id: f.archivoId,
  tipo: 'foto' as const,
  hash_preview: f.hash,
  hash_original: null,
  tamanos: { preview: f.tamano, original: null },
  capturado_en: f.capturadoEn,
});

export interface DestinoFoto {
  readonly ejecucionId: string;
  readonly unidadId: string | null;
  readonly tipoFoto: TipoFoto;
  readonly orientacion: Orientacion | null;
}

/** F-02: la foto guarda coordenada, fecha/hora, estación, método (por la ejecución) y unidad. */
export const guardarFotoEjecucion = async (c: CapturaFoto, d: DestinoFoto): Promise<string> => {
  const f = await procesar(c);
  await ejecutar(
    `INSERT INTO archivo_local (id, tipo, uri, sha256, tamano, capturado_en,
       ejecucion_id, unidad_id, tipo_foto, orientacion) VALUES (?, 'foto', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      f.archivoId,
      f.uri,
      f.hash,
      f.tamano,
      f.capturadoEn,
      d.ejecucionId,
      d.unidadId,
      d.tipoFoto,
      d.orientacion,
    ],
  );
  await registrarEvento(
    {
      tipo: 'archivo_capturado',
      entidad: { tipo: 'archivo', id: f.archivoId },
      payload: {
        ...manifiesto(f),
        ejecucion_id: d.ejecucionId,
        unidad_id: d.unidadId,
        tipo_foto: d.tipoFoto,
        orientacion: d.orientacion,
        candidata_reporte: false,
      },
    },
    f.ubicacion,
  );
  return f.archivoId;
};
