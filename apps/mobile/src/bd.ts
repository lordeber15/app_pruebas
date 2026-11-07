import { open, type DB, type Scalar } from '@op-engineering/op-sqlite';

/**
 * Base local (doc. 02 §8.4). Sin cifrado propio (ADR-010, ⚑ C5).
 * - paquete_*: copia de lo descargado.
 * - outbox: eventos pendientes; se envían en orden y se conservan 7 días tras su resultado.
 * - archivo_local: archivos por variante con su estado de subida.
 */
let bd: DB | null = null;

const ESQUEMA = [
  `CREATE TABLE IF NOT EXISTS paquete_tarea (
     id TEXT PRIMARY KEY, asignacion_id TEXT, proyecto_id TEXT NOT NULL, cuaderno_titulo TEXT,
     titulo TEXT NOT NULL, descripcion TEXT, tipo TEXT NOT NULL, estado TEXT NOT NULL,
     estado_local TEXT NOT NULL DEFAULT 'descargada', estacion_id TEXT, metodologia_id TEXT,
     lat REAL, lon REAL, validacion_activa INTEGER NOT NULL DEFAULT 0, revocada INTEGER NOT NULL DEFAULT 0,
     motivo_revocacion TEXT, actualizado_en TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS paquete_metodologia (
     id TEXT PRIMARY KEY, estacion_id TEXT NOT NULL, metodologia_id TEXT NOT NULL, nombre TEXT NOT NULL,
     unidad TEXT NOT NULL, meta_esfuerzo REAL, requiere_transecto INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS paquete_estacion (id TEXT PRIMARY KEY, codigo TEXT NOT NULL, lat REAL, lon REAL)`,
  `CREATE TABLE IF NOT EXISTS evidencia_local (
     id TEXT PRIMARY KEY, tarea_id TEXT NOT NULL, descripcion TEXT NOT NULL, orden INTEGER NOT NULL, creado_en TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS esfuerzo_local (
     id TEXT PRIMARY KEY, tarea_id TEXT NOT NULL, estacion_metodologia_id TEXT NOT NULL, fase TEXT NOT NULL,
     cantidad REAL NOT NULL, fecha TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS comentario_local (
     id TEXT PRIMARY KEY, tarea_id TEXT NOT NULL, texto TEXT NOT NULL, propio INTEGER NOT NULL, creado_en TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS outbox (
     id TEXT PRIMARY KEY, tipo TEXT NOT NULL, cuerpo TEXT NOT NULL, creado_en TEXT NOT NULL,
     estado TEXT NOT NULL DEFAULT 'pendiente', resultado TEXT, motivo TEXT, intentos INTEGER NOT NULL DEFAULT 0,
     resuelto_en TEXT)`,
  `CREATE TABLE IF NOT EXISTS archivo_local (
     id TEXT PRIMARY KEY, tarea_id TEXT NOT NULL, evidencia_item_id TEXT, tipo TEXT NOT NULL,
     uri TEXT NOT NULL, sha256 TEXT NOT NULL, tamano INTEGER NOT NULL, capturado_en TEXT NOT NULL,
     estado TEXT NOT NULL DEFAULT 'pendiente', url_subida TEXT, prioridad INTEGER NOT NULL DEFAULT 3)`,
  `CREATE TABLE IF NOT EXISTS sync_estado (clave TEXT PRIMARY KEY, valor TEXT)`,
  `CREATE TABLE IF NOT EXISTS jornada_local (id TEXT PRIMARY KEY, abierta_en TEXT NOT NULL, cerrada_en TEXT)`,
  // Modelo TOCE: el paquete de campo se guarda entero (JSON) y lo trabajado en campo, por filas.
  `CREATE TABLE IF NOT EXISTS paquete_campo (clave TEXT PRIMARY KEY, contenido TEXT NOT NULL, descargado_en TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ejecucion_local (
     id TEXT PRIMARY KEY, tarea_id TEXT, estacion_id TEXT NOT NULL, metodo_id TEXT NOT NULL,
     estado_local TEXT NOT NULL DEFAULT 'en_curso', abierta_en TEXT NOT NULL, cerrada_en TEXT,
     datos TEXT NOT NULL DEFAULT '{}', desviacion_tipo TEXT NOT NULL DEFAULT 'ninguna', desviacion_explicacion TEXT,
     confirmaciones TEXT NOT NULL DEFAULT '[]', objetivo_campo REAL, incumplimientos INTEGER, advertencias INTEGER)`,
  `CREATE TABLE IF NOT EXISTS unidad_local (
     id TEXT PRIMARY KEY, ejecucion_id TEXT NOT NULL, codigo TEXT NOT NULL, tipo_unidad TEXT NOT NULL,
     orden INTEGER NOT NULL, estado TEXT NOT NULL DEFAULT 'abierta', geometria TEXT, inicio TEXT, fin TEXT,
     datos TEXT NOT NULL DEFAULT '{}', registros TEXT NOT NULL DEFAULT '[]', unidad_vinculada_id TEXT,
     parametros TEXT NOT NULL DEFAULT '[]', evento_id TEXT, actualizado_en TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS track_local (
     id TEXT PRIMARY KEY, ejecucion_id TEXT NOT NULL, unidad_id TEXT NOT NULL, puntos TEXT NOT NULL DEFAULT '[]',
     enviado INTEGER NOT NULL DEFAULT 0)`,
];

/** Columnas agregadas después de la primera versión (SQLite no tiene ADD COLUMN IF NOT EXISTS). */
const COLUMNAS: readonly [tabla: string, columna: string, definicion: string][] = [
  ['archivo_local', 'ejecucion_id', 'TEXT'],
  ['archivo_local', 'unidad_id', 'TEXT'],
  ['archivo_local', 'tipo_foto', 'TEXT'],
  ['archivo_local', 'orientacion', 'TEXT'],
  ['archivo_local', 'candidata', 'INTEGER NOT NULL DEFAULT 0'],
];

export const abrirBd = async (): Promise<DB> => {
  if (bd !== null) return bd;
  const nueva = open({ name: 'campo.sqlite' });
  for (const sql of ESQUEMA) await nueva.execute(sql);
  for (const [tabla, columna, definicion] of COLUMNAS) {
    const r = await nueva.execute(`PRAGMA table_info(${tabla})`);
    if (!r.rows.some((c) => c['name'] === columna)) {
      await nueva.execute(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${definicion}`);
    }
  }
  bd = nueva;
  return nueva;
};

export const consultar = async <T>(sql: string, params: Scalar[] = []): Promise<T[]> => {
  const r = await (await abrirBd()).execute(sql, params);
  return r.rows as T[];
};

export const ejecutar = async (sql: string, params: Scalar[] = []): Promise<void> => {
  await (await abrirBd()).execute(sql, params);
};

export const leerEstadoSync = async (clave: string): Promise<string | null> =>
  (
    await consultar<{ valor: string | null }>('SELECT valor FROM sync_estado WHERE clave = ?', [
      clave,
    ])
  )[0]?.valor ?? null;

export const guardarEstadoSync = (clave: string, valor: string) =>
  ejecutar(
    'INSERT INTO sync_estado (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor',
    [clave, valor],
  );

/** Baja remota (RF-M17) o cierre de sesión: borra el paquete y todo lo local. */
export const borrarTodo = async (): Promise<void> => {
  const b = await abrirBd();
  for (const t of [
    'paquete_tarea',
    'paquete_metodologia',
    'paquete_estacion',
    'evidencia_local',
    'esfuerzo_local',
    'comentario_local',
    'outbox',
    'archivo_local',
    'sync_estado',
    'jornada_local',
    'paquete_campo',
    'ejecucion_local',
    'unidad_local',
    'track_local',
  ]) {
    await b.execute(`DELETE FROM ${t}`);
  }
};
