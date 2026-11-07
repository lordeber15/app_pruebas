// Carga la configuración TOCE (D01 + A01) en un proyecto. Se ejecuta con el rol app_rw.
//   node src/cargar-toce.ts --proyecto <uuid> [--usuario <uuid>]
//   node src/cargar-toce.ts --crear "TOCE" [--usuario <uuid>]      (crea el proyecto y lo carga)
// En la demo: docker compose -f infra/demo/docker-compose.demo.yml run --rm api \
//   node ../../packages/db/src/cargar-toce.ts --crear "TOCE"
import { crearGeneradorUuidV7 } from '@campo/core';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { cargarToce } from './semillas/toce.ts';

const args = process.argv.slice(2);
const valor = (bandera: string): string | undefined => {
  const i = args.indexOf(bandera);
  return i >= 0 ? args[i + 1] : undefined;
};
const url = process.env['DATABASE_URL'];
const proyectoArg = valor('--proyecto');
const crear = valor('--crear');
const usuario = valor('--usuario') ?? null;

if (url === undefined || url === '' || (proyectoArg === undefined && crear === undefined)) {
  console.error(
    'Uso: node src/cargar-toce.ts (--proyecto <uuid> | --crear "<nombre>") [--usuario <uuid>]  (requiere DATABASE_URL)',
  );
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 1 });
const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
try {
  let proyectoId = proyectoArg;
  if (proyectoId === undefined) {
    const uuid = crearGeneradorUuidV7((n) => globalThis.crypto.getRandomValues(new Uint8Array(n)));
    proyectoId = uuid();
    await sql`INSERT INTO app.proyecto (id, nombre, validacion_activa, creado_por)
              VALUES (${proyectoId}, ${crear ?? 'TOCE'}, false, ${usuario})`.execute(db);
    console.log(`Proyecto creado: ${proyectoId}`);
  }
  const resumen = await cargarToce(db, { proyectoId, usuarioId: usuario });
  console.log('Configuración TOCE cargada:', resumen);
} catch (e) {
  console.error(e instanceof Error ? e.message : 'No se pudo cargar la configuración TOCE.');
  process.exitCode = 1;
} finally {
  await db.destroy();
}
