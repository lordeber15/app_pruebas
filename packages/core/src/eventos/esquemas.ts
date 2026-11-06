import { z } from 'zod';
import { TIPOS_ARCHIVO, type EstadoEvento } from '../estados';

/**
 * Contrato de sincronización v1 (doc. 03 §9). Lo usan la app al generar eventos y la API al
 * recibirlos; la API valida además el estado con la máquina de estados.
 *
 * `gasto_registrado` no está: los gastos son de la Fase 2.
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

export const TIPOS_ENTIDAD = [
  'tarea',
  'evidencia_item',
  'archivo',
  'jornada',
  'estacion_metodologia',
  'articulo',
  'comentario',
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
  asignacion_id: id.nullable(),
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
    tarea_id: id.nullable(),
    evidencia_item_id: id.nullable(),
    categoria_id: id.nullable(),
    hash_preview: sha256,
    hash_original: sha256.nullable(),
    tamanos: z.object({
      preview: z.number().int().positive(),
      original: z.number().int().positive().nullable(),
    }),
    capturado_en: hora,
  })
  .refine((p) => p.tipo === 'foto' || p.hash_original === null, {
    message: 'Fichas, audios y comprobantes solo tienen la variante preview (doc. 03 §10)',
    path: ['hash_original'],
  })
  .refine((p) => (p.hash_original === null) === (p.tamanos.original === null), {
    message: 'hash_original y tamanos.original van juntos',
    path: ['tamanos', 'original'],
  });

const transectoFinalizado = z
  .object({
    estacion_metodologia_id: id,
    inicio: hora,
    fin: hora,
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
      .min(1),
  })
  .refine((p) => Date.parse(p.fin) >= Date.parse(p.inicio), {
    message: 'El fin no puede ser anterior al inicio',
    path: ['fin'],
  });

export const eventoSchema = z.discriminatedUnion('tipo', [
  evento('jornada_iniciada', sinPayload),
  evento('jornada_cerrada', sinPayload),
  evento(
    'checklist_respondido',
    z.object({ articulos: z.array(z.object({ id, llevado: z.boolean() })).min(1) }),
  ),
  evento(
    'evidencia_item_creado',
    z.object({
      tarea_id: id,
      descripcion: textoCorto,
      geom: puntoSchema.nullable(),
      orden: z.number().int().nonnegative(),
    }),
  ),
  evento('archivo_capturado', archivoCapturado),
  evento(
    'nota_voz_registrada',
    z.object({ archivo_id: id, plantilla_id: id.nullable(), duracion_s: z.number().positive() }),
  ),
  evento('ficha_registrada', z.object({ archivo_ids: z.array(id).min(1), plantilla_id: id })),
  evento(
    'esfuerzo_registrado',
    z.object({
      estacion_metodologia_id: id,
      fase: textoCorto,
      cantidad: z.number().nonnegative(),
      fecha: z.iso.date(),
    }),
  ),
  evento(
    'observacion_registrada',
    z.object({
      estacion_metodologia_id: id,
      especie_texto: textoCorto,
      conteo: z.number().int().nonnegative(),
    }),
  ),
  evento('transecto_finalizado', transectoFinalizado),
  evento(
    'comentario_creado',
    z.object({ tarea_id: id, texto: z.string().trim().min(1).max(2000) }),
  ),
  // RN-04: completar exige al menos una foto anunciada.
  evento('tarea_completada', z.object({ tarea_id: id, archivo_ids: z.array(id).min(1) })),
  evento(
    'validacion_registrada',
    z.object({ tarea_id: id, comentario: z.string().max(2000).nullable() }),
  ),
  evento(
    'observacion_validacion',
    z.object({ tarea_id: id, comentario: z.string().max(2000).nullable() }),
  ),
  evento(
    'alerta_local_generada',
    z.object({
      regla_id: id,
      clave_dedup: z.string().min(1).max(300),
      entidad: z.object({ tipo: z.enum(TIPOS_ENTIDAD), id }),
    }),
  ),
  evento('articulo_marcado', z.object({ articulo_id: id, marcado: z.boolean() })),
  evento(
    'verificacion_registrada',
    z.object({ estacion_metodologia_id: id, especialista_id: id, conforme: z.boolean() }),
  ),
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
