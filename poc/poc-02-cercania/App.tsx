import * as Location from "expo-location";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { dentroDeZona, distanciaM, type Punto } from "./src/geo";
import { Indicaciones } from "./src/Indicaciones";
import {
  abrirJornada,
  atenderEntradaZona,
  cerrarJornada,
  type Estado,
  jornadaAbierta,
  leerEstado,
  pedirUbicacion,
  prepararAvisos,
  probarAviso,
} from "./src/vigilancia";

type PermisoUbicacion = "siempre" | "en-uso" | "denegada";

export default function App() {
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [verIndicaciones, setVerIndicaciones] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ubicacion, setUbicacion] = useState<PermisoUbicacion>("denegada");
  const [conAvisos, setConAvisos] = useState(false);
  const [abierta, setAbierta] = useState(false);
  const [estado, setEstado] = useState<Estado | null>(null);
  // Solo en memoria: la posicion no se guarda (RN-14).
  const [posicion, setPosicion] = useState<Punto | null>(null);

  const refrescar = useCallback(async () => {
    setAbierta(await jornadaAbierta());
    setEstado(await leerEstado());
  }, []);

  useEffect(() => {
    (async () => {
      setConAvisos(await prepararAvisos());
      setUbicacion(await pedirUbicacion());
      await refrescar();
    })()
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setCargando(false));
    const suscripcion = AppState.addEventListener("change", (actual) => {
      if (actual === "active") refrescar().catch((e: unknown) => setError(String(e)));
    });
    return () => suscripcion.remove();
  }, [refrescar]);

  const zona = estado?.zona;
  useEffect(() => {
    if (!abierta || !zona) return;
    const vigilancia = Location.watchPositionAsync(
      // Sin red, el dialogo de ajustes de Google rechaza la solicitud aunque el GPS funcione.
      { accuracy: Location.Accuracy.Highest, distanceInterval: 10, mayShowUserSettingsDialog: false },
      ({ coords }) => {
        setPosicion(coords);
        if (dentroDeZona(coords, zona.vertices)) {
          atenderEntradaZona().then(refrescar).catch((e: unknown) => setError(String(e)));
        }
      },
    );
    vigilancia.catch(() => setError("No se pudo leer la ubicación: las zonas no se están vigilando."));
    return () => {
      setPosicion(null);
      vigilancia.then((s) => s.remove()).catch(() => undefined);
    };
  }, [abierta, zona, refrescar]);

  async function ejecutar(accion: () => Promise<void>, mensaje: string) {
    setOcupado(true);
    setError(null);
    try {
      await accion();
      await refrescar();
    } catch {
      setError(mensaje);
    } finally {
      setOcupado(false);
    }
  }

  if (cargando) {
    return (
      <View style={styles.centrado}>
        <ActivityIndicator size="large" />
        <Text style={styles.texto}>Preparando…</Text>
      </View>
    );
  }

  if (verIndicaciones) return <Indicaciones onCerrar={() => setVerIndicaciones(false)} />;

  const pendientes = estado?.tareas.filter(({ id }) => !estado.avisados.includes(id)) ?? [];
  const masCercana = posicion
    ? Math.min(...pendientes.map((tarea) => distanciaM(posicion, tarea)))
    : null;

  return (
    <View style={styles.contenedor}>
      <StatusBar style="dark" />
      <Text style={styles.titulo}>Aviso de cercanía</Text>

      {ubicacion !== "siempre" && (
        <Text style={styles.alerta}>
          {ubicacion === "denegada"
            ? "Sin permiso de ubicación: la prueba no puede funcionar."
            : 'Active la ubicación "Permitir siempre" en los ajustes: sin ella no hay avisos con la app cerrada.'}
        </Text>
      )}
      {!conAvisos && (
        <Text style={styles.alerta}>Sin permiso de notificaciones: active los avisos en los ajustes.</Text>
      )}
      {error && <Text style={styles.alerta}>{error}</Text>}

      <Text style={styles.texto}>
        <Text style={styles.etiqueta}>Jornada: </Text>
        {abierta ? "abierta" : "cerrada"}
      </Text>
      {abierta && estado && (
        <>
          <Text style={styles.texto}>
            <Text style={styles.etiqueta}>Vigiladas: </Text>
            {estado.vigiladas} de {estado.tareas.length} · recálculos: {estado.recalculos}
          </Text>
          <Text style={styles.texto}>
            <Text style={styles.etiqueta}>Tarea pendiente más cercana: </Text>
            {masCercana === null || !Number.isFinite(masCercana)
              ? "—"
              : `${Math.round(masCercana)} m`}
          </Text>
          <Text style={styles.texto}>
            <Text style={styles.etiqueta}>Zona de prueba: </Text>
            150 m al sur de donde abrió la jornada
          </Text>
        </>
      )}

      <Pressable
        style={[styles.boton, abierta && styles.botonCerrar]}
        disabled={ocupado || ubicacion === "denegada"}
        accessibilityRole="button"
        onPress={() =>
          abierta
            ? ejecutar(cerrarJornada, "No se pudo cerrar la jornada.")
            : ejecutar(
                abrirJornada,
                "No se pudo abrir la jornada. Verifique que el GPS esté encendido.",
              )
        }
      >
        <Text style={styles.textoBoton}>
          {ocupado ? "Un momento…" : abierta ? "Cerrar jornada" : "Abrir jornada"}
        </Text>
      </Pressable>

      <Pressable
        style={styles.botonSecundario}
        disabled={ocupado}
        accessibilityRole="button"
        onPress={() => ejecutar(probarAviso, "No se pudo mostrar el aviso.")}
      >
        <Text style={styles.textoBotonSecundario}>Probar aviso</Text>
      </Pressable>

      <Pressable
        style={[styles.botonSecundario, styles.botonIndicaciones]}
        accessibilityRole="button"
        onPress={() => setVerIndicaciones(true)}
      >
        <Text style={styles.textoBotonSecundario}>Ver indicaciones</Text>
      </Pressable>

      <Text style={styles.subtitulo}>Bitácora</Text>
      <FlatList
        style={styles.contenedor}
        data={estado?.bitacora ?? []}
        keyExtractor={(entrada, indice) => `${entrada.hora}-${indice}`}
        ListEmptyComponent={<Text style={styles.texto}>Abra la jornada para empezar.</Text>}
        renderItem={({ item }) => (
          <Text style={styles.entrada}>
            {new Date(item.hora).toLocaleTimeString()} — {item.texto}
          </Text>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: { flex: 1 },
  centrado: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  titulo: { fontSize: 24, fontWeight: "700", color: "#111", marginTop: 56, marginBottom: 12, marginHorizontal: 16 },
  subtitulo: { fontSize: 18, fontWeight: "700", color: "#111", marginTop: 16, marginBottom: 8, marginHorizontal: 16 },
  texto: { fontSize: 16, color: "#111", marginHorizontal: 16, marginBottom: 4 },
  etiqueta: { fontWeight: "700" },
  entrada: { fontSize: 15, color: "#111", marginHorizontal: 16, marginBottom: 6 },
  alerta: { fontSize: 15, color: "#A61B1B", marginHorizontal: 16, marginBottom: 8 },
  boton: {
    minHeight: 48,
    justifyContent: "center",
    alignItems: "center",
    margin: 16,
    marginBottom: 8,
    backgroundColor: "#0B4F5C",
    borderRadius: 8,
  },
  botonCerrar: { backgroundColor: "#111" },
  botonSecundario: {
    minHeight: 48,
    justifyContent: "center",
    alignItems: "center",
    marginHorizontal: 16,
    borderWidth: 2,
    borderColor: "#0B4F5C",
    borderRadius: 8,
  },
  botonIndicaciones: { marginTop: 8 },
  textoBoton: { color: "#fff", fontSize: 16, fontWeight: "700" },
  textoBotonSecundario: { color: "#0B4F5C", fontSize: 16, fontWeight: "700" },
});
