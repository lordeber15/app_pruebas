import { sql, type RawBuilder } from 'kysely';
import { z } from 'zod';
import { ProblemaHttp } from './errores.ts';

/**
 * Paginación por cursor (keyset) de las listas que crecen sin límite: ejecuciones, alertas y
 * revisiones. El orden es siempre (instante, id), así que es estable aunque dos filas compartan
 * el instante, y no salta ni duplica filas cuando llegan otras nuevas entre una página y otra.
 *
 * El cursor es opaco para el cliente (base64url de `{ t, i }`). `t` es el instante con
 * microsegundos, tal como lo guarda PostgreSQL: un `Date` de JavaScript los perdería y la
 * comparación saltaría filas. Se valida antes de usarlo; nunca se concatena en el SQL.
 */
const INSTANTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

const cursorSchema = z.object({ t: z.string().regex(INSTANTE), i: z.uuid() });
export type Cursor = z.infer<typeof cursorSchema>;

/** Instante de una columna `timestamptz` en UTC con microsegundos, para armar el cursor. */
export const instanteCursor = (columna: string): RawBuilder<string> =>
  sql<string>`to_char(${sql.ref(columna)} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export const codificarCursor = (c: Cursor): string =>
  Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');

export const decodificarCursor = (texto: string | undefined): Cursor | null => {
  if (texto === undefined) return null;
  let crudo: unknown;
  try {
    crudo = JSON.parse(Buffer.from(texto, 'base64url').toString('utf8'));
  } catch {
    crudo = null;
  }
  const r = cursorSchema.safeParse(crudo);
  if (!r.success) {
    throw new ProblemaHttp(
      400,
      'CURSOR_INVALIDO',
      'La página pedida no es válida. Vuelva a la primera página.',
    );
  }
  return r.data;
};

/**
 * Condición «después del cursor» para `ORDER BY instante <dir>, id <dir>`.
 * Compara la tupla completa, así que respeta el desempate por id.
 */
export const despuesDe = (
  columnaInstante: string,
  columnaId: string,
  cursor: Cursor,
  direccion: 'asc' | 'desc',
): RawBuilder<boolean> =>
  direccion === 'desc'
    ? sql<boolean>`(${sql.ref(columnaInstante)}, ${sql.ref(columnaId)}) < (${cursor.t}::timestamptz, ${cursor.i}::uuid)`
    : sql<boolean>`(${sql.ref(columnaInstante)}, ${sql.ref(columnaId)}) > (${cursor.t}::timestamptz, ${cursor.i}::uuid)`;

/**
 * Recorta a `limite` las filas pedidas con `limite + 1` y arma el siguiente cursor desde la
 * última fila de la página. Quita la columna auxiliar `_cursor_t` de la respuesta.
 */
export const pagina = <F extends { id: string; _cursor_t: string }>(
  filas: readonly F[],
  limite: number,
): { filas: Omit<F, '_cursor_t'>[]; siguiente_cursor: string | null } => {
  const hayMas = filas.length > limite;
  const visibles = hayMas ? filas.slice(0, limite) : filas;
  const ultima = visibles.at(-1);
  return {
    filas: visibles.map((f) => {
      const resto: Omit<F, '_cursor_t'> & { _cursor_t?: string } = { ...f };
      delete resto._cursor_t;
      return resto;
    }),
    siguiente_cursor:
      hayMas && ultima !== undefined
        ? codificarCursor({ t: ultima._cursor_t, i: ultima.id })
        : null,
  };
};
