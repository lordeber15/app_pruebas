import {
  calcularAvance,
  esfuerzoEjecutado,
  interrupcionSchema,
  REGIONES,
  resolverObjetivo,
  resumirEsfuerzo,
  type Avance,
  type ConfiguracionMetodo,
  type EsfuerzoEjecucion,
  type Interrupcion,
  type Objetivo,
  type Region,
} from '@campo/core';
import { z } from 'zod';

/**
 * Avance elemental de un método en una estación (RN-19, RN-38) a partir de las ejecuciones
 * recibidas, con las funciones de core. Lo comparten el dashboard de seguimiento y el avance por
 * estación: una sola forma de sumar el esfuerzo de todos los usuarios.
 */

export const comoRegion = (r: string | null): Region | null =>
  REGIONES.find((x) => x === r) ?? null;

export const SIN_CONFIGURACION: Objetivo = {
  cantidad: null,
  medida: 'unidades',
  unidad_texto: 'unidades',
  origen: 'ninguno',
  texto: 'La configuración D01 de este método no está disponible.',
};

export interface EjecucionParaAvance {
  readonly datos: unknown;
  readonly objetivo_campo: number | null;
  readonly unidades_cerradas: number;
}

export interface AvanceMetodo {
  readonly objetivo: Objetivo;
  readonly avance: Avance;
}

/** `ejecuciones` en orden de apertura: el objetivo de campo es el de la última que lo fijó. */
export const avanceDeMetodo = (
  config: ConfiguracionMetodo | null,
  estacion: {
    readonly region: string | null;
    readonly za_ef: string | null;
    readonly uv: string | null;
  },
  ejecuciones: readonly EjecucionParaAvance[],
): AvanceMetodo => {
  const objetivoCampo =
    ejecuciones.findLast((x) => x.objetivo_campo !== null)?.objetivo_campo ?? null;
  const objetivo =
    config === null
      ? SIN_CONFIGURACION
      : resolverObjetivo(
          config,
          { region: comoRegion(estacion.region), za_ef: estacion.za_ef, uv: estacion.uv },
          objetivoCampo,
        );
  const ejecutado =
    config === null
      ? ejecuciones.reduce((s, x) => s + x.unidades_cerradas, 0)
      : ejecuciones.reduce(
          (s, x) =>
            s +
            esfuerzoEjecutado(config, objetivo, {
              datos: (x.datos ?? {}) as Record<string, unknown>,
              unidades_cerradas: x.unidades_cerradas,
            }),
          0,
        );
  return { objetivo, avance: calcularAvance(ejecutado, objetivo) };
};

/** Interrupciones guardadas en `ejecucion.esfuerzo_ejecutado` (T-10); lo inválido se ignora. */
export const interrupcionesDe = (esfuerzo: unknown): Interrupcion[] => {
  const r = z
    .object({ interrupciones: z.array(interrupcionSchema) })
    .safeParse(esfuerzo ?? { interrupciones: [] });
  return r.success ? r.data.interrupciones : [];
};

const iso = (d: Date | string | null): string | null =>
  d === null ? null : d instanceof Date ? d.toISOString() : new Date(d).toISOString();

/**
 * Esfuerzo planificado vs. ejecutado de **una** ejecución (RF-T05, T-10). El planificado es el
 * objetivo aplicable del método en la estación (con el valor de campo de esa ejecución, si lo
 * fijó); el ejecutado, el de core con las unidades e interrupciones recibidas.
 */
export const esfuerzoDeEjecucion = (
  config: ConfiguracionMetodo | null,
  estacion: {
    readonly region: string | null;
    readonly za_ef: string | null;
    readonly uv: string | null;
  },
  x: {
    readonly datos: unknown;
    readonly objetivo_campo: number | null;
    readonly abierta_en: Date | string;
    readonly cerrada_en: Date | string | null;
    readonly esfuerzo_ejecutado: unknown;
  },
  unidades: {
    /** Unidades cerradas (la cantidad ejecutada cuando el objetivo se mide en unidades). */
    readonly cerradas: number;
    /** Inicio y fin de las unidades: basta el primero y el último. */
    readonly rangos: readonly {
      readonly inicio: Date | string | null;
      readonly fin: Date | string | null;
    }[];
  },
): EsfuerzoEjecucion => {
  const { objetivo, avance } = avanceDeMetodo(config, estacion, [
    {
      datos: x.datos,
      objetivo_campo: x.objetivo_campo,
      unidades_cerradas: unidades.cerradas,
    },
  ]);
  return resumirEsfuerzo({
    objetivo,
    ejecutado: avance.ejecutado,
    abierta_en: iso(x.abierta_en) ?? new Date().toISOString(),
    cerrada_en: iso(x.cerrada_en),
    unidades: unidades.rangos.map((u) => ({ inicio: iso(u.inicio), fin: iso(u.fin) })),
    interrupciones: interrupcionesDe(x.esfuerzo_ejecutado),
  });
};
