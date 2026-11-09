import { crearGeneradorUuidV7, type ConfiguracionMetodo } from '@campo/core';
import { sql, type Kysely } from 'kysely';

/**
 * Versiones de la configuración por método (D01). Una versión ya usada por una ejecución nunca se
 * edita en sitio (CLAUDE.md, Base de datos): cada carga que cambia algo crea una versión nueva y la
 * anterior pasa a `historica`. Lo comparten la carga de la semilla TOCE y la importación de la
 * plantilla Excel desde la web (RF-W09).
 *
 * Al crear la versión se trasladan a sus métodos (mismo código) las dos cosas que apuntan al método
 * y no son configuración:
 * - las decisiones nominales de la matriz estación–método (`origen = 'nominal'`, RN-28, P-01), que
 *   la rederivación nunca pisa;
 * - las reservas estación × método (una por estación × método, RN-19): se reapuntan, no se crean
 *   otras ni se borra ninguna.
 * Las ejecuciones conservan el método (y la versión) con el que se abrieron.
 */

const uuid = crearGeneradorUuidV7((n) => globalThis.crypto.getRandomValues(new Uint8Array(n)));

export interface NuevaVersionConfiguracion {
  readonly proyectoId: string;
  /** Texto de trazabilidad: de dónde sale la versión (semilla o archivo). */
  readonly origen: string;
  readonly notas: string | null;
  readonly usuarioId: string | null;
  readonly metodos: readonly ConfiguracionMetodo[];
  /** Código de especialidad → id en el proyecto. */
  readonly especialidadIds: ReadonlyMap<string, string>;
}

export interface VersionCreada {
  readonly configuracionId: string;
  readonly numero: number;
  readonly anteriorId: string | null;
  readonly nominalesTrasladadas: number;
  readonly reservasTrasladadas: number;
}

/**
 * Crea una versión vigente nueva con `metodos` (debe correr dentro de una transacción). Bloquea la
 * vigente del proyecto para que dos cargas simultáneas no creen dos versiones.
 */
export const crearVersionConfiguracion = async (
  trx: Kysely<unknown>,
  v: NuevaVersionConfiguracion,
): Promise<VersionCreada> => {
  const { proyectoId, usuarioId } = v;
  await sql`SELECT id FROM app.proyecto WHERE id = ${proyectoId} FOR UPDATE`.execute(trx);
  const anterior = (
    await sql<{ id: string }>`
      SELECT id FROM app.configuracion_metodologica
       WHERE proyecto_id = ${proyectoId} AND estado = 'vigente'`.execute(trx)
  ).rows[0];
  const numero =
    Number(
      (
        await sql<{ n: string | null }>`
          SELECT max(numero)::text AS n FROM app.configuracion_metodologica
           WHERE proyecto_id = ${proyectoId}`.execute(trx)
      ).rows[0]?.n ?? 0,
    ) + 1;

  await sql`UPDATE app.configuracion_metodologica
               SET estado = 'historica', actualizado_por = ${usuarioId}
             WHERE proyecto_id = ${proyectoId} AND estado = 'vigente'`.execute(trx);
  const configuracionId = uuid();
  await sql`
    INSERT INTO app.configuracion_metodologica (id, proyecto_id, numero, origen, notas, estado, creado_por, actualizado_por)
    VALUES (${configuracionId}, ${proyectoId}, ${numero}, ${v.origen}, ${v.notas}, 'vigente', ${usuarioId}, ${usuarioId})`.execute(
    trx,
  );

  for (const [orden, m] of v.metodos.entries()) {
    const especialidadId = v.especialidadIds.get(m.especialidad);
    if (especialidadId === undefined)
      throw new Error(`Especialidad desconocida: ${m.especialidad}`);
    await sql`
      INSERT INTO app.metodo (id, configuracion_id, especialidad_id, codigo, nombre, clase,
                              tipo_geometria, requiere_track, orden, config, creado_por, actualizado_por)
      VALUES (${uuid()}, ${configuracionId}, ${especialidadId}, ${m.codigo}, ${m.nombre}, ${m.clase},
              ${m.geometria.tipo}, ${m.track}, ${orden}, ${JSON.stringify(m)}::jsonb, ${usuarioId}, ${usuarioId})`.execute(
      trx,
    );
  }

  let nominalesTrasladadas = 0;
  let reservasTrasladadas = 0;
  if (anterior !== undefined) {
    const nominales = (
      await sql<{ estacion_id: string; metodo_id: string; habilitado: boolean }>`
        SELECT em.estacion_id, mn.id AS metodo_id, em.habilitado
          FROM app.estacion_metodo em
          JOIN app.metodo mv ON mv.id = em.metodo_id AND mv.configuracion_id = ${anterior.id}
          JOIN app.metodo mn ON mn.configuracion_id = ${configuracionId} AND mn.codigo = mv.codigo
         WHERE em.origen = 'nominal'`.execute(trx)
    ).rows;
    for (const n of nominales) {
      await sql`
        INSERT INTO app.estacion_metodo (id, estacion_id, metodo_id, habilitado, origen, condicion_pendiente, creado_por, actualizado_por)
        VALUES (${uuid()}, ${n.estacion_id}, ${n.metodo_id}, ${n.habilitado}, 'nominal', false, ${usuarioId}, ${usuarioId})
        ON CONFLICT (estacion_id, metodo_id) DO NOTHING`.execute(trx);
      nominalesTrasladadas += 1;
    }
    const r = await sql`
      UPDATE app.reserva r
         SET metodo_id = mn.id, actualizado_por = ${usuarioId}
        FROM app.metodo mv, app.metodo mn
       WHERE r.metodo_id = mv.id AND mv.configuracion_id = ${anterior.id}
         AND mn.configuracion_id = ${configuracionId} AND mn.codigo = mv.codigo`.execute(trx);
    reservasTrasladadas = Number(r.numAffectedRows ?? 0n);
  }

  return {
    configuracionId,
    numero,
    anteriorId: anterior?.id ?? null,
    nominalesTrasladadas,
    reservasTrasladadas,
  };
};
