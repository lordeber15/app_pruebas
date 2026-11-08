import {
  avanceEstacion,
  calcularAvance,
  esfuerzoEjecutado,
  resolverObjetivo,
  type AvanceEstacion,
  type EstadoEjecucionAvance,
  type MetodoEnEstacion,
} from '@campo/core';
import { consultar } from './bd.ts';
import { estacionParaReglas, fechaLocal, type Paquete } from './campo.ts';

/**
 * Avance de una estación con lo que hay en **este celular** (decisión del usuario, 2026-11-08):
 * métodos completos / métodos aplicables, con el cálculo de core (`avanceEstacion`, RN-38). Los
 * aplicables son los métodos habilitados para la estación en el paquete (sin EVENTOS ni
 * ATRIBUTOS, RN-28). Las ejecuciones de otros celulares de la brigada no se ven aquí: el
 * resultado es el avance local, no el de la brigada (RN-37).
 */

interface FilaEjecucion {
  estacion_id: string;
  metodo_id: string;
  estado_local: 'en_curso' | 'cerrada';
  abierta_en: string;
  datos: string;
  objetivo_campo: number | null;
  incumplimientos: number | null;
  unidades_cerradas: number;
}

export interface AvanceEstacionLocal extends AvanceEstacion {
  /** Primera fecha del cronograma vigente para la estación (YYYY-MM-DD), si la hay. */
  readonly fechaProgramada: string | null;
  /** Todas las fechas del cronograma vigente para la estación, ordenadas. */
  readonly fechas: readonly string[];
}

/**
 * Estado local de una ejecución en los términos de core. Una ejecución cerrada en el celular
 * todavía no pasó la QA del servidor (RN-05): se toma como completa si el motor local no halló
 * incumplimientos obligatorios, y como parcial si los halló (E-06).
 */
const estadoParaAvance = (f: FilaEjecucion): EstadoEjecucionAvance =>
  f.estado_local === 'en_curso'
    ? 'en_curso'
    : (f.incumplimientos ?? 0) > 0
      ? 'parcial'
      : 'completa';

const leerDatos = (s: string): Record<string, unknown> => {
  try {
    const v: unknown = JSON.parse(s);
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const ejecucionesLocales = (estacionId?: string) =>
  consultar<FilaEjecucion>(
    `SELECT e.estacion_id, e.metodo_id, e.estado_local, e.abierta_en, e.datos, e.objetivo_campo,
            e.incumplimientos,
            (SELECT count(*) FROM unidad_local u WHERE u.ejecucion_id = e.id AND u.estado = 'cerrada')
              AS unidades_cerradas
       FROM ejecucion_local e ${estacionId === undefined ? '' : 'WHERE e.estacion_id = ?'}
      ORDER BY e.abierta_en`,
    estacionId === undefined ? [] : [estacionId],
  );

const calcular = (
  p: Paquete,
  estacionId: string,
  ejecuciones: readonly FilaEjecucion[],
  hoy: string,
): AvanceEstacionLocal | null => {
  const estacion = p.estaciones.find((e) => e.id === estacionId);
  if (estacion === undefined) return null;
  const reglas = estacionParaReglas(estacion);
  const habilitados = new Set(
    p.aplicabilidad
      .filter((a) => a.estacion_id === estacionId && a.habilitado)
      .map((a) => a.metodo_id),
  );
  const metodos: MetodoEnEstacion[] = p.metodos
    .filter((m) => habilitados.has(m.id) && m.clase !== 'evento' && m.clase !== 'atributo')
    .map((m) => {
      const propias = ejecuciones.filter((x) => x.metodo_id === m.id);
      // Objetivo de campo = el de la última ejecución que lo fijó (RN-38).
      const objetivoCampo =
        [...propias].reverse().find((x) => x.objetivo_campo !== null)?.objetivo_campo ?? null;
      const objetivo = resolverObjetivo(m.config, reglas, objetivoCampo);
      // Esfuerzo del método = suma de las ejecuciones (RN-19).
      const ejecutado = propias.reduce(
        (s, x) =>
          s +
          esfuerzoEjecutado(m.config, objetivo, {
            datos: leerDatos(x.datos),
            unidades_cerradas: x.unidades_cerradas,
          }),
        0,
      );
      return {
        metodo: m.config.codigo,
        avance: calcularAvance(ejecutado, objetivo),
        ejecuciones: propias.map(estadoParaAvance),
      };
    });

  const filas = p.cronograma.filter((i) => i.estacion_id === estacionId);
  const fechas = [...new Set(filas.map((i) => i.fecha))].sort();
  const fechaProgramada = fechas[0] ?? null;
  const avance = avanceEstacion(metodos, {
    fechaProgramada,
    hoy,
    reprogramada: filas.some((i) => i.estado_fila === 'reprogramada'),
  });
  return { ...avance, fechaProgramada, fechas };
};

/** Avance local de una estación; `null` si la estación no está en el paquete. */
export const avanceDeEstacionLocal = async (
  paquete: Paquete,
  estacionId: string,
): Promise<AvanceEstacionLocal | null> =>
  calcular(paquete, estacionId, await ejecucionesLocales(estacionId), fechaLocal());

/** Avance local de todas las estaciones del paquete con una sola consulta (para el mapa). */
export const avancesDeEstacionesLocales = async (
  paquete: Paquete,
): Promise<Map<string, AvanceEstacionLocal>> => {
  const todas = await ejecucionesLocales();
  const hoy = fechaLocal();
  const r = new Map<string, AvanceEstacionLocal>();
  for (const est of paquete.estaciones) {
    const a = calcular(
      paquete,
      est.id,
      todas.filter((x) => x.estacion_id === est.id),
      hoy,
    );
    if (a !== null) r.set(est.id, a);
  }
  return r;
};

/** «4 de 7 métodos completos · 57 %»; sin datos no se afirma un porcentaje (RN-37). */
export const textoAvance = (a: AvanceEstacion): string => {
  const base = `${String(a.completos)} de ${String(a.aplicables)} ${
    a.aplicables === 1 ? 'método completo' : 'métodos completos'
  }`;
  return a.porcentaje === null
    ? base
    : `${base} · ${a.porcentaje.toLocaleString('es-PE', { maximumFractionDigits: 0 })} %`;
};
