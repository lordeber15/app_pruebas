import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generarId } from '../src/plataforma/ids.ts';
import {
  conToken,
  ejecucionConFoto,
  enCampo,
  iniciarEntorno,
  nuevaLlave,
  nuevoEscenario,
  SECRETO_HOOKS,
  tokenDe,
  type Entorno,
  type Escenario,
} from './entorno.ts';

let e: Entorno;
let esc: Escenario;

beforeAll(async () => {
  e = await iniciarEntorno();
  esc = await nuevoEscenario(e);
});
afterAll(async () => {
  await e.cerrar();
});

const HASH_P = 'aa'.repeat(32);
const HASH_O = 'bb'.repeat(32);
const TAM_P = 900_000;
const TAM_O = 6_000_000;

/** Especialista con una foto anunciada (manifiesto aplicado) de su propia ejecución. */
const fotoAnunciada = async (tipo: 'foto' | 'audio' = 'foto') => {
  const yo = await enCampo(e, esc.brigadaId);
  const { ejecucionId, archivoId } = await ejecucionConFoto(e, esc, yo, {
    tipo,
    hashPreview: HASH_P,
    hashOriginal: tipo === 'foto' ? HASH_O : null,
    tamanoPreview: TAM_P,
    tamanoOriginal: TAM_O,
  });
  return { yo, ejecucionId, archivoId };
};

const hook = (cuerpo: object, secreto: string | null = SECRETO_HOOKS) =>
  e.app.inject({
    method: 'POST',
    url: `/internal/tus-hooks${secreto === null ? '' : `?secreto=${secreto}`}`,
    payload: cuerpo,
  });

const preCreate = (
  token: string | null,
  meta: Record<string, string>,
  tamano: number | null = TAM_P,
  diferido = false,
) => ({
  Type: 'pre-create',
  Event: {
    Upload: { ID: null, Size: tamano, SizeIsDeferred: diferido, MetaData: meta, Storage: null },
    HTTPRequest: { Header: token === null ? {} : { Authorization: [`Bearer ${token}`] } },
  },
});

const postFinish = (meta: Record<string, string>, clave: string) => ({
  Type: 'post-finish',
  Event: {
    Upload: {
      ID: clave,
      Size: TAM_P,
      MetaData: meta,
      Storage: { Type: 's3store', Bucket: 'archivos', Key: clave },
    },
    HTTPRequest: { Header: {} },
  },
});

type RespuestaHook = {
  RejectUpload?: boolean;
  HTTPResponse?: { StatusCode: number; Body: string };
  ChangeFileInfo?: { ID: string; MetaData: Record<string, string> };
};

const codigo = (r: RespuestaHook): string | undefined =>
  r.HTTPResponse === undefined
    ? undefined
    : (JSON.parse(r.HTTPResponse.Body) as { codigo: string }).codigo;

const meta = (archivoId: string, variante = 'preview', sha256 = HASH_P) => ({
  archivo_id: archivoId,
  variante,
  sha256,
});

describe('pre-create (doc. 03 §10)', () => {
  it('autoriza la subida y genera la ruta en el servidor', async () => {
    const { yo, archivoId } = await fotoAnunciada();
    const r = (await hook(preCreate(yo.token, meta(archivoId)))).json<RespuestaHook>();
    expect(r.RejectUpload).toBeUndefined();
    const id = r.ChangeFileInfo?.ID ?? '';
    const prefijo = `proyectos/${esc.proyectoId}/archivos/${archivoId}/preview/`;
    expect(id.startsWith(prefijo)).toBe(true);
    expect(id.slice(prefijo.length)).toMatch(/^[0-9a-f-]{36}\.jpg$/);
    expect(r.ChangeFileInfo?.MetaData).toEqual(meta(archivoId));
  });

  it('sin el secreto de tusd se rechaza', async () => {
    const { yo, archivoId } = await fotoAnunciada();
    expect((await hook(preCreate(yo.token, meta(archivoId)), null)).statusCode).toBe(403);
    expect((await hook(preCreate(yo.token, meta(archivoId)), 'x'.repeat(48))).statusCode).toBe(403);
  });

  it('sin sesión del dispositivo se rechaza', async () => {
    const { archivoId } = await fotoAnunciada();
    const r = (await hook(preCreate(null, meta(archivoId)))).json<RespuestaHook>();
    expect(r.RejectUpload).toBe(true);
    expect(r.HTTPResponse?.StatusCode).toBe(401);
  });

  it('SEG-01 SEG-03 no se sube un archivo de otro usuario', async () => {
    const { archivoId } = await fotoAnunciada();
    const intruso = await enCampo(e, esc.brigadaId);
    const r = (await hook(preCreate(intruso.token, meta(archivoId)))).json<RespuestaHook>();
    expect([r.HTTPResponse?.StatusCode, codigo(r)]).toEqual([403, 'NO_AUTORIZADO']);
  });

  it('un hash que no está en el manifiesto se rechaza', async () => {
    const { yo, archivoId } = await fotoAnunciada();
    const r = (
      await hook(preCreate(yo.token, meta(archivoId, 'preview', 'cc'.repeat(32))))
    ).json<RespuestaHook>();
    expect(codigo(r)).toBe('HASH_NO_ANUNCIADO');
  });

  it.each([
    ['distinto del anunciado', TAM_P + 1, false],
    ['mayor que 3 MB', 4 * 1024 * 1024, false],
    ['diferido', null, true],
  ] as const)('SEG-08 un tamaño %s se rechaza', async (_n, tamano, diferido) => {
    const { yo, archivoId } = await fotoAnunciada();
    const r = (
      await hook(preCreate(yo.token, meta(archivoId), tamano, diferido))
    ).json<RespuestaHook>();
    expect(r.HTTPResponse?.StatusCode).toBe(413);
  });

  it('RN-17 CP-029 el original no sube si el proyecto no lo permite', async () => {
    const { yo, archivoId } = await fotoAnunciada();
    await e.admin
      .updateTable('archivo')
      .set({ estado: 'preview_verificada' })
      .where('id', '=', archivoId)
      .execute();
    const r = (
      await hook(preCreate(yo.token, meta(archivoId, 'original', HASH_O), TAM_O))
    ).json<RespuestaHook>();
    expect(codigo(r)).toBe('ORIGINAL_NO_PERMITIDO');
  });

  it('RN-17 CP-028 con el proyecto que lo permite, el original sube', async () => {
    const otro = await nuevoEscenario(e);
    await e.admin
      .updateTable('proyecto')
      .set({ subir_originales: true })
      .where('id', '=', otro.proyectoId)
      .execute();
    const previo = esc;
    esc = otro;
    try {
      const { yo, archivoId } = await fotoAnunciada();
      const r = (
        await hook(preCreate(yo.token, meta(archivoId, 'original', HASH_O), TAM_O))
      ).json<RespuestaHook>();
      expect(r.ChangeFileInfo?.ID).toContain(`/archivos/${archivoId}/original/`);
    } finally {
      esc = previo;
    }
  });

  it('un audio no tiene original', async () => {
    const { yo, archivoId } = await fotoAnunciada('audio');
    const r = (
      await hook(preCreate(yo.token, meta(archivoId, 'original', HASH_O), TAM_O))
    ).json<RespuestaHook>();
    expect(codigo(r)).toBe('SIN_ORIGINAL');
  });

  it('una preview ya verificada no se vuelve a subir', async () => {
    const { yo, archivoId } = await fotoAnunciada();
    await e.admin
      .updateTable('archivo')
      .set({ estado: 'preview_verificada' })
      .where('id', '=', archivoId)
      .execute();
    const r = (await hook(preCreate(yo.token, meta(archivoId)))).json<RespuestaHook>();
    expect(codigo(r)).toBe('YA_VERIFICADO');
  });

  it('la foto sube solo desde el celular que registró la ejecución', async () => {
    const { yo, archivoId } = await fotoAnunciada();
    // El mismo usuario en otro celular: nueva sesión vinculada a otro dispositivo.
    const token = await tokenDe(e, yo.usuario.username, yo.usuario.contrasena);
    await e.app.inject({
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
    const r = (await hook(preCreate(token, meta(archivoId)))).json<RespuestaHook>();
    expect(codigo(r)).toBe('NO_AUTORIZADO');
  });
});

describe('post-finish', () => {
  it('registra la ruta, marca la preview como subida y avisa al worker', async () => {
    const { yo, archivoId } = await fotoAnunciada();
    const id =
      (await hook(preCreate(yo.token, meta(archivoId)))).json<RespuestaHook>().ChangeFileInfo?.ID ??
      '';
    expect((await hook(postFinish(meta(archivoId), id))).statusCode).toBe(200);
    const fila = await e.admin
      .selectFrom('archivo')
      .select(['estado', 'ruta_preview'])
      .where('id', '=', archivoId)
      .executeTakeFirstOrThrow();
    expect(fila).toEqual({ estado: 'preview_subida', ruta_preview: id });
  });

  it('una clave fuera de la ruta generada para el archivo no se registra', async () => {
    const { archivoId } = await fotoAnunciada();
    await hook(
      postFinish(meta(archivoId), `proyectos/${generarId()}/archivos/${archivoId}/preview/x.jpg`),
    );
    const fila = await e.admin
      .selectFrom('archivo')
      .select(['estado', 'ruta_preview'])
      .where('id', '=', archivoId)
      .executeTakeFirstOrThrow();
    expect(fila).toEqual({ estado: 'anunciado', ruta_preview: null });
  });
});

describe('estado de los archivos para el celular (RN-17)', () => {
  it('devuelve solo los archivos propios', async () => {
    const { yo, archivoId } = await fotoAnunciada();
    const ajeno = (await fotoAnunciada()).archivoId;
    const r = await e.app.inject({
      method: 'POST',
      url: '/api/v1/archivos/estado',
      headers: conToken(yo.token),
      payload: { ids: [archivoId, ajeno] },
    });
    expect(r.json()).toEqual({ archivos: [{ id: archivoId, estado: 'anunciado' }] });
  });

  it('RN-17 el cambio a verificado llega en la bajada incremental', async () => {
    const { yo, archivoId } = await fotoAnunciada();
    await e.admin
      .updateTable('archivo')
      .set({ estado: 'preview_verificada' })
      .where('id', '=', archivoId)
      .execute();
    const r = await e.app.inject({
      method: 'GET',
      url: '/api/v1/sync/cambios',
      headers: conToken(yo.token),
    });
    expect(r.json<{ cambios: unknown[] }>().cambios).toContainEqual({
      entidad: 'archivo',
      id: archivoId,
      operacion: 'estado',
      datos: { estado: 'preview_verificada' },
    });
  });
});
