import type { Db } from '@campo/db';
import { usernameDeDocumento } from '../../plataforma/auth.ts';
import { hashContrasena } from '../../plataforma/contrasena.ts';
import { ProblemaHttp } from '../../plataforma/errores.ts';
import { generarId } from '../../plataforma/ids.ts';

export interface NuevoUsuario {
  readonly tipoDocumento: string;
  readonly numDocumento: string;
  readonly nombre: string;
  readonly rolGlobal: 'supervisor' | 'admin' | 'ninguno';
  readonly contrasena: string;
  readonly creadoPor: string | null;
}

/**
 * Crea el usuario del dominio y sus filas de Better Auth en una sola transacción.
 * El correo es sintético (ver migración 02): Better Auth lo exige y los usuarios entran con documento.
 */
export const crearUsuario = async (db: Db, nuevo: NuevoUsuario): Promise<string> => {
  const id = generarId();
  const tipo = nuevo.tipoDocumento.toUpperCase();
  const hash = await hashContrasena(nuevo.contrasena);
  try {
    await db.transaction().execute(async (tx) => {
      await tx
        .insertInto('usuario')
        .values({
          id,
          tipo_documento: tipo,
          num_documento: nuevo.numDocumento,
          nombre: nuevo.nombre,
          rol_global: nuevo.rolGlobal,
          creado_por: nuevo.creadoPor,
          actualizado_por: nuevo.creadoPor,
        })
        .execute();
      await tx
        .insertInto('auth_user')
        .values({
          id,
          name: '',
          email: `${id}@usuarios.invalid`,
          username: usernameDeDocumento(tipo, nuevo.numDocumento),
          display_username: null,
        })
        .execute();
      await tx
        .insertInto('auth_account')
        .values({
          id: generarId(),
          user_id: id,
          account_id: id,
          provider_id: 'credential',
          password: hash,
        })
        .execute();
    });
  } catch (e) {
    if ((e as { code?: string }).code === '23505') {
      throw new ProblemaHttp(409, 'USUARIO_EXISTE', 'Ya existe un usuario con ese documento.');
    }
    throw e;
  }
  return id;
};
