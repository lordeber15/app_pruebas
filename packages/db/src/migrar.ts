// Aplica las migraciones pendientes con el rol app_migrator (doc. 03 §11.2). Nunca con postgres.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { aplicarMigraciones } from './migraciones.ts';

const url = process.env['DATABASE_URL_MIGRATIONS'];
if (url === undefined || url === '') {
  console.error('Falta DATABASE_URL_MIGRATIONS (ver .env.example).');
  process.exit(1);
}

const carpeta = path.join(import.meta.dirname, '..', 'migrations');
await fs.access(carpeta);
const ok = await aplicarMigraciones(url, carpeta, console);
process.exit(ok ? 0 : 1);
