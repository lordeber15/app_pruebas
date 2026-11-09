import type { RolBrigada, ValorRolGlobal } from '@campo/core';
import { crearDb, crearPool, type Db } from '@campo/db';
import { iniciarBaseDePrueba, type BaseDePrueba } from '@campo/db/pruebas';
import { generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { sql } from 'kysely';
import type pg from 'pg';
import { crearApp, type Aplicacion } from '../src/app.ts';
import { leerConfig } from '../src/config.ts';
import { crearUsuario } from '../src/modulos/usuarios/servicio.ts';
import { generarId } from '../src/plataforma/ids.ts';

/** Secreto de los hooks de tusd en las pruebas. */
export const SECRETO_HOOKS = randomBytes(24).toString('hex');

export interface Entorno extends Aplicacion {
  readonly base: BaseDePrueba;
  readonly pool: pg.Pool;
  /** Conexión de administración (app_migrator) para preparar estados que la API no expone aún. */
  readonly admin: Db;
  readonly cerrar: () => Promise<void>;
}

export const iniciarEntorno = async (): Promise<Entorno> => {
  const base = await iniciarBaseDePrueba();
  const config = leerConfig({
    NODE_ENV: 'test',
    DATABASE_URL: base.url('app_rw'),
    BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
    BETTER_AUTH_URL: 'http://localhost',
    WEB_ORIGIN: 'http://localhost:5173',
    TUSD_HOOK_SECRET: SECRETO_HOOKS,
    // Las pruebas de la API no leen objetos: solo firman URLs.
    S3_ENDPOINT: 'http://127.0.0.1:9',
    S3_PUBLIC_ENDPOINT: 'http://almacen.prueba',
    S3_REGION: 'us-east-1',
    S3_BUCKET_ARCHIVOS: 'archivos',
    S3_ACCESS_KEY_APP: 'prueba',
    S3_SECRET_KEY_APP: 'prueba-secreta',
    // Todas las solicitudes de prueba salen de la misma IP.
    RATE_LIMIT_LOGIN_IP: '1000',
  });
  const pool = crearPool(config.DATABASE_URL, 5);
  const poolAdmin = crearPool(base.url('app_migrator'), 2);
  const aplicacion = await crearApp(config, pool);
  await aplicacion.app.ready();
  return {
    ...aplicacion,
    base,
    pool,
    admin: crearDb(poolAdmin),
    cerrar: async () => {
      await aplicacion.app.close();
      await pool.end();
      await poolAdmin.end();
      await base.detener();
    },
  };
};

let secuenciaDocumento = 40_000_000;

/** Crea un usuario sintético y devuelve su id, su username y su contraseña. */
export const nuevoUsuario = async (
  e: Entorno,
  rolGlobal: ValorRolGlobal = 'ninguno',
): Promise<{ id: string; username: string; contrasena: string }> => {
  const numDocumento = String(secuenciaDocumento++);
  const contrasena = `Aa1${randomBytes(12).toString('base64url')}`;
  const id = await crearUsuario(e.db, {
    tipoDocumento: 'DNI',
    numDocumento,
    nombre: 'Usuario Sintético',
    rolGlobal,
    contrasena,
    creadoPor: null,
    // Las pruebas en general usan usuarios que ya cambiaron su contraseña temporal.
    debeCambiarContrasena: false,
  });
  return { id, username: `dni.${numDocumento}`, contrasena };
};

export const entrar = async (e: Entorno, username: string, password: string) =>
  e.app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/username',
    payload: { username, password },
  });

/** Token de sesión (plugin bearer) tras un login correcto. */
export const tokenDe = async (e: Entorno, username: string, password: string): Promise<string> => {
  const r = await entrar(e, username, password);
  const token = r.headers['set-auth-token'];
  if (r.statusCode !== 200 || typeof token !== 'string') {
    throw new Error(`Login falló en la prueba: ${String(r.statusCode)}`);
  }
  return token;
};

export const conToken = (token: string) => ({ authorization: `Bearer ${token}` });

export interface LlaveDispositivo {
  readonly privada: KeyObject;
  readonly publicaSpki: string;
}

export const nuevaLlave = (): LlaveDispositivo => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    privada: privateKey,
    publicaSpki: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  };
};

export const firmar = (llave: KeyObject, mensaje: string): string =>
  sign('sha256', Buffer.from(mensaje, 'utf8'), { key: llave, dsaEncoding: 'ieee-p1363' }).toString(
    'base64url',
  );

/** Login + activación: devuelve el token de una sesión vinculada a un dispositivo nuevo. */
export const usuarioConDispositivo = async (e: Entorno) => {
  const u = await nuevoUsuario(e);
  const token = await tokenDe(e, u.username, u.contrasena);
  const llave = nuevaLlave();
  const r = await e.app.inject({
    method: 'POST',
    url: '/api/v1/dispositivos/activar',
    headers: conToken(token),
    payload: {
      plataforma: 'android',
      llave_publica: llave.publicaSpki,
      version_app: '0.1.0',
      token_push: null,
    },
  });
  const { dispositivo_id: dispositivoId } = r.json<{ dispositivo_id: string }>();
  return { usuario: u, token, llave, dispositivoId };
};

// ── Escenario TOCE sintético ──────────────────────────────────────────────────

/**
 * Proyecto con su configuración por método (mínima), una estación, dos brigadas (A y B) y la
 * reserva estación × método de la brigada A. Hay un método con reserva («todas») y un EVENTO.
 */
export interface Escenario {
  readonly proyectoId: string;
  readonly brigadaId: string;
  readonly brigadaB: string;
  readonly estacionId: string;
  readonly metodoId: string;
  readonly eventoId: string;
  readonly reservaId: string;
}

let secuenciaEscenario = 0;

export const nuevoEscenario = async (e: Entorno): Promise<Escenario> => {
  const n = String(secuenciaEscenario++);
  const [proyectoId, brigadaId, brigadaB, estacionId, configuracionId, especialidadId] = [
    generarId(),
    generarId(),
    generarId(),
    generarId(),
    generarId(),
    generarId(),
  ];
  const [metodoId, eventoId, reservaId] = [generarId(), generarId(), generarId()];
  await e.admin
    .insertInto('proyecto')
    .values({ id: proyectoId, nombre: `Proyecto sintético ${n}`, validacion_activa: false })
    .execute();
  await e.admin
    .insertInto('brigada')
    .values([
      { id: brigadaId, proyecto_id: proyectoId, nombre: `Brigada A ${n}`, codigo: `A${n}` },
      { id: brigadaB, proyecto_id: proyectoId, nombre: `Brigada B ${n}`, codigo: `B${n}` },
    ])
    .execute();
  await e.admin
    .insertInto('estacion')
    .values({
      id: estacionId,
      proyecto_id: proyectoId,
      codigo: `EST-${n}`,
      geom: sql<string>`ST_SetSRID(ST_MakePoint(-77.03, -12.04), 4326)`,
    })
    .execute();
  await e.admin
    .insertInto('configuracion_metodologica')
    .values({ id: configuracionId, proyecto_id: proyectoId, numero: 1, origen: 'prueba' })
    .execute();
  await e.admin
    .insertInto('especialidad')
    .values({
      id: especialidadId,
      proyecto_id: proyectoId,
      codigo: 'mamiferos',
      nombre: 'Mamíferos',
      es_fauna: true,
    })
    .execute();
  await e.admin
    .insertInto('metodo')
    .values([
      {
        id: metodoId,
        configuracion_id: configuracionId,
        especialidad_id: especialidadId,
        codigo: 'mamiferos.sherman',
        nombre: 'Trampas Sherman',
        clase: 'todas',
        tipo_geometria: 'punto',
        config: '{}',
      },
      {
        id: eventoId,
        configuracion_id: configuracionId,
        especialidad_id: especialidadId,
        codigo: 'mamiferos.oportunos',
        nombre: 'Registros oportunos',
        clase: 'evento',
        tipo_geometria: 'punto',
        config: '{}',
      },
    ])
    .execute();
  await e.admin
    .insertInto('reserva')
    .values({
      id: reservaId,
      proyecto_id: proyectoId,
      estacion_id: estacionId,
      metodo_id: metodoId,
      brigada_id: brigadaId,
      titulo: `EST-${n} · Trampas Sherman`,
      estado: 'asignada',
    })
    .execute();
  return { proyectoId, brigadaId, brigadaB, estacionId, metodoId, eventoId, reservaId };
};

export const agregarMiembro = (
  e: Entorno,
  brigadaId: string,
  usuarioId: string,
  rol: RolBrigada = 'especialista',
) =>
  e.admin
    .insertInto('miembro_brigada')
    .values({ id: generarId(), brigada_id: brigadaId, usuario_id: usuarioId, rol })
    .execute();

/** Miembro de una brigada con su dispositivo activado. */
export const enCampo = async (e: Entorno, brigadaId: string, rol: RolBrigada = 'especialista') => {
  const d = await usuarioConDispositivo(e);
  await agregarMiembro(e, brigadaId, d.usuario.id, rol);
  return d;
};

export const enviarLote = (e: Entorno, token: string, eventos: unknown[]) =>
  e.app.inject({
    method: 'POST',
    url: '/api/v1/sync/eventos',
    headers: conToken(token),
    payload: { eventos },
  });

// ── Eventos de campo ────────────────────────────────────────────────────────

export const HORA = '2026-12-02T19:10:00.000-05:00';
export const HASH = 'cd'.repeat(32);

export const sobre = <P>(tipo: string, entidad: { tipo: string; id: string }, payload: P) => ({
  id: generarId(),
  tipo,
  version_esquema: 1,
  entidad,
  hora_dispositivo: HORA,
  ubicacion: { lat: -10.1, lon: -75.2, precision_m: 6 },
  payload,
});

export const abrir = (
  ejecucionId: string,
  r: { reservaId: string | null; estacionId: string; metodoId: string },
) =>
  sobre(
    'ejecucion_abierta',
    { tipo: 'ejecucion', id: ejecucionId },
    {
      ejecucion_id: ejecucionId,
      reserva_id: r.reservaId,
      estacion_id: r.estacionId,
      metodo_id: r.metodoId,
      abierta_en: HORA,
    },
  );

export interface Foto {
  readonly tipo?: 'foto' | 'audio';
  readonly hashPreview?: string;
  readonly hashOriginal?: string | null;
  readonly tamanoPreview?: number;
  readonly tamanoOriginal?: number | null;
}

export const foto = (
  ejecucionId: string,
  unidadId: string | null,
  archivoId: string = generarId(),
  f: Foto = {},
) => {
  const original = f.hashOriginal ?? null;
  return sobre(
    'archivo_capturado',
    { tipo: 'archivo', id: archivoId },
    {
      archivo_id: archivoId,
      tipo: f.tipo ?? 'foto',
      hash_preview: f.hashPreview ?? HASH,
      hash_original: original,
      tamanos: {
        preview: f.tamanoPreview ?? 800_000,
        original: original === null ? null : (f.tamanoOriginal ?? 6_000_000),
      },
      capturado_en: HORA,
      ejecucion_id: ejecucionId,
      unidad_id: unidadId,
      tipo_foto: (f.tipo ?? 'foto') === 'foto' ? 'contexto' : null,
      orientacion: (f.tipo ?? 'foto') === 'foto' ? 'N' : null,
      candidata_reporte: (f.tipo ?? 'foto') === 'foto',
    },
  );
};

export const cerrar = (
  ejecucionId: string,
  archivoIds: string[],
  desviacion = { tipo: 'ninguna', explicacion: null as string | null },
  /** T-10; sin valor se omite, como lo envía un celular N−1. */
  interrupciones?: unknown[],
) =>
  sobre(
    'ejecucion_cerrada',
    { tipo: 'ejecucion', id: ejecucionId },
    {
      ejecucion_id: ejecucionId,
      cerrada_en: '2026-12-02T20:00:00.000-05:00',
      datos: {},
      desviacion,
      confirmaciones: [],
      objetivo_campo: null,
      archivo_ids: archivoIds,
      ...(interrupciones === undefined ? {} : { interrupciones }),
    },
  );

export type Resultado = { id: string; estado: string; motivo?: string };

/** Envía un lote y devuelve los resultados por evento (el lote en sí debe responder 200). */
export const lote = async (e: Entorno, token: string, eventos: unknown[]) => {
  const r = await enviarLote(e, token, eventos);
  if (r.statusCode !== 200) throw new Error(`El lote respondió ${String(r.statusCode)}: ${r.body}`);
  return r.json<{ resultados: Resultado[] }>().resultados;
};

/** Ejecución propia abierta con una foto anunciada (manifiesto aplicado). */
export const ejecucionConFoto = async (
  e: Entorno,
  esc: Escenario,
  yo: { token: string },
  f: Foto = {},
) => {
  const ejecucionId = generarId();
  const archivoId = generarId();
  const r = await lote(e, yo.token, [
    abrir(ejecucionId, esc),
    foto(ejecucionId, null, archivoId, f),
  ]);
  if (r.some((x) => x.estado !== 'aplicado')) {
    throw new Error(`No se aplicó: ${JSON.stringify(r)}`);
  }
  return { ejecucionId, archivoId };
};

// ── Roles para pruebas web ─────────────────────────────────────────────────

export interface Persona {
  readonly id: string;
  readonly token: string;
  readonly username: string;
  readonly contrasena: string;
}

export const persona = async (
  e: Entorno,
  rolGlobal: ValorRolGlobal = 'ninguno',
): Promise<Persona> => {
  const u = await nuevoUsuario(e, rolGlobal);
  return { ...u, token: await tokenDe(e, u.username, u.contrasena) };
};

/**
 * Personas de un escenario con los roles TOCE (ERS §2.2): Coordinación, Jefe de Proyecto y
 * Administrador técnico (globales); en la brigada A, Jefe de Brigada, Supervisor de campo y
 * especialista; en la B, Jefe de Brigada y especialista.
 */
export const organizacion = async (e: Entorno) => {
  const esc = await nuevoEscenario(e);
  const [
    coordinacion,
    jefeProyecto,
    admin,
    jefeA,
    jefeB,
    supervisorA,
    especialista,
    especialistaB,
  ] = await Promise.all([
    persona(e, 'coordinacion'),
    persona(e, 'jefe_proyecto'),
    persona(e, 'admin'),
    persona(e),
    persona(e),
    persona(e),
    persona(e),
    persona(e),
  ]);
  await agregarMiembro(e, esc.brigadaId, jefeA.id, 'jefe_brigada');
  await agregarMiembro(e, esc.brigadaB, jefeB.id, 'jefe_brigada');
  await agregarMiembro(e, esc.brigadaId, supervisorA.id, 'supervisor_campo');
  await agregarMiembro(e, esc.brigadaId, especialista.id);
  await agregarMiembro(e, esc.brigadaB, especialistaB.id);
  return {
    esc,
    coordinacion,
    jefeProyecto,
    admin,
    jefeA,
    jefeB,
    supervisorA,
    especialista,
    especialistaB,
  };
};

export type Organizacion = Awaited<ReturnType<typeof organizacion>>;

export const pedir = (
  e: Entorno,
  token: string,
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  payload?: object,
) =>
  e.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: conToken(token),
    ...(payload === undefined ? {} : { payload }),
  });
