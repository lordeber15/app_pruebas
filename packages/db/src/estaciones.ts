import {
  CLASES_APLICABILIDAD,
  condicionAplicabilidadSchema,
  crearGeneradorUuidV7,
  REGIONES,
  resolverAplicabilidad,
  sridDeZonaUtm,
  type Region,
} from '@campo/core';
import { sql, type Kysely, type RawBuilder } from 'kysely';
import { z } from 'zod';
import { asignarReservasSinFila, metodosDeActividadEspecial } from './cronograma.ts';

/**
 * Estaciones, matriz estación–método y reservas: lo comparten la carga de A01 (`cargarToce`) y
 * las altas o correcciones de estaciones desde la web, para que ambas apliquen exactamente la
 * misma regla (RN-28, RN-29 y «Qué es una `reserva`» en CLAUDE.md).
 */

const uuid = crearGeneradorUuidV7((n) => globalThis.crypto.getRandomValues(new Uint8Array(n)));

/**
 * Punto EPSG:4326 desde coordenadas UTM WGS 84 (A01 las trae así); la conversión la hace
 * PostGIS. Lanza si la zona no es válida (el esquema de core la valida antes).
 */
export const geomDesdeUtm = (zonaUtm: string, este: number, norte: number): RawBuilder<string> => {
  const srid = sridDeZonaUtm(zonaUtm);
  if (srid === null) throw new Error(`Zona UTM inválida: ${zonaUtm}`);
  return sql<string>`ST_Transform(ST_SetSRID(ST_MakePoint(${este}, ${norte}), ${srid}::int), 4326)`;
};

const soloCondicion = z.object({
  aplicacion: z.object({ condicion: condicionAplicabilidadSchema.nullable() }),
});

const comoRegion = (r: string | null): Region | null => REGIONES.find((x) => x === r) ?? null;

export interface ResultadoMatriz {
  /** Filas estación × método evaluadas. */
  readonly filas: number;
  /** CONDICIONAL que no pudieron evaluarse con los atributos (P-01). */
  readonly pendientes: number;
}

/**
 * Deriva la matriz estación–método (RN-28) con la configuración D01 vigente del proyecto y los
 * atributos guardados de cada estación. Respeta las decisiones nominales ya tomadas en la web
 * (`origen = 'nominal'`): solo actualiza las demás filas.
 *
 * @param nominales claves `estacionId|codigoMetodo` que la programación decide nominalmente
 *   (las actividades especiales de A01, como epífitas o cámaras trampa).
 */
export const derivarAplicabilidad = async (
  db: Kysely<unknown>,
  opciones: {
    readonly proyectoId: string;
    /** Sin lista: todas las estaciones del proyecto. */
    readonly estacionIds?: readonly string[];
    readonly nominales?: ReadonlySet<string>;
    readonly usuarioId: string | null;
  },
): Promise<ResultadoMatriz> => {
  const { proyectoId, usuarioId } = opciones;
  const nominales = opciones.nominales ?? new Set<string>();
  if (opciones.estacionIds?.length === 0) return { filas: 0, pendientes: 0 };
  const metodos = (
    await sql<{ id: string; codigo: string; clase: string; config: unknown; es_fauna: boolean }>`
      SELECT m.id, m.codigo, m.clase, m.config, coalesce(s.es_fauna, false) AS es_fauna
        FROM app.metodo m
        JOIN app.configuracion_metodologica c ON c.id = m.configuracion_id
        LEFT JOIN app.especialidad s ON s.id = m.especialidad_id
       WHERE c.proyecto_id = ${proyectoId} AND c.estado = 'vigente'
       ORDER BY m.orden`.execute(db)
  ).rows;
  if (metodos.length === 0) return { filas: 0, pendientes: 0 };
  const estaciones = (
    await sql<{ id: string; region: string | null; uv: string | null; za_ef: string | null }>`
      SELECT id, region, uv, za_ef FROM app.estacion
       WHERE proyecto_id = ${proyectoId}
         ${opciones.estacionIds === undefined ? sql`` : sql`AND id = ANY(${[...opciones.estacionIds]}::uuid[])`}
       ORDER BY codigo`.execute(db)
  ).rows;

  let filas = 0;
  let pendientes = 0;
  for (const e of estaciones) {
    const estacion = { region: comoRegion(e.region), uv: e.uv, za_ef: e.za_ef };
    for (const m of metodos) {
      const clase = CLASES_APLICABILIDAD.find((c) => c === m.clase);
      if (clase === undefined) continue;
      const cond = soloCondicion.safeParse(m.config);
      const a = resolverAplicabilidad(
        { clase, condicion: cond.success ? cond.data.aplicacion.condicion : null },
        m.es_fauna,
        estacion,
        nominales.has(`${e.id}|${m.codigo}`) ? { habilitado: true } : null,
      );
      await sql`
        INSERT INTO app.estacion_metodo (id, estacion_id, metodo_id, habilitado, origen, condicion_pendiente, creado_por, actualizado_por)
        VALUES (${uuid()}, ${e.id}, ${m.id}, ${a.habilitado}, ${a.origen}, ${a.condicion_pendiente}, ${usuarioId}, ${usuarioId})
        ON CONFLICT (estacion_id, metodo_id) DO UPDATE
          SET habilitado = EXCLUDED.habilitado, origen = EXCLUDED.origen,
              condicion_pendiente = EXCLUDED.condicion_pendiente, actualizado_por = EXCLUDED.actualizado_por
        WHERE app.estacion_metodo.origen <> 'nominal'`.execute(db);
      filas += 1;
      if (a.condicion_pendiente) pendientes += 1;
    }
  }
  return { filas, pendientes };
};

/** Versión vigente del cronograma del proyecto (campaña activa o, si no hay, la más reciente). */
export const versionVigenteDe = async (
  db: Kysely<unknown>,
  proyectoId: string,
): Promise<string | undefined> =>
  (
    await sql<{ id: string }>`
      SELECT v.id FROM app.cronograma_version v
        JOIN app.campania c ON c.id = v.campania_id
       WHERE c.proyecto_id = ${proyectoId} AND v.estado = 'vigente'
       ORDER BY (c.estado = 'activa') DESC, c.creado_en DESC
       LIMIT 1`.execute(db)
  ).rows[0]?.id;

/**
 * Crea la reserva estación × método que falte para cada método habilitado que se presenta como
 * método (no EVENTO ni ATRIBUTO) con la configuración vigente, y ubica las reservas que aún no
 * tienen fila en el cronograma vigente (brigada y fecha). Nunca borra ni mueve una reserva que ya
 * tiene fila: eso lo hace la aprobación de una versión nueva (`reubicarReservas`).
 *
 * Devuelve cuántas reservas creó y cuántas ubicó.
 */
export const sincronizarReservas = async (
  db: Kysely<unknown>,
  opciones: {
    readonly proyectoId: string;
    readonly estacionIds?: readonly string[];
    readonly usuarioId: string | null;
  },
): Promise<{ creadas: number; ubicadas: number; reactivadas: number }> => {
  const { proyectoId, usuarioId } = opciones;
  if (opciones.estacionIds?.length === 0) return { creadas: 0, ubicadas: 0, reactivadas: 0 };
  const filtro =
    opciones.estacionIds === undefined
      ? sql``
      : sql`AND e.id = ANY(${[...opciones.estacionIds]}::uuid[])`;
  const faltantes = (
    await sql<{ estacion_id: string; metodo_id: string; titulo: string }>`
      SELECT e.id AS estacion_id, m.id AS metodo_id, e.codigo || ' · ' || m.nombre AS titulo
        FROM app.estacion_metodo em
        JOIN app.estacion e ON e.id = em.estacion_id
        JOIN app.metodo m ON m.id = em.metodo_id
        JOIN app.configuracion_metodologica c ON c.id = m.configuracion_id
       WHERE e.proyecto_id = ${proyectoId} AND c.estado = 'vigente' AND em.habilitado
         AND m.clase NOT IN ('evento', 'atributo') ${filtro}
         AND NOT EXISTS (SELECT 1 FROM app.reserva r WHERE r.estacion_id = e.id AND r.metodo_id = m.id)
       ORDER BY e.codigo, m.orden`.execute(db)
  ).rows;
  // Un CONDICIONAL descartado que vuelve a aplicar (p. ej. confirmado nominalmente) reactiva su
  // misma reserva: nunca se crea otra.
  const reactivadas = await sql`
    UPDATE app.reserva r
       SET estado = CASE WHEN r.brigada_id IS NULL THEN 'pendiente' ELSE 'asignada' END,
           actualizado_por = ${usuarioId}
      FROM app.estacion_metodo em, app.estacion e
     WHERE r.estado = 'descartada' AND em.estacion_id = r.estacion_id AND em.metodo_id = r.metodo_id
       AND em.habilitado AND e.id = r.estacion_id AND e.proyecto_id = ${proyectoId} ${filtro}`.execute(
    db,
  );
  let creadas = 0;
  for (const f of faltantes) {
    const r = await sql`
      INSERT INTO app.reserva (id, proyecto_id, estacion_id, metodo_id, geom, titulo, estado, creado_por, actualizado_por)
      SELECT ${uuid()}, ${proyectoId}, e.id, ${f.metodo_id}, e.geom, ${f.titulo}, 'pendiente', ${usuarioId}, ${usuarioId}
        FROM app.estacion e WHERE e.id = ${f.estacion_id}
      ON CONFLICT (estacion_id, metodo_id) WHERE metodo_id IS NOT NULL DO NOTHING`.execute(db);
    creadas += Number(r.numAffectedRows ?? 0n);
  }
  const vigente = await versionVigenteDe(db, proyectoId);
  const ubicadas =
    vigente === undefined
      ? 0
      : await asignarReservasSinFila(db, {
          proyectoId,
          versionId: vigente,
          usuarioId,
          ...(opciones.estacionIds === undefined ? {} : { estacionIds: opciones.estacionIds }),
        });
  return { creadas, ubicadas, reactivadas: Number(reactivadas.numAffectedRows ?? 0n) };
};

/**
 * Actividades especiales de una versión del cronograma (epífitas, cámaras trampa) como decisión
 * nominal de la matriz estación–método, igual que la carga de A01 (RN-28, «Matriz estación–método»
 * en CLAUDE.md), y reservas faltantes de esas estaciones. Lo usan la publicación del borrador y la
 * aprobación de un cambio que agrega una actividad especial. Sin `estacionIds`, todas las de la
 * versión. Devuelve cuántas estaciones tocó.
 */
export const aplicarActividadesEspeciales = async (
  db: Kysely<unknown>,
  opciones: {
    readonly proyectoId: string;
    readonly versionId: string;
    readonly usuarioId: string | null;
    readonly estacionIds?: readonly string[];
  },
): Promise<number> => {
  const { proyectoId, versionId, usuarioId } = opciones;
  if (opciones.estacionIds?.length === 0) return 0;
  const especiales = (
    await sql<{ estacion_id: string; actividad_especial: string }>`
      SELECT DISTINCT estacion_id, actividad_especial
        FROM app.cronograma_item
       WHERE version_id = ${versionId} AND estacion_id IS NOT NULL AND actividad_especial IS NOT NULL
         ${opciones.estacionIds === undefined ? sql`` : sql`AND estacion_id = ANY(${[...opciones.estacionIds]}::uuid[])`}`.execute(
      db,
    )
  ).rows;
  const nominales = new Set<string>();
  for (const i of especiales) {
    for (const codigo of metodosDeActividadEspecial(i.actividad_especial)) {
      nominales.add(`${i.estacion_id}|${codigo}`);
    }
  }
  const estacionIds = [...new Set(especiales.map((i) => i.estacion_id))];
  if (estacionIds.length === 0) return 0;
  await derivarAplicabilidad(db, { proyectoId, estacionIds, nominales, usuarioId });
  await sincronizarReservas(db, { proyectoId, estacionIds, usuarioId });
  return estacionIds.length;
};
