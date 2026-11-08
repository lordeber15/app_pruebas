/**
 * Carga la configuración del proyecto TOCE desde las semillas de `packages/db/semillas/toce`:
 *
 * - `d01-metodos.json`: especialidades y los 33 métodos de D01 (curado por GENIA, fiel al texto).
 * - `a01-programacion.json`: 102 estaciones con atributos y 183 filas de programación de A01,
 *   convertidas del Excel sin inferencias.
 *
 * Es idempotente: volver a ejecutarla actualiza la configuración vigente (si ninguna ejecución la
 * usa), no duplica estaciones, brigadas, cronograma ni reservas, y respeta las decisiones nominales
 * tomadas en la web sobre la matriz estación–método (RN-28, P-01).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  crearGeneradorUuidV7,
  resolverAplicabilidad,
  semillaD01Schema,
  type ConfiguracionMetodo,
  type Region,
  type TipoBrigada,
} from '@campo/core';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';
import { elegirItemParaMetodo, METODOS_POR_ACTIVIDAD_ESPECIAL } from '../cronograma.ts';

const CARPETA_SEMILLAS = path.join(import.meta.dirname, '..', '..', 'semillas', 'toce');

const SRID_POR_ZONA: Readonly<Record<string, number>> = { '17 S': 32717, '18 S': 32718 };

const region = z.enum(['COSTA', 'SIERRA', 'SELVA']);
const itemA01 = z.object({
  actividad_especial: z.string().nullable(),
  tipo_programacion: z.enum(['regular', 'complementaria', 'especial']).nullable(),
  region: z.string().nullable(),
  brigada: z.string().min(1),
  fecha: z.iso.date(),
  tipo_actividad: z.enum([
    'estacion',
    'movilizacion',
    'traslado',
    'desmovilizacion',
    'feriado',
    'procesamiento',
    'otro',
  ]),
  estacion: z.string().nullable(),
  detalle: z.string().nullable(),
  estado: z.enum(['ok', 'pendiente_validacion']),
});
const semillaA01Schema = z.object({
  _fuente: z.string(),
  estaciones: z
    .array(
      z.object({
        codigo: z.string().min(1),
        zona_utm: z.string().min(1),
        este: z.number(),
        norte: z.number(),
        aid_aii: z.enum(['AID', 'AII']),
        uv: z.string().min(1),
        za_ef: z.string().nullable(),
      }),
    )
    .min(1),
  programacion: z.array(itemA01).min(1),
});
type SemillaA01 = z.infer<typeof semillaA01Schema>;

export interface OpcionesCargaToce {
  readonly proyectoId: string;
  /** Usuario que queda como `creado_por`; `null` cuando se carga desde la consola. */
  readonly usuarioId?: string | null;
}

export interface ResumenCargaToce {
  readonly configuracion_numero: number;
  readonly especialidades: number;
  readonly metodos: number;
  readonly estaciones: number;
  readonly brigadas: number;
  readonly cronograma_items: number;
  readonly estacion_metodo: number;
  readonly estacion_metodo_pendientes: number;
  readonly reservas: number;
}

const uuid = crearGeneradorUuidV7((n) => globalThis.crypto.getRandomValues(new Uint8Array(n)));

// Las semillas viven en el repositorio: rutas fijas, no elegidas por el usuario.
const RUTA_D01 = path.join(CARPETA_SEMILLAS, 'd01-metodos.json');
const RUTA_A01 = path.join(CARPETA_SEMILLAS, 'a01-programacion.json');

const leerJson = async (ruta: string): Promise<unknown> =>
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- RUTA_D01 y RUTA_A01 son fijas dentro del repositorio; no hay entrada del usuario.
  JSON.parse(await fs.readFile(ruta, 'utf8')) as unknown;

/** Semilla D01 validada por el esquema de core. */
export const leerSemillaD01 = async () => semillaD01Schema.parse(await leerJson(RUTA_D01));

/** Semilla A01 (estaciones y programación) validada. */
export const leerSemillaA01 = async (): Promise<SemillaA01> =>
  semillaA01Schema.parse(await leerJson(RUTA_A01));

const tipoBrigada = (item: SemillaA01['programacion'][number]): TipoBrigada =>
  item.actividad_especial !== null
    ? 'especial'
    : item.tipo_programacion === 'complementaria'
      ? 'complementaria'
      : 'regular';

const regionDe = (valor: string | null): Region | null => {
  const r = region.safeParse(valor);
  return r.success ? r.data : null;
};

type Fila<T> = { rows: T[] };

export const cargarToce = async (
  db: Kysely<unknown>,
  opciones: OpcionesCargaToce,
): Promise<ResumenCargaToce> => {
  const d01 = await leerSemillaD01();
  const a01 = await leerSemillaA01();
  const proyectoId = opciones.proyectoId;
  const usuarioId = opciones.usuarioId ?? null;

  return db.transaction().execute(async (trx) => {
    // 1. Especialidades.
    const especialidadId = new Map<string, string>();
    for (const e of d01.especialidades) {
      const r = await sql<{ id: string }>`
        INSERT INTO app.especialidad (id, proyecto_id, codigo, nombre, es_fauna, orden, creado_por)
        VALUES (${uuid()}, ${proyectoId}, ${e.codigo}, ${e.nombre}, ${e.es_fauna}, ${e.orden}, ${usuarioId})
        ON CONFLICT (proyecto_id, codigo) DO UPDATE
          SET nombre = EXCLUDED.nombre, es_fauna = EXCLUDED.es_fauna, orden = EXCLUDED.orden
        RETURNING id`.execute(trx);
      especialidadId.set(e.codigo, r.rows[0]?.id ?? '');
    }
    const esFauna = new Map(d01.especialidades.map((e) => [e.codigo, e.es_fauna]));

    // 2. Configuración metodológica vigente: se reutiliza si tiene el mismo origen y ninguna
    //    ejecución la usa; si no, se crea una versión nueva y la anterior pasa a histórica.
    const origen = `${d01.fuente} (${d01.version})`;
    const vigente = (
      await sql<{ id: string; numero: number; origen: string; en_uso: boolean }>`
        SELECT c.id, c.numero, c.origen,
               EXISTS (SELECT 1 FROM app.ejecucion e JOIN app.metodo m ON m.id = e.metodo_id
                        WHERE m.configuracion_id = c.id) AS en_uso
          FROM app.configuracion_metodologica c
         WHERE c.proyecto_id = ${proyectoId} AND c.estado = 'vigente'`.execute(trx)
    ).rows[0];
    let configuracionId: string;
    let numero: number;
    if (vigente !== undefined && vigente.origen === origen && !vigente.en_uso) {
      configuracionId = vigente.id;
      numero = vigente.numero;
    } else {
      await sql`UPDATE app.configuracion_metodologica SET estado = 'historica'
                 WHERE proyecto_id = ${proyectoId} AND estado = 'vigente'`.execute(trx);
      numero = (vigente?.numero ?? 0) + 1;
      configuracionId = uuid();
      await sql`
        INSERT INTO app.configuracion_metodologica (id, proyecto_id, numero, origen, estado, creado_por)
        VALUES (${configuracionId}, ${proyectoId}, ${numero}, ${origen}, 'vigente', ${usuarioId})`.execute(
        trx,
      );
    }

    // 3. Métodos (config completa en jsonb, validada por core).
    const metodoId = new Map<string, string>();
    const metodos = new Map<string, ConfiguracionMetodo>();
    for (const [orden, m] of d01.metodos.entries()) {
      const r = await sql<{ id: string }>`
        INSERT INTO app.metodo (id, configuracion_id, especialidad_id, codigo, nombre, clase,
                                tipo_geometria, requiere_track, orden, config, creado_por)
        VALUES (${uuid()}, ${configuracionId}, ${especialidadId.get(m.especialidad) ?? null}, ${m.codigo},
                ${m.nombre}, ${m.clase}, ${m.geometria.tipo}, ${m.track}, ${orden},
                ${JSON.stringify(m)}::jsonb, ${usuarioId})
        ON CONFLICT (configuracion_id, codigo) DO UPDATE
          SET especialidad_id = EXCLUDED.especialidad_id, nombre = EXCLUDED.nombre,
              clase = EXCLUDED.clase, tipo_geometria = EXCLUDED.tipo_geometria,
              requiere_track = EXCLUDED.requiere_track, orden = EXCLUDED.orden, config = EXCLUDED.config
        RETURNING id`.execute(trx);
      metodoId.set(m.codigo, r.rows[0]?.id ?? '');
      metodos.set(m.codigo, m);
    }

    // 4. Campaña activa (fechas de A01).
    const fechas = a01.programacion.map((p) => p.fecha).sort();
    const campaniaExistente = (
      await sql<{
        id: string;
      }>`SELECT id FROM app.campania WHERE proyecto_id = ${proyectoId} AND estado = 'activa'`.execute(
        trx,
      )
    ).rows[0];
    const campaniaId = campaniaExistente?.id ?? uuid();
    if (campaniaExistente === undefined) {
      await sql`
        INSERT INTO app.campania (id, proyecto_id, nombre, fecha_inicio, fecha_fin, creado_por)
        VALUES (${campaniaId}, ${proyectoId}, ${'Campaña TOCE'}, ${fechas[0] ?? null}, ${fechas.at(-1) ?? null}, ${usuarioId})`.execute(
        trx,
      );
    }

    // 5. Brigadas (A01: COSTA, SIERRA 1–4, SELVA 1–4, BC 2, BC 3, B1–B4).
    const brigadaId = new Map<string, string>();
    for (const item of a01.programacion) {
      if (brigadaId.has(item.brigada)) continue;
      const tipo = tipoBrigada(item);
      const r = await sql<{ id: string }>`
        INSERT INTO app.brigada (id, proyecto_id, nombre, codigo, region, tipo, campania_id, creado_por)
        VALUES (${uuid()}, ${proyectoId}, ${item.brigada}, ${item.brigada},
                ${tipo === 'regular' ? regionDe(item.region) : null}, ${tipo}, ${campaniaId}, ${usuarioId})
        ON CONFLICT (proyecto_id, codigo) WHERE codigo IS NOT NULL DO UPDATE
          SET region = EXCLUDED.region, tipo = EXCLUDED.tipo, campania_id = EXCLUDED.campania_id
        RETURNING id`.execute(trx);
      brigadaId.set(item.brigada, r.rows[0]?.id ?? '');
    }

    // 6. Estaciones con sus atributos (RN-29). La región es la de su programación regular.
    const regionEstacion = new Map<string, Region>();
    for (const p of a01.programacion) {
      if (p.estacion !== null && tipoBrigada(p) === 'regular') {
        const r = regionDe(p.region);
        if (r !== null && !regionEstacion.has(p.estacion)) regionEstacion.set(p.estacion, r);
      }
    }
    const estacionId = new Map<string, string>();
    for (const e of a01.estaciones) {
      const srid = SRID_POR_ZONA[e.zona_utm];
      if (srid === undefined) throw new Error(`Zona UTM no prevista en A01: ${e.zona_utm}`);
      const r = await sql<{ id: string }>`
        INSERT INTO app.estacion (id, proyecto_id, codigo, geom, zona_utm, este, norte, aid_aii, uv, za_ef, region, creado_por)
        VALUES (${uuid()}, ${proyectoId}, ${e.codigo},
                ST_Transform(ST_SetSRID(ST_MakePoint(${e.este}, ${e.norte}), ${srid}), 4326),
                ${e.zona_utm}, ${e.este}, ${e.norte}, ${e.aid_aii}, ${e.uv}, ${e.za_ef},
                ${regionEstacion.get(e.codigo) ?? null}, ${usuarioId})
        ON CONFLICT (proyecto_id, codigo) DO UPDATE
          SET geom = EXCLUDED.geom, zona_utm = EXCLUDED.zona_utm, este = EXCLUDED.este, norte = EXCLUDED.norte,
              aid_aii = EXCLUDED.aid_aii, uv = EXCLUDED.uv, za_ef = EXCLUDED.za_ef, region = EXCLUDED.region
        RETURNING id`.execute(trx);
      estacionId.set(e.codigo, r.rows[0]?.id ?? '');
    }

    // 7. Cronograma base (versión 1, vigente). Si ya existe, no se toca (RN-35).
    let versionId = (
      await sql<{
        id: string;
      }>`SELECT id FROM app.cronograma_version WHERE campania_id = ${campaniaId} AND es_base`.execute(
        trx,
      )
    ).rows[0]?.id;
    const itemPorEstacion = new Map<
      string,
      { id: string; brigada: string; fecha: string; especial: string | null }[]
    >();
    if (versionId === undefined) {
      versionId = uuid();
      await sql`
        INSERT INTO app.cronograma_version (id, campania_id, numero, estado, es_base, aprobado_por, aprobado_en, creado_por)
        VALUES (${versionId}, ${campaniaId}, 1, 'vigente', true, ${usuarioId}, now(), ${usuarioId})`.execute(
        trx,
      );
      for (const [orden, p] of a01.programacion.entries()) {
        const itemId = uuid();
        const estId = p.estacion === null ? null : (estacionId.get(p.estacion) ?? null);
        if (p.estacion !== null && estId === null)
          throw new Error(`Estación de A01 sin fila maestra: ${p.estacion}`);
        await sql`
          INSERT INTO app.cronograma_item (id, version_id, brigada_id, fecha, tipo_actividad, estacion_id, detalle,
                                           estado_fila, actividad_especial, orden, creado_por)
          VALUES (${itemId}, ${versionId}, ${brigadaId.get(p.brigada) ?? null}, ${p.fecha}, ${p.tipo_actividad},
                  ${estId}, ${p.detalle}, ${p.estado}, ${p.actividad_especial}, ${orden}, ${usuarioId})`.execute(
          trx,
        );
      }
    }
    const itemsVigentes = (
      await sql<{
        id: string;
        estacion_id: string;
        brigada_id: string;
        fecha: string;
        actividad_especial: string | null;
      }>`
        SELECT i.id, i.estacion_id, i.brigada_id, to_char(i.fecha, 'YYYY-MM-DD') AS fecha, i.actividad_especial
          FROM app.cronograma_item i
          JOIN app.cronograma_version v ON v.id = i.version_id
         WHERE v.campania_id = ${campaniaId} AND v.estado = 'vigente' AND i.estacion_id IS NOT NULL
         ORDER BY i.fecha, i.orden`.execute(trx)
    ).rows;
    for (const i of itemsVigentes) {
      const lista = itemPorEstacion.get(i.estacion_id) ?? [];
      lista.push({
        id: i.id,
        brigada: i.brigada_id,
        fecha: i.fecha,
        especial: i.actividad_especial,
      });
      itemPorEstacion.set(i.estacion_id, lista);
    }

    // 8. Matriz estación–método (RN-28). Las actividades especiales de A01 son decisión nominal.
    const nominales = new Set<string>();
    for (const i of itemsVigentes) {
      if (i.actividad_especial === null) continue;
      for (const codigo of METODOS_POR_ACTIVIDAD_ESPECIAL[i.actividad_especial] ?? []) {
        nominales.add(`${i.estacion_id}|${codigo}`);
      }
    }
    const atributos = new Map(a01.estaciones.map((e) => [e.codigo, e]));
    let filasMatriz = 0;
    let pendientes = 0;
    const habilitados: { estacion: string; metodo: string }[] = [];
    for (const [codigoEstacion, estId] of estacionId) {
      const e = atributos.get(codigoEstacion);
      if (e === undefined) continue;
      const estacion = {
        region: regionEstacion.get(codigoEstacion) ?? null,
        uv: e.uv,
        za_ef: e.za_ef,
      };
      for (const [codigoMetodo, m] of metodos) {
        const mId = metodoId.get(codigoMetodo) ?? '';
        const nominal = nominales.has(`${estId}|${codigoMetodo}`) ? { habilitado: true } : null;
        const a = resolverAplicabilidad(
          { clase: m.clase, condicion: m.aplicacion.condicion },
          esFauna.get(m.especialidad) ?? false,
          estacion,
          nominal,
        );
        await sql`
          INSERT INTO app.estacion_metodo (id, estacion_id, metodo_id, habilitado, origen, condicion_pendiente, creado_por)
          VALUES (${uuid()}, ${estId}, ${mId}, ${a.habilitado}, ${a.origen}, ${a.condicion_pendiente}, ${usuarioId})
          ON CONFLICT (estacion_id, metodo_id) DO UPDATE
            SET habilitado = EXCLUDED.habilitado, origen = EXCLUDED.origen, condicion_pendiente = EXCLUDED.condicion_pendiente
          WHERE app.estacion_metodo.origen <> 'nominal'`.execute(trx);
        filasMatriz += 1;
        if (a.condicion_pendiente) pendientes += 1;
        if (a.habilitado && a.presentacion === 'metodo')
          habilitados.push({ estacion: estId, metodo: codigoMetodo });
      }
    }

    // 9. Reservas estación × método programadas para la brigada del cronograma vigente.
    let reservas = 0;
    for (const h of habilitados) {
      const m = metodos.get(h.metodo);
      const item = elegirItemParaMetodo(itemPorEstacion.get(h.estacion) ?? [], h.metodo);
      const codigoEstacion =
        [...estacionId.entries()].find(([, id]) => id === h.estacion)?.[0] ?? '';
      const r = await sql<{ id: string }>`
        INSERT INTO app.reserva (id, proyecto_id, estacion_id, metodo_id, brigada_id,
                                 fecha_programada, cronograma_item_id, geom, titulo, estado, creado_por)
        SELECT ${uuid()}, ${proyectoId}, ${h.estacion}, ${metodoId.get(h.metodo) ?? null},
               ${item?.brigada ?? null}, ${item?.fecha ?? null}, ${item?.id ?? null}, e.geom,
               ${`${codigoEstacion} · ${m?.nombre ?? h.metodo}`}, ${item === undefined ? 'pendiente' : 'asignada'}, ${usuarioId}
          FROM app.estacion e WHERE e.id = ${h.estacion}
        ON CONFLICT (estacion_id, metodo_id) WHERE metodo_id IS NOT NULL DO NOTHING
        RETURNING id`.execute(trx);
      reservas += r.rows.length;
    }

    const cuenta = async (q: Promise<Fila<{ n: string }>>): Promise<number> =>
      Number((await q).rows[0]?.n ?? 0);
    return {
      configuracion_numero: numero,
      especialidades: d01.especialidades.length,
      metodos: d01.metodos.length,
      estaciones: estacionId.size,
      brigadas: brigadaId.size,
      cronograma_items: await cuenta(
        sql<{
          n: string;
        }>`SELECT count(*)::text AS n FROM app.cronograma_item WHERE version_id = ${versionId}`.execute(
          trx,
        ),
      ),
      estacion_metodo: filasMatriz,
      estacion_metodo_pendientes: pendientes,
      reservas,
    };
  });
};
