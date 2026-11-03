export interface Punto {
  latitude: number;
  longitude: number;
}

export interface Tarea extends Punto {
  id: string;
  nombre: string;
}

export interface Zona {
  nombre: string;
  vertices: Punto[];
}

export const RADIO_AVISO_M = 100;
export const PERIMETRO_MINIMO_M = 200;
const METROS_POR_GRADO = 111_320;

export function desplazar(origen: Punto, norteM: number, esteM: number): Punto {
  return {
    latitude: origen.latitude + norteM / METROS_POR_GRADO,
    longitude:
      origen.longitude +
      esteM / (METROS_POR_GRADO * Math.cos((origen.latitude * Math.PI) / 180)),
  };
}

export function distanciaM(a: Punto, b: Punto): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

// Metodo del rayo; a estas distancias la curvatura no importa.
export function dentroDeZona(p: Punto, vertices: Punto[]): boolean {
  let dentro = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[i];
    const b = vertices[j];
    if (!a || !b) continue;
    const cruza =
      a.latitude > p.latitude !== b.latitude > p.latitude &&
      p.longitude <
        ((b.longitude - a.longitude) * (p.latitude - a.latitude)) /
          (b.latitude - a.latitude) +
          a.longitude;
    if (cruza) dentro = !dentro;
  }
  return dentro;
}

// 60 tareas sinteticas (CP-020): anillos desde 300 m para no abrir la jornada ya dentro de un radio.
export function generarTareas(origen: Punto): Tarea[] {
  return Array.from({ length: 60 }, (_, i) => {
    const distancia = 300 + i * 60;
    const angulo = i * 2.399963; // angulo aureo: reparte las tareas sin alinearlas
    return {
      id: `tarea-${String(i + 1).padStart(2, "0")}`,
      nombre: `Tarea ${i + 1}`,
      ...desplazar(origen, distancia * Math.cos(angulo), distancia * Math.sin(angulo)),
    };
  });
}

// Zona de 200 x 200 m cuyo borde cercano queda a 150 m al sur del punto de apertura.
export function generarZona(origen: Punto): Zona {
  const esquinas: [number, number][] = [
    [-150, -100],
    [-150, 100],
    [-350, 100],
    [-350, -100],
  ];
  return {
    nombre: "Zona de prueba",
    vertices: esquinas.map(([norte, este]) => desplazar(origen, norte, este)),
  };
}

export interface Vigilancia {
  tareas: Tarea[];
  perimetroM: number | null;
}

/**
 * Elige las tareas mas cercanas (RN-14) y el perimetro de recalculo: dentro de el,
 * ninguna tarea sin vigilar puede quedar a menos del radio de aviso.
 */
export function elegirVigilancia(pos: Punto, tareas: Tarea[], cupo: number): Vigilancia {
  const orden = [...tareas].sort((a, b) => distanciaM(pos, a) - distanciaM(pos, b));
  const siguiente = orden[cupo];
  return {
    tareas: orden.slice(0, cupo),
    perimetroM: siguiente
      ? Math.max(PERIMETRO_MINIMO_M, distanciaM(pos, siguiente) - RADIO_AVISO_M)
      : null,
  };
}
