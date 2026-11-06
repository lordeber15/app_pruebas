import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Kysely, PostgresDialect } from 'kysely';
import { FileMigrationProvider, Migrator } from 'kysely/migration';
import pg from 'pg';

interface Registro {
  log: (mensaje: string) => void;
  error: (mensaje: string, ...extra: unknown[]) => void;
}

/** Aplica todas las migraciones pendientes. Devuelve `false` si alguna falló. */
export const aplicarMigraciones = async (
  url: string,
  carpeta: string,
  registro: Registro,
): Promise<boolean> => {
  const db = new Kysely<unknown>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 1 }) }),
  });
  try {
    const migrator = new Migrator({
      db,
      provider: new FileMigrationProvider({ fs, path, migrationFolder: carpeta }),
      migrationTableSchema: 'app',
    });
    const { error, results } = await migrator.migrateToLatest();
    for (const r of results ?? []) {
      if (r.status === 'Success') registro.log(`Migración aplicada: ${r.migrationName}`);
      else if (r.status === 'Error') registro.error(`Falló la migración: ${r.migrationName}`);
    }
    if (error !== undefined) {
      registro.error('No se pudieron aplicar las migraciones.', error);
      return false;
    }
    if ((results ?? []).length === 0) registro.log('Sin migraciones pendientes.');
    return true;
  } finally {
    await db.destroy();
  }
};
