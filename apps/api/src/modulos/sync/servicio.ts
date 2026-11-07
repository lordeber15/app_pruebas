import { eventoSchema } from '@campo/core';
import type { Db } from '@campo/db';
import { z } from 'zod';
import type { ActorDispositivo } from '../../plataforma/sesion.ts';
import { decidir, type EstadoResultado } from './aplicar.ts';
import * as repo from './repositorio.ts';

export interface ResultadoEvento {
  readonly id: string;
  readonly estado: EstadoResultado;
  readonly motivo?: string;
}

/** Lo mínimo para poder guardar un evento aunque su contenido no pase el esquema. */
const sobreMinimo = z.looseObject({
  id: z.uuidv7(),
  tipo: z.string().max(100).optional(),
  version_esquema: z.number().int().positive().optional(),
  entidad: z.looseObject({ tipo: z.string().max(100), id: z.uuid() }).optional(),
  payload: z.unknown().optional(),
});
export type SobreMinimo = z.infer<typeof sobreMinimo>;
export { sobreMinimo };

const resultado = (id: string, estado: EstadoResultado, motivo: string | null): ResultadoEvento =>
  motivo === null ? { id, estado } : { id, estado, motivo };

const codigo = (e: unknown): string | undefined => (e as { code?: string }).code;
const constraint = (e: unknown): string | undefined => (e as { constraint?: string }).constraint;

/**
 * Reenvío del mismo evento (RN-10, CP-026): no se duplica. Si se había aplicado, responde
 * "ya_aplicado"; si no, repite su estado y motivo para que el autor siga viendo el aviso (RN-12).
 */
const reenvio = (
  actor: ActorDispositivo,
  previo: { usuario_id: string; estado: string; motivo: string | null },
  id: string,
): ResultadoEvento => {
  if (previo.usuario_id !== actor.usuarioId) return resultado(id, 'no_aplicado', 'ID_DUPLICADO');
  if (previo.estado === 'aplicado' || previo.estado === 'ya_aplicado')
    return resultado(id, 'ya_aplicado', null);
  const estado = (['no_aplicado', 'en_revision', 'duplicado'] as const).find(
    (e) => e === previo.estado,
  );
  return resultado(id, estado ?? 'ya_aplicado', previo.motivo);
};

const guardarRechazo = async (
  db: Db,
  actor: ActorDispositivo,
  crudo: SobreMinimo,
  motivo: string,
): Promise<ResultadoEvento> => {
  try {
    await repo.insertarEvento(db, {
      id: crudo.id,
      tipo: crudo.tipo ?? 'desconocido',
      versionEsquema: crudo.version_esquema ?? 1,
      usuarioId: actor.usuarioId,
      dispositivoId: actor.dispositivoId,
      asignacionId: null,
      entidadTipo: crudo.entidad?.tipo ?? 'desconocida',
      entidadId: crudo.entidad?.id ?? crudo.id,
      payload: crudo,
      ubicacion: null,
      horaDispositivo: null,
      estado: 'no_aplicado',
      motivo,
    });
  } catch (e) {
    if (codigo(e) === '23505') {
      const previo = await repo.buscarEvento(db, crudo.id);
      if (previo !== undefined) return reenvio(actor, previo, crudo.id);
    }
    throw e;
  }
  return resultado(crudo.id, 'no_aplicado', motivo);
};

const procesarEvento = async (
  db: Db,
  actor: ActorDispositivo,
  crudo: SobreMinimo,
): Promise<ResultadoEvento> => {
  const previo = await repo.buscarEvento(db, crudo.id);
  if (previo !== undefined) return reenvio(actor, previo, crudo.id);

  const parse = eventoSchema.safeParse(crudo);
  if (!parse.success) return guardarRechazo(db, actor, crudo, 'ESQUEMA_INVALIDO');
  const e = parse.data;

  // usuario_id y dispositivo_id salen de la sesión; si el cuerpo los trae, deben coincidir.
  if (
    (e.usuario_id !== undefined && e.usuario_id !== actor.usuarioId) ||
    (e.dispositivo_id !== undefined && e.dispositivo_id !== actor.dispositivoId)
  ) {
    return guardarRechazo(db, actor, crudo, 'IDENTIDAD_NO_COINCIDE');
  }

  try {
    return await db.transaction().execute(async (tx) => {
      const d = await decidir(tx, actor, e);
      await repo.insertarEvento(tx, {
        id: e.id,
        tipo: e.tipo,
        versionEsquema: e.version_esquema,
        usuarioId: actor.usuarioId,
        dispositivoId: actor.dispositivoId,
        asignacionId: e.asignacion_id,
        entidadTipo: e.entidad.tipo,
        entidadId: e.entidad.id,
        payload: e.payload,
        ubicacion: e.ubicacion,
        horaDispositivo: new Date(e.hora_dispositivo),
        estado: d.estado,
        motivo: d.motivo,
      });
      // Un evento en revisión puede traer efectos que conservan evidencia (p. ej. una foto cuya
      // unidad aún no llegó); los demás estados nunca los ejecutan.
      if ((d.estado === 'aplicado' || d.estado === 'en_revision') && d.efectos !== undefined) {
        await d.efectos(tx, e.id);
      }
      return resultado(e.id, d.estado, d.motivo);
    });
  } catch (err) {
    // Otro lote insertó el mismo evento a la vez.
    if (codigo(err) === '23505' && constraint(err) === 'evento_pkey') {
      const p = await repo.buscarEvento(db, e.id);
      if (p !== undefined) return reenvio(actor, p, e.id);
    }
    // Una referencia que no existe o una entidad repetida: se guarda como no aplicado.
    if (codigo(err) === '23503') return guardarRechazo(db, actor, crudo, 'REFERENCIA_INVALIDA');
    if (codigo(err) === '23505') return guardarRechazo(db, actor, crudo, 'ENTIDAD_DUPLICADA');
    if (codigo(err) === '23514') return guardarRechazo(db, actor, crudo, 'DATOS_INVALIDOS');
    throw err;
  }
};

/**
 * Lote de eventos (doc. 03 §9). Se procesan en el orden recibido, cada uno en su transacción:
 * el orden válido lo da la hora del servidor al guardarlos (RN-09).
 */
export const procesarLote = async (
  db: Db,
  actor: ActorDispositivo,
  eventos: readonly SobreMinimo[],
): Promise<ResultadoEvento[]> => {
  const resultados: ResultadoEvento[] = [];
  for (const crudo of eventos) resultados.push(await procesarEvento(db, actor, crudo));
  await db
    .updateTable('dispositivo')
    .set({ ultimo_sync_en: new Date() })
    .where('id', '=', actor.dispositivoId)
    .execute();
  return resultados;
};
