import {
  esEstadoArchivo,
  esEstadoTarea,
  tamanoMaximo,
  tipoContenidoEsperado,
  tipoPorContenido,
  transicionarArchivo,
  transicionarTarea,
  type TipoArchivo,
  type VarianteArchivo,
} from '@campo/core';
import type { Db } from '@campo/db';
import sharp from 'sharp';
import type { Almacenamiento } from './almacenamiento.ts';

/**
 * Trabajo `verificar_archivo` (doc. 03 §7.2): recalcula el SHA-256 de la variante subida, lo
 * compara con el manifiesto, valida el tipo por contenido, genera la miniatura y actualiza el
 * estado del archivo y de la tarea (RN-05). Es idempotente: si no hay nada pendiente, no hace nada.
 */
export type ResultadoVerificacion =
  | { readonly accion: 'nada' }
  | {
      readonly accion: 'verificado';
      readonly variante: VarianteArchivo;
      readonly tareaCompletada: boolean;
    }
  | { readonly accion: 'rechazado'; readonly variante: VarianteArchivo; readonly motivo: string };

const ANCHO_MINIATURA = 400;
const TIPOS: readonly TipoArchivo[] = ['foto', 'ficha', 'audio', 'comprobante'];

export const miniaturaDe = (proyectoId: string, archivoId: string): string =>
  `proyectos/${proyectoId}/archivos/${archivoId}/miniatura.jpg`;

const pendiente = (a: {
  estado: string;
  tipo: string;
  ruta_preview: string | null;
  ruta_original: string | null;
}) => {
  if (a.estado === 'preview_subida' && a.ruta_preview !== null) {
    return { variante: 'preview' as const, clave: a.ruta_preview };
  }
  if (a.estado === 'preview_verificada' && a.tipo === 'foto' && a.ruta_original !== null) {
    return { variante: 'original' as const, clave: a.ruta_original };
  }
  return null;
};

export const verificarArchivo = async (
  db: Db,
  almacen: Almacenamiento,
  archivoId: string,
): Promise<ResultadoVerificacion> => {
  const archivo = await db
    .selectFrom('archivo')
    .select([
      'id',
      'proyecto_id',
      'tarea_id',
      'tipo',
      'estado',
      'hash_preview',
      'hash_original',
      'ruta_preview',
      'ruta_original',
    ])
    .where('id', '=', archivoId)
    .executeTakeFirst();
  if (archivo === undefined) return { accion: 'nada' };
  const tipo = TIPOS.find((t) => t === archivo.tipo);
  if (tipo === undefined) throw new Error('Tipo de archivo desconocido en la BD');

  const p = pendiente(archivo);
  if (p === null) return { accion: 'nada' };

  const esperado = p.variante === 'preview' ? archivo.hash_preview : archivo.hash_original;
  const generarMiniatura = p.variante === 'preview' && (tipo === 'foto' || tipo === 'ficha');
  const leido = await almacen.leer(p.clave, tamanoMaximo(tipo, p.variante), generarMiniatura);

  let motivo: string | null = null;
  if (leido === null) motivo = 'OBJETO_INEXISTENTE';
  else if (leido.tamano > tamanoMaximo(tipo, p.variante)) motivo = 'TAMANO_EXCEDIDO';
  else if (tipoPorContenido(leido.inicio) !== tipoContenidoEsperado(tipo))
    motivo = 'TIPO_NO_PERMITIDO';
  else if (leido.sha256 !== esperado) motivo = 'HASH_DISTINTO';

  let rutaMiniatura: string | null = null;
  if (motivo === null && generarMiniatura && leido?.contenido != null) {
    try {
      const mini = await sharp(leido.contenido)
        .rotate()
        .resize({ width: ANCHO_MINIATURA, withoutEnlargement: true })
        .jpeg({ quality: 75 })
        .toBuffer();
      rutaMiniatura = miniaturaDe(archivo.proyecto_id, archivo.id);
      await almacen.guardar(rutaMiniatura, mini, 'image/jpeg');
    } catch {
      // Firma JPEG válida pero imagen corrupta.
      motivo = 'IMAGEN_CORRUPTA';
    }
  }

  return db.transaction().execute(async (tx): Promise<ResultadoVerificacion> => {
    const actual = await tx
      .selectFrom('archivo')
      .select(['estado', 'tipo', 'ruta_preview', 'ruta_original'])
      .where('id', '=', archivo.id)
      .forUpdate()
      .executeTakeFirst();
    // Si mientras tanto llegó otra subida, la verificará el trabajo que generó su aviso.
    const sigue = actual === undefined ? null : pendiente(actual);
    if (sigue?.clave !== p.clave || actual === undefined || !esEstadoArchivo(actual.estado)) {
      return { accion: 'nada' };
    }
    const t = transicionarArchivo(actual.estado, tipo, {
      tipo: 'verificar',
      variante: p.variante,
      hashCorrecto: motivo === null,
    });
    if (!t.ok) return { accion: 'nada' };

    await tx
      .updateTable('archivo')
      .set({
        estado: t.valor,
        ...(rutaMiniatura === null ? {} : { ruta_miniatura: rutaMiniatura }),
        // Un original rechazado se olvida: el celular lo conserva y lo vuelve a subir.
        ...(p.variante === 'original' && motivo !== null ? { ruta_original: null } : {}),
      })
      .where('id', '=', archivo.id)
      .execute();

    if (motivo !== null) return { accion: 'rechazado', variante: p.variante, motivo };

    // RN-05: la primera foto verificada lleva la tarea de "en tránsito" a "completada".
    let tareaCompletada = false;
    if (p.variante === 'preview' && tipo === 'foto' && archivo.tarea_id !== null) {
      const tarea = await tx
        .selectFrom('tarea')
        .select(['id', 'estado'])
        .where('id', '=', archivo.tarea_id)
        .forUpdate()
        .executeTakeFirst();
      if (tarea !== undefined && esEstadoTarea(tarea.estado)) {
        const r = transicionarTarea(tarea.estado, {
          tipo: 'verificar_evidencia',
          fotosVerificadas: 1,
        });
        if (r.ok) {
          await tx
            .updateTable('tarea')
            .set((eb) => ({ estado: r.valor, version: eb('version', '+', 1) }))
            .where('id', '=', tarea.id)
            .execute();
          tareaCompletada = true;
        }
      }
    }
    return { accion: 'verificado', variante: p.variante, tareaCompletada };
  });
};

/** Archivos con una variante subida y sin verificar (revisión periódica, por si se perdió un aviso). */
export const archivosPendientes = async (db: Db, limite = 200): Promise<string[]> => {
  const filas = await db
    .selectFrom('archivo')
    .select('id')
    .where((eb) =>
      eb.or([
        eb.and([eb('estado', '=', 'preview_subida'), eb('ruta_preview', 'is not', null)]),
        eb.and([
          eb('estado', '=', 'preview_verificada'),
          eb('tipo', '=', 'foto'),
          eb('ruta_original', 'is not', null),
        ]),
      ]),
    )
    .orderBy('actualizado_en')
    .limit(limite)
    .execute();
  return filas.map((f) => f.id);
};
