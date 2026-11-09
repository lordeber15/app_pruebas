import { configuracionMetodoSchema, puedeIntentar } from '@campo/core';
import type { Db } from '@campo/db';
import type { Actor } from '../../plataforma/sesion.ts';
import {
  brigadasVisibles,
  noEncontrado,
  rolEnBrigada,
  soloLoSuyo,
  veTodosLosProyectos,
} from '../alcance/autorizacion.ts';
import { esfuerzoDeEjecucion, interrupcionesDe } from '../seguimiento/avance.ts';
import * as repo from './repositorio.ts';

/**
 * Seguimiento de ejecuciones en la web (D02 §11 Mapa/GIS, E-02, E-04, E-05), acción
 * `consultar_seguimiento` (ERS §2.3). Alcance (CLAUDE.md, «Alcance de la web sobre ejecuciones y
 * fotos»): Coordinación y JdP todo; Jefe de Brigada y Supervisor de campo su brigada
 * (`ejecucion.brigada_id`); el especialista solo lo suyo; el Administrador técnico nada.
 * Fuera del alcance se responde 404, sin revelar si la ejecución existe.
 */
export const listarEjecuciones = async (
  db: Db,
  actor: Actor,
  proyectoId: string,
  filtro: repo.FiltroEjecuciones,
  pag: repo.Pagina,
) => {
  const mapa = await brigadasVisibles(db, actor, proyectoId);
  const completas: string[] = [];
  const propias: string[] = [];
  for (const [brigadaId, rol] of mapa) {
    if (!puedeIntentar(rol, 'consultar_seguimiento')) continue;
    (soloLoSuyo(rol) ? propias : completas).push(brigadaId);
  }
  if (completas.length === 0 && propias.length === 0) {
    // Coordinación y JdP ven el proyecto aunque aún no tenga brigadas; los demás, no.
    const existe =
      veTodosLosProyectos(actor) &&
      (await db
        .selectFrom('proyecto')
        .select('id')
        .where('id', '=', proyectoId)
        .executeTakeFirst()) !== undefined;
    if (!existe) throw noEncontrado('El proyecto');
    return { filas: [], siguiente_cursor: null };
  }
  return repo.listar(
    db,
    proyectoId,
    { completas, propias, usuarioId: actor.usuarioId },
    filtro,
    pag,
  );
};

export const verEjecucion = async (db: Db, actor: Actor, ejecucionId: string) => {
  const e = await repo.cabecera(db, ejecucionId);
  if (e?.brigada_id == null) throw noEncontrado('La ejecución');
  const rol = await rolEnBrigada(db, actor, e.brigada_id);
  if (rol === null || !puedeIntentar(rol, 'consultar_seguimiento')) {
    throw noEncontrado('La ejecución');
  }
  const {
    usuario_id: duenoId,
    esfuerzo_ejecutado: esfuerzoGuardado,
    metodo_config: metodoConfig,
    estacion_region: region,
    estacion_uv: uv,
    ...cabecera
  } = e;
  if (soloLoSuyo(rol) && duenoId !== actor.usuarioId) throw noEncontrado('La ejecución');

  const [unidades, tracks, fotos] = await Promise.all([
    repo.unidades(db, ejecucionId),
    repo.tracks(db, ejecucionId),
    repo.fotos(db, ejecucionId),
  ]);
  const config = configuracionMetodoSchema.safeParse(metodoConfig);
  const objetivoCampo = e.objetivo_campo === null ? null : Number(e.objetivo_campo);
  return {
    ...cabecera,
    objetivo_campo: objetivoCampo,
    // RF-T05 (T-10): planificado vs. ejecutado, con inicio/fin e interrupciones o fallas.
    esfuerzo: esfuerzoDeEjecucion(
      config.success ? config.data : null,
      { region, uv, za_ef: e.estacion_za_ef },
      {
        datos: e.datos,
        objetivo_campo: objetivoCampo,
        abierta_en: e.abierta_en,
        cerrada_en: e.cerrada_en,
        esfuerzo_ejecutado: esfuerzoGuardado,
      },
      { cerradas: unidades.filter((u) => u.estado === 'cerrada').length, rangos: unidades },
    ),
    interrupciones: interrupcionesDe(esfuerzoGuardado),
    unidades,
    tracks,
    fotos,
  };
};
