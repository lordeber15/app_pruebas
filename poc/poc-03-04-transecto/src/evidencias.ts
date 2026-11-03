import { File, Paths } from "expo-file-system";

export interface Evidencias {
  fotos: number;
  audios: number;
}

const archivo = new File(Paths.document, "evidencias.json");

export function leerEvidencias(): Evidencias {
  if (!archivo.exists) return { fotos: 0, audios: 0 };
  return JSON.parse(archivo.textSync()) as Evidencias;
}

export function guardarEvidencias(evidencias: Evidencias) {
  if (!archivo.exists) archivo.create();
  archivo.write(JSON.stringify(evidencias));
}
