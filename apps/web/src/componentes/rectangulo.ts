import type { Bbox } from '@campo/core';

/** Polígono GeoJSON de un rectángulo [oeste, sur, este, norte] (sin MapLibre: no pesa en la carga). */
export const poligonoDeBbox = ([o, s, e, n]: Bbox) => ({
  type: 'Polygon' as const,
  coordinates: [
    [
      [o, s],
      [e, s],
      [e, n],
      [o, n],
      [o, s],
    ],
  ],
});
