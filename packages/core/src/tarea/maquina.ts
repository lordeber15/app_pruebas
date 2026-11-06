import type { EstadoTarea, OrigenTarea } from '../estados';
import { exito, fallo, tieneTexto, type Resultado } from '../resultado';

/**
 * Máquina de estados de la tarea (doc. 02 §7.1). Es la única implementación: la API,
 * el worker y la app la usan desde aquí y nunca la reimplementan.
 *
 * La autorización por rol y alcance no se decide aquí (ver `permisos.ts`); aquí solo
 * se decide si la acción es válida para el estado actual y sus condiciones.
 */
export type AccionTarea =
  /** El cuaderno se asigna a un responsable. */
  | { readonly tipo: 'asignar' }
  /** Tarea no descargada o devuelta que pasa a otro responsable (RN-07). */
  | { readonly tipo: 'reasignar' }
  /** Descarga en el celular: crea la asignación vigente (RN-03). */
  | { readonly tipo: 'descargar' }
  /** El celular libera la tarea al sincronizar. */
  | { readonly tipo: 'devolver' }
  /** Supervisor o jefe revoca la asignación retenida (RN-07). */
  | { readonly tipo: 'revocar'; readonly motivo: string }
  /** Evento `tarea_completada` recibido (RN-04). */
  | { readonly tipo: 'completar'; readonly fotosAnunciadas: number }
  /** El servidor verificó el hash de al menos una foto (RN-05). */
  | { readonly tipo: 'verificar_evidencia'; readonly fotosVerificadas: number }
  | { readonly tipo: 'validar'; readonly validacionActiva: boolean }
  | { readonly tipo: 'observar'; readonly validacionActiva: boolean }
  /** Una tarea observada vuelve al celular por la bajada incremental. */
  | { readonly tipo: 'redescargar' }
  | { readonly tipo: 'reabrir'; readonly motivo: string }
  /** Cierre en la web de una tarea por regla, sin foto (RN-04, excepción). */
  | { readonly tipo: 'cerrar'; readonly origen: OrigenTarea; readonly comentario: string };

export type TipoAccionTarea = AccionTarea['tipo'];

export type MotivoRechazoTarea =
  | 'TRANSICION_INVALIDA'
  | 'TAREA_CERRADA'
  | 'TAREA_RETENIDA'
  | 'SIN_FOTO'
  | 'EVIDENCIA_NO_VERIFICADA'
  | 'MOTIVO_OBLIGATORIO'
  | 'COMENTARIO_OBLIGATORIO'
  | 'VALIDACION_INACTIVA'
  | 'SOLO_TAREA_POR_REGLA';

/** Estados de origen y destino de cada acción, tal como los define el diagrama de doc. 02 §7.1. */
export const TRANSICIONES_TAREA: Readonly<
  Record<TipoAccionTarea, { readonly desde: readonly EstadoTarea[]; readonly hacia: EstadoTarea }>
> = {
  asignar: { desde: ['pendiente'], hacia: 'asignada' },
  reasignar: { desde: ['asignada'], hacia: 'asignada' },
  descargar: { desde: ['asignada'], hacia: 'descargada' },
  devolver: { desde: ['descargada'], hacia: 'asignada' },
  revocar: { desde: ['descargada'], hacia: 'asignada' },
  completar: { desde: ['descargada'], hacia: 'en_transito' },
  verificar_evidencia: { desde: ['en_transito'], hacia: 'completada' },
  validar: { desde: ['completada'], hacia: 'validada' },
  observar: { desde: ['completada'], hacia: 'observada' },
  redescargar: { desde: ['observada'], hacia: 'descargada' },
  reabrir: { desde: ['completada', 'validada'], hacia: 'asignada' },
  cerrar: { desde: ['asignada'], hacia: 'cerrada' },
};

/** Estados desde los que ninguna acción es posible. */
const ESTADOS_FINALES: readonly EstadoTarea[] = ['cerrada'];

const condiciones = (accion: AccionTarea): MotivoRechazoTarea | null => {
  switch (accion.tipo) {
    case 'revocar':
    case 'reabrir':
      return tieneTexto(accion.motivo) ? null : 'MOTIVO_OBLIGATORIO';
    case 'completar':
      return accion.fotosAnunciadas >= 1 ? null : 'SIN_FOTO';
    case 'verificar_evidencia':
      return accion.fotosVerificadas >= 1 ? null : 'EVIDENCIA_NO_VERIFICADA';
    case 'validar':
    case 'observar':
      return accion.validacionActiva ? null : 'VALIDACION_INACTIVA';
    case 'cerrar':
      if (accion.origen !== 'regla') return 'SOLO_TAREA_POR_REGLA';
      return tieneTexto(accion.comentario) ? null : 'COMENTARIO_OBLIGATORIO';
    case 'asignar':
    case 'reasignar':
    case 'descargar':
    case 'devolver':
    case 'redescargar':
      return null;
  }
};

/** Aplica una acción sobre el estado actual. No muta nada: devuelve el estado siguiente o el motivo del rechazo. */
export const transicionarTarea = (
  estado: EstadoTarea,
  accion: AccionTarea,
): Resultado<EstadoTarea, MotivoRechazoTarea> => {
  if (ESTADOS_FINALES.includes(estado)) return fallo('TAREA_CERRADA');

  const transicion = TRANSICIONES_TAREA[accion.tipo];
  if (!transicion.desde.includes(estado)) {
    // RN-07 y CP-031: una tarea retenida solo se reasigna revocando.
    if (accion.tipo === 'reasignar' && estado === 'descargada') return fallo('TAREA_RETENIDA');
    return fallo('TRANSICION_INVALIDA');
  }

  const rechazo = condiciones(accion);
  return rechazo === null ? exito(transicion.hacia) : fallo(rechazo);
};
