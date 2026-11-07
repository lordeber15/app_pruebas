import type { EstadoEjecucion } from '../estados.ts';
import { exito, fallo, tieneTexto, type Resultado } from '../resultado.ts';

/**
 * Máquina de estados de la ejecución de un método en una estación (D02 §6 y §9, RN-05,
 * RN-06, RN-13). Estados del servidor; los del celular (completitud local, pendiente de
 * sincronización) viven en la app y se traducen a eventos.
 *
 *   en_curso ──cerrar──▶ evidencia_pendiente ──evaluar_qa──▶ completa | parcial
 *   completa | parcial ──validar──▶ validada      (solo con validación humana activa, C1)
 *   completa | parcial ──observar──▶ observada ──corregir──▶ en_curso
 *   completa | parcial | validada ──reabrir(motivo)──▶ en_curso
 *
 * `parcial` no es un rechazo: es una ejecución cerrada a la que le falta al menos un requisito
 * **obligatorio** de D01 (RN-31). Advertencias, referencias y criterios humanos nunca la hacen
 * parcial.
 */
export type AccionEjecucion =
  /** Evento `ejecucion_cerrada` del celular. */
  | { readonly tipo: 'cerrar' }
  /** El worker verificó los hashes anunciados (o no había evidencias) y evaluó las reglas de D01. */
  | { readonly tipo: 'evaluar_qa'; readonly incumplimientosObligatorios: number }
  | { readonly tipo: 'validar'; readonly validacionActiva: boolean }
  | { readonly tipo: 'observar'; readonly validacionActiva: boolean; readonly comentario: string }
  /** La ejecución observada vuelve al celular por la bajada incremental. */
  | { readonly tipo: 'corregir' }
  | { readonly tipo: 'reabrir'; readonly motivo: string };

export type TipoAccionEjecucion = AccionEjecucion['tipo'];

export type MotivoRechazoEjecucion =
  'TRANSICION_INVALIDA' | 'VALIDACION_INACTIVA' | 'MOTIVO_OBLIGATORIO' | 'COMENTARIO_OBLIGATORIO';

export const TRANSICIONES_EJECUCION: Readonly<
  Record<
    TipoAccionEjecucion,
    { readonly desde: readonly EstadoEjecucion[]; readonly hacia: readonly EstadoEjecucion[] }
  >
> = {
  cerrar: { desde: ['en_curso'], hacia: ['evidencia_pendiente'] },
  evaluar_qa: { desde: ['evidencia_pendiente'], hacia: ['completa', 'parcial'] },
  validar: { desde: ['completa', 'parcial'], hacia: ['validada'] },
  observar: { desde: ['completa', 'parcial'], hacia: ['observada'] },
  corregir: { desde: ['observada'], hacia: ['en_curso'] },
  reabrir: { desde: ['completa', 'parcial', 'validada'], hacia: ['en_curso'] },
};

const condiciones = (accion: AccionEjecucion): MotivoRechazoEjecucion | null => {
  switch (accion.tipo) {
    case 'validar':
      return accion.validacionActiva ? null : 'VALIDACION_INACTIVA';
    case 'observar':
      if (!accion.validacionActiva) return 'VALIDACION_INACTIVA';
      return tieneTexto(accion.comentario) ? null : 'COMENTARIO_OBLIGATORIO';
    case 'reabrir':
      return tieneTexto(accion.motivo) ? null : 'MOTIVO_OBLIGATORIO';
    case 'cerrar':
    case 'evaluar_qa':
    case 'corregir':
      return null;
  }
};

const destino = (estado: EstadoEjecucion, accion: AccionEjecucion): EstadoEjecucion => {
  if (accion.tipo === 'evaluar_qa') {
    return accion.incumplimientosObligatorios > 0 ? 'parcial' : 'completa';
  }
  const hacia = TRANSICIONES_EJECUCION[accion.tipo].hacia[0];
  return hacia ?? estado;
};

export const transicionarEjecucion = (
  estado: EstadoEjecucion,
  accion: AccionEjecucion,
): Resultado<EstadoEjecucion, MotivoRechazoEjecucion> => {
  if (!TRANSICIONES_EJECUCION[accion.tipo].desde.includes(estado)) {
    return fallo('TRANSICION_INVALIDA');
  }
  const rechazo = condiciones(accion);
  return rechazo === null ? exito(destino(estado, accion)) : fallo(rechazo);
};

/** Estados en los que la ejecución ya no está en manos del celular. */
export const ESTADOS_EJECUCION_CERRADOS: readonly EstadoEjecucion[] = [
  'evidencia_pendiente',
  'completa',
  'parcial',
  'validada',
];
