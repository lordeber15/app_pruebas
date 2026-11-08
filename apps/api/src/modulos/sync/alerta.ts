import { esRolBrigada, tiposDeAlerta, type Evento, type Rol } from '@campo/core';
import type { Db } from '@campo/db';
import type { ActorDispositivo } from '../../plataforma/sesion.ts';
import { insertarAlerta } from '../alertas/repositorio.ts';
import type { Decision } from './aplicar.ts';

type EventoDe<T extends Evento['tipo']> = Extract<Evento, { tipo: T }>;

const noAplicado = (motivo: string): Decision => ({ estado: 'no_aplicado', motivo });

/**
 * Alerta registrada en campo sin señal (D02 §9 y §13, RN-36). En el celular estaba «pendiente de
 * sincronización»; aquí nace `abierta` con origen `usuario`.
 *
 * - El tipo lo autoriza `tiposDeAlerta` con el rol del usuario en la brigada del payload
 *   (especialista y supervisor: técnica; JdB: logística; Coordinación y JdP: cualquiera).
 * - Usuario y dispositivo salen de la sesión; la hora del dispositivo es solo un dato (RN-09).
 * - Idempotente por el id del evento (RN-10) y por el id de la alerta.
 * - Si la ejecución citada aún no llegó, la alerta se guarda sin ese vínculo y el evento queda
 *   en revisión (RN-13): no se pierde ni se bloquea.
 */
export const alertaRegistrada = async (
  tx: Db,
  actor: ActorDispositivo,
  e: EventoDe<'alerta_local_generada'>,
): Promise<Decision> => {
  const p = e.payload;
  if (e.entidad.tipo !== 'alerta' || e.entidad.id !== p.alerta_id) {
    return noAplicado('ENTIDAD_INCONSISTENTE');
  }
  const existe = await tx
    .selectFrom('alerta')
    .select('creado_por')
    .where('id', '=', p.alerta_id)
    .executeTakeFirst();
  if (existe !== undefined) {
    return existe.creado_por === actor.usuarioId
      ? { estado: 'ya_aplicado', motivo: null }
      : noAplicado('ENTIDAD_DUPLICADA');
  }

  const brigada = await tx
    .selectFrom('brigada as b')
    .innerJoin('proyecto as p', 'p.id', 'b.proyecto_id')
    .leftJoin('miembro_brigada as m', (j) =>
      j
        .onRef('m.brigada_id', '=', 'b.id')
        .on('m.usuario_id', '=', actor.usuarioId)
        .on('m.estado', '=', 'activo'),
    )
    .select(['b.id', 'b.proyecto_id', 'p.estado as estado_proyecto', 'm.rol'])
    .where('b.id', '=', p.brigada_id)
    .executeTakeFirst();
  if (brigada === undefined) return noAplicado('FUERA_DE_ALCANCE');
  const rol: Rol | null =
    actor.rolGlobal === 'coordinacion' || actor.rolGlobal === 'jefe_proyecto'
      ? actor.rolGlobal
      : brigada.rol !== null && esRolBrigada(brigada.rol)
        ? brigada.rol
        : null;
  if (rol === null || brigada.estado_proyecto !== 'activo') return noAplicado('FUERA_DE_ALCANCE');
  if (!tiposDeAlerta(rol).includes(p.tipo)) return noAplicado('TIPO_NO_PERMITIDO');

  const proyectoId = brigada.proyecto_id;
  let estacionId = p.estacion_id;
  if (estacionId !== null) {
    const est = await tx
      .selectFrom('estacion')
      .select('proyecto_id')
      .where('id', '=', estacionId)
      .executeTakeFirst();
    if (est?.proyecto_id !== proyectoId) return noAplicado('REFERENCIA_INVALIDA');
  }
  if (p.reserva_id !== null) {
    const r = await tx
      .selectFrom('reserva')
      .select(['proyecto_id', 'brigada_id', 'estacion_id'])
      .where('id', '=', p.reserva_id)
      .executeTakeFirst();
    if (r?.proyecto_id !== proyectoId || r.brigada_id !== p.brigada_id) {
      return noAplicado('REFERENCIA_INVALIDA');
    }
    estacionId ??= r.estacion_id;
  }
  let ejecucionId = p.ejecucion_id;
  let pendiente = false;
  if (ejecucionId !== null) {
    const x = await tx
      .selectFrom('ejecucion')
      .select(['proyecto_id', 'brigada_id', 'estacion_id'])
      .where('id', '=', ejecucionId)
      .executeTakeFirst();
    if (x === undefined) {
      ejecucionId = null;
      pendiente = true;
    } else if (x.proyecto_id !== proyectoId || x.brigada_id !== p.brigada_id) {
      return noAplicado('REFERENCIA_INVALIDA');
    } else {
      estacionId ??= x.estacion_id;
    }
  }

  const efectos: NonNullable<Decision['efectos']> = async (t, eventoId) => {
    await insertarAlerta(t, {
      id: p.alerta_id,
      proyectoId,
      tipo: p.tipo,
      categoria: p.categoria,
      brigadaId: p.brigada_id,
      estacionId,
      ejecucionId,
      reservaId: p.reserva_id,
      titulo: p.titulo,
      descripcion: p.descripcion === null || p.descripcion.length === 0 ? null : p.descripcion,
      afectaCronograma: p.afecta_cronograma,
      autorId: actor.usuarioId,
      dispositivoId: actor.dispositivoId,
      horaDispositivo: new Date(e.hora_dispositivo),
      eventoId,
    });
  };
  return pendiente
    ? { estado: 'en_revision', motivo: 'EJECUCION_PENDIENTE', efectos }
    : { estado: 'aplicado', motivo: null, efectos };
};
