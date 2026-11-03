// PoC-01: genera el estilo offline del mapa base (sin iconos y con una sola fuente local).
import { writeFileSync } from "node:fs";
import { layers, namedFlavor } from "@protomaps/basemaps";

const FUENTE_LOCAL = ["NotoSansRegular"];

const capas = layers("protomaps", namedFlavor("light"), { lang: "es" })
  .filter((capa) => !capa.layout?.["icon-image"])
  .map((capa) =>
    capa.layout?.["text-font"]
      ? { ...capa, layout: { ...capa.layout, "text-font": FUENTE_LOCAL } }
      : capa,
  );

writeFileSync(
  new URL("../src/capas-base.json", import.meta.url),
  JSON.stringify(capas),
);
