import type { EstadoAlerta, TipoAlerta, TipoMensajeAlerta } from '@campo/core';
import type { Db } from '@campo/db';
import { generarId } from '../../plataforma/ids.ts';
import { despuesDe, instanteCursor, pagina, type Cursor } from '../../plataforma/paginacion.ts';

/** Consultas de alertas (D02 §9, RN-36). La autorización por rol + alcance la hace el servicio. */

export interface NuevaAlerta {
  readonly id: string;
  readonly proyectoId: string;
  readonly tipo: 'tecnica' | 'logistica';
  readonly categoria: string | null;
  readonly brigadaId: string | null;
  readonly estacionId: string | null;
  readonly ejecucionId: string | null;
  readonly reservaId: string | null;
  readonly titulo: string;
  readonly descripcion: string | null;
  readonly afectaCronograma: boolean;
  readonly autorId: string;
  readonly dispositivoId: string | null;
  readonly horaDispositivo: Date | null;
  readonly eventoId: string | null;
}

export const insertarAlerta = (db: Db, a: NuevaAlerta) =>
  db
    .insertInto('alerta')
    .values({
      id: a.id,
      proyecto_id: a.proyectoId,
      tipo: a.tipo,
      categoria: a.categoria,
      estado: 'abierta',
      origen: 'usuario',
      brigada_id: a.brigadaId,
      estacion_id: a.estacionId,
      ejecucion_id: a.ejecucionId,
      reserva_id: a.reservaId,
      titulo: a.titulo,
      descripcion: a.descripcion,
      afecta_cronograma: a.afectaCronograma,
      dispositivo_id: a.dispositivoId,
      hora_dispositivo: a.horaDispositivo,
      evento_id: a.eventoId,
      creado_por: a.autorId,
      actualizado_por: a.autorId,
    })
    .execute();

export interface FiltrosAlertas {
  readonly estado?: EstadoAlerta | undefined;
  readonly tipo?: TipoAlerta | undefined;
  readonly brigadaId?: string | undefined;
}

/**
 * Bandeja del proyecto. `brigadas` nulo: todas, incluidas las alertas sin brigada (Coordinación y
 * JdP, D02 §9); si no, solo las de esas brigadas.
 */
export const listarDeProyecto = async (
  db: Db,
  proyectoId: string,
  brigadas: readonly string[] | null,
  f: FiltrosAlertas,
  p: { readonly limite: number; readonly cursor: Cursor | null },
) => {
  if (brigadas !== null && brigadas.length === 0) return { filas: [], siguiente_cursor: null };
  let q = db
    .selectFrom('alerta as a')
    .leftJoin('estacion as e', 'e.id', 'a.estacion_id')
    .leftJoin('brigada as b', 'b.id', 'a.brigada_id')
    .leftJoin('usuario as u', 'u.id', 'a.creado_por')
    .select([
      'a.id',
      'a.tipo',
      'a.categoria',
      'a.estado',
      'a.origen',
      'a.titulo',
      'a.afecta_cronograma',
      'a.creado_en',
      'a.hora_dispositivo',
      'a.actualizado_en',
      'a.brigada_id',
      'b.nombre as brigada_nombre',
      'a.estacion_id',
      'e.codigo as estacion_codigo',
      'a.ejecucion_id',
      'u.nombre as autor_nombre',
      instanteCursor('a.creado_en').as('_cursor_t'),
    ])
    .where('a.proyecto_id', '=', proyectoId);
  if (brigadas !== null) q = q.where('a.brigada_id', 'in', brigadas);
  if (f.estado !== undefined) q = q.where('a.estado', '=', f.estado);
  if (f.tipo !== undefined) q = q.where('a.tipo', '=', f.tipo);
  if (f.brigadaId !== undefined) q = q.where('a.brigada_id', '=', f.brigadaId);
  // Por cursor (creado_en desc, id desc): estable aunque lleguen alertas nuevas entre páginas.
  if (p.cursor !== null) q = q.where(despuesDe('a.creado_en', 'a.id', p.cursor, 'desc'));
  const filas = await q
    .orderBy('a.creado_en', 'desc')
    .orderBy('a.id', 'desc')
    .limit(p.limite + 1)
    .execute();
  return pagina(filas, p.limite);
};

export const buscarAlerta = (db: Db, id: string, bloquear = false) => {
  const q = db
    .selectFrom('alerta')
    .select(['id', 'proyecto_id', 'brigada_id', 'estado', 'tipo', 'creado_por'])
    .where('id', '=', id);
  return (bloquear ? q.forUpdate() : q).executeTakeFirst();
};

export const detalleAlerta = (db: Db, id: string) =>
  db
    .selectFrom('alerta as a')
    .leftJoin('estacion as e', 'e.id', 'a.estacion_id')
    .leftJoin('brigada as b', 'b.id', 'a.brigada_id')
    .leftJoin('usuario as u', 'u.id', 'a.creado_por')
    .leftJoin('usuario as c', 'c.id', 'a.cerrado_por')
    .leftJoin('ejecucion as x', 'x.id', 'a.ejecucion_id')
    .leftJoin('metodo as m', 'm.id', 'x.metodo_id')
    .select([
      'a.id',
      'a.proyecto_id',
      'a.tipo',
      'a.categoria',
      'a.estado',
      'a.origen',
      'a.titulo',
      'a.descripcion',
      'a.afecta_cronograma',
      'a.creado_en',
      'a.hora_dispositivo',
      'a.actualizado_en',
      'a.brigada_id',
      'b.nombre as brigada_nombre',
      'a.estacion_id',
      'e.codigo as estacion_codigo',
      'a.ejecucion_id',
      'm.nombre as metodo_nombre',
      'a.reserva_id',
      'u.nombre as autor_nombre',
      'a.cerrado_en',
      'c.nombre as cerrado_por_nombre',
      'a.cierre_comentario',
    ])
    .where('a.id', '=', id)
    .executeTakeFirst();

export const mensajesDe = (db: Db, alertaId: string) =>
  db
    .selectFrom('alerta_mensaje as m')
    .innerJoin('usuario as u', 'u.id', 'm.autor_id')
    .select(['m.id', 'm.tipo', 'm.texto', 'm.creado_en', 'm.autor_id', 'u.nombre as autor_nombre'])
    .where('m.alerta_id', '=', alertaId)
    .orderBy('m.creado_en')
    .orderBy('m.id')
    .execute();

export const insertarMensaje = async (
  db: Db,
  alertaId: string,
  autorId: string,
  tipo: TipoMensajeAlerta,
  texto: string,
): Promise<string> => {
  const id = generarId();
  await db
    .insertInto('alerta_mensaje')
    .values({
      id,
      alerta_id: alertaId,
      autor_id: autorId,
      tipo,
      texto,
      creado_por: autorId,
      actualizado_por: autorId,
    })
    .execute();
  return id;
};
