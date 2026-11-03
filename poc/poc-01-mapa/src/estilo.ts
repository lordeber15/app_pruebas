import type { StyleSpecification } from "@maplibre/maplibre-react-native";

import capasBase from "./capas-base.json";
import type { PaqueteLocal } from "./paquete";

export function crearEstilo(paquete: PaqueteLocal): StyleSpecification {
  return {
    version: 8,
    glyphs: `${paquete.glifosUri}/{fontstack}/{range}.pbf`,
    sources: {
      protomaps: {
        type: "vector",
        url: `pmtiles://${paquete.pmtilesUri}`,
        attribution: "© OpenStreetMap",
      },
    },
    layers: capasBase as StyleSpecification["layers"],
  };
}
