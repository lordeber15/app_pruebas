import { createHash } from 'node:crypto';
import {
  multiPoligonoSchema,
  type AsignarPoligono,
  type CapaProyecto,
  type EstacionEnPoligono,
  type MultiPoligono,
  type PoligonoProyecto,
} from '@campo/core';
import type { Db } from '@campo/db';
import { sql } from 'kysely';
import { ProblemaHttp } from '../../plataforma/errores.ts';
import { generarId } from '../../plataforma/ids.ts';
import type { Actor } from '../../plataforma/sesion.ts';
import {
  brigadasVisibles,
  exigirGlobal,
  noEncontrado,
  veTodosLosProyectos,
} from '../alcance/autorizacion.ts';
import { leerKmz } from './kmz.ts';

/**
 * Polígonos del proyecto por KMZ (decisión del usuario, 2026-11-09; RF-W02, RF-M05, P-06).
 *
 * - Cargar y asignar: Coordinación y JdP (`configurar_proyecto`).
 * - Consultar: Coordinación y JdP, y los miembros de alguna brigada del proyecto (el celular los
 *   recibe en el paquete de campo).
 * - Una estación con polígono cuyas coordenadas quedan fuera genera una **alerta técnica del
 *   sistema** (sin brigada: la ven y cierran Coordinación y JdP). La clave de deduplicación lleva
 *   la posición: la misma estación en el mismo lugar no repite la alerta; si se corrige y vuelve a
 *   quedar fuera en otro lugar, sí.
 */

export const TAMANO_MAXIMO_KMZ = 20 * 1024 * 1024;

const existeProyecto = async (db: Db, proyectoId: string) => {
  const p = await db
    .selectFrom('proyecto')
    .select('id')
    .where('id', '=', proyectoId)
    .executeTakeFirst();
  if (p === undefined) throw noEncontrado('El proyecto');
};

const exigirLectura = async (db: Db, actor: Actor, proyectoId: string) => {
  if (veTodosLosProyectos(actor)) return existeProyecto(db, proyectoId);
  const visibles = await brigadasVisibles(db, actor, proyectoId);
  if (visibles.size === 0) throw noEncontrado('El proyecto');
};

const geomSql = (g: MultiPoligono) =>
  sql<string>`ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(g)}), 4326)), 3))`;

/** Estaciones del proyecto que caen dentro de cada geometría (índice → ids y códigos). */
const estacionesDentro = async (db: Db, proyectoId: string, geometrias: readonly MultiPoligono[]) =>
  Promise.all(
    geometrias.map((g) =>
      db
        .selectFrom('estacion')
        .select(['id', 'codigo'])
        .where('proyecto_id', '=', proyectoId)
        .where(sql<boolean>`ST_Covers(${geomSql(g)}, geom)`)
        .orderBy('codigo')
        .execute(),
    ),
  );

export const previsualizarKmz = async (
  db: Db,
  actor: Actor,
  proyectoId: string,
  archivo: Buffer,
) => {
  exigirGlobal(actor, 'configurar_proyecto');
  await existeProyecto(db, proyectoId);
  const leido = leerKmz(archivo);
  const dentro = await estacionesDentro(
    db,
    proyectoId,
    leido.poligonos.map((p) => p.geometria),
  );
  return {
    poligonos: leido.poligonos.map((p, i) => ({ ...p, estaciones_dentro: dentro[i] ?? [] })),
    ignorados: leido.ignorados,
  };
};

/**
 * Alerta técnica por cada estación con polígono que queda fuera de él (ids nulos = todas las del
 * proyecto). Devuelve cuántas alertas nuevas creó.
 */
export const alertarEstacionesFuera = async (
  tx: Db,
  proyectoId: string,
  estacionIds: readonly string[] | null,
  usuarioId: string,
): Promise<number> => {
  if (estacionIds?.length === 0) return 0;
  let q = tx
    .selectFrom('estacion as e')
    .innerJoin('poligono as p', 'p.id', 'e.poligono_id')
    .select([
      'e.id',
      'e.codigo',
      'e.zona_utm',
      sql<number | null>`e.este::float8`.as('este'),
      sql<number | null>`e.norte::float8`.as('norte'),
      sql<number>`ST_Y(e.geom)`.as('lat'),
      sql<number>`ST_X(e.geom)`.as('lon'),
      sql<number>`round(ST_Distance(p.geom::geography, e.geom::geography))::int`.as('distancia_m'),
      'p.id as poligono_id',
      'p.nombre as poligono_nombre',
    ])
    .where('e.proyecto_id', '=', proyectoId)
    .where(sql<boolean>`NOT ST_Covers(p.geom, e.geom)`);
  if (estacionIds !== null) q = q.where('e.id', 'in', estacionIds);
  const fuera = await q.execute();
  let nuevas = 0;
  for (const e of fuera) {
    const r = await tx
      .insertInto('alerta')
      .values({
        id: generarId(),
        proyecto_id: proyectoId,
        tipo: 'tecnica',
        origen: 'sistema',
        brigada_id: null,
        estacion_id: e.id,
        titulo: `${e.codigo}: fuera del polígono «${e.poligono_nombre}»`,
        descripcion: [
          `Las coordenadas de la estación quedan a ${String(e.distancia_m)} m fuera del polígono asignado.`,
          e.zona_utm === null || e.este === null || e.norte === null
            ? `Posición: ${e.lat.toFixed(6)}, ${e.lon.toFixed(6)}.`
            : `UTM ${e.zona_utm} · E ${String(e.este)} · N ${String(e.norte)}.`,
          'Revise las coordenadas de A01 o el polígono asignado.',
        ].join('\n'),
        clave_dedup: `poligono:${e.id}:${e.poligono_id}:${e.lat.toFixed(6)},${e.lon.toFixed(6)}`,
        creado_por: usuarioId,
      })
      .onConflict((oc) =>
        oc.columns(['proyecto_id', 'clave_dedup']).where('clave_dedup', 'is not', null).doNothing(),
      )
      .executeTakeFirst();
    nuevas += Number(r.numInsertedOrUpdatedRows ?? 0);
  }
  return nuevas;
};

export const cargarKmz = async (
  db: Db,
  actor: Actor,
  proyectoId: string,
  archivo: { nombre: string; datos: Buffer },
  opciones: { nombre: string | null; asignarDentro: boolean },
) => {
  exigirGlobal(actor, 'configurar_proyecto');
  await existeProyecto(db, proyectoId);
  const leido = leerKmz(archivo.datos);
  return db.transaction().execute(async (tx) => {
    const capaId = generarId();
    await tx
      .insertInto('capa')
      .values({
        id: capaId,
        proyecto_id: proyectoId,
        nombre:
          (opciones.nombre ?? archivo.nombre.replace(/\.km[lz]$/i, '')).slice(0, 120) || 'Capa',
        archivo_nombre: archivo.nombre,
        archivo_sha256: createHash('sha256').update(archivo.datos).digest('hex'),
        archivo_bytes: archivo.datos.length,
        archivo: archivo.datos,
        creado_por: actor.usuarioId,
      })
      .execute();
    const ids: string[] = [];
    for (const [orden, p] of leido.poligonos.entries()) {
      const id = generarId();
      ids.push(id);
      await tx
        .insertInto('poligono')
        .values({
          id,
          capa_id: capaId,
          proyecto_id: proyectoId,
          nombre: p.nombre,
          orden,
          geom: geomSql(p.geometria),
          creado_por: actor.usuarioId,
        })
        .execute();
    }
    let asignadas = 0;
    if (opciones.asignarDentro) {
      // Solo estaciones sin polígono: nunca se pisa una asignación hecha a mano.
      const r = await sql`
        UPDATE app.estacion e
           SET poligono_id = (
                 SELECT p.id FROM app.poligono p
                  WHERE p.capa_id = ${capaId} AND ST_Covers(p.geom, e.geom)
                  ORDER BY p.orden LIMIT 1),
               actualizado_por = ${actor.usuarioId}
         WHERE e.proyecto_id = ${proyectoId}
           AND e.poligono_id IS NULL
           AND EXISTS (SELECT 1 FROM app.poligono p
                        WHERE p.capa_id = ${capaId} AND ST_Covers(p.geom, e.geom))`.execute(tx);
      asignadas = Number(r.numAffectedRows ?? 0);
    }
    return {
      capa_id: capaId,
      poligonos: ids.length,
      ignorados: leido.ignorados,
      estaciones_asignadas: asignadas,
    };
  });
};

export const listarCapas = async (
  db: Db,
  actor: Actor,
  proyectoId: string,
): Promise<CapaProyecto[]> => {
  await exigirLectura(db, actor, proyectoId);
  const filas = await db
    .selectFrom('capa as c')
    .leftJoin('usuario as u', 'u.id', 'c.creado_por')
    .select([
      'c.id',
      'c.nombre',
      'c.archivo_nombre',
      'c.creado_en',
      'u.nombre as cargado_por_nombre',
      (eb) =>
        eb
          .selectFrom('poligono')
          .select(sql<number>`count(*)::int`.as('n'))
          .whereRef('poligono.capa_id', '=', 'c.id')
          .as('poligonos'),
    ])
    .where('c.proyecto_id', '=', proyectoId)
    .orderBy('c.creado_en', 'desc')
    .execute();
  return filas.map((c) => ({
    id: c.id,
    nombre: c.nombre,
    archivo_nombre: c.archivo_nombre,
    poligonos: c.poligonos ?? 0,
    creado_en: new Date(c.creado_en).toISOString(),
    cargado_por_nombre: c.cargado_por_nombre,
  }));
};

/** Polígonos con su GeoJSON (simplificado a ~1 m) y el conteo de estaciones dentro y fuera. */
export const poligonosDelProyecto = async (db: Db, proyectoId: string) => {
  const filas = await db
    .selectFrom('poligono as p')
    .innerJoin('capa as c', 'c.id', 'p.capa_id')
    .select([
      'p.id',
      'p.capa_id',
      'c.nombre as capa_nombre',
      'p.nombre',
      sql<string>`ST_AsGeoJSON(ST_Multi(ST_SimplifyPreserveTopology(p.geom, 0.00001)), 6)`.as(
        'geojson',
      ),
      (eb) =>
        eb
          .selectFrom('estacion as e')
          .select(sql<number>`count(*)::int`.as('n'))
          .whereRef('e.poligono_id', '=', 'p.id')
          .as('estaciones'),
      (eb) =>
        eb
          .selectFrom('estacion as e')
          .select(sql<number>`count(*)::int`.as('n'))
          .whereRef('e.poligono_id', '=', 'p.id')
          .where(sql<boolean>`NOT ST_Covers(p.geom, e.geom)`)
          .as('fuera'),
    ])
    .where('p.proyecto_id', '=', proyectoId)
    .orderBy('c.creado_en')
    .orderBy('p.orden')
    .execute();
  return filas.flatMap((p): PoligonoProyecto[] => {
    const g = multiPoligonoSchema.safeParse(JSON.parse(p.geojson));
    return g.success
      ? [
          {
            id: p.id,
            capa_id: p.capa_id,
            capa_nombre: p.capa_nombre,
            nombre: p.nombre,
            geometria: g.data,
            estaciones: p.estaciones ?? 0,
            fuera: p.fuera ?? 0,
          },
        ]
      : [];
  });
};

export const listarPoligonos = async (db: Db, actor: Actor, proyectoId: string) => {
  await exigirLectura(db, actor, proyectoId);
  return poligonosDelProyecto(db, proyectoId);
};

export const estacionesConPoligono = async (
  db: Db,
  actor: Actor,
  proyectoId: string,
): Promise<EstacionEnPoligono[]> => {
  await exigirLectura(db, actor, proyectoId);
  const filas = await db
    .selectFrom('estacion as e')
    .leftJoin('poligono as p', 'p.id', 'e.poligono_id')
    .select([
      'e.id',
      'e.codigo',
      sql<number>`ST_Y(e.geom)`.as('lat'),
      sql<number>`ST_X(e.geom)`.as('lon'),
      'e.poligono_id',
      sql<boolean | null>`CASE WHEN p.id IS NULL THEN NULL ELSE ST_Covers(p.geom, e.geom) END`.as(
        'dentro',
      ),
    ])
    .where('e.proyecto_id', '=', proyectoId)
    .orderBy('e.codigo')
    .execute();
  return filas.map((e) => ({
    estacion_id: e.id,
    codigo: e.codigo,
    lat: e.lat,
    lon: e.lon,
    poligono_id: e.poligono_id,
    dentro: e.dentro,
  }));
};

export const asignarPoligono = async (
  db: Db,
  actor: Actor,
  proyectoId: string,
  d: AsignarPoligono,
) => {
  exigirGlobal(actor, 'configurar_proyecto');
  await existeProyecto(db, proyectoId);
  if (d.poligono_id !== null) {
    const p = await db
      .selectFrom('poligono')
      .select('id')
      .where('id', '=', d.poligono_id)
      .where('proyecto_id', '=', proyectoId)
      .executeTakeFirst();
    if (p === undefined) throw noEncontrado('El polígono');
  }
  const ids = [...new Set(d.estacion_ids)];
  return db.transaction().execute(async (tx) => {
    const r = await tx
      .updateTable('estacion')
      .set({ poligono_id: d.poligono_id, actualizado_por: actor.usuarioId })
      .where('proyecto_id', '=', proyectoId)
      .where('id', 'in', ids)
      .executeTakeFirst();
    if (Number(r.numUpdatedRows) !== ids.length) {
      throw new ProblemaHttp(
        422,
        'ESTACION_AJENA',
        'Alguna estación no existe o no pertenece a este proyecto.',
      );
    }
    const alertas = await alertarEstacionesFuera(tx, proyectoId, ids, actor.usuarioId);
    const fuera =
      d.poligono_id === null
        ? []
        : await tx
            .selectFrom('estacion as e')
            .innerJoin('poligono as p', 'p.id', 'e.poligono_id')
            .select('e.codigo')
            .where('e.id', 'in', ids)
            .where(sql<boolean>`NOT ST_Covers(p.geom, e.geom)`)
            .orderBy('e.codigo')
            .execute();
    return {
      asignadas: ids.length,
      fuera: fuera.map((f) => f.codigo),
      alertas_nuevas: alertas,
    };
  });
};
