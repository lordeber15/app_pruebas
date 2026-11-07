import { crearPool } from '@campo/db';
import { crearApp } from './app.ts';
import { leerConfig } from './config.ts';

const config = leerConfig();
const pool = crearPool(config.DATABASE_URL);
const { app } = await crearApp(config, pool);

const cerrar = async (): Promise<void> => {
  await app.close();
  await pool.end();
};
process.once('SIGTERM', () => void cerrar());
process.once('SIGINT', () => void cerrar());

await app.listen({ port: config.PORT, host: config.HOST });
