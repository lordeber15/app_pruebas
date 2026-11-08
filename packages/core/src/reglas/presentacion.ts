import type { ConfiguracionMetodo, TipoControl } from '../configuracion/metodo.ts';
import { describirVentanas } from './horario.ts';
import { esZaEf, resolverObjetivo } from './objetivo.ts';
import type { EstacionEvaluacion, Objetivo, ReglaEvaluada } from './tipos.ts';

/**
 * Lo que la app muestra al iniciar un método (RF-M04, D02 §6 «Inicio de método», CA-20):
 * objetivo o referencia de esfuerzo, regla ZA/EF, horario y duración, geometría, track, fotos,
 * campos y el tipo de control de cada regla. Todo sale de la configuración D01; nada se redacta
 * aquí salvo las etiquetas.
 */
export interface ReglaPresentada {
  readonly clave: string;
  readonly etiqueta: string;
  readonly valor: string;
  /** `null` cuando no es una regla controlable (p. ej. la lista de campos). */
  readonly tipo_control: TipoControl | null;
  readonly texto_d01: string;
}

export const ETIQUETAS_TIPO_CONTROL: Readonly<Record<TipoControl, string>> = {
  obligatorio: 'Obligatorio',
  advertencia: 'Advertencia (no bloquea)',
  informativo: 'Informativo',
  referencia: 'Referencia metodológica',
  criterio_humano: 'Criterio de campo',
};

/** Nombre visible de cada regla evaluada (resultados de QA en la web y títulos de alertas). */
export const ETIQUETAS_REGLA: Readonly<Record<ReglaEvaluada, string>> = {
  cantidad_unidades: 'Cantidad de unidades',
  cantidad_registros: 'Cantidad de registros',
  referencia_esfuerzo: 'Referencia de esfuerzo',
  separacion_minima_m: 'Separación mínima entre unidades',
  duracion_unidad_min: 'Duración mínima por unidad',
  horario: 'Horario',
  geometria: 'Georreferenciación',
  track: 'Track del recorrido',
  fotos_contexto: 'Fotos de contexto',
  fotos_metodologicas: 'Fotos metodológicas',
  campos_obligatorios: 'Campos obligatorios',
  confirmacion: 'Confirmación requerida',
  mensaje: 'Mensaje del método',
  tiempo_efectivo: 'Tiempo efectivo de búsqueda',
  parametros_tecnicos: 'Parámetros técnicos',
  vinculo_unidad: 'Vínculo con otra unidad',
  desviacion: 'Desviación declarada',
};

const textoObjetivo = (o: Objetivo): string => {
  switch (o.origen) {
    case 'referencia':
      return 'Referencia metodológica: usted define el número final de unidades';
    case 'campo':
      return `${String(o.cantidad)} ${o.unidad_texto} (valor definido en campo)`;
    case 'ninguno':
      return 'Sin esfuerzo definido en D01';
    case 'd01':
    case 'd01_region':
    case 'd01_za_ef':
    case 'd01_za_ef_region':
      return `${String(o.cantidad)} ${o.unidad_texto}${o.origen.startsWith('d01_za_ef') ? ' (estación ZA/EF)' : ''}`;
  }
};

export const describirMetodo = (
  metodo: ConfiguracionMetodo,
  estacion: EstacionEvaluacion,
  objetivoCampo: number | null = null,
): readonly ReglaPresentada[] => {
  const v = metodo.validaciones;
  const buscar = <T extends ConfiguracionMetodo['validaciones'][number]['tipo']>(
    tipo: T,
  ): Extract<ConfiguracionMetodo['validaciones'][number], { tipo: T }> | undefined =>
    v.find((x): x is Extract<typeof x, { tipo: T }> => x.tipo === tipo);

  const objetivo = resolverObjetivo(metodo, estacion, objetivoCampo);
  const reglas: ReglaPresentada[] = [];

  const cantidad = buscar('cantidad_unidades');
  const referencia = buscar('referencia_esfuerzo');
  const tiempo = buscar('tiempo_efectivo');
  reglas.push({
    clave: 'objetivo',
    etiqueta: 'Objetivo',
    valor: textoObjetivo(objetivo),
    tipo_control:
      cantidad?.tipo_control ?? referencia?.tipo_control ?? tiempo?.tipo_control ?? null,
    texto_d01: objetivo.texto,
  });

  if (esZaEf(estacion)) {
    reglas.push({
      clave: 'za_ef',
      etiqueta: 'Estación ZA/EF',
      valor: metodo.esfuerzo.za_ef?.texto ?? 'D01 no define una regla ZA/EF para este método',
      tipo_control:
        metodo.esfuerzo.za_ef === null
          ? null
          : (cantidad?.tipo_control ?? referencia?.tipo_control ?? null),
      texto_d01: metodo.esfuerzo.za_ef?.texto ?? '',
    });
  }

  const confirmacion = buscar('confirmacion');
  if (confirmacion !== undefined && esZaEf(estacion)) {
    reglas.push({
      clave: 'confirmacion',
      etiqueta: 'Confirmación requerida',
      valor: `Con exactamente ${String(confirmacion.cantidad)} unidades: ${confirmacion.mensaje}`,
      tipo_control: confirmacion.tipo_control,
      texto_d01: confirmacion.texto,
    });
  }

  const horario = buscar('horario');
  if (metodo.horario !== null || horario !== undefined) {
    const ventanas = horario?.ventanas ?? metodo.horario?.ventanas ?? [];
    reglas.push({
      clave: 'horario',
      etiqueta: 'Horario',
      valor: ventanas.length > 0 ? describirVentanas(ventanas) : (metodo.horario?.texto ?? ''),
      tipo_control: horario?.tipo_control ?? null,
      texto_d01: horario?.texto ?? metodo.horario?.texto ?? '',
    });
  }

  const duracion = buscar('duracion_unidad_min');
  if (duracion !== undefined) {
    const zaEf = esZaEf(estacion) && duracion.minutos_za_ef !== null;
    reglas.push({
      clave: 'duracion',
      etiqueta: 'Duración mínima por unidad',
      valor: `${String(zaEf ? duracion.minutos_za_ef : duracion.minutos)} min${zaEf ? ' (ZA/EF)' : ''}`,
      tipo_control: duracion.tipo_control,
      texto_d01: duracion.texto,
    });
  }

  if (tiempo !== undefined) {
    reglas.push({
      clave: 'tiempo_efectivo',
      etiqueta: 'Tiempo efectivo de búsqueda',
      valor:
        tiempo.reducible_a_min === null
          ? `${String(tiempo.minutos)} min`
          : `${String(tiempo.minutos)} min; reducible a ${String(tiempo.reducible_a_min)} min solo con sustento`,
      tipo_control: tiempo.tipo_control,
      texto_d01: tiempo.condicion_reduccion ?? tiempo.texto,
    });
  }

  const geometria = buscar('geometria');
  reglas.push({
    clave: 'geometria',
    etiqueta: 'Georreferenciación',
    valor: metodo.geometria.texto,
    tipo_control: geometria?.tipo_control ?? null,
    texto_d01: geometria?.texto ?? metodo.geometria.texto,
  });

  const track = buscar('track');
  reglas.push({
    clave: 'track',
    etiqueta: 'Track del recorrido',
    valor: metodo.track ? 'Sí: la app registra el recorrido' : 'No',
    tipo_control: track?.tipo_control ?? null,
    texto_d01: track?.texto ?? '',
  });

  const separacion = buscar('separacion_minima_m');
  if (separacion !== undefined) {
    reglas.push({
      clave: 'separacion',
      etiqueta: 'Separación mínima entre unidades',
      valor: `${String(separacion.metros)} m`,
      tipo_control: separacion.tipo_control,
      texto_d01: separacion.texto,
    });
  }

  const fotosContexto = buscar('fotos_contexto');
  reglas.push({
    clave: 'fotos_contexto',
    etiqueta: 'Fotos de contexto',
    valor: metodo.fotos.contexto.texto,
    tipo_control: fotosContexto?.tipo_control ?? null,
    texto_d01: fotosContexto?.texto ?? metodo.fotos.contexto.texto,
  });

  const fotosMet = buscar('fotos_metodologicas');
  reglas.push({
    clave: 'fotos_metodologicas',
    etiqueta: 'Fotos metodológicas',
    valor:
      metodo.fotos.metodologicas.minimo > 0
        ? `Mínimo ${String(metodo.fotos.metodologicas.minimo)}: ${metodo.fotos.metodologicas.texto}`
        : metodo.fotos.metodologicas.texto,
    tipo_control: fotosMet?.tipo_control ?? null,
    texto_d01: fotosMet?.texto ?? metodo.fotos.metodologicas.texto,
  });

  const registros = buscar('cantidad_registros');
  if (registros !== undefined) {
    reglas.push({
      clave: 'registros',
      etiqueta: `Registros por ${metodo.unidad.tipo}`,
      valor: `Mínimo ${String(registros.minimo)}${registros.campo_motivo !== undefined ? ' o motivo de registro incompleto' : ''}`,
      tipo_control: registros.tipo_control,
      texto_d01: registros.texto,
    });
  }

  const parametros = buscar('parametros_tecnicos');
  if (parametros !== undefined) {
    reglas.push({
      clave: 'parametros_tecnicos',
      etiqueta: 'Parámetros técnicos por confirmar',
      valor: parametros.parametros.join(' · '),
      tipo_control: parametros.tipo_control,
      texto_d01: parametros.texto,
    });
  }

  const vinculo = buscar('vinculo_unidad');
  if (vinculo !== undefined || metodo.vinculo !== null) {
    reglas.push({
      clave: 'vinculo',
      etiqueta: 'Vínculo con otro método',
      valor: metodo.vinculo?.texto ?? `Cada unidad se vincula a una de ${vinculo?.metodo ?? ''}`,
      tipo_control: vinculo?.tipo_control ?? null,
      texto_d01: vinculo?.texto ?? metodo.vinculo?.texto ?? '',
    });
  }

  for (const m of v.filter((x) => x.tipo === 'mensaje')) {
    reglas.push({
      clave: 'mensaje',
      etiqueta: 'Nota metodológica',
      valor: m.texto,
      tipo_control: m.tipo_control,
      texto_d01: m.texto,
    });
  }

  const campos = buscar('campos_obligatorios');
  const total = metodo.campos.length + metodo.campos_ejecucion.length;
  const requeridos =
    metodo.campos.filter((c) => c.requerido).length +
    metodo.campos_ejecucion.filter((c) => c.requerido).length;
  reglas.push({
    clave: 'campos',
    etiqueta: 'Campos',
    valor:
      total === 0 && metodo.registros === null
        ? 'Sin campos estructurados'
        : `${String(total)} campos (${String(requeridos)} obligatorios)${metodo.registros === null ? '' : `; ${metodo.registros.etiqueta} por filas`}`,
    tipo_control: campos?.tipo_control ?? null,
    texto_d01: campos?.texto ?? '',
  });

  return reglas;
};
