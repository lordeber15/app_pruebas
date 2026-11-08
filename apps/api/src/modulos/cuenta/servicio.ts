import type { Db } from '@campo/db';
import { hashContrasena, verificarContrasena } from '../../plataforma/contrasena.ts';
import { ProblemaHttp } from '../../plataforma/errores.ts';
import type { Actor } from '../../plataforma/sesion.ts';

/**
 * Cambio de la propia contraseña (decisión del usuario, 2026-11-07). La política (8 caracteres,
 * mayúscula, minúscula y número) la valida el esquema de core en la ruta. Se exige la actual,
 * se quita la marca de primer ingreso y se cierran las demás sesiones del usuario: un celular
 * activado vuelve a entrar renovando con la llave de su dispositivo.
 */
export const cambiarContrasena = async (
  db: Db,
  actor: Actor,
  actual: string,
  nueva: string,
): Promise<void> => {
  const cuenta = await db
    .selectFrom('auth_account')
    .select(['id', 'password'])
    .where('user_id', '=', actor.usuarioId)
    .where('provider_id', '=', 'credential')
    .executeTakeFirst();
  if (
    cuenta?.password == null ||
    !(await verificarContrasena({ hash: cuenta.password, password: actual }))
  ) {
    throw new ProblemaHttp(
      400,
      'CONTRASENA_ACTUAL_INCORRECTA',
      'La contraseña actual no es correcta.',
    );
  }
  const hash = await hashContrasena(nueva);
  await db.transaction().execute(async (tx) => {
    await tx
      .updateTable('auth_account')
      .set({ password: hash, updated_at: new Date() })
      .where('id', '=', cuenta.id)
      .execute();
    await tx
      .updateTable('usuario')
      .set({ debe_cambiar_contrasena: false, actualizado_por: actor.usuarioId })
      .where('id', '=', actor.usuarioId)
      .execute();
    await tx
      .deleteFrom('auth_session')
      .where('user_id', '=', actor.usuarioId)
      .where('id', '!=', actor.sesionId)
      .execute();
  });
};
