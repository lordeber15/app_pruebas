import { describe, expect, it } from 'vitest';
import { lima } from './_fixtures.ts';
import {
  aMinutos,
  dentroDeAlgunaVentana,
  dentroDeVentana,
  describirVentanas,
  duracionMinutos,
  horaLocal,
  minutosLocales,
  ZONA_HORARIA_POR_DEFECTO,
} from './horario.ts';

describe('RN-41 horarios: utilidades', () => {
  it('aMinutos y describirVentanas', () => {
    expect(aMinutos('06:00')).toBe(360);
    expect(aMinutos('23:59')).toBe(1439);
    expect(
      describirVentanas([
        { inicio: '06:00', fin: '11:00' },
        { inicio: '19:00', fin: '21:00' },
      ]),
    ).toBe('06:00–11:00 y 19:00–21:00');
  });

  it('dentroDeVentana: ventana diurna, inclusiva en los bordes', () => {
    const v = { inicio: '06:00', fin: '10:00' };
    expect(dentroDeVentana(aMinutos('06:00'), v)).toBe(true);
    expect(dentroDeVentana(aMinutos('10:00'), v)).toBe(true);
    expect(dentroDeVentana(aMinutos('05:59'), v)).toBe(false);
    expect(dentroDeVentana(aMinutos('10:01'), v)).toBe(false);
  });

  it('dentroDeVentana: 18:00–06:00 y 17:30–00:00 cruzan la medianoche', () => {
    const noche = { inicio: '18:00', fin: '06:00' };
    expect(dentroDeVentana(aMinutos('18:00'), noche)).toBe(true);
    expect(dentroDeVentana(aMinutos('23:59'), noche)).toBe(true);
    expect(dentroDeVentana(aMinutos('00:00'), noche)).toBe(true);
    expect(dentroDeVentana(aMinutos('05:59'), noche)).toBe(true);
    expect(dentroDeVentana(aMinutos('06:01'), noche)).toBe(false);
    expect(dentroDeVentana(aMinutos('12:00'), noche)).toBe(false);
    const redes = { inicio: '17:30', fin: '00:00' };
    expect(dentroDeVentana(aMinutos('17:29'), redes)).toBe(false);
    expect(dentroDeVentana(aMinutos('23:59'), redes)).toBe(true);
    expect(dentroDeVentana(aMinutos('00:00'), redes)).toBe(true);
    expect(dentroDeVentana(aMinutos('00:01'), redes)).toBe(false);
    expect(
      dentroDeAlgunaVentana(aMinutos('20:00'), [
        { inicio: '06:00', fin: '11:00' },
        { inicio: '19:00', fin: '21:00' },
      ]),
    ).toBe(true);
    expect(
      dentroDeAlgunaVentana(aMinutos('15:00'), [
        { inicio: '06:00', fin: '11:00' },
        { inicio: '19:00', fin: '21:00' },
      ]),
    ).toBe(false);
  });

  it('minutosLocales y horaLocal convierten UTC a la zona del proyecto (Lima por defecto)', () => {
    expect(ZONA_HORARIA_POR_DEFECTO).toBe('America/Lima');
    expect(minutosLocales(lima('2026-12-05', '06:10'), 'America/Lima')).toBe(370);
    expect(minutosLocales('2026-12-05T00:30:00Z', 'America/Lima')).toBe(19 * 60 + 30); // día anterior en Lima
    expect(minutosLocales('2026-12-05T00:30:00Z', 'UTC')).toBe(30);
    expect(minutosLocales('no es fecha', 'UTC')).toBeNull();
    expect(horaLocal(lima('2026-12-05', '23:05'), 'America/Lima')).toBe('23:05');
    expect(horaLocal('x', 'UTC')).toBe('--:--');
    expect(() => minutosLocales('2026-12-05T00:00:00Z', 'Marte/Olimpo')).toThrow(RangeError);
  });

  it('duracionMinutos', () => {
    expect(duracionMinutos(lima('2026-12-05', '08:00'), lima('2026-12-05', '08:45'))).toBe(45);
    expect(duracionMinutos(null, lima('2026-12-05', '08:45'))).toBeNull();
    expect(duracionMinutos(lima('2026-12-05', '08:00'), 'x')).toBeNull();
  });
});
