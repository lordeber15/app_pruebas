import { crearDb, crearPool, type Db } from '@campo/db';
import { iniciarBaseDePrueba, type BaseDePrueba } from '@campo/db/pruebas';
import { generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import type pg from 'pg';
import { crearApp, type Aplicacion } from '../src/app.ts';
import { leerConfig } from '../src/config.ts';
import { crearUsuario } from '../src/modulos/usuarios/servicio.ts';

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
