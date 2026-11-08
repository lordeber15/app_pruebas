import { sql, type Kysely } from 'kysely';

/**
 * Cambio de contraseña en el primer ingreso (decisión del usuario, 2026-11-07). Solo expande:
 * `usuario.debe_cambiar_contrasena`. El alta y el restablecimiento entregan una contraseña
 * temporal y dejan la marca; la API no deja hacer nada más hasta cambiarla. Los usuarios que ya
 * existen tienen contraseñas generadas por el sistema: también deben cambiarla al entrar.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE app.usuario ADD COLUMN debe_cambiar_contrasena boolean NOT NULL DEFAULT true;
  `.execute(db);
}
