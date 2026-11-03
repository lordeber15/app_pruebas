import { File, Paths } from "expo-file-system";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import { distanciaM } from "./geo";

const TAREA_TRANSECTO = "poc-transecto";
const VENTANA_MS = 20_000;
const LECTURA_MS = 5_000;
// RF-M06 pide un punto cada ~15 m o ~20 s. En Android, timeInterval y distanceInterval se exigen
// a la vez, asi que se lee seguido y se filtra aqui. Con 15 s, el hueco queda en 20 s o menos.
const TIEMPO_MINIMO_MS = 15_000;
const DISTANCIA_MINIMA_M = 15;

export interface PuntoTransecto {
  latitude: number;
  longitude: number;
  altitud: number | null;
  precision: number | null;
  hora: number;
  // Reloj del celular al recibir el punto: la hora del GPS puede diferir y no sirve para medir huecos.
  recibido: number;
}

export interface Periodo {
  inicio: number;
  fin: number | null;
}

export interface Resumen {
  puntos: number;
  duracionS: number;
  esperados: number;
  cubiertos: number;
  porcentaje: number;
  mayorHuecoS: number;
  precisionMedianaM: number | null;
}

const archivoPuntos = new File(Paths.document, "transecto.jsonl");
const archivoPeriodo = new File(Paths.document, "transecto.json");
let ultimo: PuntoTransecto | null = null;

export function leerPuntos(): PuntoTransecto[] {
  if (!archivoPuntos.exists) return [];
  return archivoPuntos
    .textSync()
    .split("\n")
    .filter(Boolean)
    .map((linea) => JSON.parse(linea) as PuntoTransecto);
}

export function leerPeriodo(): Periodo | null {
  if (!archivoPeriodo.exists) return null;
  return JSON.parse(archivoPeriodo.textSync()) as Periodo;
}

function guardarPeriodo(periodo: Periodo) {
  if (!archivoPeriodo.exists) archivoPeriodo.create();
  archivoPeriodo.write(JSON.stringify(periodo));
}

function aceptar({ coords, timestamp }: Location.LocationObject) {
  // Con la app reiniciada por el sistema, la memoria esta vacia: se recupera del archivo.
  ultimo ??= leerPuntos().at(-1) ?? null;
  if (
    ultimo &&
    Date.now() - ultimo.recibido < TIEMPO_MINIMO_MS &&
    distanciaM(ultimo, coords) < DISTANCIA_MINIMA_M
  ) {
    return;
  }
  const punto: PuntoTransecto = {
    latitude: coords.latitude,
    longitude: coords.longitude,
    altitud: coords.altitude,
    precision: coords.accuracy,
    hora: timestamp,
    recibido: Date.now(),
  };
  archivoPuntos.write(`${JSON.stringify(punto)}\n`, { append: true });
  ultimo = punto;
}

// Debe definirse al cargar el modulo: con la app cerrada el sistema la inicia sin interfaz.
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(TAREA_TRANSECTO, async ({ data, error }) => {
  if (error) return;
  data.locations.forEach(aceptar);
});

export function transectoActivo(): Promise<boolean> {
  return Location.hasStartedLocationUpdatesAsync(TAREA_TRANSECTO);
}

export async function iniciarTransecto(): Promise<void> {
  if (archivoPuntos.exists) archivoPuntos.delete();
  archivoPuntos.create();
  ultimo = null;
  await Location.startLocationUpdatesAsync(TAREA_TRANSECTO, {
    accuracy: Location.Accuracy.Highest,
    timeInterval: LECTURA_MS,
    distanceInterval: 0,
    mayShowUserSettingsDialog: false,
    activityType: Location.ActivityType.Fitness,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: "Transecto en curso",
      notificationBody: "Se está registrando su recorrido.",
      killServiceOnDestroy: false,
    },
  });
  guardarPeriodo({ inicio: Date.now(), fin: null });
}

export async function terminarTransecto(): Promise<void> {
  await Location.stopLocationUpdatesAsync(TAREA_TRANSECTO);
  const periodo = leerPeriodo();
  if (periodo) guardarPeriodo({ ...periodo, fin: Date.now() });
}

// Se espera al menos un punto en cada ventana de 20 s del transecto (PoC-03).
export function resumir(puntos: PuntoTransecto[], { inicio, fin }: Periodo, ahora: number): Resumen {
  const final = fin ?? ahora;
  const esperados = Math.max(1, Math.floor((final - inicio) / VENTANA_MS));
  const ventanas = new Set(puntos.map(({ recibido }) => Math.floor((recibido - inicio) / VENTANA_MS)));
  let cubiertos = 0;
  for (let i = 0; i < esperados; i += 1) if (ventanas.has(i)) cubiertos += 1;

  let anterior = inicio;
  let mayorHuecoMs = 0;
  for (const { recibido } of puntos) {
    mayorHuecoMs = Math.max(mayorHuecoMs, recibido - anterior);
    anterior = recibido;
  }
  mayorHuecoMs = Math.max(mayorHuecoMs, final - anterior);

  const precisiones = puntos
    .map(({ precision }) => precision)
    .filter((precision): precision is number => precision !== null)
    .sort((a, b) => a - b);
  return {
    puntos: puntos.length,
    duracionS: Math.round((final - inicio) / 1000),
    esperados,
    cubiertos,
    porcentaje: Math.floor((cubiertos / esperados) * 100),
    mayorHuecoS: Math.round(mayorHuecoMs / 1000),
    precisionMedianaM: precisiones[Math.floor(precisiones.length / 2)] ?? null,
  };
}
