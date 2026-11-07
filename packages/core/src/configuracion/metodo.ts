import { z } from 'zod';

/**
 * Configuración de un método tal como la define D01 (`requerimientos/cliente/D01`, hoja
 * `01_Config_Metodos`), en forma estructurada para que la app y el servidor la evalúen.
 *
 * Es dato, no código: vive en `metodo.config` (jsonb) y se carga desde la semilla curada
 * `packages/db/semillas/toce/d01-metodos.json`. Cada regla conserva su **tipo de control**
 * (RN-31) y el texto fuente de D01 para trazabilidad. Nada de lo que no esté en D01 se
 * inventa aquí: los vacíos quedan como `null` o como condición `manual` (P-01).
 */

/** Clases de aplicabilidad provisional (D01 hoja 00, D02 §4, RN-28). */
export const CLASES_APLICABILIDAD = [
  'todas',
  'condicional',
  'evento',
  'atributo',
  'transversal',
] as const;
export type ClaseAplicabilidad = (typeof CLASES_APLICABILIDAD)[number];

/** Tipo de control de una regla (D02 §9, RN-31). Solo `obligatorio` bloquea o genera incumplimiento. */
export const TIPOS_CONTROL = [
  'obligatorio',
  'advertencia',
  'informativo',
  'referencia',
  'criterio_humano',
] as const;
export type TipoControl = (typeof TIPOS_CONTROL)[number];

/** Geometría que la app debe capturar por método (D02 §7, RN-30). */
export const TIPOS_GEOMETRIA = [
  /** Coordenada individual. */
  'punto',
  /** Evento incidental: coordenada cuando corresponda. */
  'punto_opcional',
  /** Ambos extremos de una línea o recorrido. */
  'inicio_fin',
  /** Todos los vértices de una parcela. */
  'vertices',
  /** Parcela principal 250 × 20 m + 5 subparcelas de latizales + 5 de brinzales, por vértices. */
  'parcela_forestal',
  /** Atributo: hereda la geometría del método donde se registra. */
  'hereda',
  /** Reutiliza la coordenada o el trazado de otro método (vínculo). */
  'vinculada',
] as const;
export type TipoGeometria = (typeof TIPOS_GEOMETRIA)[number];

/** Unidad operativa (D02 §3). */
export const TIPOS_UNIDAD = [
  'transecto',
  'cuadrante',
  'parcela',
  'recorrido',
  'arbol',
  'punto',
  'trampa',
  'bandeja',
  'red',
  'camara',
  'detector',
  'lista',
  'sector',
  'abs',
  'evento',
  'atributo',
] as const;
export type TipoUnidad = (typeof TIPOS_UNIDAD)[number];

export const REGIONES = ['COSTA', 'SIERRA', 'SELVA'] as const;
export type Region = (typeof REGIONES)[number];

const texto = z.string().trim().min(1);
/** Clave de un campo del formulario (`campoSchema.clave`). */
const clave = z.string().regex(/^[a-z][a-z0-9_]*$/);
const textoOpcional = z.string().trim().min(1).nullable();
const horaHHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'hora HH:MM');
const tipoControl = z.enum(TIPOS_CONTROL);

/**
 * Condición de un método CONDICIONAL evaluable contra los atributos de la estación (A01).
 * `manual`: D01 no da un criterio derivable de los atributos; la estación queda
 * «pendiente de confirmación» hasta la matriz nominal (P-01) y se habilita desde la web.
 */
export const condicionAplicabilidadSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('region'), regiones: z.array(z.enum(REGIONES)).min(1) }),
  z.object({
    tipo: z.literal('region_excepto_uv'),
    regiones: z.array(z.enum(REGIONES)).min(1),
    uv_excluida_contiene: z.array(texto).min(1),
  }),
  z.object({ tipo: z.literal('uv_contiene'), fragmentos: z.array(texto).min(1) }),
  z.object({ tipo: z.literal('za_ef') }),
  /** Cumple si la estación es ZA/EF; en las demás queda pendiente (p. ej. cobertura arbórea). */
  z.object({ tipo: z.literal('za_ef_o_manual') }),
  z.object({ tipo: z.literal('manual') }),
]);
export type CondicionAplicabilidad = z.infer<typeof condicionAplicabilidadSchema>;

export const campoSchema = z.object({
  clave,
  etiqueta: texto,
  /** `punto`: coordenada tomada con la geolocalización de la app (p. ej. ubicación de una detección). */
  tipo: z.enum(['texto', 'entero', 'decimal', 'opcion', 'booleano', 'hora', 'fecha', 'punto']),
  opciones: z.array(texto).min(1).optional(),
  requerido: z.boolean(),
  /** Unidad de medida u orientación para quien captura (p. ej. «cm», «m»). */
  ayuda: z.string().optional(),
});
export type Campo = z.infer<typeof campoSchema>;

const ventanaHoraria = z.object({ inicio: horaHHMM, fin: horaHHMM });
const porRegion = z
  .object({
    COSTA: z.number().positive(),
    SIERRA: z.number().positive(),
    SELVA: z.number().positive(),
  })
  .partial();

/**
 * Validaciones y alertas de D01 («Validaciones / alertas» y «Esfuerzo»), cada una con su tipo de
 * control. El evaluador (`core/reglas`) las aplica; la app las muestra al iniciar el método.
 */
export const validacionSchema = z.discriminatedUnion('tipo', [
  /** Número de unidades del esfuerzo estándar o, en ZA/EF, el duplicado. `por_region` prevalece cuando D01 lo distingue (VES). */
  z.object({
    tipo: z.literal('cantidad_unidades'),
    minimo: z.number().positive(),
    minimo_za_ef: z.number().positive().nullable(),
    por_region: porRegion.optional(),
    za_ef_por_region: porRegion.optional(),
    tipo_control: tipoControl,
    texto: texto,
  }),
  /**
   * Filas registradas por unidad (100 lecturas por transecto, 20 especies por lista).
   * `campo_motivo`: campo de la unidad cuyo texto justifica un registro incompleto cuando D01 lo
   * admite («20 especies o motivo de lista incompleta»).
   */
  z.object({
    tipo: z.literal('cantidad_registros'),
    minimo: z.number().int().positive(),
    campo_motivo: clave.optional(),
    tipo_control: tipoControl,
    texto: texto,
  }),
  /** Esfuerzo que D01 define como referencia (bofedales): se muestra, no se controla. */
  z.object({
    tipo: z.literal('referencia_esfuerzo'),
    tipo_control: z.enum(['referencia', 'criterio_humano']),
    texto: texto,
  }),
  z.object({
    tipo: z.literal('separacion_minima_m'),
    metros: z.number().positive(),
    tipo_control: tipoControl,
    texto: texto,
  }),
  z.object({
    tipo: z.literal('duracion_unidad_min'),
    minutos: z.number().positive(),
    minutos_za_ef: z.number().positive().nullable(),
    tipo_control: tipoControl,
    texto: texto,
  }),
  z.object({
    tipo: z.literal('horario'),
    ventanas: z.array(ventanaHoraria).min(1),
    tipo_control: tipoControl,
    texto: texto,
  }),
  z.object({ tipo: z.literal('geometria'), tipo_control: tipoControl, texto: texto }),
  z.object({ tipo: z.literal('track'), tipo_control: tipoControl, texto: texto }),
  z.object({
    tipo: z.literal('fotos_contexto'),
    cantidad_por_unidad: z.number().int().positive(),
    tipo_control: tipoControl,
    texto: texto,
  }),
  z.object({
    tipo: z.literal('fotos_metodologicas'),
    minimo: z.number().int().positive(),
    tipo_control: tipoControl,
    texto: texto,
  }),
  z.object({ tipo: z.literal('campos_obligatorios'), tipo_control: tipoControl, texto: texto }),
  /** Confirmación explícita del usuario ante una condición (cámaras trampa en ZA/EF). */
  z.object({
    tipo: z.literal('confirmacion'),
    condicion: z.enum(['za_ef_cantidad_exacta']),
    cantidad: z.number().int().positive(),
    mensaje: texto,
    tipo_control: z.literal('obligatorio'),
    texto: texto,
  }),
  /** Mensaje informativo sin control. */
  z.object({ tipo: z.literal('mensaje'), tipo_control: z.literal('informativo'), texto: texto }),
  /**
   * Tiempo efectivo de búsqueda (ABS): minutos y condición de reducción. `campo_minutos` es el
   * campo de la ejecución con los minutos; `campos_sustento`, los que deben tener contenido para
   * aceptar la reducción (además de al menos una ABS identificada, RN-33).
   */
  z.object({
    tipo: z.literal('tiempo_efectivo'),
    minutos: z.number().positive(),
    reducible_a_min: z.number().positive().nullable(),
    condicion_reduccion: textoOpcional,
    campo_minutos: clave,
    campos_sustento: z.array(clave),
    tipo_control: tipoControl,
    texto: texto,
  }),
  /** Parámetros técnicos verificables (detector acústico, T-12). */
  z.object({
    tipo: z.literal('parametros_tecnicos'),
    parametros: z.array(texto).min(1),
    tipo_control: tipoControl,
    texto: texto,
  }),
  /**
   * Vínculo espacial obligatorio con una unidad de otro método. `campo_justificacion`: campo de
   * la unidad cuyo texto justifica un trazado independiente cuando D01 lo permite (F-10).
   */
  z.object({
    tipo: z.literal('vinculo_unidad'),
    metodo: texto,
    campo_justificacion: clave.optional(),
    tipo_control: tipoControl,
    texto: texto,
  }),
]);
export type Validacion = z.infer<typeof validacionSchema>;
export type TipoValidacion = Validacion['tipo'];

export const configuracionMetodoSchema = z.object({
  /** Identificador estable, en minúsculas (p. ej. `flora.puntos_intercepcion`). */
  codigo: z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/),
  /** Nombre tal como aparece en D01. */
  nombre: texto,
  /** Código de la especialidad (columna «Grupo» de D01). */
  especialidad: z.string().regex(/^[a-z][a-z0-9_]*$/),
  clase: z.enum(CLASES_APLICABILIDAD),
  aplicacion: z.object({ texto: texto, condicion: condicionAplicabilidadSchema.nullable() }),
  unidad: z.object({
    tipo: z.enum(TIPOS_UNIDAD),
    /** Otras unidades que el método registra además de la principal (bofedales: cuadrantes). */
    tipos_adicionales: z.array(z.enum(TIPOS_UNIDAD)).default([]),
    texto: textoOpcional,
  }),
  esfuerzo: z.object({
    estandar: z
      .object({ cantidad: z.number().positive().nullable(), unidad: texto, texto: texto })
      .nullable(),
    za_ef: z.object({ cantidad: z.number().positive().nullable(), texto: texto }).nullable(),
  }),
  horario: z.object({ ventanas: z.array(ventanaHoraria), texto: texto }).nullable(),
  geometria: z.object({
    tipo: z.enum(TIPOS_GEOMETRIA),
    texto: texto,
    /** Método cuya geometría se reutiliza (`vinculada`). */
    vinculo_metodo: z.string().nullable(),
    /** Geometría de las unidades adicionales, por tipo de unidad. */
    por_tipo: z.partialRecord(z.enum(TIPOS_UNIDAD), z.enum(TIPOS_GEOMETRIA)).optional(),
    detalle: z
      .object({
        vertices_minimos: z.number().int().min(3).optional(),
        subparcelas: z
          .array(
            z.object({ tipo: texto, cantidad: z.number().int().positive(), dimensiones: texto }),
          )
          .optional(),
      })
      .nullable(),
  }),
  track: z.boolean(),
  fotos: z.object({
    contexto: z.object({
      cantidad_por_unidad: z.number().int().positive().nullable(),
      /** Cantidad para las unidades adicionales, por tipo. */
      por_tipo: z.partialRecord(z.enum(TIPOS_UNIDAD), z.number().int().positive()).optional(),
      cardinales: z.boolean(),
      reutiliza_metodo: z.string().nullable(),
      texto: texto,
    }),
    metodologicas: z.object({
      minimo: z.number().int().nonnegative(),
      texto: texto,
    }),
  }),
  /** Campos de la ejecución completa (p. ej. grupo de fauna y tiempo efectivo en ABS). */
  campos_ejecucion: z.array(campoSchema).default([]),
  /** Campos de cada unidad (formulario). */
  campos: z.array(campoSchema),
  /** Filas repetibles (p. ej. una por especie) dentro de la unidad. */
  registros: z.object({ etiqueta: texto, campos: z.array(campoSchema).min(1) }).nullable(),
  validaciones: z.array(validacionSchema),
  vinculo: z.object({ texto: texto, metodos: z.array(z.string()) }).nullable(),
  /** Columnas de trazabilidad de D01, verbatim. */
  fuente: z.object({ estado: texto, origen: texto, pendiente: texto }),
});
export type ConfiguracionMetodo = z.infer<typeof configuracionMetodoSchema>;

export const especialidadSchema = z.object({
  codigo: z.string().regex(/^[a-z][a-z0-9_]*$/),
  nombre: texto,
  es_fauna: z.boolean(),
  orden: z.number().int().nonnegative(),
});
export type Especialidad = z.infer<typeof especialidadSchema>;

/** Semilla completa derivada de D01: especialidades y los 33 métodos. */
export const semillaD01Schema = z
  .object({
    fuente: texto,
    version: texto,
    especialidades: z.array(especialidadSchema).min(1),
    metodos: z.array(configuracionMetodoSchema).min(1),
  })
  .superRefine((s, ctx) => {
    const esp = new Set(s.especialidades.map((e) => e.codigo));
    const codigos = new Set<string>();
    s.metodos.forEach((m, i) => {
      if (!esp.has(m.especialidad)) {
        ctx.addIssue({
          code: 'custom',
          path: ['metodos', i, 'especialidad'],
          message: `Especialidad desconocida: ${m.especialidad}`,
        });
      }
      if (codigos.has(m.codigo)) {
        ctx.addIssue({
          code: 'custom',
          path: ['metodos', i, 'codigo'],
          message: 'Código repetido',
        });
      }
      codigos.add(m.codigo);
      if (m.clase === 'condicional' && m.aplicacion.condicion === null) {
        ctx.addIssue({
          code: 'custom',
          path: ['metodos', i, 'aplicacion'],
          message: 'Un método CONDICIONAL necesita su condición (o `manual`)',
        });
      }
      if (m.geometria.tipo === 'vinculada' && m.geometria.vinculo_metodo === null) {
        ctx.addIssue({
          code: 'custom',
          path: ['metodos', i, 'geometria'],
          message: 'Geometría vinculada sin método de vínculo',
        });
      }
    });
    s.metodos.forEach((m, i) => {
      const v = m.geometria.vinculo_metodo;
      if (v !== null && !codigos.has(v)) {
        ctx.addIssue({
          code: 'custom',
          path: ['metodos', i, 'geometria', 'vinculo_metodo'],
          message: `Método vinculado desconocido: ${v}`,
        });
      }
    });
  });
export type SemillaD01 = z.infer<typeof semillaD01Schema>;

/** Cuenta de métodos por clase: la de D01 es 14 / 14 / 3 / 1 / 1 (QA-02, D02 §4). */
export const contarPorClase = (
  metodos: readonly Pick<ConfiguracionMetodo, 'clase'>[],
): Readonly<Record<ClaseAplicabilidad, number>> => {
  const c: Record<ClaseAplicabilidad, number> = {
    todas: 0,
    condicional: 0,
    evento: 0,
    atributo: 0,
    transversal: 0,
  };
  for (const m of metodos) c[m.clase] += 1;
  return c;
};
