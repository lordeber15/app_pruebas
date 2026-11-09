import {
  multiPoligonoSchema,
  configuracionMetodoSchema,
  crearGeneradorUuidV7,
  ETIQUETAS_REGLA,
  esEstadoEjecucion,
  evaluarEjecucion,
  geometriaCapturadaSchema,
  ORIENTACIONES,
  REGIONES,
  TIPOS_DESVIACION,
  TIPOS_FOTO,
  TIPOS_UNIDAD,
  transicionarEjecucion,
  type ContextoEvaluacion,
  type EvaluacionEjecucion,
  type FotoEvaluable,
  type GeometriaCapturada,
  type ResultadoRegla,
  type UnidadEvaluable,
} from '@campo/core';
import type { Db } from '@campo/db';
import { sql } from 'kysely';
import { randomFillSync } from 'node:crypto';

/**
 * Trabajo `evaluar_ejecucion`: validación post-sincronización contra D01 (D02 §9, RN-05, RN-31,
 * RF-T04). Toma una ejecución en `evidencia_pendiente` cuyas fotos anunciadas ya están
 * verificadas, arma el contexto desde PostgreSQL, la evalúa con el motor de `core` (nunca se
 * reimplementa aquí), guarda el resultado y la pasa a `completa` o `parcial`.
 *
 * - Bloquean la evaluación las **fotos** de la ejecución con la preview sin verificar
 *   (`anunciado`, `preview_subida` o `error`): son la evidencia que evalúan las reglas. Con un
 *   hash incorrecto (`error`) el celular vuelve a subirla; mientras tanto la ejecución espera.
 *   El original no hace falta (RN-26). Fichas y audios no bloquean: D01 no evalúa sobre ellos.
 * - Una ejecución cerrada sin fotos se evalúa directamente; si el proyecto exige una foto mínima
 *   por ejecución (`proyecto.fotos_minimas_ejecucion`, RN-04 ampliada) incumple esa regla.
 * - Cada regla **obligatoria** incumplida genera una alerta `post_sincronizacion` del sistema
 *   (una por regla, con el detalle de cada unidad). Advertencias, referencias, informativos y
 *   criterios humanos nunca generan alertas (RN-31).
 * - Idempotente: la transición se valida con la ejecución bloqueada y la alerta lleva la clave
 *   `qa:{regla}:{ejecución}:{periodo}` (índice único por proyecto); un reproceso no duplica.
 */
const generarId = crearGeneradorUuidV7((n) => randomFillSync(new Uint8Array(n)));

/** Zona para el periodo de la clave de deduplicación (decisión «Zona horaria de los horarios»). */
const ZONA_PERIODO = 'America/Lima';
const ESTADOS_LISTOS = ['preview_verificada', 'original_verificado'] as const;

export type ResultadoQa =
  | { readonly accion: 'nada'; readonly motivo: string }
  | {
      readonly accion: 'evaluada';
      readonly estado: 'completa' | 'parcial';
      readonly incumplimientos: number;
      readonly alertas_nuevas: number;
    };

const incluye = <T extends string>(valores: readonly T[], x: unknown): x is T =>
  typeof x === 'string' && (valores as readonly string[]).includes(x);

const objeto = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? (v as unknown[]) : []);
const textos = (v: unknown): string[] => lista(v).filter((x) => typeof x === 'string');
const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());

/** Fecha local (AAAA-MM-DD) del cierre: el «periodo» de la clave de deduplicación. */
export const periodoDe = (d: Date): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_PERIODO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);

export const claveAlertaQa = (regla: string, ejecucionId: string, periodo: string): string =>
  `qa:${regla}:${ejecucionId}:${periodo}`;

/**
 * Geometría capturada: la del celular (`geom_detalle`, RN-30). Si solo existe la geometría
 * PostGIS, se reconstruye la forma equivalente.
 */
const geometriaDe = (detalle: unknown, geojson: string | null): GeometriaCapturada | null => {
  const p = geometriaCapturadaSchema.safeParse(detalle);
  if (p.success) return p.data;
  if (geojson === null) return null;
  const g = objeto(JSON.parse(geojson));
  const c = (x: unknown) => {
    const [lon, lat] = lista(x);
    return typeof lon === 'number' && typeof lat === 'number' ? { lat, lon } : null;
  };
  const puntos = (xs: unknown) =>
    lista(xs)
      .map(c)
      .filter((x) => x !== null);
  switch (g['type']) {
    case 'Point': {
      const punto = c(g['coordinates']);
      return punto === null ? null : { tipo: 'punto', punto };
    }
    case 'LineString': {
      const v = puntos(g['coordinates']);
      const [inicio] = v;
      const fin = v.at(-1);
      return inicio === undefined || fin === undefined ? null : { tipo: 'inicio_fin', inicio, fin };
    }
    case 'Polygon': {
      // El anillo cerrado repite el primer vértice.
      const v = puntos(lista(g['coordinates'])[0]).slice(0, -1);
      return { tipo: 'vertices', vertices: v };
    }
    case 'MultiPoint':
      return { tipo: 'vertices', vertices: puntos(g['coordinates']) };
    default:
      return null;
  }
};

const fotoEvaluable = (f: { tipo_foto: string | null; orientacion: string | null }) =>
  ({
    // Igual que el celular: una foto sin tipo cuenta como de contexto.
    tipo: incluye(TIPOS_FOTO, f.tipo_foto) ? f.tipo_foto : 'contexto',
    orientacion: incluye(ORIENTACIONES, f.orientacion) ? f.orientacion : null,
    // Sin columna de herencia: las fotos guardadas son propias de su unidad (igual que el celular).
    heredada: false,
  }) satisfies FotoEvaluable;

/** Ejecuciones en `evidencia_pendiente` sin fotos por verificar (revisión periódica). */
export const ejecucionesListas = async (db: Db, limite = 200): Promise<string[]> => {
  const filas = await db
    .selectFrom('ejecucion as e')
    .select('e.id')
    .where('e.estado', '=', 'evidencia_pendiente')
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('archivo as a')
            .select(sql`1`.as('x'))
            .whereRef('a.ejecucion_id', '=', 'e.id')
            .where('a.tipo', '=', 'foto')
            .where('a.estado', 'not in', ESTADOS_LISTOS),
        ),
      ),
    )
    .orderBy('e.cerrada_en')
    .limit(limite)
    .execute();
  return filas.map((f) => f.id);
};

/** Ejecución de un archivo, para evaluarla cuando termina su verificación. */
export const ejecucionDeArchivo = async (db: Db, archivoId: string): Promise<string | null> =>
  (
    await db
      .selectFrom('archivo')
      .select('ejecucion_id')
      .where('id', '=', archivoId)
      .executeTakeFirst()
  )?.ejecucion_id ?? null;

type Tx = Db;

const armarContexto = async (
  tx: Tx,
  ej: {
    id: string;
    proyecto_id: string;
    estacion_id: string;
    metodo_id: string;
    abierta_en: Date;
    cerrada_en: Date | null;
    datos: unknown;
    desviacion_tipo: string;
    desviacion_explicacion: string | null;
    confirmaciones: unknown;
    objetivo_campo: string | null;
  },
): Promise<
  | { ok: true; ctx: ContextoEvaluacion; metodo: { nombre: string }; estacion: { codigo: string } }
  | { ok: false; motivo: string }
> => {
  const metodo = await tx
    .selectFrom('metodo')
    .select(['nombre', 'config'])
    .where('id', '=', ej.metodo_id)
    .executeTakeFirstOrThrow();
  const config = configuracionMetodoSchema.safeParse(metodo.config);
  if (!config.success) return { ok: false, motivo: 'CONFIGURACION_INVALIDA' };

  // RN-04 ampliada (decisión 2026-11-08): foto mínima por ejecución, regla del proyecto.
  const proyecto = await tx
    .selectFrom('proyecto')
    .select('fotos_minimas_ejecucion')
    .where('id', '=', ej.proyecto_id)
    .executeTakeFirstOrThrow();

  const estacion = await tx
    .selectFrom('estacion as e')
    .leftJoin('poligono as p', 'p.id', 'e.poligono_id')
    .select([
      'e.codigo',
      'e.region',
      'e.za_ef',
      'e.uv',
      // Polígono del proyecto (KMZ): una unidad fuera es advertencia (2026-11-09).
      sql<string | null>`ST_AsGeoJSON(p.geom, 7)`.as('poligono'),
    ])
    .where('e.id', '=', ej.estacion_id)
    .executeTakeFirstOrThrow();
  const poligono =
    estacion.poligono === null
      ? null
      : multiPoligonoSchema.safeParse(JSON.parse(estacion.poligono));

  const unidades = await tx
    .selectFrom('unidad')
    .select([
      'id',
      'codigo',
      'tipo_unidad',
      'estado',
      'geom_detalle',
      sql<string | null>`ST_AsGeoJSON(geom)`.as('geojson'),
      'inicio',
      'fin',
      'datos',
      'registros',
      'unidad_vinculada_id',
      'parametros_confirmados',
    ])
    .where('ejecucion_id', '=', ej.id)
    .orderBy('orden')
    .execute();

  const fotos = await tx
    .selectFrom('archivo')
    .select(['unidad_id', 'tipo_foto', 'orientacion'])
    .where('ejecucion_id', '=', ej.id)
    .where('tipo', '=', 'foto')
    .where('estado', 'in', ESTADOS_LISTOS)
    .execute();

  const tracks = await tx
    .selectFrom('track')
    .select(['unidad_id', sql<number>`sum(jsonb_array_length(puntos))::int`.as('puntos')])
    .where('ejecucion_id', '=', ej.id)
    .groupBy('unidad_id')
    .execute();
  const puntosPor = new Map(tracks.map((t) => [t.unidad_id, t.puntos]));

  const vinculables = await tx
    .selectFrom('unidad as u')
    .innerJoin('ejecucion as x', 'x.id', 'u.ejecucion_id')
    .innerJoin('metodo as m', 'm.id', 'x.metodo_id')
    .select(['u.id', 'm.codigo'])
    .where('x.estacion_id', '=', ej.estacion_id)
    .where('x.id', '!=', ej.id)
    .execute();

  const evaluables: UnidadEvaluable[] = [];
  for (const u of unidades) {
    if (!incluye(TIPOS_UNIDAD, u.tipo_unidad)) return { ok: false, motivo: 'UNIDAD_INVALIDA' };
    evaluables.push({
      id: u.id,
      codigo: u.codigo,
      tipo: u.tipo_unidad,
      estado: u.estado === 'cerrada' ? 'cerrada' : 'abierta',
      geometria: geometriaDe(u.geom_detalle, u.geojson),
      inicio: iso(u.inicio),
      fin: iso(u.fin),
      datos: objeto(u.datos),
      registros: lista(u.registros).map(objeto),
      fotos: fotos.filter((f) => f.unidad_id === u.id).map(fotoEvaluable),
      track: puntosPor.has(u.id) ? { puntos: puntosPor.get(u.id) ?? 0 } : null,
      unidad_vinculada_id: u.unidad_vinculada_id,
      parametros_confirmados: textos(u.parametros_confirmados),
    });
  }

  const desviacion = incluye(TIPOS_DESVIACION, ej.desviacion_tipo) ? ej.desviacion_tipo : null;
  if (desviacion === null) return { ok: false, motivo: 'DESVIACION_INVALIDA' };

  return {
    ok: true,
    metodo: { nombre: metodo.nombre },
    estacion: { codigo: estacion.codigo },
    ctx: {
      metodo: config.data,
      estacion: {
        region: incluye(REGIONES, estacion.region) ? estacion.region : null,
        za_ef: estacion.za_ef,
        uv: estacion.uv,
        poligono: poligono?.success === true ? poligono.data.coordinates : null,
      },
      ejecucion: {
        abierta_en: ej.abierta_en.toISOString(),
        cerrada_en: iso(ej.cerrada_en),
        datos: objeto(ej.datos),
        desviacion: { tipo: desviacion, explicacion: ej.desviacion_explicacion },
        confirmaciones: textos(ej.confirmaciones),
        objetivo_campo: ej.objetivo_campo === null ? null : Number(ej.objetivo_campo),
        fotos: fotos.filter((f) => f.unidad_id === null).map(fotoEvaluable),
        unidades: evaluables,
      },
      unidades_vinculables: vinculables.map((v) => ({ id: v.id, metodo: v.codigo })),
      proyecto: { fotos_minimas_ejecucion: proyecto.fotos_minimas_ejecucion },
    },
  };
};

/** Incumplimientos obligatorios agrupados por regla: una alerta por regla. */
const obligatoriosPorRegla = (e: EvaluacionEjecucion): Map<string, ResultadoRegla[]> => {
  const mapa = new Map<string, ResultadoRegla[]>();
  for (const r of e.resultados) {
    if (r.estado !== 'incumple' || r.tipo_control !== 'obligatorio') continue;
    mapa.set(r.regla, [...(mapa.get(r.regla) ?? []), r]);
  }
  return mapa;
};

export const evaluarEjecucionQa = async (db: Db, ejecucionId: string): Promise<ResultadoQa> =>
  db.transaction().execute(async (tx): Promise<ResultadoQa> => {
    const ej = await tx
      .selectFrom('ejecucion')
      .select([
        'id',
        'proyecto_id',
        'brigada_id',
        'reserva_id',
        'estacion_id',
        'metodo_id',
        'estado',
        'abierta_en',
        'cerrada_en',
        'datos',
        'desviacion_tipo',
        'desviacion_explicacion',
        'confirmaciones',
        'objetivo_campo',
      ])
      .where('id', '=', ejecucionId)
      .forUpdate()
      .executeTakeFirst();
    if (ej === undefined) return { accion: 'nada', motivo: 'INEXISTENTE' };
    if (!esEstadoEjecucion(ej.estado)) throw new Error('Estado de ejecución desconocido en la BD');
    if (ej.estado !== 'evidencia_pendiente') return { accion: 'nada', motivo: 'YA_EVALUADA' };

    const pendientes = await tx
      .selectFrom('archivo')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('ejecucion_id', '=', ej.id)
      .where('tipo', '=', 'foto')
      .where('estado', 'not in', ESTADOS_LISTOS)
      .executeTakeFirstOrThrow();
    if (pendientes.n > 0) return { accion: 'nada', motivo: 'FOTOS_PENDIENTES' };

    const armado = await armarContexto(tx, ej);
    // Sin configuración válida no se puede evaluar: la ejecución sigue esperando (nada se inventa).
    if (!armado.ok) return { accion: 'nada', motivo: armado.motivo };

    const evaluacion = evaluarEjecucion(armado.ctx);
    const t = transicionarEjecucion(ej.estado, {
      tipo: 'evaluar_qa',
      incumplimientosObligatorios: evaluacion.incumplimientos_obligatorios,
    });
    if (!t.ok) return { accion: 'nada', motivo: t.motivo };
    if (t.valor !== 'completa' && t.valor !== 'parcial') {
      throw new Error('evaluar_qa debe llevar a completa o parcial');
    }

    await tx
      .updateTable('ejecucion')
      .set((eb) => ({
        estado: t.valor,
        resultado_qa: JSON.stringify(evaluacion),
        qa_evaluado_en: new Date(),
        version: eb('version', '+', 1),
      }))
      .where('id', '=', ej.id)
      .execute();

    const periodo = periodoDe(ej.cerrada_en ?? ej.abierta_en);
    let nuevas = 0;
    for (const [regla, resultados] of obligatoriosPorRegla(evaluacion)) {
      const etiqueta = ETIQUETAS_REGLA[resultados[0]?.regla ?? 'desviacion'];
      const r = await tx
        .insertInto('alerta')
        .values({
          id: generarId(),
          proyecto_id: ej.proyecto_id,
          tipo: 'post_sincronizacion',
          origen: 'sistema',
          brigada_id: ej.brigada_id,
          estacion_id: ej.estacion_id,
          ejecucion_id: ej.id,
          reserva_id: ej.reserva_id,
          titulo: `${armado.estacion.codigo} · ${armado.metodo.nombre}: incumple «${etiqueta}»`,
          descripcion: [
            ...resultados.map((x) => `• ${x.mensaje}`),
            `D01: ${resultados[0]?.texto_d01 ?? ''}`,
          ].join('\n'),
          clave_dedup: claveAlertaQa(regla, ej.id, periodo),
        })
        .onConflict((oc) =>
          oc
            .columns(['proyecto_id', 'clave_dedup'])
            .where('clave_dedup', 'is not', null)
            .doNothing(),
        )
        .executeTakeFirst();
      nuevas += Number(r.numInsertedOrUpdatedRows ?? 0);
    }

    return {
      accion: 'evaluada',
      estado: t.valor,
      incumplimientos: evaluacion.incumplimientos_obligatorios,
      alertas_nuevas: nuevas,
    };
  });
