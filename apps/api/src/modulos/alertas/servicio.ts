import {
  complementarAlerta,
  puedeIntentar,
  puedeModificar,
  tiposDeAlerta,
  transicionarAlerta,
  type AccionAlerta,
  type CategoriaAlertaLogistica,
  type EstadoAlerta,
  type MotivoRechazoAlerta,
  type Resultado,
  type Rol,
  type TipoAlertaRegistrable,
} from '@campo/core';
import type { Db } from '@campo/db';
import { noAutorizado, ProblemaHttp } from '../../plataforma/errores.ts';
import { generarId } from '../../plataforma/ids.ts';
import type { Actor } from '../../plataforma/sesion.ts';
import {
  brigadasVisibles,
  exigirGlobal,
  noEncontrado,
  rolEnBrigada,
  veTodosLosProyectos,
} from '../alcance/autorizacion.ts';
import { verProyecto } from '../organizacion/servicio.ts';
import * as repo from './repositorio.ts';

/**
 * Alertas estructuradas (D02 §9, D04 §10, RN-36): registros de excepción, no tareas ni chat.
 *
 * Alcance:
 * - Coordinación y JdP: todas las alertas del proyecto, también las que no tienen brigada (las
 *   post-sincronización y las registradas desde la web). Consultan, cierran y reabren.
 * - Especialista, Supervisor de campo y JdB: las de su brigada; responden y complementan.
 * - Administrador técnico: ninguna.
 * Las transiciones las valida la máquina de core (`transicionarAlerta`, `complementarAlerta`).
 */

const esGlobal = (actor: Actor): Rol | null =>
  actor.rolGlobal === 'coordinacion' || actor.rolGlobal === 'jefe_proyecto'
    ? actor.rolGlobal
    : null;

/** Rol con el que el actor ve la alerta, o `null` si está fuera de su alcance. */
const rolSobre = async (
  db: Db,
  actor: Actor,
  alerta: { brigada_id: string | null },
): Promise<Rol | null> => {
  const global = esGlobal(actor);
  if (global !== null) return global;
  if (alerta.brigada_id === null) return null;
  const rol = await rolEnBrigada(db, actor, alerta.brigada_id);
  return rol !== null && puedeIntentar(rol, 'consultar_seguimiento') ? rol : null;
};

const permisosDe = (rol: Rol, estado: EstadoAlerta) => {
  const cierra = puedeModificar(rol, 'cerrar_alertas');
  const responde = puedeModificar(rol, 'responder_alertas');
  return {
    puede_responder: responde && estado !== 'cerrada',
    // Pedir respuesta o decisión es de quien cierra (Coordinación y JdP, D02 §9).
    puede_consultar: cierra && estado === 'abierta',
    puede_cerrar: cierra && estado !== 'cerrada',
    puede_reabrir: cierra && estado === 'cerrada',
  };
};

const rechazo = (motivo: MotivoRechazoAlerta): ProblemaHttp =>
  motivo === 'TRANSICION_INVALIDA'
    ? new ProblemaHttp(409, motivo, 'La alerta no admite esa acción en su estado actual.')
    : new ProblemaHttp(400, motivo, 'Escriba el texto que explica la acción.');

const exigir = <T>(r: Resultado<T, MotivoRechazoAlerta>): T => {
  if (!r.ok) throw rechazo(r.motivo);
  return r.valor;
};

// ── Bandeja ────────────────────────────────────────────────────────────────

export const listarAlertas = async (
  db: Db,
  actor: Actor,
  proyectoId: string,
  filtros: repo.FiltrosAlertas,
  pag: Parameters<typeof repo.listarDeProyecto>[4],
) => {
  await verProyecto(db, actor, proyectoId);
  if (veTodosLosProyectos(actor)) return repo.listarDeProyecto(db, proyectoId, null, filtros, pag);
  const mapa = await brigadasVisibles(db, actor, proyectoId);
  const brigadas = [...mapa]
    .filter(([, rol]) => puedeIntentar(rol, 'consultar_seguimiento'))
    .map(([id]) => id);
  return repo.listarDeProyecto(db, proyectoId, brigadas, filtros, pag);
};

export const verAlerta = async (db: Db, actor: Actor, id: string) => {
  const a = await repo.detalleAlerta(db, id);
  if (a === undefined) throw noEncontrado('La alerta');
  const rol = await rolSobre(db, actor, a);
  if (rol === null) throw noEncontrado('La alerta');
  const mensajes = await repo.mensajesDe(db, id);
  return { ...a, mensajes, permisos: permisosDe(rol, a.estado as EstadoAlerta) };
};

// ── Registro desde la web (Coordinación y JdP) ─────────────────────────────

export interface AlertaWeb {
  readonly tipo: TipoAlertaRegistrable;
  readonly categoria: CategoriaAlertaLogistica | null;
  readonly titulo: string;
  readonly descripcion: string | null;
  readonly brigadaId: string | null;
  readonly estacionId: string | null;
  readonly afectaCronograma: boolean;
}

export const registrarDesdeWeb = async (
  db: Db,
  actor: Actor,
  proyectoId: string,
  d: AlertaWeb,
): Promise<string> => {
  exigirGlobal(actor, 'registrar_alerta');
  await verProyecto(db, actor, proyectoId);
  const rol = esGlobal(actor);
  if (rol === null || !tiposDeAlerta(rol).includes(d.tipo)) throw noAutorizado();
  if ((d.tipo === 'logistica') !== (d.categoria !== null)) {
    throw new ProblemaHttp(400, 'CATEGORIA', 'La alerta logística lleva categoría; la técnica no.');
  }
  if (d.brigadaId !== null) {
    const b = await db
      .selectFrom('brigada')
      .select('proyecto_id')
      .where('id', '=', d.brigadaId)
      .executeTakeFirst();
    if (b?.proyecto_id !== proyectoId) throw noEncontrado('La brigada');
  }
  if (d.estacionId !== null) {
    const e = await db
      .selectFrom('estacion')
      .select('proyecto_id')
      .where('id', '=', d.estacionId)
      .executeTakeFirst();
    if (e?.proyecto_id !== proyectoId) throw noEncontrado('La estación');
  }
  const id = generarId();
  await repo.insertarAlerta(db, {
    id,
    proyectoId,
    tipo: d.tipo,
    categoria: d.categoria,
    brigadaId: d.brigadaId,
    estacionId: d.estacionId,
    ejecucionId: null,
    reservaId: null,
    titulo: d.titulo,
    descripcion: d.descripcion,
    afectaCronograma: d.afectaCronograma,
    autorId: actor.usuarioId,
    dispositivoId: null,
    horaDispositivo: null,
    eventoId: null,
  });
  return id;
};

// ── Mensajes y transiciones ────────────────────────────────────────────────

export type TipoMensajeWeb = 'respuesta' | 'complemento' | 'consulta';

/**
 * Aplica una acción sobre la alerta bloqueando la fila: valida alcance, permiso y transición, deja
 * el mensaje en el historial y actualiza el estado. Nada se borra.
 */
const actuar = async (
  db: Db,
  actor: Actor,
  alertaId: string,
  accion: (
    rol: Rol,
    estado: EstadoAlerta,
  ) => {
    readonly hacia: EstadoAlerta;
    readonly mensaje: {
      tipo: 'respuesta' | 'complemento' | 'consulta' | 'cierre' | 'reapertura';
      texto: string;
    };
    readonly cierre?: { comentario: string | null } | 'reabrir';
  },
): Promise<EstadoAlerta> =>
  db.transaction().execute(async (tx) => {
    const a = await repo.buscarAlerta(tx, alertaId, true);
    if (a === undefined) throw noEncontrado('La alerta');
    const rol = await rolSobre(tx, actor, a);
    if (rol === null) throw noEncontrado('La alerta');
    const r = accion(rol, a.estado as EstadoAlerta);
    await repo.insertarMensaje(tx, alertaId, actor.usuarioId, r.mensaje.tipo, r.mensaje.texto);
    const cambios =
      r.cierre === undefined
        ? {}
        : r.cierre === 'reabrir'
          ? { cerrado_por: null, cerrado_en: null, cierre_comentario: null }
          : {
              cerrado_por: actor.usuarioId,
              cerrado_en: new Date(),
              cierre_comentario: r.cierre.comentario,
            };
    await tx
      .updateTable('alerta')
      .set({ estado: r.hacia, actualizado_por: actor.usuarioId, ...cambios })
      .where('id', '=', alertaId)
      .execute();
    return r.hacia;
  });

export const agregarMensaje = (
  db: Db,
  actor: Actor,
  alertaId: string,
  tipo: TipoMensajeWeb,
  texto: string,
): Promise<EstadoAlerta> =>
  actuar(db, actor, alertaId, (rol, estado) => {
    if (tipo === 'consulta') {
      if (!puedeModificar(rol, 'cerrar_alertas')) throw noAutorizado();
      return {
        hacia: exigir(transicionarAlerta(estado, { tipo: 'consultar' })),
        mensaje: { tipo, texto },
      };
    }
    if (!puedeModificar(rol, 'responder_alertas')) throw noAutorizado();
    const hacia =
      tipo === 'respuesta'
        ? exigir(transicionarAlerta(estado, { tipo: 'responder', texto }))
        : exigir(complementarAlerta(estado, texto));
    return { hacia, mensaje: { tipo, texto } };
  });

export const cerrarAlerta = (
  db: Db,
  actor: Actor,
  alertaId: string,
  comentario: string | null,
): Promise<EstadoAlerta> =>
  actuar(db, actor, alertaId, (rol, estado) => {
    if (!puedeModificar(rol, 'cerrar_alertas')) throw noAutorizado();
    const accion: AccionAlerta = { tipo: 'cerrar', comentario };
    return {
      hacia: exigir(transicionarAlerta(estado, accion)),
      mensaje: { tipo: 'cierre', texto: comentario ?? 'Alerta cerrada sin comentario.' },
      cierre: { comentario },
    };
  });

export const reabrirAlerta = (
  db: Db,
  actor: Actor,
  alertaId: string,
  motivo: string,
): Promise<EstadoAlerta> =>
  actuar(db, actor, alertaId, (rol, estado) => {
    // [DTP] Reabre quien cierra: Coordinación y JdP (RN-36 no asigna la reapertura).
    if (!puedeModificar(rol, 'cerrar_alertas')) throw noAutorizado();
    return {
      hacia: exigir(transicionarAlerta(estado, { tipo: 'reabrir', motivo })),
      mensaje: { tipo: 'reapertura', texto: motivo },
      cierre: 'reabrir',
    };
  });
