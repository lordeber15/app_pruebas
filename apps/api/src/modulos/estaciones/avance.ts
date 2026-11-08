import {
  avanceEstacion,
  configuracionMetodoSchema,
  fechaEnZona,
  metodoCompleto,
  puedeIntentar,
  type AvanceEstacion,
  type EstadoEjecucionAvance,
  type MetodoEnEstacion,
} from '@campo/core';
import { elegirItemParaMetodo, versionVigenteDe, type Db } from '@campo/db';
import { sql, type Kysely } from 'kysely';
import type { Actor } from '../../plataforma/sesion.ts';
import {
  brigadasVisibles,
  noEncontrado,
  soloLoSuyo,
  veTodosLosProyectos,
} from '../alcance/autorizacion.ts';
import { avanceDeMetodo } from '../seguimiento/avance.ts';

/**
 * Avance por estación para el mapa y la tabla de estaciones (decisión del usuario, 2026-11-08):
 * métodos completos / métodos aplicables, con `avanceEstacion` de core. Los métodos aplicables
 * son las reservas estación × método (los que se presentan como método, RN-28); el avance de
 * cada uno suma las ejecuciones de todos los usuarios (RN-19). Sin ejecuciones no se afirma 0 %
 * (RN-37). Nada se promedia (P-11).
 *
 * Alcance igual que el seguimiento: Coordinación y JdP todo el proyecto; JdB y Supervisor las
 * estaciones de su brigada; el especialista además solo cuenta sus propias ejecuciones.
 */

const ESTADOS_AVANCE: readonly EstadoEjecucionAvance[] = [
  'en_curso',
  'evidencia_pendiente',
  'completa',
  'parcial',
  'validada',
  'observada',
];
const comoEstado = (e: string): EstadoEjecucionAvance | undefined =>
  ESTADOS_AVANCE.find((x) => x === e);

/** Zona de los horarios y de «hoy» (CLAUDE.md, decisiones sobre huecos). */
const ZONA_PROYECTO = 'America/Lima';

export interface MetodoAvance {
  readonly metodo_id: string;
  readonly metodo_codigo: string;
  readonly metodo_nombre: string;
  readonly especialidad_nombre: string;
  /** `null` sin objetivo numérico o sin ejecuciones. */
  readonly porcentaje: number | null;
  readonly completo: boolean;
  readonly ejecuciones: number;
}

export interface EstacionAvance {
  readonly id: string;
  readonly codigo: string;
  readonly lat: number;
  readonly lon: number;
  readonly za_ef: string | null;
  readonly brigada_id: string | null;
  readonly brigada: string | null;
  readonly fecha_programada: string | null;
  readonly reprogramada: boolean;
  readonly avance: AvanceEstacion;
  readonly metodos: readonly MetodoAvance[];
}

export const verAvanceEstaciones = async (
  db: Db,
  actor: Actor,
  proyectoId: string,
  ahora: Date = new Date(),
): Promise<{ generado_en: string; hoy: string; estaciones: EstacionAvance[] }> => {
  const proyecto = await db
    .selectFrom('proyecto')
    .select('id')
    .where('id', '=', proyectoId)
    .executeTakeFirst();
  if (proyecto === undefined) throw noEncontrado('El proyecto');
  const global = veTodosLosProyectos(actor);
  const mapa = await brigadasVisibles(db, actor, proyectoId);
  const visibles = [...mapa].filter(([, rol]) => puedeIntentar(rol, 'consultar_seguimiento'));
  if (visibles.length === 0 && !global) throw noEncontrado('El proyecto');
  const hoy = fechaEnZona(ahora, ZONA_PROYECTO);
  const respuesta = { generado_en: ahora.toISOString(), hoy, estaciones: [] };
  const ids = visibles.map(([id]) => id);
  if (ids.length === 0 && !global) return respuesta;
  const soloPropias = new Set(visibles.filter(([, rol]) => soloLoSuyo(rol)).map(([id]) => id));

  // Cronograma vigente: la fila que programa cada estación (la regular primero).
  const vigente = await versionVigenteDe(db as unknown as Kysely<unknown>, proyectoId);
  const items =
    vigente === undefined
      ? []
      : await db
          .selectFrom('cronograma_item as i')
          .innerJoin('brigada as b', 'b.id', 'i.brigada_id')
          .select([
            'i.id',
            'i.estacion_id',
            'i.brigada_id as brigada',
            sql<string>`coalesce(b.codigo, b.nombre)`.as('brigada_nombre'),
            sql<string>`to_char(i.fecha, 'YYYY-MM-DD')`.as('fecha'),
            'i.actividad_especial as especial',
            'i.estado_fila',
          ])
          .where('i.version_id', '=', vigente)
          .where('i.estacion_id', 'is not', null)
          .$if(!global, (q) => q.where('i.brigada_id', 'in', ids))
          .orderBy('i.fecha')
          .orderBy('i.orden')
          .execute();

  const reservas = await db
    .selectFrom('reserva as r')
    .innerJoin('metodo as m', 'm.id', 'r.metodo_id')
    .leftJoin('especialidad as s', 's.id', 'm.especialidad_id')
    .select([
      'r.estacion_id',
      'r.brigada_id',
      'm.id as metodo_id',
      'm.codigo',
      'm.nombre',
      'm.config',
      'm.orden',
      's.nombre as especialidad_nombre',
      's.orden as especialidad_orden',
    ])
    .where('r.proyecto_id', '=', proyectoId)
    .where('r.estacion_id', 'is not', null)
    // Los métodos aplicables no incluyen los CONDICIONAL descartados en la web.
    .where('r.estado', '<>', 'descartada')
    .$if(!global, (q) => q.where('r.brigada_id', 'in', ids))
    .execute();

  let qEjec = db
    .selectFrom('ejecucion as x')
    .leftJoin(
      (eb) =>
        eb
          .selectFrom('unidad')
          .select(['ejecucion_id', sql<number>`count(*)::int`.as('n')])
          .where('estado', '=', 'cerrada')
          .groupBy('ejecucion_id')
          .as('u'),
      (j) => j.onRef('u.ejecucion_id', '=', 'x.id'),
    )
    .select([
      'x.estacion_id',
      'x.metodo_id',
      'x.estado',
      'x.datos',
      sql<number | null>`x.objetivo_campo::float8`.as('objetivo_campo'),
      'x.abierta_en',
      sql<number>`coalesce(u.n, 0)`.as('unidades_cerradas'),
    ])
    .where('x.proyecto_id', '=', proyectoId)
    .$if(!global, (q) => q.where('x.brigada_id', 'in', ids))
    .orderBy('x.abierta_en');
  if (soloPropias.size > 0) {
    qEjec = qEjec.where((eb) =>
      eb.or([
        eb('x.brigada_id', 'not in', [...soloPropias]),
        eb('x.usuario_id', '=', actor.usuarioId),
      ]),
    );
  }
  const ejecuciones = await qEjec.execute();

  const estacionesVisibles = new Set<string>([
    ...items.flatMap((i) => (i.estacion_id === null ? [] : [i.estacion_id])),
    ...reservas.flatMap((r) => (r.estacion_id === null ? [] : [r.estacion_id])),
  ]);
  let qEst = db
    .selectFrom('estacion')
    .select([
      'id',
      'codigo',
      'region',
      'uv',
      'za_ef',
      sql<number>`ST_Y(geom)`.as('lat'),
      sql<number>`ST_X(geom)`.as('lon'),
    ])
    .where('proyecto_id', '=', proyectoId)
    .orderBy('codigo');
  if (!global) {
    if (estacionesVisibles.size === 0) return respuesta;
    qEst = qEst.where('id', 'in', [...estacionesVisibles]);
  }
  const estaciones = await qEst.execute();

  const configs = new Map<string, ReturnType<typeof configuracionMetodoSchema.safeParse>>();
  const configDe = (metodoId: string, config: unknown) => {
    let c = configs.get(metodoId);
    if (c === undefined) {
      c = configuracionMetodoSchema.safeParse(config);
      configs.set(metodoId, c);
    }
    return c.success ? c.data : null;
  };

  return {
    ...respuesta,
    estaciones: estaciones.map((e) => {
      const propias = items.filter((i) => i.estacion_id === e.id);
      const item = elegirItemParaMetodo(propias, '');
      const metodos = reservas
        .filter((r) => r.estacion_id === e.id)
        .sort(
          (a, b) => (a.especialidad_orden ?? 0) - (b.especialidad_orden ?? 0) || a.orden - b.orden,
        );
      const evaluados: { m: MetodoEnEstacion; fila: MetodoAvance }[] = metodos.map((r) => {
        const xs = ejecuciones.filter((x) => x.estacion_id === e.id && x.metodo_id === r.metodo_id);
        const { avance } = avanceDeMetodo(configDe(r.metodo_id, r.config), e, xs);
        const m: MetodoEnEstacion = {
          metodo: r.codigo,
          avance,
          ejecuciones: xs.flatMap((x) => {
            const s = comoEstado(x.estado);
            return s === undefined ? [] : [s];
          }),
        };
        return {
          m,
          fila: {
            metodo_id: r.metodo_id,
            metodo_codigo: r.codigo,
            metodo_nombre: r.nombre,
            especialidad_nombre: r.especialidad_nombre ?? '',
            porcentaje: xs.length === 0 ? null : avance.porcentaje,
            completo: metodoCompleto(m),
            ejecuciones: xs.length,
          },
        };
      });
      const reprogramada = propias.some((i) => i.estado_fila === 'reprogramada');
      return {
        id: e.id,
        codigo: e.codigo,
        lat: e.lat,
        lon: e.lon,
        za_ef: e.za_ef,
        brigada_id: item?.brigada ?? null,
        brigada: item?.brigada_nombre ?? null,
        fecha_programada: item?.fecha ?? null,
        reprogramada,
        avance: avanceEstacion(
          evaluados.map((x) => x.m),
          { fechaProgramada: item?.fecha ?? null, hoy, reprogramada },
        ),
        metodos: evaluados.map((x) => x.fila),
      };
    }),
  };
};
