import { describe, expect, it } from 'vitest';
import { ESTADOS_ARCHIVO } from '../estados.ts';
import {
  extensionDe,
  tamanoMaximo,
  tipoContenidoEsperado,
  tipoPorContenido,
  transicionarArchivo,
  type AccionArchivo,
} from './maquina.ts';

const ascii = (t: string): number[] => Array.from({ length: t.length }, (_, i) => t.charCodeAt(i));

const subirP: AccionArchivo = { tipo: 'subir', variante: 'preview' };
const okP: AccionArchivo = { tipo: 'verificar', variante: 'preview', hashCorrecto: true };
const malP: AccionArchivo = { tipo: 'verificar', variante: 'preview', hashCorrecto: false };
const subirO: AccionArchivo = { tipo: 'subir', variante: 'original' };
const okO: AccionArchivo = { tipo: 'verificar', variante: 'original', hashCorrecto: true };
const malO: AccionArchivo = { tipo: 'verificar', variante: 'original', hashCorrecto: false };

describe('máquina de estados del archivo (doc. 02 §7.4)', () => {
  it('RN-05 flujo completo de una foto: anunciado → preview subida → verificada → original verificado', () => {
    expect(transicionarArchivo('anunciado', 'foto', subirP)).toEqual({
      ok: true,
      valor: 'preview_subida',
    });
    expect(transicionarArchivo('preview_subida', 'foto', okP)).toEqual({
      ok: true,
      valor: 'preview_verificada',
    });
    expect(transicionarArchivo('preview_verificada', 'foto', subirO)).toEqual({
      ok: true,
      valor: 'preview_verificada',
    });
    expect(transicionarArchivo('preview_verificada', 'foto', okO)).toEqual({
      ok: true,
      valor: 'original_verificado',
    });
  });

  it('RN-17 un hash de preview incorrecto deja el archivo en error y se puede volver a subir', () => {
    expect(transicionarArchivo('preview_subida', 'foto', malP)).toEqual({
      ok: true,
      valor: 'error',
    });
    expect(transicionarArchivo('error', 'foto', subirP)).toEqual({
      ok: true,
      valor: 'preview_subida',
    });
  });

  it('RN-17 un original con hash incorrecto no cambia el estado verificado de la preview', () => {
    expect(transicionarArchivo('preview_verificada', 'foto', malO)).toEqual({
      ok: true,
      valor: 'preview_verificada',
    });
  });

  it('una subida repetida de la preview antes de verificar se acepta (reintento)', () => {
    expect(transicionarArchivo('preview_subida', 'audio', subirP)).toEqual({
      ok: true,
      valor: 'preview_subida',
    });
  });

  it.each(['preview_verificada', 'original_verificado'] as const)(
    'una preview ya verificada (%s) no se vuelve a subir',
    (estado) => {
      expect(transicionarArchivo(estado, 'foto', subirP)).toEqual({
        ok: false,
        motivo: 'YA_VERIFICADO',
      });
    },
  );

  it('un original ya verificado no se vuelve a subir ni verificar', () => {
    expect(transicionarArchivo('original_verificado', 'foto', subirO)).toEqual({
      ok: false,
      motivo: 'YA_VERIFICADO',
    });
    expect(transicionarArchivo('original_verificado', 'foto', okO)).toEqual({
      ok: false,
      motivo: 'YA_VERIFICADO',
    });
  });

  it.each(['ficha', 'audio', 'comprobante'] as const)(
    '%s no tiene original (doc. 03 §10)',
    (tipo) => {
      expect(transicionarArchivo('preview_verificada', tipo, subirO)).toEqual({
        ok: false,
        motivo: 'SIN_ORIGINAL',
      });
    },
  );

  it.each(ESTADOS_ARCHIVO.filter((e) => e !== 'preview_subida'))(
    'solo se verifica una preview subida (no desde %s)',
    (estado) => {
      expect(transicionarArchivo(estado, 'foto', okP)).toEqual({
        ok: false,
        motivo: 'TRANSICION_INVALIDA',
      });
    },
  );

  it.each(['anunciado', 'preview_subida', 'error'] as const)(
    'el original solo se verifica sobre una preview verificada (no desde %s)',
    (estado) => {
      expect(transicionarArchivo(estado, 'foto', okO)).toEqual({
        ok: false,
        motivo: 'TRANSICION_INVALIDA',
      });
    },
  );
});

describe('límites y tipos (doc. 03 §10)', () => {
  it('tamaños máximos: preview 3 MB, original 25 MB, audio 10 MB', () => {
    expect(tamanoMaximo('foto', 'preview')).toBe(3 * 1024 * 1024);
    expect(tamanoMaximo('foto', 'original')).toBe(25 * 1024 * 1024);
    expect(tamanoMaximo('audio', 'preview')).toBe(10 * 1024 * 1024);
    expect(tamanoMaximo('ficha', 'preview')).toBe(3 * 1024 * 1024);
  });

  it('tipo esperado y extensión', () => {
    expect(tipoContenidoEsperado('foto')).toBe('image/jpeg');
    expect(tipoContenidoEsperado('audio')).toBe('audio/mp4');
    expect(extensionDe('image/jpeg')).toBe('jpg');
    expect(extensionDe('audio/mp4')).toBe('m4a');
  });

  it('SEG-08 reconoce JPEG por su firma', () => {
    expect(tipoPorContenido(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(
      'image/jpeg',
    );
  });

  it('SEG-08 reconoce audio MP4/M4A por su caja ftyp', () => {
    const m4a = new Uint8Array([0, 0, 0, 0x20, ...ascii('ftypM4A ')]);
    expect(tipoPorContenido(m4a)).toBe('audio/mp4');
  });

  it.each([
    ['PNG', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]],
    ['texto', [...ascii('<html>hola!!')]],
    ['video MP4 (qt)', [0, 0, 0, 0x20, ...ascii('ftypqt  ')]],
    ['vacío', []],
  ])('SEG-08 rechaza %s aunque se llame .jpg', (_n, bytes) => {
    expect(tipoPorContenido(new Uint8Array(bytes))).toBeNull();
  });
});
