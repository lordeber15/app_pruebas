/**
 * UUID v7 (RFC 9562): 48 bits de milisegundos Unix + versión + 74 bits aleatorios.
 * Core no tiene I/O: la fuente de aleatoriedad la inyecta cada plataforma
 * (Node: crypto.getRandomValues; móvil: react-native-quick-crypto).
 */
export type FuenteAleatoria = (bytes: number) => Uint8Array;

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

export const crearGeneradorUuidV7 =
  (aleatorios: FuenteAleatoria, ahora: () => number = Date.now) =>
  (): string => {
    const ms = ahora();
    if (!Number.isSafeInteger(ms) || ms < 0) throw new RangeError('Hora inválida para UUID v7');
    const b = new Uint8Array(16);
    const azar = aleatorios(10);
    if (azar.length < 10) throw new RangeError('La fuente aleatoria devolvió menos de 10 bytes');
    // 48 bits de tiempo en big endian (sin operadores de bits: superan los 32 bits).
    let t = ms;
    for (let i = 5; i >= 0; i--) {
      b[i] = t % 256;
      t = Math.floor(t / 256);
    }
    b.set(azar.subarray(0, 10), 6);
    b[6] = ((b[6] ?? 0) & 0x0f) | 0x70; // versión 7
    b[8] = ((b[8] ?? 0) & 0x3f) | 0x80; // variante RFC 9562
    const h = Array.from(b, (x) => HEX[x] ?? '00').join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };

/** Milisegundos Unix codificados en un UUID v7. */
export const instanteUuidV7 = (uuid: string): number =>
  Number.parseInt(uuid.replaceAll('-', '').slice(0, 12), 16);
