import { File, Paths } from "expo-file-system";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";

import {
  distanciaM,
  elegirVigilancia,
  generarTareas,
  generarZona,
  type Punto,
  RADIO_AVISO_M,
  type Tarea,
  type Zona,
} from "./geo";

const TAREA_GEOVALLAS = "poc-cercania-geovallas";
const REGION_PERIMETRO = "perimetro";
const CANAL = "cercania";
// iOS vigila 20 regiones como maximo y una la ocupa el perimetro. Android admite 100.
const CUPO_TAREAS = Platform.OS === "ios" ? 19 : 20;
const ESPERA_APERTURA_MS = 45_000;
const ESPERA_EN_TAREA_MS = 8_000;

export interface EntradaBitacora {
  hora: string;
  texto: string;
}

export interface Estado {
  tareas: Tarea[];
  zona: Zona;
  avisados: string[];
  vigiladas: number;
  recalculos: number;
  bitacora: EntradaBitacora[];
}

const archivo = new File(Paths.document, "estado.json");

export async function leerEstado(): Promise<Estado | null> {
  if (!archivo.exists) return null;
  return JSON.parse(await archivo.text()) as Estado;
}

function guardarEstado(estado: Estado) {
  if (!archivo.exists) archivo.create();
  archivo.write(JSON.stringify(estado));
}

// Varias geovallas pueden dispararse juntas: se atienden en orden para no pisar el archivo.
let cola: Promise<unknown> = Promise.resolve();
function enCola(trabajo: () => Promise<void>): Promise<void> {
  const siguiente = cola.then(trabajo, trabajo);
  cola = siguiente.catch(() => undefined);
  return siguiente;
}

function anotar(estado: Estado, texto: string) {
  estado.bitacora.unshift({ hora: new Date().toISOString(), texto });
}

async function vigilarDesde(pos: Punto, estado: Estado) {
  const { tareas, perimetroM } = elegirVigilancia(pos, estado.tareas, CUPO_TAREAS);
  const regiones: Location.LocationRegion[] = tareas.map((tarea) => ({
    identifier: tarea.id,
    latitude: tarea.latitude,
    longitude: tarea.longitude,
    radius: RADIO_AVISO_M,
    notifyOnEnter: true,
    notifyOnExit: false,
  }));
  if (perimetroM !== null) {
    regiones.push({
      identifier: REGION_PERIMETRO,
      latitude: pos.latitude,
      longitude: pos.longitude,
      radius: perimetroM,
      notifyOnEnter: false,
      notifyOnExit: true,
    });
  }
  await Location.startGeofencingAsync(TAREA_GEOVALLAS, regiones);
  estado.vigiladas = tareas.length;
}

// Sin red, solo el GPS responde: las precisiones bajas dependen de la red y la promesa no termina.
async function leerPosicion(esperaMs: number): Promise<Punto | null> {
  const limite = new Promise<null>((resolver) => setTimeout(() => resolver(null), esperaMs));
  const lectura = Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Highest,
    mayShowUserSettingsDialog: false,
  }).then(({ coords }) => coords as Punto, () => null);
  return (
    (await Promise.race([lectura, limite])) ??
    (await Location.getLastKnownPositionAsync())?.coords ??
    null
  );
}

async function avisar(titulo: string, cuerpo: string) {
  await Notifications.scheduleNotificationAsync({
    content: { title: titulo, body: cuerpo },
    trigger: Platform.OS === "android" ? { channelId: CANAL } : null,
  });
}

// La posicion se lee, se compara y se descarta (RN-14): solo se anota la distancia redondeada,
// que es lo que permite estimar la demora del aviso en esta prueba.
async function atenderEntrada(identificador: string) {
  const estado = await leerEstado();
  const tarea = estado?.tareas.find(({ id }) => id === identificador);
  if (!estado || !tarea || estado.avisados.includes(tarea.id)) return;

  estado.avisados.push(tarea.id);
  anotar(estado, `Aviso de ${tarea.nombre}`);
  guardarEstado(estado);
  // El aviso va primero: leer la posicion puede tardar y el sistema limita esta tarea.
  await avisar("Tarea cercana", `Está a ${RADIO_AVISO_M} m o menos de ${tarea.nombre}.`);

  const pos = await leerPosicion(ESPERA_EN_TAREA_MS);
  const entrada = estado.bitacora[0];
  if (pos && entrada) {
    entrada.texto += `, a unos ${Math.round(distanciaM(pos, tarea) / 10) * 10} m`;
    guardarEstado(estado);
  }
}

async function atenderSalidaPerimetro() {
  const estado = await leerEstado();
  if (!estado) return;
  const pos = await leerPosicion(ESPERA_EN_TAREA_MS);
  if (!pos) {
    anotar(estado, "No se pudo recalcular: sin posición");
    guardarEstado(estado);
    return;
  }
  await vigilarDesde(pos, estado);
  estado.recalculos += 1;
  anotar(estado, `Lista recalculada (${estado.vigiladas} tareas vigiladas)`);
  guardarEstado(estado);
}

interface EventoGeovalla {
  eventType: Location.GeofencingEventType;
  region: Location.LocationRegion;
}

// Debe definirse al cargar el modulo: con la app cerrada el sistema la inicia sin interfaz.
TaskManager.defineTask<EventoGeovalla>(TAREA_GEOVALLAS, async ({ data, error }) => {
  if (error) return;
  const { eventType, region } = data;
  if (region.identifier === REGION_PERIMETRO) {
    if (eventType === Location.GeofencingEventType.Exit) await enCola(atenderSalidaPerimetro);
  } else if (eventType === Location.GeofencingEventType.Enter && region.identifier) {
    const identificador = region.identifier;
    await enCola(() => atenderEntrada(identificador));
  }
});

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function prepararAvisos(): Promise<boolean> {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(CANAL, {
      name: "Aviso de cercanía",
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  const { granted } = await Notifications.requestPermissionsAsync();
  return granted;
}

export async function pedirUbicacion(): Promise<"siempre" | "en-uso" | "denegada"> {
  const primerPlano = await Location.requestForegroundPermissionsAsync();
  if (!primerPlano.granted) return "denegada";
  const segundoPlano = await Location.requestBackgroundPermissionsAsync();
  return segundoPlano.granted ? "siempre" : "en-uso";
}

export function jornadaAbierta(): Promise<boolean> {
  return Location.hasStartedGeofencingAsync(TAREA_GEOVALLAS);
}

export async function abrirJornada(): Promise<void> {
  const pos = await leerPosicion(ESPERA_APERTURA_MS);
  if (!pos) throw new Error("sin posición");
  const estado: Estado = {
    tareas: generarTareas(pos),
    zona: generarZona(pos),
    avisados: [],
    vigiladas: 0,
    recalculos: 0,
    bitacora: [],
  };
  await vigilarDesde(pos, estado);
  anotar(estado, `Jornada abierta (${estado.vigiladas} de ${estado.tareas.length} tareas vigiladas)`);
  guardarEstado(estado);
}

export async function cerrarJornada(): Promise<void> {
  await Location.stopGeofencingAsync(TAREA_GEOVALLAS);
  const estado = await leerEstado();
  if (!estado) return;
  anotar(estado, "Jornada cerrada");
  guardarEstado(estado);
}

// Zonas KMZ solo con la app activa (PoC-02).
export function atenderEntradaZona(): Promise<void> {
  return enCola(async () => {
    const estado = await leerEstado();
    if (!estado || estado.avisados.includes("zona")) return;
    estado.avisados.push("zona");
    anotar(estado, `Aviso de ${estado.zona.nombre}`);
    guardarEstado(estado);
    await avisar("Zona de trabajo", `Entró en ${estado.zona.nombre}.`);
  });
}

export function probarAviso(): Promise<void> {
  return avisar("Prueba de aviso", "Los avisos funcionan.");
}
