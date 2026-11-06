import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  conToken,
  entrar,
  firmar,
  iniciarEntorno,
  nuevaLlave,
  nuevoUsuario,
  tokenDe,
  usuarioConDispositivo,
  type Entorno,
} from './entorno.ts';

let e: Entorno;

beforeAll(async () => {
  e = await iniciarEntorno();
});
afterAll(async () => {
  await e.cerrar();
});

const nonce = (): string => randomBytes(16).toString('base64url');

const renovar = (cuerpo: Record<string, unknown>) =>
  e.app.inject({ method: 'POST', url: '/api/v1/dispositivos/renovar', payload: cuerpo });

const cuerpoRenovacion = (
  dispositivoId: string,
  firmarCon: Parameters<typeof firmar>[0],
  momento = new Date().toISOString(),
  n = nonce(),
) => ({
  dispositivo_id: dispositivoId,
  momento,
  nonce: n,
  firma: firmar(firmarCon, `campo-renovar\n${dispositivoId}\n${momento}\n${n}`),
});

const estado = (token: string) =>
  e.app.inject({ method: 'GET', url: '/api/v1/dispositivos/estado', headers: conToken(token) });

describe('login (RF-M01)', () => {
  it('CP-001 entra con documento y contraseña correctos y recibe un token', async () => {
    const u = await nuevoUsuario(e);
    const r = await entrar(e, u.username, u.contrasena);
    expect(r.statusCode).toBe(200);
    expect(typeof r.headers['set-auth-token']).toBe('string');
  });

  it('CP-002 SEG-04 documento inexistente y contraseña incorrecta dan el mismo mensaje', async () => {
    const u = await nuevoUsuario(e);
    const inexistente = await entrar(e, 'dni.99999999', 'cualquier-clave');
    const incorrecta = await entrar(e, u.username, 'clave-incorrecta');
    expect(inexistente.statusCode).toBe(401);
    expect(incorrecta.statusCode).toBe(401);
    const sinInstancia = (b: Record<string, unknown>) => ({ ...b, instance: undefined });
    expect(sinInstancia(inexistente.json())).toEqual(sinInstancia(incorrecta.json()));
    expect(incorrecta.headers['content-type']).toContain('application/problem+json');
  });

  it('SEG-04 el sexto intento sobre la misma cuenta en 15 minutos se bloquea', async () => {
    const u = await nuevoUsuario(e);
    for (let i = 0; i < 5; i++) {
      expect((await entrar(e, u.username, `incorrecta-${String(i)}`)).statusCode).toBe(401);
    }
    const sexto = await entrar(e, u.username, u.contrasena);
    expect(sexto.statusCode).toBe(429);
  });

  it('la contraseña se guarda con Argon2id, nunca en claro', async () => {
    const u = await nuevoUsuario(e);
    const fila = await e.admin
      .selectFrom('auth_account')
      .select('password')
      .where('user_id', '=', u.id)
      .executeTakeFirstOrThrow();
    expect(fila.password).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(fila.password).not.toContain(u.contrasena);
  });

  it.each([
    ['POST', '/api/auth/sign-up/email'],
    ['POST', '/api/auth/sign-in/email'],
    ['POST', '/api/auth/change-email'],
  ] as const)('el endpoint de Better Auth %s %s no está expuesto', async (method, url) => {
    const r = await e.app.inject({ method, url, payload: {} });
    expect(r.statusCode).toBe(404);
  });

  it('un usuario inactivo no puede usar su sesión', async () => {
    const u = await nuevoUsuario(e);
    const token = await tokenDe(e, u.username, u.contrasena);
    await e.admin
      .updateTable('usuario')
      .set({ estado: 'inactivo' })
      .where('id', '=', u.id)
      .execute();
    const r = await e.app.inject({
      method: 'POST',
      url: '/api/v1/dispositivos/activar',
      headers: conToken(token),
      payload: {
        plataforma: 'ios',
        llave_publica: nuevaLlave().publicaSpki,
        version_app: '1.0.0',
        token_push: null,
      },
    });
    expect(r.statusCode).toBe(401);
  });
});

describe('activación del dispositivo (doc. 02 §6.1)', () => {
  it('sin sesión no se puede activar', async () => {
    const r = await e.app.inject({
      method: 'POST',
      url: '/api/v1/dispositivos/activar',
      payload: {
        plataforma: 'android',
        llave_publica: nuevaLlave().publicaSpki,
        version_app: '0.1.0',
        token_push: null,
      },
    });
    expect(r.statusCode).toBe(401);
    expect(r.headers['content-type']).toContain('application/problem+json');
  });

  it('activa el dispositivo y vincula la sesión', async () => {
    const { token, dispositivoId, usuario } = await usuarioConDispositivo(e);
    const disp = await e.admin
      .selectFrom('dispositivo')
      .select(['usuario_id', 'estado'])
      .where('id', '=', dispositivoId)
      .executeTakeFirstOrThrow();
    expect(disp).toEqual({ usuario_id: usuario.id, estado: 'activo' });
    expect((await estado(token)).json()).toEqual({ estado: 'activo', version_minima: null });
  });

  it('la misma sesión no activa un segundo dispositivo', async () => {
    const { token } = await usuarioConDispositivo(e);
    const r = await e.app.inject({
      method: 'POST',
      url: '/api/v1/dispositivos/activar',
      headers: conToken(token),
      payload: {
        plataforma: 'android',
        llave_publica: nuevaLlave().publicaSpki,
        version_app: '0.1.0',
        token_push: null,
      },
    });
    expect(r.statusCode).toBe(409);
  });

  it('rechaza una llave que no es ECDSA P-256', async () => {
    const u = await nuevoUsuario(e);
    const token = await tokenDe(e, u.username, u.contrasena);
    const r = await e.app.inject({
      method: 'POST',
      url: '/api/v1/dispositivos/activar',
      headers: conToken(token),
      payload: {
        plataforma: 'android',
        llave_publica: Buffer.from('no es una llave').toString('base64'),
        version_app: '0.1.0',
        token_push: null,
      },
    });
    expect(r.statusCode).toBe(400);
  });

  it('valida el cuerpo con Zod y responde problem+json', async () => {
    const u = await nuevoUsuario(e);
    const token = await tokenDe(e, u.username, u.contrasena);
    const r = await e.app.inject({
      method: 'POST',
      url: '/api/v1/dispositivos/activar',
      headers: conToken(token),
      payload: { plataforma: 'windows' },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ status: 400, codigo: 'VALIDACION' });
  });

  it('una sesión sin dispositivo no accede a rutas de dispositivo', async () => {
    const u = await nuevoUsuario(e);
    const token = await tokenDe(e, u.username, u.contrasena);
    const r = await estado(token);
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ codigo: 'DISPOSITIVO_REQUERIDO' });
  });
});

describe('renovación con la llave del dispositivo (SEG-05)', () => {
  it('SEG-05 renueva la sesión con una firma válida y la nueva sesión queda vinculada', async () => {
    const { llave, dispositivoId } = await usuarioConDispositivo(e);
    const r = await renovar(cuerpoRenovacion(dispositivoId, llave.privada));
    expect(r.statusCode).toBe(200);
    const { token } = r.json<{ token: string }>();
    expect((await estado(token)).json()).toMatchObject({ estado: 'activo' });
  });

  it('SEG-05 una firma hecha con otra llave se rechaza', async () => {
    const { dispositivoId } = await usuarioConDispositivo(e);
    const r = await renovar(cuerpoRenovacion(dispositivoId, nuevaLlave().privada));
    expect(r.statusCode).toBe(401);
    expect(r.json()).toMatchObject({ codigo: 'RENOVACION_RECHAZADA' });
  });

  it('SEG-05 una firma capturada no se puede reutilizar (nonce de un solo uso)', async () => {
    const { llave, dispositivoId } = await usuarioConDispositivo(e);
    const cuerpo = cuerpoRenovacion(dispositivoId, llave.privada);
    expect((await renovar(cuerpo)).statusCode).toBe(200);
    expect((await renovar(cuerpo)).statusCode).toBe(401);
  });

  it('SEG-05 un momento fuera de la tolerancia de 5 minutos se rechaza', async () => {
    const { llave, dispositivoId } = await usuarioConDispositivo(e);
    const viejo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    expect((await renovar(cuerpoRenovacion(dispositivoId, llave.privada, viejo))).statusCode).toBe(
      401,
    );
  });

  it('SEG-05 cambiar el mensaje invalida la firma', async () => {
    const { llave, dispositivoId } = await usuarioConDispositivo(e);
    const cuerpo = cuerpoRenovacion(dispositivoId, llave.privada);
    expect((await renovar({ ...cuerpo, nonce: nonce() })).statusCode).toBe(401);
  });

  it('RF-M17 un dispositivo dado de baja no renueva', async () => {
    const { llave, dispositivoId } = await usuarioConDispositivo(e);
    await e.admin
      .updateTable('dispositivo')
      .set({ estado: 'baja' })
      .where('id', '=', dispositivoId)
      .execute();
    expect((await renovar(cuerpoRenovacion(dispositivoId, llave.privada))).statusCode).toBe(401);
  });
});

describe('baja remota (RF-M17)', () => {
  it('CP-041 con baja pendiente el celular se entera al consultar su estado', async () => {
    const { token, dispositivoId } = await usuarioConDispositivo(e);
    await e.admin
      .updateTable('dispositivo')
      .set({ estado: 'baja_pendiente' })
      .where('id', '=', dispositivoId)
      .execute();
    expect((await estado(token)).json()).toMatchObject({ estado: 'baja_pendiente' });
  });

  it('con la baja hecha, la sesión del dispositivo deja de servir', async () => {
    const { token, dispositivoId } = await usuarioConDispositivo(e);
    await e.admin
      .updateTable('dispositivo')
      .set({ estado: 'baja' })
      .where('id', '=', dispositivoId)
      .execute();
    const r = await estado(token);
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ codigo: 'DISPOSITIVO_DADO_DE_BAJA' });
  });
});

describe('plataforma', () => {
  it('una ruta inexistente responde problem+json 404', async () => {
    const r = await e.app.inject({ method: 'GET', url: '/api/v1/no-existe' });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toMatchObject({ status: 404, codigo: 'NO_ENCONTRADO' });
  });

  it('/ready verifica la base de datos', async () => {
    expect((await e.app.inject({ method: 'GET', url: '/ready' })).json()).toEqual({
      estado: 'listo',
    });
  });

  it('SEG-07 envía cabeceras de seguridad (helmet)', async () => {
    const r = await e.app.inject({ method: 'GET', url: '/health' });
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['content-security-policy']).toBeDefined();
  });

  it('SEG-09 CORS solo para el origen exacto de la web', async () => {
    const ok = await e.app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://localhost:5173' },
    });
    const otro = await e.app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://otro.ejemplo' },
    });
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(otro.headers['access-control-allow-origin']).not.toBe('https://otro.ejemplo');
  });
});
