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

  const sinFila = (
    await sql<{ id: string; estacion_id: string; metodo_codigo: string }>`
      SELECT r.id, r.estacion_id, m.codigo AS metodo_codigo
        FROM app.reserva r
        JOIN app.metodo m ON m.id = r.metodo_id
       WHERE r.proyecto_id = ${proyectoId} AND r.cronograma_item_id IS NULL
         AND r.estacion_id IS NOT NULL`.execute(db)
  ).rows;
  let asignadas = 0;
  if (sinFila.length > 0) {
    const items = (
      await sql<ItemParaReserva & { estacion_id: string }>`
        SELECT id, estacion_id, brigada_id AS brigada, to_char(fecha, 'YYYY-MM-DD') AS fecha,
               actividad_especial AS especial
          FROM app.cronograma_item
         WHERE version_id = ${versionNuevaId} AND estacion_id IS NOT NULL
         ORDER BY fecha, orden`.execute(db)
    ).rows;
    for (const r of sinFila) {
      const item = elegirItemParaMetodo(
        items.filter((i) => i.estacion_id === r.estacion_id),
        r.metodo_codigo,
      );
      if (item === undefined) continue;
      await sql`
        UPDATE app.reserva
           SET cronograma_item_id = ${item.id}, brigada_id = ${item.brigada},
               fecha_programada = ${item.fecha}, estado = 'asignada', actualizado_por = ${usuarioId}
         WHERE id = ${r.id}`.execute(db);
      asignadas += 1;
    }
  }
  return Number(seguidas.numAffectedRows ?? 0n) + asignadas;
};
