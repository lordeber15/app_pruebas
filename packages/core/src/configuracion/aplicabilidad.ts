import { z } from 'zod';
import type { ClaseAplicabilidad, CondicionAplicabilidad, Region } from './metodo.ts';

/**
 * Aplicabilidad estación–método (RN-28, D01 hoja 00, D02 §4, E-01). Lógica provisional
 * mientras no exista la matriz nominal (P-01):
 *
 * - TODAS: habilitado en toda estación de la especialidad; **nunca se oculta**.
 * - CONDICIONAL: solo si la condición explícita se cumple con los atributos de la estación.
 *   Si D01 no da un criterio derivable (`manual`), queda **pendiente** y deshabilitado hasta
 *   que la web lo confirme nominalmente.
 * - EVENTO: siempre disponible como registro complementario, sin reserva previa.
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

// ── Decisión nominal desde la web (P-01, decisión del usuario 2026-11-08) ─────────────────────

/** Lo que Coordinación o el JdP deciden sobre un método en una estación. */
export const DECISIONES_ESTACION_METODO = ['confirmar', 'descartar'] as const;
export type DecisionEstacionMetodo = (typeof DECISIONES_ESTACION_METODO)[number];

/** Cuerpo de la decisión (mismo esquema en la web y en la API). El motivo es obligatorio. */
export const decisionEstacionMetodoSchema = z.object({
  decision: z.enum(DECISIONES_ESTACION_METODO),
  motivo: z
    .string()
    .trim()
    .min(3, 'Explique el motivo (al menos 3 caracteres).')
    .max(500, 'El motivo admite hasta 500 caracteres.'),
});
export type DecisionEstacionMetodoDatos = z.infer<typeof decisionEstacionMetodoSchema>;

/**
 * Estado visible de un método en la matriz estación–método:
 *
 * - `aplicable`: se ejecuta en la estación (TODAS, ABS de fauna, condicional que cumple o
 *   confirmado nominalmente).
 * - `condicion_pendiente`: CONDICIONAL que D01 no permite derivar con los atributos (P-01).
 * - `no_aplica`: CONDICIONAL cuya condición de D01 no se cumple (o ABS fuera de fauna).
 * - `descartado`: CONDICIONAL descartado nominalmente desde la web.
 * - `evento`: EVENTO, siempre disponible como registro complementario, sin reserva.
 * - `atributo`: ATRIBUTO, nunca es un método independiente.
 */
export const ESTADOS_MATRIZ = [
  'aplicable',
  'condicion_pendiente',
  'no_aplica',
  'descartado',
  'evento',
  'atributo',
] as const;
export type EstadoMatriz = (typeof ESTADOS_MATRIZ)[number];

export const estadoEnMatriz = (
  clase: ClaseAplicabilidad,
  fila: Pick<Aplicabilidad, 'habilitado' | 'origen' | 'condicion_pendiente'> | null,
): EstadoMatriz => {
  if (clase === 'evento') return 'evento';
  if (clase === 'atributo') return 'atributo';
  if (fila === null) return clase === 'condicional' ? 'condicion_pendiente' : 'no_aplica';
  if (fila.habilitado) return 'aplicable';
  if (fila.condicion_pendiente) return 'condicion_pendiente';
  return clase === 'condicional' && fila.origen === 'nominal' ? 'descartado' : 'no_aplica';
};

export type RechazoDecision = 'METODO_OBLIGATORIO' | 'DECISION_NO_APLICA';

/**
 * ¿Se puede decidir nominalmente sobre este método? Solo los CONDICIONAL (RN-28): un TODAS o un
 * ABS nunca se ocultan ni requieren confirmación (`METODO_OBLIGATORIO`); un EVENTO siempre está
 * disponible y un ATRIBUTO no es método (`DECISION_NO_APLICA`).
 */
export const rechazoDeDecision = (clase: ClaseAplicabilidad): RechazoDecision | null => {
  switch (clase) {
    case 'todas':
    case 'transversal':
      return 'METODO_OBLIGATORIO';
    case 'evento':
    case 'atributo':
      return 'DECISION_NO_APLICA';
    case 'condicional':
      return null;
  }
};
