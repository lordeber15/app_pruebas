import { describe, expect, it } from 'vitest';
import { diasEntre, fechaEnZona, sumarDias } from './fechas.ts';

describe('fechas del cronograma', () => {
  it('cuenta días entre fechas, también a través de meses y años', () => {
    expect(diasEntre('2026-12-01', '2026-11-08')).toBe(-23);
    expect(diasEntre('2026-12-30', '2027-01-02')).toBe(3);
  });

  it('suma días conservando el orden y los huecos', () => {
    expect(sumarDias('2026-12-01', -23)).toBe('2026-11-08');
    expect(sumarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(sumarDias('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('«hoy» en America/Lima: las 02:00 UTC del 9 aún son el 8 en Lima', () => {
    expect(fechaEnZona(new Date('2026-11-09T02:00:00Z'))).toBe('2026-11-08');
    expect(fechaEnZona(new Date('2026-11-09T06:00:00Z'))).toBe('2026-11-09');
  });

  it('rechaza una fecha mal formada', () => {
    expect(() => sumarDias('08/11/2026', 1)).toThrow();
  });
});
