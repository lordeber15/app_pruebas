import * as Location from 'expo-location';

/**
 * Geolocalización propia de la app (D02 §7, T-11): la coordenada la toma el celular; el GPS
 * externo del consultor no participa ni genera umbrales.
 */
export interface Lectura {
  lat: number;
  lon: number;
  precision_m: number | null;
  altitud_m: number | null;
  hora: string;
}

export const pedirPermiso = async (): Promise<boolean> =>
  (await Location.requestForegroundPermissionsAsync()).granted;

/** Lectura precisa del momento, con un tope de espera; `null` si no hay señal GPS a tiempo. */
export const leerPosicion = async (esperaMs = 20_000): Promise<Lectura | null> => {
  if (!(await pedirPermiso())) return null;
  const pos = await Promise.race([
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }),
    new Promise<null>((r) => setTimeout(() => r(null), esperaMs)),
  ]);
  if (pos === null) return null;
  return {
    lat: pos.coords.latitude,
    lon: pos.coords.longitude,
    precision_m: pos.coords.accuracy,
    altitud_m: pos.coords.altitude,
    hora: new Date(pos.timestamp).toISOString(),
  };
};

/**
 * Track del recorrido (RN-24): ~15 m o ~20 s, lo que ocurra primero (decisión técnica vigente).
 * ⚑ Solo en primer plano: con la pantalla apagada no registra. El registro en segundo plano
 * (CA-10) necesita un módulo de procesos en segundo plano y un binario nuevo.
 */
export const seguirRecorrido = (alLeer: (l: Lectura) => void): Promise<{ remove: () => void }> =>
  Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, distanceInterval: 15, timeInterval: 20_000 },
    (pos) =>
      alLeer({
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        precision_m: pos.coords.accuracy,
        altitud_m: pos.coords.altitude,
        hora: new Date(pos.timestamp).toISOString(),
      }),
  );

export const formatoPrecision = (m: number | null): string =>
  m === null ? 'precisión desconocida' : `± ${String(Math.round(m))} m`;

export const formatoCoordenada = (lat: number, lon: number): string =>
  `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
