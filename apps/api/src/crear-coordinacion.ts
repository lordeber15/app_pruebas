// Crea un usuario de Coordinación con contraseña temporal. Pensado para el primer acceso de una
// instalación (Coordinación configura el proyecto y administra usuarios, ERS §2.3):
//   docker compose -f infra/demo/docker-compose.demo.yml run --rm api \
//     node src/crear-coordinacion.ts DNI 12345678 "Nombre Apellido"
// La contraseña se muestra una sola vez en la terminal y no queda guardada en ningún archivo.
import { crearDb, crearPool } from '@campo/db';
import { generarContrasenaTemporal } from '@campo/core';
import { randomBytes } from 'node:crypto';
import { crearUsuario } from './modulos/usuarios/servicio.ts';

const [tipo, numero, ...nombre] = process.argv.slice(2);
const url = process.env['DATABASE_URL'];
if (tipo === undefined || numero === undefined || nombre.length === 0 || url === undefined) {
  console.error(
    'Uso: node src/crear-coordinacion.ts <tipo> <número> "<nombre completo>"  (requiere DATABASE_URL)',
  );
  process.exit(1);
}

const contrasena = generarContrasenaTemporal((n) => randomBytes(n), 14);
const pool = crearPool(url, 1);
try {
  await crearUsuario(crearDb(pool), {
    tipoDocumento: tipo,
    numDocumento: numero,
    nombre: nombre.join(' '),
    rolGlobal: 'coordinacion',
    contrasena,
    creadoPor: null,
  });
  console.log(
    `Usuario de Coordinación creado. Ingrese con ${tipo.toUpperCase()} ${numero} y la contraseña temporal: ${contrasena} (al entrar le pedirá cambiarla)`,
  );
} catch (e) {
  console.error(e instanceof Error ? e.message : 'No se pudo crear el usuario.');
  process.exitCode = 1;
} finally {
  await pool.end();
}
