import {
  configuracionMetodoSchema,
  puedeIntentar,
  type Avance,
  type Objetivo,
} from '@campo/core';
import type { Db } from '@campo/db';
import { sql } from 'kysely';
import type { Actor } from '../../plataforma/sesion.ts';
import {
  brigadasVisibles,
  noEncontrado,
  soloLoSuyo,
  veTodosLosProyectos,
} from '../alcance/autorizacion.ts';
import { avanceDeMetodo } from './avance.ts';

/**
 * Dashboard de seguimiento (D02 §12, RF-W01, RN-37, RN-38, E-09).
 *
 * - **Avance elemental** por brigada × estación × método = esfuerzo ejecutado (suma de las
 *   ejecuciones de cada usuario, RN-19) / objetivo aplicable (D01, o el valor final definido en
 *   campo cuando D01 lo deja al especialista). Objetivo, esfuerzo y porcentaje los calcula core.
 * - **Sin agregados**: la ponderación por estación, brigada o proyecto está pendiente (P-11); no
 *   se calcula ningún promedio. Solo se cuentan ejecuciones por estado.
 * - **Sin datos ≠ 0 %** (RN-37): una fila sin ejecuciones recibidas se marca `sin_datos` y no
 *   lleva porcentaje. Cada brigada muestra su última sincronización.
 * - Alcance: Coordinación y JdP todas las brigadas; JdB y Supervisor la suya; el especialista
 *   solo sus propias ejecuciones (ERS §2.3).
 */

export interface FilaSeguimiento {
  readonly estacion_id: string;
  readonly estacion_codigo: string;
  readonly za_ef: string | null;
  readonly especialidad_codigo: string;
  readonly especialidad_nombre: string;
  readonly metodo_id: string;
  readonly metodo_codigo: string;
  readonly metodo_nombre: string;
  readonly clase: string;
  readonly fecha_programada: string | null;
  readonly objetivo: Objetivo;
  /** `null` mientras no llegue ninguna ejecución: nunca 0 % (RN-37). */
  readonly avance: Avance | null;
  readonly sin_datos: boolean;
  readonly ejecuciones: number;
  readonly por_estado: Readonly<Record<string, number>>;
  readonly ultima_actividad: string | null;
}

export const verSeguimiento = async (
  db: Db,
  actor: Actor,
  proyectoId: string,
  filtroBrigada: string | undefined,
) => {
  const proyecto = await db
    .selectFrom('proyecto')
    .select('id')
    .where('id', '=', proyectoId)
    .executeTakeFirst();
  if (proyecto === undefined) throw noEncontrado('El proyecto');
  const mapa = await brigadasVisibles(db, actor, proyectoId);
  const visibles = [...mapa].filter(([, rol]) => puedeIntentar(rol, 'consultar_seguimiento'));
  if (visibles.length === 0 && !veTodosLosProyectos(actor)) throw noEncontrado('El proyecto');
  const elegidas =
    filtroBrigada === undefined ? visibles : visibles.filter(([id]) => id === filtroBrigada);
  if (filtroBrigada !== undefined && elegidas.length === 0) throw noEncontrado('La brigada');
  const generado = new Date().toISOString();
  if (elegidas.length === 0) return { generado_en: generado, brigadas: [] };
  const ids = elegidas.map(([id]) => id);
  const soloPropias = new Set(elegidas.filter(([, rol]) => soloLoSuyo(rol)).map(([id]) => id));

  const brigadas = await db
    .selectFrom('brigada')
    .select(['id', 'codigo', 'nombre', 'region', 'tipo'])
    .where('id', 'in', ids)
    .orderBy(sql`coalesce(codigo, nombre)`)
    .execute();

  // Reservas programadas (estación × método) de cada brigada y ejecuciones recibidas.
  const reservas = await db
    .selectFrom('reserva as r')
    .select([
      'r.brigada_id',
      'r.estacion_id',
      'r.metodo_id',
      sql<string | null>`to_char(r.fecha_programada, 'YYYY-MM-DD')`.as('fecha'),
    ])
    .where('r.proyecto_id', '=', proyectoId)
    .where('r.brigada_id', 'in', ids)
    .where('r.metodo_id', 'is not', null)
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
      'x.id',
      'x.brigada_id',
      'x.estacion_id',
      'x.metodo_id',
      'x.usuario_id',
      'x.estado',
      'x.datos',
      sql<number | null>`x.objetivo_campo::float8`.as('objetivo_campo'),
      'x.abierta_en',
      'x.actualizado_en',
      sql<number>`coalesce(u.n, 0)`.as('unidades_cerradas'),
    ])
    .where('x.proyecto_id', '=', proyectoId)
    .where('x.brigada_id', 'in', ids);
  if (soloPropias.size > 0) {
    // Especialista: en sus brigadas solo lo suyo.
    qEjec = qEjec.where((eb) =>
      eb.or([
        eb('x.brigada_id', 'not in', [...soloPropias]),
        eb('x.usuario_id', '=', actor.usuarioId),
      ]),
    );
  }
  const ejecuciones = await qEjec.execute();

  const estacionIds = [
    ...new Set([
      ...reservas.flatMap((r) => (r.estacion_id === null ? [] : [r.estacion_id])),
      ...ejecuciones.map((x) => x.estacion_id),
    ]),
  ];
  const metodoIds = [
    ...new Set([
      ...reservas.flatMap((r) => (r.metodo_id === null ? [] : [r.metodo_id])),
      ...ejecuciones.map((x) => x.metodo_id),
    ]),
  ];
  const estaciones = new Map(
    estacionIds.length === 0
      ? []
      : (
          await db
            .selectFrom('estacion')
            .select(['id', 'codigo', 'region', 'uv', 'za_ef'])
            .where('id', 'in', estacionIds)
            .execute()
        ).map((e) => [e.id, e]),
  );
  const metodos = new Map(
    metodoIds.length === 0
      ? []
      : (
          await db
            .selectFrom('metodo as m')
            .innerJoin('especialidad as s', 's.id', 'm.especialidad_id')
            .select([
              'm.id',
              'm.codigo',
              'm.nombre',
              'm.clase',
              'm.config',
              'm.orden',
              's.codigo as especialidad_codigo',
              's.nombre as especialidad_nombre',
              's.orden as especialidad_orden',
            ])
            .where('m.id', 'in', metodoIds)
            .execute()
        ).map((m) => {
          const config = configuracionMetodoSchema.safeParse(m.config);
          return [m.id, { ...m, config: config.success ? config.data : null }];
        }),
  );

  // Última sincronización (RN-37): último evento recibido de los integrantes de la brigada, por
  // dispositivo. El especialista solo ve la de sus propios dispositivos.
  const sincronizaciones = await db
    .selectFrom('evento as e')
    .innerJoin('miembro_brigada as mb', (j) =>
      j.onRef('mb.usuario_id', '=', 'e.usuario_id').on('mb.estado', '=', 'activo'),
    )
    .select([
      'mb.brigada_id',
      'e.dispositivo_id',
      'e.usuario_id',
      sql<Date>`max(e.hora_servidor)`.as('ultima'),
    ])
    .where('mb.brigada_id', 'in', ids)
    .where('e.dispositivo_id', 'is not', null)
    .groupBy(['mb.brigada_id', 'e.dispositivo_id', 'e.usuario_id'])
    .execute();

  return {
    generado_en: generado,
    brigadas: brigadas.map((b) => {
      const propias = soloPropias.has(b.id);
      const disp = sincronizaciones
        .filter((s) => s.brigada_id === b.id && (!propias || s.usuario_id === actor.usuarioId))
        .map((s) => ({
          dispositivo_id: s.dispositivo_id ?? '',
          ultima_sincronizacion: new Date(s.ultima).toISOString(),
        }))
        .sort((x, y) => y.ultima_sincronizacion.localeCompare(x.ultima_sincronizacion));

      const claves = new Map<string, { estacion: string; metodo: string; fecha: string | null }>();
      for (const r of reservas) {
        if (r.brigada_id !== b.id || r.estacion_id === null || r.metodo_id === null) continue;
        claves.set(`${r.estacion_id}|${r.metodo_id}`, {
          estacion: r.estacion_id,
          metodo: r.metodo_id,
          fecha: r.fecha,
        });
      }
      const ejecucionesBrigada = ejecuciones.filter((x) => x.brigada_id === b.id);
      for (const x of ejecucionesBrigada) {
        const k = `${x.estacion_id}|${x.metodo_id}`;
        if (!claves.has(k))
          claves.set(k, { estacion: x.estacion_id, metodo: x.metodo_id, fecha: null });
      }

      const filas: { fila: FilaSeguimiento; orden: [string, number, number] }[] = [];
      for (const c of claves.values()) {
        const e = estaciones.get(c.estacion);
        const m = metodos.get(c.metodo);
        if (e === undefined || m === undefined) continue;
        const propiasFila = ejecucionesBrigada
          .filter((x) => x.estacion_id === c.estacion && x.metodo_id === c.metodo)
          .sort((x, y) => new Date(x.abierta_en).getTime() - new Date(y.abierta_en).getTime());
        // RN-38: el valor final definido en campo (bofedales) es el de la última ejecución que lo fijó.
        const { objetivo, avance } = avanceDeMetodo(m.config, e, propiasFila);
        const porEstado: Record<string, number> = {};
        for (const x of propiasFila) porEstado[x.estado] = (porEstado[x.estado] ?? 0) + 1;
        const ultima = propiasFila.reduce<Date | null>((u, x) => {
          const d = new Date(x.actualizado_en);
          return u === null || d > u ? d : u;
        }, null);
        filas.push({
          fila: {
            estacion_id: c.estacion,
            estacion_codigo: e.codigo,
            za_ef: e.za_ef,
            especialidad_codigo: m.especialidad_codigo,
            especialidad_nombre: m.especialidad_nombre,
            metodo_id: m.id,
            metodo_codigo: m.codigo,
            metodo_nombre: m.nombre,
            clase: m.clase,
            fecha_programada: c.fecha,
            objetivo,
            avance: propiasFila.length === 0 ? null : avance,
            sin_datos: propiasFila.length === 0,
            ejecuciones: propiasFila.length,
            por_estado: porEstado,
            ultima_actividad: ultima?.toISOString() ?? null,
          },
          orden: [`${c.fecha ?? '9999'}|${e.codigo}`, m.especialidad_orden, m.orden],
        });
      }
      filas.sort(
        (x, y) =>
          x.orden[0].localeCompare(y.orden[0]) ||
          x.orden[1] - y.orden[1] ||
          x.orden[2] - y.orden[2],
      );
      return {
        id: b.id,
        codigo: b.codigo,
        nombre: b.nombre,
        region: b.region,
        tipo: b.tipo,
        solo_propias: propias,
        ultima_sincronizacion: disp[0]?.ultima_sincronizacion ?? null,
        dispositivos: disp,
        filas: filas.map((f) => f.fila),
      };
    }),
  };
};
