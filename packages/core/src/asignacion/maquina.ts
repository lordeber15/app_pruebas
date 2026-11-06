import type { EstadoAsignacion } from '../estados';
import { exito, fallo, tieneTexto, type Resultado } from '../resultado';

/**
 * Máquina de estados de la asignación (doc. 02 §7.2). Solo la asignación vigente cambia de
 * estado; los demás estados son finales. La unicidad de la vigente por tarea (RN-02) la
 * garantiza el índice único parcial de la base de datos.
 */
export type AccionAsignacion =
  | { readonly tipo: 'finalizar' }
  | { readonly tipo: 'devolver' }
  | { readonly tipo: 'revocar'; readonly motivo: string };

export type MotivoRechazoAsignacion = 'ASIGNACION_NO_VIGENTE' | 'MOTIVO_OBLIGATORIO';

const DESTINO: Readonly<Record<AccionAsignacion['tipo'], EstadoAsignacion>> = {
  finalizar: 'finalizada',
  devolver: 'devuelta',
  revocar: 'revocada',
};

export const transicionarAsignacion = (
  estado: EstadoAsignacion,
  accion: AccionAsignacion,
): Resultado<EstadoAsignacion, MotivoRechazoAsignacion> => {
  if (estado !== 'vigente') return fallo('ASIGNACION_NO_VIGENTE');
  if (accion.tipo === 'revocar' && !tieneTexto(accion.motivo)) return fallo('MOTIVO_OBLIGATORIO');
  return exito(DESTINO[accion.tipo]);
};
