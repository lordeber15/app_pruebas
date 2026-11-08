import { z } from 'zod';
import { TIPOS_UNIDAD } from '../configuracion/metodo.ts';
import {
  CATEGORIAS_ALERTA_LOGISTICA,
  ESTADOS_UNIDAD,
  ORIENTACIONES,
  TIPOS_ALERTA_REGISTRABLES,
  TIPOS_ARCHIVO,
  TIPOS_DESVIACION,
  TIPOS_FOTO,
  type EstadoEvento,
} from '../estados.ts';

/**
 * Contrato de sincronización v1 (doc. 03 §9). Lo usan la app al generar eventos y la API al
 * recibirlos; la API valida además el estado con la máquina de estados.
 *
 * `gasto_registrado` no está: los gastos son de la Fase 2. Los eventos del modelo anterior
 * (tareas, asignaciones, evidencias y esfuerzo por metodología) ya no existen: si un celular
 * antiguo los envía, se guardan completos como `no_aplicado` con `ESQUEMA_INVALIDO` (RN-12).
 */

const id = z.uuid();
/** RN-10: el id del evento es un UUID v7 generado en el dispositivo. */
const idEvento = z.uuidv7();
const hora = z.iso.datetime({ offset: true });
const sha256 = z.string().regex(/^[0-9a-f]{64}$/, 'SHA-256 en hexadecimal (minúsculas)');
const textoCorto = z.string().trim().min(1).max(500);

const latitud = z.number().min(-90).max(90);
const longitud = z.number().min(-180).max(180);

export const ubicacionSchema = z.object({
  lat: latitud,
  lon: longitud,
  precision_m: z.number().nonnegative().optional(),
  altitud_m: z.number().optional(),
});

/** GeoJSON Point en EPSG:4326: [longitud, latitud]. */
export const puntoSchema = z.object({
  type: z.literal('Point'),
  coordinates: z.tuple([longitud, latitud]),
});

/** Entidades del modelo TOCE: ejecución de un método en una estación, sus unidades y tracks. */
export const TIPOS_ENTIDAD = [
  'ejecucion',
  'unidad',
  'track',
  'archivo',
  'jornada',
  'articulo',
  'alerta',
] as const;

const sobreBase = z.object({
  id: idEvento,
  version_esquema: z.literal(1),
  /**
   * La API toma usuario y dispositivo de la sesión. Si el cuerpo los trae y no coinciden con la
   * sesión, el lote se rechaza; nunca se usan los del cuerpo.
   */
  usuario_id: id.optional(),
  dispositivo_id: id.optional(),
  entidad: z.object({ tipo: z.enum(TIPOS_ENTIDAD), id }),
  /** RN-09: dato informativo; el orden lo da `hora_servidor`. */
  hora_dispositivo: hora,
  ubicacion: ubicacionSchema.nullable(),
});

const evento = <T extends string, P extends z.ZodType>(tipo: T, payload: P) =>
  sobreBase.extend({ tipo: z.literal(tipo), payload });

const sinPayload = z.object({ automatica: z.boolean().optional() });

const archivoCapturado = z
  .object({
    archivo_id: id,
    tipo: z.enum(TIPOS_ARCHIVO),
    hash_preview: sha256,
    hash_original: sha256.nullable(),
    tamanos: z.object({
      preview: z.number().int().positive(),
      original: z.number().int().positive().nullable(),
    }),
    capturado_en: hora,
    /**
     * F-02: la foto se asocia a la ejecución (que ya identifica estación y método) y, si
     * corresponde, a la unidad, con su tipo (contexto, metodológica…) y orientación cardinal.
     * Nula solo en fichas y audios sin ejecución (sistematización, P-14).
     */
    ejecucion_id: id.nullable(),
    unidad_id: id.nullable().optional(),
    tipo_foto: z.enum(TIPOS_FOTO).nullable().optional(),
    orientacion: z.enum(ORIENTACIONES).nullable().optional(),
    candidata_reporte: z.boolean().optional(),
  })
  .refine((p) => p.tipo === 'foto' || p.hash_original === null, {
    message: 'Fichas, audios y comprobantes solo tienen la variante preview (doc. 03 §10)',
    path: ['hash_original'],
  })
  .refine((p) => (p.hash_original === null) === (p.tamanos.original === null), {
    message: 'hash_original y tamanos.original van juntos',
    path: ['tamanos', 'original'],
  });

const coordenada = z.object({ lat: latitud, lon: longitud });

/** Geometría de una unidad tal como la captura la app (RN-30); la evalúa `core/reglas`. */
export const geometriaCapturadaSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('punto'), punto: coordenada }),
  z.object({ tipo: z.literal('inicio_fin'), inicio: coordenada, fin: coordenada }),
  z.object({ tipo: z.literal('vertices'), vertices: z.array(coordenada).min(1).max(200) }),
  z.object({
    tipo: z.literal('parcela_forestal'),
    principal: z.array(coordenada).max(200),
    subparcelas: z
      .array(z.object({ tipo: textoCorto, vertices: z.array(coordenada).max(200) }))
      .max(50),
  }),
]);

/** Valores de formulario: claves de `metodo.campos` y valores simples o un punto. */
const valorCampo = z.union([z.string().max(2000), z.number(), z.boolean(), z.null(), coordenada]);
const datosFormulario = z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), valorCampo);

const ejecucionAbierta = z.object({
  ejecucion_id: id,
  /** Reserva estación × método; nula en EVENTOS, que no tienen reserva (RN-40). */
  reserva_id: id.nullable(),
  estacion_id: id,
  metodo_id: id,
  abierta_en: hora,
});

/**
 * Estado completo de una unidad (punto, transecto, trampa, ABS…). Se reenvía entero cada vez que
 * cambia: el servidor conserva el último por `hora_servidor` y el historial queda en `evento`.
 */
const unidadGuardada = z
  .object({
    unidad_id: id,
    ejecucion_id: id,
    codigo: textoCorto,
    tipo_unidad: z.enum(TIPOS_UNIDAD),
    orden: z.number().int().nonnegative(),
    estado: z.enum(ESTADOS_UNIDAD),
    geometria: geometriaCapturadaSchema.nullable(),
    inicio: hora.nullable(),
    fin: hora.nullable(),
    datos: datosFormulario,
    registros: z.array(datosFormulario).max(2000),
    unidad_vinculada_id: id.nullable(),
    parametros_confirmados: z.array(textoCorto).max(50),
  })
  .refine((p) => p.inicio === null || p.fin === null || Date.parse(p.fin) >= Date.parse(p.inicio), {
    message: 'El fin no puede ser anterior al inicio',
    path: ['fin'],
  });

/** Track del recorrido de una unidad (RN-24): solo en métodos con track en D01. */
const trackRegistrado = z
  .object({
    track_id: id,
    ejecucion_id: id,
    unidad_id: id.nullable(),
    puntos: z
      .array(
        z.object({
          lat: latitud,
          lon: longitud,
          altitud_m: z.number().nullable(),
          precision_m: z.number().nonnegative().nullable(),
          hora,
        }),
      )
      .min(2)
      .max(20_000),
  })
  .refine(
    (p) => {
      const [a] = p.puntos;
      const b = p.puntos.at(-1);
      return a === undefined || b === undefined || Date.parse(b.hora) >= Date.parse(a.hora);
    },
    { message: 'El track debe estar en orden cronológico', path: ['puntos'] },
  );

/** Cierre local de la ejecución (RN-05, RF-M11): queda pendiente de sincronización. */
const ejecucionCerrada = z
  .object({
    ejecucion_id: id,
    cerrada_en: hora,
    datos: datosFormulario,
    desviacion: z.object({
      tipo: z.enum(TIPOS_DESVIACION),
      explicacion: z.string().trim().max(2000).nullable(),
    }),
    /** Condiciones confirmadas por el usuario (p. ej. `za_ef_cantidad_exacta`, cámaras trampa). */
    confirmaciones: z.array(z.string().min(1).max(100)).max(20),
    /** Objetivo final definido en campo (bofedales, RN-38). */
    objetivo_campo: z.number().positive().nullable(),
    /** Fotos anunciadas de la ejecución, para verificar sus hashes (RN-05). */
    archivo_ids: z.array(id).max(2000),
  })
  .refine(
    (p) =>
      p.desviacion.tipo === 'ninguna' ||
      (p.desviacion.explicacion !== null && p.desviacion.explicacion.trim().length > 0),
    { message: 'Una desviación declarada requiere explicación', path: ['desviacion'] },
  );

/**
 * Alerta registrada en campo sin señal (D02 §9 y §13, RN-36). En el celular queda «pendiente de
 * sincronización»; el servidor la crea `abierta`. El tipo que puede registrar cada rol lo decide
 * `tiposDeAlerta` con el rol del usuario en la brigada (técnica: especialista y supervisor;
 * logística: JdB). La logística lleva su categoría y es solo una excepción (RN-20, E-07).
 */
export const alertaRegistradaSchema = z
  .object({
    alerta_id: id,
    brigada_id: id,
    tipo: z.enum(TIPOS_ALERTA_REGISTRABLES),
    categoria: z.enum(CATEGORIAS_ALERTA_LOGISTICA).nullable(),
    titulo: z.string().trim().min(1).max(200),
    descripcion: z.string().trim().max(4000).nullable(),
    estacion_id: id.nullable(),
    ejecucion_id: id.nullable(),
    reserva_id: id.nullable(),
    afecta_cronograma: z.boolean(),
  })
  .refine((p) => (p.tipo === 'logistica') === (p.categoria !== null), {
    message: 'La alerta logística lleva categoría; la técnica no',
    path: ['categoria'],
  });
export type AlertaRegistrada = z.infer<typeof alertaRegistradaSchema>;

export const eventoSchema = z.discriminatedUnion('tipo', [
  evento('ejecucion_abierta', ejecucionAbierta),
  evento('unidad_guardada', unidadGuardada),
  evento('track_registrado', trackRegistrado),
  evento('ejecucion_cerrada', ejecucionCerrada),
  evento('jornada_iniciada', sinPayload),
  evento('jornada_cerrada', sinPayload),
  evento(
    'checklist_respondido',
    z.object({ articulos: z.array(z.object({ id, llevado: z.boolean() })).min(1) }),
  ),
  evento('archivo_capturado', archivoCapturado),
  evento('articulo_marcado', z.object({ articulo_id: id, marcado: z.boolean() })),
  evento(
    'nota_voz_registrada',
    z.object({ archivo_id: id, plantilla_id: id.nullable(), duracion_s: z.number().positive() }),
  ),
  evento('ficha_registrada', z.object({ archivo_ids: z.array(id).min(1), plantilla_id: id })),
  evento('alerta_local_generada', alertaRegistradaSchema),
]);

export type Evento = z.infer<typeof eventoSchema>;
export type TipoEvento = Evento['tipo'];

/** El máximo por lote es configurable (`SYNC_MAX_EVENTOS_LOTE`); la API lo aplica. */
export const loteEventosSchema = z.object({ eventos: z.array(eventoSchema).min(1) });

/** Estados con los que la API responde a un evento recibido (los `resuelto_*` llegan después). */
export const ESTADOS_RESULTADO_LOTE = [
  'aplicado',
  'ya_aplicado',
  'no_aplicado',
  'en_revision',
  'duplicado',
] as const satisfies readonly EstadoEvento[];

export const respuestaLoteSchema = z.object({
  resultados: z.array(
    z.object({
      id: idEvento,
      estado: z.enum(ESTADOS_RESULTADO_LOTE),
      motivo: z.string().optional(),
    }),
  ),
  cursor_cambios: z.string(),
});
export type RespuestaLote = z.infer<typeof respuestaLoteSchema>;
