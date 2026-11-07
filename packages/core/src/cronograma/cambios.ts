import { z } from 'zod';
import {
  ESTADOS_FILA_CRONOGRAMA,
  TIPOS_ACTIVIDAD_CRONOGRAMA,
  type EstadoFilaCronograma,
  type TipoActividadCronograma,
} from '../estados.ts';
import { exito, fallo, type Resultado } from '../resultado.ts';

/**
 * Cambios de cronograma (D02 §10, D04 §11, RN-35). Una solicitud aprobada se aplica sobre los
 * ítems de la versión vigente y produce los de la versión nueva; la anterior no se toca.
 *
 * Invariante RN-35: **una estación no ejecutada nunca desaparece**. Por construcción no existe un
 * cambio «eliminar»: solo reprogramar, marcar o agregar. La prueba `RN-35` lo verifica.
 */
export interface ItemCronograma {
  readonly id: string;
  readonly brigada_id: string;
  /** AAAA-MM-DD. */
  readonly fecha: string;
  readonly tipo_actividad: TipoActividadCronograma;
  readonly estacion_id: string | null;
  readonly detalle: string | null;
  readonly estado_fila: EstadoFilaCronograma;
  readonly actividad_especial: string | null;
}

const fechaIso = z.iso.date();
const id = z.uuid();

export const cambioCronogramaSchema = z.discriminatedUnion('tipo', [
  z.object({
    tipo: z.literal('reprogramar'),
    item_id: id,
    fecha: fechaIso,
    brigada_id: id.nullable(),
  }),
  z.object({
    tipo: z.literal('marcar'),
    item_id: id,
    estado_fila: z.enum(ESTADOS_FILA_CRONOGRAMA),
  }),
  z.object({
    tipo: z.literal('agregar'),
    item: z.object({
      id,
      brigada_id: id,
      fecha: fechaIso,
      tipo_actividad: z.enum(TIPOS_ACTIVIDAD_CRONOGRAMA),
      estacion_id: id.nullable(),
      detalle: z.string().trim().max(500).nullable(),
      actividad_especial: z.string().trim().max(100).nullable(),
    }),
  }),
]);
export type CambioCronograma = z.infer<typeof cambioCronogramaSchema>;

export type MotivoRechazoCambio = 'ITEM_INEXISTENTE' | 'ESTACION_SIN_ID' | 'ID_REPETIDO';

/** Aplica los cambios y devuelve los ítems de la versión nueva. No muta la entrada. */
export const aplicarCambiosCronograma = (
  items: readonly ItemCronograma[],
  cambios: readonly CambioCronograma[],
): Resultado<readonly ItemCronograma[], MotivoRechazoCambio> => {
  const porId = new Map(items.map((i) => [i.id, i]));
  for (const c of cambios) {
    switch (c.tipo) {
      case 'reprogramar': {
        const actual = porId.get(c.item_id);
        if (actual === undefined) return fallo('ITEM_INEXISTENTE');
        porId.set(c.item_id, {
          ...actual,
          fecha: c.fecha,
          brigada_id: c.brigada_id ?? actual.brigada_id,
          estado_fila: 'reprogramada',
        });
        break;
      }
      case 'marcar': {
        const actual = porId.get(c.item_id);
        if (actual === undefined) return fallo('ITEM_INEXISTENTE');
        porId.set(c.item_id, { ...actual, estado_fila: c.estado_fila });
        break;
      }
      case 'agregar': {
        if (porId.has(c.item.id)) return fallo('ID_REPETIDO');
        if ((c.item.tipo_actividad === 'estacion') !== (c.item.estacion_id !== null)) {
          return fallo('ESTACION_SIN_ID');
        }
        porId.set(c.item.id, { ...c.item, estado_fila: 'ok' });
        break;
      }
    }
  }
  return exito([...porId.values()]);
};

export interface ImpactoCronograma {
  /** Estaciones cuya fecha o brigada cambia. */
  readonly estaciones_afectadas: readonly string[];
  /** Fechas (AAAA-MM-DD) que ganan o pierden actividades. */
  readonly fechas_afectadas: readonly string[];
  /** Ítems del cronograma anterior que ya no están: debe ser siempre vacío (RN-35). */
  readonly items_desaparecidos: readonly string[];
}

/** Impacto de una propuesta: lo que la web muestra antes de que el JdP decida (D02 §10). */
export const impactoCronograma = (
  antes: readonly ItemCronograma[],
  despues: readonly ItemCronograma[],
): ImpactoCronograma => {
  const despuesPorId = new Map(despues.map((i) => [i.id, i]));
  const estaciones = new Set<string>();
  const fechas = new Set<string>();
  const desaparecidos: string[] = [];
  for (const a of antes) {
    const d = despuesPorId.get(a.id);
    if (d === undefined) {
      desaparecidos.push(a.id);
      continue;
    }
    if (d.fecha !== a.fecha || d.brigada_id !== a.brigada_id) {
      if (a.estacion_id !== null) estaciones.add(a.estacion_id);
      fechas.add(a.fecha);
      fechas.add(d.fecha);
    }
  }
  const antesIds = new Set(antes.map((i) => i.id));
  for (const d of despues) {
    if (!antesIds.has(d.id)) {
      if (d.estacion_id !== null) estaciones.add(d.estacion_id);
      fechas.add(d.fecha);
    }
  }
  return {
    estaciones_afectadas: [...estaciones].sort(),
    fechas_afectadas: [...fechas].sort(),
    items_desaparecidos: desaparecidos,
  };
};
