import { nivelPermiso, puedeIntentar, type Rol } from '@campo/core';
import type { Db } from '@campo/db';
import { sql } from 'kysely';
import { noAutorizado, ProblemaHttp } from '../../plataforma/errores.ts';
import type { Actor } from '../../plataforma/sesion.ts';
import {
  brigadasVisibles,
  noEncontrado,
  rolEnBrigada,
  soloLoSuyo,
  veTodosLosProyectos,
} from '../alcance/autorizacion.ts';

/**
 * Galería de fotos verificadas (D02 §8 y §11, E-10 parcial).
 *
 * - Solo fotos con la versión de 2 048 px verificada en el servidor; las miniaturas y vistas se
 *   piden con `GET /archivos/:id/url`, que vuelve a autorizar y firma por ≤ 15 min.
 * - Alcance como en las ejecuciones: Coordinación y JdP todo; JdB y Supervisor su brigada; el
 *   especialista solo lo suyo.
 * - «Candidata para el reporte diario»: especialista (sus fotos), Supervisor (su brigada),
 *   Coordinación y JdP (`marcar_candidata`).
 * - Selección final para el reporte del día: **solo Coordinación y JdP**, siempre manual
 *   (`emitir_reporte_diario`). El reporte en Excel/PDF espera la plantilla del cliente (P-13).
 */

/** Zona horaria para el filtro por día, hasta que exista la del proyecto (CLAUDE.md, huecos). */
const ZONA_HORARIA = 'America/Lima';
const LIMITE = 300;

export interface FiltrosGaleria {
  readonly brigada?: string | undefined;
  readonly estacion?: string | undefined;
  readonly metodo?: string | undefined;
  /** AAAA-MM-DD en la zona del proyecto. */
  readonly fecha?: string | undefined;
  readonly seleccion?: 'todas' | 'candidatas' | 'seleccionadas' | undefined;
}

export const listarGaleria = async (
  db: Db,
  actor: Actor,
  proyectoId: string,
  f: FiltrosGaleria,
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
  const elegidas = f.brigada === undefined ? visibles : visibles.filter(([id]) => id === f.brigada);
  if (f.brigada !== undefined && elegidas.length === 0) throw noEncontrado('La brigada');
  const puedeSeleccionar = (rol: Rol) => nivelPermiso(rol, 'emitir_reporte_diario') === 'total';
  const seleccionar =
    visibles.some(([, rol]) => puedeSeleccionar(rol)) || veTodosLosProyectos(actor);
  if (elegidas.length === 0) return { fotos: [], truncado: false, puede_seleccionar: seleccionar };

  const ids = elegidas.map(([id]) => id);
  const soloPropias = elegidas.filter(([, rol]) => soloLoSuyo(rol)).map(([id]) => id);
  const rolDe = new Map(elegidas);

  let q = db
    .selectFrom('archivo as a')
    .innerJoin('ejecucion as x', 'x.id', 'a.ejecucion_id')
    .innerJoin('estacion as e', 'e.id', 'x.estacion_id')
    .innerJoin('metodo as m', 'm.id', 'x.metodo_id')
    .innerJoin('especialidad as s', 's.id', 'm.especialidad_id')
    .innerJoin('usuario as us', 'us.id', 'a.usuario_id')
    .leftJoin('unidad as un', 'un.id', 'a.unidad_id')
    .leftJoin('brigada as b', 'b.id', 'x.brigada_id')
    .select([
      'a.id',
      'a.capturado_en',
      'a.tipo_foto',
      'a.orientacion',
      'a.candidata_reporte',
      'a.seleccionada_reporte',
      sql<string | null>`to_char(a.seleccion_fecha, 'YYYY-MM-DD')`.as('seleccion_fecha'),
      'a.usuario_id',
      'us.nombre as usuario_nombre',
      'x.id as ejecucion_id',
      'x.brigada_id',
      'b.codigo as brigada_codigo',
      'b.nombre as brigada_nombre',
      'e.id as estacion_id',
      'e.codigo as estacion_codigo',
      'm.id as metodo_id',
      'm.nombre as metodo_nombre',
      's.nombre as especialidad_nombre',
      'un.codigo as unidad_codigo',
    ])
    .where('a.proyecto_id', '=', proyectoId)
    .where('a.tipo', '=', 'foto')
    .where('a.estado', 'in', ['preview_verificada', 'original_verificado'])
    .where('x.brigada_id', 'in', ids);
  if (soloPropias.length > 0) {
    q = q.where((eb) =>
      eb.or([eb('x.brigada_id', 'not in', soloPropias), eb('a.usuario_id', '=', actor.usuarioId)]),
    );
  }
  if (f.estacion !== undefined) q = q.where('x.estacion_id', '=', f.estacion);
  if (f.metodo !== undefined) q = q.where('x.metodo_id', '=', f.metodo);
  if (f.fecha !== undefined) {
    q = q.where(
      sql<boolean>`(a.capturado_en AT TIME ZONE ${ZONA_HORARIA})::date = ${f.fecha}::date`,
    );
  }
  if (f.seleccion === 'candidatas') q = q.where('a.candidata_reporte', '=', true);
  if (f.seleccion === 'seleccionadas') q = q.where('a.seleccionada_reporte', '=', true);

  const filas = await q
    .orderBy('a.capturado_en', 'desc')
    .orderBy('a.id')
    .limit(LIMITE + 1)
    .execute();
  return {
    truncado: filas.length > LIMITE,
    puede_seleccionar: seleccionar,
    fotos: filas.slice(0, LIMITE).map((a) => {
      const rol = a.brigada_id === null ? undefined : rolDe.get(a.brigada_id);
      const nivel = rol === undefined ? 'no' : nivelPermiso(rol, 'marcar_candidata');
      return {
        ...a,
        capturado_en: new Date(a.capturado_en).toISOString(),
        puede_marcar:
          nivel === 'total' ||
          (nivel === 'alcance' &&
            (!soloLoSuyo(rol ?? 'admin') || a.usuario_id === actor.usuarioId)),
      };
    }),
  };
};

/** Foto con su brigada y el rol del actor ahí; 404 si no está a su alcance. */
const fotoEnAlcance = async (db: Db, actor: Actor, archivoId: string) => {
  const a = await db
    .selectFrom('archivo as a')
    .innerJoin('ejecucion as x', 'x.id', 'a.ejecucion_id')
    .select(['a.id', 'a.tipo', 'a.estado', 'a.usuario_id', 'x.brigada_id'])
    .where('a.id', '=', archivoId)
    .executeTakeFirst();
  if (a?.brigada_id == null || a.tipo !== 'foto') throw noEncontrado('La foto');
  const rol = await rolEnBrigada(db, actor, a.brigada_id);
  if (rol === null || !puedeIntentar(rol, 'consultar_seguimiento')) throw noEncontrado('La foto');
  if (soloLoSuyo(rol) && a.usuario_id !== actor.usuarioId) throw noEncontrado('La foto');
  return { ...a, rol };
};

export const marcarCandidata = async (
  db: Db,
  actor: Actor,
  archivoId: string,
  candidata: boolean,
): Promise<void> => {
  const a = await fotoEnAlcance(db, actor, archivoId);
  const nivel = nivelPermiso(a.rol, 'marcar_candidata');
  // `alcance`: el especialista sus fotos (ya filtrado arriba) y el Supervisor su brigada.
  if (nivel !== 'total' && nivel !== 'alcance') throw noAutorizado();
  await db
    .updateTable('archivo')
    .set({
      candidata_reporte: candidata,
      candidata_por: actor.usuarioId,
      candidata_en: new Date(),
      actualizado_por: actor.usuarioId,
    })
    .where('id', '=', archivoId)
    .execute();
};

export const seleccionarParaReporte = async (
  db: Db,
  actor: Actor,
  archivoId: string,
  s: { seleccionada: boolean; fecha: string | null },
): Promise<void> => {
  const a = await fotoEnAlcance(db, actor, archivoId);
  if (nivelPermiso(a.rol, 'emitir_reporte_diario') !== 'total') throw noAutorizado();
  if (a.estado !== 'preview_verificada' && a.estado !== 'original_verificado') {
    throw new ProblemaHttp(
      409,
      'FOTO_NO_VERIFICADA',
      'La foto aún no está verificada en el servidor.',
    );
  }
  if (s.seleccionada && s.fecha === null) {
    throw new ProblemaHttp(400, 'FECHA_OBLIGATORIA', 'Indique la fecha del reporte diario.');
  }
  await db
    .updateTable('archivo')
    .set(
      s.seleccionada
        ? {
            seleccionada_reporte: true,
            seleccion_fecha: s.fecha,
            seleccionada_por: actor.usuarioId,
            seleccionada_en: new Date(),
            actualizado_por: actor.usuarioId,
          }
        : {
            seleccionada_reporte: false,
            seleccion_fecha: null,
            seleccionada_por: null,
            seleccionada_en: null,
            actualizado_por: actor.usuarioId,
          },
    )
    .where('id', '=', archivoId)
    .execute();
};
