import { crearDb, crearPool } from '@campo/db';
import { pino } from 'pino';
import { crearAlmacenamiento, crearCliente } from './almacenamiento.ts';
import { leerConfig } from './config.ts';
import { iniciarTrabajos } from './trabajos.ts';

const config = leerConfig();
const log = pino({ level: config.NODE_ENV === 'production' ? 'info' : 'debug' });
const pool = crearPool(config.DATABASE_URL_WORKER, 5);
const db = crearDb(pool);
const almacen = crearAlmacenamiento(crearCliente(config), config.S3_BUCKET_ARCHIVOS);

const worker = await iniciarTrabajos(config.DATABASE_URL_WORKER, db, almacen, log);
log.info('worker iniciado');

const detener = async (): Promise<void> => {
  await worker.detener();
  await pool.end();
};
process.once('SIGTERM', () => void detener());
process.once('SIGINT', () => void detener());
