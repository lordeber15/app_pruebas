import { cumpleContrasena } from '@campo/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  conToken,
  entrar,
  iniciarEntorno,
  nuevaLlave,
  pedir,
  persona,
  tokenDe,
  type Entorno,
  type Persona,
} from './entorno.ts';

/**
 * Contraseñas (decisión del usuario, 2026-11-07): el alta entrega una contraseña temporal, la
 * persona debe cambiarla en su primer ingreso y la nueva cumple la política (8 caracteres,
 * mayúscula, minúscula y número).
 */
let e: Entorno;
let admin: Persona;

beforeAll(async () => {
  e = await iniciarEntorno();
  admin = await persona(e, 'admin');
});
afterAll(async () => {
  await e.cerrar();
});

let secuencia = 62_000_000;

/** Alta por el administrador: devuelve el usuario y su contraseña temporal. */
const alta = async () => {
  const num = String(secuencia++);
  const r = await pedir(e, admin.token, 'POST', '/admin/usuarios', {
    tipo_documento: 'DNI',
    num_documento: num,
    nombre: 'Especialista Nueva',
  });
  expect(r.statusCode).toBe(201);
  const { id, contrasena_temporal: temporal } = r.json<{
    id: string;
    contrasena_temporal: string;
  }>();
  return { id, username: `dni.${num}`, temporal };
};

const cambiar = (token: string, actual: string, nueva: string) =>
  pedir(e, token, 'POST', '/yo/contrasena', { actual, nueva });

describe('primer ingreso con contraseña temporal', () => {
  it('la contraseña temporal cumple la política', async () => {
    for (let i = 0; i < 5; i++) expect(cumpleContrasena((await alta()).temporal)).toBe(true);
  });

  it('con la temporal solo puede ver su perfil y cambiarla', async () => {
    const u = await alta();
    const token = await tokenDe(e, u.username, u.temporal);
    const yo = await pedir(e, token, 'GET', '/yo');
    expect(yo.statusCode).toBe(200);
    expect(yo.json()).toMatchObject({ debe_cambiar_contrasena: true });
    const bloqueada = await pedir(e, token, 'GET', '/proyectos');
    expect(bloqueada.statusCode).toBe(403);
    expect(bloqueada.json()).toMatchObject({ codigo: 'CAMBIO_CONTRASENA_REQUERIDO' });
    // Tampoco activa el celular antes de cambiarla.
    const activar = await e.app.inject({
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
    expect(activar.statusCode).toBe(403);
  });

  it('al cambiarla queda habilitada; entra con la nueva y no con la temporal', async () => {
    const u = await alta();
    const token = await tokenDe(e, u.username, u.temporal);
    expect((await cambiar(token, u.temporal, 'Campo2026x')).statusCode).toBe(204);
    expect((await pedir(e, token, 'GET', '/proyectos')).statusCode).toBe(200);
    expect((await pedir(e, token, 'GET', '/yo')).json()).toMatchObject({
      debe_cambiar_contrasena: false,
    });
    expect((await entrar(e, u.username, u.temporal)).statusCode).toBe(401);
    expect((await entrar(e, u.username, 'Campo2026x')).statusCode).toBe(200);
  });

  it('cambiarla cierra las demás sesiones del usuario y conserva la actual', async () => {
    const u = await alta();
    const otra = await tokenDe(e, u.username, u.temporal);
    const actual = await tokenDe(e, u.username, u.temporal);
    expect((await cambiar(actual, u.temporal, 'Selva2026z')).statusCode).toBe(204);
    expect((await pedir(e, otra, 'GET', '/yo')).statusCode).toBe(401);
    expect((await pedir(e, actual, 'GET', '/yo')).statusCode).toBe(200);
  });

  it('el restablecimiento vuelve a exigir el cambio', async () => {
    const u = await alta();
    const token = await tokenDe(e, u.username, u.temporal);
    await cambiar(token, u.temporal, 'Costa2026y');
    const r = await pedir(e, admin.token, 'POST', `/admin/usuarios/${u.id}/contrasena`);
    const temporal = r.json<{ contrasena_temporal: string }>().contrasena_temporal;
    expect(cumpleContrasena(temporal)).toBe(true);
    const nuevo = await tokenDe(e, u.username, temporal);
    expect((await pedir(e, nuevo, 'GET', '/proyectos')).statusCode).toBe(403);
  });
});

describe('política de la contraseña nueva', () => {
  it.each([
    ['corta', 'Ab1cdef'],
    ['sin mayúscula', 'campo2026'],
    ['sin minúscula', 'CAMPO2026'],
    ['sin número', 'CampoSelva'],
  ])('rechaza una contraseña %s', async (_caso, nueva) => {
    const u = await alta();
    const token = await tokenDe(e, u.username, u.temporal);
    expect((await cambiar(token, u.temporal, nueva)).statusCode).toBe(400);
    expect((await entrar(e, u.username, u.temporal)).statusCode).toBe(200);
  });

  it('exige la contraseña actual correcta y una nueva distinta', async () => {
    const u = await alta();
    const token = await tokenDe(e, u.username, u.temporal);
    const mal = await cambiar(token, 'NoEsLaActual1', 'Campo2026w');
    expect(mal.statusCode).toBe(400);
    expect(mal.json()).toMatchObject({ codigo: 'CONTRASENA_ACTUAL_INCORRECTA' });
    expect((await cambiar(token, u.temporal, u.temporal)).statusCode).toBe(400);
  });

  it('sin sesión no se puede cambiar', async () => {
    const r = await e.app.inject({
      method: 'POST',
      url: '/api/v1/yo/contrasena',
      payload: { actual: 'x', nueva: 'Campo2026v' },
    });
    expect(r.statusCode).toBe(401);
  });
});
