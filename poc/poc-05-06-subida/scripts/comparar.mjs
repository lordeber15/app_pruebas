import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [carpeta, esperadosTexto] = process.argv.slice(2);
const esperados = Number(esperadosTexto);
const infos = readdirSync(carpeta).filter((nombre) => nombre.endsWith(".info"));

const porArchivo = new Map();
let incompletas = 0;
let corruptos = 0;
let incompletasDeArchivoCompleto = 0;
const filas = infos.map((nombre) => {
  const info = JSON.parse(readFileSync(join(carpeta, nombre), "utf8"));
  const id = info.MetaData.archivo_id;
  const ruta = join(carpeta, nombre.replace(/\.info$/, ""));
  let bytes;
  try {
    bytes = readFileSync(ruta);
  } catch {
    return { id, completa: false };
  }
  const completa = bytes.length === info.Size;
  const correcto = completa && createHash("sha256").update(bytes).digest("hex") === info.MetaData.sha256;
  if (completa && !correcto) {
    corruptos += 1;
    console.log(`CORRUPTO ${id}: ${bytes.length} bytes`);
  }
  return { id, completa, correcto };
});
for (const { id, completa, correcto } of filas) {
  if (!completa) {
    incompletas += 1;
    continue;
  }
  if (correcto) porArchivo.set(id, (porArchivo.get(id) ?? 0) + 1);
}
for (const { id, completa } of filas) {
  if (!completa && porArchivo.has(id)) incompletasDeArchivoCompleto += 1;
}
const repetidos = [...porArchivo.values()].filter((n) => n > 1).length;
const perdidos = esperados - porArchivo.size;
console.log(`Subidas registradas: ${infos.length}`);
console.log(`Archivos verificados: ${porArchivo.size} de ${esperados}`);
console.log(`Perdidos: ${perdidos}`);
console.log(`Corruptos: ${corruptos}`);
console.log(`Completos mas de una vez: ${repetidos}`);
console.log(`Subidas incompletas: ${incompletas} (de archivos ya completos: ${incompletasDeArchivoCompleto})`);
process.exit(perdidos === 0 && corruptos === 0 ? 0 : 1);
