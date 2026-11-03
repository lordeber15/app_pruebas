import {
  Camera,
  type CameraRef,
  GeoJSONSource,
  Layer,
  Map,
  UserLocation,
} from "@maplibre/maplibre-react-native";
import * as Location from "expo-location";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import area from "./src/area.json";
import { crearEstilo } from "./src/estilo";
import { type PaqueteLocal, prepararPaquete } from "./src/paquete";

const LIMITES = area.bbox as [number, number, number, number];
const [OESTE, SUR, ESTE, NORTE] = LIMITES;
const CENTRO: [number, number] = [(OESTE + ESTE) / 2, (SUR + NORTE) / 2];
// Zoom con el que el alto del recorte ocupa una pantalla vertical; mas lejos solo se veria gris.
const ZOOM_MINIMO = Math.round(Math.log2((360 / (NORTE - SUR)) * (800 / 512)));
const CUARTO_ANCHO = (ESTE - OESTE) / 4;
const CUARTO_ALTO = (NORTE - SUR) / 4;
// Recorrido fijo para comparar celulares (FPS: ver README). Acerca, recorre y aleja.
const RECORRIDO: { center: [number, number]; zoom: number; duration: number }[] = [
  { center: CENTRO, zoom: area.maxzoom, duration: 6000 },
  { center: [CENTRO[0] - CUARTO_ANCHO, CENTRO[1] - CUARTO_ALTO], zoom: area.maxzoom - 2, duration: 6000 },
  { center: [CENTRO[0] - CUARTO_ANCHO, CENTRO[1] + CUARTO_ALTO], zoom: area.maxzoom, duration: 6000 },
  { center: [CENTRO[0] + CUARTO_ANCHO, CENTRO[1] + CUARTO_ALTO], zoom: ZOOM_MINIMO + 3, duration: 6000 },
  { center: [CENTRO[0] + CUARTO_ANCHO, CENTRO[1] - CUARTO_ALTO], zoom: ZOOM_MINIMO + 3, duration: 6000 },
  { center: CENTRO, zoom: ZOOM_MINIMO, duration: 6000 },
];
// Tolerancia al tocar, para que un punto sea facil de acertar con guantes.
const MARGEN_TOQUE = { top: 24, right: 24, bottom: 24, left: 24 };

type Atributos = Record<string, unknown>;

export default function App() {
  const [paquete, setPaquete] = useState<PaqueteLocal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conUbicacion, setConUbicacion] = useState(false);
  const [atributos, setAtributos] = useState<Atributos | null>(null);
  const camara = useRef<CameraRef>(null);
  const [enRecorrido, setEnRecorrido] = useState(false);

  useEffect(() => {
    prepararPaquete()
      .then(setPaquete)
      .catch((e: unknown) => setError(String(e)));
    Location.requestForegroundPermissionsAsync().then(({ granted }) =>
      setConUbicacion(granted),
    );
  }, []);

  const estilo = useMemo(() => (paquete ? crearEstilo(paquete) : null), [paquete]);

  async function centrarEnUbicacion() {
    try {
      // Sin red, el dialogo de ajustes de Google rechaza la solicitud aunque el GPS funcione.
      const { coords } = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Highest,
        mayShowUserSettingsDialog: false,
      });
      setError(null);
      camara.current?.flyTo({ center: [coords.longitude, coords.latitude], zoom: 12 });
    } catch {
      setError("No se pudo obtener su ubicación. Verifique que el GPS esté encendido.");
    }
  }

  async function hacerRecorrido() {
    setEnRecorrido(true);
    for (const tramo of RECORRIDO) {
      camara.current?.easeTo(tramo);
      await new Promise((resolver) => setTimeout(resolver, tramo.duration));
    }
    setEnRecorrido(false);
  }

  if (!paquete || !estilo) {
    return (
      <View style={styles.centrado}>
        {error ? (
          <Text style={styles.textoError}>{error}</Text>
        ) : (
          <>
            <ActivityIndicator size="large" />
            <Text style={styles.texto}>Preparando el mapa…</Text>
          </>
        )}
      </View>
    );
  }

  return (
    <View style={styles.contenedor}>
      <StatusBar style="dark" />
      <Map
        style={styles.contenedor}
        mapStyle={estilo}
        logo={false}
        attribution={false}
        onPress={() => setAtributos(null)}
      >
        <Camera
          initialViewState={{ center: CENTRO, zoom: ZOOM_MINIMO }}
          minZoom={ZOOM_MINIMO}
          maxBounds={LIMITES}
          ref={camara}
        />
        <GeoJSONSource
          id="capa-kmz"
          data={paquete.geojsonUri}
          hitbox={MARGEN_TOQUE}
          onPress={(evento) => {
            evento.stopPropagation();
            const propiedades = evento.nativeEvent.features[0]?.properties;
            setAtributos(propiedades ?? null);
          }}
        >
          <Layer
            id="capa-kmz-relleno"
            type="fill"
            paint={{ "fill-color": "#0B7285", "fill-opacity": 0.3 }}
          />
          <Layer
            id="capa-kmz-borde"
            type="line"
            paint={{ "line-color": "#0B4F5C", "line-width": 1.5 }}
          />
          <Layer
            id="capa-kmz-puntos"
            type="circle"
            filter={["==", ["geometry-type"], "Point"]}
            paint={{
              "circle-radius": 8,
              "circle-color": "#0B7285",
              "circle-stroke-color": "#fff",
              "circle-stroke-width": 2,
            }}
          />
          <Layer
            id="capa-kmz-etiquetas"
            type="symbol"
            filter={["==", ["geometry-type"], "Point"]}
            layout={{
              "text-field": ["get", "Name"],
              "text-font": ["NotoSansRegular"],
              "text-size": 13,
              "text-offset": [0, 1.2],
              "text-anchor": "top",
            }}
            paint={{ "text-color": "#111", "text-halo-color": "#fff", "text-halo-width": 1.5 }}
          />
        </GeoJSONSource>
        {conUbicacion && <UserLocation accuracy />}
      </Map>

      <Pressable
        style={styles.recorrido}
        onPress={hacerRecorrido}
        disabled={enRecorrido}
        accessibilityRole="button"
      >
        <Text style={styles.textoBoton}>
          {enRecorrido ? "Recorriendo…" : "Recorrido de prueba"}
        </Text>
      </Pressable>

      <Text style={styles.credito}>© OpenStreetMap · © Protomaps</Text>

      {conUbicacion && (
        <Pressable
          style={styles.boton}
          onPress={centrarEnUbicacion}
          accessibilityRole="button"
        >
          <Text style={styles.textoBoton}>Mi ubicación</Text>
        </Pressable>
      )}

      {error && <Text style={styles.avisoError}>{error}</Text>}

      {atributos && (
        <View style={styles.ficha}>
          {Object.entries(atributos).map(([nombre, valor]) => (
            <Text key={nombre} style={styles.texto}>
              <Text style={styles.etiqueta}>{nombre}: </Text>
              {String(valor ?? "—")}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: { flex: 1 },
  centrado: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  texto: { fontSize: 16, color: "#111" },
  etiqueta: { fontWeight: "700" },
  textoError: { fontSize: 16, color: "#A61B1B" },
  recorrido: {
    position: "absolute",
    top: 56,
    left: 12,
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 16,
    backgroundColor: "#111",
    borderRadius: 8,
  },
  credito: {
    position: "absolute",
    bottom: 8,
    left: 8,
    fontSize: 11,
    color: "#111",
    backgroundColor: "#ffffffcc",
    paddingHorizontal: 4,
  },
  boton: {
    position: "absolute",
    bottom: 36,
    right: 12,
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 16,
    backgroundColor: "#0B4F5C",
    borderRadius: 8,
  },
  textoBoton: { color: "#fff", fontSize: 16, fontWeight: "700" },
  avisoError: {
    position: "absolute",
    top: 112,
    left: 12,
    right: 12,
    padding: 8,
    backgroundColor: "#fff",
    color: "#A61B1B",
  },
  ficha: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 96,
    padding: 12,
    gap: 4,
    backgroundColor: "#fff",
    borderRadius: 8,
  },
});
