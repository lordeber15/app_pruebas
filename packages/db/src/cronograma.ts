import { sql, type Kysely } from 'kysely';

/**
 * Reservas estación × método frente al cronograma vigente (RN-35, «Qué es una `reserva`» en
 * CLAUDE.md). Lo comparten la carga de A01 (crea las reservas) y la aprobación de una versión
 * nueva del cronograma (las reubica): una sola regla para elegir la fila de cada método.
 */

/** Actividades especiales de A01 (hoja 02) y los métodos de D01 que programan nominalmente. */
export const METODOS_POR_ACTIVIDAD_ESPECIAL: Readonly<Record<string, readonly string[]>> = {
  EPÍFITAS: ['epifitas.vasculares', 'epifitas.no_vasculares'],
  'CÁMARAS TRAMPA': ['mamiferos_mayores.camaras_trampa'],
};

export interface ItemParaReserva {
  readonly id: string;
  readonly brigada: string;
  readonly fecha: string;
  readonly especial: string | null;
}

/**
 * Fila del cronograma (de una estación, ordenadas por fecha) que programa un método: la de su
 * actividad especial si la tiene (epífitas, cámaras trampa), si no la primera regular y, si solo
 * hay especiales, la primera.
 */
export const elegirItemParaMetodo = <T extends ItemParaReserva>(
  items: readonly T[],
  codigoMetodo: string,
): T | undefined => {
  const especialDe = Object.entries(METODOS_POR_ACTIVIDAD_ESPECIAL).find(([, ms]) =>
    ms.includes(codigoMetodo),
  )?.[0];
  return (
    (especialDe === undefined ? undefined : items.find((i) => i.especial === especialDe)) ??
    items.find((i) => i.especial === null) ??
    items[0]
  );
};

/**
 * Tras aprobar una versión nueva (RN-35): cada reserva sigue a su misma fila lógica (linaje) en la
 * versión nueva, con la brigada y la fecha de esa fila; las reservas que aún no tenían fila toman
 * la que elija `elegirItemParaMetodo` entre las de su estación. Nunca se borra una reserva: si la
 * estación quedó «sujeta a decisión», la reserva se conserva con su fila marcada.
 *
 * Devuelve cuántas reservas cambiaron.
 */
export const reubicarReservas = async (
  db: Kysely<unknown>,
  opciones: {
    readonly proyectoId: string;
    readonly versionAnteriorId: string;
    readonly versionNuevaId: string;
    readonly usuarioId: string | null;
  },
): Promise<number> => {
  const { proyectoId, versionAnteriorId, versionNuevaId, usuarioId } = opciones;
  const seguidas = await sql`
    UPDATE app.reserva r
       SET cronograma_item_id = n.id, brigada_id = n.brigada_id, fecha_programada = n.fecha,
           estado = 'asignada', actualizado_por = ${usuarioId}
      FROM app.cronograma_item a
      JOIN app.cronograma_item n ON n.linaje_id = a.linaje_id AND n.version_id = ${versionNuevaId}
     WHERE a.version_id = ${versionAnteriorId}
       AND r.cronograma_item_id = a.id
       AND r.proyecto_id = ${proyectoId}`.execute(db);

  const asignadas = await asignarReservasSinFila(db, {
    proyectoId,
    versionId: versionNuevaId,
    usuarioId,
  });
  return Number(seguidas.numAffectedRows ?? 0n) + asignadas;
};

/**
 * Ubica las reservas que aún no tienen fila del cronograma en la fila que elija
 * `elegirItemParaMetodo` entre las de su estación en la versión indicada (brigada y fecha). Las
 * estaciones que esa versión no programa quedan sin fila (`pendiente`). Devuelve cuántas ubicó.
 */
export const asignarReservasSinFila = async (
  db: Kysely<unknown>,
  opciones: {
    readonly proyectoId: string;
    readonly versionId: string;
    readonly usuarioId: string | null;
    readonly estacionIds?: readonly string[];
  },
): Promise<number> => {
  const { proyectoId, versionId, usuarioId } = opciones;
  const sinFila = (
    await sql<{ id: string; estacion_id: string; metodo_codigo: string }>`
      SELECT r.id, r.estacion_id, m.codigo AS metodo_codigo
        FROM app.reserva r
        JOIN app.metodo m ON m.id = r.metodo_id
       WHERE r.proyecto_id = ${proyectoId} AND r.cronograma_item_id IS NULL
         AND r.estacion_id IS NOT NULL
         ${opciones.estacionIds === undefined ? sql`` : sql`AND r.estacion_id = ANY(${[...opciones.estacionIds]}::uuid[])`}`.execute(
      db,
    )
  ).rows;
  if (sinFila.length === 0) return 0;
  const items = (
    await sql<ItemParaReserva & { estacion_id: string }>`
      SELECT id, estacion_id, brigada_id AS brigada, to_char(fecha, 'YYYY-MM-DD') AS fecha,
             actividad_especial AS especial
        FROM app.cronograma_item
       WHERE version_id = ${versionId} AND estacion_id IS NOT NULL
       ORDER BY fecha, orden`.execute(db)
  ).rows;
  const porEstacion = new Map<string, (ItemParaReserva & { estacion_id: string })[]>();
  for (const i of items) {
    const lista = porEstacion.get(i.estacion_id) ?? [];
    lista.push(i);
    porEstacion.set(i.estacion_id, lista);
  }
  let asignadas = 0;
  for (const r of sinFila) {
    const item = elegirItemParaMetodo(porEstacion.get(r.estacion_id) ?? [], r.metodo_codigo);
    if (item === undefined) continue;
    await sql`
      UPDATE app.reserva
         SET cronograma_item_id = ${item.id}, brigada_id = ${item.brigada},
             fecha_programada = ${item.fecha}, estado = 'asignada', actualizado_por = ${usuarioId}
       WHERE id = ${r.id}`.execute(db);
    asignadas += 1;
  }
  return asignadas;
};

export interface FilaCronogramaBase {
  readonly brigada_id: string;
  /** AAAA-MM-DD. */
  readonly fecha: string;
  readonly tipo_actividad: string;
  readonly estacion_id: string | null;
  readonly detalle: string | null;
  readonly estado_fila?: string;
  readonly actividad_especial?: string | null;
}

/**
 * Crea el cronograma base de una campaña: versión 1, vigente y `es_base`, con sus filas en el
 * orden dado (RN-35). Lo usan la carga de A01 y la publicación del borrador armado en la web. La
 * campaña no debe tener versiones (lo garantiza la restricción única de la BD).
 */
export const crearCronogramaBase = async (
  db: Kysely<unknown>,
  opciones: {
    readonly campaniaId: string;
    readonly usuarioId: string | null;
    readonly filas: readonly FilaCronogramaBase[];
    readonly nuevoId: () => string;
  },
): Promise<string> => {
  const { campaniaId, usuarioId, filas, nuevoId } = opciones;
  const versionId = nuevoId();
  await sql`
    INSERT INTO app.cronograma_version (id, campania_id, numero, estado, es_base, aprobado_por, aprobado_en, creado_por, actualizado_por)
    VALUES (${versionId}, ${campaniaId}, 1, 'vigente', true, ${usuarioId}, now(), ${usuarioId}, ${usuarioId})`.execute(
    db,
  );
  for (const [orden, f] of filas.entries()) {
    await sql`
      INSERT INTO app.cronograma_item (id, version_id, brigada_id, fecha, tipo_actividad, estacion_id, detalle,
                                       estado_fila, actividad_especial, orden, creado_por, actualizado_por)
      VALUES (${nuevoId()}, ${versionId}, ${f.brigada_id}, ${f.fecha}, ${f.tipo_actividad}, ${f.estacion_id},
              ${f.detalle}, ${f.estado_fila ?? 'ok'}, ${f.actividad_especial ?? null}, ${orden}, ${usuarioId}, ${usuarioId})`.execute(
      db,
    );
  }
  return versionId;
};
