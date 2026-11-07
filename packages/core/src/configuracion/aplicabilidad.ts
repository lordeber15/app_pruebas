import type { ClaseAplicabilidad, CondicionAplicabilidad, Region } from './metodo.ts';

/**
 * Aplicabilidad estación–método (RN-28, D01 hoja 00, D02 §4, E-01). Lógica provisional
 * mientras no exista la matriz nominal (P-01):
 *
 * - TODAS: habilitado en toda estación de la especialidad; **nunca se oculta**.
 * - CONDICIONAL: solo si la condición explícita se cumple con los atributos de la estación.
 *   Si D01 no da un criterio derivable (`manual`), queda **pendiente** y deshabilitado hasta
 *   que la web lo confirme nominalmente.
 * - EVENTO: siempre disponible como registro complementario, sin asignación previa.
 * - ATRIBUTO: nunca aparece como método independiente.
 * - TRANSVERSAL (ABS): habilitado en toda estación de fauna, por grupo evaluado.
 *
 * Una decisión nominal (`nominal`) prevalece sobre la condición, pero jamás oculta un TODAS.
 */

export interface EstacionAplicabilidad {
  /** Región de la brigada regular que la visita (A01); `null` si no se conoce. */
  readonly region: Region | null;
  readonly uv: string | null;
  readonly za_ef: string | null;
}

export interface MetodoAplicabilidad {
  readonly clase: ClaseAplicabilidad;
  readonly condicion: CondicionAplicabilidad | null;
}

export type ResultadoCondicion = 'cumple' | 'no_cumple' | 'pendiente';

export interface Aplicabilidad {
  readonly habilitado: boolean;
  /** De dónde sale la decisión. */
  readonly origen: 'clase' | 'condicion' | 'nominal';
  /** La condición no pudo evaluarse con los atributos disponibles (P-01). */
  readonly condicion_pendiente: boolean;
  /** Cómo se presenta en la app. */
  readonly presentacion: 'metodo' | 'evento' | 'oculto';
}

const normalizar = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const contiene = (valor: string | null, fragmentos: readonly string[]): boolean =>
  valor !== null && fragmentos.some((f) => normalizar(valor).includes(normalizar(f)));

export const evaluarCondicion = (
  condicion: CondicionAplicabilidad,
  estacion: EstacionAplicabilidad,
): ResultadoCondicion => {
  switch (condicion.tipo) {
    case 'region':
      if (estacion.region === null) return 'pendiente';
      return condicion.regiones.includes(estacion.region) ? 'cumple' : 'no_cumple';
    case 'region_excepto_uv':
      if (estacion.region === null) return 'pendiente';
      if (!condicion.regiones.includes(estacion.region)) return 'no_cumple';
      return contiene(estacion.uv, condicion.uv_excluida_contiene) ? 'no_cumple' : 'cumple';
    case 'uv_contiene':
      if (estacion.uv === null) return 'pendiente';
      return contiene(estacion.uv, condicion.fragmentos) ? 'cumple' : 'no_cumple';
    case 'za_ef':
      return estacion.za_ef !== null ? 'cumple' : 'no_cumple';
    case 'za_ef_o_manual':
      return estacion.za_ef !== null ? 'cumple' : 'pendiente';
    case 'manual':
      return 'pendiente';
  }
};

export const resolverAplicabilidad = (
  metodo: MetodoAplicabilidad,
  especialidadEsFauna: boolean,
  estacion: EstacionAplicabilidad,
  nominal: { readonly habilitado: boolean } | null = null,
): Aplicabilidad => {
  switch (metodo.clase) {
    case 'todas':
      // Regla crítica (D02 §4): no ocultar TODAS, ni siquiera por decisión nominal.
      return {
        habilitado: true,
        origen: 'clase',
        condicion_pendiente: false,
        presentacion: 'metodo',
      };
    case 'evento':
      return {
        habilitado: true,
        origen: 'clase',
        condicion_pendiente: false,
        presentacion: 'evento',
      };
    case 'atributo':
      return {
        habilitado: false,
        origen: 'clase',
        condicion_pendiente: false,
        presentacion: 'oculto',
      };
    case 'transversal':
      return {
        habilitado: especialidadEsFauna,
        origen: 'clase',
        condicion_pendiente: false,
        presentacion: especialidadEsFauna ? 'metodo' : 'oculto',
      };
    case 'condicional': {
      if (nominal !== null) {
        return {
          habilitado: nominal.habilitado,
          origen: 'nominal',
          condicion_pendiente: false,
          presentacion: nominal.habilitado ? 'metodo' : 'oculto',
        };
      }
      const r =
        metodo.condicion === null ? 'pendiente' : evaluarCondicion(metodo.condicion, estacion);
      return {
        habilitado: r === 'cumple',
        origen: 'condicion',
        condicion_pendiente: r === 'pendiente',
        presentacion: r === 'cumple' ? 'metodo' : 'oculto',
      };
    }
  }
};
