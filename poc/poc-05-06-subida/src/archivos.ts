import { Directory, File, Paths } from "expo-file-system";
import { createHash, randomBytes } from "react-native-quick-crypto";

const MB = 1024 * 1024;
const TROZO_LECTURA = MB;
const carpeta = new Directory(Paths.document, "fotos");

// Mezcla tamanos por debajo y por encima del trozo de 5 MB; la ultima llega al maximo de 25 MB (doc. 03 §10).
function tamanoDe(indice: number): number {
  return indice === 49 ? 25 * MB : (3 + (indice % 6)) * MB;
}

export interface FotoGenerada {
  archivo: string;
  tamano: number;
}

function escribirAleatorio(archivo: File, tamano: number) {
  if (archivo.exists) archivo.delete();
  archivo.create();
  const salida = archivo.open();
  try {
    for (let escritos = 0; escritos < tamano; escritos += TROZO_LECTURA) {
      const bytes = randomBytes(Math.min(TROZO_LECTURA, tamano - escritos));
      salida.writeBytes(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length));
    }
  } finally {
    salida.close();
  }
}

export function generarFoto(indice: number): FotoGenerada {
  if (!carpeta.exists) carpeta.create();
  const archivo = new File(carpeta, `foto-${String(indice + 1).padStart(2, "0")}.bin`);
  const tamano = tamanoDe(indice);
  escribirAleatorio(archivo, tamano);
  return { archivo: archivo.uri, tamano };
}

// Por streaming: el archivo nunca esta completo en memoria (doc. 03 §2.1).
export async function sha256DeArchivo(uri: string): Promise<string> {
  const hash = createHash("sha256");
  const entrada = new File(uri).open();
  try {
    const tamano = entrada.size ?? 0;
    for (let leidos = 0; leidos < tamano; leidos += TROZO_LECTURA) {
      hash.update(await entrada.readBytes(Math.min(TROZO_LECTURA, tamano - leidos)));
    }
  } finally {
    entrada.close();
  }
  return hash.digest("hex");
}

export interface MedicionHash {
  medicionesMs: number[];
  medianaMs: number;
  maximoMs: number;
}

export async function medirHash(veces: number): Promise<MedicionHash> {
  const prueba = new File(Paths.cache, "hash-6mb.bin");
  escribirAleatorio(prueba, 6 * MB);
  const medicionesMs: number[] = [];
  try {
    for (let i = 0; i < veces; i += 1) {
      const inicio = performance.now();
      await sha256DeArchivo(prueba.uri);
      medicionesMs.push(Math.round(performance.now() - inicio));
      // Deja respirar a la interfaz entre mediciones.
      await new Promise((resolver) => setTimeout(resolver, 50));
    }
  } finally {
    prueba.delete();
  }
  const orden = [...medicionesMs].sort((a, b) => a - b);
  return {
    medicionesMs,
    medianaMs: orden[Math.floor(orden.length / 2)] ?? 0,
    maximoMs: orden[orden.length - 1] ?? 0,
  };
}
