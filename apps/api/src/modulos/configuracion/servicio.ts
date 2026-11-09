import type { Db } from '@campo/db';
import { cargarToce, type ResumenCargaToce } from '@campo/db/toce';
import type { Kysely } from 'kysely';
import type { Actor } from '../../plataforma/sesion.ts';
import { exigirGlobal } from '../alcance/autorizacion.ts';
import { verProyecto } from '../organizacion/servicio.ts';

/**
 * Carga la configuración TOCE (D01 por método y A01 con estaciones, brigadas, cronograma y
 * reservas) en un proyecto, desde la web (RF-W09, `03` §8). Usa la semilla curada por GENIA que
 * también carga `db:toce`. La plantilla Excel editable (D01 por método) está en `importacion-d01.ts`.
 * Idempotente: repetirla no duplica nada y respeta las decisiones nominales ya tomadas.
 *
 * `fechaInicio` (demo): corre las fechas de A01 para que empiecen ese día; solo al crear el
 * cronograma base (RN-35). `incluirA01: false` carga solo D01 para un proyecto armado en la web.
 */
export const cargarConfiguracionToce = async (
  db: Db,
  actor: Actor,
  proyectoId: string,
  opciones: { readonly fechaInicio: string | null; readonly incluirA01: boolean } = {
    fechaInicio: null,
    incluirA01: true,
  },
): Promise<ResumenCargaToce> => {
  exigirGlobal(actor, 'cargar_configuracion');
  await verProyecto(db, actor, proyectoId);
  return cargarToce(db as unknown as Kysely<unknown>, {
    proyectoId,
    usuarioId: actor.usuarioId,
    fechaInicio: opciones.fechaInicio,
    incluirA01: opciones.incluirA01,
  });
};
