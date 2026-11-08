import {
  calcularAvance,
  esfuerzoEjecutado,
  REGIONES,
  resolverObjetivo,
  type Avance,
  type ConfiguracionMetodo,
  type Objetivo,
  type Region,
} from '@campo/core';

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
