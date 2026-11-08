import {
  CLASES_APLICABILIDAD,
  configuracionMetodoSchema,
  describirMetodo,
  estadoEnMatriz,
  puedeIntentar,
  REGIONES,
  rechazoDeDecision,
  type ClaseAplicabilidad,
  type DecisionEstacionMetodoDatos,
  type EstadoMatriz,
  type TipoControl,
} from '@campo/core';
import { sincronizarReservas, versionVigenteDe, type Db } from '@campo/db';
import type { Kysely } from 'kysely';
import { ProblemaHttp } from '../../plataforma/errores.ts';
import { generarId } from '../../plataforma/ids.ts';
import type { Actor } from '../../plataforma/sesion.ts';
import {
  brigadasVisibles,
  exigirGlobal,
  noEncontrado,
  soloLoSuyo,
  veTodosLosProyectos,
} from '../alcance/autorizacion.ts';

/**
 * Panel «Métodos a ejecutar» de una estación (decisión del usuario 2026-11-08; RN-28, P-01).
 *
 * - Ver: Coordinación y JdP todo; los miembros de una brigada que tiene la estación en el
 *   cronograma vigente o en una reserva (`consultar_seguimiento`). El especialista solo cuenta sus
 *   propias ejecuciones (ERS §2.3).
 * - Decidir (confirmar / descartar un CONDICIONAL): Coordinación y JdP (`cargar_configuracion`).
 *   La decisión es nominal (`origen = 'nominal'`): la rederivación por atributos no la pisa. Cada
 *   decisión queda en `estacion_metodo_decision` (solo inserción) con quién, cuándo y motivo.
 *   Nada se borra: descartar marca la reserva `descartada`; confirmar la crea o la reactiva.
 */

const comoKysely = (db: Db): Kysely<unknown> => db as unknown as Kysely<unknown>;
const comoClase = (c: string): ClaseAplicabilidad | undefined =>
  CLASES_APLICABILIDAD.find((x) => x === c);
const comoRegion = (r: string | null) => REGIONES.find((x) => x === r) ?? null;

/** Reglas de D01 que se resumen en el panel (el resto se ve al iniciar el método en el celular). */
const CLAVES_RESUMEN: ReadonlySet<string> = new Set([
  'objetivo',
  'za_ef',
  'confirmacion',
  'horario',
  'duracion',
  'tiempo_efectivo',
  'geometria',
  'track',
  'fotos_contexto',
  'fotos_metodologicas',
]);

export interface ReglaResumen {
  readonly clave: string;
  readonly etiqueta: string;
  readonly valor: string;
  readonly tipo_control: TipoControl | null;
}

export interface MetodoDeEstacion {
  readonly metodo_id: string;
  readonly codigo: string;
  readonly nombre: string;
  readonly clase: ClaseAplicabilidad;
  readonly estado: EstadoMatriz;
  /** De dónde sale el estado: clase, condición de D01 o decisión nominal. */
  readonly origen: 'clase' | 'condicion' | 'nominal' | null;
  /** Texto de aplicación de D01 (la condición, para los CONDICIONAL). */
  readonly condicion_d01: string;
  /** `null` si la configuración del método no es válida (no se inventan reglas). */
  readonly resumen_d01: readonly ReglaResumen[] | null;
  readonly reserva: { readonly id: string; readonly estado: string } | null;
  readonly ejecuciones: number;
  /** Se puede confirmar o descartar (solo CONDICIONAL); el actor además debe poder decidir. */
  readonly admite_decision: boolean;
  readonly decision: {
    readonly decision: 'confirmar' | 'descartar';
    readonly motivo: string;
    readonly por: string;
    readonly en: string;
  } | null;
  /** Última actualización de la fila de la matriz (decisión, carga o rederivación). */
  readonly actualizado_en: string | null;
}

export interface MetodosDeEstacion {
  readonly estacion: {
    readonly id: string;
    readonly codigo: string;
    readonly region: string | null;
    readonly uv: string | null;
    readonly za_ef: string | null;
  };
  readonly puede_decidir: boolean;
  /** CONDICIONAL con condición pendiente (P-01). */
  readonly pendientes: number;
  readonly especialidades: readonly {
    readonly id: string | null;
    readonly nombre: string;
    readonly metodos: readonly MetodoDeEstacion[];
  }[];
}

/**
 * Alcance de lectura. Devuelve si el actor solo ve lo suyo (especialista) o `null` si la
 * estación no está a su alcance.
 */
const alcanceLectura = async (
  db: Db,
  actor: Actor,
  proyectoId: string,
  estacionId: string,
): Promise<{ soloPropias: boolean } | null> => {
  if (veTodosLosProyectos(actor)) return { soloPropias: false };
  const mapa = await brigadasVisibles(db, actor, proyectoId);
  const visibles = [...mapa].filter(([, rol]) => puedeIntentar(rol, 'consultar_seguimiento'));
  if (visibles.length === 0) return null;
  const ids = visibles.map(([id]) => id);
  const vigente = await versionVigenteDe(comoKysely(db), proyectoId);
  const enCronograma =
    vigente === undefined
      ? []
      : await db
          .selectFrom('cronograma_item')
          .select('brigada_id')
          .where('version_id', '=', vigente)
          .where('estacion_id', '=', estacionId)
          .where('brigada_id', 'in', ids)
          .execute();
  const enReserva = await db
    .selectFrom('reserva')
    .select('brigada_id')
    .where('estacion_id', '=', estacionId)
    .where('brigada_id', 'in', ids)
    .execute();
  const brigadas = new Set(
    [...enCronograma, ...enReserva].flatMap((x) => (x.brigada_id === null ? [] : [x.brigada_id])),
  );
  if (brigadas.size === 0) return null;
  // Especialista en todas las brigadas que tienen la estación: solo sus ejecuciones.
  const soloPropias = [...brigadas].every((b) => {
    const rol = mapa.get(b);
    return rol !== undefined && soloLoSuyo(rol);
  });
  return { soloPropias };
};

export const verMetodosDeEstacion = async (
  db: Db,
  actor: Actor,
  estacionId: string,
): Promise<MetodosDeEstacion> => {
  const est = await db
    .selectFrom('estacion')
    .select(['id', 'proyecto_id', 'codigo', 'region', 'uv', 'za_ef'])
    .where('id', '=', estacionId)
    .executeTakeFirst();
  if (est === undefined) throw noEncontrado('La estación');
  const alcance = await alcanceLectura(db, actor, est.proyecto_id, estacionId);
  if (alcance === null) throw noEncontrado('La estación');

  const metodos = await db
    .selectFrom('metodo as m')
    .innerJoin('configuracion_metodologica as c', 'c.id', 'm.configuracion_id')
    .leftJoin('especialidad as s', 's.id', 'm.especialidad_id')
    .leftJoin('estacion_metodo as em', (j) =>
      j.onRef('em.metodo_id', '=', 'm.id').on('em.estacion_id', '=', estacionId),
    )
    .leftJoin('reserva as r', (j) =>
      j.onRef('r.metodo_id', '=', 'm.id').on('r.estacion_id', '=', estacionId),
    )
    .select([
      'm.id',
      'm.codigo',
      'm.nombre',
      'm.clase',
      'm.config',
      'm.orden',
      's.id as especialidad_id',
      's.nombre as especialidad_nombre',
      's.orden as especialidad_orden',
      'em.id as fila_id',
      'em.habilitado',
      'em.origen',
      'em.condicion_pendiente',
      'em.actualizado_en',
      'r.id as reserva_id',
      'r.estado as reserva_estado',
    ])
    .where('c.proyecto_id', '=', est.proyecto_id)
    .where('c.estado', '=', 'vigente')
    .orderBy('s.orden')
    .orderBy('m.orden')
    .execute();

  // Decisiones y ejecuciones por código de método: las tomadas o abiertas con una versión
  // anterior de D01 siguen valiendo para el mismo método de la vigente (RF-W09).
  const decisiones = await db
    .selectFrom('estacion_metodo_decision as d')
    .innerJoin('estacion_metodo as dem', 'dem.id', 'd.estacion_metodo_id')
    .innerJoin('metodo as dm', 'dm.id', 'dem.metodo_id')
    .innerJoin('usuario as u', 'u.id', 'd.creado_por')
    .select(['dm.codigo', 'd.decision', 'd.motivo', 'd.creado_en', 'u.nombre'])
    .where('dem.estacion_id', '=', estacionId)
    .orderBy('d.creado_en', 'desc')
    .orderBy('d.id', 'desc')
    .execute();
  const ultima = new Map<string, (typeof decisiones)[number]>();
  for (const d of decisiones) if (!ultima.has(d.codigo)) ultima.set(d.codigo, d);

  const ejecuciones = await db
    .selectFrom('ejecucion as x')
    .innerJoin('metodo as xm', 'xm.id', 'x.metodo_id')
    .select(['xm.codigo', (eb) => eb.fn.countAll<string>().as('n')])
    .where('x.estacion_id', '=', estacionId)
    .$if(alcance.soloPropias, (q) => q.where('x.usuario_id', '=', actor.usuarioId))
    .groupBy('xm.codigo')
    .execute();
  const nEjec = new Map(ejecuciones.map((x) => [x.codigo, Number(x.n)]));

  const estacionEval = { region: comoRegion(est.region), uv: est.uv, za_ef: est.za_ef };
  const grupos = new Map<
    string,
    { id: string | null; nombre: string; metodos: MetodoDeEstacion[] }
  >();
  let pendientes = 0;
  for (const m of metodos) {
    const clase = comoClase(m.clase);
    if (clase === undefined) continue;
    const fila =
      m.habilitado === null || m.origen === null || m.condicion_pendiente === null
        ? null
        : {
            habilitado: m.habilitado,
            origen: m.origen as 'clase' | 'condicion' | 'nominal',
            condicion_pendiente: m.condicion_pendiente,
          };
    const estado = estadoEnMatriz(clase, fila);
    if (estado === 'condicion_pendiente') pendientes += 1;
    const config = configuracionMetodoSchema.safeParse(m.config);
    const d = m.fila_id === null ? undefined : ultima.get(m.codigo);
    const clave = m.especialidad_id ?? '';
    const grupo = grupos.get(clave) ?? {
      id: m.especialidad_id,
      nombre: m.especialidad_nombre ?? 'Sin especialidad',
      metodos: [],
    };
    grupo.metodos.push({
      metodo_id: m.id,
      codigo: m.codigo,
      nombre: m.nombre,
      clase,
      estado,
      origen: fila?.origen ?? null,
      condicion_d01: config.success ? config.data.aplicacion.texto : '',
      resumen_d01: config.success
        ? describirMetodo(config.data, estacionEval)
            .filter((r) => CLAVES_RESUMEN.has(r.clave))
            .map(({ clave: c, etiqueta, valor, tipo_control }) => ({
              clave: c,
              etiqueta,
              valor,
              tipo_control,
            }))
        : null,
      reserva:
        m.reserva_id === null || m.reserva_estado === null
          ? null
          : { id: m.reserva_id, estado: m.reserva_estado },
      ejecuciones: nEjec.get(m.codigo) ?? 0,
      admite_decision: rechazoDeDecision(clase) === null,
      decision:
        d === undefined
          ? null
          : {
              decision: d.decision === 'descartar' ? 'descartar' : 'confirmar',
              motivo: d.motivo,
              por: d.nombre,
              en: new Date(d.creado_en).toISOString(),
            },
      actualizado_en: m.actualizado_en === null ? null : new Date(m.actualizado_en).toISOString(),
    });
    grupos.set(clave, grupo);
  }

  const gestion = actor.rolGlobal === 'coordinacion' || actor.rolGlobal === 'jefe_proyecto';
  return {
    estacion: { id: est.id, codigo: est.codigo, region: est.region, uv: est.uv, za_ef: est.za_ef },
    puede_decidir: gestion,
    pendientes,
    especialidades: [...grupos.values()],
  };
};

export interface ResultadoDecision {
  readonly estado: EstadoMatriz;
  readonly reserva: { readonly id: string; readonly estado: string } | null;
  /** La confirmación creó una reserva nueva (no había ninguna). */
  readonly reserva_creada: boolean;
}

export const decidirMetodoEnEstacion = async (
  db: Db,
  actor: Actor,
  estacionId: string,
  metodoId: string,
  d: DecisionEstacionMetodoDatos,
): Promise<ResultadoDecision> => {
  exigirGlobal(actor, 'cargar_configuracion');
  return db.transaction().execute(async (tx) => {
    const est = await tx
      .selectFrom('estacion')
      .select(['id', 'proyecto_id'])
      .where('id', '=', estacionId)
      .forUpdate()
      .executeTakeFirst();
    if (est === undefined) throw noEncontrado('La estación');
    // Solo la configuración vigente del proyecto de la estación (otro proyecto: 404).
    const metodo = await tx
      .selectFrom('metodo as m')
      .innerJoin('configuracion_metodologica as c', 'c.id', 'm.configuracion_id')
      .select(['m.id', 'm.clase', 'm.codigo'])
      .where('m.id', '=', metodoId)
      .where('c.proyecto_id', '=', est.proyecto_id)
      .where('c.estado', '=', 'vigente')
      .executeTakeFirst();
    if (metodo === undefined) throw noEncontrado('El método');
    const clase = comoClase(metodo.clase);
    const rechazo = clase === undefined ? 'DECISION_NO_APLICA' : rechazoDeDecision(clase);
    if (rechazo === 'METODO_OBLIGATORIO') {
      throw new ProblemaHttp(
        409,
        'METODO_OBLIGATORIO',
        'Este método es obligatorio en esta estación (RN-28): no se descarta ni requiere confirmación.',
      );
    }
    if (rechazo !== null) {
      throw new ProblemaHttp(
        409,
        'DECISION_NO_APLICA',
        'Los EVENTOS siempre están disponibles y los ATRIBUTOS no son métodos: no se confirman ni se descartan.',
      );
    }

    let fila = await tx
      .selectFrom('estacion_metodo')
      .select(['id', 'habilitado', 'origen', 'condicion_pendiente'])
      .where('estacion_id', '=', estacionId)
      .where('metodo_id', '=', metodoId)
      .forUpdate()
      .executeTakeFirst();
    if (fila === undefined) {
      // Sin fila derivada aún: se crea pendiente para registrar la decisión sobre ella.
      fila = { id: generarId(), habilitado: false, origen: 'condicion', condicion_pendiente: true };
      await tx
        .insertInto('estacion_metodo')
        .values({
          ...fila,
          estacion_id: estacionId,
          metodo_id: metodoId,
          creado_por: actor.usuarioId,
          actualizado_por: actor.usuarioId,
        })
        .execute();
    }
    const anterior = fila;
    const reservaDe = () =>
      tx
        .selectFrom('reserva')
        .select(['id', 'estado'])
        .where('estacion_id', '=', estacionId)
        .where('metodo_id', '=', metodoId)
        .executeTakeFirst();
    const reservaAntes = await reservaDe();

    if (d.decision === 'descartar') {
      // Por código: también cuentan las abiertas con una versión anterior de D01.
      const ejecucion = await tx
        .selectFrom('ejecucion as x')
        .innerJoin('metodo as xm', 'xm.id', 'x.metodo_id')
        .select('x.id')
        .where('x.estacion_id', '=', estacionId)
        .where('xm.codigo', '=', metodo.codigo)
        .limit(1)
        .executeTakeFirst();
      if (ejecucion !== undefined) {
        throw new ProblemaHttp(
          409,
          'TIENE_EJECUCIONES',
          'El método ya tiene ejecuciones en esta estación: no se puede descartar.',
        );
      }
    }

    const habilitado = d.decision === 'confirmar';
    await tx
      .updateTable('estacion_metodo')
      .set({
        habilitado,
        origen: 'nominal',
        condicion_pendiente: false,
        actualizado_por: actor.usuarioId,
      })
      .where('id', '=', fila.id)
      .execute();

    if (habilitado) {
      // La misma función que usan la carga de A01 y la web: crea la reserva que falte (o
      // reactiva la descartada) y la ubica en el cronograma vigente de la estación.
      await sincronizarReservas(comoKysely(tx), {
        proyectoId: est.proyecto_id,
        estacionIds: [estacionId],
        usuarioId: actor.usuarioId,
      });
    } else if (reservaAntes !== undefined) {
      await tx
        .updateTable('reserva')
        .set({ estado: 'descartada', actualizado_por: actor.usuarioId })
        .where('id', '=', reservaAntes.id)
        .execute();
    }

    const reserva = await reservaDe();
    await tx
      .insertInto('estacion_metodo_decision')
      .values({
        id: generarId(),
        estacion_metodo_id: fila.id,
        decision: d.decision,
        motivo: d.motivo,
        habilitado_anterior: anterior.habilitado,
        origen_anterior: anterior.origen,
        condicion_pendiente_anterior: anterior.condicion_pendiente,
        reserva_id: reserva?.id ?? null,
        creado_por: actor.usuarioId,
      })
      .execute();

    return {
      estado: habilitado ? 'aplicable' : 'descartado',
      reserva: reserva === undefined ? null : { id: reserva.id, estado: reserva.estado },
      reserva_creada: reservaAntes === undefined && reserva !== undefined,
    };
  });
};
