import type { Orientacion, TipoFoto } from '@campo/core';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { ejecutar } from './bd.ts';
import { registrarEvento, ubicacionActual } from './eventos.ts';
import { generarId, sha256DeArchivo } from './plataforma.ts';

/**
 * Foto de evidencia tomada con la cámara de la app (RN-16: no hay importación desde la galería).
 * Se reduce a 2 048 px, se calcula su SHA-256 y se anuncia con `archivo_capturado` (manifiesto).
 * ⚑ En esta versión no se conserva el original: solo sube la versión de 2 048 px (RN-17).
 */
const carpeta = new Directory(Paths.document, 'evidencias');
const LADO_MAXIMO = 2048;

const procesar = async (uriCamara: string, ancho: number, alto: number) => {
  if (!carpeta.exists) carpeta.create({ intermediates: true });
  const ubicacion = await ubicacionActual();
  const escala = Math.max(ancho, alto) > LADO_MAXIMO ? LADO_MAXIMO / Math.max(ancho, alto) : 1;
  const contexto = ImageManipulator.manipulate(uriCamara);
  if (escala < 1)
    contexto.resize({ width: Math.round(ancho * escala), height: Math.round(alto * escala) });
  const imagen = await contexto.renderAsync();
  const resultado = await imagen.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
  const archivoId = generarId();
  const destino = new File(carpeta, `${archivoId}.jpg`);
  await new File(resultado.uri).move(destino);
  new File(uriCamara).delete();
  const { hash, tamano } = await sha256DeArchivo(destino.uri);
  return {
    archivoId,
    uri: destino.uri,
    hash,
    tamano,
    ubicacion,
    capturadoEn: new Date().toISOString(),
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
export const guardarFotoEjecucion = async (
  uriCamara: string,
  ancho: number,
  alto: number,
  d: DestinoFoto,
): Promise<string> => {
  const f = await procesar(uriCamara, ancho, alto);
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
