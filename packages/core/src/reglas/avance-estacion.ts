import type { Avance } from './tipos.ts';

/**
 * Avance de una estación (decisión del usuario, 2026-11-08): **métodos completos / métodos
 * aplicables**. Es un conteo, no un promedio simple de porcentajes (P-11 sigue pendiente).
 *
 * Un método aplicable cuenta como completo cuando su avance elemental llega al 100 % (RN-38) o,
 * si D01 no da un objetivo numérico, cuando tiene al menos una ejecución completa o validada.
 * Sin ninguna ejecución recibida no se afirma 0 %: el estado es `sin_datos` hasta que el
 * cronograma diga que ya debía empezar (RN-37).
 */

export type EstadoEjecucionAvance =
  'en_curso' | 'evidencia_pendiente' | 'completa' | 'parcial' | 'validada' | 'observada';

export interface MetodoEnEstacion {
  /** Código del método (D01). */
  readonly metodo: string;
  /** Avance elemental del método en la estación (suma de todos los usuarios, RN-19). */
  readonly avance: Avance;
  /** Estados de las ejecuciones recibidas para este método en la estación. */
  readonly ejecuciones: readonly EstadoEjecucionAvance[];
}

export type EstadoEstacion =
  /** Hay ejecuciones con incumplimiento obligatorio (parcial u observada). */
  | 'con_incumplimiento'
  /** Todos los métodos aplicables están completos. */
  | 'completa'
  /** Hay al menos una ejecución, pero faltan métodos. */
  | 'en_curso'
  /** Reprogramada en el cronograma vigente y sin ejecuciones. */
  | 'reprogramada'
  /** Programada para hoy o antes y sin ninguna ejecución recibida. */
  | 'sin_datos'
  /** Programada a futuro (o sin programar) y sin ejecuciones. */
  | 'sin_iniciar';

export interface AvanceEstacion {
  readonly completos: number;
  readonly aplicables: number;
  /** completos / aplicables con un decimal; `null` sin métodos aplicables o sin datos. */
  readonly porcentaje: number | null;
  readonly estado: EstadoEstacion;
}

const TERMINADAS: readonly EstadoEjecucionAvance[] = ['completa', 'validada'];
const CON_FALTANTES: readonly EstadoEjecucionAvance[] = ['parcial', 'observada'];

export const metodoCompleto = (m: MetodoEnEstacion): boolean =>
  m.avance.porcentaje === null
    ? m.ejecuciones.some((e) => TERMINADAS.includes(e))
    : m.avance.porcentaje >= 100;

export const avanceEstacion = (
  metodos: readonly MetodoEnEstacion[],
  opciones: {
    /** Fecha programada en el cronograma vigente (YYYY-MM-DD), si la hay. */
    readonly fechaProgramada?: string | null;
    /** Fecha de hoy en la zona del proyecto (YYYY-MM-DD). */
    readonly hoy: string;
    /** La fila del cronograma vigente está reprogramada respecto del base. */
    readonly reprogramada?: boolean;
  },
): AvanceEstacion => {
  const aplicables = metodos.length;
  const completos = metodos.filter(metodoCompleto).length;
  const conEjecuciones = metodos.some((m) => m.ejecuciones.length > 0);
  const porcentaje =
    aplicables === 0 || !conEjecuciones ? null : Math.round((completos / aplicables) * 1000) / 10;

  let estado: EstadoEstacion;
  if (metodos.some((m) => m.ejecuciones.some((e) => CON_FALTANTES.includes(e))))
    estado = 'con_incumplimiento';
  else if (aplicables > 0 && completos === aplicables) estado = 'completa';
  else if (conEjecuciones) estado = 'en_curso';
  else if (opciones.reprogramada === true) estado = 'reprogramada';
  else if (
    opciones.fechaProgramada !== undefined &&
    opciones.fechaProgramada !== null &&
    opciones.fechaProgramada <= opciones.hoy
  )
    estado = 'sin_datos';
  else estado = 'sin_iniciar';

  return { completos, aplicables, porcentaje, estado };
};

/** Texto para la interfaz: el color nunca es el único indicador. */
export const ETIQUETA_ESTADO_ESTACION: Readonly<Record<EstadoEstacion, string>> = {
  con_incumplimiento: 'Con incumplimiento',
  completa: 'Completa',
  en_curso: 'En curso',
  reprogramada: 'Reprogramada',
  sin_datos: 'Sin datos sincronizados',
  sin_iniciar: 'Sin iniciar',
};
