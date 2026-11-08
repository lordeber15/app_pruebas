import type { EstadoAlerta, EstadoSolicitudCronograma } from '../estados.ts';
import { exito, fallo, tieneTexto, type Resultado } from '../resultado.ts';

/**
 * Alertas (D02 §9, D04 §10, RN-36): registros estructurados de excepción, no tareas ni chat.
 *
 *   [celular: pendiente_sync] ──▶ abierta ──consultar──▶ pendiente_respuesta ──responder──▶ abierta
 *   abierta | pendiente_respuesta ──cerrar──▶ cerrada ──reabrir(motivo)──▶ abierta
 *
 * Quién puede cerrar (Coordinación y Jefe de Proyecto) lo decide la autorización de la API con
 * `permisos.ts`; aquí solo se valida la transición. Si la alerta origina un cambio de cronograma,
 * la solicitud lleva su propia máquina (`transicionarSolicitudCronograma`).
 */
export type AccionAlerta =
  /** Coordinación o JdP piden una respuesta o decisión a alguien de campo. */
  | { readonly tipo: 'consultar' }
  /** Especialista, Supervisor o JdB responden o complementan en su ámbito. */
  | { readonly tipo: 'responder'; readonly texto: string }
  | { readonly tipo: 'cerrar'; readonly comentario: string | null }
  | { readonly tipo: 'reabrir'; readonly motivo: string };

export type TipoAccionAlerta = AccionAlerta['tipo'];

export type MotivoRechazoAlerta =
  'TRANSICION_INVALIDA' | 'TEXTO_OBLIGATORIO' | 'MOTIVO_OBLIGATORIO';

export const TRANSICIONES_ALERTA: Readonly<
  Record<
    TipoAccionAlerta,
    { readonly desde: readonly EstadoAlerta[]; readonly hacia: EstadoAlerta }
  >
> = {
  consultar: { desde: ['abierta'], hacia: 'pendiente_respuesta' },
  responder: { desde: ['abierta', 'pendiente_respuesta'], hacia: 'abierta' },
  cerrar: { desde: ['abierta', 'pendiente_respuesta'], hacia: 'cerrada' },
  reabrir: { desde: ['cerrada'], hacia: 'abierta' },
};

export const transicionarAlerta = (
  estado: EstadoAlerta,
  accion: AccionAlerta,
): Resultado<EstadoAlerta, MotivoRechazoAlerta> => {
  const t = TRANSICIONES_ALERTA[accion.tipo];
  if (!t.desde.includes(estado)) return fallo('TRANSICION_INVALIDA');
  if (accion.tipo === 'responder' && !tieneTexto(accion.texto)) return fallo('TEXTO_OBLIGATORIO');
  if (accion.tipo === 'reabrir' && !tieneTexto(accion.motivo)) return fallo('MOTIVO_OBLIGATORIO');
  return exito(t.hacia);
};

/**
 * Complemento (D02 §9: «responder/complementar»): agrega información sin cambiar el estado. Solo
 * sobre una alerta que no está cerrada; para aportar a una cerrada primero se reabre.
 */
export const complementarAlerta = (
  estado: EstadoAlerta,
  texto: string,
): Resultado<EstadoAlerta, MotivoRechazoAlerta> => {
  if (estado === 'cerrada') return fallo('TRANSICION_INVALIDA');
  if (!tieneTexto(texto)) return fallo('TEXTO_OBLIGATORIO');
  return exito(estado);
};

/**
 * Solicitud de cambio de cronograma (D02 §10, RN-36): Coordinación propone; solo el Jefe de
 * Proyecto aprueba, rechaza o pide ajuste. Aprobar genera una versión vigente nueva (RN-35).
 *
 *   pendiente ──aprobar──▶ aprobada
 *   pendiente ──rechazar(comentario)──▶ rechazada
 *   pendiente ──pedir_ajuste(comentario)──▶ ajuste_solicitado ──ajustar──▶ pendiente
 */
export type AccionSolicitudCronograma =
  | { readonly tipo: 'aprobar' }
  | { readonly tipo: 'rechazar'; readonly comentario: string }
  | { readonly tipo: 'pedir_ajuste'; readonly comentario: string }
  | { readonly tipo: 'ajustar' };

export type MotivoRechazoSolicitud = 'TRANSICION_INVALIDA' | 'COMENTARIO_OBLIGATORIO';

export const TRANSICIONES_SOLICITUD_CRONOGRAMA: Readonly<
  Record<
    AccionSolicitudCronograma['tipo'],
    {
      readonly desde: readonly EstadoSolicitudCronograma[];
      readonly hacia: EstadoSolicitudCronograma;
    }
  >
> = {
  aprobar: { desde: ['pendiente'], hacia: 'aprobada' },
  rechazar: { desde: ['pendiente'], hacia: 'rechazada' },
  pedir_ajuste: { desde: ['pendiente'], hacia: 'ajuste_solicitado' },
  ajustar: { desde: ['ajuste_solicitado'], hacia: 'pendiente' },
};

export const transicionarSolicitudCronograma = (
  estado: EstadoSolicitudCronograma,
  accion: AccionSolicitudCronograma,
): Resultado<EstadoSolicitudCronograma, MotivoRechazoSolicitud> => {
  const t = TRANSICIONES_SOLICITUD_CRONOGRAMA[accion.tipo];
  if (!t.desde.includes(estado)) return fallo('TRANSICION_INVALIDA');
  if (
    (accion.tipo === 'rechazar' || accion.tipo === 'pedir_ajuste') &&
    !tieneTexto(accion.comentario)
  ) {
    return fallo('COMENTARIO_OBLIGATORIO');
  }
  return exito(t.hacia);
};
