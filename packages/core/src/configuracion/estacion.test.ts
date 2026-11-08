import { describe, expect, it } from 'vitest';
import {
  estacionCambioSchema,
  estacionNuevaSchema,
  normalizarZonaUtm,
  sridDeZonaUtm,
} from './estacion.ts';

const valida = {
  codigo: 'EST-WEB-01',
  zona_utm: '18s',
  este: 450_000,
  norte: 8_900_000,
  aid_aii: 'AID',
  uv: 'Bofedal',
  za_ef: '',
  region: 'SIERRA',
};

describe('RN-29 atributos de estación cargados desde la web', () => {
  it('normaliza la zona UTM al formato de A01 y da su SRID', () => {
    expect(normalizarZonaUtm('17S')).toBe('17 S');
    expect(normalizarZonaUtm(' 19 s ')).toBe('19 S');
    expect(normalizarZonaUtm('61S')).toBeNull();
    expect(normalizarZonaUtm('18X')).toBeNull();
    expect(sridDeZonaUtm('18 S')).toBe(32718);
    expect(sridDeZonaUtm('18N')).toBe(32618);
    expect(sridDeZonaUtm('abc')).toBeNull();
  });

  it('acepta una estación completa; ZA/EF vacío queda como «no aplica»', () => {
    const r = estacionNuevaSchema.parse(valida);
    expect(r.zona_utm).toBe('18 S');
    expect(r.za_ef).toBeNull();
  });

  it('rechaza coordenadas fuera de rango y zonas inválidas', () => {
    expect(estacionNuevaSchema.safeParse({ ...valida, este: 50 }).success).toBe(false);
    expect(estacionNuevaSchema.safeParse({ ...valida, zona_utm: '99S' }).success).toBe(false);
    expect(estacionNuevaSchema.safeParse({ ...valida, region: 'PUNA' }).success).toBe(false);
  });

  it('una corrección de ubicación trae zona, Este y Norte juntos', () => {
    expect(estacionCambioSchema.safeParse({ uv: 'Pajonal' }).success).toBe(true);
    expect(estacionCambioSchema.safeParse({ este: 451_000 }).success).toBe(false);
    expect(
      estacionCambioSchema.safeParse({ zona_utm: '18S', este: 451_000, norte: 8_900_100 })
        .success,
    ).toBe(true);
    expect(estacionCambioSchema.safeParse({}).success).toBe(false);
  });
});
