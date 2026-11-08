import type { Db } from '@campo/db';
import { sql } from 'kysely';

export const buscarEvento = (db: Db, id: string) =>
  db
    .selectFrom('evento')
    .select(['id', 'usuario_id', 'estado', 'motivo'])
    .where('id', '=', id)
    .executeTakeFirst();

export interface FilaEvento {
  readonly id: string;
  readonly tipo: string;
  readonly versionEsquema: number;
  readonly usuarioId: string;
  readonly dispositivoId: string;
  readonly entidadTipo: string;
  readonly entidadId: string;
  readonly payload: unknown;
  readonly ubicacion: unknown;
  readonly horaDispositivo: Date | null;
  readonly estado: string;
  readonly motivo: string | null;
}

export const insertarEvento = (db: Db, e: FilaEvento) =>
  db
    .insertInto('evento')
    .values({
      id: e.id,
      tipo: e.tipo,
      version_esquema: e.versionEsquema,
      usuario_id: e.usuarioId,
      dispositivo_id: e.dispositivoId,
      entidad_tipo: e.entidadTipo,
      entidad_id: e.entidadId,
      payload: JSON.stringify(e.payload ?? null),
      ubicacion:
        e.ubicacion === null || e.ubicacion === undefined ? null : JSON.stringify(e.ubicacion),
      hora_dispositivo: e.horaDispositivo,
      estado: e.estado,
      motivo: e.motivo,
    })
    .execute();

/** Punto GeoJSON → geometría EPSG:4326 (parametrizado). */
export const punto = (lon: number, lat: number) =>
  sql<string>`ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)`;
