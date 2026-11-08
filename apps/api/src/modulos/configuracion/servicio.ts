import type { Db } from '@campo/db';
import { cargarToce, type ResumenCargaToce } from '@campo/db/toce';
import type { Kysely } from 'kysely';
import type { Actor } from '../../plataforma/sesion.ts';
import { exigirGlobal } from '../alcance/autorizacion.ts';
import { verProyecto } from '../organizacion/servicio.ts';

/**
 * Carga la configuración TOCE (D01 por método y A01 con estaciones, brigadas, cronograma y
 * reservas) en un proyecto, desde la web (RF-W09, `03` §8). Usa la semilla curada por GENIA que
 * también carga `db:toce`; la plantilla Excel editable por el cliente queda para después.
 * Idempotente: repetirla no duplica nada y respeta las decisiones nominales ya tomadas.
 */
export const cargarConfiguracionToce = async (
  db: Db,
  actor: Actor,
  proyectoId: string,
): Promise<ResumenCargaToce> => {
  exigirGlobal(actor, 'cargar_configuracion');
  await verProyecto(db, actor, proyectoId);
  return cargarToce(db as unknown as Kysely<unknown>, {
    proyectoId,
    usuarioId: actor.usuarioId,
  });
};
