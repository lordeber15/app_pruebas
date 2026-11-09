import { z } from 'zod';
import type { Objetivo } from './tipos.ts';

/**
 * Esfuerzo planificado vs. ejecutado de una ejecución (RF-T05, RN-19, D01 T-10).
 *
 * T-10 pide que todo método guarde inicio/fin, cantidad ejecutada, interrupciones o fallas con su
 * motivo, geometría y estado de sincronización. La geometría ya está en cada unidad (RN-30) y la
 * sincronización en el evento; aquí se resumen el resto con datos ya capturados, sin inventar
 * umbrales: una interrupción o falla **no bloquea ni genera incumplimiento** (T-10 no le da tipo
 * de control), solo queda registrada y descuenta su tiempo de la duración efectiva.
 *
 * El esfuerzo de un método en una estación es la **suma** de estas filas por usuario (RN-19).
 */

export const TIPOS_INTERRUPCION = ['interrupcion', 'falla'] as const;
export type TipoInterrupcion = (typeof TIPOS_INTERRUPCION)[number];

const hora = z.iso.datetime({ offset: true });

export const interrupcionSchema = z
  .object({
    id: z.uuid(),
    /** `interrupcion` (lluvia, acceso, seguridad…) o `falla` de equipo o método. */
    tipo: z.enum(TIPOS_INTERRUPCION),
    motivo: z.string().trim().min(1).max(500),
    inicio: hora,
    /** `null` si la ejecución se cerró sin reanudar. */
    fin: hora.nullable(),
    /** Unidad afectada, si la interrupción es de una sola (p. ej. una trampa que falló). */
    unidad_id: z.uuid().nullable(),
  })
  .refine((p) => p.fin === null || Date.parse(p.fin) >= Date.parse(p.inicio), {
    message: 'El fin de la interrupción no puede ser anterior a su inicio',
    path: ['fin'],
  });
export type Interrupcion = z.infer<typeof interrupcionSchema>;

export interface EsfuerzoEjecucion {
  readonly planificado: {
    readonly cantidad: number | null;
    readonly medida: Objetivo['medida'];
    readonly unidad_texto: string;
    readonly origen: Objetivo['origen'];
  };
  readonly ejecutado: {
    readonly cantidad: number;
    /** Primer inicio registrado (unidad o apertura). */
    readonly inicio: string;
    /** Último fin registrado (unidad o cierre); `null` si sigue en curso. */
    readonly fin: string | null;
    /** Minutos entre inicio y fin; `null` sin fin. */
    readonly duracion_min: number | null;
    /** Minutos con interrupciones o fallas, sin contar dos veces los solapes. */
    readonly interrumpido_min: number;
    /** Duración menos lo interrumpido; `null` sin fin. */
    readonly efectivo_min: number | null;
    readonly interrupciones: number;
    readonly fallas: number;
  };
  /** Ejecutado − planificado; `null` sin objetivo numérico. */
  readonly diferencia: number | null;
}

const minutos = (ms: number): number => Math.round(ms / 6000) / 10;

/** Une intervalos solapados y devuelve el total en ms, recortado a [desde, hasta]. */
const totalSinSolapes = (
  intervalos: readonly (readonly [number, number])[],
  desde: number,
  hasta: number,
): number => {
  const recortados = intervalos
    .map(([a, b]) => [Math.max(a, desde), Math.min(b, hasta)] as const)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let total = 0;
  let actual: [number, number] | null = null;
  for (const [a, b] of recortados) {
    if (actual === null || a > actual[1]) {
      if (actual !== null) total += actual[1] - actual[0];
      actual = [a, b];
    } else actual[1] = Math.max(actual[1], b);
  }
  if (actual !== null) total += actual[1] - actual[0];
  return total;
};

export const resumirEsfuerzo = (entrada: {
  readonly objetivo: Objetivo;
  /** Esfuerzo ejecutado en la medida del objetivo (`esfuerzoEjecutado`). */
  readonly ejecutado: number;
  readonly abierta_en: string;
  readonly cerrada_en: string | null;
  readonly unidades: readonly { readonly inicio: string | null; readonly fin: string | null }[];
  readonly interrupciones: readonly Interrupcion[];
}): EsfuerzoEjecucion => {
  const ms = (s: string | null): number | null => {
    if (s === null) return null;
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : null;
  };
  const inicios = [ms(entrada.abierta_en), ...entrada.unidades.map((u) => ms(u.inicio))].filter(
    (t): t is number => t !== null,
  );
  const fines = [ms(entrada.cerrada_en), ...entrada.unidades.map((u) => ms(u.fin))].filter(
    (t): t is number => t !== null,
  );
  const inicio = inicios.length === 0 ? Date.parse(entrada.abierta_en) : Math.min(...inicios);
  const fin = entrada.cerrada_en === null || fines.length === 0 ? null : Math.max(...fines);
  const corte = fin ?? Date.now();
  const interrumpido = totalSinSolapes(
    entrada.interrupciones.map((i) => [Date.parse(i.inicio), ms(i.fin) ?? corte] as const),
    inicio,
    corte,
  );
  const duracion = fin === null ? null : Math.max(fin - inicio, 0);
  const meta = entrada.objetivo.cantidad;
  return {
    planificado: {
      cantidad: meta,
      medida: entrada.objetivo.medida,
      unidad_texto: entrada.objetivo.unidad_texto,
      origen: entrada.objetivo.origen,
    },
    ejecutado: {
      cantidad: entrada.ejecutado,
      inicio: new Date(inicio).toISOString(),
      fin: fin === null ? null : new Date(fin).toISOString(),
      duracion_min: duracion === null ? null : minutos(duracion),
      interrumpido_min: minutos(interrumpido),
      efectivo_min: duracion === null ? null : minutos(Math.max(duracion - interrumpido, 0)),
      interrupciones: entrada.interrupciones.filter((i) => i.tipo === 'interrupcion').length,
      fallas: entrada.interrupciones.filter((i) => i.tipo === 'falla').length,
    },
    diferencia: meta === null ? null : Math.round((entrada.ejecutado - meta) * 10) / 10,
  };
};
