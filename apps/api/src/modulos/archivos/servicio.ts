import {
  esEstadoArchivo,
  extensionDe,
  tamanoMaximo,
  tipoContenidoEsperado,
  transicionarArchivo,
  type TipoArchivo,
  type VarianteArchivo,
} from '@campo/core';
import type { Db } from '@campo/db';
import { sql } from 'kysely';
import { generarId } from '../../plataforma/ids.ts';
import type { ActorDispositivo } from '../../plataforma/sesion.ts';

/**
 * Autorización y registro de subidas (doc. 03 §10). tusd llama a la API en dos momentos:
 * - pre-create: antes de aceptar la subida. Aquí se decide si se permite y dónde se guarda.
 * - post-finish: cuando terminó. Se registra la ruta y se avisa al worker para verificar el hash.
 */

export interface MetadatosSubida {
  readonly archivoId: string;
  readonly variante: VarianteArchivo;
  readonly sha256: string;
}

export type RechazoSubida =
  | { readonly estado: 403; readonly codigo: 'NO_AUTORIZADO' }
  | {
      readonly estado: 409;
      readonly codigo:
        'YA_VERIFICADO' | 'HASH_NO_ANUNCIADO' | 'ORIGINAL_NO_PERMITIDO' | 'SIN_ORIGINAL';
    }
  | { readonly estado: 413; readonly codigo: 'TAMANO_INVALIDO' };

const TIPOS: readonly TipoArchivo[] = ['foto', 'ficha', 'audio', 'comprobante'];
const comoTipo = (t: string): TipoArchivo | null => TIPOS.find((x) => x === t) ?? null;

/** Prefijo de la ruta generada por el servidor; nunca por el usuario (doc. 03 §10). */
export const prefijoObjeto = (
  proyectoId: string,
  archivoId: string,
  variante: VarianteArchivo,
): string => `proyectos/${proyectoId}/archivos/${archivoId}/${variante}/`;

export const autorizarSubida = async (
  db: Db,
  actor: ActorDispositivo,
  m: MetadatosSubida,
  tamano: number | null,
): Promise<{ ok: true; id: string } | { ok: false; rechazo: RechazoSubida }> => {
  const noAutorizado = {
    ok: false as const,
    rechazo: { estado: 403 as const, codigo: 'NO_AUTORIZADO' as const },
  };

  const archivo = await db
    .selectFrom('archivo')
    .innerJoin('proyecto', 'proyecto.id', 'archivo.proyecto_id')
    .select([
      'archivo.id',
      'archivo.proyecto_id',
      'archivo.tarea_id',
      'archivo.usuario_id',
      'archivo.tipo',
      'archivo.estado',
      'archivo.hash_preview',
      'archivo.hash_original',
      'archivo.tamano_preview',
      'archivo.tamano_original',
      'proyecto.subir_originales',
    ])
    .where('archivo.id', '=', m.archivoId)
    .executeTakeFirst();
  // Mismo rechazo si no existe o es de otro: no se revela qué archivos existen.
  if (
    archivo === undefined ||
    archivo.usuario_id !== actor.usuarioId ||
    archivo.tarea_id === null
  ) {
    return noAutorizado;
  }

  // La asignación de la tarea debe ser de este usuario y este dispositivo (vigente o ya finalizada:
  // las fotos suben después de completar). Una asignación revocada no sube archivos.
  const asignacion = await db
    .selectFrom('asignacion')
    .select('id')
    .where('tarea_id', '=', archivo.tarea_id)
    .where('usuario_id', '=', actor.usuarioId)
    .where('dispositivo_id', '=', actor.dispositivoId)
    .where('estado', 'in', ['vigente', 'finalizada'])
    .executeTakeFirst();
  if (asignacion === undefined) return noAutorizado;

  const tipo = comoTipo(archivo.tipo);
  if (tipo === null || !esEstadoArchivo(archivo.estado))
    throw new Error('Valor desconocido en la BD');

  const t = transicionarArchivo(archivo.estado, tipo, { tipo: 'subir', variante: m.variante });
  if (!t.ok) {
    return {
      ok: false,
      rechazo: {
        estado: 409,
        codigo: t.motivo === 'SIN_ORIGINAL' ? 'SIN_ORIGINAL' : 'YA_VERIFICADO',
      },
    };
  }
  // RN-17: el original solo sube si el proyecto lo permite.
  if (m.variante === 'original' && !archivo.subir_originales) {
    return { ok: false, rechazo: { estado: 409, codigo: 'ORIGINAL_NO_PERMITIDO' } };
  }

  const hashAnunciado = m.variante === 'preview' ? archivo.hash_preview : archivo.hash_original;
  if (hashAnunciado !== m.sha256) {
    return { ok: false, rechazo: { estado: 409, codigo: 'HASH_NO_ANUNCIADO' } };
  }

  const anunciado = m.variante === 'preview' ? archivo.tamano_preview : archivo.tamano_original;
  if (
    tamano === null ||
    tamano > tamanoMaximo(tipo, m.variante) ||
    anunciado === null ||
    String(tamano) !== anunciado
  ) {
    return { ok: false, rechazo: { estado: 413, codigo: 'TAMANO_INVALIDO' } };
  }

  // Parte aleatoria por intento: tusd no comprueba colisiones de rutas.
  const ext = extensionDe(tipoContenidoEsperado(tipo));
  return {
    ok: true,
    id: `${prefijoObjeto(archivo.proyecto_id, archivo.id, m.variante)}${generarId()}.${ext}`,
  };
};

/**
 * Subida terminada: guarda la ruta del objeto y avisa al worker (NOTIFY). Si el aviso se pierde,
 * el worker encuentra igual el archivo pendiente en su revisión periódica.
 */
export const registrarSubidaTerminada = async (
  db: Db,
  archivoId: string,
  variante: VarianteArchivo,
  clave: string,
): Promise<boolean> =>
  db.transaction().execute(async (tx) => {
    const archivo = await tx
      .selectFrom('archivo')
      .select(['id', 'proyecto_id', 'tipo', 'estado'])
      .where('id', '=', archivoId)
      .forUpdate()
      .executeTakeFirst();
    if (archivo === undefined) return false;
    // La clave debe estar bajo la ruta que generó el servidor para este archivo y variante.
    if (!clave.startsWith(prefijoObjeto(archivo.proyecto_id, archivo.id, variante))) return false;
    const tipo = comoTipo(archivo.tipo);
    if (tipo === null || !esEstadoArchivo(archivo.estado)) return false;
    const t = transicionarArchivo(archivo.estado, tipo, { tipo: 'subir', variante });
    if (!t.ok) return false;

    await tx
      .updateTable('archivo')
      .set(
        variante === 'preview'
          ? { ruta_preview: clave, estado: t.valor }
          : { ruta_original: clave },
      )
      .where('id', '=', archivo.id)
      .execute();
    await sql`select pg_notify('archivo_subido', ${archivo.id})`.execute(tx);
    return true;
  });

/** Estado de los archivos propios, para que el celular libere lo verificado (RN-17). */
export const estadoArchivos = (db: Db, actor: ActorDispositivo, ids: readonly string[]) =>
  db
    .selectFrom('archivo')
    .select(['id', 'estado'])
    .where('id', 'in', ids)
    .where('usuario_id', '=', actor.usuarioId)
    .execute();

// ── URLs firmadas para la web ──────────────────────────────────────────────

export type VarianteDescarga = 'miniatura' | 'preview' | 'original';

/**
 * Ruta del objeto de la variante pedida si el archivo es visible para el actor y la variante está
 * verificada. El especialista solo ve sus propios archivos (RN-21, SEG-03).
 */
export const rutaParaDescarga = async (
  db: Db,
  actor: { usuarioId: string },
  rolEnTarea: (brigadaId: string) => Promise<string | null>,
  archivoId: string,
  variante: VarianteDescarga,
): Promise<string | null> => {
  const a = await db
    .selectFrom('archivo')
    .innerJoin('tarea', 'tarea.id', 'archivo.tarea_id')
    .innerJoin('cuaderno', 'cuaderno.id', 'tarea.cuaderno_id')
    .select([
      'archivo.usuario_id',
      'archivo.estado',
      'archivo.ruta_miniatura',
      'archivo.ruta_preview',
      'archivo.ruta_original',
      'cuaderno.brigada_id',
    ])
    .where('archivo.id', '=', archivoId)
    .executeTakeFirst();
  if (a === undefined) return null;
  const rol = await rolEnTarea(a.brigada_id);
  if (rol === null) return null;
  if ((rol === 'especialista' || rol === 'logistico') && a.usuario_id !== actor.usuarioId)
    return null;

  const previewLista = a.estado === 'preview_verificada' || a.estado === 'original_verificado';
  if (variante === 'miniatura') return previewLista ? a.ruta_miniatura : null;
  if (variante === 'preview') return previewLista ? a.ruta_preview : null;
  return a.estado === 'original_verificado' ? a.ruta_original : null;
};
