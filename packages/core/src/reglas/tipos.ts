import type {
  ConfiguracionMetodo,
  Region,
  TipoControl,
  TipoUnidad,
  TipoValidacion,
} from '../configuracion/metodo.ts';
import type { EstadoUnidad, Orientacion, TipoDesviacion, TipoFoto } from '../estados.ts';

/**
 * Entrada y salida del motor de reglas (RF-T04, RN-31). Son datos puros: la app los arma desde
 * SQLite y el worker desde PostgreSQL; ninguno reimplementa la evaluación.
 */

export interface Coordenada {
  readonly lat: number;
  readonly lon: number;
}

/** Geometría capturada por la app para una unidad, según lo que D01 pide al método (RN-30). */
export type GeometriaCapturada =
  | { readonly tipo: 'punto'; readonly punto: Coordenada }
  | { readonly tipo: 'inicio_fin'; readonly inicio: Coordenada; readonly fin: Coordenada }
  | { readonly tipo: 'vertices'; readonly vertices: readonly Coordenada[] }
  | {
      readonly tipo: 'parcela_forestal';
      readonly principal: readonly Coordenada[];
      readonly subparcelas: readonly {
        readonly tipo: string;
        readonly vertices: readonly Coordenada[];
      }[];
    };

export interface FotoEvaluable {
  readonly tipo: TipoFoto;
  readonly orientacion: Orientacion | null;
  /** Foto de otra unidad reutilizada por vínculo (F-07); cuenta solo si el método lo permite. */
  readonly heredada: boolean;
}

export interface UnidadEvaluable {
  readonly id: string;
  /** Código visible (p. ej. `T-03`), para los mensajes. */
  readonly codigo: string;
  readonly tipo: TipoUnidad;
  readonly estado: EstadoUnidad;
  readonly geometria: GeometriaCapturada | null;
  /** ISO 8601 con zona; la app los fija al abrir y cerrar la unidad. */
  readonly inicio: string | null;
  readonly fin: string | null;
  /** Valores de `metodo.campos` por clave. */
  readonly datos: Readonly<Record<string, unknown>>;
  /** Filas de `metodo.registros` (una por especie, lectura, individuo…). */
  readonly registros: readonly Readonly<Record<string, unknown>>[];
  readonly fotos: readonly FotoEvaluable[];
  /** Track del recorrido de esta unidad, si D01 lo exige (RN-24). */
  readonly track: { readonly puntos: number } | null;
  /** Unidad de otro método cuya geometría o contexto se reutiliza (RN-34). */
  readonly unidad_vinculada_id: string | null;
  /** Parámetros técnicos que el especialista confirmó (detector acústico, T-12). */
  readonly parametros_confirmados: readonly string[];
}

export interface EjecucionEvaluable {
  readonly abierta_en: string;
  readonly cerrada_en: string | null;
  /** Valores de `metodo.campos_ejecucion` por clave. */
  readonly datos: Readonly<Record<string, unknown>>;
  readonly desviacion: { readonly tipo: TipoDesviacion; readonly explicacion: string | null };
  /** Condiciones confirmadas explícitamente por el usuario (p. ej. `za_ef_cantidad_exacta`). */
  readonly confirmaciones: readonly string[];
  /** Objetivo final definido en campo cuando D01 lo deja al especialista (bofedales, RN-38). */
  readonly objetivo_campo: number | null;
  /** Fotos de la ejecución no asociadas a una unidad (metodológicas de la estación/método). */
  readonly fotos: readonly FotoEvaluable[];
  readonly unidades: readonly UnidadEvaluable[];
}

export interface EstacionEvaluacion {
  readonly region: Region | null;
  /** Atributo ZA/EF de A01; no nulo significa que la estación es ZA/EF (RN-32). */
  readonly za_ef: string | null;
  readonly uv: string | null;
}

export interface ContextoEvaluacion {
  readonly metodo: ConfiguracionMetodo;
  readonly estacion: EstacionEvaluacion;
  readonly ejecucion: EjecucionEvaluable;
  /** Zona horaria IANA para los horarios de D01 (RN-41); por defecto `America/Lima`. */
  readonly zona_horaria?: string;
  /** Unidades de otros métodos en la misma estación, para verificar vínculos (RN-34). */
  readonly unidades_vinculables?: readonly { readonly id: string; readonly metodo: string }[];
}

/**
 * - `cumple` / `incumple`: la regla se evaluó.
 * - `no_aplica`: la condición de la regla no se da (p. ej. confirmación ZA/EF fuera de ZA/EF).
 * - `no_evaluable`: faltan datos para evaluarla; nunca cuenta como incumplimiento.
 * - `informativo`: referencia, mensaje o criterio humano; se muestra y no se controla.
 */
export type EstadoRegla = 'cumple' | 'incumple' | 'no_aplica' | 'no_evaluable' | 'informativo';

export type ReglaEvaluada = TipoValidacion | 'desviacion';

export interface ResultadoRegla {
  readonly regla: ReglaEvaluada;
  readonly tipo_control: TipoControl;
  readonly estado: EstadoRegla;
  /** Texto para la interfaz, en español. */
  readonly mensaje: string;
  /** Texto fuente de D01 (trazabilidad). */
  readonly texto_d01: string;
  /** Unidad a la que se refiere el resultado; `null` si es de toda la ejecución. */
  readonly unidad_id: string | null;
  readonly esperado: number | string | null;
  readonly obtenido: number | string | null;
}

export type OrigenObjetivo =
  | 'd01'
  | 'd01_region'
  | 'd01_za_ef'
  | 'd01_za_ef_region'
  /** Valor final definido por el especialista en campo (bofedales, RN-38). */
  | 'campo'
  /** D01 solo da una referencia y el especialista aún no fijó el valor final. */
  | 'referencia'
  | 'ninguno';

export interface Objetivo {
  readonly cantidad: number | null;
  /** Qué se cuenta: `unidades` o `minutos`. */
  readonly medida: 'unidades' | 'minutos';
  readonly unidad_texto: string;
  readonly origen: OrigenObjetivo;
  readonly texto: string;
}

export interface Avance {
  readonly ejecutado: number;
  readonly objetivo: number | null;
  /** 0–100 sin tope superior; `null` sin objetivo. */
  readonly porcentaje: number | null;
}

export interface EvaluacionEjecucion {
  readonly resultados: readonly ResultadoRegla[];
  /** Entrada de `evaluar_qa` en la máquina de la ejecución: > 0 ⇒ `parcial`. */
  readonly incumplimientos_obligatorios: number;
  readonly advertencias: number;
  readonly objetivo: Objetivo;
  readonly avance: Avance;
  readonly unidades_cerradas: number;
}
