import { crearGeneradorUuidV7 } from '@campo/core';
import { File } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { createHash, install, randomFillSync } from 'react-native-quick-crypto';

// WebCrypto (crypto.subtle, getRandomValues) para la llave del dispositivo.
install();

/** UUID v7 generados en el celular (RN-10): ids de eventos y entidades creadas en campo. */
export const generarId = crearGeneradorUuidV7((n) => {
  const b = new Uint8Array(n);
  randomFillSync(b);
  return b;
});

const TROZO = 1024 * 1024;

/** SHA-256 por streaming: el archivo nunca está completo en memoria (validado en PoC-06). */
export const sha256DeArchivo = async (uri: string): Promise<{ hash: string; tamano: number }> => {
  const hash = createHash('sha256');
  const entrada = new File(uri).open();
  try {
    const tamano = entrada.size ?? 0;
    for (let leidos = 0; leidos < tamano; leidos += TROZO) {
      hash.update(await entrada.readBytes(Math.min(TROZO, tamano - leidos)));
    }
    return { hash: hash.digest('hex'), tamano };
  } finally {
    entrada.close();
  }
};

/** Llavero del sistema (Keystore en Android): token de sesión, llave privada y PIN. */
export const llavero = {
  leer: (clave: string) => SecureStore.getItemAsync(clave),
  guardar: (clave: string, valor: string) => SecureStore.setItemAsync(clave, valor),
  borrar: (clave: string) => SecureStore.deleteItemAsync(clave),
};

export const CLAVES = {
  servidor: 'campo.servidor',
  token: 'campo.token',
  llavePrivada: 'campo.llave_privada',
  dispositivo: 'campo.dispositivo_id',
  pin: 'campo.pin',
  usuario: 'campo.usuario',
} as const;
