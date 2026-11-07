// Crea un supervisor con contraseña temporal. Pensado para el primer acceso de una instalación:
//   docker compose -f infra/demo/docker-compose.demo.yml run --rm api \
//     node src/crear-supervisor.ts DNI 12345678 "Nombre Apellido"
// La contraseña se muestra una sola vez en la terminal y no queda guardada en ningún archivo.
import { crearDb, crearPool } from '@campo/db';
import { randomBytes } from 'node:crypto';
import { crearUsuario } from './modulos/usuarios/servicio.ts';

const [tipo, numero, ...nombre] = process.argv.slice(2);
const url = process.env['DATABASE_URL'];
if (tipo === undefined || numero === undefined || nombre.length === 0 || url === undefined) {
  console.error(
    'Uso: node src/crear-supervisor.ts <tipo> <número> "<nombre completo>"  (requiere DATABASE_URL)',
  );
  process.exit(1);
}

const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const contrasena = Array.from(randomBytes(14), (b) => alfabeto[b % alfabeto.length] ?? 'x').join(
  '',
);
const pool = crearPool(url, 1);
try {
  await crearUsuario(crearDb(pool), {
    tipoDocumento: tipo,
    numDocumento: numero,
    nombre: nombre.join(' '),
    rolGlobal: 'supervisor',
    contrasena,
    creadoPor: null,
  });
  console.log(
    `Supervisor creado. Ingrese con ${tipo.toUpperCase()} ${numero} y la contraseña temporal: ${contrasena}`,
  );
} catch (e) {
  console.error(e instanceof Error ? e.message : 'No se pudo crear el supervisor.');
  process.exitCode = 1;
} finally {
  await pool.end();
}
