import {
  avanceEstacion,
  calcularAvance,
  metodoCompleto,
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
  id: string;
  estacion_id: string;
  metodo_id: string;
  estado_local: 'en_curso' | 'cerrada';
  abierta_en: string;
  datos: string;
  objetivo_campo: number | null;
  incumplimientos: number | null;
}

/** Avance elemental de un método aplicable en la estación (para la barra por método). */
export interface AvanceMetodoLocal extends MetodoEnEstacion {
  readonly metodoId: string;
  readonly completo: boolean;
  readonly unidadTexto: string;
}

export interface AvanceEstacionLocal extends AvanceEstacion {
  /** Primera fecha del cronograma vigente para la estación (YYYY-MM-DD), si la hay. */
  readonly fechaProgramada: string | null;
  /** Todas las fechas del cronograma vigente para la estación, ordenadas. */
  readonly fechas: readonly string[];
  /** Un elemento por método aplicable, en el orden del paquete. */
  readonly metodos: readonly AvanceMetodoLocal[];
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
    `SELECT e.id, e.estacion_id, e.metodo_id, e.estado_local, e.abierta_en, e.datos,
            e.objetivo_campo, e.incumplimientos
       FROM ejecucion_local e ${estacionId === undefined ? '' : 'WHERE e.estacion_id = ?'}
      ORDER BY e.abierta_en`,
    estacionId === undefined ? [] : [estacionId],
  );

/**
 * Unidades cerradas por ejecución y tipo: el esfuerzo cuenta solo las del tipo principal del
 * método, igual que el motor de core (`evaluarEjecucion`).
 */
type Cerradas = ReadonlyMap<string, number>;
const unidadesCerradas = async (estacionId?: string): Promise<Cerradas> => {
  const filas = await consultar<{ ejecucion_id: string; tipo_unidad: string; n: number }>(
    `SELECT u.ejecucion_id, u.tipo_unidad, count(*) AS n
       FROM unidad_local u JOIN ejecucion_local e ON e.id = u.ejecucion_id
      WHERE u.estado = 'cerrada' ${estacionId === undefined ? '' : 'AND e.estacion_id = ?'}
      GROUP BY u.ejecucion_id, u.tipo_unidad`,
    estacionId === undefined ? [] : [estacionId],
  );
  return new Map(filas.map((f) => [`${f.ejecucion_id}:${f.tipo_unidad}`, f.n]));
};

const calcular = (
  p: Paquete,
  estacionId: string,
  ejecuciones: readonly FilaEjecucion[],
  cerradas: Cerradas,
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
  const metodos: AvanceMetodoLocal[] = p.metodos
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
            unidades_cerradas: cerradas.get(`${x.id}:${m.config.unidad.tipo}`) ?? 0,
          }),
        0,
      );
      const base: MetodoEnEstacion = {
        metodo: m.config.codigo,
        avance: calcularAvance(ejecutado, objetivo),
        ejecuciones: propias.map(estadoParaAvance),
      };
      return {
        ...base,
        metodoId: m.id,
        completo: metodoCompleto(base),
        unidadTexto: objetivo.unidad_texto,
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
  return { ...avance, fechaProgramada, fechas, metodos };
};

/** Avance local de una estación; `null` si la estación no está en el paquete. */
export const avanceDeEstacionLocal = async (
  paquete: Paquete,
  estacionId: string,
): Promise<AvanceEstacionLocal | null> =>
  calcular(
    paquete,
    estacionId,
    await ejecucionesLocales(estacionId),
    await unidadesCerradas(estacionId),
    fechaLocal(),
  );

/** Avance local de todas las estaciones del paquete con una sola consulta (para el mapa). */
export const avancesDeEstacionesLocales = async (
  paquete: Paquete,
): Promise<Map<string, AvanceEstacionLocal>> => {
  const todas = await ejecucionesLocales();
  const cerradas = await unidadesCerradas();
  const hoy = fechaLocal();
  const r = new Map<string, AvanceEstacionLocal>();
  for (const est of paquete.estaciones) {
    const a = calcular(
      paquete,
      est.id,
      todas.filter((x) => x.estacion_id === est.id),
      cerradas,
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
