import { Asset } from "expo-asset";
import { Directory, File, Paths } from "expo-file-system";

import area from "./area.json";

const GLIFOS: Record<string, number> = {
  "0-255": require("../assets/mapa/glifos/0-255.pbf"),
  "256-511": require("../assets/mapa/glifos/256-511.pbf"),
  "8192-8447": require("../assets/mapa/glifos/8192-8447.pbf"),
};

export interface PaqueteLocal {
  pmtilesUri: string;
  geojsonUri: string;
  glifosUri: string;
}

async function copiarSiFalta(modulo: number, destino: File) {
  if (destino.exists) return;
  const asset = await Asset.fromModule(modulo).downloadAsync();
  if (!asset.localUri) throw new Error(`Recurso sin ruta local: ${asset.name}`);
  await new File(asset.localUri).copy(destino);
}

// Simula el paquete cartografico ya descargado: deja los archivos en la carpeta privada.
export async function prepararPaquete(): Promise<PaqueteLocal> {
  // Carpeta por paquete: al actualizar el APK no se reutilizan los datos del paquete anterior.
  const raiz = new Directory(Paths.document, `mapa-${area.id}`);
  const glifos = new Directory(raiz, "glifos", "NotoSansRegular");
  glifos.create({ intermediates: true, idempotent: true });

  const pmtiles = new File(raiz, "base.pmtiles");
  const geojson = new File(raiz, "capa-kmz.geojson");
  await copiarSiFalta(require("../assets/mapa/base.pmtiles"), pmtiles);
  await copiarSiFalta(require("../assets/mapa/capa-kmz.geojson"), geojson);
  for (const [rango, modulo] of Object.entries(GLIFOS)) {
    await copiarSiFalta(modulo, new File(glifos, `${rango}.pbf`));
  }

  return {
    pmtilesUri: pmtiles.uri,
    geojsonUri: geojson.uri,
    glifosUri: new Directory(raiz, "glifos").uri.replace(/\/$/, ""),
  };
}
