import type { Db } from '@campo/db';

export const insertarDispositivo = (
  db: Db,
  d: {
    id: string;
    usuarioId: string;
    plataforma: 'android' | 'ios';
    llavePublica: string;
    versionApp: string;
    tokenPush: string | null;
  },
) =>
  db
    .insertInto('dispositivo')
    .values({
      id: d.id,
      usuario_id: d.usuarioId,
      plataforma: d.plataforma,
      llave_publica: d.llavePublica,
      version_app: d.versionApp,
      token_push: d.tokenPush,
      creado_por: d.usuarioId,
      actualizado_por: d.usuarioId,
    })
    .execute();

/** Vincula la sesión al dispositivo solo si aún no tiene uno. Devuelve si se vinculó. */
export const vincularSesion = async (db: Db, sesionId: string, dispositivoId: string) => {
  const r = await db
    .updateTable('auth_session')
    .set({ dispositivo_id: dispositivoId })
    .where('id', '=', sesionId)
    .where('dispositivo_id', 'is', null)
    .executeTakeFirst();
  return r.numUpdatedRows === 1n;
};

export const buscarDispositivo = (db: Db, id: string) =>
  db
    .selectFrom('dispositivo')
    .select(['id', 'usuario_id', 'estado', 'llave_publica'])
    .where('id', '=', id)
    .executeTakeFirst();

/** Registra el nonce; `false` si ya se había usado (repetición de una firma capturada). */
export const registrarNonce = async (db: Db, dispositivoId: string, nonce: string) => {
  const r = await db
    .insertInto('dispositivo_nonce')
    .values({ dispositivo_id: dispositivoId, nonce })
    .onConflict((oc) => oc.doNothing())
    .executeTakeFirst();
  return r.numInsertedOrUpdatedRows === 1n;
};

export const marcarSincronizacion = (db: Db, id: string) =>
  db.updateTable('dispositivo').set({ ultimo_sync_en: new Date() }).where('id', '=', id).execute();
