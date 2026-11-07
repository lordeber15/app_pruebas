// Datos sintéticos para desarrollo local. Nunca se ejecuta fuera de development.
import { crearDb, crearPool } from '@campo/db';
import { randomBytes } from 'node:crypto';
import { crearUsuario } from './modulos/usuarios/servicio.ts';

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
  { numDocumento: '70000001', nombre: 'Supervisora Sintética', rolGlobal: 'supervisor' },
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

await db.destroy();
