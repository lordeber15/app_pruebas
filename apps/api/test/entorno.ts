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
  rolGlobal: 'supervisor' | 'admin' | 'ninguno' = 'ninguno',
): Promise<{ id: string; username: string; contrasena: string }> => {
  const numDocumento = String(secuenciaDocumento++);
  const contrasena = randomBytes(12).toString('base64url');
  const id = await crearUsuario(e.db, {
    tipoDocumento: 'DNI',
    numDocumento,
    nombre: 'Usuario Sintético',
    rolGlobal,
    contrasena,
    creadoPor: null,
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

// ── Escenario de campo sintético ────────────────────────────────────────────────

export interface Escenario {
  readonly proyectoId: string;
  readonly cuadrillaId: string;
  readonly estacionId: string;
  readonly metodologiaId: string;
  readonly estacionMetodologiaId: string;
}

let secuenciaEscenario = 0;

export const nuevoEscenario = async (e: Entorno): Promise<Escenario> => {
  const n = String(secuenciaEscenario++);
  const proyectoId = generarId();
  const cuadrillaId = generarId();
  const estacionId = generarId();
  const metodologiaId = generarId();
  const estacionMetodologiaId = generarId();
  await e.admin
    .insertInto('proyecto')
    .values({ id: proyectoId, nombre: `Proyecto sintético ${n}`, validacion_activa: false })
    .execute();
  await e.admin
    .insertInto('cuadrilla')
    .values({ id: cuadrillaId, proyecto_id: proyectoId, nombre: `Cuadrilla ${n}` })
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
    .insertInto('catalogo_metodologia')
    .values({ id: metodologiaId, nombre: `Trampas Sherman ${n}`, unidad: 'trampas-noche' })
    .execute();
  await e.admin
    .insertInto('estacion_metodologia')
    .values({
      id: estacionMetodologiaId,
      estacion_id: estacionId,
      metodologia_id: metodologiaId,
      meta_esfuerzo: '40',
    })
    .execute();
  return { proyectoId, cuadrillaId, estacionId, metodologiaId, estacionMetodologiaId };
};

export const agregarMiembro = (
  e: Entorno,
  esc: Escenario,
  usuarioId: string,
  rol: 'especialista' | 'logistico' = 'especialista',
) =>
  e.admin
    .insertInto('miembro_cuadrilla')
    .values({ id: generarId(), cuadrilla_id: esc.cuadrillaId, usuario_id: usuarioId, rol })
    .execute();

export const nuevoCuaderno = async (e: Entorno, esc: Escenario, responsableId: string) => {
  const id = generarId();
  await e.admin
    .insertInto('cuaderno')
    .values({
      id,
      proyecto_id: esc.proyectoId,
      cuadrilla_id: esc.cuadrillaId,
      responsable_id: responsableId,
      titulo: 'Cuaderno sintético',
    })
    .execute();
  return id;
};

/** Tarea ya asignada (cuaderno con responsable), lista para descargar. */
export const nuevaTarea = async (
  e: Entorno,
  esc: Escenario,
  cuadernoId: string,
  tipo: 'tecnica' | 'logistica' = 'tecnica',
) => {
  const id = generarId();
  await e.admin
    .insertInto('tarea')
    .values({
      id,
      proyecto_id: esc.proyectoId,
      cuaderno_id: cuadernoId,
      origen: 'manual',
      tipo,
      estacion_id: esc.estacionId,
      metodologia_id: esc.metodologiaId,
      geom: sql<string>`ST_SetSRID(ST_MakePoint(-77.03, -12.04), 4326)`,
      titulo: 'Evaluación sintética',
      estado: 'asignada',
    })
    .execute();
  return id;
};

/** Especialista de la cuadrilla con dispositivo activado y un cuaderno propio. */
export const especialistaEnCampo = async (e: Entorno, esc: Escenario) => {
  const d = await usuarioConDispositivo(e);
  await agregarMiembro(e, esc, d.usuario.id);
  const cuadernoId = await nuevoCuaderno(e, esc, d.usuario.id);
  return { ...d, cuadernoId };
};

export const descargar = (e: Entorno, token: string, tareaIds: string[]) =>
  e.app.inject({
    method: 'POST',
    url: '/api/v1/paquete/descargas',
    headers: conToken(token),
    payload: { tarea_ids: tareaIds },
  });

export const enviarLote = (e: Entorno, token: string, eventos: unknown[]) =>
  e.app.inject({
    method: 'POST',
    url: '/api/v1/sync/eventos',
    headers: conToken(token),
    payload: { eventos },
  });
