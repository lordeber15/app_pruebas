import type { EstacionCambio, EstacionNueva } from '@campo/core';
import { derivarAplicabilidad, geomDesdeUtm, sincronizarReservas, type Db } from '@campo/db';
import { sql, type Kysely } from 'kysely';
import { ProblemaHttp } from '../../plataforma/errores.ts';
import { generarId } from '../../plataforma/ids.ts';
import type { Actor } from '../../plataforma/sesion.ts';
import { exigirGlobal, noEncontrado } from '../alcance/autorizacion.ts';

/**
 * Estaciones creadas o corregidas desde la web por Coordinación y el JdP (RN-29: sus atributos
 * nunca se piden al especialista). La conversión UTM → EPSG:4326, la matriz estación–método
 * (RN-28) y las reservas usan las mismas funciones de `@campo/db` que la carga de A01.
 *
 * Una estación nunca se borra. Con ejecuciones, sus atributos se pueden corregir (auditado con
 * `actualizado_por`/`actualizado_en`), pero no su código: las ejecuciones lo citan.
 */

const comoKysely = (db: Db): Kysely<unknown> => db as unknown as Kysely<unknown>;

const yaExiste = (e: unknown): never => {
  if ((e as { code?: string }).code === '23505') {
    throw new ProblemaHttp(
      409,
      'ESTACION_EXISTE',
      'Ya hay una estación con ese código en el proyecto.',
    );
  }
  throw e;
};

const metodosHabilitados = async (db: Db, estacionId: string): Promise<number> => {
  const r = await db
    .selectFrom('estacion_metodo as em')
    .innerJoin('metodo as m', 'm.id', 'em.metodo_id')
    .innerJoin('configuracion_metodologica as c', 'c.id', 'm.configuracion_id')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('em.estacion_id', '=', estacionId)
    .where('em.habilitado', '=', true)
    .where('c.estado', '=', 'vigente')
    .where('m.clase', 'not in', ['evento', 'atributo'])
    .executeTakeFirstOrThrow();
  return Number(r.n);
};

export interface ResultadoEstacion {
  readonly id: string;
  /** Métodos que se presentan como método en la estación (con reserva). */
  readonly metodos_habilitados: number;
  readonly reservas_creadas: number;
  /** Reservas que tomaron brigada y fecha del cronograma vigente. */
  readonly reservas_programadas: number;
}

export const crearEstacion = async (
  db: Db,
  actor: Actor,
  proyectoId: string,
  d: EstacionNueva,
): Promise<ResultadoEstacion> => {
  exigirGlobal(actor, 'configurar_proyecto');
  const proyecto = await db
    .selectFrom('proyecto')
    .select('id')
    .where('id', '=', proyectoId)
    .executeTakeFirst();
  if (proyecto === undefined) throw noEncontrado('El proyecto');
  return db.transaction().execute(async (tx) => {
    const id = generarId();
    try {
      await tx
        .insertInto('estacion')
        .values({
          id,
          proyecto_id: proyectoId,
          codigo: d.codigo,
          geom: geomDesdeUtm(d.zona_utm, d.este, d.norte),
          zona_utm: d.zona_utm,
          este: d.este,
          norte: d.norte,
          aid_aii: d.aid_aii,
          uv: d.uv,
          za_ef: d.za_ef,
          region: d.region,
          creado_por: actor.usuarioId,
          actualizado_por: actor.usuarioId,
        })
        .execute();
    } catch (e) {
      yaExiste(e);
    }
    const k = comoKysely(tx);
    await derivarAplicabilidad(k, { proyectoId, estacionIds: [id], usuarioId: actor.usuarioId });
    const r = await sincronizarReservas(k, {
      proyectoId,
      estacionIds: [id],
      usuarioId: actor.usuarioId,
    });
    return {
      id,
      metodos_habilitados: await metodosHabilitados(tx, id),
      reservas_creadas: r.creadas,
      reservas_programadas: r.ubicadas,
    };
  });
};

export const actualizarEstacion = async (
  db: Db,
  actor: Actor,
  estacionId: string,
  d: EstacionCambio,
): Promise<ResultadoEstacion> => {
  exigirGlobal(actor, 'configurar_proyecto');
  return db.transaction().execute(async (tx) => {
    const actual = await tx
      .selectFrom('estacion')
      .select(['id', 'proyecto_id', 'codigo'])
      .where('id', '=', estacionId)
      .forUpdate()
      .executeTakeFirst();
    if (actual === undefined) throw noEncontrado('La estación');
    const cambiaCodigo = d.codigo !== undefined && d.codigo !== actual.codigo;
    if (cambiaCodigo) {
      const ejecucion = await tx
        .selectFrom('ejecucion')
        .select('id')
        .where('estacion_id', '=', estacionId)
        .limit(1)
        .executeTakeFirst();
      if (ejecucion !== undefined) {
        throw new ProblemaHttp(
          409,
          'ESTACION_CON_EJECUCIONES',
          'La estación ya tiene ejecuciones: puede corregir sus atributos, pero no su código.',
        );
      }
    }
    const ubicacion =
      d.zona_utm !== undefined && d.este !== undefined && d.norte !== undefined
        ? {
            geom: geomDesdeUtm(d.zona_utm, d.este, d.norte),
            zona_utm: d.zona_utm,
            este: d.este,
            norte: d.norte,
          }
        : {};
    try {
      await tx
        .updateTable('estacion')
        .set({
          ...(d.codigo === undefined ? {} : { codigo: d.codigo }),
          ...ubicacion,
          ...(d.aid_aii === undefined ? {} : { aid_aii: d.aid_aii }),
          ...(d.uv === undefined ? {} : { uv: d.uv }),
          ...(d.za_ef === undefined ? {} : { za_ef: d.za_ef }),
          ...(d.region === undefined ? {} : { region: d.region }),
          actualizado_por: actor.usuarioId,
        })
        .where('id', '=', estacionId)
        .execute();
    } catch (e) {
      yaExiste(e);
    }
    // Las reservas llevan la posición y el código de la estación (se muestran en el celular).
    if ('geom' in ubicacion || cambiaCodigo) {
      await sql`
        UPDATE app.reserva r
           SET geom = e.geom, titulo = e.codigo || ' · ' || m.nombre, actualizado_por = ${actor.usuarioId}
          FROM app.estacion e, app.metodo m
         WHERE r.estacion_id = e.id AND m.id = r.metodo_id AND e.id = ${estacionId}`.execute(tx);
    }
    // La aplicabilidad depende de región, UV y ZA/EF: se vuelve a derivar (sin tocar lo nominal).
    // Una reserva de un método que deja de aplicar no se borra.
    const k = comoKysely(tx);
    await derivarAplicabilidad(k, {
      proyectoId: actual.proyecto_id,
      estacionIds: [estacionId],
      usuarioId: actor.usuarioId,
    });
    const r = await sincronizarReservas(k, {
      proyectoId: actual.proyecto_id,
      estacionIds: [estacionId],
      usuarioId: actor.usuarioId,
    });
    return {
      id: estacionId,
      metodos_habilitados: await metodosHabilitados(tx, estacionId),
      reservas_creadas: r.creadas,
      reservas_programadas: r.ubicadas,
    };
  });
};
