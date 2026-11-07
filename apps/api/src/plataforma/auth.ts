import { betterAuth } from 'better-auth';
import { bearer, username } from 'better-auth/plugins';
import type pg from 'pg';
import type { Config } from '../config.ts';
import { hashContrasena, verificarContrasena } from './contrasena.ts';
import { generarId } from './ids.ts';

/**
 * Better Auth (ADR-006). Login con tipo y número de documento como username
 * (`POST /api/auth/sign-in/username`, doc. 03 §8). No hay registro público: los usuarios los
 * crea el administrador (modulos/usuarios).
 */
export const LOGIN_DOCUMENTO = /^[a-z]{2,10}\.[0-9a-z]{4,20}$/;

/** username = "<tipo>.<número>" en minúsculas, p. ej. "dni.12345678". */
export const usernameDeDocumento = (tipo: string, numero: string): string =>
  `${tipo}.${numero}`.toLowerCase();

const SEGUNDOS_HORA = 60 * 60;

export const crearAuth = (pool: pg.Pool, config: Config) =>
  betterAuth({
    database: pool,
    secret: config.BETTER_AUTH_SECRET,
    baseURL: config.BETTER_AUTH_URL,
    basePath: '/api/auth',
    trustedOrigins: [config.WEB_ORIGIN],
    advanced: {
      database: { generateId: () => generarId() },
      useSecureCookies: config.NODE_ENV === 'production' || config.NODE_ENV === 'staging',
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      password: { hash: hashContrasena, verify: verificarContrasena },
    },
    session: {
      modelName: 'auth_session',
      // Sesión corta y deslizante; el celular la renueva firmando con su llave (SEG-05).
      expiresIn: 24 * SEGUNDOS_HORA,
      updateAge: SEGUNDOS_HORA,
      fields: {
        userId: 'user_id',
        expiresAt: 'expires_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
      additionalFields: {
        dispositivoId: {
          type: 'string',
          required: false,
          input: false,
          fieldName: 'dispositivo_id',
        },
      },
    },
    user: {
      modelName: 'auth_user',
      fields: {
        emailVerified: 'email_verified',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    account: {
      modelName: 'auth_account',
      fields: {
        userId: 'user_id',
        accountId: 'account_id',
        providerId: 'provider_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        idToken: 'id_token',
        accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    verification: {
      modelName: 'auth_verification',
      fields: { expiresAt: 'expires_at', createdAt: 'created_at', updatedAt: 'updated_at' },
    },
    // Límite por IP del login; el límite por cuenta lo aplica la ruta (plataforma/rutas-auth.ts).
    // Se reemplaza la regla por defecto de Better Auth (3 cada 10 s por IP), que bloquearía a
    // cuadrillas que comparten la IP del operador móvil.
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: { '/sign-in/username': { window: 60, max: config.RATE_LIMIT_LOGIN_IP } },
    },
    plugins: [
      username({
        usernameValidator: (u) => LOGIN_DOCUMENTO.test(u),
        schema: { user: { fields: { displayUsername: 'display_username' } } },
      }),
      bearer(),
    ],
  });

export type Auth = ReturnType<typeof crearAuth>;
