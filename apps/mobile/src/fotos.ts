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

export const guardarFoto = async (
  uriCamara: string,
  ancho: number,
  alto: number,
  tarea: { id: string; asignacion_id: string | null },
  evidenciaItemId: string | null,
): Promise<string> => {
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
  const capturadoEn = new Date().toISOString();

  await ejecutar(
    'INSERT INTO archivo_local (id, tarea_id, evidencia_item_id, tipo, uri, sha256, tamano, capturado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [archivoId, tarea.id, evidenciaItemId, 'foto', destino.uri, hash, tamano, capturadoEn],
  );
  await registrarEvento(
    {
      tipo: 'archivo_capturado',
      asignacion_id: tarea.asignacion_id,
      entidad: { tipo: 'archivo', id: archivoId },
      payload: {
        archivo_id: archivoId,
        tipo: 'foto',
        tarea_id: tarea.id,
        evidencia_item_id: evidenciaItemId,
        categoria_id: null,
        hash_preview: hash,
        hash_original: null,
        tamanos: { preview: tamano, original: null },
        capturado_en: capturadoEn,
      },
    },
    ubicacion,
  );
  return archivoId;
};
