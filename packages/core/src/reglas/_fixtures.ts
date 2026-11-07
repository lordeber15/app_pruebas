import type { Campo, ConfiguracionMetodo, Validacion } from '../configuracion/metodo.ts';
import type { Coordenada, EjecucionEvaluable, FotoEvaluable, UnidadEvaluable } from './tipos.ts';

/**
 * Constructores para las pruebas del motor de reglas. Los valores de cada método se copian de
 * D01 (`requerimientos/cliente/D01`, hoja 01) en la prueba que lo usa; aquí solo hay plantillas.
 */

export const metodoBase = (sobre: Partial<ConfiguracionMetodo> = {}): ConfiguracionMetodo => ({
  codigo: 'prueba.metodo',
  nombre: 'MÉTODO DE PRUEBA',
  especialidad: 'prueba',
  clase: 'todas',
  aplicacion: { texto: 'Todas las estaciones.', condicion: null },
  unidad: { tipo: 'punto', tipos_adicionales: [], texto: null },
  esfuerzo: {
    estandar: { cantidad: 1, unidad: 'puntos', texto: '1 punto.' },
    za_ef: { cantidad: 2, texto: '2 puntos.' },
  },
  horario: null,
  geometria: {
    tipo: 'punto',
    texto: 'Punto georreferenciado en la app',
    vinculo_metodo: null,
    detalle: null,
  },
  track: false,
  fotos: {
    contexto: {
      cantidad_por_unidad: null,
      cardinales: false,
      reutiliza_metodo: null,
      texto: 'Sin fotos de contexto',
    },
    metodologicas: { minimo: 0, texto: 'Sin fotos metodológicas' },
  },
  campos_ejecucion: [],
  campos: [],
  registros: null,
  validaciones: [],
  vinculo: null,
  fuente: { estado: 'CERRADO', origen: 'Prueba', pendiente: '' },
  ...sobre,
});

export const campo = (clave: string, requerido = true, tipo: Campo['tipo'] = 'texto'): Campo => ({
  clave,
  etiqueta: clave.replaceAll('_', ' '),
  tipo,
  requerido,
});

export const val = {
  cantidad: (
    minimo: number,
    minimoZaEf: number | null,
    extra: Partial<Extract<Validacion, { tipo: 'cantidad_unidades' }>> = {},
  ): Validacion => ({
    tipo: 'cantidad_unidades',
    minimo,
    minimo_za_ef: minimoZaEf,
    tipo_control: 'obligatorio',
    texto: `D01: ${String(minimo)} unidades; ZA/EF ${String(minimoZaEf)}`,
    ...extra,
  }),
  geometria: (): Validacion => ({
    tipo: 'geometria',
    tipo_control: 'obligatorio',
    texto: 'D01: geometría',
  }),
  track: (): Validacion => ({ tipo: 'track', tipo_control: 'obligatorio', texto: 'D01: track' }),
  fotosContexto: (cantidad: number): Validacion => ({
    tipo: 'fotos_contexto',
    cantidad_por_unidad: cantidad,
    tipo_control: 'obligatorio',
    texto: `D01: ${String(cantidad)} fotos de contexto`,
  }),
  fotosMetodologicas: (minimo = 2): Validacion => ({
    tipo: 'fotos_metodologicas',
    minimo,
    tipo_control: 'obligatorio',
    texto: `D01: mínimo ${String(minimo)} metodológicas`,
  }),
  campos: (): Validacion => ({
    tipo: 'campos_obligatorios',
    tipo_control: 'obligatorio',
    texto: 'D01: campos mínimos',
  }),
  separacion: (
    metros: number,
    tipoControl: Validacion['tipo_control'] = 'obligatorio',
  ): Validacion => ({
    tipo: 'separacion_minima_m',
    metros,
    tipo_control: tipoControl,
    texto: `D01: separación de ${String(metros)} m`,
  }),
  duracion: (minutos: number, minutosZaEf: number | null = null): Validacion => ({
    tipo: 'duracion_unidad_min',
    minutos,
    minutos_za_ef: minutosZaEf,
    tipo_control: 'obligatorio',
    texto: `D01: ${String(minutos)} min`,
  }),
  horario: (ventanas: readonly { inicio: string; fin: string }[]): Validacion => ({
    tipo: 'horario',
    ventanas: [...ventanas],
    tipo_control: 'obligatorio',
    texto: 'D01: horario',
  }),
  registros: (minimo: number, campoMotivo?: string): Validacion => ({
    tipo: 'cantidad_registros',
    minimo,
    ...(campoMotivo === undefined ? {} : { campo_motivo: campoMotivo }),
    tipo_control: 'obligatorio',
    texto: `D01: ${String(minimo)} registros`,
  }),
  referencia: (tipoControl: 'referencia' | 'criterio_humano' = 'criterio_humano'): Validacion => ({
    tipo: 'referencia_esfuerzo',
    tipo_control: tipoControl,
    texto: 'D01: esfuerzo de referencia según superficie; la app no redondea, limita ni bloquea',
  }),
  confirmacion: (cantidad: number, mensaje: string): Validacion => ({
    tipo: 'confirmacion',
    condicion: 'za_ef_cantidad_exacta',
    cantidad,
    mensaje,
    tipo_control: 'obligatorio',
    texto: 'D01: confirmación en ZA/EF',
  }),
  mensaje: (texto: string): Validacion => ({ tipo: 'mensaje', tipo_control: 'informativo', texto }),
  tiempoEfectivo: (): Validacion => ({
    tipo: 'tiempo_efectivo',
    minutos: 120,
    reducible_a_min: 60,
    condicion_reduccion:
      'Cobertura amplia de sectores/ambientes + ABS identificadas + sectores que sustentan la reducción.',
    campo_minutos: 'tiempo_efectivo_min',
    campos_sustento: ['sectores_cubiertos', 'sustento_reduccion'],
    tipo_control: 'obligatorio',
    texto: 'D01 T-01: 2 h por estación y grupo; reducible a 1 h con sustento',
  }),
  parametros: (parametros: readonly string[]): Validacion => ({
    tipo: 'parametros_tecnicos',
    parametros: [...parametros],
    tipo_control: 'obligatorio',
    texto: 'D01 T-12: parámetros del detector',
  }),
  vinculo: (metodo: string, campoJustificacion?: string): Validacion => ({
    tipo: 'vinculo_unidad',
    metodo,
    ...(campoJustificacion === undefined ? {} : { campo_justificacion: campoJustificacion }),
    tipo_control: 'obligatorio',
    texto: `D01: vínculo con ${metodo}`,
  }),
};

/** Punto de partida en Lima; `mover` desplaza metros al norte y al este (aprox. plana, válida a esta escala). */
export const ORIGEN: Coordenada = { lat: -12.05, lon: -77.04 };
const METROS_POR_GRADO_LAT = 111_320;
export const mover = (p: Coordenada, norteM: number, esteM: number): Coordenada => ({
  lat: p.lat + norteM / METROS_POR_GRADO_LAT,
  lon: p.lon + esteM / (METROS_POR_GRADO_LAT * Math.cos((p.lat * Math.PI) / 180)),
});

/** Instante ISO (UTC) de una hora local de Lima (UTC−5, sin horario de verano). */
export const lima = (fecha: string, hhmm: string): string =>
  new Date(`${fecha}T${hhmm}:00-05:00`).toISOString();

export const foto = (tipo: FotoEvaluable['tipo'], heredada = false): FotoEvaluable => ({
  tipo,
  orientacion: null,
  heredada,
});
export const fotos = (contexto: number, metodologicas = 0): FotoEvaluable[] => [
  ...Array.from({ length: contexto }, () => foto('contexto')),
  ...Array.from({ length: metodologicas }, () => foto('metodologica')),
];

let contador = 0;
export const unidad = (sobre: Partial<UnidadEvaluable> = {}): UnidadEvaluable => {
  contador += 1;
  return {
    id: `u-${String(contador)}`,
    codigo: `U-${String(contador)}`,
    tipo: 'punto',
    estado: 'cerrada',
    geometria: { tipo: 'punto', punto: ORIGEN },
    inicio: null,
    fin: null,
    datos: {},
    registros: [],
    fotos: [],
    track: null,
    unidad_vinculada_id: null,
    parametros_confirmados: [],
    ...sobre,
  };
};

/** `n` unidades cerradas separadas `separacionM` metros hacia el este, con geometría de punto. */
export const puntos = (
  n: number,
  separacionM: number,
  sobre: Partial<UnidadEvaluable> = {},
): UnidadEvaluable[] =>
  Array.from({ length: n }, (_, i) =>
    unidad({ geometria: { tipo: 'punto', punto: mover(ORIGEN, 0, i * separacionM) }, ...sobre }),
  );

export const ejecucion = (sobre: Partial<EjecucionEvaluable> = {}): EjecucionEvaluable => ({
  abierta_en: lima('2026-12-05', '06:00'),
  cerrada_en: lima('2026-12-05', '12:00'),
  datos: {},
  desviacion: { tipo: 'ninguna', explicacion: null },
  confirmaciones: [],
  objetivo_campo: null,
  fotos: fotos(0, 2),
  unidades: [],
  ...sobre,
});

export const ESTACION_COSTA = { region: 'COSTA', za_ef: null, uv: 'Matorral' } as const;
export const ESTACION_SELVA = { region: 'SELVA', za_ef: null, uv: 'Bosque' } as const;
export const ESTACION_ZA_EF = { region: 'SIERRA', za_ef: 'ZA', uv: 'Bofedal' } as const;
export const ESTACION_SIN_REGION = { region: null, za_ef: null, uv: null } as const;
