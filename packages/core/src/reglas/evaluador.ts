import type {
  Campo,
  ConfiguracionMetodo,
  TipoControl,
  TipoUnidad,
  Validacion,
} from '../configuracion/metodo.ts';
import { tieneTexto } from '../resultado.ts';
import {
  geometriaRequerida,
  puntoRepresentativo,
  separacionMinima,
  verificarGeometria,
  type ProblemaGeometria,
} from './geometria.ts';
import {
  ZONA_HORARIA_POR_DEFECTO,
  dentroDeAlgunaVentana,
  describirVentanas,
  duracionMinutos,
  horaLocal,
  minutosLocales,
} from './horario.ts';
import { calcularAvance, esfuerzoEjecutado, esZaEf, resolverObjetivo } from './objetivo.ts';
import type {
  ContextoEvaluacion,
  EstadoRegla,
  EvaluacionEjecucion,
  Objetivo,
  ReglaEvaluada,
  ResultadoRegla,
  UnidadEvaluable,
} from './tipos.ts';

/**
 * Motor de reglas (RF-T04, RN-31). Evalúa una ejecución contra la configuración D01 de su
 * método y devuelve un resultado por regla con su **tipo de control**. Solo los `incumple` de
 * reglas `obligatorio` cuentan como incumplimiento (⇒ ejecución `parcial` y alerta
 * post-sincronización); advertencias, referencias, mensajes y criterios humanos jamás.
 *
 * La misma función corre en el celular (completitud local, con unidades aún abiertas) y en el
 * worker (QA post-sincronización, con todo cerrado). Sin reglas en D01 no hay evaluación: nada
 * de lo que no esté en `metodo.validaciones` se controla, salvo la explicación de una
 * desviación declarada (D02 §6, RF-M11).
 */

type Veredicto = {
  readonly estado: 'cumple' | 'incumple' | 'no_evaluable';
  readonly mensaje: string;
  readonly esperado?: number | string | null;
  readonly obtenido?: number | string | null;
};

interface Ctx {
  readonly metodo: ConfiguracionMetodo;
  readonly zona: string;
  readonly zaEf: boolean;
  readonly objetivo: Objetivo;
  readonly ejecucion: ContextoEvaluacion['ejecucion'];
  readonly unidades: readonly UnidadEvaluable[];
  /** Unidades del tipo principal del método (todas, abiertas o cerradas). */
  readonly principales: readonly UnidadEvaluable[];
  /** Unidades principales cerradas: las que cuentan para el esfuerzo. */
  readonly cerradas: readonly UnidadEvaluable[];
  readonly vinculables: ReadonlyMap<string, string> | null;
}

export const valorPresente = (v: unknown): boolean => {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'boolean') return true;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return false;
};

const numero = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const redondear = (n: number): number => Math.round(n * 10) / 10;

/** Texto de un valor de formulario; cualquier cosa que no sea texto cuenta como vacío. */
const textoDe = (v: unknown): string => (typeof v === 'string' ? v : '');

const resultado = (
  regla: ReglaEvaluada,
  tipoControl: TipoControl,
  textoD01: string,
  estado: EstadoRegla,
  mensaje: string,
  extra: {
    unidad_id?: string | null;
    esperado?: number | string | null;
    obtenido?: number | string | null;
  } = {},
): ResultadoRegla => ({
  regla,
  tipo_control: tipoControl,
  estado,
  mensaje,
  texto_d01: textoD01,
  unidad_id: extra.unidad_id ?? null,
  esperado: extra.esperado ?? null,
  obtenido: extra.obtenido ?? null,
});

/**
 * Evalúa una regla unidad por unidad. Devuelve un resultado por unidad que incumple; si ninguna
 * incumple, un solo resultado `cumple`; si no hubo nada que evaluar, uno `no_evaluable`.
 */
const porUnidad = (
  v: Validacion,
  unidades: readonly UnidadEvaluable[],
  evaluar: (u: UnidadEvaluable) => Veredicto | null,
  resumen: (evaluadas: number) => string,
): ResultadoRegla[] => {
  const fallas: ResultadoRegla[] = [];
  let evaluadas = 0;
  for (const u of unidades) {
    const ver = evaluar(u);
    if (ver === null || ver.estado === 'no_evaluable') continue;
    evaluadas += 1;
    if (ver.estado === 'incumple') {
      fallas.push(
        resultado(v.tipo, v.tipo_control, v.texto, 'incumple', `${u.codigo}: ${ver.mensaje}`, {
          unidad_id: u.id,
          esperado: ver.esperado,
          obtenido: ver.obtenido,
        }),
      );
    }
  }
  if (evaluadas === 0) {
    return [resultado(v.tipo, v.tipo_control, v.texto, 'no_evaluable', 'Sin unidades que evaluar')];
  }
  return fallas.length > 0
    ? fallas
    : [resultado(v.tipo, v.tipo_control, v.texto, 'cumple', resumen(evaluadas))];
};

/** Tipos de unidad cuyo recorrido lleva track: los que D01 georreferencia con inicio + fin (RN-24). */
export const tiposConTrack = (
  metodo: Pick<ConfiguracionMetodo, 'track' | 'unidad' | 'geometria'>,
): readonly TipoUnidad[] => {
  if (!metodo.track) return [];
  const tipos = [metodo.unidad.tipo, ...metodo.unidad.tipos_adicionales];
  return tipos.filter((t) => geometriaRequerida(metodo, t) === 'inicio_fin');
};

/** Fotos de contexto que D01 exige a una unidad según su tipo; `null` si no exige ninguna. */
export const fotosContextoRequeridas = (
  metodo: Pick<ConfiguracionMetodo, 'unidad' | 'fotos'>,
  tipoUnidad: TipoUnidad,
  cantidadValidacion: number | null = null,
): number | null => {
  const porTipo = metodo.fotos.contexto.por_tipo?.[tipoUnidad];
  if (porTipo !== undefined) return porTipo;
  if (tipoUnidad !== metodo.unidad.tipo) return null;
  if (metodo.fotos.contexto.cantidad_por_unidad !== null) {
    return metodo.fotos.contexto.cantidad_por_unidad;
  }
  const hayPorTipo = Object.keys(metodo.fotos.contexto.por_tipo ?? {}).length > 0;
  return hayPorTipo ? null : cantidadValidacion;
};

const descripcionGeometria: Record<Exclude<ProblemaGeometria, never>, string> = {
  SIN_GEOMETRIA: 'sin la geometría que pide el método',
  TIPO_DISTINTO: 'geometría distinta de la que pide el método',
  VERTICES_INSUFICIENTES: 'vértices insuficientes',
  SUBPARCELAS_INCOMPLETAS: 'faltan subparcelas de latizales o brinzales',
};

const nombreGeometria: Record<ConfiguracionMetodo['geometria']['tipo'], string> = {
  punto: 'punto georreferenciado',
  punto_opcional: 'punto georreferenciado (opcional)',
  inicio_fin: 'inicio y fin georreferenciados',
  vertices: 'vértices georreferenciados',
  parcela_forestal: 'parcela principal y subparcelas con vértices',
  hereda: 'geometría heredada',
  vinculada: 'geometría del método vinculado',
};

const camposFaltantes = (
  campos: readonly Campo[],
  datos: Readonly<Record<string, unknown>>,
): string[] =>
  campos.filter((c) => c.requerido && !valorPresente(datos[c.clave])).map((c) => c.etiqueta);

const evaluarValidacion = (v: Validacion, c: Ctx): ResultadoRegla[] => {
  switch (v.tipo) {
    case 'cantidad_unidades': {
      const esperado = c.objetivo.cantidad ?? v.minimo;
      const n = c.cerradas.length;
      const notaRegion =
        (v.por_region !== undefined || v.za_ef_por_region !== undefined) &&
        c.objetivo.origen !== 'd01_region' &&
        c.objetivo.origen !== 'd01_za_ef_region'
          ? '. Región no determinada: se aplica el mínimo general de D01'
          : '';
      const notaZaEf =
        c.objetivo.origen === 'd01_za_ef' || c.objetivo.origen === 'd01_za_ef_region'
          ? ' (estación ZA/EF)'
          : '';
      return [
        n >= esperado
          ? resultado(
              v.tipo,
              v.tipo_control,
              v.texto,
              'cumple',
              `${String(n)} de ${String(esperado)} ${c.objetivo.unidad_texto}${notaZaEf}`,
              { esperado, obtenido: n },
            )
          : resultado(
              v.tipo,
              v.tipo_control,
              v.texto,
              'incumple',
              `Faltan ${String(esperado - n)}: ${String(n)} de ${String(esperado)} ${c.objetivo.unidad_texto}${notaZaEf}${notaRegion}`,
              { esperado, obtenido: n },
            ),
      ];
    }

    case 'cantidad_registros':
      return porUnidad(
        v,
        c.principales,
        (u) => {
          const n = u.registros.length;
          if (n >= v.minimo) return { estado: 'cumple', mensaje: '' };
          if (v.campo_motivo !== undefined && tieneTexto(textoDe(u.datos[v.campo_motivo]))) {
            return { estado: 'cumple', mensaje: '' };
          }
          return {
            estado: 'incumple',
            mensaje: `${String(n)} de ${String(v.minimo)} registros${v.campo_motivo !== undefined ? ' y sin motivo de registro incompleto' : ''}`,
            esperado: v.minimo,
            obtenido: n,
          };
        },
        (n) => `Registros completos en ${String(n)} unidad(es)`,
      );

    case 'referencia_esfuerzo':
      return [
        resultado(
          v.tipo,
          v.tipo_control,
          v.texto,
          'informativo',
          c.objetivo.origen === 'campo'
            ? `Objetivo definido en campo: ${String(c.objetivo.cantidad)} ${c.objetivo.unidad_texto}`
            : 'Esfuerzo de referencia: el especialista define el número final de unidades y puede agregar más',
          { esperado: c.objetivo.cantidad, obtenido: c.cerradas.length },
        ),
      ];

    case 'separacion_minima_m': {
      const puntos = c.principales.flatMap((u) => {
        const p = puntoRepresentativo(u.geometria);
        return p === null ? [] : [{ id: u.id, punto: p, codigo: u.codigo }];
      });
      const sep = separacionMinima(puntos);
      if (sep === null) {
        return [
          resultado(
            v.tipo,
            v.tipo_control,
            v.texto,
            'no_evaluable',
            'Se necesitan al menos dos unidades georreferenciadas',
          ),
        ];
      }
      const codigo = (id: string): string => puntos.find((p) => p.id === id)?.codigo ?? id;
      const metros = Math.round(sep.metros);
      return [
        sep.metros >= v.metros
          ? resultado(
              v.tipo,
              v.tipo_control,
              v.texto,
              'cumple',
              `Separación mínima de ${String(metros)} m entre unidades`,
              { esperado: v.metros, obtenido: metros },
            )
          : resultado(
              v.tipo,
              v.tipo_control,
              v.texto,
              'incumple',
              `${codigo(sep.a)} y ${codigo(sep.b)} están a ${String(metros)} m; D01 pide al menos ${String(v.metros)} m`,
              { unidad_id: sep.a, esperado: v.metros, obtenido: metros },
            ),
      ];
    }

    case 'duracion_unidad_min': {
      const requerido = c.zaEf && v.minutos_za_ef !== null ? v.minutos_za_ef : v.minutos;
      return porUnidad(
        v,
        c.principales,
        (u) => {
          const d = duracionMinutos(u.inicio, u.fin);
          if (d === null) {
            return u.estado === 'cerrada'
              ? {
                  estado: 'incumple',
                  mensaje: 'sin hora de inicio o de fin',
                  esperado: requerido,
                  obtenido: null,
                }
              : { estado: 'no_evaluable', mensaje: '' };
          }
          return d >= requerido
            ? { estado: 'cumple', mensaje: '' }
            : {
                estado: 'incumple',
                mensaje: `duró ${String(redondear(d))} min; mínimo ${String(requerido)} min${c.zaEf && v.minutos_za_ef !== null ? ' en ZA/EF' : ''}`,
                esperado: requerido,
                obtenido: redondear(d),
              };
        },
        (n) => `Duración mínima de ${String(requerido)} min cumplida en ${String(n)} unidad(es)`,
      );
    }

    case 'horario':
      return porUnidad(
        v,
        c.unidades,
        (u) => {
          if (u.inicio === null) return { estado: 'no_evaluable', mensaje: '' };
          const ini = minutosLocales(u.inicio, c.zona);
          if (ini === null) return { estado: 'no_evaluable', mensaje: '' };
          if (!dentroDeAlgunaVentana(ini, v.ventanas)) {
            return {
              estado: 'incumple',
              mensaje: `inicio a las ${horaLocal(u.inicio, c.zona)}, fuera del horario ${describirVentanas(v.ventanas)}`,
              esperado: describirVentanas(v.ventanas),
              obtenido: horaLocal(u.inicio, c.zona),
            };
          }
          if (u.fin !== null) {
            const fin = minutosLocales(u.fin, c.zona);
            if (fin !== null && !dentroDeAlgunaVentana(fin, v.ventanas)) {
              return {
                estado: 'incumple',
                mensaje: `fin a las ${horaLocal(u.fin, c.zona)}, fuera del horario ${describirVentanas(v.ventanas)}`,
                esperado: describirVentanas(v.ventanas),
                obtenido: horaLocal(u.fin, c.zona),
              };
            }
          }
          return { estado: 'cumple', mensaje: '' };
        },
        (n) => `Horario ${describirVentanas(v.ventanas)} respetado en ${String(n)} unidad(es)`,
      );

    case 'geometria':
      return porUnidad(
        v,
        c.unidades,
        (u) => {
          const req = geometriaRequerida(c.metodo, u.tipo);
          if (req === null || req === 'hereda' || req === 'vinculada') return null;
          const problema = verificarGeometria(c.metodo, req, u.geometria);
          if (problema === null) return { estado: 'cumple', mensaje: '' };
          const detalle =
            problema === 'VERTICES_INSUFICIENTES' && u.geometria?.tipo === 'vertices'
              ? ` (${String(u.geometria.vertices.length)} de ${String(c.metodo.geometria.detalle?.vertices_minimos ?? 3)})`
              : '';
          return {
            estado: 'incumple',
            mensaje: `${descripcionGeometria[problema]}${detalle}; se requiere ${nombreGeometria[req]}`,
            esperado: req,
            obtenido: u.geometria?.tipo ?? null,
          };
        },
        (n) =>
          `Geometría «${nombreGeometria[c.metodo.geometria.tipo]}» completa en ${String(n)} unidad(es)`,
      );

    case 'track': {
      const tipos = tiposConTrack(c.metodo);
      return porUnidad(
        v,
        c.unidades.filter((u) => tipos.includes(u.tipo)),
        (u) =>
          u.track !== null && u.track.puntos >= 2
            ? { estado: 'cumple', mensaje: '' }
            : u.estado === 'cerrada'
              ? {
                  estado: 'incumple',
                  mensaje: 'sin track del recorrido',
                  esperado: 'track',
                  obtenido: u.track?.puntos ?? 0,
                }
              : { estado: 'no_evaluable', mensaje: '' },
        (n) => `Track registrado en ${String(n)} recorrido(s)`,
      );
    }

    case 'fotos_contexto': {
      const permiteHeredadas =
        c.metodo.fotos.contexto.reutiliza_metodo !== null ||
        c.metodo.geometria.tipo === 'vinculada';
      return porUnidad(
        v,
        c.unidades,
        (u) => {
          const requeridas = fotosContextoRequeridas(c.metodo, u.tipo, v.cantidad_por_unidad);
          if (requeridas === null) return null;
          const n = u.fotos.filter(
            (f) => f.tipo === 'contexto' && (!f.heredada || permiteHeredadas),
          ).length;
          return n >= requeridas
            ? { estado: 'cumple', mensaje: '' }
            : {
                estado: 'incumple',
                mensaje: `${String(n)} de ${String(requeridas)} fotos de contexto`,
                esperado: requeridas,
                obtenido: n,
              };
        },
        (n) => `Fotos de contexto completas en ${String(n)} unidad(es)`,
      );
    }

    case 'fotos_metodologicas': {
      const propias = (fotos: readonly { tipo: string; heredada: boolean }[]): number =>
        fotos.filter((f) => f.tipo === 'metodologica' && !f.heredada).length;
      const n = propias(c.ejecucion.fotos) + c.unidades.reduce((s, u) => s + propias(u.fotos), 0);
      return [
        n >= v.minimo
          ? resultado(
              v.tipo,
              v.tipo_control,
              v.texto,
              'cumple',
              `${String(n)} fotos metodológicas (mínimo ${String(v.minimo)})`,
              { esperado: v.minimo, obtenido: n },
            )
          : resultado(
              v.tipo,
              v.tipo_control,
              v.texto,
              'incumple',
              `${String(n)} de ${String(v.minimo)} fotos metodológicas`,
              { esperado: v.minimo, obtenido: n },
            ),
      ];
    }

    case 'campos_obligatorios': {
      const res: ResultadoRegla[] = [];
      const faltanEjecucion = camposFaltantes(c.metodo.campos_ejecucion, c.ejecucion.datos);
      if (faltanEjecucion.length > 0) {
        res.push(
          resultado(
            v.tipo,
            v.tipo_control,
            v.texto,
            'incumple',
            `Faltan datos de la ejecución: ${faltanEjecucion.join(', ')}`,
            { esperado: faltanEjecucion.length, obtenido: 0 },
          ),
        );
      }
      for (const u of c.principales) {
        const faltan = camposFaltantes(c.metodo.campos, u.datos);
        const registros = c.metodo.registros;
        const faltanRegistros =
          registros === null
            ? []
            : u.registros.flatMap((r, i) => {
                const f = camposFaltantes(registros.campos, r);
                return f.length > 0
                  ? [`${registros.etiqueta} ${String(i + 1)}: ${f.join(', ')}`]
                  : [];
              });
        if (faltan.length > 0 || faltanRegistros.length > 0) {
          const partes = [
            ...(faltan.length > 0 ? [`faltan ${faltan.join(', ')}`] : []),
            ...faltanRegistros,
          ];
          res.push(
            resultado(
              v.tipo,
              v.tipo_control,
              v.texto,
              'incumple',
              `${u.codigo}: ${partes.join('; ')}`,
              { unidad_id: u.id, esperado: faltan.length + faltanRegistros.length, obtenido: 0 },
            ),
          );
        }
      }
      return res.length > 0
        ? res
        : [resultado(v.tipo, v.tipo_control, v.texto, 'cumple', 'Campos obligatorios completos')];
    }

    case 'confirmacion': {
      if (!c.zaEf)
        return [
          resultado(
            v.tipo,
            v.tipo_control,
            v.texto,
            'no_aplica',
            'Solo aplica en estaciones ZA/EF',
          ),
        ];
      const n = c.cerradas.length;
      if (n !== v.cantidad) {
        return [
          resultado(
            v.tipo,
            v.tipo_control,
            v.texto,
            'no_aplica',
            n > v.cantidad
              ? `${String(n)} unidades: más de ${String(v.cantidad)}, continúa sin confirmación`
              : `${String(n)} unidades: la confirmación se pide con exactamente ${String(v.cantidad)}`,
            { esperado: v.cantidad, obtenido: n },
          ),
        ];
      }
      return [
        c.ejecucion.confirmaciones.includes(v.condicion)
          ? resultado(v.tipo, v.tipo_control, v.texto, 'cumple', `Confirmado: ${v.mensaje}`, {
              esperado: v.cantidad,
              obtenido: n,
            })
          : resultado(
              v.tipo,
              v.tipo_control,
              v.texto,
              'incumple',
              `Confirmación pendiente: ${v.mensaje}`,
              { esperado: v.cantidad, obtenido: n },
            ),
      ];
    }

    case 'mensaje':
      return [resultado(v.tipo, v.tipo_control, v.texto, 'informativo', v.texto)];

    case 'tiempo_efectivo': {
      const minutos = numero(c.ejecucion.datos[v.campo_minutos]);
      if (minutos === null) {
        return [
          c.ejecucion.cerrada_en !== null
            ? resultado(
                v.tipo,
                v.tipo_control,
                v.texto,
                'incumple',
                'Sin tiempo efectivo de búsqueda registrado',
                { esperado: v.minutos, obtenido: null },
              )
            : resultado(
                v.tipo,
                v.tipo_control,
                v.texto,
                'no_evaluable',
                'Tiempo efectivo aún no registrado',
                { esperado: v.minutos },
              ),
        ];
      }
      if (minutos >= v.minutos) {
        return [
          resultado(
            v.tipo,
            v.tipo_control,
            v.texto,
            'cumple',
            `${String(redondear(minutos))} min de búsqueda (mínimo ${String(v.minutos)})`,
            { esperado: v.minutos, obtenido: minutos },
          ),
        ];
      }
      if (v.reducible_a_min !== null && minutos >= v.reducible_a_min) {
        const sinSustento = v.campos_sustento.filter((k) => !valorPresente(c.ejecucion.datos[k]));
        const faltanAbs = c.cerradas.length === 0;
        if (sinSustento.length === 0 && !faltanAbs) {
          return [
            resultado(
              v.tipo,
              v.tipo_control,
              v.texto,
              'cumple',
              `Reducción a ${String(redondear(minutos))} min sustentada (mínimo reducido ${String(v.reducible_a_min)})`,
              { esperado: v.reducible_a_min, obtenido: minutos },
            ),
          ];
        }
        const motivos = [
          ...(faltanAbs ? ['ninguna ABS identificada'] : []),
          ...(sinSustento.length > 0 ? [`sin ${sinSustento.join(' ni ')}`] : []),
        ];
        return [
          resultado(
            v.tipo,
            v.tipo_control,
            v.texto,
            'incumple',
            `${String(redondear(minutos))} min de ${String(v.minutos)}; la reducción a ${String(v.reducible_a_min)} min no está sustentada: ${motivos.join(', ')}`,
            { esperado: v.minutos, obtenido: minutos },
          ),
        ];
      }
      return [
        resultado(
          v.tipo,
          v.tipo_control,
          v.texto,
          'incumple',
          `${String(redondear(minutos))} min de ${String(v.minutos)} de búsqueda`,
          { esperado: v.minutos, obtenido: minutos },
        ),
      ];
    }

    case 'parametros_tecnicos':
      return porUnidad(
        v,
        c.principales,
        (u) => {
          const faltan = v.parametros.filter((p) => !u.parametros_confirmados.includes(p));
          return faltan.length === 0
            ? { estado: 'cumple', mensaje: '' }
            : {
                estado: 'incumple',
                mensaje: `parámetros sin confirmar: ${faltan.join(', ')}`,
                esperado: v.parametros.length,
                obtenido: v.parametros.length - faltan.length,
              };
        },
        (n) => `Parámetros técnicos confirmados en ${String(n)} unidad(es)`,
      );

    case 'vinculo_unidad':
      return porUnidad(
        v,
        c.principales,
        (u) => {
          if (u.unidad_vinculada_id !== null) {
            const metodoVinculado = c.vinculables?.get(u.unidad_vinculada_id);
            if (c.vinculables !== null && metodoVinculado !== v.metodo) {
              return {
                estado: 'incumple',
                mensaje: `vinculada a una unidad que no es de ${v.metodo}`,
                esperado: v.metodo,
                obtenido: metodoVinculado ?? 'desconocido',
              };
            }
            return { estado: 'cumple', mensaje: '' };
          }
          if (
            v.campo_justificacion !== undefined &&
            tieneTexto(textoDe(u.datos[v.campo_justificacion])) &&
            u.geometria !== null
          ) {
            return { estado: 'cumple', mensaje: '' };
          }
          return {
            estado: 'incumple',
            mensaje: `sin vínculo con una unidad de ${v.metodo}${v.campo_justificacion !== undefined ? ' ni trazado independiente justificado' : ''}`,
            esperado: v.metodo,
            obtenido: null,
          };
        },
        (n) => `Vínculo con ${v.metodo} en ${String(n)} unidad(es)`,
      );
  }
};

/** Una desviación declarada exige explicación (D02 §6, RF-M11); no es regla de D01. */
const evaluarDesviacion = (ejecucion: ContextoEvaluacion['ejecucion']): ResultadoRegla[] => {
  const { tipo, explicacion } = ejecucion.desviacion;
  if (tipo === 'ninguna') return [];
  const texto = 'D02 §6: imposibilidad, ejecución parcial o condición excepcional con explicación';
  return [
    tieneTexto(explicacion)
      ? resultado(
          'desviacion',
          'obligatorio',
          texto,
          'informativo',
          `Desviación declarada (${tipo}): ${explicacion?.trim() ?? ''}`,
          { obtenido: tipo },
        )
      : resultado(
          'desviacion',
          'obligatorio',
          texto,
          'incumple',
          `La desviación declarada (${tipo}) requiere una explicación`,
          { obtenido: tipo },
        ),
  ];
};

/**
 * RN-04 ampliada (decisión del usuario, 2026-11-08): toda ejecución, incluidos los EVENTOS, debe
 * tener al menos N fotos georreferenciadas, de cualquier tipo. Es una regla del proyecto, no de
 * D01: el mínimo llega en `ctx.proyecto`; sin él (o con 0) no se evalúa. Las fotos heredadas por
 * vínculo no cuentan: la foto tiene que ser de esta ejecución.
 */
const evaluarFotoEjecucion = (ctx: ContextoEvaluacion): ResultadoRegla[] => {
  const minimo = ctx.proyecto?.fotos_minimas_ejecucion ?? 0;
  if (!Number.isFinite(minimo) || minimo <= 0) return [];
  const propias = (fotos: readonly { heredada: boolean }[]): number =>
    fotos.filter((f) => !f.heredada).length;
  const n =
    propias(ctx.ejecucion.fotos) + ctx.ejecucion.unidades.reduce((s, u) => s + propias(u.fotos), 0);
  const texto = `Decisión del proyecto (RN-04 ampliada): toda ejecución requiere al menos ${String(minimo)} foto(s) georreferenciada(s)`;
  return [
    n >= minimo
      ? resultado('foto_ejecucion', 'obligatorio', texto, 'cumple', `${String(n)} foto(s) en la ejecución (mínimo ${String(minimo)})`, {
          esperado: minimo,
          obtenido: n,
        })
      : resultado(
          'foto_ejecucion',
          'obligatorio',
          texto,
          'incumple',
          `Toda ejecución requiere al menos ${String(minimo)} foto(s) georreferenciada(s) (decisión del proyecto): hay ${String(n)}`,
          { esperado: minimo, obtenido: n },
        ),
  ];
};

export const evaluarEjecucion = (ctx: ContextoEvaluacion): EvaluacionEjecucion => {
  const { metodo, estacion, ejecucion } = ctx;
  const principales = ejecucion.unidades.filter((u) => u.tipo === metodo.unidad.tipo);
  const cerradas = principales.filter((u) => u.estado === 'cerrada');
  const objetivo = resolverObjetivo(metodo, estacion, ejecucion.objetivo_campo);
  const c: Ctx = {
    metodo,
    zona: ctx.zona_horaria ?? ZONA_HORARIA_POR_DEFECTO,
    zaEf: esZaEf(estacion),
    objetivo,
    ejecucion,
    unidades: ejecucion.unidades,
    principales,
    cerradas,
    vinculables:
      ctx.unidades_vinculables === undefined
        ? null
        : new Map(ctx.unidades_vinculables.map((u) => [u.id, u.metodo])),
  };

  const resultados = [
    ...metodo.validaciones.flatMap((v) => evaluarValidacion(v, c)),
    ...evaluarFotoEjecucion(ctx),
    ...evaluarDesviacion(ejecucion),
  ];

  const ejecutado = esfuerzoEjecutado(metodo, objetivo, {
    datos: ejecucion.datos,
    unidades_cerradas: cerradas.length,
  });

  return {
    resultados,
    incumplimientos_obligatorios: resultados.filter(
      (r) => r.estado === 'incumple' && r.tipo_control === 'obligatorio',
    ).length,
    advertencias: resultados.filter(
      (r) => r.estado === 'incumple' && r.tipo_control === 'advertencia',
    ).length,
    objetivo,
    avance: calcularAvance(ejecutado, objetivo),
    unidades_cerradas: cerradas.length,
  };
};

/** Resultados que la interfaz debe destacar: incumplimientos obligatorios primero, luego advertencias. */
export const resultadosDestacados = (e: EvaluacionEjecucion): readonly ResultadoRegla[] => {
  const orden: Record<TipoControl, number> = {
    obligatorio: 0,
    advertencia: 1,
    informativo: 2,
    referencia: 3,
    criterio_humano: 4,
  };
  return [...e.resultados]
    .filter((r) => r.estado === 'incumple')
    .sort((a, b) => orden[a.tipo_control] - orden[b.tipo_control]);
};
