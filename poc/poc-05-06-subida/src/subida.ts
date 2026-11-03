import { File, Paths } from "expo-file-system";
import { randomUUID } from "react-native-quick-crypto";
import { Upload } from "tus-js-client";

import { generarFoto, sha256DeArchivo } from "./archivos";

export const TOTAL_FOTOS = 50;
const TROZO_BYTES = 5 * 1024 * 1024;
const ESPERA_REINTENTO_MS = 3_000;
// Android no pone limite de tiempo a estas conexiones: sin esto, una red muerta deja la subida colgada.
const LIMITE_SIN_AVANCE_MS = 30_000;

export interface Foto {
  id: string;
  archivo: string;
  tamano: number;
  sha256: string;
  // Se guarda porque tus-js-client no recuerda la URL en React Native; sin ella no hay reanudacion.
  url: string | null;
  subida: boolean;
}

export interface Estado {
  servidor: string;
  fotos: Foto[];
  reintentos: number;
  bloqueos: number;
  aperturas: number;
}

const archivoEstado = new File(Paths.document, "subida.json");

export function leerEstado(): Estado | null {
  if (!archivoEstado.exists) return null;
  return JSON.parse(archivoEstado.textSync()) as Estado;
}

function guardar(estado: Estado) {
  if (!archivoEstado.exists) archivoEstado.create();
  archivoEstado.write(JSON.stringify(estado));
}

export async function generarLote(
  servidor: string,
  alAvanzar: (hechas: number) => void,
): Promise<Estado> {
  const fotos: Foto[] = [];
  for (let i = 0; i < TOTAL_FOTOS; i += 1) {
    const { archivo, tamano } = generarFoto(i);
    fotos.push({ id: randomUUID(), archivo, tamano, sha256: await sha256DeArchivo(archivo), url: null, subida: false });
    alAvanzar(i + 1);
    await new Promise((resolver) => setTimeout(resolver, 0));
  }
  const estado: Estado = { servidor, fotos, reintentos: 0, bloqueos: 0, aperturas: 0 };
  guardar(estado);
  return estado;
}

function subirUna(estado: Estado, foto: Foto, alProgreso: (bytes: number) => void): Promise<void> {
  return new Promise((resolver, rechazar) => {
    let vigilante: ReturnType<typeof setTimeout> | undefined;
    const rearmar = () => {
      clearTimeout(vigilante);
      vigilante = setTimeout(() => {
        estado.bloqueos += 1;
        upload.abort(false).catch(() => undefined);
        rechazar(new Error("sin avance"));
      }, LIMITE_SIN_AVANCE_MS);
    };
    const upload = new Upload(
      { uri: foto.archivo },
      {
        endpoint: `${estado.servidor}/files/`,
        uploadUrl: foto.url,
        chunkSize: TROZO_BYTES,
        retryDelays: null,
        metadata: { archivo_id: foto.id, variante: "original", sha256: foto.sha256 },
        onUploadUrlAvailable: () => {
          foto.url = upload.url;
          guardar(estado);
        },
        onProgress: (enviados) => {
          rearmar();
          alProgreso(enviados);
        },
        onSuccess: () => {
          clearTimeout(vigilante);
          resolver();
        },
        onError: (error) => {
          clearTimeout(vigilante);
          rechazar(error);
        },
      },
    );
    rearmar();
    upload.start();
  });
}

export interface Avance {
  subidas: number;
  bytesActual: number;
  mensaje: string;
}

// Sube en orden y reintenta sin limite: un corte nunca descarta una foto.
export async function subirTodo(
  estado: Estado,
  debeSeguir: () => boolean,
  alAvanzar: (avance: Avance) => void,
): Promise<void> {
  estado.aperturas += 1;
  guardar(estado);
  const contarSubidas = () => estado.fotos.filter(({ subida }) => subida).length;
  for (const foto of estado.fotos) {
    while (!foto.subida && debeSeguir()) {
      try {
        await subirUna(estado, foto, (bytes) =>
          alAvanzar({ subidas: contarSubidas(), bytesActual: bytes, mensaje: "Subiendo" }),
        );
        foto.subida = true;
        guardar(estado);
        alAvanzar({ subidas: contarSubidas(), bytesActual: 0, mensaje: "Subiendo" });
      } catch (error: unknown) {
        estado.reintentos += 1;
        guardar(estado);
        alAvanzar({ subidas: contarSubidas(), bytesActual: 0, mensaje: `Se reintentará (${String(error).slice(0, 100)})` });
        await new Promise((resolver) => setTimeout(resolver, ESPERA_REINTENTO_MS));
      }
    }
  }
}
