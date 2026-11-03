// Proxy TCP con limite de velocidad: el limite de red del emulador no se aplica.
// Uso: node scripts/limitar.mjs <puerto-entrada> <puerto-destino> <bytes-por-segundo>
import { connect, createServer } from "node:net";

const [entrada, destino, limite] = process.argv.slice(2).map(Number);
const TRAMO = 64 * 1024;

function pasarConLimite(origen, salida) {
  origen.on("data", (datos) => {
    origen.pause();
    salida.write(datos, () => {
      setTimeout(() => origen.resume(), (datos.length / limite) * 1000);
    });
  });
  origen.on("end", () => salida.end());
  origen.on("error", () => salida.destroy());
  origen.on("close", () => salida.destroy());
}

createServer({ highWaterMark: TRAMO }, (cliente) => {
  const servidor = connect(destino, "127.0.0.1");
  pasarConLimite(cliente, servidor);
  pasarConLimite(servidor, cliente);
}).listen(entrada, "0.0.0.0");
