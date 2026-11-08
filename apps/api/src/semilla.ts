// Datos sintéticos para desarrollo local. Nunca se ejecuta fuera de development.
import { crearDb, crearPool } from '@campo/db';
import { randomBytes } from 'node:crypto';
import { crearUsuario } from './modulos/usuarios/servicio.ts';
import { generarId } from './plataforma/ids.ts';

if (process.env['NODE_ENV'] !== 'development') {
  console.error('La semilla solo corre con NODE_ENV=development.');
  process.exit(1);
}
const url = process.env['DATABASE_URL'];
if (url === undefined) {
  console.error('Falta DATABASE_URL.');
  process.exit(1);
}

const pool = crearPool(url, 2);
const db = crearDb(pool);

const usuarios = [
  { numDocumento: '70000001', nombre: 'Coordinadora Sintética', rolGlobal: 'coordinacion' },
  { numDocumento: '70000002', nombre: 'Especialista Sintético', rolGlobal: 'ninguno' },
] as const;

for (const u of usuarios) {
  const existe = await db
    .selectFrom('usuario')
    .select('id')
    .where('tipo_documento', '=', 'DNI')
    .where('num_documento', '=', u.numDocumento)
    .executeTakeFirst();
  if (existe !== undefined) {
    console.log(`DNI ${u.numDocumento}: ya existe`);
    continue;
  }
  // Contraseña aleatoria por ejecución: se muestra una sola vez y no se guarda en ningún archivo.
  const contrasena = randomBytes(9).toString('base64url');
  await crearUsuario(db, { tipoDocumento: 'DNI', ...u, contrasena, creadoPor: null });
  console.log(`DNI ${u.numDocumento} (${u.rolGlobal}): contraseña ${contrasena}`);
}

// Si ya se cargó TOCE (`pnpm --filter @campo/db db:toce`), el especialista entra a SELVA 2 para
// poder descargar su paquete de campo en el celular.
const especialista = await db
  .selectFrom('usuario')
  .select('id')
  .where('tipo_documento', '=', 'DNI')
  .where('num_documento', '=', '70000002')
  .executeTakeFirst();
const selva2 = await db
  .selectFrom('brigada')
  .select(['id', 'nombre'])
  .where('codigo', '=', 'SELVA 2')
  .orderBy('creado_en', 'desc')
  .executeTakeFirst();
if (especialista !== undefined && selva2 !== undefined) {
  const yaEs = await db
    .selectFrom('miembro_brigada')
    .select('id')
    .where('brigada_id', '=', selva2.id)
    .where('usuario_id', '=', especialista.id)
    .executeTakeFirst();
  if (yaEs === undefined) {
    await db
      .insertInto('miembro_brigada')
      .values({
        id: generarId(),
        brigada_id: selva2.id,
        usuario_id: especialista.id,
        rol: 'especialista',
      })
      .execute();
  }
  console.log(`DNI 70000002: especialista de la brigada ${selva2.nombre}`);
}

await db.destroy();
