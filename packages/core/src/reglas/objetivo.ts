import type { ConfiguracionMetodo } from '../configuracion/metodo.ts';
import { avanceEsfuerzo } from '../esfuerzo.ts';
import type { Avance, EstacionEvaluacion, Objetivo } from './tipos.ts';

/**
 * Objetivo aplicable de un método en una estación (RN-32, RN-38, E-03):
 *
 * - Si D01 fija una cantidad de unidades, se usa la estándar o la de ZA/EF **solo cuando D01
 *   distingue ZA/EF para el método**; si además distingue por región (VES), prevalece la región.
 * - Si D01 solo da una referencia (bofedales), el objetivo es el **valor final definido en
 *   campo** por el especialista; mientras no exista, no hay objetivo numérico.
 * - Si D01 mide el esfuerzo en tiempo (ABS), el objetivo son los minutos.
 *
 * Nunca se inventa una cantidad: sin regla en D01, `cantidad` es `null`.
 */
export const esZaEf = (estacion: Pick<EstacionEvaluacion, 'za_ef'>): boolean =>
  estacion.za_ef !== null;

export const resolverObjetivo = (
  metodo: ConfiguracionMetodo,
  estacion: EstacionEvaluacion,
  objetivoCampo: number | null = null,
): Objetivo => {
  const unidadTexto = metodo.esfuerzo.estandar?.unidad ?? metodo.unidad.tipo;
  const cantidad = metodo.validaciones.find((v) => v.tipo === 'cantidad_unidades');
  if (cantidad !== undefined) {
    const zaEf = esZaEf(estacion) && cantidad.minimo_za_ef !== null;
    const region = estacion.region;
    if (zaEf) {
      const porRegion = region === null ? undefined : cantidad.za_ef_por_region?.[region];
      return porRegion !== undefined
        ? objetivo(porRegion, unidadTexto, 'd01_za_ef_region', metodo.esfuerzo.za_ef?.texto)
        : objetivo(
            cantidad.minimo_za_ef ?? cantidad.minimo,
            unidadTexto,
            'd01_za_ef',
            metodo.esfuerzo.za_ef?.texto,
          );
    }
    const porRegion = region === null ? undefined : cantidad.por_region?.[region];
    return porRegion !== undefined
      ? objetivo(porRegion, unidadTexto, 'd01_region', metodo.esfuerzo.estandar?.texto)
      : objetivo(cantidad.minimo, unidadTexto, 'd01', metodo.esfuerzo.estandar?.texto);
  }

  const referencia = metodo.validaciones.find((v) => v.tipo === 'referencia_esfuerzo');
  if (referencia !== undefined) {
    return objetivoCampo !== null && Number.isFinite(objetivoCampo) && objetivoCampo > 0
      ? objetivo(objetivoCampo, unidadTexto, 'campo', referencia.texto)
      : {
          cantidad: null,
          medida: 'unidades',
          unidad_texto: unidadTexto,
          origen: 'referencia',
          texto: referencia.texto,
        };
  }

  const tiempo = metodo.validaciones.find((v) => v.tipo === 'tiempo_efectivo');
  if (tiempo !== undefined) {
    return {
      cantidad: tiempo.minutos,
      medida: 'minutos',
      unidad_texto: 'minutos de búsqueda',
      origen: 'd01',
      texto: tiempo.texto,
    };
  }

  return {
    cantidad: null,
    medida: 'unidades',
    unidad_texto: unidadTexto,
    origen: 'ninguno',
    texto: metodo.esfuerzo.estandar?.texto ?? 'D01 no define un esfuerzo para este método.',
  };
};

const objetivo = (
  cantidad: number,
  unidadTexto: string,
  origen: Objetivo['origen'],
  texto: string | undefined,
): Objetivo => ({
  cantidad,
  medida: 'unidades',
  unidad_texto: unidadTexto,
  origen,
  texto: texto ?? `${String(cantidad)} ${unidadTexto}`,
});

/** Avance elemental = ejecutado / objetivo aplicable (RN-38). Sin objetivo no hay porcentaje. */
export const calcularAvance = (ejecutado: number, objetivo: Objetivo): Avance => {
  const a = avanceEsfuerzo(ejecutado, objetivo.cantidad);
  return { ejecutado: a.total, objetivo: a.meta, porcentaje: a.porcentaje };
};
