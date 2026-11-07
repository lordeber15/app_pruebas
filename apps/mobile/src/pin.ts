import { createHash, randomFillSync } from 'react-native-quick-crypto';
import { CLAVES, llavero } from './plataforma.ts';

/**
 * PIN de 6 dígitos para abrir la app sin conexión (RF-M01). Se guarda solo su hash con sal en el
 * llavero. El bloqueo por intentos fallidos está diferido (CP-004, decisión del usuario).
 */
const hashPin = (pin: string, sal: string) =>
  createHash('sha256').update(`${sal}:${pin}`).digest('hex');

export const PIN_VALIDO = /^\d{6}$/;

export const definirPin = async (pin: string): Promise<void> => {
  if (!PIN_VALIDO.test(pin)) throw new Error('El PIN debe tener 6 dígitos.');
  const b = new Uint8Array(16);
  randomFillSync(b);
  const sal = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  await llavero.guardar(CLAVES.pin, `${sal}:${hashPin(pin, sal)}`);
};

export const tienePin = async () => (await llavero.leer(CLAVES.pin)) !== null;

export const verificarPin = async (pin: string): Promise<boolean> => {
  const guardado = await llavero.leer(CLAVES.pin);
  if (guardado === null) return false;
  const [sal, hash] = guardado.split(':');
  return sal !== undefined && hash !== undefined && hashPin(pin, sal) === hash;
};
