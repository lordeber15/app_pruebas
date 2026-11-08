import { describe, expect, it } from 'vitest';
import {
  consultaPaginaSchema,
  LIMITE_PAGINA_POR_DEFECTO,
  respuestaPaginaSchema,
} from './paginacion.ts';

describe('consultaPaginaSchema', () => {
  it('sin parámetros usa el límite por defecto y la primera página', () => {
    expect(consultaPaginaSchema.parse({})).toEqual({ limite: LIMITE_PAGINA_POR_DEFECTO });
  });

  it('convierte el límite de la query (texto) a número', () => {
    expect(consultaPaginaSchema.parse({ limite: '10', cursor: 'abc' })).toEqual({
      limite: 10,
      cursor: 'abc',
    });
  });

  it.each(['0', '101', '2.5', 'diez'])('rechaza el límite %s', (limite) => {
    expect(consultaPaginaSchema.safeParse({ limite }).success).toBe(false);
  });

  it('rechaza un cursor vacío o demasiado largo', () => {
    expect(consultaPaginaSchema.safeParse({ cursor: '' }).success).toBe(false);
    expect(consultaPaginaSchema.safeParse({ cursor: 'x'.repeat(513) }).success).toBe(false);
  });
});

describe('respuestaPaginaSchema', () => {
  it('acepta un cursor o null al final', () => {
    expect(respuestaPaginaSchema.parse({ siguiente_cursor: null })).toEqual({
      siguiente_cursor: null,
    });
    expect(respuestaPaginaSchema.safeParse({}).success).toBe(false);
  });
});
