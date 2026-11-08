import { open, type DB, type Scalar } from '@op-engineering/op-sqlite';

/**
 * Base local (doc. 02 §8.4). Sin cifrado propio (ADR-010, ⚑ C5).
 * - paquete_campo: copia del paquete de campo TOCE (configuración, cronograma y reservas).
 * - ejecucion_local, unidad_local, track_local: lo trabajado en campo.
 * - outbox: eventos pendientes; se envían en orden y se conservan 7 días tras su resultado.
 * - archivo_local: fotos con su estado de subida; se borran solo al confirmar su hash (RN-17).
 */
let bd: DB | null = null;

const ESQUEMA = [
  `CREATE TABLE IF NOT EXISTS outbox (
     id TEXT PRIMARY KEY, tipo TEXT NOT NULL, cuerpo TEXT NOT NULL, creado_en TEXT NOT NULL,
     estado TEXT NOT NULL DEFAULT 'pendiente', resultado TEXT, motivo TEXT, intentos INTEGER NOT NULL DEFAULT 0,
     resuelto_en TEXT)`,
  `CREATE TABLE IF NOT EXISTS archivo_local (
     id TEXT PRIMARY KEY, tipo TEXT NOT NULL, uri TEXT NOT NULL, sha256 TEXT NOT NULL, tamano INTEGER NOT NULL,
     capturado_en TEXT NOT NULL, estado TEXT NOT NULL DEFAULT 'pendiente', url_subida TEXT,
     prioridad INTEGER NOT NULL DEFAULT 3, ejecucion_id TEXT, unidad_id TEXT, tipo_foto TEXT, orientacion TEXT,
     candidata INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS sync_estado (clave TEXT PRIMARY KEY, valor TEXT)`,
  `CREATE TABLE IF NOT EXISTS jornada_local (id TEXT PRIMARY KEY, abierta_en TEXT NOT NULL, cerrada_en TEXT)`,
  `CREATE TABLE IF NOT EXISTS paquete_campo (clave TEXT PRIMARY KEY, contenido TEXT NOT NULL, descargado_en TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ejecucion_local (
     id TEXT PRIMARY KEY, reserva_id TEXT, estacion_id TEXT NOT NULL, metodo_id TEXT NOT NULL,
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

/** Tablas locales del modelo anterior: se quitan al actualizar la app (no guardan fotos). */
const TABLAS_ANTERIORES = [
  'paquete_tarea',
  'paquete_metodologia',
  'paquete_estacion',
  'evidencia_local',
  'esfuerzo_local',
  'comentario_local',
];

const columnas = async (b: DB, tabla: string): Promise<string[]> =>
  (await b.execute(`PRAGMA table_info(${tabla})`)).rows.flatMap((c) =>
    typeof c['name'] === 'string' ? [c['name']] : [],
  );

/**
 * Celulares que ya tenían la versión anterior: la base pasa a los términos TOCE sin perder nada.
 * Las fotos antiguas (sin ejecución) se conservan con estado `anterior`: el servidor ya no las
 * acepta y el celular no intenta subirlas ni las borra.
 */
const actualizarEsquema = async (b: DB): Promise<void> => {
  for (const t of TABLAS_ANTERIORES) await b.execute(`DROP TABLE IF EXISTS ${t}`);
  const archivo = await columnas(b, 'archivo_local');
  for (const [columna, definicion] of [
    ['ejecucion_id', 'TEXT'],
    ['unidad_id', 'TEXT'],
    ['tipo_foto', 'TEXT'],
    ['orientacion', 'TEXT'],
    ['candidata', 'INTEGER NOT NULL DEFAULT 0'],
  ] as const) {
    if (!archivo.includes(columna)) {
      await b.execute(`ALTER TABLE archivo_local ADD COLUMN ${columna} ${definicion}`);
    }
  }
  if (archivo.includes('tarea_id')) {
    await b.execute('ALTER TABLE archivo_local RENAME TO archivo_local_anterior');
    await b.execute(ESQUEMA[1] ?? '');
    await b.execute(
      `INSERT INTO archivo_local (id, tipo, uri, sha256, tamano, capturado_en, estado, url_subida, prioridad,
         ejecucion_id, unidad_id, tipo_foto, orientacion, candidata)
       SELECT id, tipo, uri, sha256, tamano, capturado_en,
              CASE WHEN ejecucion_id IS NULL AND estado = 'pendiente' THEN 'anterior' ELSE estado END,
              url_subida, prioridad, ejecucion_id, unidad_id, tipo_foto, orientacion, candidata
         FROM archivo_local_anterior`,
    );
    await b.execute('DROP TABLE archivo_local_anterior');
  }
  if ((await columnas(b, 'ejecucion_local')).includes('tarea_id')) {
    await b.execute('ALTER TABLE ejecucion_local RENAME COLUMN tarea_id TO reserva_id');
  }
};

export const abrirBd = async (): Promise<DB> => {
  if (bd !== null) return bd;
  const nueva = open({ name: 'campo.sqlite' });
  for (const sql of ESQUEMA) await nueva.execute(sql);
  await actualizarEsquema(nueva);
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
